import type { StyleSpecification } from "maplibre-gl";

export const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
export const BASEMAP_PREFIX = "__basemap_";

// Keep background-map sources/layers separate from project layer IDs.
export function basemapStyle(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    sources: Object.fromEntries(Object.entries(style.sources).map(([id, source]) => [BASEMAP_PREFIX + id, {
      ...source,
      attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> &copy; <a href="https://openmaptiles.org" target="_blank" rel="noopener noreferrer">OpenMapTiles</a> · Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
    }])),
    layers: style.layers.map((layer) => ({ ...layer, id: BASEMAP_PREFIX + layer.id, ...("source" in layer ? { source: BASEMAP_PREFIX + layer.source } : {}) })),
  };
}
