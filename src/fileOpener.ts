// Tails the append-only log the PostToolUse hook writes. Two responsibilities:
//
//   1. Maintain a session log of every file Claude edits (always on). The
//      dashboard + the `Claude Bridge: Show Claude's Edits` command read
//      from this.
//   2. If `claudeBridge.autoOpenModifiedFiles` is on, open each edited file
//      in VS Code as soon as it appears in the log.

import * as vscode from "vscode";
import * as fs from "fs/promises";
import { watchFile, unwatchFile, existsSync, statSync, writeFileSync } from "fs";

import { MODIFIED_LOG_FILE } from "./paths";

// `fs.watch` on macOS is flaky for append-only files — use polling for rock-solid reliability.
const POLL_INTERVAL_MS = 300;

export interface ClaudeEdit {
  absolutePath: string;
  firstAt: number;
  lastAt: number;
  count: number;
}

let watching = false;
let lastOffset = 0;
let pending = false;
let autoOpen = false;
let logFn: ((msg: string) => void) | undefined;

const edits = new Map<string, ClaudeEdit>();
const editsEmitter = new vscode.EventEmitter<ClaudeEdit[]>();
export const onClaudeEditsChanged: vscode.Event<ClaudeEdit[]> = editsEmitter.event;

export function initFileOpener(log: (msg: string) => void): void {
  logFn = log;
  startWatching();
}

export function setAutoOpenEnabled(enabled: boolean): void {
  autoOpen = enabled;
}

export function getClaudeEdits(): ClaudeEdit[] {
  return Array.from(edits.values()).sort((a, b) => b.lastAt - a.lastAt);
}

export function clearClaudeEdits(): void {
  edits.clear();
  editsEmitter.fire([]);
}

export function forgetClaudeEdit(absPath: string): void {
  if (edits.delete(absPath)) {
    editsEmitter.fire(getClaudeEdits());
  }
}

/**
 * Restore a previously persisted list of edits. Called on activation so the
 * user's session log survives VS Code reloads. No-op if the list is empty.
 */
export function restoreClaudeEdits(list: ClaudeEdit[]): void {
  if (!Array.isArray(list) || list.length === 0) return;
  for (const e of list) {
    if (
      e &&
      typeof e.absolutePath === "string" &&
      typeof e.firstAt === "number" &&
      typeof e.lastAt === "number" &&
      typeof e.count === "number"
    ) {
      edits.set(e.absolutePath, { ...e });
    }
  }
  editsEmitter.fire(getClaudeEdits());
}

function startWatching(): void {
  if (watching) return;
  try {
    if (!existsSync(MODIFIED_LOG_FILE)) {
      writeFileSync(MODIFIED_LOG_FILE, "");
    }
    // Start from EOF so we don't blast through historical entries.
    lastOffset = statSync(MODIFIED_LOG_FILE).size;

    watchFile(
      MODIFIED_LOG_FILE,
      { interval: POLL_INTERVAL_MS, persistent: false },
      (curr, prev) => {
        if (curr.mtimeMs !== prev.mtimeMs || curr.size !== prev.size) {
          void drainLog();
        }
      },
    );
    watching = true;
    logFn?.(`edits watcher started (polling ${MODIFIED_LOG_FILE} every ${POLL_INTERVAL_MS}ms)`);
  } catch (err) {
    logFn?.(`fileOpener startWatching error: ${(err as Error).message}`);
  }
}

function stopWatching(): void {
  if (watching) {
    unwatchFile(MODIFIED_LOG_FILE);
    watching = false;
  }
  lastOffset = 0;
}

async function drainLog(): Promise<void> {
  if (pending) return;
  pending = true;
  try {
    // Small coalescing window — Claude's Edit tool produces several events
    // for a single edit (rename target files, stat, etc.).
    await new Promise((r) => setTimeout(r, 40));

    let content: string;
    try {
      content = await fs.readFile(MODIFIED_LOG_FILE, "utf-8");
    } catch {
      lastOffset = 0;
      return;
    }

    if (content.length < lastOffset) lastOffset = 0;
    const chunk = content.slice(lastOffset);
    lastOffset = content.length;

    const paths = chunk.split("\n").map((s) => s.trim()).filter(Boolean);
    if (paths.length === 0) return;

    const seenThisBatch = new Set<string>();
    const now = Date.now();
    for (const p of paths) {
      if (seenThisBatch.has(p)) continue;
      seenThisBatch.add(p);
      const existing = edits.get(p);
      if (existing) {
        existing.lastAt = now;
        existing.count += 1;
      } else {
        edits.set(p, { absolutePath: p, firstAt: now, lastAt: now, count: 1 });
      }
      if (autoOpen) await openFile(p);
    }
    editsEmitter.fire(getClaudeEdits());
  } catch (err) {
    logFn?.(`fileOpener drainLog error: ${(err as Error).message}`);
  } finally {
    pending = false;
  }
}

async function openFile(absPath: string): Promise<void> {
  try {
    if (!existsSync(absPath)) return; // Claude may have deleted/renamed it.
    const uri = vscode.Uri.file(absPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: false });
  } catch (err) {
    logFn?.(`fileOpener open(${absPath}) failed: ${(err as Error).message}`);
  }
}

export function disposeFileOpener(): void {
  stopWatching();
}

export async function verifyAutoOpenSetup(): Promise<string> {
  const { CLAUDE_SETTINGS_JSON } = await import("./paths");
  const lines: string[] = [];
  lines.push(`Log file: ${MODIFIED_LOG_FILE}`);
  lines.push(`  exists: ${existsSync(MODIFIED_LOG_FILE)}`);
  if (existsSync(MODIFIED_LOG_FILE)) {
    lines.push(`  size: ${statSync(MODIFIED_LOG_FILE).size} bytes`);
  }
  lines.push(`Watcher: ${watching ? "running" : "stopped"}`);
  lines.push(`Auto-open: ${autoOpen ? "on" : "off"}`);
  lines.push(`Tracked edits: ${edits.size}`);
  try {
    const raw = await fs.readFile(CLAUDE_SETTINGS_JSON, "utf-8");
    const settings = JSON.parse(raw);
    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
    const postTool = hooks.PostToolUse ?? [];
    const hasOurs = (postTool as Array<{ hooks?: Array<{ command?: string }> }>)
      .some((entry) =>
        entry.hooks?.some((h) => h.command?.includes(".claude-vscode-modified.log")),
      );
    lines.push(`${CLAUDE_SETTINGS_JSON}`);
    lines.push(`  PostToolUse hook installed: ${hasOurs}`);
  } catch (err) {
    lines.push(`Could not read settings.json: ${(err as Error).message}`);
  }
  return lines.join("\n");
}
