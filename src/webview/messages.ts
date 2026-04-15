import { SegmentEntry, SegmentMeta } from "../segments";

export type SettingsTarget = "user" | "project" | "projectLocal" | "ask";
export type PathStyle = "basename" | "truncated" | "full";

export interface ClaudeBridgeSettings {
  enabled: boolean;
  contextInjection: boolean;
  statusLine: boolean;
  autoSetup: boolean;
  maxLines: number;
  debounceMs: number;
  statusLineMaxPath: number;
  statusLinePathStyle: PathStyle;
  contextPrefix: string;
  showPartialLineContext: boolean;
  settingsTarget: SettingsTarget;
  activePreset: string;
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
  | { type: "runSetup" }
  | { type: "removeConfig" };

// ---------- Extension -> Webview ----------
export type OutboundMessage =
  | { type: "state"; state: State }
  | { type: "info"; message: string }
  | { type: "error"; message: string };
