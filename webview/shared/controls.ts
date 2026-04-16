// Reusable custom controls for both webviews.

const CHECK_SVG =
  '<svg viewBox="0 0 10 10" class="check-mark" aria-hidden="true" width="10" height="10">' +
  '<path d="M1.8 5.2L4 7.4L8.2 2.8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
  "</svg>";

/**
 * Brand checkbox. Rendered as `<button role="checkbox">` so it's keyboard
 * accessible (Space toggles) and announced by screen readers. Checkmark
 * animates in via `clip-path` reveal.
 */
export function makeCheckbox(
  checked: boolean,
  ariaLabel: string,
  onChange: (next: boolean) => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cb-check" + (checked ? " checked" : "");
  btn.setAttribute("role", "checkbox");
  btn.setAttribute("aria-checked", String(checked));
  btn.setAttribute("aria-label", ariaLabel);
  btn.innerHTML = CHECK_SVG;

  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    const next = btn.getAttribute("aria-checked") !== "true";
    btn.classList.toggle("checked", next);
    btn.setAttribute("aria-checked", String(next));
    onChange(next);
  });

  return btn;
}

/** Pill button used for the preset selector. `active` flips on the brand fill. */
export function makePill(
  label: string,
  active: boolean,
  onClick: () => void,
  opts?: { title?: string; custom?: boolean },
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className =
    "cb-pill" + (active ? " active" : "") + (opts?.custom ? " custom" : "");
  btn.textContent = label;
  if (opts?.title) btn.title = opts.title;
  btn.addEventListener("click", onClick);
  return btn;
}
