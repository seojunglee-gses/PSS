import { useEffect, useRef, useState } from 'react';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { bbox, featureCollection, featureKey } from '../../lib/spatial/engine';
import type { LoadedLayer } from '../../lib/spatial/types';
import { featureNames, representativePoint, type Coordinate, type GeoResult, type Place } from '../../lib/spatial/geo-query';
import { loadKakaoMaps, kakaoFeatureOverlays, latLng, type KakaoMap, type KakaoSDK, type KakaoOverlay } from '../../lib/spatial/kakao-map';
import { useI18n } from '../../lib/i18n';
export type SpatialMapProps = {
    extent?: [number,number,number,number];
    resetVersion?: number;
    layers: LoadedLayer[];
    visible: string[];
    overlay: FeatureCollection;
    onSelect: (layer: LoadedLayer, feature: Feature<Geometry>, index: number) => void;
    onPoint?: (coordinate: Coordinate) => void;
    onCenter?: (coordinate: Coordinate) => void;
    geoResult?: GeoResult | null;
    highlightedPlaceId?: string | null;
    selectedPlaceId?: string | null;
    onPlace?: (place: Place) => void;
};
export default function KakaoSpatialMap(props: SpatialMapProps & {
    onFailure: (key: string) => void;
}) {
    const { t, localize } = useI18n();
    const root = useRef<HTMLDivElement>(null);
    const map = useRef<KakaoMap | null>(null);
    const sdk = useRef<KakaoSDK | null>(null);
    const latest = useRef(props);
    useEffect(() => { latest.current = props; });
    const [ready, setReady] = useState(false);
    const [error, setError] = useState('');
    const fitted = useRef(false);
    const fittedResult = useRef('');
    useEffect(()=>{fitted.current=false;},[props.resetVersion,props.extent]);
    useEffect(() => {
        let alive = true;
        let resize: ResizeObserver | undefined;
        let cleanup = () => { };
        loadKakaoMaps(process.env.NEXT_PUBLIC_KAKAO_JS_KEY ?? '').then(api => {
            if (!alive || !root.current)
                return;
            sdk.current = api;
            map.current = new api.Map(root.current, { center: latLng(api, [127, 37.5]), level: 7 });
            const move = () => { const p = map.current?.getCenter(); if (p)
                latest.current.onCenter?.([p.getLng(), p.getLat()]); };
            const click = (event?: {
                latLng?: import('../../lib/spatial/kakao-map').KakaoLatLng;
            }) => { if (event?.latLng)
                latest.current.onPoint?.([event.latLng.getLng(), event.latLng.getLat()]); };
            api.event.addListener(map.current, 'idle', move);
            api.event.addListener(map.current, 'click', click);
            const instance = map.current;
            cleanup = () => { api.event.removeListener(instance, 'idle', move); api.event.removeListener(instance, 'click', click); };
            resize = new ResizeObserver(() => instance.relayout());
            resize.observe(root.current);
            setReady(true);
            move();
        }).catch(() => { if (alive) {
            setError('gis.sdkFailed');
            latest.current.onFailure('gis.sdkFailed');
        } });
        return () => { alive = false; resize?.disconnect(); cleanup(); map.current = null; sdk.current = null; };
    }, []);
    useEffect(() => {
        const api = sdk.current, instance = map.current;
        if (!ready || !api || !instance)
            return;
        const all = featureCollection(props.layers.flatMap(l => l.data.features));
        if ((props.extent||all.features.length) && !fitted.current) {
            const b = props.extent??bbox(all), bounds = new api.LatLngBounds();
            bounds.extend(latLng(api, [b[0], b[1]]));
            bounds.extend(latLng(api, [b[2], b[3]]));
            instance.setBounds(bounds);
            fitted.current = true;
        }
        const created: KakaoOverlay[] = [];
        let cancelled = false;
        let frame = 0;
        let index = 0;
        const features = props.layers.filter(l => !l.config.internalOnly && props.visible.includes(l.config.id)).flatMap(layer => layer.data.features.map((feature, index) => ({ layer, feature, index })));
        const batch = () => {
            if (cancelled)
                return;
            for (let n = 0; n < 100 && index < features.length; n++, index++) {
                const { layer, feature, index: featureIndex } = features[index];
                const objects = kakaoFeatureOverlays(api, feature, layer.config.color ?? '#64748b', () => latest.current.onSelect(layer, feature, featureIndex), false, 1, layer.config.role === "boundary" || layer.config.datasetType === "project_boundary");
                for (const object of objects) {
                    object.setMap(instance);
                    created.push(object);
                }
                const label = featureNames(feature)[0];
                if (typeof label === 'string' && (layer.config.type === 'point' || layer.config.role === 'facilities')) {
                    const element = document.createElement('button');
                    element.type = 'button';
                    element.className = 'rounded bg-white px-2 py-1 text-xs shadow';
                    element.textContent = label.slice(0, 100);
                    element.onclick = () => { api.event.preventMap(); latest.current.onSelect(layer, feature, featureIndex); };
                    const first = representativePoint(feature).coordinate;
                    if (first) {
                        const object = new api.CustomOverlay({ position: latLng(api, first as Coordinate), content: element, yAnchor: 1.5 });
                        object.setMap(instance);
                        created.push(object);
                    }
                }
            }
            if (index < features.length)
                frame = requestAnimationFrame(batch);
        };
        batch();
        return () => { cancelled = true; cancelAnimationFrame(frame); created.forEach(o => o.setMap(null)); };
    }, [ready, props.layers, props.visible, props.extent, props.resetVersion]);
    useEffect(() => {
        const api = sdk.current, instance = map.current;
        if (!ready || !api || !instance)
            return;
        const created = props.overlay.features.flatMap(f => kakaoFeatureOverlays(api, f, '#2563eb', () => { }, true));
        created.forEach(o => o.setMap(instance));
        return () => created.forEach(o => o.setMap(null));
    }, [ready, props.overlay]);
    useEffect(() => {
        const api = sdk.current, instance = map.current, result = props.geoResult;
        if (!result) fittedResult.current='';
        if (!ready || !api || !instance || !result)
            return;
        const created: KakaoOverlay[] = [];
        const bounds = new api.LatLngBounds();
        const seen = new Set<string>();
        const addPlace = (place: Place, label: string, color: string) => {
            if (seen.has(place.id)) return; seen.add(place.id);
            const active = props.selectedPlaceId ? place.id === props.selectedPlaceId : place.id === props.highlightedPlaceId;
            const opacity = props.selectedPlaceId && props.selectedPlaceId !== place.id && result.places.some(p=>p.id===place.id) ? .3 : 1;
            const element = document.createElement('button'); element.type = 'button'; element.className = 'spatial-place-marker'; element.style.borderColor = active ? '#f59e0b' : color; element.style.backgroundColor = active ? '#fef3c7' : 'white'; element.style.opacity = String(opacity); element.textContent = /^\d+$/.test(label) ? label : '•'; element.title = localize(place.name); element.setAttribute('aria-label', `${label}. ${localize(place.name)}`);element.setAttribute('aria-pressed',String(active)); element.onclick = () => { api.event.preventMap(); latest.current.onPlace?.(place); };
            const object = new api.CustomOverlay({ position: latLng(api, place.coordinate), content: element, yAnchor: 1.2 }); object.setMap(instance); created.push(object); bounds.extend(latLng(api, place.coordinate));
            if (place.source === 'project') {
                const layer = props.layers.find(l=>l.config.id===place.layerId), feature = layer?.data.features.find((f,i)=>featureKey(f,i)===place.featureId);
                if (feature && !['Point','MultiPoint'].includes(feature.geometry.type)) {
                    const shapes = kakaoFeatureOverlays(api,feature,active?'#f59e0b':color,()=>latest.current.onPlace?.(place),active,opacity);shapes.forEach(shape=>{shape.setMap(instance);created.push(shape);});
                    const b=bbox(feature);bounds.extend(latLng(api,[b[0],b[1]]));bounds.extend(latLng(api,[b[2],b[3]]));
                }
            }
        };
        if (result.origin && !result.places.some(p=>p.id===result.origin?.id))
            addPlace(result.origin, t('gis.origin'), '#16a34a');
        result.places.forEach((place,index)=>addPlace(place, String(index+1), '#7c3aed'));
        for (const place of result.resolvedPlaces??[]) addPlace(place,place.name,'#16a34a');
        if (result.destination)
            addPlace(result.destination, t('gis.destination'), '#dc2626');
        const points = result.route?.coordinates ?? (result.origin && result.destination ? [result.origin.coordinate, result.destination.coordinate] : []);
        if (points.length > 1) {
            const object = new api.Polyline({ path: points.map(p => latLng(api, p)), strokeWeight: 5, strokeColor: result.route ? '#e11d48' : '#0ea5e9', strokeStyle: result.route ? 'solid' : 'dash' });
            object.setMap(instance);
            created.push(object);
            points.forEach(p => bounds.extend(latLng(api, p)));
        }
        if (result.origin && result.radiusMeters) {
            const object = new api.Circle({ center: latLng(api, result.origin.coordinate), radius: result.radiusMeters, strokeColor: '#0891b2', fillColor: '#06b6d4', fillOpacity: .1, strokeStyle: 'dash' });
            object.setMap(instance);
            created.push(object);
        }
        if (props.extent) {bounds.extend(latLng(api,[props.extent[0],props.extent[1]]));bounds.extend(latLng(api,[props.extent[2],props.extent[3]]));}
        const key = JSON.stringify([result.question,result.places,result.origin,result.destination,result.resolvedPlaces,props.extent]);
        if ((result.places.length || result.destination) && key !== fittedResult.current) { instance.setBounds(bounds); fittedResult.current=key; }
        return () => created.forEach(o => o.setMap(null));
    }, [ready, props.geoResult, props.highlightedPlaceId, props.selectedPlaceId, props.layers, props.extent, t, localize]);
    return <div className="spatial-map relative"><div ref={root} className="h-[360px] w-full rounded-xl sm:h-[420px]" aria-label={t('spatial.mapLabel')}/>{ready && <div className="absolute right-3 top-3 flex flex-col rounded-lg bg-white shadow"><button type="button" className="min-h-11 min-w-11 text-xl" aria-label={t('map.zoomIn')} onClick={() => { const instance = map.current; if (instance)
        instance.setLevel(Math.max(1, instance.getLevel() - 1)); }}>+</button><button type="button" className="min-h-11 min-w-11 text-xl" aria-label={t('map.zoomOut')} onClick={() => { const instance = map.current; if (instance)
        instance.setLevel(Math.min(14, instance.getLevel() + 1)); }}>−</button></div>}{!ready && !error && <p role="status">{t('gis.mapLoading')}</p>}{error && <p role="alert">{t(error)}</p>}</div>;
}
