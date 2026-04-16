// Tiny helpers for reading the extension's VS Code configuration. v3: all
// settings are written at Global (user) scope — the workspace-scope switcher
// was removed along with the multi-scope install UI.

import * as vscode from "vscode";
import { ClaudeBridgeSettings } from "./webview/messages";
import { PresetSettings } from "./presets";

export function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("claudeBridge");
}

export function readSettings(): ClaudeBridgeSettings {
  const cfg = getConfig();
  return {
    contextInjection: cfg.get<boolean>("contextInjection", true),
    statusLine: cfg.get<boolean>("statusLine", true),
    autoOpenModifiedFiles: cfg.get<boolean>("autoOpenModifiedFiles", false),
    maxLines: cfg.get<number>("maxLines", 500),
    statusLineMaxPath: cfg.get<number>("statusLineMaxPath", 30),
    statusLinePathStyle: cfg.get(
      "statusLinePathStyle",
      "basename",
    ) as ClaudeBridgeSettings["statusLinePathStyle"],
    statusLineBarStyle: cfg.get(
      "statusLineBarStyle",
      "blocks",
    ) as ClaudeBridgeSettings["statusLineBarStyle"],
    statusLineCompact: cfg.get<boolean>("statusLineCompact", false),
    showPartialLineContext: cfg.get<boolean>("showPartialLineContext", true),
    includeDiagnostics: cfg.get<boolean>("includeDiagnostics", true),
    includeTypeContext: cfg.get<boolean>("includeTypeContext", false),
    multiCursorSelection: cfg.get<boolean>("multiCursorSelection", true),
    pinnedContextEnabled: cfg.get<boolean>("pinnedContextEnabled", true),
    codeLensClaudeEdits: cfg.get<boolean>("codeLensClaudeEdits", true),
    codeLensTestFailures: cfg.get<boolean>("codeLensTestFailures", true),
    commandCenterOnStatusClick: cfg.get<boolean>("commandCenterOnStatusClick", true),
    showSessionStats: cfg.get<boolean>("showSessionStats", true),
    activePreset: cfg.get<string>("activePreset", "default"),
    excludedPatterns: cfg.get<string[]>("excludedPatterns", []),
  };
}

/**
 * Translate a simple glob (`*`, `**`, `?`) into a RegExp. `*` matches a
 * filename segment (no slashes), `**` matches any depth, `?` matches one
 * character that isn't a slash.
 */
function globToRegex(glob: string): RegExp {
  let src = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        src += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        src += "[^/]*";
      }
    } else if (c === "?") {
      src += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      src += "\\" + c;
    } else {
      src += c;
    }
  }
  return new RegExp("^" + src + "$");
}

/**
 * Check whether a file path matches any of the user's excluded-pattern globs.
 * We match against both the full path and the basename, so short patterns
 * like ".env*" work without requiring a leading directory wildcard.
 */
export function isFileExcluded(filePath: string): boolean {
  const patterns = getConfig().get<string[]>("excludedPatterns", []);
  if (patterns.length === 0) return false;
  const normalized = filePath.replace(/\\/g, "/");
  const basename = normalized.split("/").pop() ?? "";
  for (const p of patterns) {
    try {
      const rx = globToRegex(p);
      if (rx.test(normalized) || rx.test(basename)) return true;
    } catch {
      // Malformed pattern — skip it rather than crash the writer.
    }
  }
  return false;
}

export function presetSettingsFrom(settings: ClaudeBridgeSettings): PresetSettings {
  return {
    contextInjection: settings.contextInjection,
    statusLine: settings.statusLine,
    autoOpenModifiedFiles: settings.autoOpenModifiedFiles,
    maxLines: settings.maxLines,
    statusLineMaxPath: settings.statusLineMaxPath,
    showPartialLineContext: settings.showPartialLineContext,
  };
}
