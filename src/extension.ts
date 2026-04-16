// Extension entry point. Orchestrates the selection writer, webview panels,
// commands, and configuration-change handling. Actual feature logic lives in
// peer modules. v3: user-scope only.

import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";

import {
  SEGMENT_META,
  SEGMENT_ORDER,
  normalizeSegments,
} from "./segments";
import {
  BUILT_IN_PRESETS,
  PRESET_ORDER,
  buildEnvelope,
  detectActivePreset,
  parseEnvelope,
} from "./presets";
import { ClaudeBridgeSidebarProvider } from "./webview/sidebarProvider";
import { ClaudeBridgeSettingsPanel } from "./webview/settingsPanel";
import { InboundMessage, State } from "./webview/messages";

import {
  CONTEXT_FILE,
  CONTEXT_SENT_FILE,
  STATUSLINE_FILE,
} from "./paths";
import {
  getConfig,
  readSettings,
  presetSettingsFrom,
} from "./settings";
import {
  hasExistingClaudeBridgeConfig,
  installAtUser,
  isInstalled,
  uninstallAtUser,
  uninstallEverywhere,
} from "./claudeSettings";
import {
  cleanupFiles,
  cleanupFilesSync,
  disposeDebounce,
  getCurrentSelection,
  initSelectionWriter,
  previewSelection,
  refreshStatusBar,
  resetSelectionDedupe,
  writeSelection,
} from "./selectionWriter";
import { disposeFileOpener, initFileOpener, setAutoOpenEnabled, verifyAutoOpenSetup } from "./fileOpener";
import { writeStatusLineScript } from "./statusLineScript";

const SETUP_COMPLETED_KEY = "claudeBridge.setupCompleted";

// --- Extension-scope state ---
let statusBarItem: vscode.StatusBarItem;
let extensionPath = "";
let extensionVersion = "";
let sidebarProvider: ClaudeBridgeSidebarProvider | undefined;
let settingsPanel: ClaudeBridgeSettingsPanel | undefined;
let logChannel: vscode.OutputChannel | undefined;
let extensionContext: vscode.ExtensionContext | undefined;

function getSetupCompleted(): boolean {
  return extensionContext?.globalState.get<boolean>(SETUP_COMPLETED_KEY, false) ?? false;
}

async function setSetupCompleted(done: boolean): Promise<void> {
  await extensionContext?.globalState.update(SETUP_COMPLETED_KEY, done);
}

function log(...parts: unknown[]): void {
  if (!logChannel) return;
  const stamp = new Date().toISOString().split("T")[1]?.slice(0, 12) ?? "";
  const line = parts
    .map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
    .join(" ");
  logChannel.appendLine(`[${stamp}] ${line}`);
}

function buildState(): State {
  return {
    version: extensionVersion,
    settings: readSettings(),
    segments: normalizeSegments(getConfig().get("statusLineSegments")),
    segmentMeta: SEGMENT_ORDER.map((id) => SEGMENT_META[id]),
    presets: PRESET_ORDER.map((id) => {
      const p = BUILT_IN_PRESETS[id];
      return { id: p.id, label: p.label, description: p.description };
    }),
    selection: getCurrentSelection(),
    setupCompleted: getSetupCompleted() && isInstalled(),
  };
}

const TARGET = vscode.ConfigurationTarget.Global;

function broadcastState(): void {
  const state = buildState();
  sidebarProvider?.postState(state);
  settingsPanel?.postState(state);
}

// --- Preset operations ---

async function applyPreset(presetId: string): Promise<void> {
  const preset = BUILT_IN_PRESETS[presetId];
  if (!preset) return;
  const cfg = getConfig();
  for (const [key, value] of Object.entries(preset.settings)) {
    await cfg.update(key, value, TARGET);
  }
  await cfg.update("statusLineSegments", preset.segments, TARGET);
  await cfg.update("activePreset", preset.id, TARGET);
}

async function syncActivePreset(): Promise<void> {
  const settings = readSettings();
  const segments = normalizeSegments(getConfig().get("statusLineSegments"));
  const detected = detectActivePreset(presetSettingsFrom(settings), segments);
  if (detected !== settings.activePreset) {
    await getConfig().update("activePreset", detected, TARGET);
  }
}

async function exportCurrentPreset(): Promise<void> {
  const settings = readSettings();
  const segments = normalizeSegments(getConfig().get("statusLineSegments"));
  const presetMeta = BUILT_IN_PRESETS[settings.activePreset];
  const label = presetMeta?.label ?? "Claude Bridge custom";
  const envelope = buildEnvelope(
    label,
    presetSettingsFrom(settings),
    segments,
    presetMeta?.description,
  );

  const uri = await vscode.window.showSaveDialog({
    saveLabel: "Export preset",
    filters: { "JSON files": ["json"] },
    defaultUri: vscode.Uri.file(
      path.join(os.homedir(), "claude-bridge-preset.json"),
    ),
  });
  if (!uri) return;

  await vscode.workspace.fs.writeFile(
    uri,
    Buffer.from(JSON.stringify(envelope, null, 2), "utf-8"),
  );
  vscode.window.showInformationMessage(
    `Claude Bridge: exported preset to ${path.basename(uri.fsPath)}.`,
  );
}

async function importPresetFromFile(): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFiles: true,
    canSelectFolders: false,
    filters: { "JSON files": ["json"] },
    openLabel: "Import preset",
  });
  const uri = uris?.[0];
  if (!uri) return;
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const json = Buffer.from(bytes).toString("utf-8");
    const envelope = parseEnvelope(json);
    const cfg = getConfig();
    for (const [key, value] of Object.entries(envelope.settings)) {
      if (value === undefined) continue;
      await cfg.update(key, value, TARGET);
    }
    await cfg.update("statusLineSegments", envelope.segments, TARGET);
    await cfg.update("activePreset", "custom", TARGET);
    vscode.window.showInformationMessage(
      `Claude Bridge: imported preset${envelope.label ? ` "${envelope.label}"` : ""}.`,
    );
  } catch (err) {
    vscode.window.showErrorMessage(
      `Claude Bridge: import failed — ${(err as Error).message}`,
    );
  }
}

// --- Install / uninstall flows ---

async function runInstall(): Promise<void> {
  const { additions, removals } = installAtUser({ extPath: extensionPath, log });
  await setSetupCompleted(true);
  broadcastState();
  const parts: string[] = [];
  if (additions.length) parts.push(`added ${additions.join(" + ")}`);
  if (removals.length) parts.push(`removed ${removals.join(" + ")}`);
  vscode.window.showInformationMessage(
    parts.length
      ? `Claude Bridge: installed at User (${parts.join("; ")}).`
      : `Claude Bridge: already installed at User.`,
  );
}

async function runUninstall(): Promise<void> {
  if (!isInstalled()) {
    vscode.window.showInformationMessage("Claude Bridge: not installed.");
    return;
  }
  uninstallAtUser(log);
  await setSetupCompleted(false);
  broadcastState();
  vscode.window.showInformationMessage("Claude Bridge: uninstalled.");
}

// --- Webview message handling ---

async function handleWebviewMessage(msg: InboundMessage): Promise<void> {
  log("recv", msg.type, JSON.stringify(msg).substring(0, 200));
  const cfg = getConfig();
  try {
    switch (msg.type) {
      case "ready":
        broadcastState();
        return;
      case "setSetting":
        await cfg.update(msg.key, msg.value, TARGET);
        await syncActivePreset();
        return;
      case "setSegments":
        await cfg.update("statusLineSegments", normalizeSegments(msg.segments), TARGET);
        await syncActivePreset();
        return;
      case "applyPreset":
        await applyPreset(msg.presetId);
        return;
      case "exportPreset":
        await exportCurrentPreset();
        return;
      case "importPreset":
        await importPresetFromFile();
        return;
      case "openSettings":
        openSettingsPanel();
        return;
      case "install":
        await runInstall();
        return;
      case "uninstall":
        await runUninstall();
        return;
      case "perf":
        log(`perf ${msg.label} ${msg.ms.toFixed(1)}ms`);
        return;
    }
  } catch (err) {
    log("ERROR handling", (msg as { type?: string }).type, "-", (err as Error).message);
  }
}

function openSettingsPanel(): void {
  settingsPanel = ClaudeBridgeSettingsPanel.showOrReveal(
    vscode.Uri.file(extensionPath),
    buildState,
    handleWebviewMessage,
  );
  settingsPanel.postState(buildState());
}

// --- Activation ---

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  extensionPath = context.extensionPath;
  extensionVersion = (context.extension.packageJSON as { version?: string }).version ?? "0.0.0";

  // Migration: users upgrading from 1.x / 2.x may have our config present but
  // no persistent flag. Detect and normalize.
  if (!getSetupCompleted() && hasExistingClaudeBridgeConfig()) {
    void setSetupCompleted(true);
  }

  logChannel = vscode.window.createOutputChannel("Claude Bridge");
  context.subscriptions.push(logChannel);
  log("activate v" + extensionVersion);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBarItem.command = "claude-bridge.openDashboard";
  statusBarItem.text = "$(link) Claude Bridge";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  initSelectionWriter({
    statusBarItem,
    version: extensionVersion,
    onChanged: broadcastState,
    log: (msg) => log(msg),
  });

  initFileOpener((msg) => log(msg));
  setAutoOpenEnabled(getConfig().get<boolean>("autoOpenModifiedFiles", false));

  sidebarProvider = new ClaudeBridgeSidebarProvider(
    context.extensionUri,
    buildState,
    handleWebviewMessage,
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ClaudeBridgeSidebarProvider.viewType,
      sidebarProvider,
    ),
  );

  // Self-heal: if setup is marked complete, silently re-apply our settings.json
  // entries and regenerate the statusLine script. This is a no-op if entries
  // are already current.
  if (getSetupCompleted()) {
    installAtUser({ extPath: extensionPath, log });
  }

  // First-run nudge.
  if (!getSetupCompleted()) {
    void vscode.commands.executeCommand("claude-bridge.openDashboard");
  }

  // Commands.
  context.subscriptions.push(
    vscode.commands.registerCommand("claude-bridge.clearSelection", () => {
      void cleanupFiles();
      vscode.window.showInformationMessage("Claude Bridge: selection cleared.");
    }),
    vscode.commands.registerCommand("claude-bridge.install", async () => {
      await runInstall();
    }),
    vscode.commands.registerCommand("claude-bridge.uninstall", async () => {
      await runUninstall();
    }),
    vscode.commands.registerCommand("claude-bridge.uninstallEverywhere", async () => {
      const touched = uninstallEverywhere(log);
      const cfg = getConfig();
      for (const key of [
        "contextInjection", "statusLine", "autoOpenModifiedFiles",
        "maxLines", "statusLineMaxPath", "statusLinePathStyle",
        "showPartialLineContext", "statusLineSegments", "activePreset",
        "excludedPatterns",
      ]) {
        await cfg.update(key, undefined, vscode.ConfigurationTarget.Global);
      }
      await setSetupCompleted(false);
      broadcastState();
      vscode.window.showInformationMessage(
        touched.length > 0
          ? `Claude Bridge: uninstalled and settings reset.`
          : "Claude Bridge: nothing to uninstall.",
      );
    }),
    vscode.commands.registerCommand("claude-bridge.preview", () => {
      previewSelection();
    }),
    vscode.commands.registerCommand("claude-bridge.openSettings", () => {
      openSettingsPanel();
    }),
    vscode.commands.registerCommand("claude-bridge.exportPreset", () => {
      void exportCurrentPreset();
    }),
    vscode.commands.registerCommand("claude-bridge.importPreset", () => {
      void importPresetFromFile();
    }),
    vscode.commands.registerCommand("claude-bridge.openDashboard", () => {
      void vscode.commands.executeCommand(
        `workbench.view.extension.claude-bridge`,
      );
    }),
    vscode.commands.registerCommand("claude-bridge.diagnoseAutoOpen", async () => {
      const report = await verifyAutoOpenSetup();
      logChannel?.show(true);
      log("--- Auto-open diagnostic ---");
      for (const line of report.split("\n")) log(line);
      log("----------------------------");
    }),
  );

  refreshStatusBar();

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((event) => {
      writeSelection(event.textEditor);
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      writeSelection(editor);
    }),
  );

  // Config change: always regenerate the statusLine script so toggles land
  // live, then handle cleanup for disabled features.
  let configChangeTimer: ReturnType<typeof setTimeout> | undefined;
  const handleConfigChange = async (): Promise<void> => {
    const newCfg = getConfig();

    log("handleConfigChange: regenerating statusline script");
    writeStatusLineScript(extensionPath, log);

    const cleanups: Promise<unknown>[] = [];
    if (!newCfg.get<boolean>("contextInjection", true)) {
      cleanups.push(fs.unlink(CONTEXT_FILE).catch(() => {}));
      cleanups.push(fs.unlink(CONTEXT_SENT_FILE).catch(() => {}));
    }
    if (!newCfg.get<boolean>("statusLine", true)) {
      cleanups.push(fs.unlink(STATUSLINE_FILE).catch(() => {}));
    }
    if (cleanups.length) await Promise.allSettled(cleanups);

    resetSelectionDedupe();
    writeSelection(vscode.window.activeTextEditor);

    setAutoOpenEnabled(newCfg.get<boolean>("autoOpenModifiedFiles", false));
    refreshStatusBar();
    broadcastState();
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("claudeBridge")) return;
      if (configChangeTimer) clearTimeout(configChangeTimer);
      configChangeTimer = setTimeout(() => {
        void handleConfigChange();
      }, 50);
    }),
  );

  context.subscriptions.push({
    dispose: () => {
      disposeDebounce();
      disposeFileOpener();
      if (configChangeTimer) clearTimeout(configChangeTimer);
      cleanupFilesSync();
    },
  });
}

export function deactivate(): void {
  cleanupFilesSync();
}
