import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { SpatialConfig, LayerConfig, LoadedLayer } from "./types";
const cache = new Map<string, Promise<LoadedLayer>>();
export function projectDirectory(projectId: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(projectId))
    throw new Error("공간 데이터의 사업 ID를 확인해주세요.");
  return `/data/projects/${projectId}/`;
}
export function validateConfig(
  input: unknown,
  projectId: string,
): SpatialConfig {
  const root = projectDirectory(projectId);
  const c = input as SpatialConfig;
  if (
    !c ||
    c.projectId !== projectId ||
    !Array.isArray(c.layers) ||
    c.layers.length > 20
  )
    throw new Error("공간 데이터 설정을 확인해주세요.");
  const ids = new Set<string>();
  for (const l of c.layers) {
    if (
      !l ||
      !/^[a-zA-Z0-9_-]+$/.test(l.id) ||
      ids.has(l.id) ||
      ["background", "__selection"].includes(l.id) ||
      typeof l.label !== "string" ||
      !["polygon", "point", "line"].includes(l.type) ||
      typeof l.source !== "string" ||
      !l.source.startsWith(root) ||
      !/^[a-zA-Z0-9_-]+\.geojson$/.test(l.source.slice(root.length))
    )
      throw new Error("레이어 설정 또는 파일 경로를 확인해주세요.");
    if (
      l.displayFields &&
      (!Array.isArray(l.displayFields) ||
        l.displayFields.some((f) => typeof f !== "string"))
    )
      throw new Error("표시할 속성을 확인해주세요.");
    if (
      l.averageFields &&
      (!Array.isArray(l.averageFields) ||
        l.averageFields.some((f) => typeof f !== "string"))
    )
      throw new Error("평균을 계산할 속성을 확인해주세요.");
    if (l.color && !/^#[0-9a-fA-F]{6}$/.test(l.color))
      throw new Error("레이어 색상을 확인해주세요.");
    if (l.populationField && typeof l.populationField !== "string")
      throw new Error("인구 속성을 확인해주세요.");
    if (
      ["buildings", "green", "boundary"].includes(l.role ?? "") &&
      l.type !== "polygon"
    )
      throw new Error("경계·건물·녹지는 면 레이어로 준비해주세요.");
    if (l.role === "population" && l.type === "line")
      throw new Error("인구는 점 또는 면 레이어로 준비해주세요.");
    if (
      l.role &&
      ![
        "boundary",
        "buildings",
        "green",
        "population",
        "facilities",
        "roads",
      ].includes(l.role)
    )
      throw new Error("레이어 역할을 확인해주세요.");
    ids.add(l.id);
  }
  if (
    c.priority &&
    (!ids.has(c.priority.layerId) ||
      !Array.isArray(c.priority.criteria) ||
      !c.priority.criteria.length ||
      c.priority.criteria.length > 10 ||
      c.priority.criteria.some(
        (v) =>
          !v ||
          typeof v.field !== "string" ||
          !["higher", "lower"].includes(v.direction) ||
          !Number.isFinite(v.weight) ||
          v.weight <= 0,
      ))
  )
    throw new Error("우선순위 기준을 확인해주세요.");
  return c;
}
export function validateGeoJSON(
  input: unknown,
  layer: LayerConfig,
): FeatureCollection<Geometry> {
  const raw = input as FeatureCollection<Geometry>;
  const features =
    raw?.type === "FeatureCollection"
      ? raw.features
      : (raw as unknown as { type: string })?.type === "Feature"
        ? [raw as unknown as Feature<Geometry>]
        : null;
  if (!Array.isArray(features) || !features.length || features.length > 20000)
    throw new Error("비어 있거나 지원 범위를 벗어난 공간 데이터입니다.");
  const position = (p: unknown): boolean =>
    Array.isArray(p) &&
    p.length >= 2 &&
    p.every(Number.isFinite) &&
    Math.abs(p[0]) <= 180 &&
    Math.abs(p[1]) <= 90;
  const line = (v: unknown): boolean =>
    Array.isArray(v) && v.length >= 2 && v.every(position);
  const ring = (v: unknown): boolean =>
    line(v) &&
    (v as number[][]).length >= 4 &&
    JSON.stringify((v as number[][])[0]) ===
      JSON.stringify((v as number[][]).at(-1));
  const polygon = (v: unknown): boolean =>
    Array.isArray(v) && v.length > 0 && v.every(ring);
  const many = (v: unknown, test: (v: unknown) => boolean): boolean =>
    Array.isArray(v) && v.length > 0 && v.every(test);
  for (const f of features) {
    const g = f?.geometry;
    if (
      f?.type !== "Feature" ||
      (f.id !== undefined &&
        typeof f.id !== "string" &&
        typeof f.id !== "number") ||
      !g ||
      !("coordinates" in g) ||
      (f.properties !== null &&
        (typeof f.properties !== "object" || Array.isArray(f.properties)))
    )
      throw new Error("GeoJSON 형식을 확인해주세요.");
    const tests: Record<string, (v: unknown) => boolean> = {
      Point: position,
      MultiPoint: (v) => many(v, position),
      LineString: line,
      MultiLineString: (v) => many(v, line),
      Polygon: polygon,
      MultiPolygon: (v) => many(v, polygon),
    };
    const allowed =
      layer.type === "point"
        ? ["Point", "MultiPoint"]
        : layer.type === "line"
          ? ["LineString", "MultiLineString"]
          : ["Polygon", "MultiPolygon"];
    if (!allowed.includes(g.type) || !tests[g.type]?.(g.coordinates))
      throw new Error(
        "도형과 좌표를 확인해주세요. EPSG:4326 좌표를 사용해주세요.",
      );
  }
  return {
    type: "FeatureCollection",
    features: features as FeatureCollection<Geometry>["features"],
  };
}
export async function loadSpatialConfig(
  projectId: string,
  signal?: AbortSignal,
): Promise<SpatialConfig> {
  const response = await fetch(`${projectDirectory(projectId)}config.json`, {
    signal,
  });
  if (response.status === 404) return { projectId, layers: [] };
  if (!response.ok) throw new Error("공간 데이터 설정을 불러오지 못했어요.");
  return validateConfig(await response.json(), projectId);
}
export async function loadLayer(config: LayerConfig): Promise<LoadedLayer> {
  if (!cache.has(config.source)) {
    if (cache.size >= 40) cache.delete(cache.keys().next().value!);
    cache.set(
      config.source,
      (async () => {
        const r = await fetch(config.source, {
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok)
          throw new Error(`${config.label} 데이터를 불러오지 못했어요.`);
        const text = await r.text();
        if (text.length > 10_000_000)
          throw new Error("파일 크기는 10MB 이하로 준비해주세요.");
        return { config, data: validateGeoJSON(JSON.parse(text), config) };
      })().catch((error) => {
        cache.delete(config.source);
        throw error;
      }),
    );
  }
  const loaded = await cache.get(config.source)!;
  return { config, data: validateGeoJSON(loaded.data, config) };
}
