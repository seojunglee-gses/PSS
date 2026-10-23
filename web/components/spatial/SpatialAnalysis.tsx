import { featureNames } from '../../lib/spatial/geo-query';
import NaturalLanguageGIS from "./NaturalLanguageGIS";
import type { GeoWorkspace } from "../../lib/spatial/use-geo";
import { useI18n } from "../../lib/i18n";
import { useEffect, useMemo, useState } from "react";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import SpatialMap from "./SpatialMap";
import { loadLayer, loadSpatialConfig } from "../../lib/spatial/loader";
import {
  createBuffer,
  featureCollection,
  featureKey,
  intersectionAreas,
  isArea,
  overlayArea,
  resultFor,
  scorePriority,
} from "../../lib/spatial/engine";
import type {
  LoadedLayer,
  SpatialConfig,
  SpatialResult,
} from "../../lib/spatial/types";
import SpatialSummary from "./SpatialSummary";
import { spatialGoals } from "../../lib/spatial/goals";
import { useAuth } from "../../lib/auth";
export default function SpatialAnalysis({
  projectId,
  geo,
  result,
  onResult,
  included,
  onInclude,
}: {
  projectId: string;
  geo?: GeoWorkspace;
  result: SpatialResult | null;
  onResult: (r: SpatialResult | null) => void;
  included: boolean;
  onInclude: (v: boolean) => void;
}) {
  const { t, localize } = useI18n();
  const { user } = useAuth();
  const [config, setConfig] = useState<SpatialConfig>({
    projectId,
    layers: [],
  });
  const [layers, setLayers] = useState<LoadedLayer[]>([]);
  const [visible, setVisible] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<{
    layer: LoadedLayer;
    feature: Feature<Geometry>;
    index: number;
  } | null>(null);
  const [overlay, setOverlay] = useState<FeatureCollection>(
    featureCollection([]),
  );
  const [tool, setTool] = useState<SpatialResult["type"] | null>(null);
  const [distance, setDistance] = useState(300);
  const [overlayA, setOverlayA] = useState("");
  const [overlayB, setOverlayB] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    (async () => {
      try {
        const token = await user?.getIdToken();
        const c = await loadSpatialConfig(projectId, controller.signal, token);
        const results = await Promise.allSettled(
          c.layers.map((layer) => loadLayer(layer, token)),
        );
        if (!current) return;
        const available: LoadedLayer[] = [];
        const failed: string[] = [...(c.datasetWarnings ?? [])];
        results.forEach((r, i) =>
          r.status === "fulfilled"
            ? available.push(r.value)
            : failed.push(
                r.reason instanceof Error
                  ? `${c.layers[i].label}: ${r.reason.message}`
                  : `${c.layers[i].label}: ${"spatial.loadFailed"}`,
              ),
        );
        setConfig(c);
        setLayers(available);
        setVisible(
          available
            .filter((l) => l.config.defaultVisible !== false)
            .map((l) => l.config.id),
        );
        setWarnings(failed);
      } catch (e) {
        if (current)
          setWarnings([
            e instanceof Error ? e.message : "spatial.loadFailed",
          ]);
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => {
      current = false;
      controller.abort();
    };
  }, [projectId, user]);
  const polygons = useMemo(
    () => layers.filter((l) => l.config.type === "polygon"),
    [layers],
  );
  const priorityLayer = layers.find(
    (l) => l.config.id === config.priority?.layerId,
  );
  const priorityError = useMemo(() => {
    if (config.priority && priorityLayer) {
      try {
        scorePriority(priorityLayer, config.priority.criteria);
      } catch (e) {
        return (e as Error).message;
      }
    }
    return "";
  }, [config.priority, priorityLayer]);
  const execute = (fn: () => void) => {
    setError("");
    try {
      fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("spatial.runFailed"));
    }
  };
  const choose = (
    layer: LoadedLayer,
    feature: Feature<Geometry>,
    index: number,
  ) => {
    setSelected({ layer, feature, index });
    geo?.setContext(prev => ({ mapCenter: prev.mapCenter, selected: { layerId: layer.config.id, featureId: featureKey(feature, index) } }));
    setError("");
    setOverlay(
      featureCollection([feature]),
    );
  };
  const activeLayers = layers.filter((l) => visible.includes(l.config.id));
  return (
    <div className="spatial-analysis space-y-4 p-4 sm:p-6">
      <h3 className="text-lg font-semibold">{t("workspace.goal.spatial")}</h3>
      {geo && <NaturalLanguageGIS geo={geo} names={layers.flatMap(layer => layer.data.features.flatMap(featureNames))} />}
      {!loading && <SpatialMap layers={layers} visible={visible} overlay={overlay} onSelect={choose}
        onPoint={(coordinate) => { setSelected(null); setOverlay(featureCollection([{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: coordinate } }])); geo?.setContext(prev => ({ mapCenter: prev.mapCenter, point: coordinate })); }}
        onCenter={(mapCenter) => geo?.setContext(prev => ({ ...prev, mapCenter }))}
        geoResult={geo?.result} highlightedPlaceId={geo?.highlighted} onPlace={(place) => geo?.setHighlighted(place.id)} />}
      {loading ? (
        <p role="status" className="text-sm text-slate-500">
          {t("spatial.loading")}</p>
      ) : !layers.length ? (
        <div className="rounded-xl bg-slate-50 p-6 text-sm text-slate-600">
          <p className="font-semibold">{t("spatial.empty")}</p>
          <p className="mt-2">
            {t("spatial.emptyHint")}</p>
        </div>
      ) : (
        <>
          <fieldset className="rounded-xl border border-slate-200 p-3">
            <legend className="px-1 text-sm font-semibold">
              {t("spatial.layers")}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {config.layers.map((l) => (
                <label key={l.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={!layers.some((a) => a.config.id === l.id)}
                    checked={visible.includes(l.id)}
                    onChange={(e) =>
                      setVisible((v) =>
                        e.target.checked
                          ? [...v, l.id]
                          : v.filter((id) => id !== l.id),
                      )
                    }
                  />
                  <span
                    aria-hidden="true"
                    className="h-3 w-3 rounded-sm"
                    style={{ backgroundColor: l.color ?? "#64748b" }}
                  />
                  {l.label}
                  {!layers.some((a) => a.config.id === l.id) && t("spatial.unavailable")}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-xs text-slate-500">
            {t("spatial.mapHint")}<span className="mt-1 block">
              {t("spatial.touchHint")}</span>
          </p>
          {selected && (
            <section className="rounded-xl bg-slate-50 p-3 text-sm">
              <h4 className="font-semibold">
                {selected.layer.config.label} {t("spatial.infoSuffix")}</h4>
              <p className="text-xs text-slate-500">
                {t("spatial.featureId")}{featureKey(selected.feature, selected.index)}
              </p>
              <dl className="mt-2 space-y-1">
                {(selected.layer.config.displayFields ?? []).map((field) => {
                  const value = selected.feature.properties?.[field];
                  return value !== null &&
                    value !== undefined &&
                    (typeof value === "string" ||
                      typeof value === "number" ||
                      typeof value === "boolean") ? (
                    <div key={field} className="flex flex-wrap gap-2 break-all">
                      <dt>
                        {selected.layer.config.fieldLabels?.[field] ?? field}:
                      </dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ) : null;
                })}
              </dl>
            </section>
          )}
          <section aria-label={t("spatial.purpose")} className="space-y-3">
            <div>
              <h4 className="font-semibold">{t("spatial.chooseGoal")}</h4>
              <p className="mt-1 text-sm text-slate-500">
                {t("spatial.goalHint")}</p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {spatialGoals.map((goal) => (
                <button
                  key={goal.type}
                  type="button"
                  aria-pressed={tool === goal.type}
                  aria-controls="spatial-tool-controls"
                  onClick={() => {
                    setTool(goal.type);
                    setError("");
                  }}
                  className={`min-w-0 rounded-xl border p-4 text-left ${tool === goal.type ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600" : "border-slate-200 hover:bg-slate-50"}`}
                >
                  <span className="block text-sm font-semibold">
                    {localize(goal.name)}
                  </span>
                  <span className="mt-1 block text-sm text-slate-600">
                    {localize(goal.description)}
                  </span>
                </button>
              ))}
            </div>
            {tool && (
              <fieldset
                id="spatial-tool-controls"
                className="space-y-3 rounded-xl border border-slate-200 p-3"
              >
                <legend className="px-1 text-sm font-semibold">
                  {localize(spatialGoals.find((goal) => goal.type === tool)?.name ?? "")}
                </legend>
                <p className="text-xs text-slate-500">
                  (
                  {localize(spatialGoals.find((goal) => goal.type === tool)?.technicalName ?? "")}
                  )
                </p>
                {(tool === "area" || tool === "buffer") && (
                  <div className="space-y-2 text-sm">
                    <p>
                      <span className="font-medium">
                        {tool === "area" ? t("spatial.areaTarget") : t("spatial.baseTarget")}
                      </span>
                      :{" "}
                      {selected
                        ? `${selected.layer.config.label} · ${featureKey(selected.feature, selected.index)}`
                        : t("spatial.selectMap")}
                    </p>
                    {tool === "area" &&
                      (!selected || !isArea(selected.feature)) && (
                        <p className="text-slate-600">
                          {t("spatial.selectPolygon")}</p>
                      )}
                    <p>
                      <span className="font-medium">{t("spatial.targetLayers")}</span>:{" "}
                      {activeLayers
                        .map((layer) => layer.config.label)
                        .join(" · ") || t("spatial.noLayers")}
                    </p>
                    <p className="text-xs text-slate-500">
                      {t("spatial.targetHint")}</p>
                  </div>
                )}
                {tool === "area" && (
                  <div>
                    <button
                      type="button"
                      className="spatial-button w-full"
                      disabled={!selected || !isArea(selected.feature)}
                      onClick={() =>
                        execute(() => {
                          if (!selected || !isArea(selected.feature)) return;
                          setOverlay(featureCollection([selected.feature]));
                          onResult(
                            resultFor(
                              projectId,
                              "area",
                              activeLayers,
                              selected.feature,
                              {
                                selectedLayerId: selected.layer.config.id,
                                selectedFeatureId: featureKey(
                                  selected.feature,
                                  selected.index,
                                ),
                              },
                            ),
                          );
                          onInclude(false);
                        })
                      }
                    >
                      {t("spatial.runArea")}</button>
                  </div>
                )}
                {tool === "buffer" && (
                  <div className="space-y-3">
                    <label className="block text-sm">
                      {t("spatial.distance")}<select
                        aria-label={t("spatial.distance")}
                        value={distance}
                        onChange={(e) => setDistance(Number(e.target.value))}
                        className="mt-1 block w-full rounded border p-2"
                      >
                        {[100, 300, 500].map((n) => (
                          <option key={n} value={n}>
                            {n}m
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="spatial-button w-full"
                      disabled={!selected}
                      onClick={() =>
                        execute(() => {
                          if (!selected) return;
                          const shape = createBuffer(
                            selected.feature,
                            distance,
                          );
                          setOverlay(featureCollection([shape]));
                          onResult(
                            resultFor(
                              projectId,
                              "buffer",
                              activeLayers,
                              shape,
                              {
                                distanceMeters: distance,
                                selectedLayerId: selected.layer.config.id,
                                selectedFeatureId: featureKey(
                                  selected.feature,
                                  selected.index,
                                ),
                              },
                            ),
                          );
                          onInclude(false);
                        })
                      }
                    >
                      {t("spatial.runBuffer")}</button>
                  </div>
                )}
                {tool === "intersection" && (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-600">
                      {t("spatial.overlayHint")}</p>
                    {[
                      [t("spatial.baseLayer"), overlayA, setOverlayA],
                      [t("spatial.compareLayer"), overlayB, setOverlayB],
                    ].map(([name, value, setter]) => (
                      <label key={String(name)} className="block text-sm">
                        {String(name)}
                        <select
                          aria-label={String(name)}
                          value={value as string}
                          onChange={(e) =>
                            (setter as (v: string) => void)(e.target.value)
                          }
                          className="mt-1 block w-full min-w-0 rounded border p-2 text-sm"
                        >
                          <option value="">{t("spatial.select")}</option>
                          {polygons.map((l) => (
                            <option key={l.config.id} value={l.config.id}>
                              {l.config.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                    <button
                      type="button"
                      className="spatial-button w-full"
                      disabled={!overlayA || !overlayB || overlayA === overlayB}
                      onClick={() =>
                        execute(() => {
                          const a = layers.find(
                            (l) => l.config.id === overlayA,
                          )!;
                          const b = layers.find(
                            (l) => l.config.id === overlayB,
                          )!;
                          const shapes = intersectionAreas(a, b);
                          setOverlay(featureCollection(shapes));
                          onResult({
                            projectId,
                            type: "intersection",
                            timestamp: new Date().toISOString(),
                            layerIds: [overlayA, overlayB],
                            parameters: { layerA: overlayA, layerB: overlayB },
                            metrics: {
                              intersectionAreaSqm: overlayArea(shapes),
                            },
                            notes: [
                              "선택한 두 면 레이어의 중첩 영역입니다. 속성 조건은 원본 데이터에서 미리 정의해주세요.",
                            ],
                          });
                          onInclude(false);
                        })
                      }
                    >
                      {t("spatial.runOverlay")}</button>
                  </div>
                )}
                {tool === "priority" && (
                  <div>
                    <button
                      type="button"
                      className="spatial-button w-full"
                      disabled={!priorityLayer || !!priorityError}
                      onClick={() =>
                        execute(() => {
                          if (!priorityLayer || !config.priority) return;
                          const scores = scorePriority(
                            priorityLayer,
                            config.priority.criteria,
                          );
                          setOverlay(
                            featureCollection(
                              priorityLayer.data.features.filter(isArea),
                            ),
                          );
                          onResult({
                            projectId,
                            type: "priority",
                            timestamp: new Date().toISOString(),
                            layerIds: [priorityLayer.config.id],
                            parameters: {
                              criteria: JSON.stringify(
                                config.priority.criteria,
                              ),
                            },
                            metrics: { priorityCount: scores.length },
                            priorities: scores.slice(0, 20),
                            notes: [
                              "사업별 기준을 0~1로 정규화한 가중 점수입니다. 통계적 유의성을 나타내지 않습니다. 값이 모두 같으면 해당 기준은 0.5점을 부여합니다. 목록은 상위 20개 지역입니다.",
                            ],
                          });
                          onInclude(false);
                        })
                      }
                    >
                      {t("spatial.priorityGoal")}</button>
                    <p className="mt-1 text-xs text-slate-500">
                      {(priorityError ? localize(priorityError, "spatial.runFailed") : "") ||
                        (!config.priority
                          ? t("spatial.priorityHint")
                          : !priorityLayer
                            ? t("spatial.priorityLayerRequired")
                            : config.priority.criteria
                                .map(
                                  (c) =>
                                    `${priorityLayer?.config.fieldLabels?.[c.field] ?? c.field} (${c.direction === "higher" ? t("spatial.higher") : t("spatial.lower")}, ${t("spatial.weight")} ${c.weight})`,
                                )
                                .join(" · "))}
                    </p>
                  </div>
                )}
              </fieldset>
            )}
          </section>
        </>
      )}
      {warnings.length > 0 && (
        <div role="status" className="space-y-1 text-xs text-amber-700">
          {warnings.map((w, i) => (
            <p key={i}>{localize(w, "spatial.loadFailed")}</p>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {localize(error, "spatial.runFailed")}
        </p>
      )}
      {result && (
        <section className="space-y-2 rounded-xl border border-blue-100 bg-blue-50/40 p-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-semibold">{t("spatial.result")}</h4>
            <button
              type="button"
              className="text-xs text-slate-500"
              onClick={() => {
                onResult(null);
                onInclude(false);
                setOverlay(featureCollection([]));
              }}
            >
              {t("spatial.clear")}</button>
          </div>
          <SpatialSummary result={result} />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={included}
              onChange={(e) => onInclude(e.target.checked)}
            />
            {t("spatial.attach")}</label>
          <p className="text-xs text-slate-500">
            {t("spatial.resultHint")}</p>
        </section>
      )}
    </div>
  );
}
