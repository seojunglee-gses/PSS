import type {
  Feature,
  FeatureCollection,
  Geometry,
  Polygon,
  MultiPolygon,
} from "geojson";
export type AreaFeature = Feature<Polygon | MultiPolygon>;
export type LayerConfig = {
  id: string;
  label: string;
  type: "polygon" | "line" | "point";
  source: string;
  defaultVisible?: boolean;
  color?: string;
  displayFields?: string[];
  fieldLabels?: Record<string, string>;
  role?:
    "boundary" | "buildings" | "green" | "population" | "facilities" | "roads";
  populationField?: string;
  averageFields?: string[];
};
export type Criterion = {
  field: string;
  direction: "higher" | "lower";
  weight: number;
};
export type SpatialConfig = {
  datasetWarnings?: string[];
  projectId: string;
  layers: LayerConfig[];
  priority?: { layerId: string; criteria: Criterion[] };
};
export type LoadedLayer = {
  config: LayerConfig;
  data: FeatureCollection<Geometry>;
};
export type SpatialResult = {
  buildingUses?: { use_code: string; use_name: string; count: number }[];
  projectId: string;
  type: "area" | "buffer" | "intersection" | "priority";
  timestamp: string;
  layerIds: string[];
  parameters: Record<string, string | number>;
  metrics: Record<string, number>;
  notes: string[];
  priorities?: { featureId: string; score: number }[];
};
