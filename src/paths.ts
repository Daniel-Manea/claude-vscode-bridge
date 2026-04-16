// File paths and shell snippets shared across the extension.
// Zero VS Code or project-local dependencies — safe to import from anywhere.

import * as os from "os";
import * as path from "path";

export const HOME = os.homedir();

// Bridge files in the user's home directory — consumed by Claude Code's hook
// and status-line script.
export const SELECTION_FILE    = path.join(HOME, ".claude-vscode-selection.json");
export const CONTEXT_FILE      = path.join(HOME, ".claude-vscode-context.json");
export const STATUSLINE_FILE   = path.join(HOME, ".claude-vscode-statusline.txt");
export const CONTEXT_SENT_FILE = path.join(HOME, ".claude-vscode-context-sent");
/** Pinned selections — merged into the injected context alongside the live selection. */
export const PINNED_FILE       = path.join(HOME, ".claude-vscode-pinned.json");
// Append-only log of files Claude Code has edited this session. The extension
// tails this file and opens each new entry in VS Code.
export const MODIFIED_LOG_FILE = path.join(HOME, ".claude-vscode-modified.log");

// Claude Code's config directory.
export const CLAUDE_SETTINGS_DIR  = path.join(HOME, ".claude");
export const CLAUDE_SETTINGS_JSON = path.join(CLAUDE_SETTINGS_DIR, "settings.json");
export const STATUSLINE_SCRIPT    = path.join(CLAUDE_SETTINGS_DIR, "claude-bridge-statusline.sh");

export const BRIDGE_FILES = [SELECTION_FILE, CONTEXT_FILE, STATUSLINE_FILE, CONTEXT_SENT_FILE];

// ---------- Hook commands ----------
// v3: user-only installs. No marker guard, no project-variant.

// UserPromptSubmit hook. Reads our context file and only emits it when mtime
// changes so Claude doesn't keep re-injecting stale context.
export const HOOK_COMMAND =
  'cat>/dev/null;F="$HOME/.claude-vscode-context.json";S="$HOME/.claude-vscode-context-sent";[ -f "$F" ]||exit 0;NEW=$(stat -f%m "$F" 2>/dev/null||stat -c%Y "$F" 2>/dev/null);OLD=$(cat "$S" 2>/dev/null);[ "$NEW" = "$OLD" ]&&exit 0;cat "$F";echo "$NEW">"$S"';

export function isOurContextHook(cmd: string | undefined): boolean {
  if (!cmd) return false;
  return cmd.includes(".claude-vscode-context.json");
}

// PostToolUse hook — auto-open edited files.
export const MODIFIED_HOOK_MATCHER = "Edit|Write|MultiEdit|NotebookEdit";
export const MODIFIED_HOOK_COMMAND =
  'I=$(cat);F=$(echo "$I"|grep -o \'"file_path":"[^"]*"\'|head -1|cut -d\'"\' -f4);[ -n "$F" ]&&echo "$F">>"$HOME/.claude-vscode-modified.log"';

export function isOurPostToolHook(cmd: string | undefined): boolean {
  if (!cmd) return false;
  return cmd.includes(".claude-vscode-modified.log");
}

export const STATUSLINE_SCRIPT_COMMAND = "~/.claude/claude-bridge-statusline.sh";
