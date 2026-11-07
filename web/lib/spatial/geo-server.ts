import {deriveBoundary,boundaryGeoJSON,boundaryScope,spatialSettings,type ProjectBoundary,type SpatialSettings,filterBoundaryPlaces} from "./boundary";
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { adminDb, adminBucket } from '../firebaseAdmin';
import { listDatasets, readDataset } from './dataset-server';
import { datasetLayer } from './datasets';
import { validateConfig, validateGeoJSON } from './loader';
import { featureKey, featureCollection, resultFor, isArea } from './engine';
import { bbox, bearing, point, booleanPointInPolygon, pointToPolygonDistance, nearestPointOnLine, lineString } from '@turf/turf';
import type { Identity } from '../membership/server';
import type { LoadedLayer } from './types';
import { coordinate, parseGeoContext, parseGeoPlan, internalPlaces, representativePoint, calculateStraightLineDistance, placeResultFollowUp, isMapReference, featureNames, type Place, type GeoContext, type GeoResult } from './geo-query';
import { getWalkingRoute, searchBoundaryPlaces } from './kakao-server';
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
        return { id: `${layer.config.id}:${featureKey(feature, index)}`, name: featureNames(feature)[0] ?? layer.config.label, source: 'project', layerId: layer.config.id, featureId: featureKey(feature, index), ...representativePoint(feature) };
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
export async function resolvePlaceReference(name: string, context: GeoContext, layers: LoadedLayer[], search?: (query: string) => Promise<Place[]>) {
    if (/^(현재\s*(지도\s*)?중심|map center)$/i.test(name.trim()))
        return context.mapCenter ? [{ id: 'map-center', name: 'gis.mapCenter', coordinate: context.mapCenter, source: 'map' as const }] : [];
    if (isMapReference(name)) {
        const selected = selectedPlace(context, layers);
        return selected ? [selected] : [];
    }
    const internal = internalPlaces(name, layers, featureKey);
    if (internal.length)
        return internal;
    return search ? search(name) : [];
}
function nearestBoundaryCoordinate(place: Place, boundary: ProjectBoundary) {
    if (booleanPointInPolygon(point(place.coordinate), boundary.geometry)) return place.coordinate;
    const geometry = boundary.geometry.geometry;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return polygons.flatMap(polygon => polygon.map(ring => nearestPointOnLine(lineString(ring), point(place.coordinate), { units: 'meters' })))
        .sort((a,b) => (a.properties.dist ?? Infinity) - (b.properties.dist ?? Infinity))[0].geometry.coordinates.slice(0,2) as import('./geo-query').Coordinate;
}
// Reuse the existing signed, expiring place choices for transient follow-up context.
// No vendor response cache/collection or permanent token storage is introduced.
export function signGeoResult(result: GeoResult, user: Identity, projectId: string): GeoResult {
    if (result.clarify) return result;
    return { ...result, places: result.places.map(({ choiceToken, ...place }) => {
        void choiceToken;
        const token = place.source === "kakao" ? signChoice(place, scope(user.uid, projectId, result.question, `result:${place.id}:${result.scopeMeters ?? ""}`)) : undefined;
        return { ...place, ...(token ? { choiceToken: token } : {}) };
    }) };
}
function previousPlaces(value: unknown, user: Identity, projectId: string, layers: LoadedLayer[], boundary?: ProjectBoundary) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const previous = value as { question?: unknown; places?: unknown; scopeMeters?: unknown };
    if (typeof previous.question !== "string" || previous.question.length > 1000 || !Array.isArray(previous.places) || previous.places.length > 20) return;
    const places: Place[] = [];
    for (const input of previous.places) {
        if (!input || typeof input !== "object") return;
        const p = input as Place;
        let place: Place | undefined;
        if (p.source === "project" && p.layerId && p.featureId) {
            try { place = selectedPlace({ selected: { layerId: p.layerId, featureId: p.featureId } }, layers); } catch { return; }
        } else if (p.source === "kakao") {
            place = verifyChoice(p.choiceToken, scope(user.uid, projectId, previous.question, `result:${p.id}:${previous.scopeMeters ?? ""}`));
            if (!place || !boundary || !filterBoundaryPlaces([place], boundaryScope(boundary, 2000)).length) return;
        }
        if (!place) return;
        places.push(place);
    }
    return places.length ? { places, ...(typeof previous.scopeMeters === "number" && previous.scopeMeters >= 0 && previous.scopeMeters <= 2000 ? { scopeMeters: previous.scopeMeters } : {}) } : undefined;
}
export async function executeGeoQuery(input: {
    question: string;
    context?: unknown;
    choices?: Record<string, string>;
    previousResult?: unknown;
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
    const followUp = placeResultFollowUp(input.question);
    if (followUp) {
        const previous = previousPlaces(input.previousResult, user, projectId, layers, boundary);
        if (!previous || !boundary) { result.reply = t("gis.refreshPlaces"); return result; }
        result.places = previous.places;
        result.scopeMeters = previous.scopeMeters;
        result.origin = { id: "project-center", name: t("gis.projectCenter"), source: "project", coordinate: boundary.center, approximate: true };
        if (followUp === "boundary-nearest") {
            result.intent = "NEAREST_PLACE";
            result.places = previous.places.map(place => ({ ...place, boundaryDistanceMeters: Math.max(0, pointToPolygonDistance(point(place.coordinate), boundary.geometry, { units: "meters" })) })).sort((a,b) => a.boundaryDistanceMeters-b.boundaryDistanceMeters);
            const closest = result.places[0].boundaryDistanceMeters!;
            const tied = result.places.filter(place => Math.abs(place.boundaryDistanceMeters!-closest) < 0.5);
            result.destination = result.places[0];
            result.reply = t("gis.closestBoundary", { names: tied.map(place=>place.name).join(", "), distance: Math.round(closest) });
        } else {
            const counts = new Map<string, number>();
            for (const place of previous.places) {
                const direction = calculateStraightLineDistance(boundary.center, place.coordinate) < 1 ? "gis.centerPoint" : `picker.direction.${["n","ne","e","se","s","sw","w","nw"][Math.round((bearing(point(boundary.center), point(place.coordinate))+360)/45)%8]}`;
                counts.set(direction,(counts.get(direction)??0)+1);
            }
            result.reply = t("gis.placeDistribution", { groups: [...counts].sort((a,b)=>b[1]-a[1]).map(([direction,count])=>t("gis.directionCount",{direction:t(direction),count})).join(", ") });
        }
        result.reply += "\n"+t("gis.poiExploration");
        return result;
    }
    let remainingCalls = 16;
    const external = async (query: string) => {
        if (!boundary) { if (!warnings.includes(t('picker.needBoundary'))) warnings.push(t('picker.needBoundary')); return []; }
        const explicitRadius = /\d+(?:\.\d+)?\s*(?:m|km|미터|킬로미터)/i.test(input.question);
        const distances = context.scopeMeters === 0 ? [0] : explicitRadius && plan.nearby && origin?.boundaryTarget ? [Math.min(2000, plan.radius)] : [...new Set([0, scopeMeters, 1000, 2000])].sort((a,b) => a-b);
        for (const meters of distances) {
            signal?.throwIfAborted();
            if (!remainingCalls) break;
            const found = await searchBoundaryPlaces(query, boundaryScope(boundary, meters), signal, Math.min(4, remainingCalls));
            remainingCalls -= found.calls;
            result.scopeMeters = meters;
            if (!warnings.includes(t('boundary.partialSearch'))) warnings.push(t('boundary.partialSearch'));
            let places = found.places;
            if (plan.nearby && origin && !origin.boundaryTarget && (plan.origin || /\d+(?:\.\d+)?\s*(?:m|km|미터|킬로미터)/i.test(input.question))) places = places.filter(p => calculateStraightLineDistance(origin!.coordinate, p.coordinate) <= plan.radius);
            if (places.length) {
                if (meters > scopeMeters) warnings.push(t('picker.expanded', { meters }));
                return places;
            }
        }
        return [];
    };
    const resolve = async (name: string, role: 'origin' | 'destination' | 'place') => {
        if (/^(?:이\s*)?(?:사업구역|사업\s*경계|대상지|project (?:area|boundary))$/i.test(name) && boundary)
            return { id: 'project-boundary', name: t('upload.boundary'), source: 'project' as const, coordinate: boundary.center, approximate: true, boundaryTarget: true };
        const binding = scope(user.uid, projectId, input.question, name);
        const token = input.choices && Object.prototype.hasOwnProperty.call(input.choices, name) ? input.choices[name] : undefined;
        let selected: Place | undefined;
        if (token?.startsWith('project:'))
            selected = internalPlaces(name, layers, featureKey).find(p => 'project:' + p.id === token);
        else
            selected = verifyChoice(token, binding);
        if (selected?.source === 'kakao' && (!boundary || !filterBoundaryPlaces([selected], boundaryScope(boundary, context.scopeMeters === 0 ? 0 : 2000)).length)) throw new Error('gis.choiceExpired');
        if (selected)
            return selected;
        if (token)
            throw new Error('gis.choiceExpired');
        const options = await resolvePlaceReference(name, context, layers, external);
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
    if (plan.locations) {
        const resolved: Place[] = [];
        for (const name of plan.locations) {
            const place = await resolve(name, 'place');
            if (!place) { result.resolvedPlaces = resolved; return result; }
            resolved.push(place);
        }
        result.places = [...new Map(resolved.map(p => [p.id,p])).values()];
        result.reply = result.places.map(p => {
            if (!boundary) return t('picker.located', { name: p.name });
            p.insideBoundary = booleanPointInPolygon(point(p.coordinate), boundary.geometry);
            p.boundaryDistanceMeters = Math.max(0, pointToPolygonDistance(point(p.coordinate), boundary.geometry, { units: 'meters' }));
            return t(p.insideBoundary ? 'picker.inside' : 'picker.outside', { name: p.approximate?t('picker.representative',{name:p.name}):p.name, distance: Math.round(p.boundaryDistanceMeters) });
        }).join('\n');
        for (let i=1; i<result.places.length; i++) {
            const first=result.places[0], next=result.places[i], meters=calculateStraightLineDistance(first.coordinate,next.coordinate);
            const direction=['n','ne','e','se','s','sw','w','nw'][Math.round((bearing(point(first.coordinate),point(next.coordinate))+360)/45)%8];
            result.reply += '\n'+(meters < 1 ? t('picker.sameLocation',{first:first.name,next:next.name}) : t('picker.relationship',{first:first.name,next:next.name,direction:t(`picker.direction.${direction}`),distance:Math.round(meters)}));
        }
        if (result.places.some(p=>p.approximate)) warnings.push(t('gis.approximate'));
        return result;
    }
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
    result.origin = origin;
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
        if (destination.boundaryTarget && boundary) {
            destination.coordinate = nearestBoundaryCoordinate(origin, boundary);
            const meters = Math.max(0, pointToPolygonDistance(point(origin.coordinate),boundary.geometry,{units:'meters'}));
            result.straightDistanceMeters = meters;
            result.reply = meters < 1 ? t('picker.originInside',{name:origin.approximate?t('picker.representative',{name:origin.name}):origin.name}) : t('picker.boundaryDistance',{name:origin.approximate?t('picker.representative',{name:origin.name}):origin.name,distance:Math.round(meters)});
            if (origin.approximate) warnings.push(t('gis.approximate'));
            if (plan.walking) warnings.push(t('gis.noRoute'));
            return result;
        }
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
    if (!plan.nearby) {
        const place = await resolve(plan.query, 'place');
        if (!place) return result;
        result.places = [place];
    } else {
        const requestedRadius = /\d+(?:\.\d+)?\s*(?:m|km|미터|킬로미터)/i.test(input.question);
        const projectSearchArea = boundary && origin?.boundaryTarget ? boundaryScope(boundary, requestedRadius ? Math.min(2000, plan.radius) : scopeMeters) : undefined;
        const internal = internalPlaces(plan.query, layers, featureKey).filter(p => projectSearchArea ? filterBoundaryPlaces([p], projectSearchArea).length > 0 : !origin || (!plan.origin && !requestedRadius) || calculateStraightLineDistance(origin.coordinate,p.coordinate) <= plan.radius);
        const candidates = (internal.length ? internal : await external(plan.query)).map(p => ({...p,distanceMeters:origin?calculateStraightLineDistance(origin.coordinate,p.coordinate):undefined})).sort((a,b)=>(a.distanceMeters??0)-(b.distanceMeters??0));
        result.places = candidates.slice(0,plan.limit);
        if (/\d+(?:\.\d+)?\s*(?:m|km|미터|킬로미터)/i.test(input.question)) result.radiusMeters=plan.radius;
        if (plan.intent === 'NEAREST_PLACE') {
            result.ranking = 'straight';
            if (plan.walking && origin) {
                const checked = await Promise.allSettled(candidates.slice(0,3).map(async place => ({place,route:await getWalkingRoute(origin!.coordinate,place.coordinate,signal)})));
                warnings.push(...[...new Set(checked.flatMap(r=>r.status==='rejected'?[r.reason instanceof Error&&r.reason.message.startsWith('gis.')?r.reason.message:'gis.noRoute']:[]))].map(key=>t(key)));
                const routes=checked.flatMap(r=>r.status==='fulfilled'?[r.value]:[]).sort((a,b)=>a.route.distanceMeters-b.route.distanceMeters);
                if (routes.length) { result.places=routes.slice(0,plan.limit).map(r=>({...r.place,distanceMeters:r.route.distanceMeters}));result.route=routes[0].route;result.destination=result.places[0];result.ranking='walking';warnings.push(t('gis.limitedRanking')); }
                else if(candidates.length) warnings.push(t('gis.noRoute'));
                result.partial = candidates.length > 3 || routes.length < candidates.length;
            }
        }
    }
    result.reply = result.places.length ? t('gis.searchSummary', { count: result.places.length }) : t('gis.noPlace', { name: plan.query });
    if (result.places.length) {
        result.reply += "\n"+result.places.map(place => `${place.name}${place.address ? ` · ${place.address}` : ""}`).join("\n");
        if (result.scopeMeters !== undefined) result.reply += "\n"+(result.scopeMeters === 0 ? t("boundary.scope.0") : t("gis.searchScope", { meters: result.scopeMeters }));
        if (result.places.some(place => place.source === "kakao")) result.reply += "\n"+t("gis.poiExploration");
    }
    if (result.ranking)
        result.reply += ' ' + t(result.ranking === 'walking' ? 'gis.rankWalking' : 'gis.rankStraight');
    if (origin?.approximate)
        warnings.push(t('gis.approximate'));
    return result;
}
