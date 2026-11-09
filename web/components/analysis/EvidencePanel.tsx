import { useI18n } from "../../lib/i18n";
import { researchLabels } from "../../lib/research/labels";
import type { AnalysisRecord, EvidenceSource, Finding } from "../../lib/research/types";

// A reading preview of already retrieved text; retrieval and stored originals stay unchanged.
function relevantSnippet(text: string, question: string, relevanceTerms: string[] = []) {
  const terms = [...new Set([...relevanceTerms, ...(question.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])])]
    .map(term => term.toLowerCase()).filter(term => !["the", "and", "this", "what", "does", "with", "어떤", "이런", "있는", "자료", "사례"].includes(term));
  const sentences = text.replace(/\r/g, "").split(/(?<=[.!?。！？])\s+|\n+/u).map(value => value.trim()).filter(Boolean);
  const ranked = sentences.map((value, index) => ({ value, index, score: terms.filter(term => value.toLowerCase().includes(term)).length }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = ranked.filter(item => item.score > 0).slice(0, 2);
  const preview = (selected.length ? selected : ranked.slice(0, 2)).sort((a, b) => a.index - b.index).map(({ value }) => {
    if (value.length <= 240) return value;
    const hit = terms.map(term => value.toLowerCase().indexOf(term)).find(index => index >= 0) ?? 0;
    const start = Math.max(0, hit - 70);
    return `${start ? "…" : ""}${value.slice(start, start + 240).trim()}${start + 240 < value.length ? "…" : ""}`;
  }).join(" … ");
  return preview.length > 360 ? `${preview.slice(0, 357).trim()}…` : preview;
}

export default function EvidencePanel({ evidence, enabled, loading, highlighted, onViewCase, onViewPaper, onViewProject, availableCaseIds = [], researchFindings = [], caseFindings = [] }: {
  evidence: AnalysisRecord["evidence"] | null; enabled: EvidenceSource[]; loading: boolean; highlighted: string | null;
  onViewPaper?: (paper: NonNullable<AnalysisRecord["evidence"]>["papers"][number]) => void;
  onViewProject?: () => void;
  onViewCase?: (caseId: string) => void;
  availableCaseIds?: string[];
  researchFindings?: Finding[];
  caseFindings?: Finding[];
}) {
  const { locale,t } = useI18n();
  const labels = researchLabels(locale);
  const snippetLabel = locale === "ko" ? "핵심 근거" : locale === "zh" ? "核心依据" : "Key evidence";
  const originalLabel = locale === "ko" ? "원문 보기" : locale === "zh" ? "查看原文" : "View original";
  const papers = evidence?.papers ?? [];
  const years = papers.flatMap((p) => p.year ? [p.year] : []);
  const topics = new Map<string, number>();
  papers.forEach((p) => new Set(p.topics).forEach((topic) => topics.set(topic, (topics.get(topic) ?? 0) + 1)));
  const topTopics = [...topics].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const cardClass = (id: string) => `rounded-2xl border p-4 ${highlighted === id ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-slate-50"}`;
  return <div className="evidence-panel p-4" aria-busy={loading}>
    {loading && <p role="status" className="mt-3 text-sm text-blue-700">{labels.loading}</p>}
    {!evidence && !loading && <p className="mt-3 text-sm text-slate-500">{labels.noAnswer}</p>}
    {evidence?.warnings.filter((w) => enabled.includes(w.source)).map((warning, index) => <p key={index} role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{warning.message}</p>)}
    {evidence?.projectContext && enabled.includes("project") && <section className="mt-5" aria-label={labels.project}>
      <h4 className="font-semibold text-slate-800">{labels.project}</h4>
      <p className="mt-2 text-xs font-semibold text-blue-700">{snippetLabel}</p>
      <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{relevantSnippet(evidence.projectContext, evidence.question)}</p>
      <details className="mt-2" onToggle={event => { if (event.currentTarget.open) onViewProject?.(); }}><summary className="cursor-pointer text-sm text-blue-700">{originalLabel}</summary><p className="mt-2 whitespace-pre-line text-sm text-slate-600">{evidence.projectContext}</p></details>
    </section>}
    {evidence && enabled.includes("cases") && evidence.cases.length > 0 && <section className="mt-5" aria-label={labels.caseEvidence}>
      <h4 className="font-semibold text-slate-800">{labels.caseEvidence}</h4>
      <p className="mt-1 text-xs text-slate-500">{new Set(evidence.cases.map(c=>c.id)).size} {labels.caseCount}</p>
      <div className="mt-3 space-y-3">{evidence?.cases.map((c) => <article key={c.sourceId} id={`evidence-${c.sourceId}`} className={cardClass(c.sourceId)}>
        <h5 className="mt-1 font-semibold">{c.title}</h5>
        <p className="mt-1 break-words text-xs text-slate-500">{c.fileName || c.documentTitle || labels.projectMaterial}{c.page ? ` · p.${c.page}` : c.paragraph ? ` · ${t('caseSource.paragraph', {paragraph: c.paragraph})}` : ""}</p>
        <p className="mt-2 text-xs font-semibold text-blue-700">{snippetLabel}</p>
        <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{relevantSnippet(caseFindings.filter(finding => finding.sourceIds.includes(c.sourceId)).map(finding => finding.text.replace(/\[(?:[CR]:)[^\[\]]+\]/g, "")).join("\n") || c.text, evidence.question, c.relevanceTerms)}</p>
        <details className="mt-2 text-sm text-slate-600"><summary className="cursor-pointer text-blue-700">{originalLabel}</summary><p className="mt-2 whitespace-pre-line">{c.text}</p></details>
        {onViewCase && availableCaseIds.includes(c.id) && <button type="button" onClick={() => onViewCase(c.id)} className="mt-3 rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-semibold text-blue-700">{labels.fullCase}</button>}
      </article>)}</div>
    </section>}
    {evidence && enabled.includes("research") && papers.length > 0 && <section className="mt-5 border-t border-slate-200 pt-5" aria-label={labels.researchEvidence}>
      <h4 className="font-semibold text-slate-800">{labels.researchEvidence}</h4>
      <p className="mt-2 text-xs font-semibold text-blue-700">{labels.scope}</p>
      <p className="mt-1 text-xs text-slate-500">{labels.scopeDetail}</p>
      {papers.length > 0 && <>
        <div className="mt-3 rounded-xl bg-blue-50 p-3 text-sm">
          <p className="font-semibold">{papers.length} {labels.paperCount}</p>
          <p className="mt-1">{labels.period}: {years.length ? `${Math.min(...years)}–${Math.max(...years)}` : labels.unknown}</p>
          {topTopics.length > 0 && <p className="mt-1">{labels.topics}: {topTopics.map(([topic]) => topic).join(" · ")}</p>}
        </div>
        <div className="mt-3 space-y-3">{papers.map((p) => <article key={p.sourceId} id={`evidence-${p.sourceId}`} className={cardClass(p.sourceId)}>
          <p className="text-xs text-blue-700">[{p.sourceId}]</p><h5 className="mt-1 font-semibold">{p.title}</h5>
          <p className="mt-2 text-xs text-slate-600">{p.authors.length ? p.authors.join(", ") : labels.authorUnknown}</p>
          <p className="mt-1 text-xs text-slate-500">{p.year ?? labels.unknown} · {p.journal ?? labels.unknown}</p>
          {researchFindings.some(finding => finding.sourceIds.includes(p.sourceId)) && <>
            <p className="mt-2 text-xs font-semibold text-blue-700">{snippetLabel}</p>
            <p className="mt-1 text-sm text-slate-600">{relevantSnippet(researchFindings.filter(finding => finding.sourceIds.includes(p.sourceId)).map(finding => finding.text.replace(/\[(?:[CR]:)[^\[\]]+\]/g, "")).join("\n"), evidence.question)}</p>
          </>}
          <details onToggle={event => { if (event.currentTarget.open) onViewPaper?.(p); }} className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer font-semibold">{labels.paperDetails}</summary>
          {researchFindings.some((finding) => finding.sourceIds.includes(p.sourceId)) && <section className="mt-3 text-sm text-slate-700">
            <h6 className="font-semibold">{labels.researchFindings}</h6>
            <ul className="mt-1 space-y-2">{researchFindings.filter((finding) => finding.sourceIds.includes(p.sourceId)).map((finding, index) => <li key={index} className="whitespace-pre-line">{finding.text.replace(/\[(?:[CR]:)[^\[\]]+\]/g, "")}</li>)}</ul>
          </section>}
          <p className="mt-2">{p.citationCount} {labels.citations}</p>
          <p className="mt-1 text-xs text-slate-500">{labels.openAccess}: {p.openAccess === null ? labels.unknown : p.openAccess ? "✓" : "—"}</p>
          <p className="mt-2 text-xs text-slate-600">{p.usedInAnswer ? labels.used : labels.metadata}</p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-blue-700">
            {p.doi && <a href={p.doi} target="_blank" rel="noopener noreferrer" className="underline">DOI</a>}
            <a href={p.openAlexId} target="_blank" rel="noopener noreferrer" className="underline">OpenAlex</a>
          </div>
          </details>
        </article>)}</div>
      </>}
    </section>}
  </div>;
}
