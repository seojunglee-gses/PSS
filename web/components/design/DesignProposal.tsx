import { useI18n } from "../../lib/i18n";
import type { DesignDirection } from "../../lib/design-alternatives";
export default function DesignProposal({ direction, busy, onConfirm, onRevise }: { direction: DesignDirection; busy: boolean; onConfirm: () => void; onRevise: () => void }) {
  const { t } = useI18n();
  return <section aria-label={t("design.proposalTitle")} className="mb-4 rounded-2xl border border-blue-100 bg-blue-50/50 p-4 text-slate-700">
    <p className="font-semibold text-blue-950">{direction.introduction}</p>
    <ol className="my-3 list-decimal space-y-3 pl-5">{direction.interventions.map((item, index) => <li key={index}><span className="font-semibold text-blue-950">{item.text}</span><span className="ml-2 text-xs text-slate-500">{t(item.origin === "participant" ? "design.participantChoice" : "design.aiProposal")}</span><p className="mt-1 text-xs leading-relaxed text-slate-500">{item.basis}</p></li>)}</ol>
    {direction.question && <p className="mb-3">{direction.question}</p>}
    <p className="mb-3 text-sm">{t(direction.confirmedAt ? "design.confirmedGuide" : "design.proposalGuide")}</p>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className="min-h-11 rounded-full bg-[var(--primary)] px-4 py-2 font-semibold text-white disabled:opacity-50" onClick={onConfirm}>{t("design.confirm")}</button><button type="button" disabled={busy} className="min-h-11 rounded-full border border-blue-200 bg-white px-4 py-2 font-semibold text-blue-900 disabled:opacity-50" onClick={onRevise}>{t("design.revise")}</button></div>
  </section>;
}
