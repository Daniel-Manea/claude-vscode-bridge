// Claude Bridge full settings panel.
export {};

interface SegmentEntry {
  id: string;
  enabled: boolean;
}
interface SegmentMeta {
  id: string;
  label: string;
  description: string;
  example: string;
}
interface PresetSummary {
  id: string;
  label: string;
  description: string;
}
interface Settings {
  enabled: boolean;
  contextInjection: boolean;
  statusLine: boolean;
  autoSetup: boolean;
  maxLines: number;
  debounceMs: number;
  statusLineMaxPath: number;
  statusLinePathStyle: "basename" | "truncated" | "full";
  contextPrefix: string;
  showPartialLineContext: boolean;
  settingsTarget: "user" | "project" | "projectLocal" | "ask";
  activePreset: string;
  [k: string]: unknown;
}
interface State {
  version: string;
  settings: Settings;
  segments: SegmentEntry[];
  segmentMeta: SegmentMeta[];
  presets: PresetSummary[];
  selection: unknown;
}

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
let currentState: State | null = null;
let dragFromIdx: number | null = null;

function post(msg: unknown): void {
  vscode.postMessage(msg);
}

function render(state: State): void {
  // Capture focus so it survives the re-render. Without this, typing in a text
  // field is interrupted whenever any setting change broadcasts new state.
  const active = document.activeElement as HTMLElement | null;
  const focusId = active?.id ?? null;
  const isTextInput =
    active instanceof HTMLInputElement && active.type === "text";
  const inFlightValue = isTextInput ? active.value : null;
  const selStart = isTextInput ? active.selectionStart : null;
  const selEnd = isTextInput ? active.selectionEnd : null;

  currentState = state;
  (document.getElementById("version") as HTMLElement).textContent = `v${state.version}`;
  renderCore(state);
  renderBehavior(state);
  renderContent(state);
  renderSegments(state);
  renderPresets(state);
  renderIntegration(state);
  renderPreview(state);

  if (focusId) {
    const next = document.getElementById(focusId);
    if (next instanceof HTMLInputElement && next.type === "text" && inFlightValue !== null) {
      next.value = inFlightValue;
      next.focus();
      if (selStart !== null && selEnd !== null) {
        try { next.setSelectionRange(selStart, selEnd); } catch { /* noop */ }
      }
    } else if (next && typeof (next as HTMLElement).focus === "function") {
      (next as HTMLElement).focus();
    }
  }
}

// ---------- Helpers ----------
function toggleField(
  id: string,
  key: keyof Settings,
  label: string,
  description: string,
  value: boolean,
): HTMLElement {
  const row = document.createElement("label");
  row.className = "field toggle-field";
  row.htmlFor = id;
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.id = id;
  cb.checked = value;
  cb.addEventListener("change", () => post({ type: "setSetting", key, value: cb.checked }));
  const text = document.createElement("div");
  text.className = "field-text";
  const labelEl = document.createElement("div");
  labelEl.className = "field-label";
  labelEl.textContent = label;
  const descEl = document.createElement("div");
  descEl.className = "field-desc";
  descEl.textContent = description;
  text.append(labelEl, descEl);
  row.append(cb, text);
  return row;
}

function numberField(
  id: string,
  key: keyof Settings,
  label: string,
  description: string,
  value: number,
  min: number,
  max: number,
  suffix: string,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "field number-field";
  const top = document.createElement("div");
  top.className = "field-top";
  const labelEl = document.createElement("label");
  labelEl.className = "field-label";
  labelEl.htmlFor = id;
  labelEl.textContent = label;
  const valueEl = document.createElement("span");
  valueEl.className = "field-value";
  valueEl.textContent = `${value}${suffix ? ` ${suffix}` : ""}`;
  top.append(labelEl, valueEl);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.id = id;
  slider.min = String(min);
  slider.max = String(max);
  slider.value = String(value);
  slider.addEventListener("input", () => {
    valueEl.textContent = `${slider.value}${suffix ? ` ${suffix}` : ""}`;
  });
  slider.addEventListener("change", () =>
    post({ type: "setSetting", key, value: Number(slider.value) }),
  );

  const descEl = document.createElement("div");
  descEl.className = "field-desc";
  descEl.textContent = description;

  row.append(top, slider, descEl);
  return row;
}

function textField(
  id: string,
  key: keyof Settings,
  label: string,
  description: string,
  value: string,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "field text-field";
  const labelEl = document.createElement("label");
  labelEl.className = "field-label";
  labelEl.htmlFor = id;
  labelEl.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  input.id = id;
  input.value = value;
  let lastCommitted = value;
  const commit = () => {
    if (input.value === lastCommitted) return;
    lastCommitted = input.value;
    post({ type: "setSetting", key, value: input.value });
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      input.blur();
    } else if (ev.key === "Escape") {
      input.value = lastCommitted;
      input.blur();
    }
  });
  const descEl = document.createElement("div");
  descEl.className = "field-desc";
  descEl.textContent = description;
  row.append(labelEl, input, descEl);
  return row;
}

function radioGroup(
  name: string,
  key: keyof Settings,
  label: string,
  description: string,
  value: string,
  options: Array<{ value: string; label: string; description?: string }>,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "field radio-field";
  const labelEl = document.createElement("div");
  labelEl.className = "field-label";
  labelEl.textContent = label;
  const descEl = document.createElement("div");
  descEl.className = "field-desc";
  descEl.textContent = description;
  row.append(labelEl, descEl);
  const group = document.createElement("div");
  group.className = "radio-group";
  for (const opt of options) {
    const id = `${name}-${opt.value}`;
    const item = document.createElement("label");
    item.className = "radio-item";
    item.htmlFor = id;
    const input = document.createElement("input");
    input.type = "radio";
    input.id = id;
    input.name = name;
    input.value = opt.value;
    input.checked = value === opt.value;
    input.addEventListener("change", () => {
      if (input.checked) post({ type: "setSetting", key, value: opt.value });
    });
    const content = document.createElement("div");
    content.className = "radio-content";
    const optLabel = document.createElement("div");
    optLabel.className = "radio-label";
    optLabel.textContent = opt.label;
    content.appendChild(optLabel);
    if (opt.description) {
      const optDesc = document.createElement("div");
      optDesc.className = "radio-desc";
      optDesc.textContent = opt.description;
      content.appendChild(optDesc);
    }
    item.append(input, content);
    group.appendChild(item);
  }
  row.appendChild(group);
  return row;
}

// ---------- Section renderers ----------
function renderCore(state: State): void {
  const root = document.getElementById("coreFields")!;
  root.innerHTML = "";
  root.append(
    toggleField("f-enabled", "enabled", "Enable bridge", "Master switch. When off, no files are written.", state.settings.enabled),
    toggleField("f-contextInjection", "contextInjection", "Context injection", "Inject selected code into Claude's context on every prompt.", state.settings.contextInjection),
    toggleField("f-statusLine", "statusLine", "Status line", "Show the current selection in Claude CLI's status bar.", state.settings.statusLine),
    toggleField("f-autoSetup", "autoSetup", "Auto-setup Claude Code", "On activation, merge the bridge config into Claude Code's settings.json.", state.settings.autoSetup),
  );
}

function renderBehavior(state: State): void {
  const root = document.getElementById("behaviorFields")!;
  root.innerHTML = "";
  root.append(
    numberField("f-maxLines", "maxLines", "Max lines", "Selections larger than this are truncated before being sent to Claude.", state.settings.maxLines, 1, 5000, "lines"),
    numberField("f-debounceMs", "debounceMs", "Debounce", "How long to wait before writing the selection after the user stops changing it.", state.settings.debounceMs, 10, 500, "ms"),
    numberField("f-statusLineMaxPath", "statusLineMaxPath", "Status line max path", "Maximum length for file paths shown in the status line; longer paths are truncated.", state.settings.statusLineMaxPath, 10, 100, "chars"),
  );
}

function renderContent(state: State): void {
  const root = document.getElementById("contentFields")!;
  root.innerHTML = "";
  root.append(
    textField("f-contextPrefix", "contextPrefix", "Prefix", "Shown before the file in the Claude CLI status line and in the injected context block.", state.settings.contextPrefix),
    radioGroup(
      "statusLinePathStyle",
      "statusLinePathStyle",
      "Status line path style",
      "How the file path renders in the Claude CLI status line.",
      state.settings.statusLinePathStyle,
      [
        { value: "basename", label: "File name only", description: "e.g., file.ts" },
        { value: "truncated", label: "Truncated path", description: "Uses Status Line Max Path; e.g., src/.../file.ts" },
        { value: "full", label: "Full relative path", description: "e.g., src/components/file.ts" },
      ],
    ),
    toggleField("f-showPartialLineContext", "showPartialLineContext", "Show partial line context", "For partial single-line selections, show the full line with caret markers.", state.settings.showPartialLineContext),
  );
}

function renderSegments(state: State): void {
  const list = document.getElementById("segmentsList")!;
  list.innerHTML = "";
  const metaById = new Map(state.segmentMeta.map((m) => [m.id, m] as const));
  for (let idx = 0; idx < state.segments.length; idx++) {
    const entry = state.segments[idx];
    const meta = metaById.get(entry.id);
    if (!meta) continue;
    const li = document.createElement("li");
    li.className = "segment" + (entry.enabled ? " on" : "");
    li.draggable = true;
    li.dataset.index = String(idx);
    li.dataset.id = entry.id;

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "\u2630";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = entry.enabled;
    cb.setAttribute("aria-label", meta.label);
    cb.addEventListener("change", () => {
      if (!currentState) return;
      const next = currentState.segments.map((s) =>
        s.id === entry.id ? { ...s, enabled: cb.checked } : s,
      );
      post({ type: "setSegments", segments: next });
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

    li.append(handle, cb, label, example);
    bindDnd(li);
    list.appendChild(li);
  }
}

function bindDnd(el: HTMLElement): void {
  el.addEventListener("dragstart", (ev) => {
    dragFromIdx = Number(el.dataset.index);
    el.classList.add("dragging");
    if (ev.dataTransfer) {
      ev.dataTransfer.setData("text/plain", String(dragFromIdx));
      ev.dataTransfer.effectAllowed = "move";
    }
  });
  el.addEventListener("dragend", () => {
    el.classList.remove("dragging");
    dragFromIdx = null;
    document
      .querySelectorAll(".segment.drag-over")
      .forEach((n) => n.classList.remove("drag-over"));
  });
  el.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
    el.classList.add("drag-over");
  });
  el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
  el.addEventListener("drop", (ev) => {
    ev.preventDefault();
    el.classList.remove("drag-over");
    if (!currentState || dragFromIdx === null) return;
    const toIdx = Number(el.dataset.index);
    if (dragFromIdx === toIdx) return;
    const next = currentState.segments.slice();
    const [moved] = next.splice(dragFromIdx, 1);
    next.splice(toIdx, 0, moved);
    post({ type: "setSegments", segments: next });
  });
}

function renderPresets(state: State): void {
  const chips = document.getElementById("presetChips")!;
  chips.innerHTML = "";
  const active = state.settings.activePreset;
  for (const p of state.presets) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "preset-chip" + (p.id === active ? " active" : "");
    chip.title = p.description;
    const label = document.createElement("span");
    label.className = "preset-chip-label";
    label.textContent = p.label;
    const desc = document.createElement("span");
    desc.className = "preset-chip-desc";
    desc.textContent = p.description;
    chip.append(label, desc);
    chip.addEventListener("click", () => post({ type: "applyPreset", presetId: p.id }));
    chips.appendChild(chip);
  }
  if (active === "custom") {
    const chip = document.createElement("div");
    chip.className = "preset-chip custom active";
    const label = document.createElement("span");
    label.className = "preset-chip-label";
    label.textContent = "Custom";
    const desc = document.createElement("span");
    desc.className = "preset-chip-desc";
    desc.textContent = "Your own configuration.";
    chip.append(label, desc);
    chips.appendChild(chip);
  }
}

function renderIntegration(state: State): void {
  const root = document.getElementById("integrationFields")!;
  root.innerHTML = "";
  root.append(
    radioGroup(
      "settingsTarget",
      "settingsTarget",
      "Where to write Claude Code config",
      "Controls which settings.json the bridge updates during auto-setup or Re-run setup.",
      state.settings.settingsTarget,
      [
        { value: "user", label: "User settings", description: "~/.claude/settings.json \u2014 applies to all projects (recommended)." },
        { value: "project", label: "Project settings", description: ".claude/settings.json \u2014 project only, shared via git." },
        { value: "projectLocal", label: "Project local settings", description: ".claude/settings.local.json \u2014 project only, gitignored." },
        { value: "ask", label: "Ask each time", description: "Prompt when running setup." },
      ],
    ),
  );
}

function renderPreview(state: State): void {
  const el = document.getElementById("previewLine")!;
  const metaById = new Map(state.segmentMeta.map((m) => [m.id, m] as const));
  const enabled = state.segments
    .filter((s) => s.enabled)
    .map((s) => metaById.get(s.id))
    .filter((m): m is SegmentMeta => !!m);
  if (!state.settings.statusLine) {
    el.textContent = "(status line disabled)";
    el.classList.add("muted");
    return;
  }
  if (enabled.length === 0) {
    el.textContent = "(no segments enabled)";
    el.classList.add("muted");
    return;
  }
  el.classList.remove("muted");
  el.textContent = enabled.map((m) => m.example).join("  \u2502  ");
}

// ---------- Actions ----------
document.getElementById("exportBtn")?.addEventListener("click", () => post({ type: "exportPreset" }));
document.getElementById("importBtn")?.addEventListener("click", () => post({ type: "importPreset" }));
document.getElementById("setupBtn")?.addEventListener("click", () => post({ type: "runSetup" }));
document
  .getElementById("removeConfigBtn")
  ?.addEventListener("click", () => post({ type: "removeConfig" }));

// ---------- IPC ----------
window.addEventListener("message", (ev: MessageEvent) => {
  const msg = ev.data as { type?: string; state?: State };
  if (msg && msg.type === "state" && msg.state) {
    render(msg.state);
  }
});

post({ type: "ready" });
