import { centroid, pointOnFeature, distance, point, booleanPointInPolygon } from '@turf/turf';
import type { Feature, Geometry } from 'geojson';
import type { LoadedLayer } from './types';
export type Coordinate = [
    number,
    number
]; // WGS84 longitude, latitude everywhere except SDK LatLng.
export type Place = {
    id: string;
    name: string;
    coordinate: Coordinate;
    source: 'project' | 'kakao' | 'map';
    category?: string;
    address?: string;
    roadAddress?: string;
    url?: string;
    approximate?: boolean;
    distanceMeters?: number;
    layerId?: string;
    featureId?: string;
    choiceToken?: string;
};
export type GeoContext = {
    selected?: {
        layerId: string;
        featureId: string;
    };
    point?: Coordinate;
    mapCenter?: Coordinate;
};
export type GeoIntent = 'PLACE_SEARCH' | 'CATEGORY_SEARCH' | 'NEARBY_SEARCH' | 'STRAIGHT_DISTANCE' | 'WALKING_ROUTE' | 'NEAREST_PLACE' | 'RADIUS_SEARCH' | 'EXISTING_GIS_QUERY';
export type GeoPlan = {
    intent: GeoIntent;
    query: string;
    origin?: string;
    destination?: string;
    radius: number;
    limit: number;
    walking: boolean;
    minutes?: number;
    nearby: boolean;
};
export type GeoResult = {
    question: string;
    intent: GeoIntent;
    reply: string;
    places: Place[];
    origin?: Place;
    destination?: Place;
    route?: {
        coordinates: Coordinate[];
        distanceMeters: number;
        durationSeconds: number;
        source: 'Kakao Walking Route';
    };
    straightDistanceMeters?: number;
    radiusMeters?: number;
    clarify?: {
        reference: string;
        role: 'origin' | 'destination';
        options: Place[];
    };
    warnings: string[];
    ranking?: 'straight' | 'walking';
    partial?: boolean;
};
export function coordinate(value: unknown): Coordinate {
    if (!Array.isArray(value) || value.length !== 2 || value.some(v => typeof v !== 'number' || !Number.isFinite(v)) || Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90)
        throw new Error('gis.invalidCoordinate');
    return [value[0], value[1]];
}
export function parseGeoContext(input: unknown): GeoContext {
    if (input === undefined)
        return {};
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new Error('gis.invalidCoordinate');
    const v = input as GeoContext;
    const result: GeoContext = {};
    if (v.selected) {
        if (typeof v.selected.layerId !== 'string' || !/^[\w-]{1,160}$/.test(v.selected.layerId) || typeof v.selected.featureId !== 'string' || v.selected.featureId.length > 150)
            throw new Error('gis.invalidCoordinate');
        result.selected = { layerId: v.selected.layerId, featureId: v.selected.featureId };
    }
    if (v.point)
        result.point = coordinate(v.point);
    if (v.mapCenter)
        result.mapCenter = coordinate(v.mapCenter);
    return result;
}
export const categories: [
    RegExp,
    string
][] = [[/카페|커피|\bcaf[eé]s?\b|coffee/i, 'CE7'], [/약국|pharmac/i, 'PM9'], [/병원|의원|hospital|clinic/i, 'HP8'], [/편의점|convenience/i, 'CS2'], [/마트|슈퍼|grocery|supermarket/i, 'MT1'], [/음식점|식당|restaurant/i, 'FD6'], [/학교|school/i, 'SC4'], [/주민센터|공공기관|public office/i, 'PO3'], [/문화시설|cultural/i, 'CT1'], [/주차장|parking/i, 'PK6']];
export function categoryCode(query: string) { return categories.find(([pattern]) => pattern.test(query))?.[1]; }
export function genericCategoryCode(query: string) {
    return /^(?:카페|커피|약국|병원|의원|편의점|마트|슈퍼|슈퍼마켓|음식점|식당|학교|주민센터|공공기관|문화시설|주차장|caf[eé]s?|coffee|pharmac(?:y|ies)|hospitals?|clinics?|restaurants?|supermarkets?|schools?|convenience stores?|parking)$/i.test(query.trim()) ? categoryCode(query) : undefined;
}
const reference = /^(?:지금\s*)?(여기|거기|이곳|이\s*건물|이\s*필지|선택한.*|선택된.*|현재\s*(지도\s*)?중심|here|this (building|parcel)|selected.*|map center)$/i;
export const isMapReference = (name: string) => reference.test(name.trim());
function clean(text: string) { return text.trim().replace(/[?.!]+$/g, '').replace(/(?:은|는|이|가)?\s*어디(?:야|인가요|에\s*있(?:어|나요))$/,'').replace(/(?:을|를)?\s*(?:찾아(?:줘|주세요)?|검색(?:해줘|해주세요)?|알려(?:줘|주세요)?|보여(?:줘|주세요)?|어디(?:야|인가요)?|있(?:어|나요)|있을까|search|find|show)(?:[?.!\s]*)$/i, '').trim(); }
export function parseGeoPlan(question: string): GeoPlan {
    if (typeof question !== 'string' || !question.trim() || question.length > 1000)
        throw new Error('gis.invalidQuestion');
    const q = question.trim();
    const route = q.match(/^(.+?)(?:에서|부터)\s*(.+?)(?:까지|(?:으)?로(?=\s|$))\s*(.*)$/);
    const englishRoute = q.match(/(?:from)\s+(.+?)\s+to\s+(.+?)(?:\?|$)/i);
    const walking = /도보|걸어|걸리|걸려|몇\s*분|walking|\bwalk\b/i.test(q);
    const minutes = q.match(/(\d+)\s*(?:분|min)/i);
    const meters = q.match(/(\d+(?:\.\d+)?)\s*(km|킬로미터|m|미터)(?!\w)/i);
    const radius = meters ? Number(meters[1]) * (/km|킬로/i.test(meters[2]) ? 1000 : 1) : 1000;
    if (radius < 1 || radius > 20000 || (minutes && (Number(minutes[1]) < 1 || Number(minutes[1]) > 180)))
        throw new Error('gis.invalidRadius');
    const limit = Math.min(10, Math.max(1, Number(q.match(/(\d+)\s*(?:개|곳|곳을|places)/i)?.[1] ?? 5)));
    let intent: GeoIntent = 'PLACE_SEARCH';
    let origin: string | undefined;
    let destination: string | undefined;
    const proximity = q.match(/^(.+?)(?:에서|주변(?:에|의)?|근처(?:에|의)?)\s*(.*)$/);
    if (route || englishRoute) {
        origin = clean((route ?? englishRoute)![1]);
        destination = clean((route ?? englishRoute)![2]);
        intent = walking ? 'WALKING_ROUTE' : 'STRAIGHT_DISTANCE';
    }
    else if (walking && minutes) {
        origin = clean(q.split(/에서|주변|도보/)[0]);
        intent = 'RADIUS_SEARCH';
    }
    else if (/가장\s*가까|nearest|closest/i.test(q)) {
        intent = 'NEAREST_PLACE';
    }
    else if (meters && /이내|반경|within/i.test(q))
        intent = 'RADIUS_SEARCH';
    else if (/주변|근처|nearby|near\b/i.test(q))
        intent = 'NEARBY_SEARCH';
    else if (categoryCode(q))
        intent = 'CATEGORY_SEARCH';
    else if (/면적|도로\s*폭|토지\s*이용|건물\s*수|인구|통계|area|population|land use/i.test(q))
        intent = 'EXISTING_GIS_QUERY';
    if (!origin && /this (?:building|parcel)/i.test(q)) origin = q.match(/this (?:building|parcel)/i)![0];
    if (!origin && proximity && !/^(근처|주변)$/.test(proximity[1]))
        origin = clean(proximity[1]);
    let query = clean(destination ?? (proximity?.[2] || q));
    query = query.replace(/(?:가장\s*가까운|가까운|선택한\s*(?:필지|건물)|지금\s*선택한\s*건물|이\s*필지|이\s*건물|여기서|여기|주변|근처|반경|이내|시설을|몇\s*미터야|얼마나\s*걸려|nearby|nearest|closest|within|from here|this building)/gi, ' ').replace(/\d+(?:\.\d+)?\s*(?:km|m|미터|개|곳|분)/gi, ' ').replace(/^\s*(?:에서|에|서)\s+/, '').replace(/^(카페|커피|약국|병원|학교|편의점|음식점|식당|마트|시설)(?:은|는|이|가|을|를)$/, '$1').replace(/\s+/g, ' ').trim();
    query = query.replace(/^(?:where is|what is|show|find|search(?: for)?)\s+/i, '').replace(/\b(?:the|of|to|from|a)\b/gi, ' ').replace(/this (?:building|parcel)/gi, '').replace(/(?:걸어서|도보로?|걸어)/g,'').replace(/\s+/g,' ').trim();
    if (!query && !destination)
        query = '편의시설';
    if (intent === 'CATEGORY_SEARCH' && !genericCategoryCode(query))
        intent = 'PLACE_SEARCH';
    return { intent, query, ...(origin ? { origin } : {}), ...(destination ? { destination } : {}), radius, limit, walking, ...(minutes ? { minutes: Number(minutes[1]) } : {}), nearby: ['NEAREST_PLACE', 'RADIUS_SEARCH', 'NEARBY_SEARCH', 'CATEGORY_SEARCH'].includes(intent) };
}
export function isGeoQuestion(question: string) {
    return /어디(?:야|인가요|에\s*있)|\b(?:find|search|where is)\b|(?:검색|찾아)(?:해)?(?:줘|주세요)|주변|근처|카페|약국|마트|음식점|식당|편의점|병원|학교|버스\s*정류장|공원|도보|걸어|몇\s*미터|가장\s*가까|지도\s*중심|까지.*거리|에서.*까지|nearby|nearest|walking|\bfrom\b.*\bto\b|\b(cafe|pharmacy|restaurant|supermarket)\b/i.test(question);
}
export function calculateStraightLineDistance(origin: Coordinate, destination: Coordinate) { return distance(point(coordinate(origin)), point(coordinate(destination)), { units: 'meters' }); }
export function representativePoint(feature: Feature<Geometry>): {
    coordinate: Coordinate;
    approximate: boolean;
} {
    const p = feature.properties ?? {};
    for (const keys of [['entrance_lng', 'entrance_lat'], ['entrance_lon', 'entrance_lat']]) {
        if ([p[keys[0]],p[keys[1]]].every(v => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== ''))) {
            try {
                return { coordinate: coordinate([Number(p[keys[0]]), Number(p[keys[1]])]), approximate: false };
            }
            catch { /* Ignore malformed entrance attributes. */ }
        }
    }
    if (feature.geometry.type === 'Point')
        return { coordinate: coordinate(feature.geometry.coordinates.slice(0,2)), approximate: false };
    let candidate = centroid(feature);
    if ((feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') && !booleanPointInPolygon(candidate, feature as Feature<import('geojson').Polygon | import('geojson').MultiPolygon>))
        candidate = pointOnFeature(feature);
    return { coordinate: coordinate(candidate.geometry.coordinates.slice(0,2)), approximate: true };
}
export function featureNames(feature: Feature<Geometry>): string[] {
    const p = feature.properties ?? {};
    const names: string[] = [];
    for (const key of ['name', 'title', 'label', '시설명', '건물명', '명칭', 'aliases', 'alias', '별칭']) {
        const value = p[key];
        for (const name of Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,;|]/) : [])
            if (typeof name === 'string' && name.trim())
                names.push(name.trim().slice(0, 200));
    }
    if (names.some(n => /회복의\s*숲\s*타워|Recovery Forest Tower/i.test(n)))
        names.push('타워', '기존 경로당', '경로당');
    if (names.some(n => /회복의\s*숲\s*전파기지|Recovery Forest Transmission Station/i.test(n)))
        names.push('전파기지', '기존 건강생활지원센터');
    return [...new Set(names)];
}
export function internalPlaces(name: string, layers: LoadedLayer[], keyFor: (f: Feature<Geometry>, i: number) => string): Place[] {
    const normalized = (v: string) => v.replace(/\s/g, '').toLocaleLowerCase();
    const exact: Place[] = [];
    const partial: Place[] = [];
    for (const layer of layers)
        layer.data.features.forEach((f, i) => {
            const names = featureNames(f);
            if (!names.length)
                return;
            const place: Place = { id: `${layer.config.id}:${keyFor(f, i)}`, name: names[0], source: 'project', layerId: layer.config.id, featureId: keyFor(f, i), ...representativePoint(f), category: layer.config.label };
            if (names.some(n => normalized(n) === normalized(name)))
                exact.push(place);
            else if (name.length > 1 && names.some(n => normalized(n).includes(normalized(name))))
                partial.push(place);
        });
    return (exact.length ? exact : partial).slice(0, 10);
}
