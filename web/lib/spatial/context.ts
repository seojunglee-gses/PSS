import type { SpatialResult } from "./types";
// Whitelist compact calculated summaries. Geometry and arbitrary properties never enter prompts.
export function parseSpatialResult(input: unknown): SpatialResult | undefined {
  if (input === undefined || input === null) return undefined;
  if (!input || typeof input !== "object")
    throw new Error("Invalid spatial context.");
  const r = input as SpatialResult;
  if (
    !/^[a-zA-Z0-9_-]{1,128}$/.test(r.projectId) ||
    !["area", "buffer", "intersection", "priority"].includes(r.type) ||
    typeof r.timestamp !== "string" ||
    !Number.isFinite(Date.parse(r.timestamp)) ||
    !Array.isArray(r.layerIds) ||
    r.layerIds.length > 20 ||
    r.layerIds.some(
      (id) => typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(id),
    )
  )
    throw new Error("Invalid spatial context.");
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  if (
    !object(r.metrics) ||
    Object.keys(r.metrics).length > 100 ||
    Object.entries(r.metrics).some(
      ([k, v]) =>
        k.length > 150 || typeof v !== "number" || !Number.isFinite(v),
    )
  )
    throw new Error("Invalid spatial metrics.");
  if (
    !object(r.parameters) ||
    Object.keys(r.parameters).length > 10 ||
    Object.entries(r.parameters).some(
      ([k, v]) =>
        k.length > 100 ||
        !(
          (typeof v === "string" && v.length <= 2000) ||
          (typeof v === "number" && Number.isFinite(v))
        ),
    )
  )
    throw new Error("Invalid spatial parameters.");
  if (
    !Array.isArray(r.notes) ||
    r.notes.length > 20 ||
    r.notes.some((n) => typeof n !== "string" || n.length > 1000)
  )
    throw new Error("Invalid spatial notes.");
  if (
    r.priorities !== undefined &&
    (!Array.isArray(r.priorities) ||
      r.priorities.length > 20 ||
      r.priorities.some(
        (p) =>
          !p ||
          typeof p.featureId !== "string" ||
          p.featureId.length > 150 ||
          !Number.isFinite(p.score) ||
          p.score < 0 ||
          p.score > 1,
      ))
  )
    throw new Error("Invalid spatial scores.");
  if (r.buildingUses !== undefined && (!Array.isArray(r.buildingUses) || r.buildingUses.length > 20 || r.buildingUses.some((group) => !group || typeof group.use_code !== "string" || group.use_code.length > 128 || typeof group.use_name !== "string" || group.use_name.length > 200 || !Number.isSafeInteger(group.count) || group.count < 0) || new Set(r.buildingUses.map((g) => g.use_code)).size !== r.buildingUses.length || r.buildingUses.reduce((n, g) => n + g.count, 0) > (r.metrics.buildingCount ?? 0))) throw new Error("Invalid building use summary.");
  return {
    projectId: r.projectId,
    type: r.type,
    timestamp: r.timestamp,
    layerIds: [...r.layerIds],
    parameters: { ...r.parameters },
    metrics: { ...r.metrics },
    notes: [...r.notes],
    ...(r.buildingUses ? { buildingUses: r.buildingUses.map((group) => ({ use_code: group.use_code, use_name: group.use_name, count: group.count })) } : {}),
    ...(r.priorities
      ? {
          priorities: r.priorities.map((p) => ({
            featureId: p.featureId,
            score: p.score,
          })),
        }
      : {}),
  };
}
