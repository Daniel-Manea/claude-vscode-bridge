import * as vscode from "vscode";
import * as fs from "fs/promises";
import { existsSync, unlinkSync, readFileSync, mkdirSync, writeFileSync, chmodSync } from "fs";
import * as path from "path";
import * as os from "os";

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

// --- Types ---
interface StatusLineSegments {
  model: boolean;
  gitBranch: boolean;
  contextBar: boolean;
  contextPercentage: boolean;
  cost: boolean;
  linesChanged: boolean;
  rateLimits: boolean;
  sessionDuration: boolean;
  selection: boolean;
}

const DEFAULT_SEGMENTS: StatusLineSegments = {
  model: true,
  gitBranch: true,
  contextBar: true,
  contextPercentage: true,
  cost: false,
  linesChanged: false,
  rateLimits: false,
  sessionDuration: false,
  selection: true,
};

// --- State ---
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let lastSelectionKey = "";
let statusBarItem: vscode.StatusBarItem;

// --- Config helper ---
function getConfig() {
  return vscode.workspace.getConfiguration("claudeBridge");
}

// --- Status line script generator ---
function generateStatusLineScript(extensionPath: string): string {
  const cfg = getConfig();
  const segments = { ...DEFAULT_SEGMENTS, ...cfg.get<Partial<StatusLineSegments>>("statusLineSegments", DEFAULT_SEGMENTS) };

  // Read the template shipped with the extension
  const templatePath = path.join(extensionPath, "media", "statusline-template.sh");
  let script = readFileSync(templatePath, "utf-8");

  // Comment out disabled segments
  for (const [key, enabled] of Object.entries(segments)) {
    const beginTag = `#SEGMENT:${key}:BEGIN`;
    const endTag = `#SEGMENT:${key}:END`;
    const beginIdx = script.indexOf(beginTag);
    const endIdx = script.indexOf(endTag);

    if (beginIdx === -1 || endIdx === -1) continue;

    if (!enabled) {
      // Comment out the entire segment block
      const before = script.substring(0, beginIdx);
      const block = script.substring(beginIdx, endIdx + endTag.length);
      const after = script.substring(endIdx + endTag.length);
      const commented = block.split("\n").map((line) =>
        line.startsWith("#") ? line : `#${line}`
      ).join("\n");
      script = before + commented + after;
    }
  }

  // Handle contextPercentage toggle within contextBar
  if (segments.contextBar && !segments.contextPercentage) {
    // Swap: comment out YES block, uncomment NO block
    script = script.replace(
      /#SEGMENT:contextPercentage:YES\n(.*)\n#SEGMENT:contextPercentage:NO\n#(.*)\n#SEGMENT:contextPercentage:ENDALT/,
      "#SEGMENT:contextPercentage:YES\n#$1\n#SEGMENT:contextPercentage:NO\n$2\n#SEGMENT:contextPercentage:ENDALT"
    );
  }

  return script;
}

let extensionPath = "";

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
      const existingPromptHooks = (existingHooks.UserPromptSubmit ?? []) as Array<{hooks?: Array<{command?: string}>}>;
      const hasOurHook = existingPromptHooks.some(
        (entry) => entry.hooks?.some((h) => h.command === HOOK_COMMAND)
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
      const existingStatusLine = existing.statusLine as {command?: string} | undefined;
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
      } catch {}
    }

    if (!silent) {
      if (changed) {
        vscode.window
          .showInformationMessage(
            `Claude Bridge: ${path.basename(targetPath)} updated. Restart Claude CLI to activate.`,
            "Open file"
          )
          .then((choice) => {
            if (choice) {
              vscode.workspace.openTextDocument(targetPath).then((doc) =>
                vscode.window.showTextDocument(doc)
              );
            }
          });
      } else {
        vscode.window.showInformationMessage("Claude Bridge: configuration already up to date.");
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

      // Remove our hook
      const hooks = (existing.hooks ?? {}) as Record<string, unknown[]>;
      if (hooks.UserPromptSubmit) {
        const filtered = (hooks.UserPromptSubmit as Array<{hooks?: Array<{command?: string}>}>)
          .filter((entry) => !entry.hooks?.some((h) => h.command === HOOK_COMMAND));
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

      // Remove our statusLine
      const sl = existing.statusLine as {command?: string} | undefined;
      if (sl?.command === STATUSLINE_SCRIPT_COMMAND || sl?.command?.includes("claude-vscode-statusline")) {
        delete existing.statusLine;
        changed = true;
      }

      if (changed) {
        writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
      }
    }

    // Remove the script
    if (existsSync(STATUSLINE_SCRIPT)) {
      unlinkSync(STATUSLINE_SCRIPT);
    }

    vscode.window.showInformationMessage("Claude Bridge: all configuration removed.");
  } catch (err) {
    vscode.window.showErrorMessage(`Claude Bridge: failed to remove config: ${err}`);
  }
}

// --- Sidebar tree views ---

const SEGMENT_LABELS: Record<string, string> = {
  model: "Model name",
  gitBranch: "Git branch",
  contextBar: "Context progress bar",
  contextPercentage: "Context percentage",
  cost: "Session cost",
  linesChanged: "Lines changed",
  rateLimits: "Rate limits (5h/7d)",
  sessionDuration: "Session duration",
  selection: "VS Code selection",
};

class StatusTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  refresh(): void { this._onDidChange.fire(); }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

  getChildren(): vscode.TreeItem[] {
    const cfg = getConfig();
    const enabled = cfg.get<boolean>("enabled", true);
    const contextOn = cfg.get<boolean>("contextInjection", true);
    const statusOn = cfg.get<boolean>("statusLine", true);

    const items: vscode.TreeItem[] = [];

    const bridgeItem = new vscode.TreeItem(
      `Bridge: ${enabled ? "Active" : "Disabled"}`,
    );
    bridgeItem.iconPath = new vscode.ThemeIcon(enabled ? "pass-filled" : "circle-slash");
    bridgeItem.description = enabled ? "selecting code sends it to Claude" : "paused";
    items.push(bridgeItem);

    const contextItem = new vscode.TreeItem(
      `Context Injection: ${contextOn ? "On" : "Off"}`,
    );
    contextItem.iconPath = new vscode.ThemeIcon(contextOn ? "check" : "x");
    items.push(contextItem);

    const statusItem = new vscode.TreeItem(
      `Status Line: ${statusOn ? "On" : "Off"}`,
    );
    statusItem.iconPath = new vscode.ThemeIcon(statusOn ? "check" : "x");
    items.push(statusItem);

    // Current selection info
    if (existsSync(SELECTION_FILE)) {
      try {
        const data = JSON.parse(readFileSync(SELECTION_FILE, "utf-8"));
        const selItem = new vscode.TreeItem(
          `${data.relativePath}:${data.startLine}-${data.endLine}`,
        );
        selItem.iconPath = new vscode.ThemeIcon("symbol-reference");
        selItem.description = `${data.lineCount} lines`;
        items.push(selItem);
      } catch {}
    }

    const target = cfg.get<string>("settingsTarget", "user");
    const targetItem = new vscode.TreeItem(`Target: ${target}`);
    targetItem.iconPath = new vscode.ThemeIcon("gear");
    targetItem.description = target === "user" ? "~/.claude/settings.json" : `.claude/settings.json`;
    items.push(targetItem);

    return items;
  }
}

class SegmentsTreeProvider implements vscode.TreeDataProvider<string> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  refresh(): void { this._onDidChange.fire(); }

  getTreeItem(segmentKey: string): vscode.TreeItem {
    const cfg = getConfig();
    const segments = { ...DEFAULT_SEGMENTS, ...cfg.get<Partial<StatusLineSegments>>("statusLineSegments", DEFAULT_SEGMENTS) };
    const enabled = segments[segmentKey as keyof StatusLineSegments] ?? false;
    const label = SEGMENT_LABELS[segmentKey] || segmentKey;

    const item = new vscode.TreeItem(label);
    item.iconPath = new vscode.ThemeIcon(enabled ? "pass-filled" : "circle-large-outline");
    item.description = enabled ? "visible" : "hidden";
    item.command = {
      command: "claude-bridge.toggleSegment",
      title: "Toggle",
      arguments: [segmentKey],
    };
    return item;
  }

  getChildren(): string[] {
    return Object.keys(SEGMENT_LABELS);
  }
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
    ])
  );
  updateStatusBarItem(null);
}

function cleanupFilesSync(): void {
  lastSelectionKey = "";
  for (const f of BRIDGE_FILES) {
    try { if (existsSync(f)) unlinkSync(f); } catch {}
    try { if (existsSync(f + ".tmp")) unlinkSync(f + ".tmp"); } catch {}
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
  endChar: number
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

function buildSelectionStatusLine(
  relativePath: string,
  absolutePath: string,
  startLine: number,
  endLine: number,
  lineCount: number,
  isPartial: boolean
): string {
  const cfg = getConfig();
  const maxPath = cfg.get<number>("statusLineMaxPath", 30);

  const DIM = "\x1b[2m";
  const CYAN = "\x1b[36m";
  const BOLD = "\x1b[1m";
  const RESET = "\x1b[0m";

  const displayPath = truncatePath(relativePath, maxPath);
  const lineRef = isPartial ? `#L${startLine}` : `#${startLine}-${endLine}`;
  const countLabel = isPartial ? "(selection)" : `(${lineCount} lines)`;

  const uri = `vscode://file${absolutePath}:${startLine}:1`;
  const linkText = `@${displayPath}${lineRef}`;
  const link = `\x1b]8;;${uri}\x07${linkText}\x1b]8;;\x07`;

  return `${CYAN}${BOLD}${link}${RESET} ${DIM}${countLabel}${RESET}`;
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
  const fullLineText = isSingleLine ? editor.document.lineAt(selection.start.line).text : null;
  const isPartial = isSingleLine && fullLineText !== null && text !== fullLineText.trim();

  const context = buildContext(
    relativePath, startLine, endLine, lineCount,
    text, isPartial ? fullLineText : null,
    selection.start.character, selection.end.character
  );

  const maxPath = getConfig().get<number>("statusLineMaxPath", 30);
  const displayPath = truncatePath(relativePath, maxPath);
  const lineRef = isPartial ? `#L${startLine}` : `#${startLine}-${endLine}`;

  const panel = vscode.window.createOutputChannel("Claude Bridge Preview");
  panel.clear();
  panel.appendLine("=== What Claude CLI will see (context injection) ===");
  panel.appendLine("");
  panel.appendLine(context);
  panel.appendLine("");
  panel.appendLine("=== Status line segment (VS Code selection) ===");
  panel.appendLine(`@${displayPath}${lineRef} ${isPartial ? "(selection)" : `(${lineCount} lines)`}`);
  panel.appendLine("");
  panel.appendLine("=== Active status line segments ===");
  const segments = { ...DEFAULT_SEGMENTS, ...getConfig().get<Partial<StatusLineSegments>>("statusLineSegments", DEFAULT_SEGMENTS) };
  for (const [key, enabled] of Object.entries(segments)) {
    panel.appendLine(`  ${enabled ? "[x]" : "[ ]"} ${key}`);
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

      // Enforce max lines
      const maxLines = cfg.get<number>("maxLines", 500);
      if (lineCount > maxLines) {
        const lines = text.split("\n");
        text = lines.slice(0, maxLines).join("\n") + `\n... (truncated, ${lineCount - maxLines} more lines)`;
        lineCount = maxLines;
      }

      // Deduplicate
      const key = `${absolutePath}:${selection.start.line}:${selection.start.character}-${selection.end.line}:${selection.end.character}`;
      if (key === lastSelectionKey) return;
      lastSelectionKey = key;

      // Detect partial single-line selection
      const isSingleLine = selection.start.line === selection.end.line;
      const fullLineText = isSingleLine ? editor.document.lineAt(selection.start.line).text : null;
      const isPartial = isSingleLine && fullLineText !== null && text !== fullLineText.trim();

      const writes: Promise<void>[] = [];

      // Raw selection data
      writes.push(atomicWrite(SELECTION_FILE, JSON.stringify({
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
      })));

      // Context file
      if (cfg.get<boolean>("contextInjection", true)) {
        const contextStr = buildContext(
          relativePath, startLine, endLine, lineCount,
          text, isPartial ? fullLineText : null,
          selection.start.character, selection.end.character
        );
        writes.push(atomicWrite(CONTEXT_FILE, JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext: contextStr,
          },
        })));
      }

      // Status line selection segment
      if (cfg.get<boolean>("statusLine", true)) {
        writes.push(atomicWrite(STATUSLINE_FILE, buildSelectionStatusLine(
          relativePath, absolutePath, startLine, endLine, lineCount, isPartial
        )));
      }

      await Promise.all(writes);

      // Update VS Code status bar
      const maxPath = cfg.get<number>("statusLineMaxPath", 30);
      const displayPath = truncatePath(relativePath, maxPath);
      const lineRef = isPartial ? `#L${startLine}` : `#${startLine}-${endLine}`;
      updateStatusBarItem({ path: displayPath, lines: lineRef });
    } catch {
      // Silently fail
    }
  }, debounceMs);
}

// --- Activation ---
export function activate(context: vscode.ExtensionContext): void {
  extensionPath = context.extensionPath;

  // VS Code status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBarItem.command = "claude-bridge.preview";
  context.subscriptions.push(statusBarItem);

  // Sidebar tree views
  const statusTree = new StatusTreeProvider();
  const segmentsTree = new SegmentsTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("claude-bridge.status", statusTree),
    vscode.window.registerTreeDataProvider("claude-bridge.segments", segmentsTree),
  );

  // Auto-setup
  const cfg = getConfig();
  if (cfg.get<boolean>("autoSetup", true)) {
    const targetPath = getSettingsTargetPath(cfg);
    mergeConfigIntoFile(targetPath, true);
  }

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("claude-bridge.clearSelection", () => {
      cleanupFiles();
      statusTree.refresh();
      vscode.window.showInformationMessage("Claude Bridge: selection cleared.");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("claude-bridge.setup", async () => {
      const targetPath = await resolveSettingsTarget();
      mergeConfigIntoFile(targetPath, false);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("claude-bridge.preview", () => {
      previewSelection();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("claude-bridge.removeConfig", () => {
      removeClaudeSettings();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("claude-bridge.toggleSegment", async (segmentKey?: string) => {
      if (!segmentKey) return;
      const cfg = getConfig();
      const segments = { ...DEFAULT_SEGMENTS, ...cfg.get<Partial<StatusLineSegments>>("statusLineSegments", DEFAULT_SEGMENTS) };
      segments[segmentKey as keyof StatusLineSegments] = !segments[segmentKey as keyof StatusLineSegments];
      await cfg.update("statusLineSegments", segments, vscode.ConfigurationTarget.Global);
      segmentsTree.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("claude-bridge.openSettings", () => {
      vscode.commands.executeCommand("workbench.action.openSettings", "claudeBridge");
    })
  );

  // Selection listeners
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((event) => {
      writeSelection(event.textEditor);
      statusTree.refresh();
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      writeSelection(editor);
      statusTree.refresh();
    })
  );

  // Regenerate script when settings change
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("claudeBridge")) {
        writeStatusLineScript();
        const newCfg = getConfig();
        if (!newCfg.get<boolean>("enabled", true)) {
          cleanupFiles();
        }
      }
    })
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
