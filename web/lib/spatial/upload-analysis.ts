// Server-only parsing and projection. Preview and save use the same implementation.
import proj4 from "proj4";
import { unzipSync } from "fflate";
import { read } from "shapefile";
import { bbox } from "@turf/turf";
import type { FeatureCollection, Geometry } from "geojson";
import { MAX_DATASET_BYTES, parseCsv, parseDataset, type SpatialDataset, type DatasetType } from "./datasets";
import { featureNames } from "./geo-query";

export const UPLOAD_CRS = ["EPSG:4326", "EPSG:3857", "EPSG:5179", "EPSG:5186"] as const;
proj4.defs("EPSG:5179", "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs");
proj4.defs("EPSG:5186", "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs");

export type UploadAnalysis = {
  needsCrs: boolean; sourceCrs: string | null; webCrs: "EPSG:4326";
  geometryType: SpatialDataset["geometryType"]; featureCount: number;
  extent: [number, number, number, number] | null; data: FeatureCollection<Geometry> | null;
};
export function uploadBytes(body: Record<string, unknown>) {
  if (typeof body.fileName !== "string" || body.fileName.length > 255 || /[\\/\u0000]/.test(body.fileName)) throw new Error("upload.invalidFile");
  const format = body.fileName.split(".").pop()?.toLowerCase() as SpatialDataset["format"];
  if (!["geojson", "json", "csv", "zip"].includes(format)) throw new Error("dataset.fileType");
  if (typeof body.data !== "string" || body.data.length > Math.ceil(MAX_DATASET_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.data)) throw new Error("dataset.fileSize");
  const bytes = Buffer.from(body.data, "base64");
  if (!bytes.length || bytes.length > MAX_DATASET_BYTES) throw new Error("dataset.fileSize");
  return { bytes, format };
}
const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
function declaredCrs(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 12000) throw new Error("upload.unsupportedCrs");
  if (/CRS84$/i.test(value)) return "EPSG:4326";
  const code = value.match(/(?:EPSG(?::|::|\/|\/0\/)|^)(4326|3857|900913|5179|5186)$/i)?.[1]
    ?? value.match(/(?:AUTHORITY|ID)\s*\[\s*"EPSG"\s*,\s*"?(4326|3857|5179|5186)"?\s*\]\s*\]$/i)?.[1];
  return code ? `EPSG:${code === "900913" ? "3857" : code}` : value;
}
function mapCoordinates(value: unknown, convert: (p: number[]) => number[], depth = 0): unknown {
  if (!Array.isArray(value) || !value.length || depth > 5) throw new Error("upload.invalidGeometry");
  if (typeof value[0] === "number") {
    if (value.length < 2 || !value.every(n => typeof n === "number" && Number.isFinite(n)) || Math.abs(value[0]) > 1e9 || Math.abs(value[1]) > 1e9) throw new Error("upload.invalidGeometry");
    return convert(value);
  }
  return value.map(v => mapCoordinates(v, convert, depth + 1));
}
async function readZip(bytes: Uint8Array) {
  let count = 0, total = 0;
  const files = unzipSync(bytes, { filter: entry => {
    count++; total += entry.originalSize;
    if (count > 128 || total > 24 * 1024 * 1024 || entry.originalSize > 24 * 1024 * 1024) throw new Error("upload.zipSize");
    return !entry.name.startsWith("__MACOSX/") && /\.(shp|dbf|prj|cpg)$/i.test(entry.name);
  } });
  const names = Object.keys(files), shapes = names.filter(n => /\.shp$/i.test(n));
  if (shapes.length !== 1) throw new Error("upload.oneShapefile");
  const base = shapes[0].slice(0, -4).toLowerCase();
  const component = (extension: string) => names.find(n => n.toLowerCase() === base + extension);
  const dbf = component(".dbf"), prj = component(".prj"), cpg = component(".cpg");
  if (!dbf) throw new Error("upload.missingDbf");
  const encoding = cpg ? decode(files[cpg]).trim() : "utf-8";
  const data = await read(files[shapes[0]].buffer as ArrayBuffer, files[dbf].buffer as ArrayBuffer, { encoding: /^(?:949|CP949)$/i.test(encoding) ? "euc-kr" : encoding === "65001" ? "utf-8" : encoding });
  return { data, crs: prj ? decode(files[prj]).trim() : undefined, hasPrj: !!prj };
}
export async function analyzeUpload(bytes: Uint8Array, format: SpatialDataset["format"], manualCrs?: unknown, type: DatasetType = "other"): Promise<UploadAnalysis> {
  if (manualCrs !== undefined && !UPLOAD_CRS.includes(manualCrs as typeof UPLOAD_CRS[number])) throw new Error("upload.unsupportedCrs");
  let raw: unknown, declared: string | undefined, hasPrj = false;
  if (format === "zip") {
    const zipped = await readZip(bytes); raw = zipped.data; declared = zipped.crs; hasPrj = zipped.hasPrj;
  } else if (format === "csv") {
    const [headers, ...rows] = parseCsv(decode(bytes));
    const index = (aliases: string[]) => headers.findIndex(h => aliases.includes(h.toLowerCase()));
    let x = index(["longitude", "lon", "lng", "경도"]), y = index(["latitude", "lat", "위도"]);
    if (x < 0 && y < 0) { x = index(["x", "easting", "동경"]); y = index(["y", "northing", "북위"]); }
    if (x < 0 && y < 0) return { needsCrs: false, sourceCrs: null, webCrs: "EPSG:4326", geometryType: null, featureCount: rows.length, extent: null, data: null };
    if (x < 0 || y < 0) throw new Error("upload.coordinateColumns");
    raw = { type: "FeatureCollection", features: rows.map((row, i) => {
      if (!row[x].trim() || !row[y].trim() || !Number.isFinite(Number(row[x])) || !Number.isFinite(Number(row[y]))) throw new Error("upload.invalidGeometry");
      return { type: "Feature", id: String(i + 1), geometry: { type: "Point", coordinates: [Number(row[x]), Number(row[y])] }, properties: Object.fromEntries(headers.map((h, j) => [h, row[j]])) };
    }) };
  } else {
    raw = JSON.parse(decode(bytes));
    declared = declaredCrs((raw as {crs?: {properties?: {name?: unknown}}})?.crs?.properties?.name);
  }
  const root = raw as {type?: string; features?: FeatureCollection<Geometry>["features"]};
  const features = root?.type === "FeatureCollection" ? root.features : root?.type === "Feature" ? [raw as FeatureCollection<Geometry>["features"][number]] : null;
  if (!Array.isArray(features) || !features.length || features.length > 20000) throw new Error("upload.invalidGeometry");
  let geographic = true;
  for (const feature of features) {
    if (!feature?.geometry || !("coordinates" in feature.geometry)) throw new Error("upload.invalidGeometry");
    mapCoordinates(feature.geometry.coordinates, p => { if (Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) geographic = false; return p; });
  }
  let from: string | undefined = declared ? declaredCrs(declared) : undefined;
  let converter: proj4.Converter | undefined;
  if (from) { try { converter = proj4(from, "EPSG:4326"); } catch { from = undefined; } }
  if (manualCrs) {
    // A declared, recognizable CRS must not be silently overridden.
    if (from && UPLOAD_CRS.includes(from as typeof UPLOAD_CRS[number]) && from !== manualCrs) throw new Error("boundary.crsMismatch");
    from = String(manualCrs); converter = proj4(from, "EPSG:4326");
  }
  if (!from && !declared && format !== "zip" && geographic) { from = "EPSG:4326"; converter = proj4(from, "EPSG:4326"); }
  if (!from || !converter || format === "zip" && !hasPrj && !manualCrs) return { needsCrs: true, sourceCrs: declared ?? null, webCrs: "EPSG:4326", geometryType: null, featureCount: features.length, extent: null, data: null };
  const transformed = { type: "FeatureCollection", features: features.map(f => ({ ...f, geometry: { ...f.geometry, coordinates: mapCoordinates((f.geometry as Geometry & {coordinates: unknown}).coordinates, p => from === "EPSG:4326" ? [...p] : [...converter!.forward(p.slice(0, 2)), ...p.slice(2)]) } })) };
  const parsed = parseDataset(JSON.stringify(transformed), "geojson", type);
  if (parsed.data) for (const feature of parsed.data.features) {
    const name = featureNames(feature)[0];
    if (name) feature.properties = { ...feature.properties, display_name: name };
  }
  if (!parsed.data || Buffer.byteLength(JSON.stringify(parsed.data)) > MAX_DATASET_BYTES) throw new Error("upload.webSize");
  return { needsCrs: false, sourceCrs: from, webCrs: "EPSG:4326", geometryType: parsed.geometryType, featureCount: parsed.data.features.length, extent: bbox(parsed.data) as [number, number, number, number], data: parsed.data };
}
