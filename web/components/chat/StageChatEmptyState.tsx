import type { StageChatGuide } from "../../lib/stage-chat-guides";

export default function StageChatEmptyState({ guide, disabled, onSubmit }: {
  guide: StageChatGuide;
  disabled: boolean;
  onSubmit: (question: string) => void;
}) {
  return (
    <div className="space-y-4 py-2" data-testid="stage-chat-guide">
      <div>
        <h4 className="text-base font-semibold leading-relaxed text-slate-700">{guide.title}</h4>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">{guide.description}</p>
      </div>
      <div className="grid gap-2">
        {guide.suggestedQuestions.map((question) => (
          <button key={question} type="button" disabled={disabled} onClick={() => onSubmit(question)}
            className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-sm leading-relaxed text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
            {question}
          </button>
        ))}
      </div>
    </div>
  );
}
