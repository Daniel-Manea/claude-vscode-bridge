// Drag-to-reorder wiring shared by both webview bundles.
// The caller owns the list state and receives a (fromIdx, toIdx) callback when
// the user drops an item on another row.
//
// The row becomes draggable only while the user is pressing the grip handle —
// mouse-clicking the label / example / checkbox does not initiate a drag, so
// those areas stay free for click-to-toggle behavior.

export interface DndCallbacks {
  getDraggingIndex: () => number | null;
  setDraggingIndex: (idx: number | null) => void;
  onDrop: (fromIdx: number, toIdx: number) => void;
}

export function bindDnd(
  el: HTMLElement,
  handle: HTMLElement,
  cb: DndCallbacks,
): void {
  el.draggable = false;

  // Only arm drag while the grip is pressed. Disarm on mouseup, dragend, or
  // any mouseleave fallback — so a stuck state can't prevent future clicks.
  const arm = (): void => {
    el.draggable = true;
  };
  const disarm = (): void => {
    el.draggable = false;
  };
  handle.addEventListener("mousedown", arm);
  handle.addEventListener("touchstart", arm, { passive: true });
  el.addEventListener("mouseup", disarm);
  document.addEventListener("mouseup", disarm);

  el.addEventListener("dragstart", (ev) => {
    const fromIdx = Number(el.dataset.index);
    cb.setDraggingIndex(fromIdx);
    el.classList.add("dragging");
    if (ev.dataTransfer) {
      ev.dataTransfer.setData("text/plain", String(fromIdx));
      ev.dataTransfer.effectAllowed = "move";
    }
  });
  el.addEventListener("dragend", () => {
    el.classList.remove("dragging");
    cb.setDraggingIndex(null);
    disarm();
    document
      .querySelectorAll(".segment.drag-over, .drag-over")
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
    const fromIdx = cb.getDraggingIndex();
    if (fromIdx === null) return;
    const toIdx = Number(el.dataset.index);
    if (fromIdx === toIdx) return;
    cb.onDrop(fromIdx, toIdx);
  });
}

// Small SVG grip for drag handles — replaces the inconsistent ⿻ Unicode glyph.
export function gripSvg(): string {
  return '<svg class="grip" width="10" height="14" viewBox="0 0 10 14" aria-hidden="true"><circle cx="2" cy="3" r="1.2" fill="currentColor"/><circle cx="2" cy="7" r="1.2" fill="currentColor"/><circle cx="2" cy="11" r="1.2" fill="currentColor"/><circle cx="8" cy="3" r="1.2" fill="currentColor"/><circle cx="8" cy="7" r="1.2" fill="currentColor"/><circle cx="8" cy="11" r="1.2" fill="currentColor"/></svg>';
}
