import { useI18n } from "../../lib/i18n";
import { TOP_RANKS, HEATMAP_COLORS, heatmapLevel, rankHeatmap } from "../../lib/evaluation-ranks";
export default function RankingHeatmap({ images, results, onPreview }: {
  images: { id: string; label: string }[]; results: { rankings: Record<string, number> }[]; onPreview: (id: string) => void;
}) {
  const { t, localize } = useI18n();
  const rows = rankHeatmap(images, results);
  const maximum = Math.max(0, ...rows.flatMap(row => row.counts));
  return <section aria-label={t("evaluation.heatmap")} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold text-slate-900">{t("evaluation.heatmap")}</h4><span className="text-xs text-slate-500">{t("evaluation.heatmapUnit")}</span></div>
    {!rows.length ? <p className="text-sm text-slate-500">{t("workspace.noSubmitted")}</p> : <table className="w-full table-fixed border-separate border-spacing-1" aria-label={t("evaluation.heatmap")}>
      <thead><tr><th className="w-[34%] px-1 py-2 text-left font-medium"><span className="sr-only">{t("workspace.alternative")}</span></th>{TOP_RANKS.map(rank => <th key={rank} scope="col" className="py-2 text-center text-sm font-medium text-slate-600">{t("evaluation.rankNumber", { rank })}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}><th scope="row" className="break-words pr-2 text-left font-medium text-slate-700"><button type="button" className="min-h-11 w-full break-words text-left underline-offset-4 hover:underline" title={t("home.preview", { project: localize(row.label) })} onClick={() => onPreview(row.id)}>{localize(row.label)}</button></th>{row.counts.map((count,index) => {
        const level = heatmapLevel(count,maximum);
        return <td key={TOP_RANKS[index]} className="h-11 rounded-md text-center font-medium" style={{ backgroundColor: HEATMAP_COLORS[level], color: level === 4 ? "#ffffff" : "#17324d" }} aria-label={t("evaluation.heatmapCell", { image: localize(row.label), rank: TOP_RANKS[index], count })}>{count}</td>;
      })}</tr>)}</tbody>
    </table>}
    <div className="mt-2 flex items-center justify-end gap-1.5 text-xs text-slate-500" aria-label={t("evaluation.heatmapLegend")}><span>{t("evaluation.less")}</span>{HEATMAP_COLORS.map(color => <span key={color} aria-hidden="true" className="h-3 w-5 rounded-sm" style={{backgroundColor:color}} />)}<span>{t("evaluation.more")}</span></div>
  </section>;
}
