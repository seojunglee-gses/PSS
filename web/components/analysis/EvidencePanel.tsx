import { useI18n } from "../../lib/i18n";
import { researchLabels } from "../../lib/research/labels";
import type { AnalysisRecord, EvidenceSource } from "../../lib/research/types";

export default function EvidencePanel({ evidence, enabled, loading, highlighted }: {
  evidence: AnalysisRecord["evidence"] | null; enabled: EvidenceSource[]; loading: boolean; highlighted: string | null;
}) {
  const { locale } = useI18n();
  const labels = researchLabels(locale);
  const papers = evidence?.papers ?? [];
  const years = papers.flatMap((p) => p.year ? [p.year] : []);
  const topics = new Map<string, number>();
  papers.forEach((p) => new Set(p.topics).forEach((topic) => topics.set(topic, (topics.get(topic) ?? 0) + 1)));
  const topTopics = [...topics].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const notable = [...papers].sort((a, b) => b.citationCount - a.citationCount).slice(0, 3);
  const cardClass = (id: string) => `rounded-2xl border p-4 ${highlighted === id ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-slate-50"}`;
  return <div className="max-h-[70vh] overflow-y-auto p-6" aria-busy={loading}>
    <h3 className="text-lg font-semibold text-slate-900">{labels.evidence}</h3>
    {loading && <p role="status" className="mt-3 text-sm text-blue-700">{labels.loading}</p>}
    {evidence && <p className="mt-2 break-words text-xs text-slate-500">{labels.question}: {evidence.question}</p>}
    {!evidence && !loading && <p className="mt-3 text-sm text-slate-500">{labels.empty}</p>}
    {evidence?.warnings.filter((w) => enabled.includes(w.source)).map((warning, index) => <p key={index} role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{warning.message}</p>)}
    {enabled.includes("cases") && <section className="mt-5" aria-label={labels.caseEvidence}>
      <h4 className="font-semibold text-slate-800">{labels.caseEvidence}</h4>
      <div className="mt-3 space-y-3">{evidence?.cases.map((c) => <article key={c.sourceId} id={`evidence-${c.sourceId}`} className={cardClass(c.sourceId)}>
        <p className="text-xs text-blue-700">[{c.sourceId}] · {labels.projectMaterial}</p>
        <h5 className="mt-1 font-semibold">{c.title}</h5>
        <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{c.text}</p>
        <p className="mt-2 text-xs text-slate-500">{c.relevanceTerms.length ? `${labels.why}: ${c.relevanceTerms.join(", ")}` : labels.contextual}</p>
      </article>)}</div>
    </section>}
    {enabled.includes("research") && <section className="mt-5 border-t border-slate-200 pt-5" aria-label={labels.researchEvidence}>
      <h4 className="font-semibold text-slate-800">{labels.researchEvidence}</h4>
      <p className="mt-2 text-xs font-semibold text-blue-700">{labels.scope}</p>
      <p className="mt-1 text-xs text-slate-500">{labels.scopeDetail}</p>
      {papers.length > 0 && <>
        <div className="mt-3 rounded-xl bg-blue-50 p-3 text-sm">
          <p className="font-semibold">{papers.length} {labels.papers}</p>
          <p className="mt-1">{labels.period}: {years.length ? `${Math.min(...years)}–${Math.max(...years)}` : labels.unknown}</p>
          <p>{labels.openAccess}: {papers.filter((p) => p.openAccess === true).length} / {papers.length}</p>
          {papers.some((p) => p.openAccess === null) && <p className="text-xs text-slate-500">{labels.unknown}: {papers.filter((p) => p.openAccess === null).length}</p>}
          {topTopics.length > 0 && <p className="mt-1">{labels.topics}: {topTopics.map(([topic]) => topic).join(" · ")}</p>}
        </div>
        <details className="mt-3 text-xs text-slate-600"><summary className="cursor-pointer font-semibold">{labels.notable}</summary><ol className="mt-2 list-decimal space-y-1 pl-4">{notable.map((p) => <li key={p.sourceId}>{p.title} — {p.citationCount} {labels.citations}</li>)}</ol></details>
        <div className="mt-3 space-y-3">{papers.map((p) => <article key={p.sourceId} id={`evidence-${p.sourceId}`} className={cardClass(p.sourceId)}>
          <p className="text-xs text-blue-700">[{p.sourceId}]</p><h5 className="mt-1 font-semibold">{p.title}</h5>
          <p className="mt-2 text-xs text-slate-600">{p.authors.length ? p.authors.join(", ") : labels.authorUnknown}</p>
          <p className="mt-1 text-xs text-slate-500">{p.year ?? labels.unknown} · {p.journal ?? labels.unknown} · {p.citationCount} {labels.citations}</p>
          <p className="mt-1 text-xs text-slate-500">{labels.openAccess}: {p.openAccess === null ? labels.unknown : p.openAccess ? "✓" : "—"}</p>
          <p className="mt-2 text-xs text-slate-600">{p.usedInAnswer ? labels.used : labels.metadata}</p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-blue-700">
            {p.doi && <a href={p.doi} target="_blank" rel="noopener noreferrer" className="underline">DOI</a>}
            <a href={p.openAlexId} target="_blank" rel="noopener noreferrer" className="underline">OpenAlex</a>
          </div>
        </article>)}</div>
      </>}
    </section>}
  </div>;
}
