import { useI18n } from "../../lib/i18n";
import type { SpatialResult } from "../../lib/spatial/types";
import { metricLabel, metricValue } from "../../lib/spatial/labels";
import { spatialGoals, spatialResultSummary } from "../../lib/spatial/goals";
export default function SpatialSummary({ result }: { result: SpatialResult }) {
  const { t, locale, localize } = useI18n();
  const parameterLabels: Record<string, string> = {
    distanceMeters: t("spatial.distanceParameter"),
    selectedLayerId: t("spatial.selectedLayer"),
    selectedFeatureId: t("spatial.selectedFeature"),
    layerA: t("spatial.baseLayer"),
    layerB: t("spatial.compareLayer"),
    criteria: t("spatial.criteria"),
  };
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        {localize(spatialGoals.find((goal) => goal.type === result.type)?.name ?? "")} ·{" "}
        {new Date(result.timestamp).toLocaleString(locale, {
          timeZone: "Asia/Seoul",
        })}
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {spatialResultSummary(result).map((line, i) => (
          <li key={i}>{localize(line)}</li>
        ))}
      </ul>
      <details className="space-y-2 text-xs text-slate-500">
        <summary className="cursor-pointer">
          {t("spatial.details")}</summary>
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {Object.entries(result.metrics).map(([key, value]) => (
            <div key={key}>
              <dt className="text-slate-500">{localize(metricLabel(key))}</dt>
              <dd className="font-semibold">{metricValue(key, value)}</dd>
            </div>
          ))}
        </dl>
        {result.priorities && (
          <ol className="max-h-48 overflow-y-auto text-sm">
            {result.priorities.map((p, i) => (
              <li key={i}>
                {t("spatial.priorityScore", { id: p.featureId, score: p.score.toFixed(3) })}
              </li>
            ))}
          </ol>
        )}
        {[
          ...result.notes,
          ...(result.buildingUses ?? []).map(
            (group) =>
              t("spatial.buildingUse", { name: group.use_name, code: group.use_code || t("spatial.none"), count: group.count.toLocaleString(locale) }),
          ),
        ].map((note, i) => (
          <p key={i} className="text-xs text-slate-500">
            {localize(note)}
          </p>
        ))}
        <p className="mt-2 break-all">
          {t("spatial.usedLayers")}{result.layerIds.join(", ") || t("spatial.none")}
        </p>
        <dl className="mt-1 space-y-1">
          {Object.entries(result.parameters).map(([key, value]) => (
            <div className="break-all" key={key}>
              <dt className="font-medium">{parameterLabels[key] ?? key}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
