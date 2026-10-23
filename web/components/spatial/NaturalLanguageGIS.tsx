import { useEffect, useState } from 'react';
import { useI18n } from '../../lib/i18n';
import type { GeoWorkspace } from '../../lib/spatial/use-geo';
export default function NaturalLanguageGIS({ geo, names = [] }: {
    geo: GeoWorkspace;
    names?: string[];
}) {
    const { t, localize } = useI18n();
    const [question, setQuestion] = useState('');
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const namesKey = JSON.stringify([...new Set(names)].slice(0, 200));
    useEffect(() => {
        const timer = setTimeout(() => {
            const query = question.trim().toLocaleLowerCase();
            const examples = ['gis.example.nearest', 'gis.example.walk', 'gis.example.nearby', 'gis.example.radius'].map(key => t(key));
            const internal = JSON.parse(namesKey) as string[];
            setSuggestions(query ? [...internal, ...examples].filter(name => name.toLocaleLowerCase().includes(query)).slice(0, 5) : examples);
        }, 350);
        return () => clearTimeout(timer);
    }, [question, namesKey, t]);
    const result = geo.result;
    return <section className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/30 p-3" aria-label={t('gis.title')}>
    <h4 className="font-semibold">{t('gis.title')}</h4>
    <p className="text-xs text-slate-600">{t('gis.contextHint')}</p>
    <form className="flex min-w-0 flex-wrap gap-2" onSubmit={event => { event.preventDefault(); if (question.trim())
        void geo.run(question); }}>
      <input aria-label={t('gis.question')} placeholder={t('gis.placeholder')} className="min-h-11 min-w-0 flex-1 rounded-lg border bg-white p-2 text-base" value={question} maxLength={1000} onChange={event => setQuestion(event.target.value)}/>
      <button type="submit" className="spatial-button" disabled={!question.trim() || geo.loading}>{t(geo.loading ? 'gis.searching' : 'gis.search')}</button>
      {geo.loading && <button className="spatial-button" type="button" onClick={geo.clear}>{t('workspace.cancel')}</button>}
    </form>
    <div className="flex flex-wrap gap-2">{suggestions.map(key => <button key={key} type="button" className="min-h-11 rounded-lg border bg-white px-2 text-left text-xs" disabled={geo.loading} onClick={() => { setQuestion(key); void geo.run(key); }}>{key}</button>)}</div>
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
