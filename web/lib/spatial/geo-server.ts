import { followUpPolicy, requestClarification } from "../facilitation";
import {deriveBoundary,boundaryGeoJSON,boundaryScope,spatialSettings,type ProjectBoundary,type SpatialSettings,filterBoundaryPlaces,roadSearchScope} from "./boundary";
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { adminDb, adminBucket } from '../firebaseAdmin';
import { listDatasets, readDataset } from './dataset-server';
import { datasetLayer } from './datasets';
import { validateConfig, validateGeoJSON } from './loader';
import { featureKey, featureCollection, resultFor, isArea, touches, createBuffer, intersectionAreas, overlayArea, scorePriority } from './engine';
import { bbox, bearing, point, booleanPointInPolygon, pointToPolygonDistance, nearestPointOnLine, lineString } from '@turf/turf';
import type { Identity } from '../membership/server';
import { projectBoundaryLayerId } from "./types";
import type { LoadedLayer, SpatialConfig } from './types';
import { coordinate, groupPlaceCandidates, isProjectAreaReference, mapPointLabel, spatialConversationQuestion, parseGeoContext, parseGeoPlan, internalPlaces, representativePoint, calculateStraightLineDistance, placeResultFollowUp, genericCategoryCode, spatialToolRequest, isMapReference, isProjectStreetReference, projectStreetCorrection, featureNames, type Place, type GeoContext, type GeoResult, type PlaceSearchSnapshot } from './geo-query';
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
    let priority: SpatialConfig["priority"];
    let reference: SpatialConfig | undefined;
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
        priority = config.priority;
        reference = config;
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
    const boundaryLayerId=projectBoundaryLayerId(layers.map(layer=>layer.config),settings.activeBoundaryDatasetId,reference?.boundaryLayerId);
    const active=layers.find(l=>l.config.id===boundaryLayerId);
    if (active) active.config = {...active.config, role:"boundary", color:active.config.color??"#2563eb"};
    let boundary:ProjectBoundary|undefined;
    if(active){try{boundary=deriveBoundary(boundaryGeoJSON(active.data));}catch{warnings.push('boundary.invalid');}}
    return { layers, warnings, boundary, settings, priority, boundaryLayerId, placeSearch: reference?.placeSearch };
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
        return { id: 'map-point', name: context.pointLabel ?? 'gis.selectedPoint', coordinate: context.point, source: 'map' };
}
function defaultOrigin(context: GeoContext, layers: LoadedLayer[]): Place | undefined {
    const selected = selectedPlace(context, layers);
    if (selected)
        return selected;
    const boundary = layers.filter(l => l.config.role === 'boundary' && !l.config.internalOnly).flatMap(l => l.data.features);
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
export async function resolvePlaceReference(name: string, context: GeoContext, layers: LoadedLayer[], search?: (query: string) => Promise<Place[]>): Promise<Place[]> {
    if (/^(현재\s*(지도\s*)?중심|map center)$/i.test(name.trim()))
        return context.mapCenter ? [{ id: 'map-center', name: 'gis.mapCenter', coordinate: context.mapCenter, source: 'map' as const }] : [];
    if (isMapReference(name) || context.pointLabel && name.trim().replace(/\s/g,'').toLowerCase() === context.pointLabel.replace(/\s/g,'').toLowerCase()) {
        const selected = selectedPlace(context, layers);
        return selected ? [selected] : [];
    }
    const internal = internalPlaces(name, layers, featureKey);
    if (internal.length)
        return internal;
    const matchingLayers = layers.filter(layer => layer.config.label.trim().toLowerCase() === name.trim().toLowerCase() || (/^(?:공공시설|주요\s*시설|facilities)$/i.test(name.trim()) && (layer.config.role === "facilities" || layer.config.datasetType === "public_facilities")));
    const registered = matchingLayers.flatMap(layer => layer.data.features.map((feature,index)=>({id:`${layer.config.id}:${featureKey(feature,index)}`,name:featureNames(feature)[0]??layer.config.label,source:"project" as const,layerId:layer.config.id,featureId:featureKey(feature,index),...representativePoint(feature)})));
    if (registered.length) return registered;
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
function searchSignature(value: Omit<PlaceSearchSnapshot,"searchToken">, expires: number, user: Identity, projectId: string) {
    const records=value.places.map(p=>[p.id,p.name,p.source,p.coordinate,p.category??null,p.categoryCode??null,p.address??null,p.roadAddress??null,p.url??null,p.distanceMeters??null]);
    return stamp(JSON.stringify(["search-snapshot",user.uid,projectId,expires,value.question,value.searchQuery,value.categoryCode??null,value.scopeMeters??null,records]));
}
function verifiedSearch(value: unknown, user: Identity, projectId: string): PlaceSearchSnapshot | undefined {
    if (!secret() || !value || typeof value!=="object" || Array.isArray(value)) return;
    const snapshot=value as PlaceSearchSnapshot;
    if(typeof snapshot.question!=="string"||snapshot.question.length>1000||typeof snapshot.searchQuery!=="string"||snapshot.searchQuery.length>200||!Array.isArray(snapshot.places)||snapshot.places.length>20||typeof snapshot.searchToken!=="string"||!/^\d{13}\.[A-Za-z0-9_-]{43}$/.test(snapshot.searchToken))return;
    const [time,signature]=snapshot.searchToken.split('.'),expires=Number(time);
    if(expires<Date.now()||expires>Date.now()+5*60000)return;
    try {
        snapshot.places.forEach(p=>coordinate(p.coordinate));
        const expected=Buffer.from(searchSignature(snapshot,expires,user,projectId)),actual=Buffer.from(signature);
        if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return;
        return snapshot;
    }catch{return;}
}
export function signGeoResult(result: GeoResult, user: Identity, projectId: string): GeoResult {
    if (result.clarify) return result;
    const signed: GeoResult = { ...result, places: result.places.map(({ choiceToken, ...place }) => {
        void choiceToken;
        const token = place.source === "kakao" ? signChoice(place, scope(user.uid, projectId, result.question, `result:${place.id}:${result.scopeMeters ?? ""}`)) : undefined;
        return { ...place, ...(token ? { choiceToken: token } : {}) };
    }) };
    if(secret() && signed.searchQuery){
        const expires=Date.now()+5*60000;
        signed.searchToken=`${expires}.${searchSignature({...signed,searchQuery:signed.searchQuery},expires,user,projectId)}`;
    }
    return signed;
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
    recentSearches?: unknown;
    history?: import("../chat-history").ConversationMessage[];
    locale?: Locale;
}, user: Identity, projectId: string, layers: LoadedLayer[], layerWarnings: string[] = [], signal?: AbortSignal, options?:{boundary?:ProjectBoundary;settings?:SpatialSettings;priority?:SpatialConfig["priority"];boundaryLayerId?:string;placeSearch?:SpatialConfig["placeSearch"]}): Promise<GeoResult> {
    const originalQuestion=input.question;
    const clarification=requestClarification(input.question,input.history??[],"",input.locale);
    input={...input,question:spatialConversationQuestion(input.question,input.history)};
    const plan = parseGeoPlan(input.question), context = parseGeoContext(input.context), locale = input.locale === 'en' ? 'en' : 'ko';
    const t = (key: string, values?: Record<string, string | number>) => translate(locale, key, values);
    const reference=options?.placeSearch;
    if(reference){
        const region=reference.regionName.split(/\s+/).at(-1)!;
        let query=plan.query.replace(reference.regionName,'').replace(reference.regionName.replace(/\s/g,''),'').replace(region,'').trim().replace(/^(?:사업구역|대상지)\s*(?:안|내|전체|에서|의)?\s*/,'').replace(/^(?:전체|안|내|에서|의)\s*/,'').trim();
        query=query.replace(/(?:가|이|은|는)?\s*몇\s*(?:개|곳).*/,'').trim();
        if(query)plan.query=query;
        if(genericCategoryCode(plan.query)){if(plan.intent==='PLACE_SEARCH')plan.intent='CATEGORY_SEARCH';if(plan.locations?.length===1){plan.locations=undefined;plan.intent='CATEGORY_SEARCH';}if(!plan.destination)plan.nearby=true;}
        if(plan.origin&&[region,reference.regionName].includes(plan.origin.trim()))plan.origin='사업구역';
    }
    if (context.selected && layers.some(layer=>layer.config.id===context.selected!.layerId&&layer.config.internalOnly)) delete context.selected;
    const boundary=options?.boundary,settings=spatialSettings(options?.settings);
    const scopeMeters=context.scopeMeters??settings.defaultNearbyMeters;
    const boundaryLayerId=options?.boundaryLayerId??(settings.activeBoundaryDatasetId?`uploaded-${settings.activeBoundaryDatasetId}`:undefined);
    let searchScopeLabel="";
    let origin: Place | undefined;
    const warnings = layerWarnings.map(w => t(w));
    if(options&&!boundary)warnings.push(t('boundary.noActive'));
    const result: GeoResult = { question: originalQuestion, intent: plan.intent, reply: '', places: [], warnings };
    const label = mapPointLabel(originalQuestion);
    if (label) {
        const selected = selectedPlace(context, layers);
        if (!selected) { result.reply = locale === 'ko' ? '지도에서 이름을 붙일 위치를 먼저 선택해주세요.' : 'Select the map point you want to name first.'; return result; }
        const named: Place = { id: 'map-point', name: label, coordinate: selected.coordinate, source: 'map' };
        result.origin = named; result.resolvedPlaces = [named];
        result.reply = locale === 'ko' ? `선택한 위치를 ‘${label}’로 기억해둘게요.` : `I'll use “${label}” for the selected point.`;
        return result;
    }
    if(clarification){result.reply=clarification;return result;}
    const regionName = reference?.regionName.split(/\s+/).at(-1);
    if (plan.projectArea && regionName && input.question.includes(regionName) && new RegExp(`${regionName}\\s*(?:전체|전역)`).test(input.question)) {
        result.reply = t('gis.scopeChoice', {region:regionName}); return result;
    }
    let tool = spatialToolRequest(input.question, input.history);
    const exploring = tool?.exploratory;
    const offerNext = followUpPolicy(input.question,input.history??[],"data").mode!=="none";
    let explorationTargets: LoadedLayer[] = [];
    const nearbyAvailable = !!boundary && !!process.env.KAKAO_REST_API_KEY;
    if (exploring) {
        const regions = layers.filter(layer => !layer.config.internalOnly && (boundaryLayerId ? layer.config.id === boundaryLayerId : layer.config.role === "boundary" || layer.config.datasetType === "project_boundary"));
        const role = /녹지|공원|green|park/i.test(input.question) ? "green" : /건물|건축|building/i.test(input.question) ? "buildings" : "facilities";
        const subjects = layers.filter(layer => layer.config.role === role || (role === "facilities" && layer.config.datasetType === "public_facilities"));
        if (regions.length === 1 && subjects.length === 1 && subjects[0] !== regions[0]) {
            explorationTargets = [subjects[0],regions[0]];
            tool = { operation: "overlay", reference: "", exploratory: true };
        } else if (nearbyAvailable && role !== "buildings" && !layers.some(layer => layer.config.id !== options?.placeSearch?.roadLayerId && layer.config.role !== "boundary" && layer.config.datasetType !== "project_boundary" && layer.data.features.length)) {
            // Reuse the existing bounded place lookup when there is only a boundary to work with.
            tool = undefined; plan.intent="NEARBY_SEARCH"; plan.query=role==="green"?"공원":"편의시설"; plan.nearby=true; plan.origin=/여기|이곳|이\s*장소|선택한|here|this place/i.test(input.question)?undefined:"사업구역"; plan.destination=undefined; plan.locations=undefined; result.intent=plan.intent;
        }
    }
    if (tool) {
        result.intent = "EXISTING_GIS_QUERY";
        const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
        const signals: Record<string, RegExp> = { boundary: /사업구역|사업\s*경계|대상지|project (?:area|boundary)/i, facilities: /공공시설|생활시설|주요\s*시설|facilities/i, buildings: /건물|건축물|buildings?/i, roads: /도로|roads?/i, green: /녹지|공원|green/i, parcels: /필지|parcels?/i };
        const match = (text: string) => {
            const exact = layers.filter(layer => [layer.config.label, layer.config.id].some(name => normalize(name).length > 1 && normalize(text).includes(normalize(name))));
            const generic = layers.filter(layer => signals[layer.config.role ?? layer.config.datasetType ?? ""]?.test(text) || (layer.config.datasetType === "public_facilities" && signals.facilities.test(text)));
            const candidates = [...new Map([...exact,...generic].filter(layer=>!layer.config.internalOnly).map(layer=>[layer.config.id,layer])).values()];
            return candidates.filter(layer => !(layer.config.role === "boundary" || layer.config.datasetType === "project_boundary") || exact.includes(layer) || !boundaryLayerId || layer.config.id === boundaryLayerId);
        };
        let targets = explorationTargets.length ? explorationTargets : match(input.question);
        const prior = match(tool.reference);
        if (!targets.length) targets = prior;
        else if (targets.length === 1 && prior.length === 1 && /나머지|other/i.test(tool.reference) && prior[0].config.id!==targets[0].config.id) targets=[prior[0],targets[0]];
        else if (targets.length === 1 && prior.length === 2 && prior.some(layer=>layer.config.id===targets[0].config.id)) targets = prior;
        const ask = (kind: "layers" | "shape" | "buffer") => {
            result.reply = kind === "layers" && targets.length === 1 ? t("gis.toolInput.other",{name:targets[0].config.label}) : t(`gis.toolInput.${kind === "buffer" ? "shape" : kind}`, { names: layers.slice(0,6).map(layer=>layer.config.label).join(", ") });
            return result;
        };
        if (tool.operation === "priority") {
            const priority = options?.priority;
            const layer = priority ? layers.find(layer=>layer.config.id===priority.layerId) : undefined;
            if (!priority || !layer) { result.reply=t("gis.toolInput.priority"); return result; }
            const scores = scorePriority(layer,priority.criteria);
            result.computedResult = { projectId,type:"priority",timestamp:new Date().toISOString(),layerIds:[layer.config.id],parameters:{criteria:JSON.stringify(priority.criteria)},metrics:{priorityCount:scores.length},priorities:scores.slice(0,20),notes:[t("spatial.priorityNote")] };
            result.resultGeometry = featureCollection(layer.data.features.filter(isArea));
            result.reply = t("gis.toolPriority",{count:scores.length})+"\n"+t("spatial.priorityNote");
        } else if (tool.operation === "overlay") {
            if (targets.length !== 2) return ask("layers");
            const [a,b] = targets;
            if (a.config.type === "polygon" && b.config.type === "polygon") {
                const shapes = intersectionAreas(a,b);
                result.computedResult = { projectId, type: "intersection", timestamp: new Date().toISOString(), layerIds: [a.config.id,b.config.id], parameters: { layerA:a.config.id,layerB:b.config.id }, metrics: { intersectionAreaSqm:overlayArea(shapes) }, notes: [t("spatial.overlayNote")] };
                result.resultGeometry = featureCollection(shapes);
                result.reply = t("gis.toolOverlay", { first:a.config.label,second:b.config.label,area:Math.round(result.computedResult.metrics.intersectionAreaSqm).toLocaleString() });
            } else {
                const region = targets.find(layer=>layer.config.type==="polygon");
                const objects = targets.find(layer=>layer!==region);
                if (!region || !objects || region.data.features.length*objects.data.features.length>100000) return ask("shape");
                const shapes = region.data.features.filter(isArea);
                if (!shapes.length) return ask("shape");
                // The same touches() predicate powers the existing area-statistics tool.
                const matched = objects.data.features.flatMap((feature,index)=>shapes.some(shape=>touches(feature,shape))?[{feature,index}]:[]);
                const shape = shapes.length === 1 ? shapes[0] : deriveBoundary(featureCollection(shapes)).geometry;
                result.computedResult = resultFor(projectId,"area",[objects],shape,{layerA:a.config.id,layerB:b.config.id});
                result.computedResult.layerIds = [a.config.id,b.config.id];
                result.computedResult.metrics.matchedCount = matched.length;
                result.places = matched.slice(0,20).map(({feature,index})=>({id:`${objects.config.id}:${featureKey(feature,index)}`,name:featureNames(feature)[0]??objects.config.label,source:"project",layerId:objects.config.id,featureId:featureKey(feature,index),...representativePoint(feature)}));
                result.resultGeometry = featureCollection(matched.slice(0,20).map(value=>value.feature));
                result.reply = t("gis.toolFeatureOverlap",{name:objects.config.label,region:region.config.label,count:matched.length,shown:result.places.length});
            }
        } else {
            const explorationRegion = exploring ? boundary?.geometry : undefined;
            const named = layers.flatMap(layer=>layer.data.features.flatMap((feature,index)=>featureNames(feature).some(name=>normalize(name).length>1&&normalize(input.question).includes(normalize(name)))?[{layer,feature,index}]:[]));
            const priorNamed = named.length ? named : layers.flatMap(layer=>layer.data.features.flatMap((feature,index)=>featureNames(feature).some(name=>normalize(name).length>1&&normalize(tool.reference).includes(normalize(name)))?[{layer,feature,index}]:[]));
            const eligible = priorNamed.filter(value=>!targets.length||targets.some(layer=>layer.config.id===value.layer.config.id));
            const explicitTarget = targets.length === 1 && targets[0].data.features.length === 1;
            const selected = !explorationRegion && !eligible.length && !explicitTarget ? selectedPlace(context,layers) : undefined;
            const selectedLayer = selected?.layerId ? layers.find(layer=>layer.config.id===selected.layerId) : undefined;
            const selectedFeature = selectedLayer?.data.features.find((feature,index)=>featureKey(feature,index)===selected?.featureId);
            const targetInfo = eligible.length === 1 ? eligible[0] : eligible.length ? undefined
                : targets.length === 1 && targets[0].data.features.length === 1 ? {layer:targets[0],feature:targets[0].data.features[0],index:0}
                : selectedFeature && selectedLayer && (!targets.length||targets.includes(selectedLayer)) ? {layer:selectedLayer,feature:selectedFeature,index:selectedLayer.data.features.indexOf(selectedFeature)} : undefined;
            const target = explorationRegion ?? targetInfo?.feature ?? (tool.operation === "buffer" && selected?.source === "map" ? point(selected.coordinate) : undefined);
            if (tool.operation === "buffer") {
                const radius = input.question.match(/(\d+(?:\.\d+)?)\s*(km|m|미터|킬로미터)/i) ?? tool.reference.match(/(\d+(?:\.\d+)?)\s*(km|m|미터|킬로미터)/i);
                if (target && !radius) { result.reply=t("gis.toolInput.distance",{name:featureNames(target)[0]??selectedLayer?.config.label??t("gis.selectedPoint")}); return result; }
                if (!target && radius) { result.reply=t("gis.toolInput.target",{distance:Number(radius[1])*(/km|킬로/.test(radius[2])?1000:1)}); return result; }
                if (!target || !radius) return ask("buffer");
                const meters = Number(radius[1])*(/km|킬로/.test(radius[2])?1000:1);
                const shape = createBuffer(target,meters);
                result.computedResult = resultFor(projectId,"buffer",layers,shape,{distanceMeters:meters,...(targetInfo?{selectedLayerId:targetInfo.layer.config.id,selectedFeatureId:featureKey(targetInfo.feature,targetInfo.index)}:{selectedPoint:JSON.stringify(selected!.coordinate)})});
                result.resultGeometry = featureCollection([shape]);
                result.reply = t("gis.toolBuffer",{distance:meters,area:Math.round(result.computedResult.metrics.areaSqm).toLocaleString()});
            } else {
                if ((target && !isArea(target)) || (!target && targets.length>1)) return ask("shape");
                const shape = target && isArea(target) ? target : boundary?.geometry;
                if (!shape) return ask("shape");
                result.computedResult = resultFor(projectId,"area",layers,shape,!explorationRegion&&targetInfo?{selectedLayerId:targetInfo.layer.config.id,selectedFeatureId:featureKey(targetInfo.feature,targetInfo.index)}:{});
                result.resultGeometry = featureCollection([shape]);
                result.reply = t("boundary.area",{area:Math.round(result.computedResult.metrics.areaSqm).toLocaleString()});
                if(result.computedResult.metrics.facilityCount!==undefined)result.reply+=" "+t("boundary.facilitySummary",{count:result.computedResult.metrics.facilityCount});
            }
        }
        if (exploring) {
            const start = explorationTargets.length ? t("gis.exploreStart", { first: explorationTargets[0].config.label, second: explorationTargets[1].config.label }) : t("gis.exploreArea");
            const matched = result.computedResult?.metrics.matchedCount;
            const facts = matched !== undefined ? result.places.length ? t("gis.exploreFound", { count: matched, names: result.places.slice(0,3).map(place=>place.name).join(", ") }) : t("gis.exploreNone") : result.reply;
            result.reply = start+"\n"+facts;
            if (result.places.length) result.reply += "\n"+t("gis.exploreMeaning");
            result.reply += "\n"+t("gis.exploreLimit");
            if (result.places.length && offerNext) result.reply += "\n"+t("gis.exploreNext");
            else if (!result.places.length && nearbyAvailable && offerNext) result.reply += "\n"+t("gis.exploreNearbyNext");
        }
        return result;
    }
    const followUp = placeResultFollowUp(input.question);
    if (followUp === "search-comparison") {
        const snapshots=Array.isArray(input.recentSearches)&&input.recentSearches.length===2?input.recentSearches.map(value=>verifiedSearch(value,user,projectId)):[];
        const [first,second]=snapshots;
        if(!first||!second){result.reply=t("gis.compareSearchesMissing");return result;}
        result.places=second.places;
        result.scopeMeters=second.scopeMeters;
        result.searchQuery=second.searchQuery;
        result.categoryCode=second.categoryCode;
        result.reply=t("gis.compareSearchCandidates",{first:first.searchQuery.slice(0,80),firstCount:first.places.length,second:second.searchQuery.slice(0,80),secondCount:second.places.length});
        return result;
    }
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
    origin = plan.origin ? undefined : defaultOrigin(context, options ? layers.filter(l=>l.config.role!=='boundary') : layers);
    if(!plan.origin&&!context.selected&&!context.point&&boundary)origin={id:'project-center',name:'gis.projectCenter',source:'project',coordinate:boundary.center,approximate:true};
    const regionToken = reference?.regionName.split(/\s+/).at(-1);
    const administrativeLayer = reference && regionToken && !plan.projectArea && input.question.replace(/\s/g,'').includes(regionToken.replace(/\s/g,'')) && !reference.roadNames.some(name=>input.question.includes(name)) ? layers.find(layer=>layer.config.internalOnly&&layer.config.role==='boundary') : undefined;
    const administrativeBoundary = administrativeLayer ? deriveBoundary(boundaryGeoJSON(administrativeLayer.data)) : undefined;
    let remainingCalls = 16;
    const external = async (query: string, resolvingOrigin = false) => {
        if (!boundary) { if (!warnings.includes(t('picker.needBoundary'))) warnings.push(t('picker.needBoundary')); return []; }
        const explicitRadius = /\d+(?:\.\d+)?\s*(?:m|km|미터|킬로미터)/i.test(input.question);
        const reference=options?.placeSearch;
        if(reference){
            const normalize=(value:string)=>value.replace(/\s/g,'').replace(/번길/g,'길');
            const regionToken=reference.regionName.split(/\s+/).at(-1)!;
            const namedRoad=plan.origin?reference.roadNames.find(name=>normalize(name)===normalize(plan.origin!)):undefined;
            const wholeRegion=(plan.projectArea&&!explicitRadius)||context.scopeMeters===0||/사업구역\s*(?:안|내|전체)|(?:entire|whole) project/i.test(input.question)||(normalize(input.question).includes(normalize(regionToken))&&(!reference.roadNames.some(name=>normalize(input.question).includes(normalize(name)))||/전체/.test(input.question)));
            const explicitOrigin=!!context.point || !!context.selected || !!plan.origin&&!namedRoad&&!isProjectStreetReference(plan.origin)&&!/^(?:사업구역|대상지)$/.test(plan.origin);
            const useRoads=!!(namedRoad || plan.origin && isProjectStreetReference(plan.origin))&&!plan.projectArea&&!resolvingOrigin&&!wholeRegion&&!explicitOrigin;
            const radius=explicitRadius?Math.min(2000,plan.radius):context.scopeMeters||reference.radiusMeters;
            const roads=layers.find(layer=>layer.config.id===reference.roadLayerId);
            if(useRoads&&!roads)throw new Error('gis.referenceUnavailable');
            const roadData=namedRoad&&roads?{...roads.data,features:roads.data.features.filter(feature=>featureNames(feature).some(name=>normalize(name)===normalize(namedRoad)))}:roads?.data;
            const geometry=administrativeBoundary ? administrativeBoundary.geometry : plan.projectArea&&explicitRadius ? boundaryScope(boundary,Math.min(2000,plan.radius)) : useRoads?roadSearchScope(boundary,roadData!,radius):boundary.geometry;
            const found=await searchBoundaryPlaces(query,geometry,signal,Math.min(6,remainingCalls));remainingCalls-=found.calls;
            result.scopeMeters=plan.projectArea&&explicitRadius ? Math.min(2000,plan.radius) : useRoads?radius:0;
            searchScopeLabel=plan.projectArea&&explicitRadius ? t("gis.searchScope",{meters:Math.min(2000,plan.radius)}) : useRoads ? t("gis.referenceRoadScope",{region:reference.regionName,roads:(namedRoad?[namedRoad]:reference.roadNames).join('·'),meters:radius}) : administrativeBoundary ? t("gis.referenceRegionScope",{region:reference.regionName}) : t("boundary.scope.0");
            if(!warnings.includes(t('boundary.partialSearch')))warnings.push(t('boundary.partialSearch'));
            let places=found.places;
            if(!resolvingOrigin&&plan.nearby&&origin&&!origin.boundaryTarget&&explicitOrigin)places=places.filter(p=>calculateStraightLineDistance(origin!.coordinate,p.coordinate)<=plan.radius);
            return places;
        }
        const distances = plan.projectArea && !explicitRadius || context.scopeMeters === 0 ? [0] : explicitRadius && plan.nearby && origin?.boundaryTarget ? [Math.min(2000, plan.radius)] : [...new Set([0, scopeMeters, 1000, 2000])].sort((a,b) => a-b);
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
        let streetOptions: Place[] | undefined;
        if(reference){
            const roadLayer=layers.find(layer=>layer.config.id===reference.roadLayerId);
            const roads=roadLayer?internalPlaces(name,[roadLayer],featureKey):[];
            if(roads.length===1)return roads[0];
        }
        if(isProjectStreetReference(name)) {
            const correctedName=projectStreetCorrection(originalQuestion);
            streetOptions=correctedName?internalPlaces(correctedName,layers,featureKey):[];
            const roadLayers=layers.filter(layer=>layer.config.role==='roads'||layer.config.datasetType==='roads');
            if(!streetOptions.length&&context.selected&&roadLayers.some(layer=>layer.config.id===context.selected!.layerId)){
                const selected=selectedPlace(context,layers);if(selected)streetOptions=[selected];
            }
            if(!streetOptions.length){
                const roads=roadLayers.flatMap(layer=>layer.data.features.map((feature,index)=>({id:`${layer.config.id}:${featureKey(feature,index)}`,name:featureNames(feature)[0]??layer.config.label,source:'project' as const,layerId:layer.config.id,featureId:featureKey(feature,index),...representativePoint(feature)})));
                if(roads.length===1)streetOptions=roads;
            }
            if(!streetOptions.length&&boundary){
                if(!reference)warnings.push(t('gis.projectStreetScope'));
                return {id:'project-boundary',name:t('upload.boundary'),source:'project' as const,coordinate:boundary.center,approximate:true,boundaryTarget:true};
            }
            if(!streetOptions.length&&!boundary){result.reply=t('picker.needBoundary');return;}
        }
        if ((isProjectAreaReference(name) || /^(?:이\s*)?(?:사업\s*경계|대상지)$/i.test(name)) && boundary)
            return { id: 'project-boundary', name: t('upload.boundary'), source: 'project' as const, coordinate: boundary.center, approximate: true, boundaryTarget: true };
        const binding = scope(user.uid, projectId, input.question, name);
        const token = input.choices && Object.prototype.hasOwnProperty.call(input.choices, name) ? input.choices[name] : undefined;
        let selected: Place | undefined;
        if (token?.startsWith('project:'))
            selected = (streetOptions ?? await resolvePlaceReference(name, context, layers)).find(p => 'project:' + p.id === token);
        else
            selected = verifyChoice(token, binding);
        if (selected?.source === 'kakao' && (!boundary || !filterBoundaryPlaces([selected], administrativeBoundary?.geometry ?? boundaryScope(boundary, context.scopeMeters === 0 ? 0 : 2000)).length)) throw new Error('gis.choiceExpired');
        if (selected)
            return selected;
        if (token)
            throw new Error('gis.choiceExpired');
        const options = groupPlaceCandidates(streetOptions ?? await resolvePlaceReference(name, context, layers, query=>external(query,role==='origin')), input.question);
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
        const layer=feature?selected:layers.find(l=>l.config.id===boundaryLayerId);
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
        const projectSearchArea = administrativeBoundary?.geometry ?? (boundary && options?.placeSearch ? plan.projectArea&&requestedRadius ? boundaryScope(boundary,Math.min(2000,plan.radius)) : boundary.geometry : boundary && origin?.boundaryTarget ? boundaryScope(boundary, requestedRadius ? Math.min(2000, plan.radius) : scopeMeters) : undefined);
        const internal = internalPlaces(plan.query, layers, featureKey).filter(p => projectSearchArea ? filterBoundaryPlaces([p], projectSearchArea).length > 0 : !origin || (!plan.origin && !requestedRadius) || calculateStraightLineDistance(origin.coordinate,p.coordinate) <= plan.radius);
        const candidates = groupPlaceCandidates((genericCategoryCode(plan.query) ? await external(plan.query) : internal.length ? internal : await external(plan.query)), input.question).map(p => ({...p,distanceMeters:origin?calculateStraightLineDistance(origin.coordinate,p.coordinate):undefined})).sort((a,b)=>(a.distanceMeters??0)-(b.distanceMeters??0));
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
    result.searchQuery=plan.query;
    result.categoryCode=genericCategoryCode(plan.query);
    result.reply = result.places.length ? t('gis.searchSummary', { count: result.places.length }) : !boundary ? t('picker.needBoundary') : t('gis.noSearchCandidates', { name: plan.query });
    if (result.places.length) {
        result.reply += "\n"+result.places.map(place => `${place.name}${place.address ? ` · ${place.address}` : ""}`).join("\n");
        if (result.scopeMeters !== undefined) result.reply += "\n"+(searchScopeLabel || (result.scopeMeters === 0 ? t("boundary.scope.0") : t("gis.searchScope", { meters: result.scopeMeters })));
        if (result.places.some(place => place.source === "kakao")) result.reply += "\n"+t("gis.poiExploration");
    }
    if(warnings.includes(t('gis.projectStreetScope')))result.reply+='\n'+t('gis.projectStreetScope');
    if (exploring) {
        result.reply=t("gis.explorePlaces")+"\n"+result.reply;
        if(result.places.length&&offerNext)result.reply+="\n"+t("gis.exploreNext");
    }
    if (result.ranking)
        result.reply += ' ' + t(result.ranking === 'walking' ? 'gis.rankWalking' : 'gis.rankStraight');
    if (origin?.approximate)
        warnings.push(t('gis.approximate'));
    return result;
}
