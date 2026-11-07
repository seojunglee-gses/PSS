import { featureNames, representativePoint, parseGeoContext } from "./geo-query";
import { featureKey } from "./engine";
import type { AnalysisActivity } from "../analysis-session";
import type { LoadedLayer, SpatialResult } from "./types";
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

// Compact authorized dataset observations, not a reconstruction of browser layer visibility.
export function spatialPromptContext(layers: LoadedLayer[], selection: unknown, activities: AnalysisActivity[], boundaryAvailable: boolean) {
  const selected = parseGeoContext(selection).selected;
  const latest = [...activities].reverse().find(activity => activity.type === "spatial");
  let viewedIds: string[] = [];
  try {
    const payload = JSON.parse(latest?.location?.reply ?? "null");
    if (Array.isArray(payload?.displayedLayers)) viewedIds = payload.displayedLayers.flatMap((layer: { id?: unknown }) => typeof layer?.id === "string" ? [layer.id] : []);
  } catch { /* No recorded layer-visibility snapshot. */ }
  const authorizedIds = new Set(layers.map(layer => layer.config.id));
  const lastViewedLayerIds = viewedIds.filter(id => authorizedIds.has(id)).slice(0, 20);
  const chosen = selected ? layers.find(layer => layer.config.id === selected.layerId) : undefined;
  const selectedIndex = chosen?.data.features.findIndex((feature, index) => featureKey(feature, index) === selected?.featureId) ?? -1;
  const sample = (layer: LoadedLayer, index: number) => {
    const feature = layer.data.features[index];
    try { return { layerId: layer.config.id, featureId: featureKey(feature, index).slice(0, 150), name: (featureNames(feature)[0] ?? layer.config.label).slice(0, 200), geometryType: feature.geometry.type, ...representativePoint(feature) }; }
    catch { return undefined; }
  };
  const candidates = lastViewedLayerIds.length ? layers.filter(layer => lastViewedLayerIds.includes(layer.config.id)) : layers;
  const features = candidates.slice(0, 20).flatMap(layer => layer.data.features.slice(0, 2).flatMap((_, index) => { const value = sample(layer, index); return value ? [value] : []; })).slice(0, 24);
  return {
    visibility: { status: lastViewedLayerIds.length ? "last_recorded_view_only" : "unknown", lastViewedLayerIds, note: "Current browser layer on/off state is not supplied; never claim these are all currently visible layers." },
    registeredLayers: layers.slice(0, 20).map(layer => ({ id: layer.config.id, name: layer.config.label.slice(0, 200), geometryType: layer.config.type, ...(layer.config.role ? { role: layer.config.role } : {}), ...(layer.config.datasetType ? { datasetType: layer.config.datasetType } : {}), metadata: { uploadedFeatureCount: layer.data.features.length } })),
    boundary: { available: boundaryAvailable },
    ...(chosen && selectedIndex >= 0 ? { selectedFeature: sample(chosen, selectedIndex) } : {}),
    featureSamples: features,
    sampling: "At most 24 representative feature coordinates; these are samples of authorized datasets, not a complete inventory or GIS analysis. Polygon/line points are representative locations, not complete geometry.",
    computedSpatialRelations: [],
  };
}
export type SpatialPromptContext = ReturnType<typeof spatialPromptContext>;

export const spatialAnswerRules = `For spatial facts prioritize supplied GIS metrics and authorized dataset observations over activity text, previous dialogue or project narratives. Use project narratives for goals and context, not as independently measured spatial relations. Use these spatial-specific placement rules instead of the generic section template. For spatial questions, answer the user's question directly in natural prose, then explain only spatial observations or supplied GIS results that support that answer. Activity is not a spatial analysis result. Do not open with layer/object counts or turn uploadedFeatureCount into a finding, area-specific inventory or population statistic. Viewing a layer means only that registered material was viewed.
registeredSpatialContext contains authorized dataset samples, not complete GeoJSON or proof of the browser's current visibility. Use feature names, geometry types and representative coordinates only to identify available locations. Never compute or infer distance, area, direction, concentration, containment, overlap, buffer membership, nearest facilities, accessibility or other spatial relations from coordinates. Use only explicit spatialContext GIS metrics for such claims; computedSpatialRelations=[] means none were supplied by this context builder. Historical place observations and Kakao POIs support exploration, not adequacy, access quality or priority judgments.
Connect the available spatial material to actual project goals and previous-stage participant concerns conditionally. Identify participant experiences as reported concerns, not GIS findings; distinguish planning possibilities from measured evidence. Do not infer consent or consensus. Prefer a useful direct response about how the available material can inform this project over reciting file metadata. If a needed calculation or dataset is absent, state the specific limitation in one short sentence and optionally suggest ONE existing action: search nearby places, review area characteristics, buffer analysis, overlay comparison or the configured priority tool. Only suggest actions whose inputs are present: nearby place lookup needs a registered boundary; area statistics need a polygon or project boundary; overlay comparison needs two polygon layers; buffer tools need a selected feature; priority analysis needs supplied configured criteria. Never claim a tool was run or that a configured priority analysis is available without evidence. Do not invent network accessibility, traffic behavior, demand or planning decisions.
For an execution request without a supplied GIS result, ask only for missing targets/parameters or which analysis was intended; never instruct the user to execute the same supported calculation in the left UI or to bring back its result. The existing spatial endpoint executes supported requests when inputs are clear. Never claim execution without an actual tool result.
For spatial-only/project+spatial answers put the complete direct answer in summary (normally 1–3 short paragraphs). Do not force headings or bullet lists. Return integratedInterpretation="", agreement="", differences="", projectImplications=[], caseFindings=[], researchFindings=[], limitations="" to avoid repeated Summary / Integrated interpretation / Project implications sections. Include relevant project meaning and at most one brief limitation/next action within summary instead. For mixed case/research answers retain the existing evidence separation and citation requirements.`;
