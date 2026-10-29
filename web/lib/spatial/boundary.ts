import { area, bbox, buffer, centroid, pointOnFeature, booleanPointInPolygon, booleanValid, kinks, union, point, toWgs84 } from '@turf/turf';
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { validateGeoJSON } from './loader';
import type { Coordinate, Place } from './geo-query';
export type BoundaryFeature = Feature<Polygon | MultiPolygon>;
export type SpatialSettings = {
    activeBoundaryDatasetId: string | null;
    defaultNearbyMeters: 0 | 500 | 1000;
};
export function spatialSettings(value: unknown): SpatialSettings {
    const v = value as Partial<SpatialSettings> | undefined;
    return { activeBoundaryDatasetId: typeof v?.activeBoundaryDatasetId === 'string' && /^[\w-]{1,128}$/.test(v.activeBoundaryDatasetId) ? v.activeBoundaryDatasetId : null, defaultNearbyMeters: [0, 500, 1000].includes(v?.defaultNearbyMeters as number) ? v!.defaultNearbyMeters! : 500 };
}
export function sourceCrs(input: unknown, confirmed?: unknown, required = false): 'EPSG:4326' | 'EPSG:3857' {
    const name = (input as {
        crs?: {
            properties?: {
                name?: unknown;
            };
        };
    })?.crs?.properties?.name;
    let declared: 'EPSG:4326' | 'EPSG:3857' | undefined;
    if (name !== undefined) {
        if (typeof name !== 'string')
            throw new Error('boundary.unsupportedCrs');
        if (/(?:[:/]|^)(4326|CRS84)$/i.test(name))
            declared = 'EPSG:4326';
        else if (/(?:[:/]|^)(3857|900913)$/i.test(name))
            declared = 'EPSG:3857';
        else
            throw new Error('boundary.unsupportedCrs');
    }
    if (confirmed !== undefined && !['EPSG:4326', 'EPSG:3857'].includes(String(confirmed)))
        throw new Error('boundary.confirmCrs');
    if (declared && confirmed && declared !== confirmed)
        throw new Error('boundary.crsMismatch');
    if (required && !declared && !confirmed)
        throw new Error('boundary.confirmCrs');
    return declared ?? confirmed as 'EPSG:4326' | 'EPSG:3857' ?? 'EPSG:4326';
}
export function boundaryGeoJSON(input: unknown, confirmed?: unknown, required = false): FeatureCollection<Polygon | MultiPolygon> {
    const crs = sourceCrs(input, confirmed, required);
    let data = JSON.parse(JSON.stringify(input));
    if (crs === 'EPSG:3857') {
        const check = (v: unknown): void => { if (!Array.isArray(v))
            throw new Error('boundary.invalid'); if (typeof v[0] === 'number') {
            if (v.length < 2 || v.some(n => typeof n !== 'number' || !Number.isFinite(n)) || Math.abs(v[0]) > 20037509 || Math.abs(v[1]) > 20037509)
                throw new Error('boundary.invalid');
        }
        else
            v.forEach(check); };
        const features = data?.type === 'FeatureCollection' ? data.features : [data];
        if (!Array.isArray(features))
            throw new Error('boundary.invalid');
        features.forEach(f => check(f?.geometry?.coordinates));
        data = toWgs84(data, { mutate: false });
    }
    const valid = validateGeoJSON(data, { id: 'boundary', label: 'boundary', type: 'polygon', source: '' }) as FeatureCollection<Polygon | MultiPolygon>;
    if (valid.features.length > 500)
        throw new Error('boundary.tooLarge');
    for (const f of valid.features)
        if (!booleanValid(f) || kinks(f).features.length)
            throw new Error('boundary.invalid');
    return valid;
}
export function deriveBoundary(data: FeatureCollection<Polygon | MultiPolygon>) {
    const geometry = data.features.length === 1 ? data.features[0] : union(data);
    if (!geometry || area(geometry) <= 0)
        throw new Error('boundary.invalid');
    const c = centroid(geometry), representative = booleanPointInPolygon(c, geometry) ? c : pointOnFeature(geometry);
    return { geometry, bbox: bbox(geometry) as [
            number,
            number,
            number,
            number
        ], center: representative.geometry.coordinates.slice(0, 2) as Coordinate, areaSqm: area(geometry) };
}
export type ProjectBoundary = ReturnType<typeof deriveBoundary>;
export function boundaryScope(boundary: ProjectBoundary, meters: number): BoundaryFeature {
    if (![0, 500, 1000].includes(meters))
        throw new Error('boundary.invalidScope');
    if (!meters)
        return boundary.geometry;
    const expanded = buffer(boundary.geometry, meters, { units: 'meters' });
    if (!expanded)
        throw new Error('boundary.invalid');
    return expanded;
}
export function filterBoundaryPlaces(places: Place[], geometry: BoundaryFeature) { return places.filter(p => booleanPointInPolygon(point(p.coordinate), geometry)); }
export function searchWindows(geometry: BoundaryFeature): [
    number,
    number,
    number,
    number
][] {
    const polygons = geometry.geometry.type === 'MultiPolygon' ? geometry.geometry.coordinates : [geometry.geometry.coordinates];
    const boxes = polygons.map(coordinates => bbox({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates } }) as [
        number,
        number,
        number,
        number
    ]);
    if (boxes.length > 4)
        return [bbox(geometry) as [
                number,
                number,
                number,
                number
            ]];
    const result: [
        number,
        number,
        number,
        number
    ][] = [];
    for (const [index, b] of boxes.entries()) {
        const ratio = (b[2] - b[0]) / Math.max(b[3] - b[1], .00001);
        if ((ratio > 4 || ratio < .25) && result.length + (boxes.length - index) + 1 <= 4) {
            if (ratio > 4) {
                const m = (b[0] + b[2]) / 2;
                result.push([b[0], b[1], m, b[3]], [m, b[1], b[2], b[3]]);
            }
            else {
                const m = (b[1] + b[3]) / 2;
                result.push([b[0], b[1], b[2], m], [b[0], m, b[2], b[3]]);
            }
        }
        else
            result.push(b);
    }
    return result.slice(0, 4);
}
