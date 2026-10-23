import type { Feature, Geometry } from 'geojson';
import { coordinate, featureNames, type Coordinate } from './geo-query';
export interface KakaoLatLng {
    getLat(): number;
    getLng(): number;
}
export interface KakaoMap {
    setCenter(p: KakaoLatLng): void;
    getCenter(): KakaoLatLng;
    setLevel(level: number): void;
    getLevel(): number;
    setBounds(bounds: unknown): void;
    relayout(): void;
}
export interface KakaoOverlay {
    setMap(map: KakaoMap | null): void;
}
export interface KakaoSDK {
    load(fn: () => void): void;
    Map: new (container: HTMLElement, options: Record<string, unknown>) => KakaoMap;
    LatLng: new (lat: number, lng: number) => KakaoLatLng;
    LatLngBounds: new () => {
        extend(p: KakaoLatLng): void;
    };
    Polygon: new (options: Record<string, unknown>) => KakaoOverlay;
    Polyline: new (options: Record<string, unknown>) => KakaoOverlay;
    Circle: new (options: Record<string, unknown>) => KakaoOverlay;
    CustomOverlay: new (options: Record<string, unknown>) => KakaoOverlay;
    event: {
        addListener(target: unknown, event: string, fn: (event?: {
            latLng?: KakaoLatLng;
        }) => void): void;
        removeListener(target: unknown, event: string, fn: (event?: {
            latLng?: KakaoLatLng;
        }) => void): void;
        preventMap(): void;
    };
}
declare global {
    interface Window {
        kakao?: {
            maps: KakaoSDK;
        };
    }
}
let pending: Promise<KakaoSDK> | undefined;
export function loadKakaoMaps(key: string): Promise<KakaoSDK> {
    if (!key)
        return Promise.reject(new Error('gis.jsMissing'));
    if (pending)
        return pending;
    pending = new Promise<KakaoSDK>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
        script.async = true;
        const timeout = setTimeout(() => { script.remove(); reject(new Error('gis.sdkFailed')); }, 15000);
        script.onload = () => { if (!window.kakao?.maps) {
            clearTimeout(timeout);
            script.remove();
            reject(new Error('gis.sdkFailed'));
            return;
        } window.kakao.maps.load(() => { clearTimeout(timeout); resolve(window.kakao!.maps); }); };
        script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error('gis.sdkFailed')); };
        document.head.appendChild(script);
    }).catch(error => { pending = undefined; throw error; });
    return pending;
}
export function latLng(sdk: KakaoSDK, p: Coordinate) { const c = coordinate(p); return new sdk.LatLng(c[1], c[0]); }
// Read-only projection adapter. Polygon rings stay together, so interior rings remain holes.
export function kakaoFeatureOverlays(sdk: KakaoSDK, feature: Feature<Geometry>, color: string, select: () => void, selected = false): KakaoOverlay[] {
    const geometry = feature.geometry;
    if (!geometry)
        return [];
    const overlays: KakaoOverlay[] = [];
    const style = { strokeWeight: selected ? 4 : 2, strokeColor: color, strokeOpacity: 1, fillColor: color, fillOpacity: selected ? .3 : .25 };
    const line = (coordinates: number[][]) => new sdk.Polyline({ ...style, path: coordinates.map(c => latLng(sdk, coordinate(c.slice(0,2)))) });
    const polygon = (coordinates: number[][][]) => new sdk.Polygon({ ...style, path: coordinates.map(ring => ring.map(c => latLng(sdk, coordinate(c.slice(0,2))))) });
    const marker = (position: number[]) => {
        const element = document.createElement('button');
        element.type = 'button';
        element.setAttribute('aria-label', featureNames(feature)[0] ?? position.slice(0,2).join(', '));
        Object.assign(element.style, {width:'44px',height:'44px',display:'flex',alignItems:'center',justifyContent:'center',background:'transparent',border:'0'});
        const dot = document.createElement('span');
        Object.assign(dot.style, {width:selected?'16px':'12px',height:selected?'16px':'12px',borderRadius:'50%',backgroundColor:color,border:'2px solid white',boxSizing:'border-box'});
        element.appendChild(dot);
        element.onclick = () => { sdk.event.preventMap(); select(); };
        return new sdk.CustomOverlay({position:latLng(sdk,coordinate(position.slice(0,2))),content:element,yAnchor:.5});
    };
    switch (geometry.type) {
        case 'Point':
            overlays.push(marker(geometry.coordinates));
            break;
        case 'MultiPoint':
            geometry.coordinates.forEach(c => overlays.push(marker(c)));
            break;
        case 'LineString':
            overlays.push(line(geometry.coordinates));
            break;
        case 'MultiLineString':
            geometry.coordinates.forEach(c => overlays.push(line(c)));
            break;
        case 'Polygon':
            overlays.push(polygon(geometry.coordinates));
            break;
        case 'MultiPolygon':
            geometry.coordinates.forEach(c => overlays.push(polygon(c)));
            break;
        case 'GeometryCollection':
            geometry.geometries.forEach(g => overlays.push(...kakaoFeatureOverlays(sdk, { ...feature, geometry: g }, color, select, selected)));
            break;
    }
    for (const overlay of overlays)
        if (!['Point','MultiPoint','GeometryCollection'].includes(geometry.type)) sdk.event.addListener(overlay, 'click', () => { sdk.event.preventMap(); select(); });
    return overlays;
}
