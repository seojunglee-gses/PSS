import type { SpatialResult } from "./types";
import { metricValue } from "./labels";

export const spatialGoals: {
  type: SpatialResult["type"];
  name: string;
  description: string;
  technicalName: string;
}[] = [
  {
    type: "area",
    name: "이 지역의 특징 보기",
    description:
      "선택한 지역의 면적, 건물 수, 토지이용 등 기본 특성을 확인합니다.",
    technicalName: "영역 통계",
  },
  {
    type: "buffer",
    name: "주변 영향권 보기",
    description:
      "특정 시설이나 공간을 기준으로 일정 거리 안의 대상을 확인합니다.",
    technicalName: "버퍼 분석",
  },
  {
    type: "intersection",
    name: "공간 겹침 비교",
    description: "두 공간정보 레이어가 어디에서 겹치는지 확인합니다.",
    technicalName: "중첩 분석",
  },
  {
    type: "priority",
    name: "우선 검토 지역 찾기",
    description: "여러 조건을 함께 적용해 우선적으로 살펴볼 지역을 찾습니다.",
    technicalName: "우선지역 분석",
  },
];

// Describe supplied results only; unavailable metrics are deliberately omitted.
export function spatialResultSummary(result: SpatialResult): string[] {
  const lines: string[] = [];
  const has = (key: string) => Number.isFinite(result.metrics[key]);
  const value = (key: string) => metricValue(key, result.metrics[key]);
  if (result.type === "intersection" && has("intersectionAreaSqm")) {
    lines.push(
      result.metrics.intersectionAreaSqm === 0
        ? "두 공간이 겹치는 영역이 없습니다."
        : `두 공간이 겹치는 면적은 ${value("intersectionAreaSqm")}m²입니다.`,
    );
  } else if (result.type === "priority" && has("priorityCount")) {
    lines.push(
      `설정된 조건으로 ${value("priorityCount")}개 지역의 검토 순위를 계산했습니다.`,
    );
    if (result.priorities?.length)
      lines.push(
        `우선 검토할 지역은 ${result.priorities[0].featureId}입니다. 상세 정보에서 순위와 점수를 확인하세요.`,
      );
  } else if (result.type === "area" || result.type === "buffer") {
    if (
      result.type === "buffer" &&
      typeof result.parameters.distanceMeters === "number"
    )
      lines.push(
        `선택한 대상에서 ${result.parameters.distanceMeters.toLocaleString("ko-KR")}m 이내의 영역을 확인했습니다.`,
      );
    if (has("areaSqm"))
      lines.push(`분석 영역의 면적은 ${value("areaSqm")}m²입니다.`);
    if (has("buildingCount"))
      lines.push(
        `영역 안에 있거나 걸친 건물은 ${value("buildingCount")}동입니다.`,
      );
    if (has("facilityCount"))
      lines.push(
        `영역 안에 있거나 걸친 공공시설은 ${value("facilityCount")}곳입니다.`,
      );
    if (has("greenRatio"))
      lines.push(
        `분석 영역에서 녹지가 차지하는 비율은 ${value("greenRatio")}입니다.`,
      );
    if (has("population"))
      lines.push(`집계할 수 있는 인구는 ${value("population")}명입니다.`);
  }
  return lines.length
    ? lines
    : ["계산 결과는 상세 정보에서 확인할 수 있습니다."];
}
