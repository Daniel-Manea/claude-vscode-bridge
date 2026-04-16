// Generates and writes Claude Code's status line shell script.
// The template lives in media/statusline-template.sh and defines all possible
// segments wrapped in `#SEGMENT:<id>:BEGIN … #SEGMENT:<id>:END` markers.
// We re-emit them in the user's chosen order, commenting out disabled ones.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from "fs";
import * as path from "path";

import { normalizeSegments } from "./segments";
import { CLAUDE_SETTINGS_DIR, STATUSLINE_SCRIPT } from "./paths";
import { getConfig } from "./settings";

// Cache the template text — it's static and reread on every config change
// without this. Invalidate only if the extension path changes.
let templateCache: { extPath: string; text: string } | null = null;

function loadTemplate(extPath: string): string {
  if (templateCache && templateCache.extPath === extPath) {
    return templateCache.text;
  }
  const templatePath = path.join(extPath, "media", "statusline-template.sh");
  const text = readFileSync(templatePath, "utf-8");
  templateCache = { extPath, text };
  return text;
}

const BAR_GLYPHS: Record<string, { full: string; empty: string }> = {
  blocks:  { full: "\u2588", empty: "\u2591" }, // █ ░
  squares: { full: "\u25A0", empty: "\u25A1" }, // ■ □
  shades:  { full: "\u2593", empty: "\u2591" }, // ▓ ░
  dots:    { full: "\u25CF", empty: "\u25CB" }, // ● ○
};

export function generateStatusLineScript(extPath: string): string {
  const cfg = getConfig();
  const statusLineOn = cfg.get<boolean>("statusLine", true);

  if (!statusLineOn) {
    return "#!/bin/bash\n# Claude Bridge — status line currently disabled via dashboard toggle.\ncat >/dev/null\nexit 0\n";
  }

  const segments = normalizeSegments(cfg.get("statusLineSegments"));
  const template = loadTemplate(extPath);

  // Split the template into preamble / reorderable blocks / postamble.
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

  // Re-emit blocks in the user's order, commenting out disabled ones.
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

  // Substitute template tokens: bar glyphs (from statusLineBarStyle) and
  // separator character (from statusLineCompact).
  const barStyle = cfg.get<string>("statusLineBarStyle", "blocks");
  const compact = cfg.get<boolean>("statusLineCompact", false);
  const glyphs = BAR_GLYPHS[barStyle] ?? BAR_GLYPHS.blocks;
  script = script
    .replace(/__CB_BAR_FULL__/g, glyphs.full)
    .replace(/__CB_BAR_EMPTY__/g, glyphs.empty)
    .replace(/__CB_SEP__/g, compact ? "" : "\u00B7");

  return script;
}

export function writeStatusLineScript(extPath: string, log?: (msg: string) => void): void {
  try {
    if (!extPath) {
      log?.("writeStatusLineScript: extPath is empty, skipping");
      return;
    }
    if (!existsSync(CLAUDE_SETTINGS_DIR)) {
      mkdirSync(CLAUDE_SETTINGS_DIR, { recursive: true });
    }
    const script = generateStatusLineScript(extPath);
    writeFileSync(STATUSLINE_SCRIPT, script);
    chmodSync(STATUSLINE_SCRIPT, 0o755);
    log?.(`writeStatusLineScript: wrote ${script.length} bytes to ${STATUSLINE_SCRIPT}`);
  } catch (err) {
    log?.(`writeStatusLineScript error: ${(err as Error).message}`);
  }
}
