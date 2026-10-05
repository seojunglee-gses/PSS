import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const root = process.env.PSS_TEST_BUILD;
const engine = require(`${root}/lib/spatial/engine.js`);
const loader = require(`${root}/lib/spatial/loader.js`);
const { parseSpatialResult } = require(`${root}/lib/spatial/context.js`);
const { parseAnalysisRequest } = require(`${root}/lib/research/evidence.js`);
const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/spatial/${name}`, import.meta.url),
      "utf8",
    ),
  );
const config = fixture("config.json");
const layer = (i, file) => ({
  config: config.layers[i],
  data: loader.validateGeoJSON(fixture(file), config.layers[i]),
});
const boundary = layer(0, "boundary.geojson"),
  green = layer(1, "green.geojson"),
  facility = layer(2, "facilities.geojson");
const area = boundary.data.features[0];
test("project config rejects cross-project, remote URLs and traversal", () => {
  assert.equal(loader.validateConfig(config, "spatial-test").layers.length, 4);
  assert.throws(() => loader.validateConfig(config, "other"));
  for (const source of [
    "https://example.org/x.geojson",
    "/data/projects/spatial-test/../x.geojson",
    "/data/projects/other/x.geojson",
  ])
    assert.throws(() =>
      loader.validateConfig(
        {
          ...config,
          layers: [{ ...config.layers[0], source }],
          priority: undefined,
        },
        "spatial-test",
      ),
    );
  assert.throws(() => loader.projectDirectory("../other"));
});
test("valid geometries pass; empty, null, invalid rings and projected coordinates fail", () => {
  assert.equal(
    loader.validateGeoJSON(area, config.layers[0]).features.length,
    1,
  );
  for (const value of [
    { type: "FeatureCollection", features: [] },
    { ...area, geometry: null },
    {
      ...area,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        ],
      },
    },
    { ...area, geometry: { type: "Point", coordinates: [500000, 4500000] } },
  ])
    assert.throws(() => loader.validateGeoJSON(value, config.layers[0]));
});
test("area metrics use clipped union; no invented unavailable metrics", () => {
  const stats = engine.areaStatistics(area, [boundary, green, facility]);
  assert.ok(stats.metrics.areaSqm > 900000 && stats.metrics.areaSqm < 1100000);
  assert.ok(Math.abs(stats.metrics.greenRatio - 0.5) < 0.0001);
  assert.equal(stats.metrics.facilityCount, 1);
  assert.equal(stats.metrics.population, undefined);
  assert.equal(stats.metrics.buildingCount, undefined);
  const duplicate = {
    ...green,
    data: {
      ...green.data,
      features: [...green.data.features, ...green.data.features],
    },
  };
  assert.equal(
    engine.areaStatistics(area, [duplicate]).metrics.greenAreaSqm,
    stats.metrics.greenAreaSqm,
  );
});
test("population partial zones are withheld instead of interpolated", () => {
  const population = {
    ...boundary,
    config: {
      ...boundary.config,
      role: "population",
      populationField: "population",
    },
    data: {
      ...boundary.data,
      features: [{ ...area, properties: { population: 100 } }],
    },
  };
  assert.equal(
    engine.areaStatistics(area, [population]).metrics.population,
    100,
  );
  assert.equal(
    engine.areaStatistics(green.data.features[0], [population]).metrics
      .population,
    undefined,
  );
});
test("buffer expands selected point and polygon, rejects unsupported distance", () => {
  const shape = engine.createBuffer(facility.data.features[0], 300);
  assert.ok(engine.areaStatistics(shape, []).metrics.areaSqm > 270000);
  assert.equal(
    engine.areaStatistics(shape, [facility]).metrics.facilityCount,
    1,
  );
  assert.ok(
    engine.areaStatistics(engine.createBuffer(area, 100), []).metrics.areaSqm >
      engine.areaStatistics(area, []).metrics.areaSqm,
  );
  assert.throws(() => engine.createBuffer(area, 0));
  assert.throws(() => engine.createBuffer(area, Infinity));
});
test("intersection returns exact clipped area, handles empty overlap and duplicate union", () => {
  const shapes = engine.intersectionAreas(boundary, green);
  assert.equal(shapes.length, 1);
  assert.equal(
    engine.overlayArea(shapes),
    engine.areaStatistics(area, [green]).metrics.greenAreaSqm,
  );
  const far = {
    ...green,
    data: {
      ...green.data,
      features: [
        {
          ...area,
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [0.01, 0],
                [0.01, 0.01],
                [0, 0.01],
                [0, 0],
              ],
            ],
          },
        },
      ],
    },
  };
  assert.equal(engine.intersectionAreas(boundary, far).length, 0);
  assert.throws(() => engine.intersectionAreas(boundary, facility));
});
test("priority normalizes direction/weights, constant fields and missing values", () => {
  const l = {
    ...boundary,
    data: {
      ...boundary.data,
      features: [
        { ...area, id: "a", properties: { heat: 10, green: 0 } },
        { ...area, id: "b", properties: { heat: 0, green: 10 } },
      ],
    },
  };
  assert.deepEqual(
    engine.scorePriority(l, [
      { field: "heat", direction: "higher", weight: 1 },
      { field: "green", direction: "lower", weight: 2 },
    ]),
    [
      { featureId: "a", score: 1 },
      { featureId: "b", score: 0 },
    ],
  );
  assert.equal(
    engine.scorePriority(boundary, config.priority.criteria)[0].score,
    0.5,
  );
  assert.throws(
    () =>
      engine.scorePriority(boundary, [
        { field: "missing", direction: "higher", weight: 1 },
      ]),
    /missing/,
  );
});
test("compact context contains no geometry, preserves parameters, validates finite metrics", () => {
  const r = engine.resultFor("spatial-test", "area", [green], area, {
    selectedFeatureId: "test-zone",
  });
  const safe = parseSpatialResult({
    ...r,
    geojson: fixture("boundary.geojson"),
  });
  assert.equal(safe.geojson, undefined);
  assert.equal(
    parseAnalysisRequest({ question: "녹지 접근성은?", spatialContext: safe })
      .spatialContext.metrics.greenRatio,
    safe.metrics.greenRatio,
  );
  assert.throws(() => parseSpatialResult({ ...r, metrics: { areaSqm: NaN } }));
});
test("missing config becomes empty state and missing layers reject cleanly", async () => {
  const original = global.fetch;
  global.fetch = async () => ({ status: 404, ok: false });
  try {
    assert.deepEqual(await loader.loadSpatialConfig("no-data"), {
      projectId: "no-data",
      layers: [],
    });
    await assert.rejects(
      loader.loadLayer({
        ...config.layers[0],
        source: "/data/projects/no-data/boundary.geojson",
      }),
    );
  } finally {
    global.fetch = original;
  }
});

test('building footprints clip at the boundary and averages omit missing attributes with a count', () => {
  const buildings = {...green,config:{...green.config,role:'buildings',averageFields:['height']},data:{...green.data,features:[{...green.data.features[0],properties:{height:12}},{...green.data.features[0],properties:{}}]}};
  const metrics = engine.areaStatistics(area,[buildings]).metrics;
  assert.equal(metrics.buildingCount,2);
  assert.equal(metrics.buildingFootprintSqm,engine.areaStatistics(area,[green]).metrics.greenAreaSqm);
  assert.equal(metrics['average:green:height'],12);
  assert.equal(metrics['averageCount:green:height'],1);
});
