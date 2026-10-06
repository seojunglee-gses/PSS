import type { FeatureCollection, Geometry } from "geojson";
import type { LayerConfig } from "./types";
import { validateGeoJSON } from "./loader";

export const DATASET_TYPES = ["project_boundary", "buildings", "parcels", "roads", "public_facilities", "other"] as const;
export type DatasetType = typeof DATASET_TYPES[number];
export const datasetTypeLabels: Record<DatasetType, string> = {
  project_boundary: "대상지 경계", buildings: "건물", parcels: "필지", roads: "도로", public_facilities: "공공시설", other: "기타",
};
export const MAX_DATASET_BYTES = 3 * 1024 * 1024;
export type SpatialDataset = {
  projectId: string; datasetId: string; name: string; type: DatasetType;
  fileName: string; uploadedAt: string; uploadedBy: string;
  storagePath: string; revisionId: string; size: number;
  format: "geojson" | "json" | "csv";
  geometryType: LayerConfig["type"] | null;
  normalizedStoragePath?: string;
  normalizedId?: string;
  buildingUseVersion?: string;
};

export function datasetLayer(dataset: SpatialDataset): LayerConfig | null {
  if (!dataset.geometryType) return null;
  const roles: Partial<Record<DatasetType, LayerConfig["role"]>> = { project_boundary: "boundary", buildings: "buildings", roads: "roads", public_facilities: "facilities" };
  return {
    id: `uploaded-${dataset.datasetId}`, label: dataset.name, type: dataset.geometryType,
    source: `/api/projects/spatial-datasets?${new URLSearchParams({projectId: dataset.projectId, datasetId: dataset.datasetId, revisionId: dataset.revisionId})}`,
    defaultVisible: true,
    ...(roles[dataset.type] ? { role: roles[dataset.type] } : {}),
  };
}

// RFC-style quoted fields, embedded commas/newlines and UTF-8 BOM; no external parser.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false, endedQuote = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; endedQuote = true; }
      else cell += c;
    } else if (c === '"') {
      if (cell || endedQuote) throw new Error("CSV 따옴표 형식을 확인해주세요.");
      quoted = true;
    } else if (c === "," || c === "\n" || c === "\r") {
      row.push(cell); cell = ""; endedQuote = false;
      if (c !== ",") {
        if (row.some((v) => v.trim())) rows.push(row);
        row = []; if (c === "\r" && text[i + 1] === "\n") i++;
      }
    } else { if (endedQuote) throw new Error("CSV 따옴표 형식을 확인해주세요."); cell += c; }
    if (rows.length > 20001 || row.length > 100) throw new Error("CSV는 20,000행·100열 이하로 준비해주세요.");
  }
  if (quoted) throw new Error("CSV 따옴표가 닫히지 않았습니다.");
  row.push(cell); if (row.some((v) => v.trim())) rows.push(row);
  if (rows.length < 2 || rows.length > 20001 || rows[0].length > 100) throw new Error("CSV에 헤더와 데이터 행이 필요합니다. 최대 20,000행까지 지원합니다.");
  const headers = rows[0].map((v) => v.trim());
  if (headers.some((v) => !v || v.length > 100 || ["__proto__", "constructor", "prototype"].includes(v)) || new Set(headers).size !== headers.length || rows.some((r) => r.length !== headers.length)) throw new Error("CSV 헤더와 열 개수를 확인해주세요.");
  rows[0] = headers; return rows;
}

export function parseDataset(text: string, format: SpatialDataset["format"], type: DatasetType): { geometryType: LayerConfig["type"] | null; data: FeatureCollection<Geometry> | null } {
  let input: unknown;
  if (format === "csv") {
    const [headers, ...rows] = parseCsv(text);
    const longitude = headers.findIndex((h) => ["longitude", "lon", "lng", "경도"].includes(h.toLowerCase()));
    const latitude = headers.findIndex((h) => ["latitude", "lat", "위도"].includes(h.toLowerCase()));
    if (longitude < 0 && latitude < 0) return { geometryType: null, data: null };
    if (longitude < 0 || latitude < 0) throw new Error("CSV에는 경도와 위도 열이 모두 필요합니다.");
    input = { type: "FeatureCollection", features: rows.map((row, i) => {
      const lon = row[longitude].trim(), lat = row[latitude].trim();
      if (!lon || !lat || !Number.isFinite(Number(lon)) || !Number.isFinite(Number(lat))) throw new Error(`CSV ${i + 2}행의 경도·위도를 확인해주세요.`);
      return { type: "Feature", id: String(i + 1), geometry: { type: "Point", coordinates: [Number(lon), Number(lat)] }, properties: Object.fromEntries(headers.map((h, j) => [h, row[j]])) };
    }) };
  } else {
    try { input = JSON.parse(text.replace(/^\uFEFF/, "")); } catch { throw new Error("JSON 형식을 확인해주세요."); }
  }
  const first = input as { type?: string; features?: { geometry?: { type?: string } }[]; geometry?: { type?: string } };
  const geometry = first?.type === "FeatureCollection" ? first.features?.[0]?.geometry?.type : first?.geometry?.type;
  const geometryType = geometry === "Polygon" || geometry === "MultiPolygon" ? "polygon" : geometry === "LineString" || geometry === "MultiLineString" ? "line" : geometry === "Point" || geometry === "MultiPoint" ? "point" : null;
  if (!geometryType) throw new Error("GeoJSON Feature 또는 FeatureCollection을 준비해주세요.");
  if (["project_boundary", "buildings", "parcels"].includes(type) && geometryType !== "polygon") throw new Error("경계·건물·필지는 면 데이터로 준비해주세요.");
  if (type === "roads" && geometryType !== "line") throw new Error("도로는 선 데이터로 준비해주세요.");
  const data = validateGeoJSON(input, { id: "validation", label: "공간정보", type: geometryType, source: "" });
  return { geometryType, data };
}
