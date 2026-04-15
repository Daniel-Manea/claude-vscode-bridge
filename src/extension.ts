import * as vscode from "vscode";
import * as fs from "fs/promises";
import {
  existsSync,
  unlinkSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
} from "fs";
import * as path from "path";
import * as os from "os";

import {
  SegmentEntry,
  SEGMENT_META,
  SEGMENT_ORDER,
  normalizeSegments,
} from "./segments";
import {
  BUILT_IN_PRESETS,
  PRESET_ORDER,
  PresetSettings,
  buildEnvelope,
  detectActivePreset,
  parseEnvelope,
} from "./presets";
import { ClaudeBridgeSidebarProvider } from "./webview/sidebarProvider";
import { ClaudeBridgeSettingsPanel } from "./webview/settingsPanel";
import {
  ClaudeBridgeSettings,
  InboundMessage,
  SelectionInfo,
  State,
} from "./webview/messages";

// --- File paths ---
const HOME = os.homedir();
const SELECTION_FILE = path.join(HOME, ".claude-vscode-selection.json");
const CONTEXT_FILE = path.join(HOME, ".claude-vscode-context.json");
const STATUSLINE_FILE = path.join(HOME, ".claude-vscode-statusline.txt");
const CONTEXT_SENT_FILE = path.join(HOME, ".claude-vscode-context-sent");
const CLAUDE_SETTINGS_DIR = path.join(HOME, ".claude");
const CLAUDE_SETTINGS_JSON = path.join(CLAUDE_SETTINGS_DIR, "settings.json");
const CLAUDE_SETTINGS_LOCAL = path.join(CLAUDE_SETTINGS_DIR, "settings.local.json");
const STATUSLINE_SCRIPT = path.join(CLAUDE_SETTINGS_DIR, "claude-bridge-statusline.sh");

const BRIDGE_FILES = [SELECTION_FILE, CONTEXT_FILE, STATUSLINE_FILE, CONTEXT_SENT_FILE];

const HOOK_COMMAND =
  'cat>/dev/null;F="$HOME/.claude-vscode-context.json";S="$HOME/.claude-vscode-context-sent";[ -f "$F" ]||exit 0;NEW=$(stat -f%m "$F" 2>/dev/null||stat -c%Y "$F" 2>/dev/null);OLD=$(cat "$S" 2>/dev/null);[ "$NEW" = "$OLD" ]&&exit 0;cat "$F";echo "$NEW">"$S"';

const STATUSLINE_SCRIPT_COMMAND = "~/.claude/claude-bridge-statusline.sh";
const V2_NOTICE_KEY = "claudeBridge.v2NoticeShown";

// --- State ---
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let lastSelectionKey = "";
let statusBarItem: vscode.StatusBarItem;
let extensionPath = "";
let extensionVersion = "";
let currentSelection: SelectionInfo | null = null;
let sidebarProvider: ClaudeBridgeSidebarProvider | undefined;

// --- Config helper ---
function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("claudeBridge");
}

function readSettings(): ClaudeBridgeSettings {
  const cfg = getConfig();
  return {
    enabled: cfg.get<boolean>("enabled", true),
    contextInjection: cfg.get<boolean>("contextInjection", true),
    statusLine: cfg.get<boolean>("statusLine", true),
    autoSetup: cfg.get<boolean>("autoSetup", true),
    maxLines: cfg.get<number>("maxLines", 500),
    debounceMs: cfg.get<number>("debounceMs", 30),
    statusLineMaxPath: cfg.get<number>("statusLineMaxPath", 30),
    statusLinePathStyle: cfg.get("statusLinePathStyle", "basename") as ClaudeBridgeSettings["statusLinePathStyle"],
    contextPrefix: cfg.get<string>("contextPrefix", "[VS Code Selection]"),
    showPartialLineContext: cfg.get<boolean>("showPartialLineContext", true),
    settingsTarget: cfg.get("settingsTarget", "user") as ClaudeBridgeSettings["settingsTarget"],
    activePreset: cfg.get<string>("activePreset", "default"),
  };
}

function presetSettingsFrom(settings: ClaudeBridgeSettings): PresetSettings {
  return {
    enabled: settings.enabled,
    contextInjection: settings.contextInjection,
    statusLine: settings.statusLine,
    maxLines: settings.maxLines,
    debounceMs: settings.debounceMs,
    statusLineMaxPath: settings.statusLineMaxPath,
    contextPrefix: settings.contextPrefix,
    showPartialLineContext: settings.showPartialLineContext,
  };
}

function buildState(): State {
  const settings = readSettings();
  const segments = normalizeSegments(getConfig().get("statusLineSegments"));
  return {
    version: extensionVersion,
    settings,
    segments,
    segmentMeta: SEGMENT_ORDER.map((id) => SEGMENT_META[id]),
    presets: PRESET_ORDER.map((id) => {
      const p = BUILT_IN_PRESETS[id];
      return { id: p.id, label: p.label, description: p.description };
    }),
    selection: currentSelection,
  };
}

// --- Status line script generator ---
function generateStatusLineScript(extPath: string): string {
  const cfg = getConfig();
  const segments = normalizeSegments(cfg.get("statusLineSegments"));
  const contextPct =
    segments.find((s) => s.id === "contextPercentage")?.enabled ?? true;

  const templatePath = path.join(extPath, "media", "statusline-template.sh");
  const template = readFileSync(templatePath, "utf-8");

  // Split out preamble / reorderable blocks / postamble.
  const blockRe = /#SEGMENT:(\w+):BEGIN[\s\S]*?#SEGMENT:\1:END/g;
  const blocks: Record<string, string> = {};
  let firstStart = -1;
  let lastEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(template)) !== null) {
    blocks[m[1]] = m[0];
    if (firstStart === -1) firstStart = m.index;
    lastEnd = m.index + m[0].length;
  }
  const preamble = firstStart === -1 ? template : template.substring(0, firstStart);
  const postamble = lastEnd === -1 ? "" : template.substring(lastEnd);

  // Re-emit blocks in user's order, commenting out disabled ones.
  const assembled: string[] = [preamble.trimEnd()];
  for (const entry of segments) {
    const block = blocks[entry.id];
    if (!block) continue;
    if (entry.enabled) {
      assembled.push(block);
    } else {
      const commented = block
        .split("\n")
        .map((line) => (line.startsWith("#") ? line : `#${line}`))
        .join("\n");
      assembled.push(commented);
    }
  }
  assembled.push(postamble.trimStart());
  let script = assembled.join("\n\n");

  // Handle contextPercentage toggle within the contextBar block.
  if (!contextPct) {
    script = script.replace(
      /#SEGMENT:contextPercentage:YES\n(.*)\n#SEGMENT:contextPercentage:NO\n#(.*)\n#SEGMENT:contextPercentage:ENDALT/,
      "#SEGMENT:contextPercentage:YES\n#$1\n#SEGMENT:contextPercentage:NO\n$2\n#SEGMENT:contextPercentage:ENDALT",
    );
  }

  return script;
}

function writeStatusLineScript(): void {
  try {
    if (!extensionPath) return;
    if (!existsSync(CLAUDE_SETTINGS_DIR)) {
      mkdirSync(CLAUDE_SETTINGS_DIR, { recursive: true });
    }
    writeFileSync(STATUSLINE_SCRIPT, generateStatusLineScript(extensionPath));
    chmodSync(STATUSLINE_SCRIPT, 0o755);
  } catch {
    // Silently fail
  }
}

// --- Settings target resolution ---
function getSettingsTargetPath(cfg: vscode.WorkspaceConfiguration): string {
  const target = cfg.get<string>("settingsTarget", "user");
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  switch (target) {
    case "project":
      if (workspaceFolder) {
        return path.join(workspaceFolder.uri.fsPath, ".claude", "settings.json");
      }
      return CLAUDE_SETTINGS_JSON;
    case "projectLocal":
      if (workspaceFolder) {
        return path.join(workspaceFolder.uri.fsPath, ".claude", "settings.local.json");
      }
      return CLAUDE_SETTINGS_JSON;
    default:
      return CLAUDE_SETTINGS_JSON;
  }
}

async function resolveSettingsTarget(): Promise<string> {
  const cfg = getConfig();
  const target = cfg.get<string>("settingsTarget", "user");

  if (target !== "ask") {
    return getSettingsTargetPath(cfg);
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const options: vscode.QuickPickItem[] = [
    {
      label: "$(home) User settings.json",
      description: "~/.claude/settings.json",
      detail: "Applies to all projects. Recommended for personal use.",
    },
  ];

  if (workspaceFolder) {
    options.push(
      {
        label: "$(folder) Project settings.json",
        description: `.claude/settings.json in ${workspaceFolder.name}`,
        detail: "Applies to this project only. Shared with team via git.",
      },
      {
        label: "$(lock) Project settings.local.json",
        description: `.claude/settings.local.json in ${workspaceFolder.name}`,
        detail: "Applies to this project only. Not committed to git.",
      },
    );
  }

  const picked = await vscode.window.showQuickPick(options, {
    placeHolder: "Where should Claude Bridge write its configuration?",
    title: "Claude Bridge Setup",
  });

  if (!picked) return CLAUDE_SETTINGS_JSON;

  if (picked.label.includes("Project settings.json") && workspaceFolder) {
    return path.join(workspaceFolder.uri.fsPath, ".claude", "settings.json");
  }
  if (picked.label.includes("Project settings.local") && workspaceFolder) {
    return path.join(workspaceFolder.uri.fsPath, ".claude", "settings.local.json");
  }
  return CLAUDE_SETTINGS_JSON;
}

// --- Claude settings management ---
function mergeConfigIntoFile(targetPath: string, silent: boolean): void {
  try {
    const dir = path.dirname(targetPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const cfg = getConfig();

    let existing: Record<string, unknown> = {};
    if (existsSync(targetPath)) {
      existing = JSON.parse(readFileSync(targetPath, "utf-8"));
    }

    let changed = false;

    // Merge hooks
    if (cfg.get<boolean>("contextInjection", true)) {
      const existingHooks = (existing.hooks ?? {}) as Record<string, unknown[]>;
      const existingPromptHooks = (existingHooks.UserPromptSubmit ?? []) as Array<{
        hooks?: Array<{ command?: string }>;
      }>;
      const hasOurHook = existingPromptHooks.some((entry) =>
        entry.hooks?.some((h) => h.command === HOOK_COMMAND),
      );
      if (!hasOurHook) {
        const mergedHooks = { ...existingHooks };
        mergedHooks.UserPromptSubmit = [
          ...existingPromptHooks,
          { matcher: "", hooks: [{ type: "command", command: HOOK_COMMAND }] },
        ];
        existing.hooks = mergedHooks;
        changed = true;
      }
    }

    // Merge statusLine
    if (cfg.get<boolean>("statusLine", true)) {
      const existingStatusLine = existing.statusLine as { command?: string } | undefined;
      if (existingStatusLine?.command !== STATUSLINE_SCRIPT_COMMAND) {
        existing.statusLine = {
          type: "command",
          command: STATUSLINE_SCRIPT_COMMAND,
          refreshInterval: 1,
        };
        changed = true;
      }
    }

    if (changed) {
      writeFileSync(targetPath, JSON.stringify(existing, null, 2));
    }

    // Generate the status line script
    writeStatusLineScript();

    // Clean up old settings.local.json entries from previous versions
    if (targetPath !== CLAUDE_SETTINGS_LOCAL && existsSync(CLAUDE_SETTINGS_LOCAL)) {
      try {
        const local = JSON.parse(readFileSync(CLAUDE_SETTINGS_LOCAL, "utf-8"));
        const { hooks: _h, statusLine: _s, ...rest } = local;
        if (Object.keys(rest).length === 0) {
          unlinkSync(CLAUDE_SETTINGS_LOCAL);
        } else {
          writeFileSync(CLAUDE_SETTINGS_LOCAL, JSON.stringify(rest, null, 2));
        }
      } catch {
        // ignore
      }
    }

    if (!silent) {
      if (changed) {
        vscode.window
          .showInformationMessage(
            `Claude Bridge: ${path.basename(targetPath)} updated. Restart Claude CLI to activate.`,
            "Open file",
          )
          .then((choice) => {
            if (choice) {
              vscode.workspace
                .openTextDocument(targetPath)
                .then((doc) => vscode.window.showTextDocument(doc));
            }
          });
      } else {
        vscode.window.showInformationMessage(
          "Claude Bridge: configuration already up to date.",
        );
      }
    }
  } catch (err) {
    if (!silent) {
      vscode.window.showErrorMessage(`Claude Bridge setup failed: ${err}`);
    }
  }
}

function removeClaudeSettings(): void {
  try {
    for (const settingsPath of [CLAUDE_SETTINGS_JSON, CLAUDE_SETTINGS_LOCAL]) {
      if (!existsSync(settingsPath)) continue;

      const existing = JSON.parse(readFileSync(settingsPath, "utf-8"));
      let changed = false;

      const hooks = (existing.hooks ?? {}) as Record<string, unknown[]>;
      if (hooks.UserPromptSubmit) {
        const filtered = (hooks.UserPromptSubmit as Array<{
          hooks?: Array<{ command?: string }>;
        }>).filter(
          (entry) => !entry.hooks?.some((h) => h.command === HOOK_COMMAND),
        );
        if (filtered.length === 0) {
          delete hooks.UserPromptSubmit;
        } else {
          hooks.UserPromptSubmit = filtered;
        }
        if (Object.keys(hooks).length === 0) {
          delete existing.hooks;
        } else {
          existing.hooks = hooks;
        }
        changed = true;
      }

      const sl = existing.statusLine as { command?: string } | undefined;
      if (
        sl?.command === STATUSLINE_SCRIPT_COMMAND ||
        sl?.command?.includes("claude-vscode-statusline")
      ) {
        delete existing.statusLine;
        changed = true;
      }

      if (changed) {
        writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
      }
    }

    if (existsSync(STATUSLINE_SCRIPT)) {
      unlinkSync(STATUSLINE_SCRIPT);
    }

    vscode.window.showInformationMessage("Claude Bridge: all configuration removed.");
  } catch (err) {
    vscode.window.showErrorMessage(`Claude Bridge: failed to remove config: ${err}`);
  }
}

// --- Preset operations ---
async function applyPreset(presetId: string): Promise<void> {
  const preset = BUILT_IN_PRESETS[presetId];
  if (!preset) return;
  const cfg = getConfig();
  for (const [key, value] of Object.entries(preset.settings)) {
    await cfg.update(key, value, vscode.ConfigurationTarget.Global);
  }
  await cfg.update(
    "statusLineSegments",
    preset.segments,
    vscode.ConfigurationTarget.Global,
  );
  await cfg.update("activePreset", preset.id, vscode.ConfigurationTarget.Global);
}

async function syncActivePreset(): Promise<void> {
  const settings = readSettings();
  const segments = normalizeSegments(getConfig().get("statusLineSegments"));
  const detected = detectActivePreset(presetSettingsFrom(settings), segments);
  if (detected !== settings.activePreset) {
    await getConfig().update(
      "activePreset",
      detected,
      vscode.ConfigurationTarget.Global,
    );
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
    `Claude Bridge: preset exported to ${path.basename(uri.fsPath)}.`,
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
      await cfg.update(key, value, vscode.ConfigurationTarget.Global);
    }
    await cfg.update(
      "statusLineSegments",
      envelope.segments,
      vscode.ConfigurationTarget.Global,
    );
    await cfg.update("activePreset", "custom", vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(
      `Claude Bridge: imported preset${envelope.label ? ` "${envelope.label}"` : ""}.`,
    );
  } catch (err) {
    vscode.window.showErrorMessage(
      `Claude Bridge: import failed — ${(err as Error).message}`,
    );
  }
}

// --- Webview message handling ---
let settingsPanel: ClaudeBridgeSettingsPanel | undefined;
let logChannel: vscode.OutputChannel | undefined;

function log(...parts: unknown[]): void {
  if (!logChannel) return;
  const stamp = new Date().toISOString().split("T")[1]?.slice(0, 12) ?? "";
  const line = parts
    .map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
    .join(" ");
  logChannel.appendLine(`[${stamp}] ${line}`);
}

function broadcastState(): void {
  const state = buildState();
  sidebarProvider?.postState(state);
  settingsPanel?.postState(state);
}

async function handleWebviewMessage(msg: InboundMessage): Promise<void> {
  log("recv", msg);
  const cfg = getConfig();
  try {
    switch (msg.type) {
      case "ready":
        broadcastState();
        return;
      case "setSetting":
        await cfg.update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
        await syncActivePreset();
        return;
      case "setSegments":
        await cfg.update(
          "statusLineSegments",
          normalizeSegments(msg.segments),
          vscode.ConfigurationTarget.Global,
        );
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
      case "runSetup":
        await vscode.commands.executeCommand("claude-bridge.setup");
        return;
      case "removeConfig":
        await vscode.commands.executeCommand("claude-bridge.removeConfig");
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
  // Post state immediately on open (webview also posts "ready" but this avoids flashing).
  settingsPanel.postState(buildState());
}

// --- File operations ---
async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmp = filePath + ".tmp";
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, filePath);
}

async function cleanupFiles(): Promise<void> {
  lastSelectionKey = "";
  await Promise.allSettled(
    BRIDGE_FILES.flatMap((f) => [
      fs.unlink(f).catch(() => {}),
      fs.unlink(f + ".tmp").catch(() => {}),
    ]),
  );
  updateStatusBarItem(null);
  currentSelection = null;
  broadcastState();
}

function cleanupFilesSync(): void {
  lastSelectionKey = "";
  for (const f of BRIDGE_FILES) {
    try {
      if (existsSync(f)) unlinkSync(f);
    } catch {
      // ignore
    }
    try {
      if (existsSync(f + ".tmp")) unlinkSync(f + ".tmp");
    } catch {
      // ignore
    }
  }
}

// --- VS Code status bar item ---
function updateStatusBarItem(info: { path: string; lines: string } | null): void {
  if (!statusBarItem) return;
  if (info) {
    statusBarItem.text = `$(symbol-reference) ${info.path} ${info.lines}`;
    statusBarItem.tooltip = "Claude Bridge: click to preview what Claude CLI sees";
    statusBarItem.show();
  } else {
    statusBarItem.hide();
  }
}

// --- Context building ---
function truncatePath(relativePath: string, maxLen: number): string {
  if (relativePath.length <= maxLen) return relativePath;
  const fileName = path.basename(relativePath);
  const available = maxLen - fileName.length - 3;
  return available > 0
    ? relativePath.slice(0, available) + "..." + fileName
    : "..." + fileName;
}

function buildContext(
  relativePath: string,
  startLine: number,
  endLine: number,
  lineCount: number,
  text: string,
  fullLine: string | null,
  startChar: number,
  endChar: number,
): string {
  const cfg = getConfig();
  const prefix = cfg.get<string>("contextPrefix", "[VS Code Selection]");
  const showPartial = cfg.get<boolean>("showPartialLineContext", true);

  if (fullLine !== null && showPartial) {
    const marker = " ".repeat(startChar) + "^".repeat(endChar - startChar);
    return (
      `${prefix} ${relativePath}#L${startLine} (partial)\n` +
      `\`\`\`\n${fullLine}\n${marker}\n\`\`\`\n` +
      `Selected text: "${text}"`
    );
  }
  return (
    `${prefix} ${relativePath}:${startLine}-${endLine} (${lineCount} lines)\n` +
    `\`\`\`\n${text}\n\`\`\``
  );
}

function formatPath(relativePath: string, style: string, maxLen: number): string {
  switch (style) {
    case "basename":
      return path.basename(relativePath);
    case "full":
      return relativePath;
    case "truncated":
    default:
      return truncatePath(relativePath, maxLen);
  }
}

function buildSelectionStatusLine(
  relativePath: string,
  absolutePath: string,
  startLine: number,
  endLine: number,
  lineCount: number,
  isPartial: boolean,
): string {
  const cfg = getConfig();
  const maxPath = cfg.get<number>("statusLineMaxPath", 30);
  const pathStyle = cfg.get<string>("statusLinePathStyle", "basename");
  const prefix = cfg.get<string>("contextPrefix", "[VS Code Selection]").trim();

  const DIM = "\x1b[2m";
  const CYAN = "\x1b[36m";
  const BOLD = "\x1b[1m";
  const RESET = "\x1b[0m";

  const displayPath = formatPath(relativePath, pathStyle, maxPath);
  const lineRef = isPartial ? `#L${startLine}` : `#${startLine}-${endLine}`;
  const countLabel = isPartial ? "(selection)" : `(${lineCount} lines)`;

  const uri = `vscode://file${absolutePath}:${startLine}:1`;
  const linkText = `${displayPath}${lineRef}`;
  const link = `\x1b]8;;${uri}\x07${linkText}\x1b]8;;\x07`;

  const prefixed = prefix ? `${prefix} ` : "";
  return `${DIM}${prefixed}${RESET}${CYAN}${BOLD}${link}${RESET} ${DIM}${countLabel}${RESET}`;
}

// --- Preview ---
function previewSelection(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    vscode.window.showInformationMessage("Claude Bridge: no code selected.");
    return;
  }

  const selection = editor.selection;
  const text = editor.document.getText(selection);
  if (text.trim().length === 0) {
    vscode.window.showInformationMessage("Claude Bridge: selection is empty.");
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  const absolutePath = editor.document.uri.fsPath;
  const relativePath = workspaceFolder
    ? path.relative(workspaceFolder.uri.fsPath, absolutePath)
    : path.basename(absolutePath);

  const startLine = selection.start.line + 1;
  const endLine = selection.end.line + 1;
  const lineCount = endLine - startLine + 1;
  const isSingleLine = selection.start.line === selection.end.line;
  const fullLineText = isSingleLine
    ? editor.document.lineAt(selection.start.line).text
    : null;
  const isPartial =
    isSingleLine && fullLineText !== null && text !== fullLineText.trim();

  const context = buildContext(
    relativePath,
    startLine,
    endLine,
    lineCount,
    text,
    isPartial ? fullLineText : null,
    selection.start.character,
    selection.end.character,
  );

  const maxPath = getConfig().get<number>("statusLineMaxPath", 30);
  const pathStyle = getConfig().get<string>("statusLinePathStyle", "basename");
  const displayPath = formatPath(relativePath, pathStyle, maxPath);
  const lineRef = isPartial ? `#L${startLine}` : `#${startLine}-${endLine}`;

  const panel = vscode.window.createOutputChannel("Claude Bridge Preview");
  panel.clear();
  panel.appendLine("=== What Claude CLI will see (context injection) ===");
  panel.appendLine("");
  panel.appendLine(context);
  panel.appendLine("");
  panel.appendLine("=== Status line segment (VS Code selection) ===");
  panel.appendLine(
    `@${displayPath}${lineRef} ${isPartial ? "(selection)" : `(${lineCount} lines)`}`,
  );
  panel.appendLine("");
  panel.appendLine("=== Active status line segments (in order) ===");
  const segments = normalizeSegments(getConfig().get("statusLineSegments"));
  for (const s of segments) {
    panel.appendLine(`  ${s.enabled ? "[x]" : "[ ]"} ${s.id}`);
  }
  panel.show();
}

// --- Selection writer ---
function writeSelection(editor: vscode.TextEditor | undefined): void {
  const cfg = getConfig();

  if (!cfg.get<boolean>("enabled", true)) {
    cleanupFiles();
    return;
  }

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  const debounceMs = cfg.get<number>("debounceMs", 30);

  debounceTimer = setTimeout(async () => {
    try {
      if (!editor || editor.selection.isEmpty) {
        await cleanupFiles();
        return;
      }

      const selection = editor.selection;
      let text = editor.document.getText(selection);

      if (text.trim().length === 0) {
        await cleanupFiles();
        return;
      }

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      const absolutePath = editor.document.uri.fsPath;
      const relativePath = workspaceFolder
        ? path.relative(workspaceFolder.uri.fsPath, absolutePath)
        : path.basename(absolutePath);

      const startLine = selection.start.line + 1;
      const endLine = selection.end.line + 1;
      let lineCount = endLine - startLine + 1;

      const maxLines = cfg.get<number>("maxLines", 500);
      if (lineCount > maxLines) {
        const lines = text.split("\n");
        text =
          lines.slice(0, maxLines).join("\n") +
          `\n... (truncated, ${lineCount - maxLines} more lines)`;
        lineCount = maxLines;
      }

      const key = `${absolutePath}:${selection.start.line}:${selection.start.character}-${selection.end.line}:${selection.end.character}`;
      if (key === lastSelectionKey) return;
      lastSelectionKey = key;

      const isSingleLine = selection.start.line === selection.end.line;
      const fullLineText = isSingleLine
        ? editor.document.lineAt(selection.start.line).text
        : null;
      const isPartial =
        isSingleLine && fullLineText !== null && text !== fullLineText.trim();

      const writes: Promise<void>[] = [];

      writes.push(
        atomicWrite(
          SELECTION_FILE,
          JSON.stringify({
            file: absolutePath,
            relativePath,
            startLine,
            endLine,
            lineCount,
            text,
            isPartial,
            fullLine: fullLineText,
            startChar: selection.start.character,
            endChar: selection.end.character,
            timestamp: Date.now(),
          }),
        ),
      );

      if (cfg.get<boolean>("contextInjection", true)) {
        const contextStr = buildContext(
          relativePath,
          startLine,
          endLine,
          lineCount,
          text,
          isPartial ? fullLineText : null,
          selection.start.character,
          selection.end.character,
        );
        writes.push(
          atomicWrite(
            CONTEXT_FILE,
            JSON.stringify({
              hookSpecificOutput: {
                hookEventName: "UserPromptSubmit",
                additionalContext: contextStr,
              },
            }),
          ),
        );
      }

      if (cfg.get<boolean>("statusLine", true)) {
        writes.push(
          atomicWrite(
            STATUSLINE_FILE,
            buildSelectionStatusLine(
              relativePath,
              absolutePath,
              startLine,
              endLine,
              lineCount,
              isPartial,
            ),
          ),
        );
      }

      await Promise.all(writes);

      const maxPath = cfg.get<number>("statusLineMaxPath", 30);
      const pathStyle = cfg.get<string>("statusLinePathStyle", "basename");
      const displayPath = formatPath(relativePath, pathStyle, maxPath);
      const lineRef = isPartial ? `#L${startLine}` : `#${startLine}-${endLine}`;
      updateStatusBarItem({ path: displayPath, lines: lineRef });

      currentSelection = {
        relativePath,
        startLine,
        endLine,
        lineCount,
        isPartial,
      };
      broadcastState();
    } catch {
      // Silently fail
    }
  }, debounceMs);
}

// --- Activation ---
export function activate(context: vscode.ExtensionContext): void {
  extensionPath = context.extensionPath;
  extensionVersion = (context.extension.packageJSON as { version?: string }).version ?? "0.0.0";

  // Diagnostic log channel — open via "Output: Show Output Channel..." → "Claude Bridge"
  logChannel = vscode.window.createOutputChannel("Claude Bridge");
  context.subscriptions.push(logChannel);
  log("activate v" + extensionVersion);

  // VS Code status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBarItem.command = "claude-bridge.preview";
  context.subscriptions.push(statusBarItem);

  // Sidebar webview view
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

  // Auto-setup
  const cfg = getConfig();
  if (cfg.get<boolean>("autoSetup", true)) {
    const targetPath = getSettingsTargetPath(cfg);
    mergeConfigIntoFile(targetPath, true);
  }

  // One-time v2 notice
  if (!context.globalState.get<boolean>(V2_NOTICE_KEY)) {
    void context.globalState.update(V2_NOTICE_KEY, true);
    vscode.window
      .showInformationMessage(
        "Claude Bridge 2.0: new settings UI + reorderable status line segments. Your previous segment preferences were reset.",
        "Open settings",
        "Dismiss",
      )
      .then((choice) => {
        if (choice === "Open settings") {
          void vscode.commands.executeCommand("claude-bridge.openSettings");
        }
      });
  }

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("claude-bridge.clearSelection", () => {
      void cleanupFiles();
      vscode.window.showInformationMessage("Claude Bridge: selection cleared.");
    }),
    vscode.commands.registerCommand("claude-bridge.setup", async () => {
      const targetPath = await resolveSettingsTarget();
      mergeConfigIntoFile(targetPath, false);
    }),
    vscode.commands.registerCommand("claude-bridge.preview", () => {
      previewSelection();
    }),
    vscode.commands.registerCommand("claude-bridge.removeConfig", () => {
      removeClaudeSettings();
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
  );

  // Selection listeners
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((event) => {
      writeSelection(event.textEditor);
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      writeSelection(editor);
    }),
  );

  // React to config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("claudeBridge")) return;
      writeStatusLineScript();
      const newCfg = getConfig();
      if (!newCfg.get<boolean>("enabled", true)) {
        void cleanupFiles();
      }
      broadcastState();
    }),
  );

  // Cleanup
  context.subscriptions.push({
    dispose: () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      cleanupFilesSync();
    },
  });
}

export function deactivate(): void {
  cleanupFilesSync();
}
