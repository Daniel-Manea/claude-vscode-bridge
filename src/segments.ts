// Segment metadata and helpers shared across extension + webview.

export type SegmentId =
  | "model"
  | "gitBranch"
  | "contextBar"
  | "contextPercentage"
  | "tokensUsed"
  | "cost"
  | "linesChanged"
  | "rateLimits"
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
    description: "Active model",
    example: "Opus 4.7",
  },
  gitBranch: {
    id: "gitBranch",
    label: "Git branch",
    description: "Current branch",
    example: "main",
  },
  contextBar: {
    id: "contextBar",
    label: "Context bar",
    description: "Context window usage bar",
    example: "\u2588\u2588\u2591\u2591\u2591\u2591",
  },
  contextPercentage: {
    id: "contextPercentage",
    label: "Context %",
    description: "Context window usage as a percentage",
    example: "24%",
  },
  tokensUsed: {
    id: "tokensUsed",
    label: "Tokens used",
    description: "Cumulative input + output tokens this session",
    example: "45k",
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
    description: "Lines added and removed this session",
    example: "+42 -3",
  },
  rateLimits: {
    id: "rateLimits",
    label: "Rate limits",
    description: "Rate limit usage (5h / 7d windows)",
    example: "5h:12% 7d:3%",
  },
  selection: {
    id: "selection",
    label: "Editor selection",
    description: "Current editor selection (file and line range)",
    example: "app.ts L12–45",
  },
};

export const SEGMENT_ORDER: SegmentId[] = [
  "model",
  "gitBranch",
  "contextBar",
  "contextPercentage",
  "tokensUsed",
  "cost",
  "linesChanged",
  "rateLimits",
  "selection",
];

export const DEFAULT_SEGMENTS: SegmentEntry[] = [
  { id: "model", enabled: true },
  { id: "gitBranch", enabled: true },
  { id: "contextBar", enabled: true },
  { id: "contextPercentage", enabled: true },
  { id: "tokensUsed", enabled: false },
  { id: "cost", enabled: false },
  { id: "linesChanged", enabled: false },
  { id: "rateLimits", enabled: false },
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
