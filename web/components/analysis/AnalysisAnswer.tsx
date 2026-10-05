import { useI18n } from "../../lib/i18n";
import { researchLabels } from "../../lib/research/labels";
import type { AnalysisAnswer as Answer, Finding } from "../../lib/research/types";
import { usedSourceIds } from "../../lib/research/types";

export default function AnalysisAnswer({ answer, onViewEvidence, additionalSources = [] }: { answer: Answer; additionalSources?: ("project" | "spatial")[]; onViewEvidence: (sourceId?: string) => void }) {
  const { locale } = useI18n();
  const labels = researchLabels(locale);
  const cited = usedSourceIds(answer);
  const sources = answer.sources.filter((source) => cited.has(source.sourceId));
  const sourceSummary = [
    ...additionalSources.map((source) => labels[source]),
    ...(sources.some((s) => s.kind === "cases") ? [`${sources.filter((s) => s.kind === "cases").length} ${labels.caseCount}`] : []),
    ...(sources.some((s) => s.kind === "research") ? [`${sources.filter((s) => s.kind === "research").length} ${labels.paperCount}`] : []),
  ].join(" · ");
  const textSection = (title: string, text: string) => text && <section className="mt-3"><h4 className="font-semibold">{title}</h4><p className="mt-1 whitespace-pre-line">{text}</p></section>;
  const findings = (title: string, items: Finding[]) => items.length > 0 && <section className="mt-3"><h4 className="font-semibold">{title}</h4>
    <ul className="mt-1 space-y-2">{items.map((finding, index) => <li key={index}>
      <p className="whitespace-pre-line">{finding.text}</p>
      <div className="mt-1 flex flex-wrap gap-1">{finding.sourceIds.map((id) => <button key={id} type="button" onClick={() => onViewEvidence(id)} className="rounded bg-white px-2 py-0.5 text-xs text-blue-700 underline" aria-label={`${labels.view}: ${id}`}>[{id}]</button>)}</div>
    </li>)}</ul>
  </section>;
  return <div className="mt-2 text-sm">
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
      {sourceSummary && <span>{labels.sourcesUsed}: {sourceSummary}</span>}
      <button type="button" onClick={() => onViewEvidence()} className="rounded-full border border-blue-200 bg-white px-3 py-1 font-semibold text-blue-700">{labels.view}</button>
    </div>
    {sources.some((source) => source.kind === "research") && <p className="rounded-lg bg-white px-2 py-1 text-xs text-blue-700">{labels.scope}</p>}
    {textSection(labels.summary, answer.summary)}
    {findings(labels.caseFindings, answer.caseFindings)}
    {findings(labels.researchFindings, answer.researchFindings)}
    {textSection(labels.agreement, answer.agreement)}
    {textSection(labels.differences, answer.differences)}
    {textSection(labels.integrated, answer.integratedInterpretation)}
    {answer.projectImplications.length > 0 && <section className="mt-3"><h4 className="font-semibold">{labels.implications}</h4><ul className="mt-1 list-disc space-y-1 pl-4">{answer.projectImplications.map((text, index) => <li key={index}>{text}</li>)}</ul></section>}
    {textSection(labels.limitations, answer.limitations)}
    {sources.length > 0 && <section className="mt-3"><h4 className="font-semibold">{labels.sourcesUsed}</h4><ul className="mt-1 space-y-2">
      {sources.map((source) => <li key={source.sourceId} className="text-xs">
        <button type="button" onClick={() => onViewEvidence(source.sourceId)} className="text-left text-blue-700 underline">[{source.sourceId}] {source.title}</button>
        {source.year && <span> ({source.year})</span>}
        {source.authors.length > 0 && <p>{source.authors.join(", ")}</p>}
        {(source.doi || source.openAlexId) && <a className="block break-all text-blue-700 underline" href={source.doi || source.openAlexId!} target="_blank" rel="noopener noreferrer">{source.doi || source.openAlexId}</a>}
      </li>)}
    </ul></section>}
  </div>;
}
