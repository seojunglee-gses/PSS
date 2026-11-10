import { useI18n } from "../../lib/i18n";
import type { StageChatGuide } from "../../lib/stage-chat-guides";

export default function StageChatEmptyState({ guide, disabled, onSelect, showFullPrompts = false, cards = false, summaries }: {
  guide: StageChatGuide;
  disabled: boolean;
  onSelect: (prompt: string) => void;
  showFullPrompts?: boolean;
  cards?: boolean;
  summaries?: Record<string,string>;
}) {
  const { t } = useI18n();
  return (
    <div data-testid="stage-chat-guide" role="group" aria-label={t("workspace.starterPrompts")} className={`${showFullPrompts || cards ? "grid" : "flex flex-wrap"} gap-2 py-1`}>
      {guide.suggestedQuestions.map(({ label, prompt }) => (
        <button key={prompt} type="button" title={summaries ? label : prompt} disabled={disabled} onClick={() => onSelect(prompt)}
          className={`inline-flex min-h-11 min-w-11 max-w-full items-center gap-1.5 ${cards ? "w-full flex-wrap rounded-2xl text-sm" : showFullPrompts ? "w-full rounded-xl text-sm" : "rounded-full text-xs"} border border-slate-200 bg-slate-50 px-3 py-2 text-left font-medium leading-relaxed text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50`}>
          {!cards && <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4 shrink-0"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" /></svg>}
          <span className={`min-w-0 ${cards ? "w-full" : ""} break-words`}>{cards ? <><span className="flex items-center justify-between gap-3"><strong style={{fontSize:"1.1em"}}>{label}</strong><span aria-hidden="true">→</span></span><span className="mt-2 block text-sm leading-relaxed">{summaries?.[prompt]}</span></> : showFullPrompts ? prompt : label}</span>
        </button>
      ))}
    </div>
  );
}
