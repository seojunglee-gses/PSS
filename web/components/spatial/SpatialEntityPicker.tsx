import { useState, type ReactNode } from 'react';
import { useI18n } from '../../lib/i18n';
import type { Place } from '../../lib/spatial/geo-query';

// Shared map/card selection for places, facilities, buildings and parcels.
export default function SpatialEntityPicker({ children, entities, highlighted, selected, onHighlight, onChoose, busy, reference }: {
    children: ReactNode; entities: Place[]; highlighted: string | null; selected: Place | null;
    onHighlight: (id: string | null) => void; onChoose: (place: Place) => void; busy: boolean; reference?: string;
}) {
    const {t,localize} = useI18n();
    const identity=reference??entities.map(entity=>entity.id).join('|');
    const [paging,setPaging]=useState({identity,page:0,highlighted}),[expandedFor,setExpandedFor]=useState<string|null>(null);
    const highlightedIndex=entities.findIndex(entity=>entity.id===highlighted);
    const page=highlightedIndex>=0&&highlighted!==paging.highlighted?Math.floor(highlightedIndex/4)*4:paging.identity===identity?paging.page:0;
    const expanded=selected?.id===expandedFor || !!selected && !!highlighted && highlighted!==selected.id;
    const setPage=(next:number)=>setPaging({identity,page:next,highlighted});
    return <section className="min-w-0 space-y-3" aria-label={t('picker.title')}>
      {reference && !selected && <p className="text-sm">{t(entities.length>1?'picker.instruction':'picker.confirmAlias',{name:reference})}</p>}
      {children}
      {selected && !expanded ? <div role="group" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-300 bg-blue-50 p-3" aria-label={t('picker.selected')}>
        <div><p className="text-xs text-blue-700">{t('picker.selected')}</p><p className="break-words text-sm font-semibold">{localize(selected.name)}</p></div>
        <button type="button" className="spatial-button text-xs" disabled={busy} onClick={()=>setExpandedFor(selected.id)}>{t('picker.change')}</button>
      </div> : entities.length > 0 && <>
        <div role="group" className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2" aria-label={t('picker.candidates')}>
          {entities.slice(page,page+4).map((entity,index)=><article key={entity.id} aria-label={`${page+index+1}. ${entity.name}`} className={`min-w-0 rounded-xl border p-3 ${highlighted===entity.id?'border-amber-500 bg-amber-50':'border-slate-200 bg-white'} ${selected&&selected.id!==entity.id?'opacity-40':''}`}
            onMouseEnter={()=>onHighlight(entity.id)} onMouseLeave={()=>onHighlight(selected?.id??null)} onFocus={()=>onHighlight(entity.id)}>
            <button type="button" className="flex min-h-11 w-full items-center gap-2 text-left text-sm font-semibold" onClick={()=>onHighlight(entity.id)} aria-pressed={highlighted===entity.id}><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-900">{page+index+1}</span><span className="min-w-0 break-words">{localize(entity.name)}</span></button>
            {(entity.roadAddress||entity.address||entity.category)&&<p className="line-clamp-2 text-xs text-slate-500">{entity.roadAddress||entity.address||entity.category}</p>}
            {entity.url&&<a className="inline-block py-2 text-xs text-blue-700 underline" href={entity.url} target="_blank" rel="noopener noreferrer">{t('gis.placeDetails')}</a>}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-slate-500">{t(entity.source==='project'?'gis.internal':'gis.kakaoSource')}</span><button type="button" className="spatial-button text-xs" disabled={busy} onClick={()=>{onChoose(entity);setExpandedFor(null);}}>{t('gis.choose')}</button></div>
          </article>)}
        </div>
        {entities.length>4&&<div className="flex items-center justify-between gap-2 text-xs"><button type="button" className="spatial-button" disabled={page===0} onClick={()=>setPage(Math.max(0,page-4))}>{t('picker.previous')}</button><span>{page+1}–{Math.min(page+4,entities.length)} / {entities.length}</span><button type="button" className="spatial-button" disabled={page+4>=entities.length} onClick={()=>setPage(page+4)}>{t('picker.next')}</button></div>}
      </>}
    </section>;
}
