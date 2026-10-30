import { useCallback, useState } from 'react';
import { useI18n } from '../../lib/i18n';
import OSMSpatialMap from './OSMSpatialMap';
import KakaoSpatialMap, { type SpatialMapProps } from './KakaoSpatialMap';
export default function SpatialMap(props: SpatialMapProps) {
    const { t } = useI18n();
    const [provider, setProvider] = useState<'kakao' | 'osm'>(process.env.NEXT_PUBLIC_KAKAO_JS_KEY ? 'kakao' : 'osm');
    const [error, setError] = useState(process.env.NEXT_PUBLIC_KAKAO_JS_KEY ? '' : 'gis.jsMissing');
    const failed = useCallback((key: string) => { setError(key); setProvider('osm'); }, []);
    return <div className="space-y-2">
    <label className="flex items-center gap-2 text-sm">{t('gis.mapProvider')}<select className="rounded border p-2" value={provider} onChange={event => { setError(''); setProvider(event.target.value as 'kakao' | 'osm'); }}><option value="kakao">Kakao Maps</option><option value="osm">OpenStreetMap</option></select></label>
    {error && <p role="status" className="text-xs text-amber-700">{t(error)}</p>}
    {provider === 'kakao' ? <KakaoSpatialMap {...props} onFailure={failed}/> : <OSMSpatialMap layers={props.layers} visible={props.visible} overlay={props.overlay} onSelect={props.onSelect} onPoint={props.onPoint} onCenter={props.onCenter} extent={props.extent} resetVersion={props.resetVersion}/>}
    {provider === 'osm' && props.geoResult?.places.some(p => p.source === 'kakao') && <p className="text-xs text-slate-500">{t('gis.kakaoOnly')}</p>}
  </div>;
}
