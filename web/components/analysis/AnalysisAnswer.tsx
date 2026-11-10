import ChatMessageContent from "../chat/ChatMessageContent";
import { useI18n } from "../../lib/i18n";
import { answerEvidenceLabels, researchLabels } from "../../lib/research/labels";
import type { AnalysisAnswer as Answer, Finding } from "../../lib/research/types";
import { answerEvidenceItems } from "../../lib/research/answer-evidence";
import type { AnalysisRecord } from "../../lib/research/types";

export default function AnalysisAnswer({ answer, onViewEvidence, additionalSources = [], record }: { answer: Answer; record?: AnalysisRecord; additionalSources?: ("project" | "spatial")[]; onViewEvidence: (sourceId?: string) => void }) {
  const { locale } = useI18n();
  const labels = researchLabels(locale);
  const items = answerEvidenceItems(record ?? {answer, selectedSources: [], evidence: {question: "", selectedSources: [], cases: [], papers: [], warnings: []}});
  const count = items.length + (record ? 0 : additionalSources.filter(kind => !items.some(item => item.kind === kind)).length);
  // Keep citation IDs in the saved answer; remove only their repeated visual markers.
  const renderText = (text: string) => text.replace(/\[(?:[CR]:)[^\[\]]+\]/g, "");
  const textSection = (title: string, text: string) => text && <section className="mt-3"><h4 className="font-semibold">{title}</h4><div className="mt-1"><ChatMessageContent text={text} renderInline={renderText} /></div></section>;
  const findings = (title: string, items: Finding[]) => items.length > 0 && <section className="mt-3"><h4 className="font-semibold">{title}</h4>
    <ul className="mt-1 space-y-2">{items.map((finding, index) => <li key={index} className="whitespace-pre-line">
      <ChatMessageContent text={finding.text} renderInline={renderText} />
    </li>)}</ul>
  </section>;
  return <div className="mt-2 break-words text-sm">
    {answer.format==='direct'?<ChatMessageContent text={answer.summary} renderInline={renderText} />:textSection(labels.summary, answer.summary)}
    {answer.format!=='direct'&&findings(labels.caseFindings, answer.caseFindings)}
    {answer.format!=='direct'&&textSection(labels.integrated, answer.integratedInterpretation || [answer.agreement, answer.differences].filter(Boolean).join("\n\n"))}
    {answer.projectImplications.length > 0 && <section className="mt-3"><h4 className="font-semibold">{labels.implications}</h4><ul className="mt-1 list-disc space-y-1 pl-4">{answer.projectImplications.map((text, index) => <li key={index}><ChatMessageContent text={text} renderInline={renderText} /></li>)}</ul></section>}
    {answer.limitations && <div className="mt-3"><ChatMessageContent text={answer.limitations} renderInline={renderText} /></div>}
    {count > 0 && <button type="button" onClick={event => {event.currentTarget.focus({preventScroll: true}); onViewEvidence();}} aria-haspopup="dialog" aria-label={answerEvidenceLabels.count(count)}
      className="mt-3 inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-blue-600">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5"><path d="M12 5v15M3 4c3-1 6-1 9 1 3-2 6-2 9-1v15c-3-1-6-1-9 1-3-2-6-2-9-1z" /></svg>
      {count > 1 && <span aria-hidden="true">+ {count}</span>}
    </button>}
  </div>;
}
