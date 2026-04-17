// All selection-related work: watching the editor, serializing the selection
// into the four bridge files, and cleaning up when the selection goes away or
// the bridge is disabled.
//
// The writer owns its own module-scoped state (debounce timer, last-written
// key, current selection) and exposes a tiny init() for the extension host
// to wire up the status-bar item and a broadcast callback.

import * as vscode from "vscode";
import * as fs from "fs/promises";
import { existsSync, readFileSync, statSync, unlinkSync, unwatchFile, watchFile } from "fs";
import * as path from "path";

import {
  SELECTION_FILE,
  CONTEXT_FILE,
  CONTEXT_SENT_FILE,
  STATUSLINE_FILE,
  BRIDGE_FILES,
} from "./paths";
import { getConfig, isFileExcluded } from "./settings";
import { normalizeSegments } from "./segments";
import { SelectionInfo } from "./webview/messages";
import { renderPinnedBlock } from "./pinnedContext";

// --- Module state ---
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let lastSelectionKey = "";
let currentSelection: SelectionInfo | null = null;
let currentExtraRegions = 0;
let statusBarItem: vscode.StatusBarItem | undefined;
let onSelectionChanged: (() => void) | undefined;
let logFn: ((msg: string) => void) | undefined;
let extensionVersion = "";

// Recent-selections ring — last N distinct selections, most-recent first.
export interface RecentSelection {
  absolutePath: string;
  relativePath: string;
  startLine: number;
  endLine: number;
  lineCount: number;
  isPartial: boolean;
  snippet: string;
  timestamp: number;
}
const RECENT_CAP = 10;
let recentSelections: RecentSelection[] = [];
let selectionsWrittenThisSession = 0;

export function getRecentSelections(): RecentSelection[] {
  return recentSelections.slice();
}

export function getSessionStats(): { selectionsWritten: number } {
  return { selectionsWritten: selectionsWrittenThisSession };
}

export async function reinjectRecent(entry: RecentSelection): Promise<void> {
  try {
    const uri = vscode.Uri.file(entry.absolutePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const start = new vscode.Position(entry.startLine - 1, 0);
    const endLineIdx = Math.min(entry.endLine - 1, doc.lineCount - 1);
    const endCol = doc.lineAt(endLineIdx).text.length;
    const end = new vscode.Position(endLineIdx, endCol);
    editor.selection = new vscode.Selection(start, end);
    editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
  } catch (err) {
    vscode.window.showErrorMessage(`Claude Bridge: couldn't reopen selection — ${(err as Error).message}`);
  }
}
// Injection tracking: the hook stores the mtime (in seconds) of the last
// context.json it successfully delivered. We compare to our own last-write
// mtime to show "pending" vs "delivered" in the tooltip.
let lastContextMtimeSec: number | null = null;
let lastSentMtimeSec: number | null = null;
let injectionWatcherStarted = false;

// --- Init / accessors ---

export function initSelectionWriter(opts: {
  statusBarItem: vscode.StatusBarItem;
  version: string;
  onChanged: () => void;
  log?: (msg: string) => void;
}): void {
  statusBarItem = opts.statusBarItem;
  extensionVersion = opts.version;
  onSelectionChanged = opts.onChanged;
  logFn = opts.log;
  startInjectionWatcher();
}

/**
 * Poll the sent-marker file. The Claude Code hook writes the mtime of the
 * context file to this marker each time it successfully injects, so a change
 * here means "Claude just saw the selection".
 */
function startInjectionWatcher(): void {
  if (injectionWatcherStarted) return;
  injectionWatcherStarted = true;
  watchFile(CONTEXT_SENT_FILE, { interval: 400, persistent: false }, () => {
    try {
      if (!existsSync(CONTEXT_SENT_FILE)) {
        lastSentMtimeSec = null;
      } else {
        const content = readFileSync(CONTEXT_SENT_FILE, "utf-8").trim();
        const n = Number(content);
        lastSentMtimeSec = Number.isFinite(n) ? n : null;
      }
      refreshStatusBar();
      onSelectionChanged?.();
    } catch (err) {
      logFn?.(`injection watcher error: ${(err as Error).message}`);
    }
  });
}

/**
 * Injection state — used by the tooltip and the dashboard. "pending" = we
 * wrote a context file more recently than the hook has acknowledged.
 * "delivered" = the hook has picked it up. "idle" = no selection / no inject.
 */
export type InjectionStatus =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "delivered"; sinceSec: number };

export function getInjectionStatus(): InjectionStatus {
  if (lastContextMtimeSec === null) return { kind: "idle" };
  if (lastSentMtimeSec === null || lastSentMtimeSec < lastContextMtimeSec) {
    return { kind: "pending" };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  return { kind: "delivered", sinceSec: Math.max(0, nowSec - lastSentMtimeSec) };
}

function formatAgo(sec: number): string {
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m ago`;
}

export function getCurrentSelection(): SelectionInfo | null {
  return currentSelection;
}

export function resetSelectionDedupe(): void {
  lastSelectionKey = "";
}

// --- File I/O ---

export async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmp = filePath + ".tmp";
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, filePath);
}

export async function cleanupFiles(): Promise<void> {
  lastSelectionKey = "";
  lastContextMtimeSec = null;
  lastSentMtimeSec = null;
  await Promise.allSettled(
    BRIDGE_FILES.flatMap((f) => [
      fs.unlink(f).catch(() => {}),
      fs.unlink(f + ".tmp").catch(() => {}),
    ]),
  );
  // If pins are enabled and populated, immediately rewrite context.json with
  // just the pinned block so the next Claude prompt still sees them.
  await syncPinsOnlyContext();
  updateStatusBarItem(null);
  currentSelection = null;
  currentExtraRegions = 0;
  onSelectionChanged?.();
}

/**
 * Rewrite `~/.claude-vscode-context.json` using *only* the pinned block.
 * Called when the selection goes empty or when pins change. No-op if there
 * are no pins or the pin feature is disabled.
 */
export async function syncPinsOnlyContext(): Promise<void> {
  const cfg = getConfig();
  if (!cfg.get<boolean>("contextInjection", true)) return;
  if (!cfg.get<boolean>("pinnedContextEnabled", true)) return;
  const pinned = renderPinnedBlock();
  if (!pinned) return;
  try {
    await atomicWrite(
      CONTEXT_FILE,
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: pinned,
        },
      }),
    );
    lastContextMtimeSec = Math.floor(statSync(CONTEXT_FILE).mtimeMs / 1000);
  } catch (err) {
    logFn?.(`syncPinsOnlyContext: ${(err as Error).message}`);
  }
}

export function cleanupFilesSync(): void {
  lastSelectionKey = "";
  for (const f of BRIDGE_FILES) {
    try {
      if (existsSync(f)) unlinkSync(f);
    } catch (err) {
      logFn?.(`cleanupFilesSync unlink(${path.basename(f)}): ${(err as Error).message}`);
    }
    try {
      if (existsSync(f + ".tmp")) unlinkSync(f + ".tmp");
    } catch (err) {
      logFn?.(`cleanupFilesSync unlink(${path.basename(f)}.tmp): ${(err as Error).message}`);
    }
  }
}

// --- Status bar item ---

// Colored bullet — tints shift with injection state so the icon tells you
// at a glance whether Claude has actually received your selection:
//   green  → delivered (hook picked it up)
//   yellow → pending (we wrote the files; the next Claude prompt will inject)
//   idle   → no selection (shows the link codicon only)
//   warn   → bridge master toggle is off
const DOT = "\u25CF";

function updateStatusBarItem(info: { path: string; lines: string; extraRegions?: number } | null): void {
  if (!statusBarItem) return;

  const cfg = getConfig();
  const contextOn = cfg.get<boolean>("contextInjection", true);

  if (info) {
    const extra = info.extraRegions && info.extraRegions > 0 ? ` +${info.extraRegions}` : "";
    const label = `${info.path} ${info.lines}${extra}`;
    const status = getInjectionStatus();
    if (!contextOn) {
      // Selection exists but context injection is off — mark it muted so the
      // user sees "this selection won't reach Claude until you toggle on".
      statusBarItem.text = `$(circle-slash) ${label}`;
      statusBarItem.color = new vscode.ThemeColor("descriptionForeground");
    } else if (status.kind === "pending") {
      statusBarItem.text = `${DOT} ${label}`;
      statusBarItem.color = new vscode.ThemeColor("charts.yellow");
    } else {
      statusBarItem.text = `${DOT} ${label}`;
      statusBarItem.color = new vscode.ThemeColor("testing.iconPassed");
    }
  } else {
    statusBarItem.text = contextOn
      ? "$(link) Claude Bridge"
      : "$(circle-slash) Claude Bridge";
    statusBarItem.color = contextOn
      ? undefined
      : new vscode.ThemeColor("descriptionForeground");
  }

  statusBarItem.tooltip = buildTooltip(info);
  statusBarItem.show();
}

function buildTooltip(_info: { path: string; lines: string } | null): vscode.MarkdownString {
  const cfg = getConfig();
  const contextInjection = cfg.get<boolean>("contextInjection", true);
  const statusLine = cfg.get<boolean>("statusLine", true);
  const autoOpen = cfg.get<boolean>("autoOpenModifiedFiles", false);

  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportHtml = true;
  md.supportThemeIcons = true;

  // --- Header: wordmark + version (icon removed — redundant with the
  //     activity-bar icon the user is hovering over) ---------------------
  md.appendMarkdown(
    `**Claude Bridge**&nbsp;&nbsp;<span style="color:#8A8F98;">v${extensionVersion}</span>\n\n`,
  );

  // --- Primary status line (one row that answers "is it working now?") ---
  if (!contextInjection) {
    md.appendMarkdown(
      `<span style="color:#F14C4C;">\u25CF</span>&nbsp;&nbsp;**Context injection is off**\n\n`,
    );
    md.appendMarkdown(
      `<span style="color:#8A8F98;">Selections won't reach Claude until this is enabled.</span>\n\n`,
    );
    md.appendMarkdown(
      "[Open dashboard to enable](command:claude-bridge.openDashboard)\n\n",
    );
    return md;
  }

  if (currentSelection) {
    const status = getInjectionStatus();
    if (status.kind === "delivered") {
      md.appendMarkdown(
        `<span style="color:#73C991;">\u25CF</span>&nbsp;&nbsp;**Delivered to Claude Code** &nbsp;` +
          `<span style="color:#8A8F98;">${formatAgo(status.sinceSec)}</span>\n\n`,
      );
    } else if (status.kind === "pending") {
      md.appendMarkdown(
        `<span style="color:#E2B93B;">\u25CF</span>&nbsp;&nbsp;**Queued for your next Claude prompt**\n\n`,
      );
    } else {
      md.appendMarkdown(
        `<span style="color:#73C991;">\u25CF</span>&nbsp;&nbsp;**Selection ready to inject**\n\n`,
      );
    }

    // Selection card — mono path + muted line range.
    md.appendMarkdown(
      `<span style="color:#D97757;">\u2731</span>&nbsp;&nbsp;\`${currentSelection.relativePath}\`\n\n`,
    );
    const range = currentSelection.isPartial
      ? `line ${currentSelection.startLine}`
      : `lines ${currentSelection.startLine}\u2013${currentSelection.endLine}` +
        `&nbsp;&nbsp;\u00B7&nbsp;&nbsp;${currentSelection.lineCount} lines`;
    md.appendMarkdown(`<span style="color:#8A8F98;">${range}</span>\n\n`);
  } else {
    md.appendMarkdown(
      `<span style="color:#73C991;">\u25CF</span>&nbsp;&nbsp;**Bridge ready**\n\n`,
    );
    md.appendMarkdown(
      `<span style="color:#8A8F98;">Select code in the editor and Claude will see it on your next prompt.</span>\n\n`,
    );
  }

  // --- Feature chips (compact single line) --------------------------------
  md.appendMarkdown("---\n\n");
  const chip = (on: boolean, label: string): string => {
    const color = on ? "#73C991" : "#8A8F98";
    const opacity = on ? "1" : "0.55";
    return (
      `<span style="color:${color};">\u25CF</span>&nbsp;` +
      `<span style="opacity:${opacity};">${label}</span>`
    );
  };
  md.appendMarkdown(
    chip(contextInjection, "Context") +
      "&nbsp;&nbsp;&nbsp;&nbsp;" +
      chip(statusLine, "Status line") +
      "&nbsp;&nbsp;&nbsp;&nbsp;" +
      chip(autoOpen, "Auto-open") +
      "\n\n",
  );

  // --- Actions ------------------------------------------------------------
  const actions: string[] = ["[Dashboard](command:claude-bridge.openDashboard)"];
  if (currentSelection) {
    actions.push("[Preview selection](command:claude-bridge.preview)");
    actions.push("[Clear](command:claude-bridge.clearSelection)");
  } else {
    actions.push("[Full settings](command:claude-bridge.openSettings)");
  }
  md.appendMarkdown(actions.join("&nbsp;&nbsp;\u00B7&nbsp;&nbsp;"));

  return md;
}

/**
 * Recompute the status-bar text + tooltip without moving the selection cursor.
 * Called from the extension's configuration-change listener so the bar
 * reflects toggle changes immediately.
 */
export function refreshStatusBar(): void {
  if (!statusBarItem) return;
  const cfg = getConfig();
  if (!currentSelection) {
    updateStatusBarItem(null);
    return;
  }
  // Rebuild the info block from the stashed selection.
  const maxPath = cfg.get<number>("statusLineMaxPath", 30);
  const pathStyle = cfg.get<string>("statusLinePathStyle", "basename");
  const displayPath = formatPath(currentSelection.relativePath, pathStyle, maxPath);
  const lineRef = currentSelection.isPartial
    ? `L${currentSelection.startLine}`
    : `L${currentSelection.startLine}\u2013${currentSelection.endLine}`;
  updateStatusBarItem({ path: displayPath, lines: lineRef, extraRegions: currentExtraRegions });
}

// --- Path formatting ---

function truncatePath(relativePath: string, maxLen: number): string {
  if (relativePath.length <= maxLen) return relativePath;
  const fileName = path.basename(relativePath);
  const available = maxLen - fileName.length - 3;
  return available > 0
    ? relativePath.slice(0, available) + "..." + fileName
    : "..." + fileName;
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

// --- Context + status-line string builders ---

function buildContext(
  relativePath: string,
  startLine: number,
  endLine: number,
  lineCount: number,
  text: string,
  fullLine: string | null,
  startChar: number,
  endChar: number,
  diagnostics: string[] = [],
): string {
  const cfg = getConfig();
  const showPartial = cfg.get<boolean>("showPartialLineContext", true);
  const diagBlock = diagnostics.length > 0
    ? "\n\nDiagnostics on this range:\n" + diagnostics.map((d) => `  - ${d}`).join("\n")
    : "";

  if (fullLine !== null && showPartial) {
    const marker = " ".repeat(startChar) + "^".repeat(endChar - startChar);
    return (
      `${relativePath}#L${startLine} (partial)\n` +
      `\`\`\`\n${fullLine}\n${marker}\n\`\`\`\n` +
      `Selected text: "${text}"` + diagBlock
    );
  }
  return (
    `${relativePath}:${startLine}-${endLine} (${lineCount} lines)\n` +
    `\`\`\`\n${text}\n\`\`\`` + diagBlock
  );
}

/**
 * Collect all diagnostics (errors, warnings, info) whose range intersects
 * the selection. Formatted for Claude: "[severity] line N: message".
 */
function collectDiagnostics(
  uri: vscode.Uri,
  selection: vscode.Selection,
): string[] {
  const diagnostics = vscode.languages.getDiagnostics(uri);
  const selectionRange = new vscode.Range(selection.start, selection.end);
  const severity: Record<number, string> = {
    0: "error",
    1: "warning",
    2: "info",
    3: "hint",
  };
  return diagnostics
    .filter((d) => d.range.intersection(selectionRange) !== undefined)
    .map((d) => {
      const sev = severity[d.severity] ?? "diag";
      const line = d.range.start.line + 1;
      const source = d.source ? ` (${d.source})` : "";
      return `[${sev}] line ${line}${source}: ${d.message}`;
    });
}

function buildSelectionStatusLine(
  relativePath: string,
  absolutePath: string,
  startLine: number,
  endLine: number,
  lineCount: number,
  isPartial: boolean,
  extraRegions: number,
): string {
  const cfg = getConfig();
  const maxPath = cfg.get<number>("statusLineMaxPath", 30);
  const pathStyle = cfg.get<string>("statusLinePathStyle", "basename");

  const DIM = "\x1b[2m";
  const BOLD = "\x1b[1m";
  const RESET = "\x1b[0m";
  // Brand terracotta — ties this segment to the extension's identity.
  const OR = "\x1b[38;2;217;119;87m";

  const displayPath = formatPath(relativePath, pathStyle, maxPath);
  const lineRef = isPartial ? `L${startLine}` : `L${startLine}\u2013${endLine}`;
  const countLabel = isPartial ? "(selection)" : `(${lineCount})`;
  const multiLabel = extraRegions > 0 ? ` +${extraRegions}` : "";

  const uri = `vscode://file${absolutePath}:${startLine}:1`;
  const filePart = `${OR}${BOLD}${displayPath}${RESET}`;
  const linePart = `${OR}${lineRef}${RESET}`;
  const multiPart = extraRegions > 0 ? `${OR}${multiLabel}${RESET}` : "";
  // Wrap the clickable text in the OSC 8 hyperlink sequence so terminals that
  // support it (iTerm2, recent macOS Terminal, WezTerm) open the file in VS Code.
  const link = `\x1b]8;;${uri}\x07${filePart} ${linePart}${multiPart}\x1b]8;;\x07`;

  return `${link} ${DIM}${countLabel}${RESET}`;
}

// --- Preview ---

export function previewSelection(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage("Claude Bridge: no active editor.");
    return;
  }
  const cfg = getConfig();
  const multiCursor = cfg.get<boolean>("multiCursorSelection", true);
  const includeDiag = cfg.get<boolean>("includeDiagnostics", true);
  const allSelections = multiCursor ? editor.selections.slice() : [editor.selection];
  const nonEmpty = allSelections.filter(
    (s) => !s.isEmpty && editor.document.getText(s).trim().length > 0,
  );
  if (nonEmpty.length === 0) {
    vscode.window.showInformationMessage("Claude Bridge: no non-empty selection.");
    return;
  }
  // Primary = first non-empty; extras = the rest. Same policy as writeSelection.
  const primary = !editor.selection.isEmpty && editor.document.getText(editor.selection).trim().length > 0
    ? editor.selection
    : nonEmpty[0];
  const extras = nonEmpty.filter((s) => s !== primary);

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  const absolutePath = editor.document.uri.fsPath;
  const relativePath = workspaceFolder
    ? path.relative(workspaceFolder.uri.fsPath, absolutePath)
    : path.basename(absolutePath);

  const renderOne = (sel: vscode.Selection): string => {
    const text = editor.document.getText(sel);
    const s = sel.start.line + 1;
    const e = sel.end.line + 1;
    const lc = e - s + 1;
    const single = sel.start.line === sel.end.line;
    const fullLine = single ? editor.document.lineAt(sel.start.line).text : null;
    const partial = single && fullLine !== null && text !== fullLine.trim();
    const diag = includeDiag ? collectDiagnostics(editor.document.uri, sel) : [];
    return buildContext(
      relativePath,
      s,
      e,
      lc,
      text,
      partial ? fullLine : null,
      sel.start.character,
      sel.end.character,
      diag,
    );
  };
  let context = renderOne(primary);
  if (extras.length > 0) {
    context =
      `=== Multi-cursor selection (${extras.length + 1} regions) ===\n\n` +
      context + "\n\n" + extras.map(renderOne).join("\n\n");
  }
  if (cfg.get<boolean>("pinnedContextEnabled", true)) {
    const pinned = renderPinnedBlock();
    if (pinned) context = pinned + "\n\n" + context;
  }

  const startLine = primary.start.line + 1;
  const endLine = primary.end.line + 1;
  const lineCount = endLine - startLine + 1;
  const singleLine = primary.start.line === primary.end.line;
  const isPartial =
    singleLine &&
    editor.document.getText(primary) !== editor.document.lineAt(primary.start.line).text.trim();
  const maxPath = cfg.get<number>("statusLineMaxPath", 30);
  const pathStyle = cfg.get<string>("statusLinePathStyle", "basename");
  const displayPath = formatPath(relativePath, pathStyle, maxPath);
  const lineRef = isPartial ? `#L${startLine}` : `#${startLine}-${endLine}`;
  const extraLabel = extras.length > 0 ? ` +${extras.length}` : "";

  const panel = vscode.window.createOutputChannel("Claude Bridge: Preview");
  panel.clear();
  panel.appendLine("=== Context injection (what Claude Code receives) ===");
  panel.appendLine("");
  panel.appendLine(context);
  panel.appendLine("");
  panel.appendLine("=== Status line (selection segment) ===");
  panel.appendLine(
    `@${displayPath}${lineRef}${extraLabel} ${isPartial ? "(selection)" : `(${lineCount} lines)`}`,
  );
  panel.appendLine("");
  panel.appendLine("=== Segment order ===");
  const segments = normalizeSegments(getConfig().get("statusLineSegments"));
  for (const s of segments) {
    panel.appendLine(`  ${s.enabled ? "[x]" : "[ ]"} ${s.id}`);
  }
  panel.show();
}

// --- Main entry point ---

export function writeSelection(editor: vscode.TextEditor | undefined): void {
  const cfg = getConfig();

  // Skip non-file editors immediately — output channels, terminals, and
  // other pseudo-editors should never produce bridge files. This also
  // prevents a feedback loop where our own Output channel triggers events.
  if (editor && editor.document.uri.scheme !== "file") {
    return;
  }

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  // Hard-coded minimum — always aim for speed. 10ms is just enough to coalesce
  // VS Code's selection-change events that fire multiple times per key press.
  const debounceMs = 10;

  debounceTimer = setTimeout(async () => {
    try {
      if (!editor || editor.selection.isEmpty) {
        await cleanupFiles();
        return;
      }

      // Only process file-backed editors — skip output channels, terminals,
      // notebook cells, and other pseudo-editors. This also prevents a
      // feedback loop where logging to the Output channel triggers another
      // selection-change event.
      if (editor.document.uri.scheme !== "file") {
        return;
      }

      // Safety net: if the file matches any excluded pattern (env files,
      // keys, secrets, etc.) the extension writes nothing — Claude Code
      // never sees the selection.
      if (isFileExcluded(editor.document.uri.fsPath)) {
        await cleanupFiles();
        return;
      }

      // Primary selection drives the statusline / status-bar / selection
      // file. With multi-cursor enabled, we pick the first non-empty selection
      // as primary so a leader-cursor that's empty doesn't short-circuit the
      // other non-empty regions.
      const multiCursor = cfg.get<boolean>("multiCursorSelection", true);
      const allSelections = multiCursor ? editor.selections.slice() : [editor.selection];
      const nonEmpty = allSelections.filter(
        (s) => !s.isEmpty && editor.document.getText(s).trim().length > 0,
      );
      if (nonEmpty.length === 0) {
        await cleanupFiles();
        return;
      }
      const selection = !editor.selection.isEmpty && editor.document.getText(editor.selection).trim().length > 0
        ? editor.selection
        : nonEmpty[0];
      let text = editor.document.getText(selection);
      const extraSelections = nonEmpty.filter((s) => s !== selection);

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

      // Factor every active selection into the dedupe key so that moving a
      // secondary cursor while keeping the primary triggers a rewrite.
      const key =
        absolutePath +
        ":" +
        editor.selections
          .map((s) => `${s.start.line}:${s.start.character}-${s.end.line}:${s.end.character}`)
          .join(",");
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
        const diagnostics = cfg.get<boolean>("includeDiagnostics", true)
          ? collectDiagnostics(editor.document.uri, selection)
          : [];
        let contextStr = buildContext(
          relativePath,
          startLine,
          endLine,
          lineCount,
          text,
          isPartial ? fullLineText : null,
          selection.start.character,
          selection.end.character,
          diagnostics,
        );
        // Multi-cursor: if the pre-filtered `extraSelections` list is
        // non-empty, append each as its own context block.
        if (extraSelections.length > 0) {
          const extras: string[] = [];
          for (const sel of extraSelections) {
            const extraText = editor.document.getText(sel);
            const s = sel.start.line + 1;
            const e = sel.end.line + 1;
            const lc = e - s + 1;
            const diag = cfg.get<boolean>("includeDiagnostics", true)
              ? collectDiagnostics(editor.document.uri, sel)
              : [];
            extras.push(
              buildContext(
                relativePath,
                s,
                e,
                lc,
                extraText,
                null,
                sel.start.character,
                sel.end.character,
                diag,
              ),
            );
          }
          contextStr =
            `=== Multi-cursor selection (${extras.length + 1} regions) ===\n\n` +
            contextStr + "\n\n" + extras.join("\n\n");
        }
        if (cfg.get<boolean>("pinnedContextEnabled", true)) {
          const pinned = renderPinnedBlock();
          if (pinned) contextStr = pinned + "\n\n" + contextStr;
        }
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
              extraSelections.length,
            ),
          ),
        );
      }

      await Promise.all(writes);

      // Capture the mtime of the context file we just wrote so the tooltip
      // can show "pending injection" until the hook catches up.
      if (cfg.get<boolean>("contextInjection", true) && existsSync(CONTEXT_FILE)) {
        try {
          lastContextMtimeSec = Math.floor(statSync(CONTEXT_FILE).mtimeMs / 1000);
        } catch {
          /* stat failed — leave the state alone */
        }
      }

      currentSelection = {
        relativePath,
        startLine,
        endLine,
        lineCount,
        isPartial,
      };

      selectionsWrittenThisSession += 1;

      // Push to the recent-selections ring. De-dupe on (path, startLine, endLine).
      const snippet = text.split("\n", 1)[0].slice(0, 80);
      const existingIdx = recentSelections.findIndex(
        (r) =>
          r.absolutePath === absolutePath &&
          r.startLine === startLine &&
          r.endLine === endLine,
      );
      if (existingIdx >= 0) recentSelections.splice(existingIdx, 1);
      recentSelections.unshift({
        absolutePath,
        relativePath,
        startLine,
        endLine,
        lineCount,
        isPartial,
        snippet,
        timestamp: Date.now(),
      });
      if (recentSelections.length > RECENT_CAP) {
        recentSelections = recentSelections.slice(0, RECENT_CAP);
      }

      const maxPath = cfg.get<number>("statusLineMaxPath", 30);
      const pathStyle = cfg.get<string>("statusLinePathStyle", "basename");
      const displayPath = formatPath(relativePath, pathStyle, maxPath);
      const lineRef = isPartial ? `L${startLine}` : `L${startLine}\u2013${endLine}`;
      currentExtraRegions = extraSelections.length;
      updateStatusBarItem({ path: displayPath, lines: lineRef, extraRegions: currentExtraRegions });

      onSelectionChanged?.();
    } catch (err) {
      logFn?.(`writeSelection error: ${(err as Error).message}`);
    }
  }, debounceMs);
}

export function disposeDebounce(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (injectionWatcherStarted) {
    try {
      unwatchFile(CONTEXT_SENT_FILE);
    } catch {
      /* noop */
    }
    injectionWatcherStarted = false;
  }
}
