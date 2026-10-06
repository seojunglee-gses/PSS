// Server-only imports: the reference JSON is never imported by browser components.
import codes from "../../data/reference/building_use_codes.json";
import { createHash } from "node:crypto";
import { normalizeBuildings, type BuildingUse, UNKNOWN_BUILDING_USE } from "./building-use";
import type { FeatureCollection, Geometry } from "geojson";
import type { SpatialResult } from "./types";
export const BUILDING_USE_VERSION = createHash("sha256").update(JSON.stringify(codes)).digest("hex");

export function lookupBuildingUse(code: string): BuildingUse | undefined {
  return /^[0-9]{5}$/.test(code) && Object.prototype.hasOwnProperty.call(codes, code) ? (codes as Record<string, BuildingUse>)[code] : undefined;
}
export const normalizeBuildingData = (data: FeatureCollection<Geometry>) => normalizeBuildings(data, lookupBuildingUse);
export function canonicalBuildingContext(result: SpatialResult | undefined): SpatialResult | undefined {
  if (!result?.buildingUses) return result;
  return { ...result, buildingUses: result.buildingUses.map((group) => ({ ...group, use_name: lookupBuildingUse(group.use_code)?.name ?? UNKNOWN_BUILDING_USE })) };
}
