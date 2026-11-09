import { useCallback, useMemo, useState } from 'react';
import { useI18n } from '../../lib/i18n';
import OSMSpatialMap from './OSMSpatialMap';
import KakaoSpatialMap, { type SpatialMapProps } from './KakaoSpatialMap';
import { featureKey } from '../../lib/spatial/engine';
export default function SpatialMap({ onReturn, ...props }: SpatialMapProps & { onReturn?: () => void }) {
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
    {error && <p role="status" className="text-xs text-amber-700">{t(error)}</p>}
    <div className="relative">
    {provider === 'kakao' ? <KakaoSpatialMap {...props} onFailure={failed}/> : <OSMSpatialMap {...props} overlay={osmOverlay}/>}
      {onReturn && <button type="button" title={t('boundary.return')} aria-label={t('boundary.return')} className="absolute bottom-3 left-3 z-10 flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm" onClick={event => { event.stopPropagation(); onReturn(); }}><span aria-hidden="true">⌖</span></button>}
    </div>
    {provider === 'osm' && props.geoResult?.places.some(p => p.source === 'kakao') && <p className="text-xs text-slate-500">{t('gis.kakaoOnly')}</p>}
  </div>;
}
