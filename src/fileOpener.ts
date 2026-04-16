// Watches the append-only log written by the PostToolUse hook and opens each
// newly-appended file path in VS Code. Opt-in via `claudeBridge.autoOpenModifiedFiles`.

import * as vscode from "vscode";
import * as fs from "fs/promises";
import { watchFile, unwatchFile, existsSync, statSync, writeFileSync } from "fs";

import { MODIFIED_LOG_FILE } from "./paths";

// `fs.watch` on macOS is flaky for append-only files — it often misses events.
// `fs.watchFile` polls, which trades a tiny CPU cost for rock-solid reliability.
const POLL_INTERVAL_MS = 300;

let watching = false;
let lastOffset = 0;
let pending = false;
let enabledCache = false;
let logFn: ((msg: string) => void) | undefined;

export function initFileOpener(log: (msg: string) => void): void {
  logFn = log;
}

export function setAutoOpenEnabled(enabled: boolean): void {
  if (enabled === enabledCache) return;
  enabledCache = enabled;
  if (enabled) startWatching();
  else stopWatching();
}

function startWatching(): void {
  if (watching) return;
  try {
    // Ensure the log file exists so watchFile has something to stat. Start
    // reading from EOF so toggling on mid-session doesn't blast open every
    // file Claude edited earlier.
    if (!existsSync(MODIFIED_LOG_FILE)) {
      writeFileSync(MODIFIED_LOG_FILE, "");
    }
    lastOffset = statSync(MODIFIED_LOG_FILE).size;

    watchFile(
      MODIFIED_LOG_FILE,
      { interval: POLL_INTERVAL_MS, persistent: false },
      (curr, prev) => {
        // mtime changed → new content, probably.
        if (curr.mtimeMs !== prev.mtimeMs || curr.size !== prev.size) {
          void drainLog();
        }
      },
    );
    watching = true;
    logFn?.(`auto-open watcher started (polling ${MODIFIED_LOG_FILE} every ${POLL_INTERVAL_MS}ms)`);
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
    // Small coalescing window — Claude's Edit tool can produce multiple
    // events for a single edit (rename target files, stat, etc.).
    await new Promise((r) => setTimeout(r, 40));

    let content: string;
    try {
      content = await fs.readFile(MODIFIED_LOG_FILE, "utf-8");
    } catch {
      lastOffset = 0;
      return;
    }

    // Handle truncation (e.g., cleanup deleted and re-created the file).
    if (content.length < lastOffset) lastOffset = 0;

    const chunk = content.slice(lastOffset);
    lastOffset = content.length;

    const paths = chunk.split("\n").map((s) => s.trim()).filter(Boolean);
    if (paths.length === 0) return;

    // De-dupe within this batch — Edit + subsequent MultiEdit on the same
    // file both log it, no need to open twice.
    const seen = new Set<string>();
    for (const p of paths) {
      if (seen.has(p)) continue;
      seen.add(p);
      await openFile(p);
    }
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
    await vscode.window.showTextDocument(doc, {
      preview: true,
      preserveFocus: false,
    });
  } catch (err) {
    logFn?.(`fileOpener open(${absPath}) failed: ${(err as Error).message}`);
  }
}

export function disposeFileOpener(): void {
  stopWatching();
}

/**
 * Verify that auto-open is wired: log file exists and our PostToolUse hook is
 * in the user-scope settings. Returns a short diagnostic report.
 */
export async function verifyAutoOpenSetup(): Promise<string> {
  const { CLAUDE_SETTINGS_JSON } = await import("./paths");
  const claudeSettingsPath = CLAUDE_SETTINGS_JSON;
  const lines: string[] = [];
  lines.push(`Log file: ${MODIFIED_LOG_FILE}`);
  lines.push(`  exists: ${existsSync(MODIFIED_LOG_FILE)}`);
  if (existsSync(MODIFIED_LOG_FILE)) {
    lines.push(`  size: ${statSync(MODIFIED_LOG_FILE).size} bytes`);
  }
  lines.push(`Watcher: ${watching ? "running" : "stopped"}`);
  try {
    const raw = await fs.readFile(claudeSettingsPath, "utf-8");
    const settings = JSON.parse(raw);
    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
    const postTool = hooks.PostToolUse ?? [];
    const hasOurs = (postTool as Array<{ hooks?: Array<{ command?: string }> }>)
      .some((entry) =>
        entry.hooks?.some((h) => h.command?.includes(".claude-vscode-modified.log")),
      );
    lines.push(`${claudeSettingsPath}`);
    lines.push(`  PostToolUse hook installed: ${hasOurs}`);
  } catch (err) {
    lines.push(`Could not read ${claudeSettingsPath}: ${(err as Error).message}`);
  }
  return lines.join("\n");
}
