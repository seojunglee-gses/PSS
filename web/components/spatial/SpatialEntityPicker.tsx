import { useState, type ReactNode } from 'react';
import { useI18n } from '../../lib/i18n';
import type { Place } from '../../lib/spatial/geo-query';

// Shared map/row selection; choosing a place collapses its candidate list.
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
    return <section className="min-w-0 space-y-2" aria-label={t('picker.title')}>
      {reference && !selected && <p className="text-xs text-slate-600">{t(entities.length>1?'picker.instruction':'picker.confirmAlias',{name:reference})}</p>}
      {children}
      {selected && !expanded ? <div role="group" className="flex items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50 p-2" aria-label={t('picker.selected')}>
        <p className="min-w-0 break-words text-sm font-semibold">{localize(selected.name)}</p>
        {selected.url && <a href={selected.url} target="_blank" rel="noopener noreferrer" aria-label={t('gis.placeDetails')} title={t('gis.placeDetails')} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center text-xs text-slate-400">↗</a>}
        <button type="button" className="spatial-button shrink-0 text-xs" disabled={busy} onClick={()=>setExpandedFor(selected.id)}>{t('picker.change')}</button>
      </div> : entities.length > 0 && <>
        <div role="group" className="grid min-w-0 gap-1.5" aria-label={t('picker.candidates')}>
          {entities.slice(page,page+4).map((entity,index)=><article key={entity.id} aria-label={`${page+index+1}. ${entity.name}`} className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border px-2 py-1 ${highlighted===entity.id?'border-blue-400 bg-blue-50':'border-slate-200 bg-white'}`}
            onMouseEnter={()=>onHighlight(entity.id)} onMouseLeave={()=>onHighlight(selected?.id??null)} onFocus={()=>onHighlight(entity.id)}>
            <button type="button" className="flex min-h-11 min-w-0 items-center gap-2 text-left" onClick={()=>onHighlight(entity.id)} aria-pressed={highlighted===entity.id}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs text-blue-800">{page+index+1}</span>
              <span className="min-w-0"><span className="block break-words text-sm font-semibold">{localize(entity.name)}</span>{(entity.roadAddress||entity.address)&&<span className="block truncate text-xs text-slate-500" title={entity.roadAddress||entity.address}>{entity.roadAddress||entity.address}</span>}{entity.relatedCategories?.length ? <span className="block text-[11px] text-slate-500">{entity.relatedCategories.join(' · ')}</span> : null}</span>
            </button>
            <button type="button" className="spatial-button shrink-0 text-xs" aria-label={t('gis.choose')} disabled={busy} onClick={()=>{onChoose(entity);setExpandedFor(null);}}>{t('picker.choose')}</button>
          </article>)}
        </div>
        {entities.length>4&&<div className="flex items-center justify-between gap-2 text-xs"><button type="button" className="spatial-button" disabled={page===0} onClick={()=>setPage(Math.max(0,page-4))}>{t('picker.previous')}</button><span>{page+1}–{Math.min(page+4,entities.length)} / {entities.length}</span><button type="button" className="spatial-button" disabled={page+4>=entities.length} onClick={()=>setPage(page+4)}>{t('picker.next')}</button></div>}
      </>}
    </section>;
}
