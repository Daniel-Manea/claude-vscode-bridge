import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BUILT_IN_PRESETS,
  buildEnvelope,
  detectActivePreset,
  parseEnvelope,
  PRESET_ENVELOPE_VERSION,
} from "../presets";

test("detectActivePreset finds exact match for a built-in", () => {
  const preset = BUILT_IN_PRESETS.default;
  const detected = detectActivePreset(preset.settings, preset.segments);
  assert.equal(detected, "default");
});

test("detectActivePreset returns 'custom' on any divergence", () => {
  const preset = BUILT_IN_PRESETS.default;
  const divergent = { ...preset.settings, maxLines: 9999 };
  assert.equal(detectActivePreset(divergent, preset.segments), "custom");

  const reorderedSegments = [...preset.segments].reverse();
  assert.equal(detectActivePreset(preset.settings, reorderedSegments), "custom");
});

test("detectActivePreset matches all four built-ins", () => {
  for (const id of ["minimal", "default", "powerUser", "costConscious"] as const) {
    const p = BUILT_IN_PRESETS[id];
    assert.equal(detectActivePreset(p.settings, p.segments), id, `expected ${id}`);
  }
});

test("parseEnvelope round-trips a buildEnvelope output", () => {
  const preset = BUILT_IN_PRESETS.powerUser;
  const json = JSON.stringify(buildEnvelope("Power", preset.settings, preset.segments, "desc"));
  const parsed = parseEnvelope(json);
  assert.equal(parsed.claudeBridgePreset, PRESET_ENVELOPE_VERSION);
  assert.equal(parsed.label, "Power");
  assert.deepEqual(parsed.segments, preset.segments);
});

test("parseEnvelope rejects non-JSON", () => {
  assert.throws(() => parseEnvelope("{"), /not a valid JSON file/i);
});

test("parseEnvelope rejects wrong version", () => {
  const bad = JSON.stringify({
    claudeBridgePreset: 999,
    settings: {},
    segments: [],
  });
  assert.throws(() => parseEnvelope(bad), /unsupported preset version/i);
});

test("parseEnvelope rejects missing settings", () => {
  const bad = JSON.stringify({
    claudeBridgePreset: PRESET_ENVELOPE_VERSION,
    segments: [],
  });
  assert.throws(() => parseEnvelope(bad), /missing 'settings'/i);
});

test("parseEnvelope rejects non-array segments", () => {
  const bad = JSON.stringify({
    claudeBridgePreset: PRESET_ENVELOPE_VERSION,
    settings: {},
    segments: "not an array",
  });
  assert.throws(() => parseEnvelope(bad), /must be an array/i);
});

test("parseEnvelope normalises segments (drops unknowns, fills missing)", () => {
  const env = JSON.stringify({
    claudeBridgePreset: PRESET_ENVELOPE_VERSION,
    settings: {},
    segments: [{ id: "model", enabled: true }, { id: "bogus", enabled: true }],
  });
  const parsed = parseEnvelope(env);
  const ids: string[] = parsed.segments.map((s) => s.id);
  assert.ok(!ids.includes("bogus"));
  assert.ok(parsed.segments.find((s) => s.id === "model")?.enabled);
});
