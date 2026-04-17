// Shared type definitions for both webview bundles.
// Types are erased at compile time so this file emits no runtime code.

export interface SegmentEntry {
  id: string;
  enabled: boolean;
}

export interface SegmentMeta {
  id: string;
  label: string;
  description: string;
  example: string;
}

export interface PresetSummary {
  id: string;
  label: string;
  description: string;
}

export interface CoreSettings {
  contextInjection: boolean;
  statusLine: boolean;
  autoOpenModifiedFiles: boolean;
  maxLines: number;
  statusLineMaxPath: number;
  statusLinePathStyle: "basename" | "truncated" | "full";
  statusLineBarStyle: "blocks" | "squares" | "shades" | "dots";
  statusLineCompact: boolean;
  showPartialLineContext: boolean;
  includeDiagnostics: boolean;
  includeTypeContext: boolean;
  multiCursorSelection: boolean;
  commandCenterOnStatusClick: boolean;
  showInlineActions: boolean;
  activePreset: string;
  excludedPatterns: string[];
  [k: string]: unknown;
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
  settings: CoreSettings;
  segments: SegmentEntry[];
  segmentMeta: SegmentMeta[];
  presets: PresetSummary[];
  selection: SelectionInfo | null;
  /** True once Claude Bridge has been installed into ~/.claude/settings.json. */
  setupCompleted: boolean;
  howItWorksDismissed: boolean;
  recentCount: number;
  editsCount: number;
  selectionsWritten: number;
}

export interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
