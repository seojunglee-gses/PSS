import { useI18n } from '../../lib/i18n';
import type { GeoWorkspace } from '../../lib/spatial/use-geo';
export default function NaturalLanguageGIS({ geo }: {
    geo: GeoWorkspace;
}) {
    const { t, localize } = useI18n();
    const result = geo.result;
    return <section className="space-y-3" aria-label={t('gis.title')}>
    {geo.loading && <button className="spatial-button" type="button" onClick={geo.clear}>{t('workspace.cancel')}</button>}
    {geo.loading && <p role="status" className="text-sm">{t('gis.searching')}</p>}
    {geo.error && <p role="alert" className="text-sm text-rose-700">{localize(geo.error, 'gis.failed')}</p>}
    {result && <div className="space-y-2" aria-live="polite">
      {!result.clarify && <p className="whitespace-pre-line text-sm">{result.reply}</p>}
      {result.origin && <p className="text-xs">{t('gis.origin')}: {localize(result.origin.name)}{result.origin.approximate && ` · ${t('gis.approximatePoint')}`}</p>}
      {result.route && <p className="text-xs">{t('gis.walking')}: {Math.round(result.route.distanceMeters)}{t('gis.meters')} · {Math.ceil(result.route.durationSeconds / 60)}{t('gis.minutes')} · {'Kakao Walking Route'}</p>}
      {result.straightDistanceMeters !== undefined && <p className="text-xs">{t('gis.straight')}: {Math.round(result.straightDistanceMeters)}{t('gis.meters')}</p>}
      {result.radiusMeters && <p className="text-xs">{t('gis.radius')}: {result.radiusMeters}{t('gis.meters')}</p>}
      {result.warnings.map((warning, i) => <p key={i} className="text-xs text-amber-800">{warning}</p>)}
      <button type="button" className="spatial-button" onClick={geo.clear}>{t('gis.clear')}</button>
    </div>}
  </section>;
}
