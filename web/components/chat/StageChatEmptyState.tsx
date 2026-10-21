import { useI18n } from "../../lib/i18n";
import type { StageChatGuide } from "../../lib/stage-chat-guides";

export default function StageChatEmptyState({ guide, disabled, onSubmit }: {
  guide: StageChatGuide;
  disabled: boolean;
  onSubmit: (question: string) => void;
}) {
  const { locale } = useI18n();
  return (
    <div className="space-y-4 py-2" data-testid="stage-chat-guide">
      <div>
        <h4 className="text-base font-semibold leading-relaxed text-slate-700">{guide.title}</h4>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">{guide.description}</p>
      </div>
      <p className="text-sm font-semibold text-slate-700">{locale === "ko" ? "이런 질문을 해보세요" : locale === "zh" ? "可以这样提问" : "Try asking"}</p>
      <div className="grid gap-2">
        {guide.suggestedQuestions.map((question) => (
          <button key={question} type="button" disabled={disabled} onClick={() => onSubmit(question)}
            className="flex min-h-11 min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-sm leading-relaxed text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5 shrink-0"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" /></svg>
            <span className="min-w-0 flex-1">{question}</span><span aria-hidden="true" className="shrink-0 text-slate-400">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}
