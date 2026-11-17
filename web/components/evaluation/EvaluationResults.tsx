import { useMemo } from "react";
import { useI18n } from "../../lib/i18n";
import { evaluationReport, TOP_RANKS } from "../../lib/evaluation-ranks";
import RankingHeatmap from "./RankingHeatmap";

const colors = ["#1e40af", "#316fae", "#b5d2ee"];
export default function EvaluationResults({ images, results, onPreview }: {
  images: { id: string; label: string; imageUrl?: string }[];
  results: { rankings: Record<string, number> }[];
  onPreview: (id: string) => void;
}) {
  const { t, localize } = useI18n();
  const { rows, winners, distribution, maximumTotal } = useMemo(() => evaluationReport(images, results), [images, results]);
  const imageById = new Map(images.map(image => [image.id, image]));
  return <div className="mt-6 min-w-0 space-y-4">
    <section className="rounded-2xl border border-slate-200 bg-white p-4" aria-label={t("evaluation.firstChoiceWinners")}>
      <h4 className="font-semibold text-slate-900">{t("evaluation.firstChoiceWinners")}</h4>
      {winners.length > 1 && <p className="mt-2 text-sm font-semibold text-blue-800">{t("evaluation.tiedWinners", { count: winners.length })}</p>}
      {!winners.length ? <p className="mt-3 text-sm text-slate-500">{t("evaluation.noFirstChoices")}</p> :
        <div className={`mt-3 grid min-w-0 gap-3 ${winners.length > 1 ? "sm:grid-cols-2" : "grid-cols-1"}`}>
          {winners.map(row => <button key={row.id} type="button" disabled={!imageById.get(row.id)?.imageUrl} className="min-w-0 rounded-xl text-left focus-visible:outline-blue-700" aria-label={t("evaluation.enlargeDesign", { image: localize(row.label) })} onClick={() => onPreview(row.id)}>
            <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl bg-slate-50">
              {imageById.get(row.id)?.imageUrl ? <img loading="lazy" src={imageById.get(row.id)!.imageUrl} alt={localize(row.label)} className="h-full w-full object-contain" /> : <span className="text-sm text-slate-500">{t("evaluation.imageUnavailable")}</span>}
            </div>
            <p className="mt-2 font-semibold text-slate-700">{localize(row.label)}</p>
            <p className="mt-1 text-sm text-slate-600">{t("evaluation.firstChoiceVotes", { count: row.counts[0] })}</p>
          </button>)}
        </div>}
    </section>
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4" aria-label={t("evaluation.distribution")}>
      <h4 className="font-semibold text-slate-900">{t("evaluation.distribution")}</h4>
      <div className="my-3 flex flex-wrap gap-4 text-sm text-slate-600">{TOP_RANKS.map((rank,index) => <span key={rank} className="flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-3 rounded-sm" style={{ backgroundColor: colors[index] }} />{t("evaluation.rankNumber", { rank })}</span>)}</div>
      {!distribution.length ? <p className="text-sm text-slate-500">{t("evaluation.noSelections")}</p> : <>
        <p className="mb-3 text-xs text-slate-500">{t("evaluation.distributionOrder")}</p>
        <div className="space-y-3">{distribution.map(row => <div key={row.id} className="grid min-w-0 grid-cols-[minmax(0,6rem)_minmax(0,1fr)] items-center gap-2">
          <button type="button" className="min-h-11 break-words text-left text-sm font-medium text-slate-700 hover:underline" onClick={() => onPreview(row.id)}>{localize(row.label)}</button>
          <div className="flex h-11 min-w-0 rounded-md bg-slate-50" aria-label={localize(row.label)}>{row.counts.map((count,index) => count > 0 && <button type="button" key={index} title={t("evaluation.heatmapCell", { image: localize(row.label), rank: index+1, count })} aria-label={t("evaluation.heatmapCell", { image: localize(row.label), rank: index+1, count })} className="min-w-0 overflow-hidden text-sm font-semibold tabular-nums focus-visible:z-10 focus-visible:outline-blue-900" style={{ width: `${count / maximumTotal * 100}%`, backgroundColor: colors[index], color: index < 2 ? "white" : "#17324d" }} onClick={() => onPreview(row.id)}><span aria-hidden="true">{count}</span></button>)}</div>
        </div>)}</div>
        <div className="ml-[6.5rem] mt-2 border-t border-slate-300 pt-1 text-xs text-slate-500"><div className="flex justify-between"><span>0</span><span>{maximumTotal}</span></div><p className="text-center">{t("evaluation.selectionAxis")}</p></div>
      </>}
    </section>
    <RankingHeatmap rows={rows} onPreview={onPreview} />
  </div>;
}
