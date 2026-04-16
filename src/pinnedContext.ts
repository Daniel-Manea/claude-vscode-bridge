// Pinned selections — stay in Claude's context on every prompt until the
// user unpins. Persisted to ~/.claude-vscode-pinned.json so they survive
// VS Code reloads and the hook can cat them even when the extension isn't
// running.

import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "fs";
import * as vscode from "vscode";

import { PINNED_FILE } from "./paths";

export interface Pin {
  id: string;
  absolutePath: string;
  relativePath: string;
  startLine: number;
  endLine: number;
  lineCount: number;
  isPartial: boolean;
  text: string;
  fullLine: string | null;
  startChar: number;
  endChar: number;
  note: string;
  pinnedAt: number;
}

let pins: Pin[] = [];
const emitter = new vscode.EventEmitter<Pin[]>();
export const onPinsChanged: vscode.Event<Pin[]> = emitter.event;

export function loadPins(): void {
  try {
    if (!existsSync(PINNED_FILE)) {
      pins = [];
      return;
    }
    const raw = readFileSync(PINNED_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      pins = parsed.filter(isPin);
    }
  } catch {
    pins = [];
  }
}

function isPin(x: unknown): x is Pin {
  if (!x || typeof x !== "object") return false;
  const p = x as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.absolutePath === "string" &&
    typeof p.relativePath === "string" &&
    typeof p.startLine === "number" &&
    typeof p.endLine === "number" &&
    typeof p.text === "string"
  );
}

function persist(): void {
  try {
    if (pins.length === 0) {
      if (existsSync(PINNED_FILE)) unlinkSync(PINNED_FILE);
    } else {
      writeFileSync(PINNED_FILE, JSON.stringify(pins, null, 2));
    }
  } catch (err) {
    console.error("pinnedContext persist failed:", err);
  }
  emitter.fire(pins.slice());
}

export function getPins(): Pin[] {
  return pins.slice();
}

export function addPin(input: Omit<Pin, "id" | "pinnedAt" | "note"> & { note?: string }): Pin {
  // De-dupe by (path, startLine, endLine). Replace existing with fresh data.
  const filtered = pins.filter(
    (p) =>
      !(
        p.absolutePath === input.absolutePath &&
        p.startLine === input.startLine &&
        p.endLine === input.endLine
      ),
  );
  const pin: Pin = {
    ...input,
    note: input.note ?? "",
    id: `${input.absolutePath}:${input.startLine}-${input.endLine}:${Date.now()}`,
    pinnedAt: Date.now(),
  };
  pins = [pin, ...filtered];
  persist();
  return pin;
}

export function removePin(id: string): boolean {
  const before = pins.length;
  pins = pins.filter((p) => p.id !== id);
  if (pins.length !== before) {
    persist();
    return true;
  }
  return false;
}

export function clearPins(): void {
  if (pins.length === 0) return;
  pins = [];
  persist();
}

export function isPinned(absolutePath: string, startLine: number, endLine: number): Pin | undefined {
  return pins.find(
    (p) =>
      p.absolutePath === absolutePath &&
      p.startLine === startLine &&
      p.endLine === endLine,
  );
}

/**
 * Render the pinned entries as a single text block suitable for prepending
 * to the injected context. Empty string if there are no pins.
 */
export function renderPinnedBlock(): string {
  if (pins.length === 0) return "";
  const parts: string[] = [
    `=== Pinned context (${pins.length} pin${pins.length === 1 ? "" : "s"}) ===`,
  ];
  for (const p of pins) {
    const header = `${p.relativePath}:${p.startLine}-${p.endLine} (${p.lineCount} lines${p.note ? ` \u2014 ${p.note}` : ""})`;
    parts.push(header);
    parts.push("```");
    parts.push(p.text);
    parts.push("```");
    parts.push("");
  }
  return parts.join("\n");
}
