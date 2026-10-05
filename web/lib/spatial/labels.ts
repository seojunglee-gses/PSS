export const metricLabels: Record<string, string> = {
  areaSqm: "선택 면적 (m²)",
  buildingCount: "건물 수",
  buildingFootprintSqm: "건물 면적 (m²)",
  greenAreaSqm: "녹지 면적 (m²)",
  greenRatio: "녹지 비율",
  population: "인구",
  facilityCount: "공공시설 수",
  intersectionAreaSqm: "중첩 면적 (m²)",
  priorityCount: "분석 지역 수",
};
export const analysisTypeLabels: Record<string, string> = {
  area: "영역 통계",
  buffer: "버퍼 분석",
  intersection: "중첩 분석",
  priority: "우선 검토 지역",
};
export function metricLabel(key: string) {
  const parts = key.split(":");
  return (
    metricLabels[key] ??
    (parts[0] === "average"
      ? `${parts[1]} · ${parts[2]} 평균`
      : parts[0] === "averageCount"
        ? `${parts[1]} · ${parts[2]} 집계 수`
        : key)
  );
}
export function metricValue(key: string, value: number) {
  return (
    (key === "greenRatio" ? value * 100 : value).toLocaleString("ko-KR", {
      maximumFractionDigits: 2,
    }) + (key === "greenRatio" ? "%" : "")
  );
}
