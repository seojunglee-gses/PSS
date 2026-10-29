import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { projectRequest } from '../../lib/membership/client';
import { emptyAnalysisReview, type AnalysisReview, type FindingKind } from '../../lib/spatial/analysis-review';
import type { GeoContext } from '../../lib/spatial/geo-query';
import type { SpatialResult } from '../../lib/spatial/types';
export default function AnalysisReviewPanel({ projectId, selection, point, result, locked }: {
    projectId: string;
    selection: GeoContext['selected'];
    point?:GeoContext['point'];
    result: SpatialResult | null;
    locked: boolean;
}) {
    const { user } = useAuth(), { t, locale, localize } = useI18n(), [review, setReview] = useState<AnalysisReview>(emptyAnalysisReview), [draft, setDraft] = useState(emptyAnalysisReview().summary), [kind, setKind] = useState<FindingKind>('observation'), [text, setText] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const current = useRef(`${projectId}:${user?.uid}`);
    current.current = `${projectId}:${user?.uid}`;
    useEffect(() => { let active = true; setReview(emptyAnalysisReview()); setDraft(emptyAnalysisReview().summary); setError(''); if (user)
        projectRequest(user, `/api/projects/analysis-review?${new URLSearchParams({ projectId })}`).then(data => { if (active) {
            setReview(data.review);
            setDraft(data.review.summary);
        } }).catch(e => { if (active)
            setError(e.message); }); return () => { active = false; }; }, [projectId, user]);
    const save = async (body: Record<string, unknown>) => { if (!user || busy || locked)
        return; const scope = current.current; setBusy(true); setError(''); try {
        const data = await projectRequest(user, '/api/projects/analysis-review', { projectId, locale, ...body });
        if (current.current !== scope)
            return;
        setReview(data.review);
        if (body.action === 'summary')
            setDraft(data.review.summary);
        if (body.action === 'add')
            setText('');
        setError('review.saved');
    }
    catch (e) {
        if (current.current === scope)
            setError(e instanceof Error ? e.message : 'review.failed');
    }
    finally {
        if (current.current === scope)
            setBusy(false);
    } };
    return <details id="analysis-review" className="mt-3 rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold">{t('review.title')}</summary><div className="mt-3 space-y-3">
  <p className="text-xs text-slate-500">{t('review.private')}</p>
  <div className="flex flex-wrap gap-2"><button type="button" className="spatial-button text-xs" disabled={busy || locked || (!selection&&!point)} onClick={() => void save(selection?{ action: 'add', kind: 'location', selection }:{action:'add',kind:'observation',text:`${t('gis.selectedPoint')}: ${point?.join(', ')}`})}>{t('review.saveLocation')}</button><button type="button" className="spatial-button text-xs" disabled={busy || locked || !result} onClick={() => void save({ action: 'add', kind: 'calculation', result })}>{t('review.saveCalculation')}</button></div>
  <ul className="max-h-56 space-y-2 overflow-auto">{review.findings.map(f => <li key={f.id} className="rounded border p-2 text-xs"><div className="flex justify-between gap-2"><strong>{t(`review.kind.${f.kind}`)}</strong><button type="button" disabled={busy || locked} onClick={() => { if (window.confirm(t('review.deleteConfirm')))
        void save({ action: 'delete', id: f.id }); }}>{t('common.delete')}</button></div><p className="whitespace-pre-line break-words">{f.text}</p>{f.sources?.length && <p className="break-all text-slate-500">{t('review.sources')}: {f.sources.join(', ')}</p>}</li>)}</ul>
  <label className="grid gap-1 text-xs">{t('review.kind')}<select aria-label={t("review.kind")} value={kind} onChange={e => setKind(e.target.value as FindingKind)} disabled={busy || locked} className="min-h-11 rounded border p-2">{['observation', 'issue', 'opportunity', 'interpretation'].map(k => <option key={k} value={k}>{t(`review.kind.${k}`)}</option>)}</select></label>
  <textarea aria-label={t('review.note')} value={text} onChange={e => setText(e.target.value)} maxLength={1500} disabled={busy || locked} className="min-h-20 w-full rounded border p-2 text-sm"/>
  <button type="button" className="spatial-button text-xs" disabled={busy || locked || !text.trim()} onClick={() => void save({ action: 'add', kind, text })}>{t('review.add')}</button>
  <h4 className="text-sm font-semibold">{t('review.summary')}</h4><button type="button" className="spatial-button text-xs" disabled={busy||locked||!review.findings.length||Object.values(draft).some(value=>value.trim())} onClick={()=>{const section=(kinds:FindingKind[])=>review.findings.filter(f=>kinds.includes(f.kind)).map(f=>`[${t(`review.kind.${f.kind}`)}] ${f.text}`).join('\n').slice(0,3000);setDraft({conditions:section(['location','calculation']),issues:section(['observation','issue']),opportunities:section(['opportunity','interpretation'])});}}>{t('review.makeDraft')}</button><p className="text-xs text-slate-500">{t('review.summaryHint')}</p>
  {(['conditions', 'issues', 'opportunities'] as const).map(key => <label key={key} className="grid gap-1 text-xs">{t(`review.${key}`)}<textarea aria-label={t(`review.${key}`)} value={draft[key]} onChange={e => setDraft(prev => ({ ...prev, [key]: e.target.value }))} disabled={busy || locked} maxLength={3000} className="min-h-20 w-full rounded border p-2 text-sm"/></label>)}
  <button type="button" className="spatial-button text-xs" disabled={busy || locked} onClick={() => void save({ action: 'summary', summary: draft })}>{t('review.saveSummary')}</button>
  {error && <p role="status" className="text-xs">{localize(error, 'review.failed')}</p>}
 </div></details>;
}
