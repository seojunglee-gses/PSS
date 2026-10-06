import type { FeatureCollection, Geometry } from "geojson";
import type { LayerConfig } from "./types";

export const UNKNOWN_BUILDING_USE = "용도 정보 없음";
export type BuildingUse = { name: string; note: string };
// Explicit code fields only: never guess that an arbitrary numeric attribute is a use code.
export function buildingUseCode(properties: Record<string, unknown> | null): string {
  for (const field of ["use_code", "mainPurpsCd", "main_purps_cd", "용도코드"]) {
    if (properties && Object.prototype.hasOwnProperty.call(properties, field)) {
      const value = properties[field];
      return typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
    }
  }
  return "";
}
export function normalizeBuildings(data: FeatureCollection<Geometry>, lookup: (code: string) => BuildingUse | undefined): FeatureCollection<Geometry> {
  return { ...data, features: data.features.map((feature) => {
    const code = buildingUseCode(feature.properties);
    return { ...feature, properties: { ...feature.properties, use_code: code, use_name: lookup(code)?.name ?? UNKNOWN_BUILDING_USE } };
  }) };
}
export function buildingDisplayConfig(config: LayerConfig): LayerConfig {
  if (config.role !== "buildings") return config;
  return { ...config, displayFields: [...new Set(["use_name", "use_code", ...(config.displayFields ?? [])])], fieldLabels: { ...config.fieldLabels, use_name: "건물 용도", use_code: "용도 코드" } };
}
