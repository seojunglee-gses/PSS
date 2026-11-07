import { centroid, pointOnFeature, distance, point, booleanPointInPolygon } from '@turf/turf';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
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
    categoryCode?: KakaoCategoryCode;
    address?: string;
    roadAddress?: string;
    url?: string;
    approximate?: boolean;
    distanceMeters?: number;
    layerId?: string;
    featureId?: string;
    choiceToken?: string;
    boundaryTarget?: boolean;
    insideBoundary?: boolean;
    boundaryDistanceMeters?: number;
};
export type GeoContext = {
    scopeMeters?: 0 | 500 | 1000;
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
    locations?: string[];
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
        role: 'origin' | 'destination' | 'place';
        options: Place[];
    };
    warnings: string[];
    ranking?: 'straight' | 'walking';
    partial?: boolean;
    scopeMeters?: number;
    facilitationQuestion?:string;
    computedResult?: import("./types").SpatialResult;
    resultGeometry?: FeatureCollection;
    searchQuery?: string;
    categoryCode?: KakaoCategoryCode;
    searchToken?: string;
    resolvedPlaces?: Place[];
};
export type PlaceSearchSnapshot = { question: string; searchQuery: string; categoryCode?: KakaoCategoryCode; scopeMeters?: number; places: Place[]; searchToken: string };
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
    if(v.scopeMeters!==undefined){if(![0,500,1000].includes(v.scopeMeters))throw new Error("boundary.invalidScope");result.scopeMeters=v.scopeMeters;}
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
export const KAKAO_CATEGORY_CODES = ["MT1","CS2","PS3","SC4","AC5","PK6","OL7","SW8","BK9","CT1","AG2","PO3","AT4","AD5","FD6","CE7","HP8","PM9"] as const;
export type KakaoCategoryCode = typeof KAKAO_CATEGORY_CODES[number];
export const categories: [RegExp,KakaoCategoryCode][] = [
    [/^(?:대형마트|마트|슈퍼|슈퍼마켓|supermarkets?|grocery|MT1)$/i,"MT1"],
    [/^(?:편의점|convenience stores?|CS2)$/i,"CS2"],
    [/^(?:어린이집|유치원|보육시설|daycare|kindergartens?|preschools?|PS3)$/i,"PS3"],
    [/^(?:학교|schools?|SC4)$/i,"SC4"],
    [/^(?:학원|academ(?:y|ies)|AC5)$/i,"AC5"],
    [/^(?:주차장|parking|parking lots?|PK6)$/i,"PK6"],
    [/^(?:주유소|충전소|주유소[·/ ]충전소|gas stations?|charging stations?|OL7)$/i,"OL7"],
    [/^(?:지하철|지하철역|subway stations?|metro stations?|SW8)$/i,"SW8"],
    [/^(?:은행|banks?|BK9)$/i,"BK9"],
    [/^(?:문화시설|cultural facilities|CT1)$/i,"CT1"],
    [/^(?:중개업소|부동산|공인중개사|real estate (?:offices|agencies)|AG2)$/i,"AG2"],
    [/^(?:공공기관|주민센터|public offices?|PO3)$/i,"PO3"],
    [/^(?:관광지|관광명소|tourist attractions?|AT4)$/i,"AT4"],
    [/^(?:숙박|숙박시설|호텔|모텔|accommodation|hotels?|motels?|AD5)$/i,"AD5"],
    [/^(?:음식점|식당|먹을\s*곳|restaurants?|places(?: to)? eat|FD6)$/i,"FD6"],
    [/^(?:카페|커피|커피숍|caf[eé]s?|coffee(?: shops?)?|CE7)$/i,"CE7"],
    [/^(?:병원|의원|의료기관|hospitals?|clinics?|medical facilities|HP8)$/i,"HP8"],
    [/^(?:약국|pharmac(?:y|ies)|PM9)$/i,"PM9"],
];
export function categoryCode(query: string) { return categories.find(([pattern]) => pattern.test(query.trim()))?.[1]; }
export function genericCategoryCode(query: string) { return categoryCode(query); }
export function placeCategory(question: string) { try { return genericCategoryCode(parseGeoPlan(question).query); } catch { return undefined; } }
const reference = /^(?:지금\s*)?(여기|거기|이곳|이\s*건물|이\s*필지|선택한.*|선택된.*|현재\s*(지도\s*)?중심|here|this (building|parcel)|selected.*|map center)$/i;
export const isMapReference = (name: string) => reference.test(name.trim());
function clean(text: string) { return text.trim().replace(/(?:을|를)?\s*(?:지도(?:에|에서)\s*)?(?:보여(?:줘|주세요)|찾아(?:줘|주세요)|검색(?:해줘|해주세요)|(?:분석|확인)(?:해줘|해주세요))\s*[?.!]*$/i, '').replace(/(?:은|는|이|가)?\s*어디(?:에)?\s*있(?:어|나요|니|을까)?[?.!]*$/, '').replace(/[?.!]+$/g, '').replace(/(?:은|는|이|가)?\s*어디(?:야|인가요|에\s*있(?:어|나요))$/,'').replace(/(?:을|를)?\s*(?:찾아(?:줘|주세요)?|검색(?:해줘|해주세요)?|알려(?:줘|주세요)?|보여(?:줘|주세요)?|어디(?:야|인가요)?|있(?:어|나요)|있을까|search|find|show)(?:[?.!\s]*)$/i, '').trim(); }
export function parseGeoPlan(question: string): GeoPlan {
    if (typeof question !== 'string' || !question.trim() || question.length > 1000)
        throw new Error('gis.invalidQuestion');
    const q = question.trim().replace(/^이\s*(근처|주변)/, '$1');
    const route = q.match(/^(.+?)(?:에서|부터)\s*(.+?)(?:까지|(?:으)?로(?=\s|$))\s*(.*)$/);
    const englishRoute = q.match(/(?:from)\s+(.+?)\s+to\s+(.+?)(?:\?|$)/i);
    const walking = /도보|걸어|걸리|걸려|몇\s*분|walking|\bwalk\b/i.test(q);
    const minutes = q.match(/(\d+)\s*(?:분|min)/i);
    const meters = q.match(/(\d+(?:\.\d+)?)\s*(km|킬로미터|m|미터)(?!\w)/i);
    const radius = meters ? Number(meters[1]) * (/km|킬로/i.test(meters[2]) ? 1000 : 1) : 1000;
    if (radius < 1 || radius > 20000 || (minutes && (Number(minutes[1]) < 1 || Number(minutes[1]) > 180)))
        throw new Error('gis.invalidRadius');
    const limit = Math.min(10, Math.max(1, Number(q.match(/(\d+)\s*(?:개|곳|곳을|places)/i)?.[1] ?? 5)));
    if (!route && !englishRoute && !/가장\s*가까|nearest|closest|주변|근처|nearby|near\b|주요\s*(?:사업)?시설|key\s*(?:project\s*)?facilit/i.test(q) && /어디|위치(?:해|하|는|를|가|에)|where (?:is|are)|locations? of/i.test(q)) {
        const subject = q.replace(/^(?:where (?:is|are)|(?:the )?locations? of)\s+/i, '').split(/어디|(?:의\s*)?위치/)[0].replace(/[?.!]+$/g, '').replace(/(?:은|는|이|가|의)\s*$/, '').trim();
        const locations = subject.split(/(?:와|과)\s+|\s+및\s+|[,，]|\s+and\s+/i).map(s => clean(s).replace(/^the\s+/i, '')).filter(Boolean);
        if (locations.length && locations.length <= 4 && !(locations.length === 1 && genericCategoryCode(locations[0]))) return { intent: 'PLACE_SEARCH', query: locations[0], locations, radius, limit, walking: false, nearby: false };
    }
    let intent: GeoIntent = 'PLACE_SEARCH';
    let origin: string | undefined;
    let destination: string | undefined;
    const proximity = q.match(/^(.+?)(?:에서|주변(?:에|의)?|근처(?:에|의)?|반경(?:에|의)?)\s*(.*)$/);
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
    query = query.replace(/^(?:where is|what is|show|find|search(?: for)?)\s+(?:me\s+)?/i, '').replace(/\b(?:the|of|to|from|a)\b/gi, ' ').replace(/this (?:building|parcel)/gi, '').replace(/(?:걸어서|도보로?|걸어)/g,'').replace(/\s+/g,' ').trim();
    query = query.replace(/(?:도|을|를|이|가)$/, suffix => genericCategoryCode(query.slice(0,-suffix.length).trim()) ? '' : suffix);
    query = query.replace(/^(?:까지|를|을)$/, '').trim();
    if (!query && !destination)
        query = '편의시설';
    if (intent === 'CATEGORY_SEARCH' && !genericCategoryCode(query))
        intent = 'PLACE_SEARCH';
    if(/주요\s*(?:사업)?시설|공간\s*구조|사업구역.*(?:면적|건물)|타워.*전파기지.*어디|key\s*(?:project\s*)?facilit|spatial\s*structure|where.*tower.*station/i.test(q))intent='EXISTING_GIS_QUERY';
    query=query.replace(/^(?:에|의)\s+/, '').replace(/^(?:어떤|어디에|무슨)\s*/,'').replace(/^(?:생활시설|편의시설|시설)(?:이|가|은|는)?$/,'편의시설');
    if (/주민.*이용.*시설|이용할.*시설/.test(query)) query = '편의시설';
    if (intent === 'PLACE_SEARCH' && genericCategoryCode(query)) intent = 'CATEGORY_SEARCH';
    if (intent === 'PLACE_SEARCH' && /^(?:공원|녹지|편의시설|생활시설|시설|parks?|amenities)$/i.test(query)) intent = 'NEARBY_SEARCH';
    return { intent, query, ...(origin ? { origin } : {}), ...(destination ? { destination } : {}), radius, limit, walking, ...(minutes ? { minutes: Number(minutes[1]) } : {}), nearby: ['NEAREST_PLACE', 'RADIUS_SEARCH', 'NEARBY_SEARCH', 'CATEGORY_SEARCH'].includes(intent) };
}
const toolPatterns = [
    ["priority", /우선\s*검토|우선\s*지역|우선순위\s*분석|priority.*(?:area|analys)/i],
    ["overlay", /겹침|중첩|겹치|겹치는|겹쳐|overlay|overlap/i],
    ["buffer", /영향권|버퍼|buffer/i],
    ["area", /영역\s*통계|지역의\s*특징\s*보기|area statistics/i],
] as const;
const toolOperations = (text: string) => toolPatterns.filter(([,pattern])=>pattern.test(text)).map(([operation])=>operation);
const toolOperation = (text: string) => { const operations=toolOperations(text); return operations.length===1?operations[0]:undefined; };
export const isSpatialToolCancelled = (question: string) => toolOperations(question).length > 0 && /하지\s*마|하지\s*말|실행하지|말고|취소|그만|don.?t|do not|cancel/i.test(question);
export const isSpatialToolExplanation = (question: string) => toolOperations(question).length > 0 && /뭐야|뭔가|무엇|방법|어떤\s*(?:도구|분석|기능)|원리|설명|추천|어떻게\s*(?:쓰|사용|작동)|what\b|why\b|should I|explain|how (?:to|do|does|can)|how.*work/i.test(question) && !/(?:실행|분석|계산)해|\b(?:run|execute)\b/i.test(question);
export function spatialToolRequest(question: string, history: import("../chat-history").ConversationMessage[] = []): { operation: typeof toolPatterns[number][0]; reference: string; exploratory: boolean } | undefined {
    if (isSpatialToolExplanation(question) || /하지\s*마|하지\s*말|실행하지|말고|취소|그만|don.?t|do not|cancel/i.test(question)) return;
    const exploration = !toolOperations(question).length && !/논문|학술|연구|사례|\b(?:research|literature|study|cases?)\b/i.test(question)
        && /개선|문제|후보|improv|problem|candidate/i.test(question)
        && /장소|지역|공간|대상지|가로|시설|places?|sites?|areas?/i.test(question)
        && /어디부터|무엇부터|어떤\s*(?:자료|곳|분석)|자료부터|찾으려면|찾아|살펴|확인|where.*start|what.*(?:check|first)|identify/i.test(question);
    if (exploration) return { operation: "area", reference: "", exploratory: true };
    const last = history[history.length - 1];
    const pending = last?.role === "assistant" && /실행할.*(?:자료|대상|거리).*알려|provide.*(?:layers|target|distance).*execute/i.test(last.content);
    const execute = /확인해|계산해|분석해|실행해|해봐|해볼래|비교해|중첩해|겹쳐줘|해줘|해주세요|찾아(?:줘|주세요)|알아봐|\b(?:run|execute|calculate|check|compare|perform|go ahead)\b/i.test(question);
    if (!execute && !pending) return;
    const operation = toolOperation(question);
    const referential = /그럼|아까|말한|앞서|그\s*분석|그거|그대로|이어서|same|that|suggested|go ahead/i.test(question) || pending;
    const anchor = [...history].reverse().find(message => toolOperations(message.content).length && (!operation || toolOperations(message.content).includes(operation)));
    const chosen = operation ?? (referential && anchor ? toolOperation(anchor.content) : undefined);
    return chosen ? { operation: chosen, reference: anchor?.content ?? "", exploratory: false } : undefined;
}
export function placeResultFollowUp(question: string): "distribution" | "boundary-nearest" | "search-comparison" | undefined {
    if (/대안|계획안|의견|주민|인구|이용량|논문|연구|사례|\b(?:research|study|case)\b/i.test(question)) return;
    if (/(?:둘|두\s*(?:검색|결과)|각각)|\b(?:both|two|which)\b/i.test(question) && /더\s*많|몇\s*(?:개|곳)|개수|\b(?:more|counts?)\b/i.test(question)) return "search-comparison";
    if (/(?:이|그)\s*중|중에서|검색(?:한|된)\s*(?:장소|결과)|\b(?:these|those|results|among)\b/i.test(question) && /가장\s*가까|nearest|closest/i.test(question) && /사업구역|대상지|project (?:area|boundary)/i.test(question)) return "boundary-nearest";
    if (/어느\s*(?:쪽|방향).*모|(?:이|그)\s*(?:결과|장소|시설).*분포|어디.*모여|which (?:side|direction)|(?:these|those|results).*distribut/i.test(question)) return "distribution";
}
export function isGeoQuestion(question: string) {
    return !!placeCategory(question) || (/어린이집|유치원|학원|주유소|충전소|지하철|은행|중개업소|관광지|관광명소|숙박|호텔|세탁소|경로당|공방|체육관|daycare|bank|gym|laundry/i.test(question) && /보여|찾아|검색|어디|주변|근처|show|find|search|where|near/i.test(question)) || /key\s*(?:project\s*)?facilit|spatial\s*structure|주요\s*(?:사업)?시설|공간\s*구조|면적|건물\s*수|위치|어디(?:야|인가요|에\s*있)|\b(?:find|search|where (?:is|are))\b|(?:검색|찾아)(?:해)?(?:줘|주세요)|주변|근처|카페|약국|마트|음식점|식당|편의점|병원|학교|버스\s*정류장|공원|도보|걸어|몇\s*미터|가장\s*가까|지도\s*중심|까지.*거리|에서.*까지|nearby|nearest|walking|\bfrom\b.*\bto\b|\b(cafe|pharmacy|restaurant|supermarket)\b/i.test(question);
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
    const preferred = typeof p.nameField === 'string' ? p.nameField : '';
    const fields = ['display_name', preferred, 'name', 'title', 'label', 'facility_name', 'building_name', 'parcel_name', '시설명', '건물명', '명칭', 'aliases', 'alias', '별칭'];
    const actualKeys = Object.keys(p);
    for (const key of [...fields.map(field => actualKeys.find(key => key.toLowerCase() === field.toLowerCase()) ?? field), ...actualKeys.filter(key => /alias|alternate.?names?|별칭/i.test(key))]) {
        if (!key) continue;
        const value = p[key];
        for (const name of Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,;|]/) : [])
            if (typeof name === 'string' && name.trim())
                names.push(name.trim().slice(0, 200));
    }
    if (names.some(n => /회복의\s*숲\s*타워|Recovery Forest Tower/i.test(n)))
        names.push('타워', '기존 경로당', '경로당', 'Recovery Forest Tower');
    if (names.some(n => /회복의\s*숲\s*전파기지|Recovery Forest Transmission Station/i.test(n)))
        names.push('전파기지', '기존 건강생활지원센터', 'Recovery Forest Transmission Station', 'Transmission Station', 'the Transmission Station');
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
