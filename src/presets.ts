import { SegmentEntry, segmentsEqual, normalizeSegments } from "./segments";

export interface PresetSettings {
  contextInjection?: boolean;
  statusLine?: boolean;
  autoOpenModifiedFiles?: boolean;
  maxLines?: number;
  statusLineMaxPath?: number;
  showPartialLineContext?: boolean;
}

export interface Preset {
  id: string;
  label: string;
  description: string;
  settings: PresetSettings;
  segments: SegmentEntry[];
}

export const BUILT_IN_PRESETS: Record<string, Preset> = {
  minimal: {
    id: "minimal",
    label: "Minimal",
    description: "Selection segment only. All other segments hidden.",
    settings: {
      contextInjection: true,
      statusLine: true,
    },
    segments: [
      { id: "model", enabled: false },
      { id: "gitBranch", enabled: false },
      { id: "contextBar", enabled: false },
      { id: "contextPercentage", enabled: false },
      { id: "tokensUsed", enabled: false },
      { id: "cost", enabled: false },
      { id: "linesChanged", enabled: false },
      { id: "rateLimits", enabled: false },
      { id: "selection", enabled: true },
    ],
  },
  default: {
    id: "default",
    label: "Default",
    description: "Model, branch, context bar, and selection.",
    settings: {
      contextInjection: true,
      statusLine: true,
      maxLines: 500,
    },
    segments: [
      { id: "model", enabled: true },
      { id: "gitBranch", enabled: true },
      { id: "contextBar", enabled: true },
      { id: "contextPercentage", enabled: true },
      { id: "tokensUsed", enabled: false },
      { id: "cost", enabled: false },
      { id: "linesChanged", enabled: false },
      { id: "rateLimits", enabled: false },
      { id: "selection", enabled: true },
    ],
  },
  powerUser: {
    id: "powerUser",
    label: "Power user",
    description: "All segments enabled. Selection buffer raised to 1000 lines.",
    settings: {
      contextInjection: true,
      statusLine: true,
      maxLines: 1000,
    },
    segments: [
      { id: "model", enabled: true },
      { id: "gitBranch", enabled: true },
      { id: "contextBar", enabled: true },
      { id: "contextPercentage", enabled: true },
      { id: "tokensUsed", enabled: true },
      { id: "cost", enabled: true },
      { id: "linesChanged", enabled: true },
      { id: "rateLimits", enabled: true },
      { id: "selection", enabled: true },
    ],
  },
  costConscious: {
    id: "costConscious",
    label: "Cost-conscious",
    description: "Adds cost and rate-limit segments to the default layout.",
    settings: {
      contextInjection: true,
      statusLine: true,
      maxLines: 500,
    },
    segments: [
      { id: "model", enabled: true },
      { id: "gitBranch", enabled: false },
      { id: "contextBar", enabled: true },
      { id: "contextPercentage", enabled: true },
      { id: "tokensUsed", enabled: true },
      { id: "cost", enabled: true },
      { id: "linesChanged", enabled: false },
      { id: "rateLimits", enabled: true },
      { id: "selection", enabled: true },
    ],
  },
};

export const PRESET_ORDER: string[] = [
  "minimal",
  "default",
  "powerUser",
  "costConscious",
];

export const PRESET_ENVELOPE_VERSION = 1;

export interface PresetEnvelope {
  claudeBridgePreset: number;
  label?: string;
  description?: string;
  settings: PresetSettings;
  segments: SegmentEntry[];
}

export function buildEnvelope(
  label: string,
  settings: PresetSettings,
  segments: SegmentEntry[],
  description?: string,
): PresetEnvelope {
  return {
    claudeBridgePreset: PRESET_ENVELOPE_VERSION,
    label,
    description,
    settings,
    segments,
  };
}

export function parseEnvelope(json: string): PresetEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`Not a valid JSON file: ${(err as Error).message}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Preset file must be a JSON object.");
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.claudeBridgePreset !== PRESET_ENVELOPE_VERSION) {
    throw new Error(
      `Unsupported preset version ${String(obj.claudeBridgePreset)} (expected ${PRESET_ENVELOPE_VERSION}).`,
    );
  }

  if (!obj.settings || typeof obj.settings !== "object") {
    throw new Error("Preset file is missing 'settings'.");
  }

  if (!Array.isArray(obj.segments)) {
    throw new Error("Preset file 'segments' must be an array.");
  }

  return {
    claudeBridgePreset: PRESET_ENVELOPE_VERSION,
    label: typeof obj.label === "string" ? obj.label : undefined,
    description: typeof obj.description === "string" ? obj.description : undefined,
    settings: obj.settings as PresetSettings,
    segments: normalizeSegments(obj.segments),
  };
}

/**
 * Given the current settings + segments, find which built-in preset matches exactly.
 * Returns "custom" if no built-in matches.
 */
export function detectActivePreset(
  currentSettings: PresetSettings,
  currentSegments: SegmentEntry[],
): string {
  for (const id of PRESET_ORDER) {
    const preset = BUILT_IN_PRESETS[id];
    if (!segmentsEqual(preset.segments, currentSegments)) continue;
    let settingsMatch = true;
    for (const [key, expected] of Object.entries(preset.settings)) {
      const actual = (currentSettings as Record<string, unknown>)[key];
      if (actual !== expected) {
        settingsMatch = false;
        break;
      }
    }
    if (settingsMatch) return id;
  }
  return "custom";
}
