// Claude Bridge sidebar dashboard controller (v3).
// Compiled standalone; shares only types + DOM helpers with the settings
// panel bundle via webview/shared/*.
//
// Diff-render: hot sections (toggles, preset pills, segment list) build
// their DOM once and mutate existing nodes on subsequent state broadcasts.
// Cold sections (brand, first-run card, install badge) rebuild as before.

import type { State, SegmentMeta } from "../shared/types.js";
import { bindDnd, gripSvg } from "../shared/dnd.js";
import { makeCheckbox } from "../shared/controls.js";

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
let currentState: State | null = null;
let dragFromIdx: number | null = null;

function post(msg: unknown): void {
  vscode.postMessage(msg);
}

function render(state: State): void {
  const prev = currentState;
  currentState = state;

  if (!prev || prev.version !== state.version) renderBrand(state);

  // Setup card changes identity when setupCompleted flips.
  if (!prev || prev.setupCompleted !== state.setupCompleted) renderSetup(state);

  // Hot sections — idempotent diff-render.
  renderSessionStrip(state);
  renderStatusGrid(state);
  renderPresets(state);
  renderSegments(state);
  renderActions(state);

  applySidebarDim(state);
}

// ---------- Session strip ----------

interface StripNodes {
  root: HTMLElement;
  selections: HTMLElement;
  edits: HTMLElement;
  pins: HTMLElement;
}
let stripNodes: StripNodes | null = null;

function renderSessionStrip(state: State): void {
  const root = document.getElementById("sessionStrip");
  if (!root) return;

  const enabled = state.settings.showSessionStats && state.setupCompleted;
  if (!enabled) {
    root.innerHTML = "";
    stripNodes = null;
    return;
  }

  if (!stripNodes) {
    root.innerHTML = "";
    const sel = stat(root, "selections", "selections sent");
    sep(root);
    const ed = stat(root, "edits", "files Claude edited");
    sep(root);
    const pin = stat(root, "pins", "pinned");
    stripNodes = { root, selections: sel, edits: ed, pins: pin };
  }
  stripNodes.selections.textContent = String(state.selectionsWritten);
  stripNodes.edits.textContent = String(state.editsCount);
  stripNodes.pins.textContent = String(state.pinsCount);
}

function stat(parent: HTMLElement, id: string, label: string): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "stat";
  const b = document.createElement("b");
  b.dataset.role = id;
  b.textContent = "0";
  const s = document.createElement("span");
  s.textContent = label;
  wrap.append(b, s);
  parent.appendChild(wrap);
  return b;
}

function sep(parent: HTMLElement): void {
  const s = document.createElement("span");
  s.className = "sep";
  s.textContent = "\u00B7";
  parent.appendChild(s);
}

function applySidebarDim(state: State): void {
  const notSetup = !state.setupCompleted;
  const sections = document.querySelectorAll<HTMLElement>(".sidebar > section");
  sections.forEach((el) => {
    if (el.id === "setupSection" || el.id === "footerSection") return;
    el.classList.toggle("section-disabled", notSetup);
  });
}

function renderBrand(state: State): void {
  const v = document.getElementById("brandVersion");
  if (v) v.textContent = `v${state.version}`;
}

function renderSetup(state: State): void {
  const root = document.getElementById("setupSection");
  if (!root) return;
  root.innerHTML = "";
  if (state.setupCompleted) return;

  const card = document.createElement("div");
  card.className = "setup-card";
  const h = document.createElement("h3");
  h.className = "setup-card-title";
  h.textContent = "Get started";
  const intro = document.createElement("p");
  intro.className = "setup-card-intro";
  intro.textContent =
    "Install Claude Bridge into Claude Code to start piping VS Code selections.";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "setup-install-btn";
  btn.textContent = "Install at User scope";
  btn.addEventListener("click", () => post({ type: "install" }));
  card.append(h, intro, btn);
  root.appendChild(card);
}

// ---------- Status grid (diff-render) ----------

interface ToggleRowDef {
  key: "contextInjection" | "statusLine" | "autoOpenModifiedFiles";
  label: string;
  offHint: string;
}
const TOGGLE_ROWS: ToggleRowDef[] = [
  {
    key: "contextInjection",
    label: "Context injection",
    offHint: "Off — selection won't appear in Claude's context.",
  },
  {
    key: "statusLine",
    label: "Status line",
    offHint: "Off — Claude's status line will render without the bridge.",
  },
  {
    key: "autoOpenModifiedFiles",
    label: "Auto-open edited files",
    offHint: "Off — files Claude edits stay closed.",
  },
];

interface ToggleRowNodes {
  root: HTMLDivElement;
  check: HTMLButtonElement;
  hint: HTMLDivElement | null;
  def: ToggleRowDef;
}
const toggleNodes = new Map<string, ToggleRowNodes>();

function renderStatusGrid(state: State): void {
  const grid = document.getElementById("statusGrid");
  if (!grid) return;
  if (toggleNodes.size === 0) buildStatusGrid(grid);
  for (const def of TOGGLE_ROWS) updateToggleRow(def, state);
}

function buildStatusGrid(grid: HTMLElement): void {
  for (const def of TOGGLE_ROWS) {
    const row = document.createElement("div");
    row.className = "status-row";
    row.dataset.key = def.key;

    const sw = makeCheckbox(false, def.label, (next) => {
      post({ type: "setSetting", key: def.key, value: next });
    });

    const text = document.createElement("div");
    text.className = "status-row-text";
    const labelEl = document.createElement("div");
    labelEl.className = "status-row-label";
    labelEl.textContent = def.label;
    text.appendChild(labelEl);

    row.append(sw, text);

    row.addEventListener("click", (ev) => {
      if ((ev.target as HTMLElement).closest?.(".cb-check")) return;
      sw.click();
    });

    grid.appendChild(row);
    toggleNodes.set(def.key, { root: row, check: sw, hint: null, def });
  }
}

function updateToggleRow(def: ToggleRowDef, state: State): void {
  const nodes = toggleNodes.get(def.key);
  if (!nodes) return;
  const on = Boolean(state.settings[def.key]);
  const isOn = nodes.check.getAttribute("aria-checked") === "true";
  if (isOn !== on) {
    nodes.check.classList.toggle("checked", on);
    nodes.check.setAttribute("aria-checked", String(on));
  }
  // Hint node appears only when the toggle is off.
  if (on && nodes.hint) {
    nodes.hint.remove();
    nodes.hint = null;
  } else if (!on && !nodes.hint) {
    const hint = document.createElement("div");
    hint.className = "status-row-hint";
    hint.textContent = def.offHint;
    const text = nodes.root.querySelector<HTMLElement>(".status-row-text");
    text?.appendChild(hint);
    nodes.hint = hint;
  }
}

// ---------- Preset dropdown ----------

interface PresetNodes {
  select: HTMLSelectElement;
  desc: HTMLElement;
}
let presetNodes: PresetNodes | null = null;

function renderPresets(state: State): void {
  const row = document.getElementById("presetRow");
  const desc = document.getElementById("presetDesc");
  if (!row || !desc) return;
  if (!presetNodes) {
    row.innerHTML = "";
    const select = document.createElement("select");
    select.className = "preset-select";
    for (const p of state.presets) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.label;
      opt.title = p.description;
      select.appendChild(opt);
    }
    const custom = document.createElement("option");
    custom.value = "custom";
    custom.textContent = "Custom";
    select.appendChild(custom);
    select.addEventListener("change", () => {
      if (select.value === "custom") return;
      post({ type: "applyPreset", presetId: select.value });
    });
    row.appendChild(select);
    presetNodes = { select, desc };
  }

  const active = state.settings.activePreset;
  presetNodes.select.value = active || "custom";
  const matched = state.presets.find((p) => p.id === active);
  const next = matched ? matched.description : "Your own configuration.";
  if (desc.textContent !== next) desc.textContent = next;
}

// ---------- Segment list (diff-render, reorder-preserving) ----------

interface SegmentNodes {
  li: HTMLLIElement;
  check: HTMLButtonElement;
  label: HTMLElement;
  example: HTMLElement;
  meta: SegmentMeta;
}
const segmentNodes = new Map<string, SegmentNodes>();
let segmentsBuilt = false;

function renderSegments(state: State): void {
  const list = document.getElementById("segmentsList");
  if (!list) return;
  const metaById = new Map(state.segmentMeta.map((m) => [m.id, m] as const));

  // First render: build every known segment node. Subsequent renders
  // reuse nodes and only reorder / toggle state.
  if (!segmentsBuilt) {
    for (const [id, meta] of metaById) {
      segmentNodes.set(id, buildSegmentNode(meta));
    }
    segmentsBuilt = true;
  }

  // Walk state.segments in order; append each node (appendChild on an
  // existing child moves it — doesn't clone/rebuild).
  for (let idx = 0; idx < state.segments.length; idx++) {
    const entry = state.segments[idx];
    const nodes = segmentNodes.get(entry.id);
    if (!nodes) continue;
    if (list.children[idx] !== nodes.li) list.appendChild(nodes.li);
    nodes.li.dataset.index = String(idx);
    nodes.li.classList.toggle("on", entry.enabled);
    const isOn = nodes.check.getAttribute("aria-checked") === "true";
    if (isOn !== entry.enabled) {
      nodes.check.classList.toggle("checked", entry.enabled);
      nodes.check.setAttribute("aria-checked", String(entry.enabled));
    }
    nodes.li.setAttribute(
      "aria-label",
      `${nodes.meta.label}, ${entry.enabled ? "on" : "off"}, example ${nodes.meta.example}`,
    );
  }
}

function buildSegmentNode(meta: SegmentMeta): SegmentNodes {
  const li = document.createElement("li");
  li.className = "segment";
  li.draggable = true;
  li.dataset.id = meta.id;
  li.title = meta.description;

  const handleWrap = document.createElement("span");
  handleWrap.className = "drag-handle";
  handleWrap.setAttribute("aria-hidden", "true");
  handleWrap.innerHTML = gripSvg();

  const check = makeCheckbox(false, meta.label, (next) => {
    if (!currentState) return;
    const updated = currentState.segments.map((s) =>
      s.id === meta.id ? { ...s, enabled: next } : s,
    );
    post({ type: "setSegments", segments: updated });
  });

  const label = document.createElement("span");
  label.className = "segment-label";
  label.textContent = meta.label;

  const example = document.createElement("code");
  example.className = "segment-example";
  example.textContent = meta.example;

  li.append(handleWrap, check, label, example);
  bindDnd(li, handleWrap, {
    getDraggingIndex: () => dragFromIdx,
    setDraggingIndex: (i) => { dragFromIdx = i; },
    onDrop: (fromIdx, toIdx) => {
      if (!currentState) return;
      const next = currentState.segments.slice();
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      post({ type: "setSegments", segments: next });
    },
  });
  li.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    if (t.closest?.(".drag-handle") || t.closest?.(".cb-check")) return;
    check.click();
  });

  return { li, check, label, example, meta };
}

// ---------- Session actions (Recent / Claude's edits) ----------

interface ActionNodes {
  row: HTMLElement;
  recentBtn: HTMLButtonElement;
  recentCount: HTMLElement;
  editsBtn: HTMLButtonElement;
  editsCount: HTMLElement;
  symbolBtn: HTMLButtonElement;
}
let actionNodes: ActionNodes | null = null;

const isMac = (navigator.platform || "").toLowerCase().includes("mac");
const SHORTCUT_SYMBOL = isMac ? "\u2318\u21E7I" : "Ctrl+\u21E7I";

function renderActions(state: State): void {
  const root = document.getElementById("actionsRow");
  if (!root) return;
  if (!actionNodes) {
    root.className = "action-row";
    const symbolBtn = actionButton(
      "Inject current symbol",
      undefined,
      () => post({ type: "runCommand", command: "claude-bridge.injectCurrentSymbol" }),
      {
        shortcut: SHORTCUT_SYMBOL,
        title:
          `Wrap the enclosing function / class at the cursor into a selection and inject. ` +
          `Default shortcut: ${SHORTCUT_SYMBOL}. Rebind from VS Code's Keyboard Shortcuts (` +
          (isMac ? "\u2318K \u2318S" : "Ctrl+K Ctrl+S") + `).`,
      },
    );
    const recentBtn = actionButton(
      "Recent selections",
      "recent-count",
      () => post({ type: "runCommand", command: "claude-bridge.recentSelections" }),
    );
    const editsBtn = actionButton(
      "Claude's edits this session",
      "edits-count",
      () => post({ type: "runCommand", command: "claude-bridge.showClaudeEdits" }),
    );
    root.append(symbolBtn.btn, recentBtn.btn, editsBtn.btn);
    actionNodes = {
      row: root,
      recentBtn: recentBtn.btn,
      recentCount: recentBtn.count!,
      editsBtn: editsBtn.btn,
      editsCount: editsBtn.count!,
      symbolBtn: symbolBtn.btn,
    };
  }
  // Update counts + disabled state.
  actionNodes.recentCount.textContent = String(state.recentCount);
  actionNodes.recentCount.classList.toggle("hot", state.recentCount > 0);
  actionNodes.recentBtn.toggleAttribute("disabled", state.recentCount === 0);

  actionNodes.editsCount.textContent = String(state.editsCount);
  actionNodes.editsCount.classList.toggle("hot", state.editsCount > 0);
  actionNodes.editsBtn.toggleAttribute("disabled", state.editsCount === 0);
}

function actionButton(
  label: string,
  countRole: string | undefined,
  onClick: () => void,
  opts?: { shortcut?: string; title?: string },
): { btn: HTMLButtonElement; count: HTMLElement | null } {
  const btn = document.createElement("button");
  btn.type = "button";
  if (opts?.title) btn.title = opts.title;
  const text = document.createElement("span");
  text.textContent = label;
  btn.appendChild(text);
  let countEl: HTMLElement | null = null;
  if (countRole) {
    countEl = document.createElement("span");
    countEl.className = "count";
    countEl.dataset.role = countRole;
    countEl.textContent = "0";
    btn.appendChild(countEl);
  } else if (opts?.shortcut) {
    const kbd = document.createElement("kbd");
    kbd.className = "shortcut";
    kbd.textContent = opts.shortcut;
    btn.appendChild(kbd);
  }
  btn.addEventListener("click", () => {
    if (btn.hasAttribute("disabled")) return;
    onClick();
  });
  return { btn, count: countEl };
}

document.getElementById("openSettingsBtn")?.addEventListener("click", () => {
  post({ type: "openSettings" });
});

window.addEventListener("message", (ev: MessageEvent) => {
  const msg = ev.data as { type?: string; state?: State };
  if (msg && msg.type === "state" && msg.state) {
    const t0 = performance.now();
    render(msg.state);
    const ms = performance.now() - t0;
    post({ type: "perf", label: "sidebar.render", ms });
  }
});

post({ type: "ready" });
