import {deriveBoundary,boundaryGeoJSON,boundaryScope,spatialSettings,type ProjectBoundary,type SpatialSettings,filterBoundaryPlaces} from "./boundary";
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { adminDb, adminBucket } from '../firebaseAdmin';
import { listDatasets, readDataset } from './dataset-server';
import { datasetLayer } from './datasets';
import { validateConfig, validateGeoJSON } from './loader';
import { featureKey, featureCollection, resultFor, isArea } from './engine';
import { bbox } from '@turf/turf';
import type { Identity } from '../membership/server';
import type { LoadedLayer } from './types';
import { coordinate, parseGeoContext, parseGeoPlan, internalPlaces, representativePoint, calculateStraightLineDistance, isMapReference, featureNames, type Place, type GeoContext, type GeoResult } from './geo-query';
import { searchPlaces, searchNearbyPlaces, findNearestPlaces, getWalkingRoute, searchBoundaryPlaces } from './kakao-server';
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
    const settings=spatialSettings(listed.spatialSettings);
    const active=layers.find(l=>l.config.id===`uploaded-${settings.activeBoundaryDatasetId}`);
    let boundary:ProjectBoundary|undefined;
    if(active){try{boundary=deriveBoundary(boundaryGeoJSON(active.data));}catch{warnings.push('boundary.invalid');}}
    return { layers, warnings, boundary, settings };
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
}, user: Identity, projectId: string, layers: LoadedLayer[], layerWarnings: string[] = [], signal?: AbortSignal, options?:{boundary?:ProjectBoundary;settings?:SpatialSettings}): Promise<GeoResult> {
    const plan = parseGeoPlan(input.question), context = parseGeoContext(input.context), locale = input.locale === 'en' ? 'en' : 'ko';
    const t = (key: string, values?: Record<string, string | number>) => translate(locale, key, values);
    const boundary=options?.boundary,settings=spatialSettings(options?.settings);
    const scopeMeters=context.scopeMeters??settings.defaultNearbyMeters;
    let origin = plan.origin ? undefined : defaultOrigin(context, options ? layers.filter(l=>l.config.role!=='boundary') : layers);
    if(!plan.origin&&!context.selected&&!context.point&&boundary)origin={id:'project-center',name:'gis.projectCenter',source:'project',coordinate:boundary.center,approximate:true};
    const warnings = layerWarnings.map(w => t(w));
    if(options&&!boundary)warnings.push(t('boundary.noActive'));
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
        let options = await resolvePlaceReference(name, context, layers, origin, signal);
        if(boundary&&!internalPlaces(name,layers,featureKey).length&&role==='destination'){
          const local=filterBoundaryPlaces(options,boundaryScope(boundary,scopeMeters));if(local.length)options=local;
        }
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
        const named=layers.flatMap(l=>l.data.features.flatMap((f,i)=>featureNames(f).some(name=>name.length>1&&input.question.includes(name))?[{layer:l,feature:f,index:i}]:[]));
        if(/시설|타워|전파기지|facilit|tower|station/i.test(input.question)){
          const locations=named.length?named:layers.filter(l=>l.config.role==='facilities').flatMap(l=>l.data.features.map((f,i)=>({layer:l,feature:f,index:i})));
          result.places=locations.slice(0,20).map(({layer,feature,index})=>({id:layer.config.id+':'+featureKey(feature,index),name:featureNames(feature)[0]??layer.config.label,source:'project',layerId:layer.config.id,featureId:featureKey(feature,index),...representativePoint(feature)}));
          result.reply=result.places.length?t('boundary.facilitySummary',{count:result.places.length}):t('boundary.noFacilities');return result;
        }
        const selected=context.selected?layers.find(l=>l.config.id===context.selected!.layerId):undefined;
        const feature=selected?.data.features.find((f,i)=>featureKey(f,i)===context.selected!.featureId);
        const shape=feature&&isArea(feature)?feature:boundary?.geometry;
        const layer=feature?selected:layers.find(l=>l.config.id===`uploaded-${settings.activeBoundaryDatasetId}`);
        if(shape){
          result.computedResult=resultFor(projectId,'area',layers,shape,{selectedLayerId:layer?.config.id??'',selectedFeatureId:feature?context.selected!.featureId:'__boundary__'});
          const metrics=result.computedResult.metrics;
          result.reply=t('boundary.area',{area:Math.round(metrics.areaSqm??0).toLocaleString()});
          if(metrics.buildingCount!==undefined)result.reply+=' '+t('boundary.buildingCount',{count:metrics.buildingCount});
          result.reply+=' '+t('boundary.dataLimit');
        }else result.reply=t('boundary.noGeometry');
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
    else if(boundary&&(!origin||filterBoundaryPlaces([origin],boundaryScope(boundary,scopeMeters)).length>0)&&(!plan.origin||isMapReference(plan.origin)||origin?.source==='project')){
        let candidates=(await searchBoundaryPlaces(plan.query,boundaryScope(boundary,scopeMeters),signal)).places;
        const explicitRadius=/\d+(?:\.\d+)?\s*(?:m|km|미터|킬로미터)/i.test(input.question);
        if(explicitRadius&&origin)candidates=candidates.filter(p=>calculateStraightLineDistance(origin!.coordinate,p.coordinate)<=plan.radius);
        candidates=candidates.map(p=>({...p,distanceMeters:origin?calculateStraightLineDistance(origin.coordinate,p.coordinate):undefined})).sort((a,b)=>(a.distanceMeters??0)-(b.distanceMeters??0));
        result.scopeMeters=scopeMeters;warnings.push(t('boundary.partialSearch'));
        if(plan.intent==='NEAREST_PLACE'&&plan.walking){
          const checked=await Promise.allSettled(candidates.slice(0,3).map(async place=>({place,route:await getWalkingRoute(origin!.coordinate,place.coordinate,signal)})));
          warnings.push(...[...new Set(checked.flatMap(r=>r.status==='rejected'?[r.reason instanceof Error&&r.reason.message.startsWith('gis.')?r.reason.message:'gis.noRoute']:[]))].map(key=>t(key)));
          const routes=checked.flatMap(r=>r.status==='fulfilled'?[r.value]:[]).sort((a,b)=>a.route.distanceMeters-b.route.distanceMeters);
          if(routes.length){result.places=routes.slice(0,plan.limit).map(r=>({...r.place,distanceMeters:r.route.distanceMeters}));result.route=routes[0].route;result.destination=result.places[0];result.ranking='walking';warnings.push(t('gis.limitedRanking'));}
          else{result.places=candidates.slice(0,plan.limit);result.ranking='straight';warnings.push(t('gis.noRoute'));}
        }else{result.places=candidates.slice(0,plan.limit);if(plan.intent==='NEAREST_PLACE')result.ranking='straight';}
        if(explicitRadius)result.radiusMeters=plan.radius;
    }
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
