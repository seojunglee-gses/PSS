import {
  area,
  bbox,
  centroid,
  buffer,
  booleanPointInPolygon,
  booleanIntersects,
  intersect,
  union,
  featureCollection,
} from "@turf/turf";
import type { Feature, Geometry } from "geojson";
import { buildingUseCode, UNKNOWN_BUILDING_USE } from "./building-use";
import type {
  AreaFeature,
  LoadedLayer,
  Criterion,
  SpatialResult,
} from "./types";
export const isArea = (feature: Feature): feature is AreaFeature =>
  ["Polygon", "MultiPolygon"].includes(feature.geometry?.type);
const numberValue = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
export function featureKey(feature: Feature, index: number): string {
  return String(feature.id ?? index);
}
function clipped(feature: Feature, selection: AreaFeature): AreaFeature | null {
  return isArea(feature)
    ? intersect(featureCollection([feature, selection]))
    : null;
}
function touches(feature: Feature, selection: AreaFeature): boolean {
  return feature.geometry.type === "Point"
    ? booleanPointInPolygon(feature.geometry.coordinates, selection)
    : booleanIntersects(feature, selection);
}
function coveredArea(polygons: AreaFeature[]): number {
  if (!polygons.length) return 0;
  if (polygons.length === 1) return area(polygons[0]);
  const merged = union(featureCollection(polygons));
  return merged ? area(merged) : 0;
}
export function areaStatistics(selection: AreaFeature, layers: LoadedLayer[]) {
  let buildingUses: SpatialResult["buildingUses"];
  const metrics: Record<string, number> = { areaSqm: area(selection) };
  const notes: string[] = [
    "면적은 선택 영역 안에서 계산하고, 개수는 영역에 걸친 도형도 포함합니다.",
  ];
  for (const role of [
    "buildings",
    "green",
    "facilities",
    "population",
  ] as const) {
    const group = layers.filter((l) => l.config.role === role);
    if (!group.length) continue;
    const features = group.flatMap((l) =>
      l.data.features.filter((f) => touches(f, selection)),
    );
    if (role === "buildings") {
      const groups = new Map<string, { use_code: string; use_name: string; count: number }>();
      for (const feature of features) {
        const code = buildingUseCode(feature.properties);
        const current = groups.get(code);
        if (current) current.count++;
        else groups.set(code, { use_code: code, use_name: typeof feature.properties?.use_name === "string" ? feature.properties.use_name : UNKNOWN_BUILDING_USE, count: 1 });
      }
      // Keep the existing compact spatial summary, including code traceability.
      buildingUses = [...groups.values()].sort((a, b) => b.count - a.count || a.use_code.localeCompare(b.use_code)).slice(0, 20);
      if (groups.size > 20) notes.push(`건물 용도는 개수가 많은 20개 코드를 표시합니다. ${groups.size - 20}개 코드는 요약에서 제외했습니다.`);
      metrics.buildingCount = features.length;
      metrics.buildingFootprintSqm = coveredArea(
        features
          .map((f) => clipped(f, selection))
          .filter((f): f is AreaFeature => !!f),
      );
    }
    if (role === "green") {
      metrics.greenAreaSqm = coveredArea(
        features
          .map((f) => clipped(f, selection))
          .filter((f): f is AreaFeature => !!f),
      );
      metrics.greenRatio = metrics.areaSqm
        ? metrics.greenAreaSqm / metrics.areaSqm
        : 0;
    }
    if (role === "facilities") metrics.facilityCount = features.length;
    if (role === "population") {
      let total = 0,
        valid = true;
      for (const l of group) {
        if (!l.config.populationField) {
          valid = false;
          continue;
        }
        // Polygon populations cannot be apportioned by footprint without a distribution model.
        for (const f of l.data.features) {
          if (!touches(f, selection)) continue;
          if (isArea(f)) {
            const part = clipped(f, selection);
            if (!part || area(part) < area(f) * (1 - 1e-7)) {
              valid = false;
              continue;
            }
          } else if (f.geometry.type === "Point") {
            /* Point population is directly attributable. */
          } else {
            valid = false;
            continue;
          }
          const v = f.properties?.[l.config.populationField];
          if (!numberValue(v) || v < 0) valid = false;
          else total += v;
        }
      }
      if (valid) metrics.population = total;
      else
        notes.push(
          "인구는 속성값이 있고 집계 구역 전체가 선택 영역에 포함될 때만 합산합니다. 일부 구역이 걸치거나 값이 없으면 표시하지 않습니다.",
        );
    }
  }
  for (const l of layers)
    for (const field of l.config.averageFields ?? []) {
      const values = l.data.features
        .filter((f) => touches(f, selection))
        .map((f) => f.properties?.[field])
        .filter(numberValue);
      if (values.length) {
        metrics[`average:${l.config.id}:${field}`] =
          values.reduce((a, b) => a + b, 0) / values.length;
        metrics[`averageCount:${l.config.id}:${field}`] = values.length;
      }
    }
  return { metrics, notes, ...(buildingUses ? { buildingUses } : {}) };
}
export function createBuffer(
  feature: Feature<Geometry>,
  distance: number,
): AreaFeature {
  if (!Number.isFinite(distance) || distance <= 0 || distance > 10000)
    throw new Error("버퍼 거리는 1~10,000m로 입력해주세요.");
  const result = buffer(feature, distance, { units: "meters" });
  if (!result) throw new Error("이 도형에는 버퍼를 만들 수 없어요.");
  return result;
}
export function intersectionAreas(
  a: LoadedLayer,
  b: LoadedLayer,
): AreaFeature[] {
  if (a.config.type !== "polygon" || b.config.type !== "polygon")
    throw new Error("면 레이어 두 개를 선택해주세요.");
  if (a.data.features.length * b.data.features.length > 100000)
    throw new Error("중첩 분석은 도형 조합 10만 개 이하로 실행해주세요.");
  const result: AreaFeature[] = [];
  for (const x of a.data.features.filter(isArea))
    for (const y of b.data.features.filter(isArea)) {
      if (!booleanIntersects(x, y)) continue;
      const part = intersect(featureCollection([x, y]));
      if (part && area(part) > 0) result.push(part);
    }
  return result;
}
export function scorePriority(layer: LoadedLayer, criteria: Criterion[]) {
  if (
    !criteria.length ||
    criteria.some(
      (c) =>
        !c.field ||
        !["higher", "lower"].includes(c.direction) ||
        !numberValue(c.weight) ||
        c.weight <= 0,
    )
  )
    throw new Error("우선순위 기준과 가중치를 설정해주세요.");
  const missing = criteria
    .filter((c) =>
      layer.data.features.some((f) => !numberValue(f.properties?.[c.field])),
    )
    .map((c) => c.field);
  if (missing.length)
    throw new Error(`숫자 속성이 필요합니다: ${missing.join(", ")}`);
  const ranges = criteria.map((c) => {
    const values = layer.data.features.map(
      (f) => f.properties![c.field] as number,
    );
    return { min: Math.min(...values), max: Math.max(...values) };
  });
  const weight = criteria.reduce((total, c) => total + c.weight, 0);
  return layer.data.features
    .map((f, index) => ({
      featureId: featureKey(f, index),
      score:
        criteria.reduce((total, c, i) => {
          const range = ranges[i];
          const normalized =
            range.max === range.min
              ? 0.5
              : ((f.properties![c.field] as number) - range.min) /
                (range.max - range.min);
          return (
            total +
            (c.direction === "higher" ? normalized : 1 - normalized) * c.weight
          );
        }, 0) / weight,
    }))
    .sort((a, b) => b.score - a.score);
}
export function resultFor(
  projectId: string,
  type: SpatialResult["type"],
  layers: LoadedLayer[],
  selection: AreaFeature,
  parameters: SpatialResult["parameters"] = {},
): SpatialResult {
  return {
    projectId,
    type,
    timestamp: new Date().toISOString(),
    layerIds: layers.map((l) => l.config.id),
    parameters,
    ...areaStatistics(selection, layers),
  };
}
export function overlayArea(polygons: AreaFeature[]): number {
  return coveredArea(polygons);
}
export { bbox, centroid, featureCollection };
