import { coordinate, calculateStraightLineDistance, genericCategoryCode, type Coordinate, type Place, type GeoResult } from './geo-query';
export class KakaoError extends Error {
    constructor(public code: string, public status = 503) { super(code); }
}
const BASE = 'https://dapi.kakao.com';
// No persistent third-party response cache. Authorization always remains server-side.
async function request(path: string, parameters: Record<string, string | number>, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    const key = process.env.KAKAO_REST_API_KEY;
    if (!key)
        throw new KakaoError('gis.restMissing');
    let response: Response;
    try {
        response = await fetch(`${BASE}${path}?${new URLSearchParams(Object.entries(parameters).map(([k, v]) => [k, String(v)]))}`, { headers: { Authorization: `KakaoAK ${key}` }, cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) });
    }
    catch {
        throw new KakaoError('gis.network');
    }
    if (!response.ok)
        throw new KakaoError(response.status === 401 || response.status === 403 ? 'gis.authorization' : response.status === 429 ? 'gis.quota' : 'gis.network', response.status === 429 ? 429 : 503);
    try {
        return await response.json();
    }
    catch {
        throw new KakaoError('gis.invalidResponse');
    }
}
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === 'string' ? v.slice(0, 500) : undefined;
export function normalizePlaces(payload: unknown): Place[] {
    const documents = record(payload).documents;
    if (!Array.isArray(documents))
        throw new KakaoError('gis.invalidResponse');
    const result: Place[] = [];
    for (const doc of documents.slice(0, 15)) {
        const p = record(doc);
        if (!text(p.id) || !text(p.place_name) || ![p.x,p.y].every(v => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '')))
            continue;
        try {
            const url = text(p.place_url);
            const distance = p.distance === '' || p.distance == null ? undefined : Number(p.distance);
            result.push({ id: String(p.id), name: String(p.place_name), source: 'kakao', approximate: true, coordinate: coordinate([Number(p.x), Number(p.y)]), ...(text(p.category_name) ? { category: text(p.category_name) } : {}), ...(text(p.address_name) ? { address: text(p.address_name) } : {}), ...(text(p.road_address_name) ? { roadAddress: text(p.road_address_name) } : {}), ...(url && /^https?:\/\/(?:place|map)\.kakao\.com\//.test(url) ? { url } : {}), ...(Number.isFinite(distance) && distance! >= 0 ? { distanceMeters: distance } : {}) });
        }
        catch { /* Invalid vendor records are never promoted to evidence. */ }
    }
    return result;
}
export async function searchPlaces(query: string, context: {
    center?: Coordinate;
    radius?: number;
    category?: string;
    limit?: number;
    signal?: AbortSignal;
} = {}): Promise<Place[]> {
    if (!query.trim() || query.length > 200)
        throw new KakaoError('gis.invalidQuestion', 400);
    const center = context.center ? coordinate(context.center) : undefined;
    if (context.radius !== undefined && (!center || !Number.isFinite(context.radius) || context.radius < 1 || context.radius > 20000))
        throw new KakaoError('gis.invalidRadius', 400);
    const category = context.category;
    if (category && !/^(MT1|CS2|SC4|CE7|FD6|PM9|HP8|PO3|CT1|PK6)$/.test(category))
        throw new KakaoError('gis.invalidQuestion', 400);
    const params: Record<string, string | number> = { size: Math.min(15, Math.max(1, context.limit ?? 10)), ...(center ? { x: center[0], y: center[1], sort: 'distance' } : { sort: 'accuracy' }), ...(context.radius ? { radius: Math.round(context.radius) } : {}), ...(category ? { category_group_code: category } : { query: query.trim() }) };
    return normalizePlaces(await request(`/v2/local/search/${category ? 'category' : 'keyword'}.json`, params, context.signal));
}
export async function searchNearbyPlaces(query: string, center: Coordinate, radius: number, signal?: AbortSignal) {
    let places = await searchPlaces(query, { center, radius, category: genericCategoryCode(query), signal, limit: 15 });
    let expanded = false;
    if (!places.length && radius < 20000) {
        places = await searchPlaces(query, { center, radius: Math.min(20000, radius * 3), category: genericCategoryCode(query), signal, limit: 15 });
        expanded = true;
    }
    return { places, expanded };
}
export function parseWalkingRoute(payload: unknown): NonNullable<GeoResult['route']> {
    const data = record(payload);
    if (data.status !== 'OK')
        throw new KakaoError(data.status === 'SAME_POINT' ? 'gis.samePoint' : 'gis.noRoute');
    const route = record(data.route), properties = record(route.properties), legs = route.legs;
    if (typeof properties.totalDistance !== 'number' || !Number.isFinite(properties.totalDistance) || properties.totalDistance < 0 || typeof properties.totalTime !== 'number' || !Number.isFinite(properties.totalTime) || properties.totalTime < 0 || !Array.isArray(legs))
        throw new KakaoError('gis.invalidResponse');
    const coordinates: Coordinate[] = [];
    for (const leg of legs) {
        const steps = record(leg).steps;
        if (!Array.isArray(steps))
            throw new KakaoError('gis.invalidResponse');
        for (const step of steps) {
            const points = record(record(step).path).points;
            if (!Array.isArray(points))
                throw new KakaoError('gis.invalidResponse');
            for (const p of points) {
                const c = coordinate(p);
                if (!coordinates.length || coordinates.at(-1)![0] !== c[0] || coordinates.at(-1)![1] !== c[1])
                    coordinates.push(c);
                if (coordinates.length > 50000)
                    throw new KakaoError('gis.invalidResponse');
            }
        }
    }
    if (coordinates.length < 2)
        throw new KakaoError('gis.invalidResponse');
    return { coordinates, distanceMeters: properties.totalDistance, durationSeconds: properties.totalTime, source: 'Kakao Walking Route' };
}
export async function getWalkingRoute(origin: Coordinate, destination: Coordinate, signal?: AbortSignal) {
    coordinate(origin);
    coordinate(destination);
    if (calculateStraightLineDistance(origin, destination) < 1)
        throw new KakaoError('gis.samePoint', 400);
    return parseWalkingRoute(await request('/v2/routing/walk', { start_x: origin[0], start_y: origin[1], end_x: destination[0], end_y: destination[1], input_coord: 'WGS84', output_coord: 'WGS84', route_mode: 'BROAD_FIRST' }, signal));
}
export async function findNearestPlaces(query: string, origin: Place, radius: number, limit: number, walking: boolean, signal?: AbortSignal) {
    const nearby = await searchNearbyPlaces(query, origin.coordinate, radius, signal);
    const candidates = nearby.places.map(p => ({ ...p, distanceMeters: calculateStraightLineDistance(origin.coordinate, p.coordinate) })).sort((a, b) => a.distanceMeters - b.distanceMeters);
    if (!walking)
        return { ...nearby, places: candidates.slice(0, limit), routes: [], routeErrors: [], partial: false };
    // At most three route calls per user operation. Never call a radius a network service area.
    const checked = await Promise.allSettled(candidates.slice(0, 3).map(async (p) => ({ place: p, route: await getWalkingRoute(origin.coordinate, p.coordinate, signal) })));
    const routes = checked.flatMap(r => r.status === 'fulfilled' ? [r.value] : []).sort((a, b) => a.route.distanceMeters - b.route.distanceMeters);
    const routeErrors = [...new Set(checked.flatMap(r => r.status === 'rejected' ? [r.reason instanceof Error && r.reason.message.startsWith('gis.') ? r.reason.message : 'gis.noRoute'] : []))];
    return { ...nearby, routeErrors, places: routes.length ? routes.map(r => ({ ...r.place, distanceMeters: r.route.distanceMeters })).slice(0, limit) : candidates.slice(0, limit), routes, partial: candidates.length > 3 || routes.length < candidates.length };
}

// Kakao accepts rectangles, never arbitrary polygons. Always filter actual returned coordinates.
export async function searchBoundaryPlaces(query:string,geometry:import('./boundary').BoundaryFeature,signal?:AbortSignal){
  const {searchWindows,filterBoundaryPlaces}=await import('./boundary');
  const windows=searchWindows(geometry),found=new Map<string,Place>();
  const queries=/^(?:편의시설|생활시설|시설|amenities)$/i.test(query)?['편의점','약국','병원','카페','주민센터']:[query];
  const pending=queries.flatMap(query=>windows.map(rect=>({rect,page:1,query})));let calls=0;
  while(pending.length&&calls<6){
    const {rect,page,query:term}=pending.shift()!;signal?.throwIfAborted();
    const category=genericCategoryCode(term),params:Record<string,string|number>={size:15,page,rect:rect.join(','),x:(rect[0]+rect[2])/2,y:(rect[1]+rect[3])/2,sort:'distance',...(category?{category_group_code:category}:{query:term})};
    const payload=await request(`/v2/local/search/${category?'category':'keyword'}.json`,params,signal);calls++;
    const places=normalizePlaces(payload);for(const p of filterBoundaryPlaces(places,geometry))found.set(p.id,p);
    if(record(record(payload).meta).is_end===false&&page<3)pending.push({rect,page:page+1,query:term});
  }
  return {places:[...found.values()],partial:true}; // Bounded candidates; never a census.
}
