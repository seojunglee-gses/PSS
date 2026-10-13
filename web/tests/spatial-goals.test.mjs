import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { spatialResultSummary, spatialGoals } = require(
  `${process.env.PSS_TEST_BUILD}/lib/spatial/goals.js`,
);
const result = (type, metrics, parameters = {}) => ({
  type,
  metrics,
  parameters,
  priorities: [],
  notes: [],
  layerIds: [],
  projectId: "test",
  timestamp: "2026-01-01",
});
test("goal cards map exactly to the four existing analysis types", () => {
  assert.deepEqual(
    spatialGoals.map((g) => g.type),
    ["area", "buffer", "intersection", "priority"],
  );
  assert.equal(new Set(spatialGoals.map((g) => g.name)).size, 4);
});
test("summary keeps zero counts and does not invent absent metrics or nearest distances", () => {
  const lines = spatialResultSummary(
    result(
      "buffer",
      { areaSqm: 1234, facilityCount: 0 },
      { distanceMeters: 300 },
    ),
  );
  assert.ok(lines.some((l) => l.includes("300m")));
  assert.ok(lines.some((l) => l.includes("0곳")));
  assert.ok(lines.some((l) => l.includes("걸친")));
  assert.ok(!lines.some((l) => /건물|가까운|120m/.test(l)));
});
test("intersection zero is explicit and priority describes ranks without significance claims", () => {
  assert.deepEqual(
    spatialResultSummary(result("intersection", { intersectionAreaSqm: 0 })),
    ["두 공간이 겹치는 영역이 없습니다."],
  );
  const r = result("priority", { priorityCount: 30 });
  r.priorities = [{ featureId: "A", score: 0.5 }];
  const lines = spatialResultSummary(r);
  assert.ok(lines[0].includes("30개"));
  assert.ok(lines[1].includes("A"));
});
test("area summary only describes available metrics and formats ratios", () => {
  const lines = spatialResultSummary(
    result("area", { greenRatio: 0.25, population: 10 }),
  );
  assert.ok(lines.some((l) => l.includes("25%")));
  assert.ok(lines.some((l) => l.includes("10명")));
  assert.ok(!lines.some((l) => l.includes("면적은")));
});
