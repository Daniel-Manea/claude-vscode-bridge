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
  getRecentSelections,
  getSessionStats,
  initSelectionWriter,
  previewSelection,
  refreshStatusBar,
  reinjectRecent,
  resetSelectionDedupe,
  syncPinsOnlyContext,
  writeSelection,
} from "./selectionWriter";
import {
  addPin,
  clearPins,
  getPins,
  isPinned,
  loadPins,
  onPinsChanged,
  removePin,
} from "./pinnedContext";
import {
  clearClaudeEdits,
  disposeFileOpener,
  forgetClaudeEdit,
  getClaudeEdits,
  initFileOpener,
  onClaudeEditsChanged,
  restoreClaudeEdits,
  setAutoOpenEnabled,
  verifyAutoOpenSetup,
  type ClaudeEdit,
} from "./fileOpener";
import { writeStatusLineScript } from "./statusLineScript";
import {
  ClaudeBridgeActionsProvider,
  ClaudeEditsLensProvider,
  TestFailureLensProvider,
} from "./codeLens";

const SETUP_COMPLETED_KEY = "claudeBridge.setupCompleted";
const CLAUDE_EDITS_KEY = "claudeBridge.claudeEdits";

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
    recentCount: getRecentSelections().length,
    editsCount: getClaudeEdits().length,
    pinsCount: getPins().length,
    selectionsWritten: getSessionStats().selectionsWritten,
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

// --- Pinned selections ---

async function pinCurrentSelection(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage("Claude Bridge: no active editor.");
    return;
  }
  if (editor.document.uri.scheme !== "file") {
    vscode.window.showInformationMessage("Claude Bridge: only file-backed editors can be pinned.");
    return;
  }
  if (editor.selection.isEmpty) {
    vscode.window.showInformationMessage("Claude Bridge: select something to pin first.");
    return;
  }
  const startLine = editor.selection.start.line + 1;
  const endLine = editor.selection.end.line + 1;
  const existing = isPinned(editor.document.uri.fsPath, startLine, endLine);
  if (existing) {
    removePin(existing.id);
    vscode.window.showInformationMessage(
      `Claude Bridge: unpinned ${path.basename(editor.document.uri.fsPath)} L${startLine}-${endLine}.`,
    );
    return;
  }
  const text = editor.document.getText(editor.selection);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  const absolutePath = editor.document.uri.fsPath;
  const relativePath = workspaceFolder
    ? path.relative(workspaceFolder.uri.fsPath, absolutePath)
    : path.basename(absolutePath);
  const isSingleLine = editor.selection.start.line === editor.selection.end.line;
  const fullLine = isSingleLine ? editor.document.lineAt(editor.selection.start.line).text : null;
  const isPartial = isSingleLine && fullLine !== null && text !== fullLine.trim();

  // Optional one-line note so the pinned block is self-describing.
  const note = await vscode.window.showInputBox({
    prompt: `Pin ${relativePath}:${startLine}-${endLine}`,
    placeHolder: "Optional note (e.g. 'current schema' or 'the buggy util')",
    value: "",
  });
  if (note === undefined) return; // user cancelled

  addPin({
    absolutePath,
    relativePath,
    startLine,
    endLine,
    lineCount: endLine - startLine + 1,
    isPartial,
    text,
    fullLine,
    startChar: editor.selection.start.character,
    endChar: editor.selection.end.character,
    note: note.trim(),
  });
  vscode.window.showInformationMessage(
    `Claude Bridge: pinned ${relativePath} L${startLine}-${endLine}. ${getPins().length} pin${getPins().length === 1 ? "" : "s"} total.`,
  );
}

async function unpinCurrentSelection(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const startLine = editor.selection.start.line + 1;
  const endLine = editor.selection.end.line + 1;
  const existing = isPinned(editor.document.uri.fsPath, startLine, endLine);
  if (!existing) {
    vscode.window.showInformationMessage("Claude Bridge: this exact range isn't pinned.");
    return;
  }
  removePin(existing.id);
  vscode.window.showInformationMessage(
    `Claude Bridge: unpinned ${path.basename(editor.document.uri.fsPath)} L${startLine}-${endLine}.`,
  );
}

// --- Ask Claude about a test failure ---

async function askClaudeAboutFailure(
  absPath: string,
  line: number,
  character: number,
  message: string,
  source: string,
): Promise<void> {
  // Open the file, jump to the failure, and write a framed context block
  // combining (pinned) + (surrounding function) + (failure diagnostic).
  try {
    const uri = vscode.Uri.file(absPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);

    // Find the enclosing symbol so Claude sees context, not just the line.
    const symbols = (await vscode.commands.executeCommand(
      "vscode.executeDocumentSymbolProvider",
      uri,
    )) as vscode.DocumentSymbol[] | undefined;
    const pos = new vscode.Position(line, character);
    const symbol = symbols ? findSmallestSymbolAt(symbols, pos) : null;
    const range = symbol?.range ?? new vscode.Range(
      new vscode.Position(Math.max(0, line - 3), 0),
      new vscode.Position(Math.min(doc.lineCount - 1, line + 3), 0),
    );
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

    // Frame the message explicitly so Claude's first response can focus on
    // the failure without re-asking the user "what happened?".
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    const relativePath = workspaceFolder
      ? path.relative(workspaceFolder.uri.fsPath, absPath)
      : path.basename(absPath);
    const framed =
      `=== Failing test ===\n` +
      `${relativePath}:${line + 1}${source ? ` (${source})` : ""}\n\n` +
      `Failure message:\n${message}\n`;

    // Append the framed message to whatever the regular selection-writer
    // is about to write. Simplest: write a temporary context file. We rely
    // on the normal writeSelection flow (triggered by editor.selection =)
    // to produce the base context. Then we overwrite with framed + base.
    // Since writeSelection is debounced, flip the dedup key to force a
    // rewrite, then append the failure section.
    // For reliability, just write the framed block on top of whatever the
    // selection writer produces on its own tick.
    const { CONTEXT_FILE } = await import("./paths");
    const fs = await import("fs/promises");
    await new Promise((r) => setTimeout(r, 80)); // let writeSelection land
    let existing = "";
    try {
      const raw = await fs.readFile(CONTEXT_FILE, "utf-8");
      const parsed = JSON.parse(raw) as { hookSpecificOutput?: { additionalContext?: string } };
      existing = parsed.hookSpecificOutput?.additionalContext ?? "";
    } catch {
      /* no base; use framed alone */
    }
    const combined = existing ? framed + "\n" + existing : framed;
    await fs.writeFile(
      CONTEXT_FILE,
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: combined,
        },
      }),
    );
    const { CONTEXT_SENT_FILE } = await import("./paths");
    await fs.unlink(CONTEXT_SENT_FILE).catch(() => {});

    vscode.window.showInformationMessage(
      `Claude Bridge: failure context ready. Ask "why does this fail?" in your Claude terminal.`,
    );
  } catch (err) {
    vscode.window.showErrorMessage(
      `Claude Bridge: couldn't prep failure context — ${(err as Error).message}`,
    );
  }
}

// --- Command Center (unified quickpick) ---

interface CommandEntry {
  label: string;
  description?: string;
  detail?: string;
  command: string;
  kbd?: string;
}

async function openCommandCenter(): Promise<void> {
  const isMac = process.platform === "darwin";
  const kSym = isMac ? "\u2318\u21E7I" : "Ctrl+\u21E7I";
  const kPin = isMac ? "\u2318\u21E7\u2325P" : "Ctrl+\u21E7Alt+P";
  const kDiff = isMac ? "\u2318\u21E7\u2325G" : "Ctrl+\u21E7Alt+G";
  const kCenter = isMac ? "\u2318\u21E7\u2325C" : "Ctrl+\u21E7Alt+C";

  const hasSelection = !!getCurrentSelection();
  const pins = getPins();
  const recent = getRecentSelections();
  const edits = getClaudeEdits();

  const entries: CommandEntry[] = [];

  entries.push({
    label: "$(zap) Inject current symbol",
    description: kSym,
    detail: "Wrap the enclosing function / class at the cursor and send it.",
    command: "claude-bridge.injectCurrentSymbol",
    kbd: kSym,
  });

  if (hasSelection) {
    const sel = getCurrentSelection()!;
    const alreadyPinned = !!pins.find((p) =>
      p.relativePath === sel.relativePath &&
      p.startLine === sel.startLine &&
      p.endLine === sel.endLine,
    );
    entries.push({
      label: alreadyPinned ? "$(pin) Unpin current selection" : "$(pin) Pin current selection",
      description: kPin,
      detail: alreadyPinned
        ? `Remove the pin on ${sel.relativePath}:${sel.startLine}-${sel.endLine}.`
        : `Keep ${sel.relativePath}:${sel.startLine}-${sel.endLine} in every prompt.`,
      command: alreadyPinned
        ? "claude-bridge.unpinSelection"
        : "claude-bridge.pinSelection",
      kbd: kPin,
    });
  }

  entries.push({
    label: "$(git-compare) Send git diff to Claude",
    description: kDiff,
    detail: "Working tree, staged, or PR diff — pick after you run it.",
    command: "claude-bridge.sendGitDiff",
    kbd: kDiff,
  });

  entries.push({
    label: `$(pin) Pinned selections`,
    description: pins.length ? `${pins.length} pinned` : "none",
    detail: pins.length
      ? "Open, note, or unpin individual entries."
      : "No pins yet. Pin a selection first.",
    command: "claude-bridge.showPins",
  });

  entries.push({
    label: "$(history) Recent selections",
    description: recent.length ? `${recent.length} recent` : "none",
    detail: recent.length
      ? "Re-inject a selection you already used this session."
      : "No recent selections yet.",
    command: "claude-bridge.recentSelections",
  });

  entries.push({
    label: "$(edit) Claude's edits this session",
    description: edits.length ? `${edits.length} files` : "none",
    detail: edits.length
      ? "Diff vs. HEAD or revert any file Claude has modified."
      : "Claude hasn't edited any files yet.",
    command: "claude-bridge.showClaudeEdits",
  });

  entries.push({ label: "", description: "", detail: "", command: "__separator" } as CommandEntry);

  if (hasSelection) {
    entries.push({
      label: "$(preview) Preview what Claude will see",
      description: "",
      detail: "Opens the Claude Bridge: Preview output channel.",
      command: "claude-bridge.preview",
    });
    entries.push({
      label: "$(clear-all) Clear current selection",
      description: "",
      detail: "Deletes the bridge files. Claude stops seeing this selection.",
      command: "claude-bridge.clearSelection",
    });
  }

  entries.push({
    label: "$(dashboard) Open dashboard",
    description: "",
    detail: "Toggles, preset, segments, session actions.",
    command: "claude-bridge.openDashboard",
  });
  entries.push({
    label: "$(settings-gear) Open full settings",
    description: "",
    detail: "Deep configuration — path style, bar glyphs, excluded patterns.",
    command: "claude-bridge.openSettings",
  });

  type QpItem = vscode.QuickPickItem & { command?: string };
  const qp = vscode.window.createQuickPick<QpItem>();
  qp.title = `Claude Bridge · quick actions   (${kCenter} to reopen)`;
  qp.placeholder = "Type to filter · Enter to run";
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;
  qp.items = entries.map<QpItem>((e) =>
    e.command === "__separator"
      ? { label: "", kind: vscode.QuickPickItemKind.Separator }
      : { label: e.label, description: e.description, detail: e.detail, command: e.command },
  );
  qp.onDidAccept(async () => {
    const sel = qp.selectedItems[0];
    if (!sel || !sel.command || sel.command === "__separator") {
      qp.hide();
      return;
    }
    qp.hide();
    await vscode.commands.executeCommand(sel.command);
  });
  qp.onDidHide(() => qp.dispose());
  qp.show();
}

// --- Send git diff as Claude's context ---

async function sendGitDiff(): Promise<void> {
  // Resolve a git root: prefer the active editor's folder, then the first
  // open workspace folder.
  const editor = vscode.window.activeTextEditor;
  const seed = editor?.document.uri.fsPath
    ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!seed) {
    vscode.window.showInformationMessage(
      "Claude Bridge: open a folder first so I know which repo to diff.",
    );
    return;
  }
  const root = await findGitRoot(seed);
  if (!root) {
    vscode.window.showInformationMessage(
      "Claude Bridge: that folder isn't inside a git repository.",
    );
    return;
  }

  // Discover the default branch so the "PR diff" option uses the right base.
  let defaultBranch = "main";
  const originHead = await runGit(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (originHead.code === 0) {
    const name = originHead.stdout.trim().replace(/^origin\//, "");
    if (name) defaultBranch = name;
  }

  type DiffChoice = {
    id: "working" | "staged" | "pr";
    label: string;
    description: string;
    detail: string;
    gitArgs: string[];
  };
  const choices: DiffChoice[] = [
    {
      id: "working",
      label: "$(diff) Working tree",
      description: "git diff HEAD",
      detail: "All unstaged + staged changes in your working copy",
      gitArgs: ["diff", "HEAD"],
    },
    {
      id: "staged",
      label: "$(git-commit) Staged only",
      description: "git diff --cached",
      detail: "What you're about to commit",
      gitArgs: ["diff", "--cached"],
    },
    {
      id: "pr",
      label: `$(git-pull-request) PR diff vs. ${defaultBranch}`,
      description: `git diff origin/${defaultBranch}...HEAD`,
      detail: "Everything on this branch since it diverged from the default",
      gitArgs: ["diff", `origin/${defaultBranch}...HEAD`],
    },
  ];
  const picked = await vscode.window.showQuickPick(choices, {
    title: "Send git diff to Claude",
    placeHolder: "Which diff do you want Claude to see?",
  });
  if (!picked) return;

  const result = await runGit(root, picked.gitArgs);
  if (result.code !== 0) {
    vscode.window.showErrorMessage(
      `Claude Bridge: diff failed — ${result.stderr.trim() || "unknown git error"}`,
    );
    return;
  }
  const body = result.stdout;
  if (body.trim().length === 0) {
    vscode.window.showInformationMessage("Claude Bridge: nothing to diff — no changes in that range.");
    return;
  }
  const lineCount = body.split("\n").length;
  // Cap at 2000 lines so we don't blow Claude's context on a monster diff.
  const CAP = 2000;
  let framed: string;
  if (lineCount > CAP) {
    const truncated = body.split("\n").slice(0, CAP).join("\n");
    framed =
      `=== git diff (${picked.description}, truncated ${lineCount - CAP} / ${lineCount} lines) ===\n` +
      "```diff\n" +
      truncated +
      "\n```\n";
  } else {
    framed =
      `=== git diff (${picked.description}, ${lineCount} lines) ===\n` +
      "```diff\n" +
      body +
      "\n```\n";
  }

  // Merge with pinned content (if any) so the user doesn't lose pin context
  // by sending a diff.
  const { renderPinnedBlock } = await import("./pinnedContext");
  const pinnedBlock = getConfig().get<boolean>("pinnedContextEnabled", true)
    ? renderPinnedBlock()
    : "";
  const contextStr = pinnedBlock
    ? pinnedBlock + "\n\n" + framed
    : framed;

  const { CONTEXT_FILE } = await import("./paths");
  const fs = await import("fs/promises");
  await fs.writeFile(
    CONTEXT_FILE,
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: contextStr,
      },
    }),
  );
  // Also invalidate the "sent" marker so the hook picks it up on the next
  // prompt even if the user had just seen a delivery.
  const { CONTEXT_SENT_FILE } = await import("./paths");
  await fs.unlink(CONTEXT_SENT_FILE).catch(() => {});

  vscode.window.showInformationMessage(
    `Claude Bridge: sent ${picked.description} to Claude (${Math.min(lineCount, CAP)} lines). Ask your next question in the terminal.`,
  );
}

async function showPinsPicker(): Promise<void> {
  const pins = getPins();
  if (pins.length === 0) {
    vscode.window.showInformationMessage("Claude Bridge: no pinned selections.");
    return;
  }
  const removeBtn: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon("close"),
    tooltip: "Unpin",
  };
  const openBtn: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon("go-to-file"),
    tooltip: "Open",
  };
  const clearAllBtn: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon("clear-all"),
    tooltip: "Clear all pins",
  };

  const qp = vscode.window.createQuickPick<{ label: string; description?: string; detail?: string; pin: typeof pins[number]; buttons?: vscode.QuickInputButton[] }>();
  qp.title = `Pinned context · ${pins.length} pin${pins.length === 1 ? "" : "s"}`;
  qp.placeholder = "Select a pin to open the file, or use the icons to unpin";
  qp.buttons = [clearAllBtn];
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;

  const refresh = (): void => {
    const cur = getPins();
    if (cur.length === 0) {
      qp.hide();
      return;
    }
    qp.items = cur.map((p) => ({
      label: `$(pin) ${path.basename(p.relativePath)}:${p.startLine}-${p.endLine}`,
      description: p.note || p.relativePath,
      detail: "  " + (p.text.split("\n", 1)[0].slice(0, 100)),
      pin: p,
      buttons: [openBtn, removeBtn],
    }));
  };
  refresh();

  qp.onDidTriggerItemButton(async (ev) => {
    if (ev.button === removeBtn) {
      removePin(ev.item.pin.id);
      refresh();
    } else if (ev.button === openBtn) {
      await openPinLocation(ev.item.pin);
    }
  });
  qp.onDidTriggerButton((btn) => {
    if (btn === clearAllBtn) {
      clearPins();
      qp.hide();
    }
  });
  qp.onDidAccept(async () => {
    const sel = qp.selectedItems[0];
    if (sel) {
      qp.hide();
      await openPinLocation(sel.pin);
    }
  });
  qp.onDidHide(() => qp.dispose());
  qp.show();
}

async function openPinLocation(pin: { absolutePath: string; startLine: number; endLine: number }): Promise<void> {
  try {
    const uri = vscode.Uri.file(pin.absolutePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const start = new vscode.Position(Math.max(0, pin.startLine - 1), 0);
    const endLineIdx = Math.min(pin.endLine - 1, doc.lineCount - 1);
    const end = new vscode.Position(endLineIdx, doc.lineAt(endLineIdx).text.length);
    editor.selection = new vscode.Selection(start, end);
    editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
  } catch (err) {
    vscode.window.showErrorMessage(`Claude Bridge: couldn't open pin — ${(err as Error).message}`);
  }
}

// --- Inject current symbol ---

function findSmallestSymbolAt(
  symbols: vscode.DocumentSymbol[],
  pos: vscode.Position,
): vscode.DocumentSymbol | null {
  let best: vscode.DocumentSymbol | null = null;
  const visit = (list: vscode.DocumentSymbol[]): void => {
    for (const s of list) {
      if (!s.range.contains(pos)) continue;
      if (!best || isTighterThan(s.range, best.range)) best = s;
      if (s.children?.length) visit(s.children);
    }
  };
  visit(symbols);
  return best;
}

function isTighterThan(a: vscode.Range, b: vscode.Range): boolean {
  // True if `a` is strictly inside `b`.
  return b.contains(a) && !a.isEqual(b);
}

async function injectCurrentSymbol(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage("Claude Bridge: no active editor.");
    return;
  }
  if (editor.document.uri.scheme !== "file") {
    vscode.window.showInformationMessage("Claude Bridge: only file-backed editors are supported.");
    return;
  }
  const symbols = (await vscode.commands.executeCommand(
    "vscode.executeDocumentSymbolProvider",
    editor.document.uri,
  )) as vscode.DocumentSymbol[] | undefined;
  if (!symbols?.length) {
    vscode.window.showInformationMessage("Claude Bridge: no symbols detected in this file.");
    return;
  }
  const target = findSmallestSymbolAt(symbols, editor.selection.active);
  if (!target) {
    vscode.window.showInformationMessage("Claude Bridge: cursor isn't inside a symbol.");
    return;
  }
  editor.selection = new vscode.Selection(target.range.start, target.range.end);
  editor.revealRange(target.range, vscode.TextEditorRevealType.InCenter);
  // The normal onDidChangeTextEditorSelection listener will write the files.
}

// --- Recent selections picker ---

function formatAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

async function showRecentSelectionsPicker(): Promise<void> {
  const recent = getRecentSelections();
  if (recent.length === 0) {
    vscode.window.showInformationMessage("Claude Bridge: no recent selections yet.");
    return;
  }
  const items = recent.map((r) => ({
    label: `$(file-code) ${path.basename(r.relativePath)}:${r.startLine}-${r.endLine}`,
    description: `${r.lineCount} line${r.lineCount === 1 ? "" : "s"} · ${formatAgo(r.timestamp)}`,
    detail: r.snippet ? "  " + r.snippet : undefined,
    entry: r,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Re-inject a recent selection",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (picked) await reinjectRecent(picked.entry);
}

// --- Claude's edits (diff / revert via git) ---

async function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const { spawn } = await import("child_process");
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.on("error", () => resolve({ code: -1, stdout, stderr }));
  });
}

async function findGitRoot(filePath: string): Promise<string | null> {
  const dir = path.dirname(filePath);
  const r = await runGit(dir, ["rev-parse", "--show-toplevel"]);
  if (r.code !== 0) return null;
  return r.stdout.trim() || null;
}

async function showClaudeEditsPicker(): Promise<void> {
  const edits = getClaudeEdits();
  if (edits.length === 0) {
    vscode.window.showInformationMessage("Claude Bridge: Claude hasn't edited any files this session.");
    return;
  }
  const diffBtn: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon("diff"),
    tooltip: "Diff vs. HEAD",
  };
  const revertBtn: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon("discard"),
    tooltip: "Revert to HEAD",
  };
  const clearBtn: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon("clear-all"),
    tooltip: "Clear the edits log (doesn't touch files)",
  };

  const qp = vscode.window.createQuickPick<{ label: string; description?: string; detail?: string; edit: typeof edits[number]; buttons?: vscode.QuickInputButton[] }>();
  qp.title = "Claude's edits this session";
  qp.placeholder = "Pick a file to open, or use the icons to diff / revert";
  qp.buttons = [clearBtn];
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;

  const refresh = (): void => {
    const list = getClaudeEdits();
    qp.items = list.map((e) => ({
      label: `$(file-code) ${path.basename(e.absolutePath)}`,
      description: vscode.workspace.asRelativePath(e.absolutePath, false),
      detail: `${e.count} edit${e.count === 1 ? "" : "s"} · last ${formatAgo(e.lastAt)}`,
      edit: e,
      buttons: [diffBtn, revertBtn],
    }));
    if (list.length === 0) qp.hide();
  };
  refresh();

  qp.onDidTriggerItemButton(async (ev) => {
    const absPath = ev.item.edit.absolutePath;
    if (ev.button === diffBtn) {
      await diffClaudeEditAt(absPath);
    } else if (ev.button === revertBtn) {
      await revertClaudeEditAt(absPath);
      refresh();
    }
  });
  qp.onDidTriggerButton((btn) => {
    if (btn === clearBtn) {
      clearClaudeEdits();
      refresh();
    }
  });
  qp.onDidAccept(async () => {
    const sel = qp.selectedItems[0];
    if (sel) {
      qp.hide();
      const uri = vscode.Uri.file(sel.edit.absolutePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
    }
  });
  qp.onDidHide(() => qp.dispose());
  qp.show();
}

async function diffClaudeEditAt(absPath: string): Promise<void> {
  const root = await findGitRoot(absPath);
  if (!root) {
    vscode.window.showWarningMessage(
      "Claude Bridge: can't diff — this file isn't inside a git repository.",
    );
    return;
  }
  const rel = path.relative(root, absPath);

  // Read the HEAD version via `git show` and write it to a deterministic
  // path under the OS temp directory. Then ask VS Code to diff that temp
  // file against the working copy. This is more reliable than trying to
  // synthesize the internal `git:` URI, which changes shape between VS Code
  // releases.
  const show = await runGit(root, ["show", `HEAD:${rel}`]);
  const fileUri = vscode.Uri.file(absPath);
  const title = `${path.basename(absPath)}  (HEAD \u2194 working)`;

  if (show.code !== 0) {
    // Common case: the file is new — doesn't exist at HEAD. Diff against
    // an empty buffer so the whole file shows as "added".
    const stderr = show.stderr.trim();
    if (
      stderr.includes("does not exist") ||
      stderr.includes("exists on disk, but not in")
    ) {
      const tmp = await writeTempForDiff(path.basename(absPath) + ".head", "");
      await vscode.commands.executeCommand("vscode.diff", tmp, fileUri, `${path.basename(absPath)}  (new file)`);
      return;
    }
    vscode.window.showErrorMessage(`Claude Bridge: diff failed — ${stderr || "unknown git error"}`);
    return;
  }

  const tmp = await writeTempForDiff(path.basename(absPath) + ".head", show.stdout);
  await vscode.commands.executeCommand("vscode.diff", tmp, fileUri, title);
}

async function writeTempForDiff(label: string, content: string): Promise<vscode.Uri> {
  const os = await import("os");
  const fs = await import("fs/promises");
  const dir = path.join(os.tmpdir(), "claude-bridge-diff");
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  // Include a short random suffix so concurrent diffs don't race on the same
  // path. The file is re-readable (VS Code leaves it open).
  const rand = Math.random().toString(36).slice(2, 8);
  const p = path.join(dir, `${rand}-${label}`);
  await fs.writeFile(p, content, "utf-8");
  return vscode.Uri.file(p);
}

async function revertClaudeEditAt(absPath: string): Promise<void> {
  const root = await findGitRoot(absPath);
  if (!root) {
    vscode.window.showWarningMessage(
      "Claude Bridge: can't revert — this file isn't inside a git repository.",
    );
    return;
  }
  const rel = path.relative(root, absPath);
  const pick = await vscode.window.showWarningMessage(
    `Revert ${rel} to HEAD? Any of Claude's unsaved changes in this file will be lost.`,
    { modal: true },
    "Revert",
  );
  if (pick !== "Revert") return;
  const result = await runGit(root, ["checkout", "HEAD", "--", rel]);
  if (result.code !== 0) {
    vscode.window.showErrorMessage(
      `Claude Bridge: revert failed — ${result.stderr.trim() || "unknown git error"}`,
    );
    return;
  }
  forgetClaudeEdit(absPath);
  vscode.window.showInformationMessage(`Claude Bridge: reverted ${rel} to HEAD.`);
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
      case "runCommand":
        // Allowlist: only our own commands can be invoked from the webview.
        if (msg.command.startsWith("claude-bridge.")) {
          await vscode.commands.executeCommand(msg.command);
        }
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
  const applyStatusBarCommand = (): void => {
    statusBarItem.command = getConfig().get<boolean>("commandCenterOnStatusClick", true)
      ? "claude-bridge.commandCenter"
      : "claude-bridge.openDashboard";
  };
  applyStatusBarCommand();
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

  // Load pins from disk. Pins survive across reloads because we persist them
  // to ~/.claude-vscode-pinned.json (not just globalState), so the hook also
  // sees them even when the extension isn't running.
  loadPins();
  context.subscriptions.push(
    onPinsChanged(() => {
      // Refresh context.json so pins take effect on the next prompt without
      // waiting for a selection change to trigger a write.
      void syncPinsOnlyContext();
      // If there's a live selection, also re-run writeSelection so the
      // combined (pins + selection) payload is current.
      writeSelection(vscode.window.activeTextEditor);
      broadcastState();
    }),
  );

  // Restore the Claude-edits session log so it survives VS Code reloads.
  // Without this, "Show Claude's Edits…" resets to empty every time the
  // window reopens — painful when you want to review a session's worth of
  // changes. Persist back to globalState on every change.
  const persistedEdits = context.globalState.get<ClaudeEdit[]>(CLAUDE_EDITS_KEY, []);
  restoreClaudeEdits(persistedEdits);
  context.subscriptions.push(
    onClaudeEditsChanged((list) => {
      void context.globalState.update(CLAUDE_EDITS_KEY, list);
      broadcastState();
    }),
  );

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
    vscode.commands.registerCommand("claude-bridge.injectCurrentSymbol", async () => {
      await injectCurrentSymbol();
    }),
    vscode.commands.registerCommand("claude-bridge.recentSelections", async () => {
      await showRecentSelectionsPicker();
    }),
    vscode.commands.registerCommand("claude-bridge.showClaudeEdits", async () => {
      await showClaudeEditsPicker();
    }),
    vscode.commands.registerCommand("claude-bridge.pinSelection", async () => {
      await pinCurrentSelection();
    }),
    vscode.commands.registerCommand("claude-bridge.unpinSelection", async () => {
      await unpinCurrentSelection();
    }),
    vscode.commands.registerCommand("claude-bridge.clearPins", async () => {
      if (getPins().length === 0) {
        vscode.window.showInformationMessage("Claude Bridge: no pins to clear.");
        return;
      }
      const pick = await vscode.window.showWarningMessage(
        `Clear all ${getPins().length} pinned selection${getPins().length === 1 ? "" : "s"}?`,
        { modal: true },
        "Clear",
      );
      if (pick === "Clear") {
        clearPins();
        vscode.window.showInformationMessage("Claude Bridge: cleared all pins.");
      }
    }),
    vscode.commands.registerCommand("claude-bridge.showPins", async () => {
      await showPinsPicker();
    }),
    vscode.commands.registerCommand("claude-bridge.sendGitDiff", async () => {
      await sendGitDiff();
    }),
    vscode.commands.registerCommand("claude-bridge.commandCenter", async () => {
      await openCommandCenter();
    }),
    vscode.commands.registerCommand("claude-bridge.acceptClaudeEdit", async (absPath?: string) => {
      if (typeof absPath === "string") {
        forgetClaudeEdit(absPath);
        vscode.window.showInformationMessage(
          `Claude Bridge: accepted ${path.basename(absPath)}. Dropped from the session log.`,
        );
      }
    }),
    vscode.commands.registerCommand(
      "claude-bridge.askClaudeAboutFailure",
      async (absPath?: string, line?: number, character?: number, message?: string, source?: string) => {
        if (typeof absPath !== "string" || typeof line !== "number" || typeof message !== "string") return;
        await askClaudeAboutFailure(absPath, line, character ?? 0, message, source ?? "");
      },
    ),
    vscode.commands.registerCommand("claude-bridge.diffClaudeEdit", async (absPath?: string) => {
      if (typeof absPath === "string") await diffClaudeEditAt(absPath);
    }),
    vscode.commands.registerCommand("claude-bridge.revertClaudeEdit", async (absPath?: string) => {
      if (typeof absPath === "string") await revertClaudeEditAt(absPath);
    }),
  );

  refreshStatusBar();

  // CodeLens — Claude-edited files + failing tests.
  const editsLens = new ClaudeEditsLensProvider(context);
  const failLens = new TestFailureLensProvider(context);
  // CodeAction — the lightbulb 💡 in the editor with Claude Bridge actions.
  const actionsProvider = new ClaudeBridgeActionsProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, editsLens),
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, failLens),
    vscode.languages.registerCodeActionsProvider(
      { scheme: "file" },
      actionsProvider,
      { providedCodeActionKinds: ClaudeBridgeActionsProvider.providedCodeActionKinds },
    ),
  );

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
    applyStatusBarCommand();
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
