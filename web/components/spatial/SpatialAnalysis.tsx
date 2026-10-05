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
export default function SpatialAnalysis({
  projectId,
  result,
  onResult,
  included,
  onInclude,
}: {
  projectId: string;
  result: SpatialResult | null;
  onResult: (r: SpatialResult | null) => void;
  included: boolean;
  onInclude: (v: boolean) => void;
}) {
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
  const [distance, setDistance] = useState(300);
  const [overlayA, setOverlayA] = useState("");
  const [overlayB, setOverlayB] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    (async () => {
      try {
        const c = await loadSpatialConfig(projectId, controller.signal);
        const results = await Promise.allSettled(c.layers.map(loadLayer));
        if (!current) return;
        const available: LoadedLayer[] = [];
        const failed: string[] = [];
        results.forEach((r, i) =>
          r.status === "fulfilled"
            ? available.push(r.value)
            : failed.push(
                r.reason instanceof Error
                  ? `${c.layers[i].label}: ${r.reason.message}`
                  : `${c.layers[i].label} 데이터를 불러오지 못했어요.`,
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
            e instanceof Error ? e.message : "공간 데이터를 불러오지 못했어요.",
          ]);
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => {
      current = false;
      controller.abort();
    };
  }, [projectId]);
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
      setError(e instanceof Error ? e.message : "분석을 실행하지 못했어요.");
    }
  };
  const choose = (
    layer: LoadedLayer,
    feature: Feature<Geometry>,
    index: number,
  ) => {
    setSelected({ layer, feature, index });
    setError("");
    setOverlay(
      isArea(feature) ? featureCollection([feature]) : featureCollection([]),
    );
  };
  const activeLayers = layers.filter((l) => visible.includes(l.config.id));
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <h3 className="text-lg font-semibold">공간 분석</h3>
      {loading ? (
        <p role="status" className="text-sm text-slate-500">
          공간 데이터를 불러오는 중입니다.
        </p>
      ) : !layers.length ? (
        <div className="rounded-xl bg-slate-50 p-6 text-sm text-slate-600">
          <p className="font-semibold">아직 등록된 공간 데이터가 없습니다.</p>
          <p className="mt-2">
            사업 공간 데이터를 추가하면 지도에서 분석할 수 있어요.
          </p>
        </div>
      ) : (
        <>
          <fieldset className="rounded-xl border border-slate-200 p-3">
            <legend className="px-1 text-sm font-semibold">레이어</legend>
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
                  {!layers.some((a) => a.config.id === l.id) && " (사용 불가)"}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-xs text-slate-500">
            지도에서 도형을 선택하세요. 면 도형은 분석 영역으로 사용합니다.
            통계는 켜진 레이어만 대상으로 합니다.
          </p>
          <SpatialMap
            layers={layers}
            visible={visible}
            overlay={overlay}
            onSelect={choose}
          />
          {selected && (
            <section className="rounded-xl bg-slate-50 p-3 text-sm">
              <h4 className="font-semibold">
                {selected.layer.config.label} 정보
              </h4>
              <p className="text-xs text-slate-500">
                도형 ID: {featureKey(selected.feature, selected.index)}
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
          <fieldset className="space-y-3 rounded-xl border border-slate-200 p-3">
            <legend className="px-1 text-sm font-semibold">분석 도구</legend>
            <button
              type="button"
              className="spatial-button"
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
              영역 통계
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm">
                버퍼 거리{" "}
                <select
                  aria-label="버퍼 거리"
                  value={distance}
                  onChange={(e) => setDistance(Number(e.target.value))}
                  className="rounded border p-1"
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
                className="spatial-button"
                disabled={!selected}
                onClick={() =>
                  execute(() => {
                    if (!selected) return;
                    const shape = createBuffer(selected.feature, distance);
                    setOverlay(featureCollection([shape]));
                    onResult(
                      resultFor(projectId, "buffer", activeLayers, shape, {
                        distanceMeters: distance,
                        selectedLayerId: selected.layer.config.id,
                        selectedFeatureId: featureKey(
                          selected.feature,
                          selected.index,
                        ),
                      }),
                    );
                    onInclude(false);
                  })
                }
              >
                버퍼 분석
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {[
                ["A", overlayA, setOverlayA],
                ["B", overlayB, setOverlayB],
              ].map(([name, value, setter]) => (
                <select
                  key={String(name)}
                  aria-label={`중첩 레이어 ${name}`}
                  value={value as string}
                  onChange={(e) =>
                    (setter as (v: string) => void)(e.target.value)
                  }
                  className="min-w-0 max-w-full rounded border p-1 text-sm"
                >
                  <option value="">레이어 {String(name)}</option>
                  {polygons.map((l) => (
                    <option key={l.config.id} value={l.config.id}>
                      {l.config.label}
                    </option>
                  ))}
                </select>
              ))}
              <button
                type="button"
                className="spatial-button"
                disabled={!overlayA || !overlayB || overlayA === overlayB}
                onClick={() =>
                  execute(() => {
                    const a = layers.find((l) => l.config.id === overlayA)!;
                    const b = layers.find((l) => l.config.id === overlayB)!;
                    const shapes = intersectionAreas(a, b);
                    setOverlay(featureCollection(shapes));
                    onResult({
                      projectId,
                      type: "intersection",
                      timestamp: new Date().toISOString(),
                      layerIds: [overlayA, overlayB],
                      parameters: { layerA: overlayA, layerB: overlayB },
                      metrics: { intersectionAreaSqm: overlayArea(shapes) },
                      notes: [
                        "선택한 두 면 레이어의 중첩 영역입니다. 속성 조건은 원본 데이터에서 미리 정의해주세요.",
                      ],
                    });
                    onInclude(false);
                  })
                }
              >
                중첩 분석
              </button>
            </div>
            <div>
              <button
                type="button"
                className="spatial-button"
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
                        criteria: JSON.stringify(config.priority.criteria),
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
                우선지역 찾기
              </button>
              <p className="mt-1 text-xs text-slate-500">
                {priorityError ||
                  (!config.priority
                    ? "사업별 지표와 가중치를 설정하면 사용할 수 있습니다."
                    : !priorityLayer
                      ? "우선순위를 계산할 레이어가 필요합니다."
                      : config.priority.criteria
                          .map(
                            (c) =>
                              `${priorityLayer?.config.fieldLabels?.[c.field] ?? c.field} (${c.direction === "higher" ? "높을수록 우선" : "낮을수록 우선"}, 가중치 ${c.weight})`,
                          )
                          .join(" · "))}
              </p>
            </div>
          </fieldset>
        </>
      )}
      {warnings.length > 0 && (
        <div role="status" className="space-y-1 text-xs text-amber-700">
          {warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {result && (
        <section className="space-y-2 rounded-xl border border-blue-100 bg-blue-50/40 p-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-semibold">분석 결과</h4>
            <button
              type="button"
              className="text-xs text-slate-500"
              onClick={() => {
                onResult(null);
                onInclude(false);
                setOverlay(featureCollection([]));
              }}
            >
              결과 지우기
            </button>
          </div>
          <SpatialSummary result={result} />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={included}
              onChange={(e) => onInclude(e.target.checked)}
            />
            다음 질문에 이 공간 분석 결과 첨부
          </label>
          <p className="text-xs text-slate-500">
            계산 결과만 AI에 전달합니다. 전체 지도 데이터는 보내지 않습니다.
            최신 결과는 이 기기에 저장됩니다.
          </p>
        </section>
      )}
    </div>
  );
}
