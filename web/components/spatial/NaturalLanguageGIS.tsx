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
      <p className="text-sm font-semibold">{result.reply}</p>
      {result.origin && <p className="text-xs">{t('gis.origin')}: {localize(result.origin.name)}{result.origin.approximate && ` · ${t('gis.approximatePoint')}`}</p>}
      {result.route && <p className="text-xs">{t('gis.walking')}: {Math.round(result.route.distanceMeters)}{t('gis.meters')} · {Math.ceil(result.route.durationSeconds / 60)}{t('gis.minutes')} · {'Kakao Walking Route'}</p>}
      {result.straightDistanceMeters !== undefined && <p className="text-xs">{t('gis.straight')}: {Math.round(result.straightDistanceMeters)}{t('gis.meters')}</p>}
      {result.radiusMeters && <p className="text-xs">{t('gis.radius')}: {result.radiusMeters}{t('gis.meters')}</p>}
      {result.warnings.map((warning, i) => <p key={i} className="text-xs text-amber-800">{warning}</p>)}
      <ul className="max-h-72 space-y-2 overflow-y-auto">{result.places.map(place => <li key={place.id} className={`rounded-lg border bg-white p-2 ${geo.highlighted === place.id ? 'border-amber-500' : 'border-slate-200'}`}>
        <button type="button" className="min-h-11 w-full text-left text-sm font-semibold" onClick={() => geo.setHighlighted(place.id)}>{place.name}</button>
        {place.category && <p className="text-xs text-slate-500">{place.category}</p>}
        {(place.roadAddress || place.address) && <p className="text-xs">{place.roadAddress || place.address}</p>}
        {place.distanceMeters !== undefined && <p className="text-xs">{t(result.ranking === 'walking' ? 'gis.walking' : 'gis.straight')}: {Math.round(place.distanceMeters)}{t('gis.meters')}</p>}
        <p className="text-xs text-slate-500">{t(place.source === 'project' ? 'gis.internal' : 'gis.kakaoSource')}{place.approximate && ` · ${t('gis.approximatePoint')}`}</p>
        {place.url && <a className="inline-block min-h-11 py-3 text-xs text-blue-700 underline" href={place.url} target="_blank" rel="noopener noreferrer">{t('gis.placeDetails')}</a>}
        {result.clarify && place.choiceToken && <button type="button" className="spatial-button ml-2" disabled={geo.loading} onClick={() => void geo.run(result.question, { reference: result.clarify!.reference, token: place.choiceToken! })}>{t('gis.choose')}</button>}
      </li>)}</ul>
      <button type="button" className="spatial-button" onClick={geo.clear}>{t('gis.clear')}</button>
    </div>}
  </section>;
}
