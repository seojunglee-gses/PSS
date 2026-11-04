import { useCallback, useMemo, useState } from 'react';
import { useI18n } from '../../lib/i18n';
import OSMSpatialMap from './OSMSpatialMap';
import KakaoSpatialMap, { type SpatialMapProps } from './KakaoSpatialMap';
import { featureKey } from '../../lib/spatial/engine';
export default function SpatialMap(props: SpatialMapProps) {
    const { t } = useI18n();
    const [provider, setProvider] = useState<'kakao' | 'osm'>(process.env.NEXT_PUBLIC_KAKAO_JS_KEY ? 'kakao' : 'osm');
    const [error, setError] = useState(process.env.NEXT_PUBLIC_KAKAO_JS_KEY ? '' : 'gis.jsMissing');
    const failed = useCallback((key: string) => { setError(key); setProvider('osm'); }, []);
    const ownFeatures=useMemo(()=>{
      if(provider!=='osm')return [];
      const ownPlaces=[...(props.geoResult?.places??[]),...(props.geoResult?.resolvedPlaces??[])].filter(p=>p.source==='project');
      return props.layers.flatMap(layer=>layer.data.features.filter((feature,index)=>ownPlaces.some(p=>p.layerId===layer.config.id&&p.featureId===featureKey(feature,index))));
    },[provider,props.geoResult,props.layers]);
    const osmOverlay=useMemo(()=>({type:'FeatureCollection' as const,features:[...props.overlay.features,...ownFeatures]}),[props.overlay,ownFeatures]);
    return <div className="space-y-2">
    <label className="flex items-center gap-2 text-sm">{t('gis.mapProvider')}<select className="rounded border p-2" value={provider} onChange={event => { setError(''); setProvider(event.target.value as 'kakao' | 'osm'); }}><option value="kakao">Kakao Maps</option><option value="osm">OpenStreetMap</option></select></label>
    {error && <p role="status" className="text-xs text-amber-700">{t(error)}</p>}
    {provider === 'kakao' ? <KakaoSpatialMap {...props} onFailure={failed}/> : <OSMSpatialMap {...props} overlay={osmOverlay}/>}
    {provider === 'osm' && props.geoResult?.places.some(p => p.source === 'kakao') && <p className="text-xs text-slate-500">{t('gis.kakaoOnly')}</p>}
  </div>;
}
