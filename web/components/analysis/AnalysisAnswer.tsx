import { useI18n } from "../../lib/i18n";
import { researchLabels } from "../../lib/research/labels";
import type { AnalysisAnswer as Answer, Finding } from "../../lib/research/types";
import { inlineSourceIds, usedSourceIds } from "../../lib/research/types";

export default function AnalysisAnswer({ answer, onViewEvidence, additionalSources = [] }: { answer: Answer; additionalSources?: ("project" | "spatial")[]; onViewEvidence: (sourceId?: string) => void }) {
  const { locale } = useI18n();
  const labels = researchLabels(locale);
  const cited = usedSourceIds(answer);
  const sources = answer.sources.filter((source) => cited.has(source.sourceId));
  const citation = (id: string, key: string) => {
    const source = sources.find((item) => item.sourceId === id);
    if (!source) return null;
    return <button key={key} type="button" onClick={() => onViewEvidence(id)}
      title={`${labels.view}: ${source.title}`} aria-label={`${labels.view}: ${source.title}`}
      className="mx-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-blue-700 align-middle hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-blue-600 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4"><path d="M12 5v15M3 4c3-1 6-1 9 1 3-2 6-2 9-1v15c-3-1-6-1-9 1-3-2-6-2-9-1z" /></svg>
    </button>;
  };
  const renderText = (text: string) => text.split(/(\[(?:[CR]:)[^\[\]]+\])/g).map((part, index) =>
    /^\[(?:[CR]:)/.test(part)
      ? <span key={index} className="inline-flex max-w-full flex-wrap align-middle">{inlineSourceIds(part).map((id, sourceIndex) => citation(id, `${index}-${sourceIndex}`))}</span>
      : part,
  );
  const textSection = (title: string, text: string) => text && <section className="mt-3"><h4 className="font-semibold">{title}</h4><p className="mt-1 whitespace-pre-line">{renderText(text)}</p></section>;
  const findings = (title: string, items: Finding[]) => items.length > 0 && <section className="mt-3"><h4 className="font-semibold">{title}</h4>
    <ul className="mt-1 space-y-2">{items.map((finding, index) => <li key={index} className="whitespace-pre-line">
      {renderText(finding.text)}
      {finding.sourceIds.filter((id) => !inlineSourceIds(finding.text).includes(id)).map((id) => citation(id, id))}
    </li>)}</ul>
  </section>;
  return <div className="mt-2 break-words text-sm">
    {textSection(labels.summary, answer.summary)}
    {findings(labels.caseFindings, answer.caseFindings)}
    {textSection(labels.integrated, answer.integratedInterpretation || [answer.agreement, answer.differences].filter(Boolean).join("\n\n"))}
    {answer.projectImplications.length > 0 && <section className="mt-3"><h4 className="font-semibold">{labels.implications}</h4><ul className="mt-1 list-disc space-y-1 pl-4">{answer.projectImplications.map((text, index) => <li key={index}>{renderText(text)}</li>)}</ul></section>}
    {textSection(labels.limitations, answer.limitations)}
    {(sources.length > 0 || additionalSources.length > 0) && <button type="button" onClick={() => onViewEvidence()} className="mt-3 rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-semibold text-blue-700">{labels.view}</button>}
  </div>;
}
