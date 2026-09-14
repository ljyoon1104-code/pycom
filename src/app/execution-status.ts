/** Execution announcements never become student output. Errors remain visible. */
export function announceExecution(element: HTMLElement, text: string, error = false): void {
  element.classList.toggle("sr-only", !error);
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");
  element.setAttribute("aria-atomic", "true");
  element.textContent = text;
}
