import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { LoadedLayer } from "../../lib/spatial/types";
import { bbox, featureCollection } from "../../lib/spatial/engine";
import { BASEMAP_PREFIX, BASEMAP_STYLE_URL, basemapStyle } from "../../lib/spatial/basemap";
export default function SpatialMap({
  layers,
  visible,
  overlay,
  onSelect,
}: {
  layers: LoadedLayer[];
  visible: string[];
  overlay: FeatureCollection;
  onSelect: (
    layer: LoadedLayer,
    feature: Feature<Geometry>,
    index: number,
  ) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const [error, setError] = useState("");
  const [basemapError, setBasemapError] = useState("");
  useEffect(() => {
    if (!container.current) return;
    setError("");
    setBasemapError("");
    const controller = new AbortController();
    let fitted = false;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: {
          version: 8,
          sources: {},
          layers: [
            {
              id: "background",
              type: "background",
              paint: { "background-color": "#f1f5f9" },
            },
          ],
        },
        center: [127, 37.5],
        zoom: 12,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl(), "top-right");
      const resize = new ResizeObserver(() => map.resize());
      resize.observe(container.current);
      map.on("error", (event) => {
        console.error("Spatial map:", event.error.message);
        if ((event as { sourceId?: string }).sourceId?.startsWith(BASEMAP_PREFIX)) {
          setBasemapError("배경 지도를 불러오지 못했어요. 업로드한 레이어와 공간 분석은 계속 사용할 수 있습니다.");
          return;
        }
        setError(
          "지도를 표시하는 중 오류가 발생했어요. 새로고침 후 다시 시도해주세요.",
        );
      });
      // Add project data as soon as the style is ready, even when map tiles fail.
      map.on("style.load", () => {
        for (const layer of layers) {
          const data = {
            ...layer.data,
            features: layer.data.features.map((f, i) => ({
              ...f,
              properties: { ...f.properties, _spatialIndex: i },
            })),
          };
          map.addSource(layer.config.id, { type: "geojson", data });
          const color = layer.config.color ?? "#64748b";
          map.addLayer(
            layer.config.type === "polygon"
              ? {
                  id: layer.config.id,
                  type: "fill",
                  source: layer.config.id,
                  paint: {
                    "fill-color": color,
                    "fill-opacity": 0.4,
                    "fill-outline-color": color,
                  },
                }
              : layer.config.type === "line"
                ? {
                    id: layer.config.id,
                    type: "line",
                    source: layer.config.id,
                    paint: { "line-color": color, "line-width": 3 },
                  }
                : {
                    id: layer.config.id,
                    type: "circle",
                    source: layer.config.id,
                    paint: {
                      "circle-color": color,
                      "circle-radius": 6,
                      "circle-stroke-color": "#fff",
                      "circle-stroke-width": 1,
                    },
                  },
          );
        }
        map.addSource("__selection", { type: "geojson", data: overlayRef.current });
        map.addLayer({
          id: "__selection",
          type: "fill",
          source: "__selection",
          paint: {
            "fill-color": "#2563eb",
            "fill-opacity": 0.2,
            "fill-outline-color": "#1d4ed8",
          },
        });
        const data = featureCollection(layers.flatMap((l) => l.data.features));
        if (data.features.length && !fitted) {
          const bounds = bbox(data);
          map.fitBounds(
            [
              [bounds[0], bounds[1]],
              [bounds[2], bounds[3]],
            ],
            { padding: 35, maxZoom: 17, duration: 0 },
          );
          fitted = true;
        }
        for (const layer of layers)
          map.setLayoutProperty(
            layer.config.id,
            "visibility",
            visibleRef.current.includes(layer.config.id) ? "visible" : "none",
          );
      });
      map.on("click", (event) => {
        const ids = layersRef.current
          .map((l) => l.config.id)
          .filter((id) => map.getLayer(id));
        const hit = map.queryRenderedFeatures(event.point, { layers: ids })[0];
        const layer =
          hit && layersRef.current.find((l) => l.config.id === hit.layer.id);
        const index = Number(hit?.properties?._spatialIndex);
        if (layer && layer.data.features[index])
          selectRef.current(layer, layer.data.features[index], index);
      });
      // Keep the initial project map working while the optional background loads.
      const timeout = setTimeout(() => controller.abort(), 10000);
      fetch(BASEMAP_STYLE_URL, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("Basemap unavailable");
          const style = await response.json() as maplibregl.StyleSpecification;
          if (style.version !== 8 || !style.sources || !Array.isArray(style.layers)) throw new Error("Invalid basemap style");
          if (!controller.signal.aborted) map.setStyle(basemapStyle(style), { diff: false });
        })
        .catch(() => {
          if (mapRef.current === map) setBasemapError("배경 지도를 불러오지 못했어요. 업로드한 레이어와 공간 분석은 계속 사용할 수 있습니다.");
        })
        .finally(() => clearTimeout(timeout));
      return () => {
        clearTimeout(timeout);
        controller.abort();
        resize.disconnect();
        map.remove();
        mapRef.current = null;
      };
    } catch {
      controller.abort();
      setError(
        "지도를 표시하지 못했어요. 브라우저의 WebGL 지원을 확인해주세요.",
      );
    }
    // A dataset load builds its map once; visibility and results update independently.
  }, [layers]);
  useEffect(() => {
    const map = mapRef.current;
    for (const l of layers)
      if (map?.getLayer(l.config.id))
        map.setLayoutProperty(
          l.config.id,
          "visibility",
          visible.includes(l.config.id) ? "visible" : "none",
        );
  }, [visible, layers]);
  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource("__selection") as
      maplibregl.GeoJSONSource | undefined;
    source?.setData(overlay);
  }, [overlay]);
  return (
    <div>
      <div
        ref={container}
        aria-label="사업 공간 데이터 지도"
        className="h-[360px] w-full rounded-xl border border-slate-200 sm:h-[420px]"
      />
      {basemapError && (
        <p role="status" className="mt-2 text-sm text-amber-700">{basemapError}</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-amber-700">
          {error}
        </p>
      )}
    </div>
  );
}
