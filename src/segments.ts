// Segment metadata and helpers shared across extension + webview.

export type SegmentId =
  | "model"
  | "gitBranch"
  | "contextBar"
  | "contextPercentage"
  | "cost"
  | "linesChanged"
  | "rateLimits"
  | "sessionDuration"
  | "selection";

export interface SegmentEntry {
  id: SegmentId;
  enabled: boolean;
}

export interface SegmentMeta {
  id: SegmentId;
  label: string;
  description: string;
  example: string;
}

export const SEGMENT_META: Record<SegmentId, SegmentMeta> = {
  model: {
    id: "model",
    label: "Model",
    description: "Model name (e.g., Opus 4.6)",
    example: "Opus 4.6",
  },
  gitBranch: {
    id: "gitBranch",
    label: "Git branch",
    description: "Current git branch",
    example: "main",
  },
  contextBar: {
    id: "contextBar",
    label: "Context bar",
    description: "Context window progress bar",
    example: "\u2588\u2588\u2591\u2591\u2591\u2591",
  },
  contextPercentage: {
    id: "contextPercentage",
    label: "Context %",
    description: "Context window usage percentage",
    example: "24%",
  },
  cost: {
    id: "cost",
    label: "Cost",
    description: "Session cost in USD",
    example: "$0.12",
  },
  linesChanged: {
    id: "linesChanged",
    label: "Lines changed",
    description: "Lines added/removed this session",
    example: "+42 -3",
  },
  rateLimits: {
    id: "rateLimits",
    label: "Rate limits",
    description: "5-hour and 7-day rate limit usage",
    example: "5h:12% 7d:3%",
  },
  sessionDuration: {
    id: "sessionDuration",
    label: "Session duration",
    description: "Session wall-clock duration",
    example: "1h 23m",
  },
  selection: {
    id: "selection",
    label: "VS Code selection",
    description: "Current VS Code selection (@file#lines)",
    example: "@src/app.ts#L12-45",
  },
};

export const SEGMENT_ORDER: SegmentId[] = [
  "model",
  "gitBranch",
  "contextBar",
  "contextPercentage",
  "cost",
  "linesChanged",
  "rateLimits",
  "sessionDuration",
  "selection",
];

export const DEFAULT_SEGMENTS: SegmentEntry[] = [
  { id: "model", enabled: true },
  { id: "gitBranch", enabled: true },
  { id: "contextBar", enabled: true },
  { id: "contextPercentage", enabled: true },
  { id: "cost", enabled: false },
  { id: "linesChanged", enabled: false },
  { id: "rateLimits", enabled: false },
  { id: "sessionDuration", enabled: false },
  { id: "selection", enabled: true },
];

/**
 * Normalise raw settings data into a validated, deduplicated SegmentEntry[].
 * - Ignores unknown segment ids.
 * - Drops duplicates (first occurrence wins).
 * - Appends any known segments missing from the input using their default enabled state.
 */
export function normalizeSegments(raw: unknown): SegmentEntry[] {
  const result: SegmentEntry[] = [];
  const seen = new Set<SegmentId>();

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const id = (item as { id?: unknown }).id;
      const enabled = (item as { enabled?: unknown }).enabled;
      if (typeof id !== "string" || !(id in SEGMENT_META)) continue;
      if (seen.has(id as SegmentId)) continue;
      seen.add(id as SegmentId);
      result.push({ id: id as SegmentId, enabled: Boolean(enabled) });
    }
  }

  for (const id of SEGMENT_ORDER) {
    if (seen.has(id)) continue;
    const def = DEFAULT_SEGMENTS.find((s) => s.id === id);
    if (def) result.push({ ...def });
  }

  return result;
}

export function segmentsEqual(a: SegmentEntry[], b: SegmentEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].enabled !== b[i].enabled) return false;
  }
  return true;
}
