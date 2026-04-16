import { SegmentEntry, SegmentMeta } from "../segments";

export type PathStyle = "basename" | "truncated" | "full";
export type BarStyle = "blocks" | "squares" | "shades" | "dots";

export interface ClaudeBridgeSettings {
  contextInjection: boolean;
  statusLine: boolean;
  autoOpenModifiedFiles: boolean;
  maxLines: number;
  statusLineMaxPath: number;
  statusLinePathStyle: PathStyle;
  statusLineBarStyle: BarStyle;
  statusLineCompact: boolean;
  showPartialLineContext: boolean;
  includeDiagnostics: boolean;
  includeTypeContext: boolean;
  multiCursorSelection: boolean;
  pinnedContextEnabled: boolean;
  codeLensClaudeEdits: boolean;
  codeLensTestFailures: boolean;
  commandCenterOnStatusClick: boolean;
  showSessionStats: boolean;
  activePreset: string;
  excludedPatterns: string[];
}

export interface PresetSummary {
  id: string;
  label: string;
  description: string;
}

export interface SelectionInfo {
  relativePath: string;
  startLine: number;
  endLine: number;
  lineCount: number;
  isPartial: boolean;
}

export interface State {
  version: string;
  settings: ClaudeBridgeSettings;
  segments: SegmentEntry[];
  segmentMeta: SegmentMeta[];
  presets: PresetSummary[];
  selection: SelectionInfo | null;
  /** True once Claude Bridge has been installed into ~/.claude/settings.json. */
  setupCompleted: boolean;
  /** Counters shown in the sidebar. */
  recentCount: number;
  editsCount: number;
  pinsCount: number;
  /** Total successful selection writes this session (i.e. times the bridge files got rewritten). */
  selectionsWritten: number;
}

// ---------- Webview -> Extension ----------
export type InboundMessage =
  | { type: "ready" }
  | { type: "setSetting"; key: keyof ClaudeBridgeSettings; value: unknown }
  | { type: "setSegments"; segments: SegmentEntry[] }
  | { type: "applyPreset"; presetId: string }
  | { type: "exportPreset" }
  | { type: "importPreset" }
  | { type: "openSettings" }
  | { type: "install" }
  | { type: "uninstall" }
  | { type: "perf"; label: string; ms: number }
  | { type: "runCommand"; command: string };

// ---------- Extension -> Webview ----------
export type OutboundMessage =
  | { type: "state"; state: State }
  | { type: "info"; message: string }
  | { type: "error"; message: string };
