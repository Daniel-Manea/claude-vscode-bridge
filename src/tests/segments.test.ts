import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeSegments, segmentsEqual, DEFAULT_SEGMENTS, SEGMENT_ORDER } from "../segments";

test("normalizeSegments drops unknown ids", () => {
  const out = normalizeSegments([
    { id: "model", enabled: true },
    { id: "bogus", enabled: true },
    { id: "selection", enabled: false },
  ]);
  const ids: string[] = out.map((s) => s.id);
  assert.ok(!ids.includes("bogus"), "unknown id must be dropped");
  assert.ok(ids.includes("model"));
  assert.ok(ids.includes("selection"));
});

test("normalizeSegments drops duplicates (first occurrence wins)", () => {
  const out = normalizeSegments([
    { id: "model", enabled: true },
    { id: "model", enabled: false },
  ]);
  const models = out.filter((s) => s.id === "model");
  assert.equal(models.length, 1);
  assert.equal(models[0].enabled, true, "first occurrence must win");
});

test("normalizeSegments appends missing segments with defaults", () => {
  const out = normalizeSegments([{ id: "model", enabled: false }]);
  // Every known id should be present.
  for (const id of SEGMENT_ORDER) {
    assert.ok(
      out.find((s) => s.id === id),
      `missing segment: ${id}`,
    );
  }
  // The user's explicit entry must be preserved.
  assert.equal(out[0].id, "model");
  assert.equal(out[0].enabled, false);
});

test("normalizeSegments handles non-array input", () => {
  assert.deepEqual(normalizeSegments(null), [...DEFAULT_SEGMENTS]);
  assert.deepEqual(normalizeSegments(undefined), [...DEFAULT_SEGMENTS]);
  assert.deepEqual(normalizeSegments("nope"), [...DEFAULT_SEGMENTS]);
  assert.deepEqual(normalizeSegments(42), [...DEFAULT_SEGMENTS]);
});

test("normalizeSegments handles empty array", () => {
  assert.deepEqual(normalizeSegments([]), [...DEFAULT_SEGMENTS]);
});

test("normalizeSegments skips malformed items but keeps the valid ones", () => {
  const out = normalizeSegments([
    { id: "model", enabled: true },
    null,
    "string",
    { id: 123, enabled: true },
    { enabled: true }, // no id
    { id: "selection", enabled: false },
  ]);
  const ids = out.map((s) => s.id);
  assert.ok(ids.includes("model"));
  assert.ok(ids.includes("selection"));
});

test("normalizeSegments coerces enabled to a boolean", () => {
  const out = normalizeSegments([
    { id: "model", enabled: 1 },
    { id: "gitBranch", enabled: "yes" },
    { id: "selection", enabled: 0 },
  ]);
  assert.equal(out.find((s) => s.id === "model")!.enabled, true);
  assert.equal(out.find((s) => s.id === "gitBranch")!.enabled, true);
  assert.equal(out.find((s) => s.id === "selection")!.enabled, false);
});

test("segmentsEqual compares order and enabled flags", () => {
  const a = [{ id: "model" as const, enabled: true }, { id: "selection" as const, enabled: false }];
  const b = [{ id: "model" as const, enabled: true }, { id: "selection" as const, enabled: false }];
  assert.equal(segmentsEqual(a, b), true);

  const c = [{ id: "model" as const, enabled: true }, { id: "selection" as const, enabled: true }];
  assert.equal(segmentsEqual(a, c), false);

  const d = [{ id: "selection" as const, enabled: false }, { id: "model" as const, enabled: true }];
  assert.equal(segmentsEqual(a, d), false);
});
