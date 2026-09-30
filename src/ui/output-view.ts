import { announceExecution } from "../app/execution-status";
import type { AppElements } from "./app-elements";

export function createOutputView(app: ParentNode, elements: AppElements) {
  const { consoleEl, runButton, stopButton, textView, graphicsView, textTab, graphicsTab } = elements;
  const resultOwner = document.createElement("p"); resultOwner.className = "execution-owner"; resultOwner.setAttribute("role", "status"); app.querySelector(".result-panel .panel-heading")!.after(resultOwner);
  const append = (text: string, className = "console-line") => { const node = document.createElement("span"); node.className = className; node.textContent = text; if (className === "console-error") node.setAttribute("role", "alert"); consoleEl.append(node); consoleEl.scrollTop = consoleEl.scrollHeight; };
  const clearConsole = () => consoleEl.replaceChildren();
  const executionLive = document.createElement("span"); executionLive.className = "execution-live sr-only"; app.querySelector(".topbar")!.append(executionLive); announceExecution(executionLive, "");
  const executionStatus = (text: string) => announceExecution(executionLive, text);
  const status = (text: string) => append(text, "console-status");
  const renderRunning = (value: boolean, currentDocument: boolean) => { runButton.disabled = value && currentDocument; stopButton.disabled = !value; consoleEl.setAttribute("aria-busy", String(value)); if (!value) { consoleEl.querySelectorAll(".input-row").forEach(row => row.remove()); if (executionLive.textContent === "실행 중입니다.") executionStatus("실행이 종료되었습니다."); } };
  const selectResult = (kind: "text" | "graphics") => { const graphics = kind === "graphics"; textView.hidden = graphics; graphicsView.hidden = !graphics; textTab.classList.toggle("selected", !graphics); graphicsTab.classList.toggle("selected", graphics); textTab.setAttribute("aria-selected", String(!graphics)); graphicsTab.setAttribute("aria-selected", String(graphics)); };
  const showGraphics = () => { graphicsTab.hidden = false; selectResult("graphics"); };
  return { resultOwner, append, clearConsole, executionStatus, status, renderRunning, selectResult, showGraphics };
}
