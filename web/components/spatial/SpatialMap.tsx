import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { LoadedLayer } from "../../lib/spatial/types";
import { bbox, featureCollection } from "../../lib/spatial/engine";
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
  const [error, setError] = useState("");
  useEffect(() => {
    if (!container.current) return;
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
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl(), "top-right");
      const resize = new ResizeObserver(() => map.resize());
      resize.observe(container.current);
      map.on("error", (event) => {
        console.error("Spatial map:", event.error.message);
        setError(
          "지도를 표시하는 중 오류가 발생했어요. 새로고침 후 다시 시도해주세요.",
        );
      });
      map.on("load", () => {
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
        map.addSource("__selection", { type: "geojson", data: overlay });
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
        if (data.features.length) {
          const bounds = bbox(data);
          map.fitBounds(
            [
              [bounds[0], bounds[1]],
              [bounds[2], bounds[3]],
            ],
            { padding: 35, maxZoom: 17, duration: 0 },
          );
        }
        for (const layer of layers)
          map.setLayoutProperty(
            layer.config.id,
            "visibility",
            visible.includes(layer.config.id) ? "visible" : "none",
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
      return () => {
        resize.disconnect();
        map.remove();
        mapRef.current = null;
      };
    } catch {
      setError(
        "지도를 표시하지 못했어요. 브라우저의 WebGL 지원을 확인해주세요.",
      );
    }
    // A dataset load builds its map once; visibility and results update independently.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      {error && (
        <p role="alert" className="mt-2 text-sm text-amber-700">
          {error}
        </p>
      )}
    </div>
  );
}
