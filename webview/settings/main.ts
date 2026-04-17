// Claude Bridge — full settings panel controller (v3).
//
// Diff-render: hot sections (master toggles, preset pills, segment list)
// build their DOM once and mutate existing nodes on subsequent broadcasts.
// Cold or focus-sensitive sections (install card, path style, context
// inputs, danger) rebuild as before but rarely.

import type {
  CoreSettings as Settings,
  SegmentMeta,
  State,
} from "../shared/types.js";
import { bindDnd, gripSvg } from "../shared/dnd.js";
import { makeCheckbox, makePill } from "../shared/controls.js";

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
  // Preserve text-input focus across re-renders (for the cold sections that
  // still rebuild their DOM — path-style max length, context fields).
  const active = document.activeElement as HTMLElement | null;
  const focusId = active?.id ?? null;
  const isTextInput =
    active instanceof HTMLInputElement &&
    (active.type === "text" || active.type === "number");
  const inFlight = isTextInput ? active.value : null;
  const selStart = isTextInput ? active.selectionStart : null;
  const selEnd   = isTextInput ? active.selectionEnd   : null;

  const prev = currentState;
  currentState = state;

  const howCard = document.getElementById("how-it-works");
  if (howCard) howCard.classList.toggle("hidden", !!state.howItWorksDismissed);

  if (!prev || prev.version !== state.version) renderHero(state);
  if (!prev || prev.setupCompleted !== state.setupCompleted) renderInstall(state);

  // Hot sections — diff-render.
  renderMasterToggles(state);
  renderPresets(state);
  renderSegments(state);

  // Cold sections — rebuild-on-change. All three only care about the
  // settings that drive them, so short-circuit if unchanged.
  if (!prev ||
      prev.settings.statusLinePathStyle !== state.settings.statusLinePathStyle ||
      prev.settings.statusLineMaxPath   !== state.settings.statusLineMaxPath) {
    renderPathStyle(state);
  }
  if (!prev ||
      prev.settings.statusLineBarStyle !== state.settings.statusLineBarStyle ||
      prev.settings.statusLineCompact  !== state.settings.statusLineCompact) {
    renderStatusLineLook(state);
  }
  renderPreview(state);
  if (!prev ||
      prev.settings.maxLines              !== state.settings.maxLines ||
      prev.settings.showPartialLineContext!== state.settings.showPartialLineContext ||
      JSON.stringify(prev.settings.excludedPatterns) !== JSON.stringify(state.settings.excludedPatterns)) {
    renderContextCard(state);
  }
  if (!prev || prev.settings.autoOpenModifiedFiles !== state.settings.autoOpenModifiedFiles) {
    renderAutoOpenCard(state);
  }
  if (!prev ||
      prev.settings.showInlineActions !== state.settings.showInlineActions) {
    renderCommandCenterCard(state);
  }

  applyDim(state);

  if (focusId) {
    const next = document.getElementById(focusId);
    if (next instanceof HTMLInputElement && isTextInput && inFlight !== null) {
      next.value = inFlight;
      next.focus();
      if (selStart !== null && selEnd !== null) {
        try { next.setSelectionRange(selStart, selEnd); } catch { /* noop */ }
      }
    } else if (next && typeof (next as HTMLElement).focus === "function") {
      (next as HTMLElement).focus();
    }
  }
}

function applyDim(state: State): void {
  const notSetup = !state.setupCompleted;
  const dim = (id: string, disabled: boolean): void => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("section-disabled", disabled);
  };
  dim("master-card",     notSetup);
  dim("preset-card",     notSetup);
  dim("statusline-card", notSetup || !state.settings.statusLine);
  dim("context-card",    notSetup || !state.settings.contextInjection);
  dim("autoopen-card",   notSetup);
}

// ---------- Hero ----------
function renderHero(state: State): void {
  const ver = document.getElementById("version");
  if (ver) ver.textContent = `v${state.version}`;
}

// ---------- Install card (rebuild; identity flips only on install/uninstall) ----------
function renderInstall(state: State): void {
  const root = document.getElementById("install-root");
  if (!root) return;
  root.innerHTML = "";
  const badge = document.createElement("div");
  badge.className = "cb-install-badge";
  const dot = document.createElement("span");
  dot.className = "dot" + (state.setupCompleted ? "" : " off");
  const text = document.createElement("span");
  text.className = "text";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cb-btn ghost";
  if (state.setupCompleted) {
    text.textContent = "Installed at User";
    btn.textContent = "Uninstall";
    btn.addEventListener("click", () => post({ type: "uninstall" }));
  } else {
    text.textContent = "Not installed";
    btn.textContent = "Install at User scope";
    btn.classList.remove("ghost");
    btn.classList.add("primary");
    btn.addEventListener("click", () => post({ type: "install" }));
  }
  badge.append(dot, text, btn);
  root.appendChild(badge);
}

// ---------- Master toggles (diff-render) ----------

interface MasterRowDef {
  key: "contextInjection" | "statusLine" | "autoOpenModifiedFiles";
  label: string;
  desc: string;
}
const MASTER_ROWS: MasterRowDef[] = [
  { key: "contextInjection", label: "Context injection",
    desc: "Inject the current selection into Claude Code's context on every prompt." },
  { key: "statusLine", label: "Status line",
    desc: "Render the full status line in Claude Code with all enabled segments." },
  { key: "autoOpenModifiedFiles", label: "Auto-open edited files",
    desc: "When Claude edits a file via Edit / Write / MultiEdit, open it in VS Code." },
];

interface MasterRowNodes {
  row: HTMLDivElement;
  check: HTMLButtonElement;
}
const masterRowNodes = new Map<string, MasterRowNodes>();

function renderMasterToggles(state: State): void {
  const root = document.getElementById("master-rows");
  if (!root) return;
  if (masterRowNodes.size === 0) {
    for (const def of MASTER_ROWS) {
      const row = buildMasterRow(def);
      root.appendChild(row.row);
      masterRowNodes.set(def.key, row);
    }
  }
  for (const def of MASTER_ROWS) {
    const n = masterRowNodes.get(def.key);
    if (!n) continue;
    const on = Boolean(state.settings[def.key]);
    const cur = n.check.getAttribute("aria-checked") === "true";
    if (cur !== on) {
      n.check.classList.toggle("checked", on);
      n.check.setAttribute("aria-checked", String(on));
    }
  }
}

function buildMasterRow(def: MasterRowDef): MasterRowNodes {
  const row = document.createElement("div");
  row.className = "toggle-row";
  const sw = makeCheckbox(false, def.label, (next) => {
    post({ type: "setSetting", key: def.key, value: next });
  });
  sw.id = `f-${def.key}`;
  const text = document.createElement("div");
  text.className = "toggle-row__text";
  const l = document.createElement("div");
  l.className = "toggle-row__label";
  l.textContent = def.label;
  const d = document.createElement("div");
  d.className = "toggle-row__desc";
  d.textContent = def.desc;
  text.append(l, d);
  row.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).closest?.(".cb-check")) return;
    sw.click();
  });
  row.append(sw, text);
  return { row, check: sw };
}

// ---------- Preset dropdown ----------

interface PresetSelectS {
  select: HTMLSelectElement;
  desc: HTMLElement;
}
let presetSelectS: PresetSelectS | null = null;

function renderPresets(state: State): void {
  const row = document.getElementById("preset-row");
  if (!row) return;
  if (!presetSelectS) {
    row.innerHTML = "";
    const select = document.createElement("select");
    select.className = "cb-input";
    select.style.maxWidth = "260px";
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
    const desc = document.createElement("p");
    desc.className = "field-desc";
    desc.style.margin = "0";
    row.append(select, desc);
    presetSelectS = { select, desc };
  }
  const active = state.settings.activePreset;
  presetSelectS.select.value = active || "custom";
  const matched = state.presets.find((p) => p.id === active);
  presetSelectS.desc.textContent = matched ? matched.description : "Your own configuration.";
}

// ---------- Segment list (diff-render) ----------

interface SegmentNodesS {
  li: HTMLLIElement;
  check: HTMLButtonElement;
  meta: SegmentMeta;
}
const segNodesS = new Map<string, SegmentNodesS>();
let segBuiltS = false;

function renderSegments(state: State): void {
  const list = document.getElementById("segments-list");
  if (!list) return;
  if (!segBuiltS) {
    for (const m of state.segmentMeta) {
      segNodesS.set(m.id, buildSegmentNodeS(m));
    }
    segBuiltS = true;
  }
  for (let idx = 0; idx < state.segments.length; idx++) {
    const entry = state.segments[idx];
    const n = segNodesS.get(entry.id);
    if (!n) continue;
    if (list.children[idx] !== n.li) list.appendChild(n.li);
    n.li.dataset.index = String(idx);
    n.li.classList.toggle("on", entry.enabled);
    const cur = n.check.getAttribute("aria-checked") === "true";
    if (cur !== entry.enabled) {
      n.check.classList.toggle("checked", entry.enabled);
      n.check.setAttribute("aria-checked", String(entry.enabled));
    }
  }
}

function buildSegmentNodeS(meta: SegmentMeta): SegmentNodesS {
  const li = document.createElement("li");
  li.className = "segment";
  li.draggable = true;
  li.dataset.id = meta.id;

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

  const label = document.createElement("div");
  label.className = "segment-label";
  const title = document.createElement("div");
  title.className = "segment-title";
  title.textContent = meta.label;
  const desc = document.createElement("div");
  desc.className = "segment-desc";
  desc.textContent = meta.description;
  label.append(title, desc);

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

  return { li, check, meta };
}

// ---------- Path style (rebuild when path settings change) ----------

const PREVIEW_PATH = "src/components/widgets/Button.tsx";

function truncatePath(rel: string, maxLen: number): string {
  if (rel.length <= maxLen) return rel;
  const parts = rel.split("/");
  const fileName = parts[parts.length - 1];
  const available = maxLen - fileName.length - 4;
  if (available <= 0) return "…/" + fileName;
  return rel.slice(0, available) + "…/" + fileName;
}
function formatPreviewPath(style: string, maxLen: number): string {
  switch (style) {
    case "basename": return PREVIEW_PATH.split("/").pop() ?? PREVIEW_PATH;
    case "full":     return PREVIEW_PATH;
    case "truncated":
    default:         return truncatePath(PREVIEW_PATH, maxLen);
  }
}

function renderPathStyle(state: State): void {
  const root = document.getElementById("pathstyle-root");
  if (!root) return;
  root.innerHTML = "";

  const field = document.createElement("div");
  field.className = "field";
  const lbl = document.createElement("label");
  lbl.className = "field-label";
  lbl.textContent = "Status line path style";

  const picker = document.createElement("div");
  picker.className = "chip-picker";
  const options: Array<{ value: "basename" | "truncated" | "full"; label: string }> = [
    { value: "basename",  label: "File name"  },
    { value: "truncated", label: "Truncated" },
    { value: "full",      label: "Full path"  },
  ];
  const current = state.settings.statusLinePathStyle;
  for (const opt of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip-option" + (current === opt.value ? " active" : "");
    btn.textContent = opt.label;
    btn.addEventListener("click", () => {
      if (btn.classList.contains("active")) return;
      post({ type: "setSetting", key: "statusLinePathStyle", value: opt.value });
    });
    picker.appendChild(btn);
  }
  field.append(lbl, picker);
  root.appendChild(field);

  if (current === "truncated") {
    const lenField = document.createElement("div");
    lenField.className = "field";
    const lenLbl = document.createElement("label");
    lenLbl.className = "field-label";
    lenLbl.htmlFor = "f-statusLineMaxPath";
    lenLbl.textContent = "Max path length";
    const input = document.createElement("input");
    input.type = "number";
    input.id = "f-statusLineMaxPath";
    input.className = "cb-input";
    input.min = "10";
    input.max = "100";
    input.value = String(state.settings.statusLineMaxPath);
    let last = state.settings.statusLineMaxPath;
    const commit = () => {
      let n = Number(input.value);
      if (!Number.isFinite(n)) n = last;
      n = Math.max(10, Math.min(100, Math.round(n)));
      input.value = String(n);
      if (n === last) return;
      last = n;
      post({ type: "setSetting", key: "statusLineMaxPath", value: n });
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter")  { ev.preventDefault(); input.blur(); }
      if (ev.key === "Escape") { input.value = String(last); input.blur(); }
    });
    lenField.append(lenLbl, input);
    root.appendChild(lenField);
  }
}

// ---------- Bar style + compact mode ----------

function renderStatusLineLook(state: State): void {
  const root = document.getElementById("statusline-look");
  if (!root) return;
  root.innerHTML = "";

  // Bar style chip picker.
  const barField = document.createElement("div");
  barField.className = "field";
  const barLbl = document.createElement("label");
  barLbl.className = "field-label";
  barLbl.textContent = "Bar glyphs";
  const barPicker = document.createElement("div");
  barPicker.className = "chip-picker";
  const barOpts: Array<{ value: "blocks" | "squares" | "shades" | "dots"; label: string }> = [
    { value: "blocks",  label: "\u2588\u2591 Blocks"  },
    { value: "squares", label: "\u25A0\u25A1 Squares" },
    { value: "shades",  label: "\u2593\u2591 Shades"  },
    { value: "dots",    label: "\u25CF\u25CB Dots"    },
  ];
  const curBar = state.settings.statusLineBarStyle;
  for (const opt of barOpts) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip-option" + (curBar === opt.value ? " active" : "");
    btn.textContent = opt.label;
    btn.addEventListener("click", () => {
      if (btn.classList.contains("active")) return;
      post({ type: "setSetting", key: "statusLineBarStyle", value: opt.value });
    });
    barPicker.appendChild(btn);
  }
  barField.append(barLbl, barPicker);
  root.appendChild(barField);

  // Compact-mode toggle.
  const compactRow = document.createElement("div");
  compactRow.className = "toggle-row";
  const compactSw = makeCheckbox(state.settings.statusLineCompact, "Compact mode", (next) => {
    post({ type: "setSetting", key: "statusLineCompact", value: next });
  });
  const compactText = document.createElement("div");
  compactText.className = "toggle-row__text";
  const compactL = document.createElement("div");
  compactL.className = "toggle-row__label";
  compactL.textContent = "Compact mode";
  const compactD = document.createElement("div");
  compactD.className = "toggle-row__desc";
  compactD.textContent = "Drop the \u00B7 separators. Tighter spacing for narrow terminals.";
  compactText.append(compactL, compactD);
  compactRow.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).closest?.(".cb-check")) return;
    compactSw.click();
  });
  compactRow.append(compactSw, compactText);
  root.appendChild(compactRow);
}

// ---------- Preview (cheap innerHTML swap on every render) ----------

const BAR_GLYPHS_UI: Record<string, { full: string; empty: string }> = {
  blocks:  { full: "\u2588", empty: "\u2591" },
  squares: { full: "\u25A0", empty: "\u25A1" },
  shades:  { full: "\u2593", empty: "\u2591" },
  dots:    { full: "\u25CF", empty: "\u25CB" },
};

function renderPreview(state: State): void {
  const el = document.getElementById("preview-line");
  if (!el) return;
  const metaById = new Map(state.segmentMeta.map((m) => [m.id, m] as const));
  const enabled = state.segments
    .filter((s) => s.enabled)
    .map((s) => metaById.get(s.id))
    .filter((m): m is SegmentMeta => !!m);
  if (!state.settings.statusLine) {
    el.textContent = "Status line is off.";
    el.classList.add("muted");
    return;
  }
  if (enabled.length === 0) {
    el.textContent = "No segments enabled.";
    el.classList.add("muted");
    return;
  }
  el.classList.remove("muted");
  const sep = state.settings.statusLineCompact
    ? '<span class="sep-dim"> </span>'
    : '<span class="sep-dim" style="color:rgba(217,119,87,0.55)"> \u00b7 </span>';
  el.innerHTML =
    '<span style="color:rgba(217,119,87,0.55)">\u2731</span> ' +
    enabled.map((m) => renderSegmentColored(m, state)).join(sep);
}

function renderSegmentColored(meta: SegmentMeta, state: State): string {
  const glyph = BAR_GLYPHS_UI[state.settings.statusLineBarStyle] ?? BAR_GLYPHS_UI.blocks;
  const barPreview = glyph.full.repeat(2) + glyph.empty.repeat(8);
  switch (meta.id) {
    case "model":            return `<span class="ansi-bold">${escapeHtml(meta.example)}</span>`;
    case "gitBranch":        return `<span class="ansi-cyan">${escapeHtml(meta.example)}</span>`;
    case "contextBar":       return `<span class="ansi-green">${escapeHtml(barPreview)}</span>`;
    case "contextPercentage":return `<span class="ansi-green">24%</span>`;
    case "tokensUsed":       return `<span class="ansi-dim">45k</span>`;
    case "cost":             return `<span class="ansi-dim">$0.12</span>`;
    case "linesChanged":     return `<span class="ansi-green">+42</span> <span class="ansi-red">\u22123</span>`;
    case "rateLimits":       return `<span class="ansi-dim">${escapeHtml(meta.example)}</span>`;
    case "selection": {
      const p = formatPreviewPath(state.settings.statusLinePathStyle, state.settings.statusLineMaxPath);
      return `<span class="ansi-orange ansi-bold">${escapeHtml(p)}</span> <span class="ansi-orange">L12\u201345</span> <span class="ansi-dim">(34)</span>`;
    }
    default: return escapeHtml(meta.example);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
          .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------- Context-injection card ----------

function renderContextCard(state: State): void {
  const root = document.getElementById("context-fields");
  if (!root) return;
  root.innerHTML = "";

  // --- Max lines (half-width number + preview underneath) ---
  const maxField = document.createElement("div");
  maxField.className = "field";
  const maxLbl = document.createElement("label");
  maxLbl.className = "field-label";
  maxLbl.htmlFor = "f-maxLines";
  maxLbl.textContent = "Max lines";
  const maxInput = document.createElement("input");
  maxInput.type = "number";
  maxInput.id = "f-maxLines";
  maxInput.className = "cb-input";
  maxInput.min = "1";
  maxInput.max = "5000";
  maxInput.value = String(state.settings.maxLines);
  maxInput.style.maxWidth = "160px";
  let lastMax = state.settings.maxLines;
  const commitMax = () => {
    let n = Number(maxInput.value);
    if (!Number.isFinite(n)) n = lastMax;
    n = Math.max(1, Math.min(5000, Math.round(n)));
    maxInput.value = String(n);
    if (n === lastMax) return;
    lastMax = n;
    post({ type: "setSetting", key: "maxLines", value: n });
  };
  maxInput.addEventListener("blur", commitMax);
  maxInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter")  { ev.preventDefault(); maxInput.blur(); }
    if (ev.key === "Escape") { maxInput.value = String(lastMax); maxInput.blur(); }
  });
  const maxDesc = document.createElement("div");
  maxDesc.className = "field-desc";
  maxDesc.textContent =
    "Selections longer than this are cut off — Claude only sees the first N lines and a \u201C(truncated, X more lines)\u201D marker. The extra lines never leave your machine.";
  const maxPreview = buildMaxLinesPreview(state.settings.maxLines);
  maxField.append(maxLbl, maxInput, maxDesc, maxPreview);
  root.appendChild(maxField);

  // --- Show partial line (toggle + preview) ---
  const partialField = document.createElement("div");
  partialField.className = "field";
  const partialRow = buildToggleRow(
    "f-showPartial",
    "showPartialLineContext",
    "Show partial line context",
    "For partial-line selections, include the surrounding line with caret markers so Claude sees which identifier you meant.",
    state.settings.showPartialLineContext,
  );
  partialField.appendChild(partialRow);
  partialField.appendChild(buildPartialLinePreview(state.settings.showPartialLineContext));
  root.appendChild(partialField);

  // --- Include diagnostics ---
  const diagField = document.createElement("div");
  diagField.className = "field";
  const diagRow = buildToggleRow(
    "f-includeDiag",
    "includeDiagnostics",
    "Include diagnostics",
    "If the selection has a red or yellow squiggle (TypeScript error, ESLint warning, linter complaint), attach the diagnostic message to the injected context. Lets you ask \u201Cwhy does this break?\u201D without pasting the error yourself.",
    state.settings.includeDiagnostics,
  );
  diagField.appendChild(diagRow);
  diagField.appendChild(buildDiagnosticsPreview(state.settings.includeDiagnostics));
  root.appendChild(diagField);

  // --- Multi-cursor ---
  const multiField = document.createElement("div");
  multiField.className = "field";
  const multiRow = buildToggleRow(
    "f-multiCursor",
    "multiCursorSelection",
    "Multi-cursor selections",
    "When you have more than one cursor active, bundle every selected region into the injected context. Off: only the primary cursor is sent.",
    state.settings.multiCursorSelection,
  );
  multiField.appendChild(multiRow);
  multiField.appendChild(buildMultiCursorPreview(state.settings.multiCursorSelection));
  root.appendChild(multiField);

  // --- Pinned context ---
  const pinField = document.createElement("div");
  pinField.className = "field";
  const pinRow = buildToggleRow(
    "f-pinned",
    "pinnedContextEnabled",
    "Pinned context",
    "Keep pinned selections in Claude\u2019s context on every prompt until unpinned. Pin with \u2318\u21E7\u2325P (Mac) / Ctrl+\u21E7Alt+P (Win/Linux) after selecting code. Off: pins are kept on disk but not injected.",
    state.settings.pinnedContextEnabled,
  );
  pinField.appendChild(pinRow);
  pinField.appendChild(buildPinPreview());
  root.appendChild(pinField);

  // --- Excluded patterns ---
  const excField = document.createElement("div");
  excField.className = "field";
  const lbl = document.createElement("label");
  lbl.className = "field-label";
  lbl.textContent = "Excluded patterns";
  const desc = document.createElement("div");
  desc.className = "field-desc";
  desc.textContent = "Globs that match excluded files. Selections in matching files are never sent to Claude.";
  const list = document.createElement("div");
  list.className = "chip-list";
  for (const pattern of state.settings.excludedPatterns) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = pattern;
    const rem = document.createElement("button");
    rem.type = "button";
    rem.title = "Remove pattern";
    rem.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.4" fill="none"><path d="M2 2l6 6M8 2l-6 6"/></svg>';
    rem.addEventListener("click", () => {
      const next = state.settings.excludedPatterns.filter((p) => p !== pattern);
      post({ type: "setSetting", key: "excludedPatterns", value: next });
    });
    chip.appendChild(rem);
    list.appendChild(chip);
  }
  const addInput = document.createElement("input");
  addInput.type = "text";
  addInput.className = "cb-input";
  addInput.placeholder = "Add pattern and press Enter…";
  addInput.style.maxWidth = "220px";
  addInput.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    const v = addInput.value.trim();
    if (!v) return;
    if (state.settings.excludedPatterns.includes(v)) { addInput.value = ""; return; }
    const next = [...state.settings.excludedPatterns, v];
    post({ type: "setSetting", key: "excludedPatterns", value: next });
    addInput.value = "";
  });
  list.appendChild(addInput);
  excField.append(lbl, desc, list);
  root.appendChild(excField);
}

/** Inline toggle row — used for settings that want a preview under them. */
function buildToggleRow(
  id: string,
  key: keyof Settings,
  label: string,
  desc: string,
  value: boolean,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "toggle-row";
  const sw = makeCheckbox(value, label, (next) => {
    post({ type: "setSetting", key, value: next });
  });
  sw.id = id;
  const text = document.createElement("div");
  text.className = "toggle-row__text";
  const l = document.createElement("div");
  l.className = "toggle-row__label";
  l.textContent = label;
  const d = document.createElement("div");
  d.className = "toggle-row__desc";
  d.textContent = desc;
  text.append(l, d);
  row.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).closest?.(".cb-check")) return;
    sw.click();
  });
  row.append(sw, text);
  return row;
}

function buildMaxLinesPreview(maxLines: number): HTMLElement {
  const box = document.createElement("div");
  box.className = "partial-preview";
  const sample = Math.min(3, maxLines);
  const truncatedBy = 742 - maxLines; // hypothetical 742-line selection
  const lines: string[] = [];
  lines.push('<span class="tag">selection &gt; max</span>');
  lines.push('<span class="path">long-file.ts:1-' + maxLines + ' (' + maxLines + ' lines)</span>');
  lines.push('<span class="fence">```</span>');
  for (let i = 1; i <= sample; i++) lines.push(`line ${i}`);
  if (maxLines > sample) lines.push(`<span class="note">… ${maxLines - sample} more lines …</span>`);
  if (truncatedBy > 0) {
    lines.push(`<span class="note">… (truncated, ${truncatedBy} more lines)</span>`);
  }
  lines.push('<span class="fence">```</span>');
  box.innerHTML = lines.join("\n");
  return box;
}

function buildDiagnosticsPreview(on: boolean): HTMLElement {
  const box = document.createElement("div");
  box.className = "partial-preview";
  const lines: string[] = [];
  lines.push(`<span class="tag">diagnostics \u00B7 ${on ? "on" : "off"}</span>`);
  lines.push('<span class="path">app.ts:12-15 (4 lines)</span>');
  lines.push('<span class="fence">```</span>');
  lines.push('function greet(name) {');
  lines.push('  return "Hello, " + <span class="selected">user</span>;');
  lines.push('}');
  lines.push('<span class="fence">```</span>');
  if (on) {
    lines.push('');
    lines.push('<span class="note">Diagnostics on this range:</span>');
    lines.push('  - [error] line 13 (ts): <span class="caret">Cannot find name \u2018user\u2019. Did you mean \u2018name\u2019?</span>');
  }
  box.innerHTML = lines.join("\n");
  return box;
}

function buildMultiCursorPreview(on: boolean): HTMLElement {
  const box = document.createElement("div");
  box.className = "partial-preview";
  const lines: string[] = [];
  lines.push(`<span class="tag">multi-cursor \u00B7 ${on ? "bundled" : "primary only"}</span>`);
  if (on) {
    lines.push('=== Multi-cursor selection (3 regions) ===');
    lines.push('');
    lines.push('<span class="path">app.ts:42 (1 line)</span>');
    lines.push('<span class="fence">```</span>');
    lines.push('  <span class="selected">const user = getUser(id);</span>');
    lines.push('<span class="fence">```</span>');
    lines.push('<span class="path">app.ts:78 (1 line)</span>');
    lines.push('<span class="fence">```</span>');
    lines.push('  <span class="selected">const user = authUser();</span>');
    lines.push('<span class="fence">```</span>');
    lines.push('<span class="path">app.ts:112 (1 line)</span>');
    lines.push('<span class="fence">```</span>');
    lines.push('  <span class="selected">const user = req.user;</span>');
    lines.push('<span class="fence">```</span>');
  } else {
    lines.push('<span class="path">app.ts:42 (1 line)</span>');
    lines.push('<span class="fence">```</span>');
    lines.push('  <span class="selected">const user = getUser(id);</span>');
    lines.push('<span class="fence">```</span>');
    lines.push('<span class="note">(Other cursors ignored.)</span>');
  }
  box.innerHTML = lines.join("\n");
  return box;
}

function buildPinPreview(): HTMLElement {
  const box = document.createElement("div");
  box.className = "partial-preview";
  const lines: string[] = [
    '<span class="tag">pinned + live</span>',
    '=== Pinned context (2 pins) ===',
    '<span class="path">schema.ts:1-40 (40 lines) \u2014 current schema</span>',
    '<span class="fence">```</span>',
    'export interface User { \u2026 }',
    '<span class="fence">```</span>',
    '<span class="path">config.ts:10-18 (9 lines) \u2014 feature flags</span>',
    '<span class="fence">```</span>',
    'export const FLAGS = { \u2026 }',
    '<span class="fence">```</span>',
    '',
    '<span class="path">auth.ts:112 (1 line)  \u2190 live selection</span>',
    '<span class="fence">```</span>',
    '  <span class="selected">validateToken(req.user)</span>',
    '<span class="fence">```</span>',
  ];
  box.innerHTML = lines.join("\n");
  return box;
}

function buildPartialLinePreview(showPartial: boolean): HTMLElement {
  const box = document.createElement("div");
  box.className = "partial-preview";
  const lines: string[] = [];
  if (showPartial) {
    lines.push('<span class="tag">partial line · on</span>');
    lines.push('<span class="path">app.ts#L12 (partial)</span>');
    lines.push('<span class="fence">```</span>');
    lines.push('  console.log(<span class="selected">"print"</span>);');
    lines.push('              <span class="caret">^^^^^^^</span>');
    lines.push('<span class="fence">```</span>');
    lines.push('<span class="note">Selected text:</span> <span class="selected">"print"</span>');
  } else {
    lines.push('<span class="tag">partial line · off</span>');
    lines.push('<span class="path">app.ts:12-12 (1 lines)</span>');
    lines.push('<span class="fence">```</span>');
    lines.push('<span class="selected">"print"</span>');
    lines.push('<span class="fence">```</span>');
  }
  box.innerHTML = lines.join("\n");
  return box;
}

// ---------- Claude edits review card ----------

// ---------- Command Center card ----------

function renderCommandCenterCard(state: State): void {
  const root = document.getElementById("command-center-root");
  if (!root) return;
  root.innerHTML = "";

  // Inline lightbulb toggle — primary entry point for all actions.
  const bulbField = document.createElement("div");
  bulbField.className = "field";
  bulbField.appendChild(buildToggleRow(
    "f-showInlineActions",
    "showInlineActions",
    "Inline actions in the editor lightbulb",
    "Place your cursor or make a selection, click the 💡 that appears, and pick any Claude Bridge action. Selection-aware: Pin / Preview show up when a selection exists; Inject symbol / Send git diff / Command Center are always available.",
    state.settings.showInlineActions,
  ));
  root.appendChild(bulbField);

}

function buildCommandCenterMock(): HTMLElement {
  const box = document.createElement("div");
  box.className = "partial-preview";
  const lines: string[] = [
    '<span class="tag">command center \u00B7 mock</span>',
    '<span class="path">Claude Bridge \u00B7 quick actions</span>',
    '  \u26A1 Inject current symbol                   <span class="note">\u2318\u21E7I</span>',
    '  \uD83D\uDCCC Pin current selection                   <span class="note">\u2318\u21E7\u2325P</span>',
    '  \u21C4 Send git diff to Claude                 <span class="note">\u2318\u21E7\u2325G</span>',
    '  \uD83D\uDCCC Pinned selections                        <span class="note">2 pinned</span>',
    '  \u27F3 Recent selections                        <span class="note">6 recent</span>',
    '  \u270E Claude\u2019s edits this session              <span class="note">3 files</span>',
  ];
  box.innerHTML = lines.join("\n");
  return box;
}

function buildSessionStripMock(): HTMLElement {
  const box = document.createElement("div");
  box.className = "partial-preview";
  box.innerHTML = [
    '<span class="tag">sidebar header \u00B7 mock</span>',
    '  <span class="selected">47</span>  selections sent  <span class="caret">\u00B7</span>  <span class="selected">8</span>  files Claude edited  <span class="caret">\u00B7</span>  <span class="selected">2</span>  pinned',
  ].join("\n");
  return box;
}

function buildKbdTable(isMac: boolean): HTMLElement {
  const rows: Array<[string, string]> = [
    ["Inject current symbol", isMac ? "\u2318\u21E7I" : "Ctrl+\u21E7I"],
    ["Pin / unpin selection", isMac ? "\u2318\u21E7\u2325P" : "Ctrl+\u21E7Alt+P"],
    ["Send git diff to Claude", isMac ? "\u2318\u21E7\u2325G" : "Ctrl+\u21E7Alt+G"],
    ["Open Command Center", isMac ? "\u2318\u21E7\u2325C" : "Ctrl+\u21E7Alt+C"],
  ];
  const wrap = document.createElement("div");
  wrap.className = "kbd-table";
  for (const [label, key] of rows) {
    const row = document.createElement("div");
    row.className = "kbd-row";
    const l = document.createElement("span");
    l.textContent = label;
    const k = document.createElement("kbd");
    k.textContent = key;
    row.append(l, k);
    wrap.appendChild(row);
  }
  return wrap;
}

// ---------- Auto-open card ----------
function renderAutoOpenCard(state: State): void {
  const root = document.getElementById("autoopen-root");
  if (!root) return;
  root.innerHTML = "";
  const def: MasterRowDef = {
    key: "autoOpenModifiedFiles",
    label: "Auto-open edited files",
    desc: "Open any file Claude edits in VS Code, so you see the change immediately.",
  };
  const built = buildMasterRow(def);
  // Sync state to existing master-row node for this key so diff stays aligned.
  built.check.classList.toggle("checked", state.settings.autoOpenModifiedFiles);
  built.check.setAttribute("aria-checked", String(state.settings.autoOpenModifiedFiles));
  root.appendChild(built.row);
}

// ---------- Field helpers ----------
function numberField(
  id: string,
  key: keyof Settings,
  label: string,
  desc: string,
  value: number,
  min: number,
  max: number,
): HTMLElement {
  const field = document.createElement("div");
  field.className = "field";
  const l = document.createElement("label");
  l.className = "field-label";
  l.htmlFor = id;
  l.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.id = id;
  input.className = "cb-input";
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  let last = value;
  const commit = () => {
    let n = Number(input.value);
    if (!Number.isFinite(n)) n = last;
    n = Math.max(min, Math.min(max, Math.round(n)));
    input.value = String(n);
    if (n === last) return;
    last = n;
    post({ type: "setSetting", key, value: n });
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter")  { ev.preventDefault(); input.blur(); }
    if (ev.key === "Escape") { input.value = String(last); input.blur(); }
  });
  const d = document.createElement("div");
  d.className = "field-desc";
  d.textContent = desc;
  field.append(l, input, d);
  return field;
}

function selectField(
  id: string,
  key: keyof Settings,
  label: string,
  desc: string,
  value: string,
  options: Array<{ value: string; label: string }>,
): HTMLElement {
  const field = document.createElement("div");
  field.className = "field";
  const l = document.createElement("label");
  l.className = "field-label";
  l.htmlFor = id;
  l.textContent = label;
  const sel = document.createElement("select");
  sel.className = "cb-input";
  sel.id = id;
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === value) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => {
    const v = sel.value;
    const parsed = v === "true" ? true : v === "false" ? false : v;
    post({ type: "setSetting", key, value: parsed });
  });
  const d = document.createElement("div");
  d.className = "field-desc";
  d.textContent = desc;
  field.append(l, sel, d);
  return field;
}

// ---------- Actions ----------
document.getElementById("export-btn")?.addEventListener("click", () => post({ type: "exportPreset" }));
document.getElementById("import-btn")?.addEventListener("click", () => post({ type: "importPreset" }));
document.getElementById("how-dismiss")?.addEventListener("click", () => {
  document.getElementById("how-it-works")?.classList.add("hidden");
  post({ type: "dismissHowItWorks" });
});

// ---------- IPC ----------
window.addEventListener("message", (ev: MessageEvent) => {
  const msg = ev.data as { type?: string; state?: State };
  if (msg && msg.type === "state" && msg.state) {
    const t0 = performance.now();
    render(msg.state);
    const ms = performance.now() - t0;
    post({ type: "perf", label: "settings.render", ms });
  }
});

post({ type: "ready" });
