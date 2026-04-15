// Claude Bridge sidebar webview controller.
// Compiled standalone; does not share modules with the extension side.
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
interface State {
  version: string;
  settings: {
    enabled: boolean;
    contextInjection: boolean;
    statusLine: boolean;
    activePreset: string;
    [k: string]: unknown;
  };
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

console.log("[claude-bridge sidebar] script loaded");

function post(msg: unknown): void {
  console.log("[claude-bridge sidebar] post", msg);
  vscode.postMessage(msg);
}

function render(state: State): void {
  currentState = state;
  renderStatusGrid(state);
  renderPresets(state);
  renderSegments(state);
}

function renderStatusGrid(state: State): void {
  const grid = document.getElementById("statusGrid");
  if (!grid) return;
  const rows: Array<{ key: string; label: string; on: boolean }> = [
    { key: "enabled", label: "Bridge", on: state.settings.enabled },
    { key: "contextInjection", label: "Context Injection", on: state.settings.contextInjection },
    { key: "statusLine", label: "Status Line", on: state.settings.statusLine },
  ];
  grid.innerHTML = "";
  for (const row of rows) {
    // Use a label+hidden-checkbox pattern so the whole row is clickable
    // via the checkbox's implicit label association — sidesteps any
    // <button>-vs-webview-event quirks we were seeing.
    const wrap = document.createElement("label");
    wrap.className = "status-row" + (row.on ? " on" : " off");
    wrap.title = `Click to ${row.on ? "disable" : "enable"} ${row.label}`;

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "status-row-input";
    cb.checked = row.on;
    cb.setAttribute("aria-label", row.label);
    cb.addEventListener("change", () => {
      console.log("[claude-bridge sidebar] status toggle", row.key, "->", cb.checked);
      post({ type: "setSetting", key: row.key, value: cb.checked });
    });

    const dot = document.createElement("span");
    dot.className = "dot";
    const labelEl = document.createElement("span");
    labelEl.className = "label";
    labelEl.textContent = row.label;
    const stateEl = document.createElement("span");
    stateEl.className = "state";
    stateEl.textContent = row.on ? "On" : "Off";

    wrap.append(cb, dot, labelEl, stateEl);
    grid.appendChild(wrap);
  }
}

function renderPresets(state: State): void {
  const select = document.getElementById("presetSelect") as HTMLSelectElement | null;
  const desc = document.getElementById("presetDesc");
  if (!select || !desc) return;

  select.innerHTML = "";
  for (const p of state.presets) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label;
    select.appendChild(opt);
  }
  const custom = document.createElement("option");
  custom.value = "custom";
  custom.textContent = "Custom";
  select.appendChild(custom);

  select.value = state.settings.activePreset || "custom";
  const matched = state.presets.find((p) => p.id === select.value);
  desc.textContent = matched ? matched.description : "Your own configuration.";

  select.onchange = () => {
    if (select.value === "custom") return;
    post({ type: "applyPreset", presetId: select.value });
  };
}

function renderSegments(state: State): void {
  const list = document.getElementById("segmentsList");
  if (!list) return;
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
    li.title = meta.description;

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.setAttribute("aria-hidden", "true");
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

    const label = document.createElement("span");
    label.className = "segment-label";
    label.textContent = meta.label;

    li.append(handle, cb, label);
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
    document.querySelectorAll(".segment.drag-over").forEach((n) => n.classList.remove("drag-over"));
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

document.getElementById("openSettingsBtn")?.addEventListener("click", () => {
  post({ type: "openSettings" });
});

window.addEventListener("message", (ev: MessageEvent) => {
  const msg = ev.data as { type?: string; state?: State };
  console.log("[claude-bridge sidebar] recv", msg?.type);
  if (msg && msg.type === "state" && msg.state) {
    render(msg.state);
  }
});

post({ type: "ready" });
