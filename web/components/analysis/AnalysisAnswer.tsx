import { useI18n } from "../../lib/i18n";
import { researchLabels } from "../../lib/research/labels";
import type { AnalysisAnswer as Answer, Finding } from "../../lib/research/types";

export default function AnalysisAnswer({ answer, onViewEvidence }: { answer: Answer; onViewEvidence: (sourceId?: string) => void }) {
  const { locale } = useI18n();
  const labels = researchLabels(locale);
  const textSection = (title: string, text: string) => text && <section className="mt-3"><h4 className="font-semibold">{title}</h4><p className="mt-1 whitespace-pre-line">{text}</p></section>;
  const findings = (title: string, items: Finding[]) => items.length > 0 && <section className="mt-3"><h4 className="font-semibold">{title}</h4>
    <ul className="mt-1 space-y-2">{items.map((finding, index) => <li key={index}>
      <p className="whitespace-pre-line">{finding.text}</p>
      <div className="mt-1 flex flex-wrap gap-1">{finding.sourceIds.map((id) => <button key={id} type="button" onClick={() => onViewEvidence(id)} className="rounded bg-white px-2 py-0.5 text-xs text-blue-700 underline" aria-label={`${labels.view}: ${id}`}>[{id}]</button>)}</div>
    </li>)}</ul>
  </section>;
  return <div className="mt-2 text-sm">
    {answer.sources.some((source) => source.kind === "research") && <p className="rounded-lg bg-white px-2 py-1 text-xs text-blue-700">{labels.scope}</p>}
    {textSection(labels.summary, answer.summary)}
    {findings(labels.caseFindings, answer.caseFindings)}
    {findings(labels.researchFindings, answer.researchFindings)}
    {textSection(labels.agreement, answer.agreement)}
    {textSection(labels.differences, answer.differences)}
    {textSection(labels.integrated, answer.integratedInterpretation)}
    {answer.projectImplications.length > 0 && <section className="mt-3"><h4 className="font-semibold">{labels.implications}</h4><ul className="mt-1 list-disc space-y-1 pl-4">{answer.projectImplications.map((text, index) => <li key={index}>{text}</li>)}</ul></section>}
    {textSection(labels.limitations, answer.limitations)}
    {answer.sources.length > 0 && <section className="mt-3"><h4 className="font-semibold">{labels.sources}</h4><ul className="mt-1 space-y-2">
      {answer.sources.map((source) => <li key={source.sourceId} className="text-xs">
        <button type="button" onClick={() => onViewEvidence(source.sourceId)} className="text-left text-blue-700 underline">[{source.sourceId}] {source.title}</button>
        {source.year && <span> ({source.year})</span>}
        {source.authors.length > 0 && <p>{source.authors.join(", ")}</p>}
        {(source.doi || source.openAlexId) && <a className="block break-all text-blue-700 underline" href={source.doi || source.openAlexId!} target="_blank" rel="noopener noreferrer">{source.doi || source.openAlexId}</a>}
      </li>)}
    </ul></section>}
  </div>;
}
