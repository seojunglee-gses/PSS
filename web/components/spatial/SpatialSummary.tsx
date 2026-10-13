import type { SpatialResult } from "../../lib/spatial/types";
import { metricLabel, metricValue } from "../../lib/spatial/labels";
import { spatialGoals, spatialResultSummary } from "../../lib/spatial/goals";
export default function SpatialSummary({ result }: { result: SpatialResult }) {
  const parameterLabels: Record<string, string> = {
    distanceMeters: "주변 범위 (m)",
    selectedLayerId: "선택한 레이어",
    selectedFeatureId: "선택한 도형",
    layerA: "기준 공간",
    layerB: "비교할 공간",
    criteria: "우선순위 기준",
  };
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        {spatialGoals.find((goal) => goal.type === result.type)?.name} ·{" "}
        {new Date(result.timestamp).toLocaleString("ko-KR", {
          timeZone: "Asia/Seoul",
        })}
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {spatialResultSummary(result).map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      <details className="space-y-2 text-xs text-slate-500">
        <summary className="cursor-pointer">
          상세 정보 · 분석 범위와 설정
        </summary>
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {Object.entries(result.metrics).map(([key, value]) => (
            <div key={key}>
              <dt className="text-slate-500">{metricLabel(key)}</dt>
              <dd className="font-semibold">{metricValue(key, value)}</dd>
            </div>
          ))}
        </dl>
        {result.priorities && (
          <ol className="max-h-48 overflow-y-auto text-sm">
            {result.priorities.map((p, i) => (
              <li key={i}>
                도형 {p.featureId} · 우선순위 점수 {p.score.toFixed(3)}
              </li>
            ))}
          </ol>
        )}
        {[
          ...result.notes,
          ...(result.buildingUses ?? []).map(
            (group) =>
              `${group.use_name} · 코드 ${group.use_code || "없음"}: ${group.count.toLocaleString("ko-KR")}동`,
          ),
        ].map((note, i) => (
          <p key={i} className="text-xs text-slate-500">
            {note}
          </p>
        ))}
        <p className="mt-2 break-all">
          참고한 레이어: {result.layerIds.join(", ") || "없음"}
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
