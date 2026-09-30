/** Preserve boundary-only Tab wrapping; the caller owns the focusable selector. */
export function cycleDialogFocus(event: KeyboardEvent, elements: HTMLElement[], active: Element | null): void {
  if (event.key !== "Tab" || !elements.length) return;
  const first = elements[0], last = elements.at(-1)!;
  if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
}

/** Each initialized app owns its focus-return map. Importing registers nothing. */
export function createDialogs(document: Document) {
  const focusReturns = new WeakMap<HTMLElement, HTMLElement>();
  const focusableIn = (layer: HTMLElement): HTMLElement[] => Array.from(layer.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')).filter(element => !element.hidden);
  const openLayer = (layer: HTMLElement, initial: HTMLElement, cancel: () => void): void => {
    if (document.activeElement instanceof HTMLElement) focusReturns.set(layer, document.activeElement);
    layer.hidden = false;
    layer.onkeydown = event => {
      if (event.key === "Escape") { event.preventDefault(); cancel(); return; }
      if (event.key !== "Tab") return;
      cycleDialogFocus(event, focusableIn(layer), document.activeElement);
    };
    queueMicrotask(() => initial.focus());
  };
  const closeLayer = (layer: HTMLElement): void => {
    layer.hidden = true; layer.onkeydown = null;
    const previous = focusReturns.get(layer); focusReturns.delete(layer);
    if (previous?.isConnected) previous.focus();
  };
  return { openLayer, closeLayer };
}
export type DialogController = ReturnType<typeof createDialogs>;
