import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { adminDb, adminBucket } from '../firebaseAdmin';
import { listDatasets, readDataset } from './dataset-server';
import { datasetLayer } from './datasets';
import { validateConfig, validateGeoJSON } from './loader';
import { featureKey, featureCollection } from './engine';
import { bbox } from '@turf/turf';
import type { Identity } from '../membership/server';
import type { LoadedLayer } from './types';
import { coordinate, parseGeoContext, parseGeoPlan, internalPlaces, representativePoint, calculateStraightLineDistance, isMapReference, type Place, type GeoContext, type GeoResult } from './geo-query';
import { searchPlaces, searchNearbyPlaces, findNearestPlaces, getWalkingRoute } from './kakao-server';
import { translate, type Locale } from '../i18n';
const geometryCache = new Map<string, {
    data: LoadedLayer['data'];
    expires: number;
    bytes: number;
}>();
export async function projectLayers(user: Identity, projectId: string, signal?: AbortSignal) {
    const layers: LoadedLayer[] = [];
    const warnings: string[] = [];
    // Same project-owned metadata, normalized building files and authorization as the existing map.
    signal?.throwIfAborted();
    const listed = await listDatasets(adminDb(), user, projectId);
    for (const dataset of listed.datasets) {
        const config = datasetLayer(dataset);
        if (!config)
            continue;
        try {
            signal?.throwIfAborted();
            const key = JSON.stringify([user.uid, projectId, dataset.datasetId, dataset.revisionId, dataset.normalizedId, dataset.buildingUseVersion]);
            for (const [id, entry] of geometryCache)
                if (entry.expires < Date.now())
                    geometryCache.delete(id);
            const cached = geometryCache.get(key);
            if (cached) {
                layers.push({ config, data: cached.data });
                continue;
            }
            const value = await readDataset(adminDb(), adminBucket(), user, projectId, dataset.datasetId, dataset.revisionId);
            signal?.throwIfAborted();
            if (value.data) {
                const data = validateGeoJSON(value.data, config);
                const bytes = Buffer.byteLength(JSON.stringify(data));
                while (geometryCache.size && (geometryCache.size >= 20 || [...geometryCache.values()].reduce((n, v) => n + v.bytes, 0) + bytes > 30 * 1024 * 1024))
                    geometryCache.delete(geometryCache.keys().next().value!);
                if (bytes <= 3 * 1024 * 1024)
                    geometryCache.set(key, { data, bytes, expires: Date.now() + 120000 });
                layers.push({ config, data });
            }
        }
        catch (error) {
            if (signal?.aborted) throw error;
            warnings.push('gis.layerUnavailable');
        }
    }
    try {
        signal?.throwIfAborted();
        const config = validateConfig(JSON.parse(await readFile(path.join(process.cwd(), 'public', 'data', 'projects', projectId, 'config.json'), 'utf8')), projectId);
        for (const layer of config.layers) {
            try {
                signal?.throwIfAborted();
                layers.push({ config: layer, data: validateGeoJSON(JSON.parse(await readFile(path.join(process.cwd(), 'public', layer.source), 'utf8')), layer) });
            }
            catch (error) {
                if (signal?.aborted) throw error;
                warnings.push('gis.layerUnavailable');
            }
        }
    }
    catch (error) {
        if (signal?.aborted) throw error;
        if ((error as {
            code?: string;
        }).code !== 'ENOENT')
            warnings.push('gis.layerUnavailable');
    }
    return { layers, warnings };
}
function selectedPlace(context: GeoContext, layers: LoadedLayer[]): Place | undefined {
    if (context.selected) {
        const layer = layers.find(l => l.config.id === context.selected!.layerId);
        const index = layer?.data.features.findIndex((f, i) => featureKey(f, i) === context.selected!.featureId) ?? -1;
        if (!layer || index < 0)
            throw new Error('gis.selectionChanged');
        const feature = layer.data.features[index];
        return { id: `${layer.config.id}:${featureKey(feature, index)}`, name: typeof feature.properties?.name === 'string' ? feature.properties.name : layer.config.label, source: 'project', layerId: layer.config.id, featureId: featureKey(feature, index), ...representativePoint(feature) };
    }
    if (context.point)
        return { id: 'map-point', name: 'gis.selectedPoint', coordinate: context.point, source: 'map' };
}
function defaultOrigin(context: GeoContext, layers: LoadedLayer[]): Place | undefined {
    const selected = selectedPlace(context, layers);
    if (selected)
        return selected;
    const boundary = layers.filter(l => l.config.role === 'boundary').flatMap(l => l.data.features);
    if (boundary.length) {
        const b = bbox(featureCollection(boundary));
        return { id: 'project-center', name: 'gis.projectCenter', coordinate: coordinate([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]), source: 'project', approximate: true };
    }
    if (context.mapCenter)
        return { id: 'map-center', name: 'gis.mapCenter', coordinate: context.mapCenter, source: 'map' };
}
const secret = () => process.env.KAKAO_REST_API_KEY;
function stamp(value: string) { return createHmac('sha256', secret() ?? '').update('pss-geo-choice-v1:' + value).digest('base64url'); }
function scope(uid: string, projectId: string, question: string, reference: string) { return createHash('sha256').update(JSON.stringify([uid, projectId, question, reference])).digest('hex'); }
export function signChoice(place: Place, binding: string) {
    if (!secret())
        return undefined;
    const value = Buffer.from(JSON.stringify({ place, binding, expires: Date.now() + 5 * 60000 })).toString('base64url');
    return value + '.' + stamp(value);
}
export function verifyChoice(token: unknown, binding: string): Place | undefined {
    if (!secret() || typeof token !== 'string' || token.length > 5000)
        return;
    const [value, signature, ...extra] = token.split('.');
    if (extra.length || !value || !signature)
        return;
    const actual = Buffer.from(signature);
    const expected = Buffer.from(stamp(value));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
        return;
    try {
        const parsed = JSON.parse(Buffer.from(value, 'base64url').toString());
        if (parsed.binding !== binding || parsed.expires < Date.now() || !['kakao', 'project'].includes(parsed.place.source))
            return;
        coordinate(parsed.place.coordinate);
        return parsed.place as Place;
    }
    catch {
        return;
    }
}
export async function resolvePlaceReference(name: string, context: GeoContext, layers: LoadedLayer[], center?: Place, signal?: AbortSignal) {
    if (/^(현재\s*(지도\s*)?중심|map center)$/i.test(name.trim()))
        return context.mapCenter ? [{ id: 'map-center', name: 'gis.mapCenter', coordinate: context.mapCenter, source: 'map' as const }] : [];
    if (isMapReference(name)) {
        const selected = selectedPlace(context, layers);
        return selected ? [selected] : [];
    }
    const internal = internalPlaces(name, layers, featureKey);
    if (internal.length)
        return internal;
    return searchPlaces(name, { center: center?.coordinate, limit: 10, signal }); // Proximity preference, no exact-name radius exclusion.
}
export async function executeGeoQuery(input: {
    question: string;
    context?: unknown;
    choices?: Record<string, string>;
    locale?: Locale;
}, user: Identity, projectId: string, layers: LoadedLayer[], layerWarnings: string[] = [], signal?: AbortSignal): Promise<GeoResult> {
    const plan = parseGeoPlan(input.question), context = parseGeoContext(input.context), locale = input.locale === 'en' ? 'en' : 'ko';
    const t = (key: string, values?: Record<string, string | number>) => translate(locale, key, values);
    let origin = plan.origin ? undefined : defaultOrigin(context, layers);
    const warnings = layerWarnings.map(w => t(w));
    const result: GeoResult = { question: input.question, intent: plan.intent, reply: '', places: [], warnings };
    const resolve = async (name: string, role: 'origin' | 'destination') => {
        const binding = scope(user.uid, projectId, input.question, name);
        const token = input.choices && Object.prototype.hasOwnProperty.call(input.choices, name) ? input.choices[name] : undefined;
        let selected: Place | undefined;
        if (token?.startsWith('project:'))
            selected = internalPlaces(name, layers, featureKey).find(p => 'project:' + p.id === token);
        else
            selected = verifyChoice(token, binding);
        if (selected)
            return selected;
        if (token)
            throw new Error('gis.choiceExpired');
        const options = await resolvePlaceReference(name, context, layers, origin, signal);
        const ambiguousGeneric = /^(경로당|주민센터|건강생활지원센터)$/.test(name.trim());
        if (options.length === 1 && !ambiguousGeneric)
            return options[0];
        if (!options.length) {
            result.reply = t('gis.noPlace', { name });
            return;
        }
        result.clarify = { reference: name, role, options: options.map(p => ({ ...p, choiceToken: p.source === 'project' ? 'project:' + p.id : signChoice(p, binding) })) };
        result.places = result.clarify.options;
        result.reply = t('gis.choosePlace', { name });
        return;
    };
    if (plan.intent === 'EXISTING_GIS_QUERY') {
        result.reply = t('gis.existingTools');
        return result;
    }
    if (plan.minutes && !plan.destination) {
        result.origin = plan.origin ? undefined : origin;
        result.reply = t('gis.noIsochrone');
        return result;
    }
    if (plan.origin) {
        origin = await resolve(plan.origin, 'origin');
        if (!origin)
            return result;
    }
    if (plan.destination) {
        if (!origin) {
            result.reply = t('gis.needOrigin');
            return result;
        }
        const destination = await resolve(plan.destination, 'destination');
        if (!destination)
            return result;
        result.origin = origin;
        result.destination = destination;
        result.places = [destination];
        const meters = calculateStraightLineDistance(origin.coordinate, destination.coordinate);
        result.straightDistanceMeters = meters;
        if (meters < 1) {
            result.reply = t('gis.samePoint');
            return result;
        }
        if (plan.walking) {
            try {
                result.route = await getWalkingRoute(origin.coordinate, destination.coordinate, signal);
                result.reply = t('gis.walkSummary', { distance: Math.round(result.route.distanceMeters), minutes: Math.ceil(result.route.durationSeconds / 60) });
            }
            catch (error) {
                warnings.push(t(error instanceof Error ? error.message : 'gis.noRoute'));
                result.reply = t('gis.straightFallback', { distance: Math.round(meters) });
            }
        }
        else
            result.reply = t('gis.straightSummary', { distance: Math.round(meters) });
        if (origin.approximate || destination.approximate)
            warnings.push(t('gis.approximate'));
        return result;
    }
    if (plan.nearby && !origin) {
        result.reply = t('gis.needOrigin');
        return result;
    }
    result.origin = origin;
    const internal = internalPlaces(plan.query, layers, featureKey);
    if (internal.length && !plan.nearby)
        result.places = internal;
    else if (plan.intent === 'NEAREST_PLACE') {
        const nearest = await findNearestPlaces(plan.query, origin!, plan.radius, plan.limit, plan.walking, signal);
        result.places = nearest.places;
        result.ranking = plan.walking && nearest.routes.length ? 'walking' : 'straight';
        result.route = nearest.routes[0]?.route;
        result.destination = result.places[0];
        result.partial = nearest.partial;
        warnings.push(...nearest.routeErrors.map(key => t(key)));
        if (nearest.expanded)
            warnings.push(t('gis.expanded'));
        if (plan.walking && nearest.partial && result.route)
            warnings.push(t('gis.limitedRanking'));
        if (plan.walking && !result.route)
            warnings.push(t('gis.noRoute'));
    }
    else if (plan.nearby) {
        const nearby = await searchNearbyPlaces(plan.query, origin!.coordinate, plan.radius, signal);
        result.places = nearby.places.slice(0, plan.limit);
        if (nearby.expanded)
            warnings.push(t('gis.expanded'));
        result.radiusMeters = nearby.expanded ? Math.min(20000, plan.radius * 3) : plan.radius;
    }
    else
        result.places = await searchPlaces(plan.query, { center: origin?.coordinate, limit: plan.limit, signal });
    result.reply = result.places.length ? t('gis.searchSummary', { count: result.places.length }) : t('gis.noPlace', { name: plan.query });
    if (result.ranking)
        result.reply += ' ' + t(result.ranking === 'walking' ? 'gis.rankWalking' : 'gis.rankStraight');
    if (origin?.approximate)
        warnings.push(t('gis.approximate'));
    return result;
}
