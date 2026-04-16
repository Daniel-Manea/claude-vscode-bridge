// Reads/writes Claude Code's user settings.json at ~/.claude/settings.json.
// v3 simplification: user scope is the only install location — project scope
// and project-local scope were removed along with the marker-guard system.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import * as path from "path";

import {
  CLAUDE_SETTINGS_JSON,
  HOOK_COMMAND,
  MODIFIED_HOOK_COMMAND,
  MODIFIED_HOOK_MATCHER,
  STATUSLINE_SCRIPT,
  STATUSLINE_SCRIPT_COMMAND,
  isOurContextHook,
  isOurPostToolHook,
} from "./paths";
import { writeStatusLineScript } from "./statusLineScript";

export function userSettingsPath(): string {
  return CLAUDE_SETTINGS_JSON;
}

// ---------- Detection ----------

/** Does `~/.claude/settings.json` currently contain our hook or statusLine? */
export function isInstalled(): boolean {
  try {
    if (!existsSync(CLAUDE_SETTINGS_JSON)) return false;
    const raw = JSON.parse(readFileSync(CLAUDE_SETTINGS_JSON, "utf-8")) as Record<string, unknown>;
    const hooks = (raw.hooks ?? {}) as Record<string, unknown[]>;
    const prompt = (hooks.UserPromptSubmit ?? []) as Array<{
      hooks?: Array<{ command?: string }>;
    }>;
    if (prompt.some((e) => e.hooks?.some((h) => isOurContextHook(h.command)))) {
      return true;
    }
    const sl = raw.statusLine as { command?: string } | undefined;
    if (sl?.command === STATUSLINE_SCRIPT_COMMAND) return true;
    return false;
  } catch {
    return false;
  }
}

export function hasExistingClaudeBridgeConfig(): boolean {
  return isInstalled();
}

// ---------- Install / uninstall ----------

/**
 * Install (or self-heal) at user scope. Adds our hook + statusLine entries
 * into `~/.claude/settings.json` and regenerates the statusLine script.
 * Silent by design: the caller owns any user-visible notification.
 */
export function installAtUser(opts: {
  extPath: string;
  log?: (m: string) => void;
}): { path: string; additions: string[]; removals: string[] } {
  const { additions, removals } = applyChanges();
  writeStatusLineScript(opts.extPath, opts.log);
  return { path: CLAUDE_SETTINGS_JSON, additions, removals };
}

/**
 * Uninstall — strip our entries from `~/.claude/settings.json` and delete the
 * generated statusLine script.
 */
export function uninstallAtUser(log?: (m: string) => void): { path: string } {
  stripOurEntries(log);
  try {
    if (existsSync(STATUSLINE_SCRIPT)) unlinkSync(STATUSLINE_SCRIPT);
  } catch (err) {
    log?.(`statusline script cleanup: ${(err as Error).message}`);
  }
  return { path: CLAUDE_SETTINGS_JSON };
}

/**
 * Full uninstall — same as uninstallAtUser, kept as a named function so the
 * extension.ts command has a clear target.
 */
export function uninstallEverywhere(log?: (m: string) => void): string[] {
  const touched: string[] = [];
  if (isInstalled()) {
    stripOurEntries(log);
    touched.push(CLAUDE_SETTINGS_JSON);
  }
  try {
    if (existsSync(STATUSLINE_SCRIPT)) unlinkSync(STATUSLINE_SCRIPT);
  } catch (err) {
    log?.(`uninstallEverywhere cleanup: ${(err as Error).message}`);
  }
  try {
    const modLog = path.join(process.env.HOME ?? "", ".claude-vscode-modified.log");
    if (existsSync(modLog)) unlinkSync(modLog);
  } catch {
    /* noop */
  }
  return touched;
}

// ---------- Apply / strip ----------

function applyChanges(): { additions: string[]; removals: string[] } {
  const dir = path.dirname(CLAUDE_SETTINGS_JSON);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let existing: Record<string, unknown> = {};
  if (existsSync(CLAUDE_SETTINGS_JSON)) {
    try {
      existing = JSON.parse(readFileSync(CLAUDE_SETTINGS_JSON, "utf-8")) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }

  const additions: string[] = [];
  const removals: string[] = [];

  // ---- Context-injection hook ----
  const hooks = (existing.hooks ?? {}) as Record<string, unknown[]>;
  const prompt = (hooks.UserPromptSubmit ?? []) as Array<{
    hooks?: Array<{ command?: string }>;
  }>;
  const hasOurs = prompt.some((e) => e.hooks?.some((h) => isOurContextHook(h.command)));

  if (!hasOurs) {
    hooks.UserPromptSubmit = [
      ...prompt,
      { matcher: "", hooks: [{ type: "command", command: HOOK_COMMAND }] },
    ];
    existing.hooks = hooks;
    additions.push("context-injection hook");
  } else {
    // Self-heal: if a stale variant (old marker-guarded command) exists,
    // replace it with the current command string.
    let replaced = false;
    const updated = prompt.map((entry) => {
      if (!entry.hooks) return entry;
      const mapped = entry.hooks.map((h) => {
        if (isOurContextHook(h.command) && h.command !== HOOK_COMMAND) {
          replaced = true;
          return { ...h, command: HOOK_COMMAND };
        }
        return h;
      });
      return { ...entry, hooks: mapped };
    });
    if (replaced) {
      hooks.UserPromptSubmit = updated;
      additions.push("context-injection hook (updated)");
    }
  }

  // ---- PostToolUse hook ----
  const postTool = (hooks.PostToolUse ?? []) as Array<{
    matcher?: string;
    hooks?: Array<{ command?: string }>;
  }>;
  const hasPost = postTool.some((e) => e.hooks?.some((h) => isOurPostToolHook(h.command)));

  if (!hasPost) {
    hooks.PostToolUse = [
      ...postTool,
      {
        matcher: MODIFIED_HOOK_MATCHER,
        hooks: [{ type: "command", command: MODIFIED_HOOK_COMMAND }],
      },
    ];
    existing.hooks = hooks;
    additions.push("auto-open hook");
  } else {
    let replaced = false;
    const updated = postTool.map((entry) => {
      if (!entry.hooks) return entry;
      const mapped = entry.hooks.map((h) => {
        if (isOurPostToolHook(h.command) && h.command !== MODIFIED_HOOK_COMMAND) {
          replaced = true;
          return { ...h, command: MODIFIED_HOOK_COMMAND };
        }
        return h;
      });
      return { ...entry, hooks: mapped };
    });
    if (replaced) {
      hooks.PostToolUse = updated;
      additions.push("auto-open hook (updated)");
    }
  }

  if (Object.keys(hooks).length === 0) delete existing.hooks;
  else existing.hooks = hooks;

  // ---- Status line ----
  const sl = existing.statusLine as { command?: string } | undefined;
  if (sl?.command !== STATUSLINE_SCRIPT_COMMAND) {
    existing.statusLine = {
      type: "command",
      command: STATUSLINE_SCRIPT_COMMAND,
      refreshInterval: 1,
    };
    additions.push("status line");
  }

  if (additions.length > 0 || removals.length > 0) {
    if (Object.keys(existing).length === 0) {
      if (existsSync(CLAUDE_SETTINGS_JSON)) unlinkSync(CLAUDE_SETTINGS_JSON);
    } else {
      writeFileSync(CLAUDE_SETTINGS_JSON, JSON.stringify(existing, null, 2));
    }
  }

  return { additions, removals };
}

function stripOurEntries(log?: (m: string) => void): void {
  try {
    if (!existsSync(CLAUDE_SETTINGS_JSON)) return;
    const raw = JSON.parse(readFileSync(CLAUDE_SETTINGS_JSON, "utf-8")) as Record<string, unknown>;

    const hooks = (raw.hooks ?? {}) as Record<string, unknown[]>;
    if (hooks.UserPromptSubmit) {
      const filtered = (hooks.UserPromptSubmit as Array<{
        hooks?: Array<{ command?: string }>;
      }>).filter((e) => !e.hooks?.some((h) => isOurContextHook(h.command)));
      if (filtered.length === 0) delete hooks.UserPromptSubmit;
      else hooks.UserPromptSubmit = filtered;
    }
    if (hooks.PostToolUse) {
      const filtered = (hooks.PostToolUse as Array<{
        hooks?: Array<{ command?: string }>;
      }>).filter((e) => !e.hooks?.some((h) => isOurPostToolHook(h.command)));
      if (filtered.length === 0) delete hooks.PostToolUse;
      else hooks.PostToolUse = filtered;
    }
    if (Object.keys(hooks).length === 0) delete raw.hooks;
    else raw.hooks = hooks;

    const sl = raw.statusLine as { command?: string } | undefined;
    if (
      sl?.command === STATUSLINE_SCRIPT_COMMAND ||
      sl?.command?.includes("claude-vscode-statusline")
    ) {
      delete raw.statusLine;
    }

    if (Object.keys(raw).length === 0) {
      unlinkSync(CLAUDE_SETTINGS_JSON);
    } else {
      writeFileSync(CLAUDE_SETTINGS_JSON, JSON.stringify(raw, null, 2));
    }
  } catch (err) {
    log?.(`stripOurEntries: ${(err as Error).message}`);
  }
}
