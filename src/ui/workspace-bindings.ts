import type { AppElements } from "./app-elements";

interface Actions {
  insertTab(): void; clearConsole(): void; newFile(): void; save(): unknown; saveAs(): unknown;
  importFile(): void; exportFile(): void; backupAll(): unknown; restoreAll(): void;
  removeCurrent(): unknown; showExamplesDialog(): void; showHelpDialog(): void;
  selectResult(kind: "text" | "graphics"): void;
}

/** Bootstrap calls this once, after constructing the editor and tab service. */
export function bindWorkspaceActions(app: ParentNode, elements: AppElements, { insertTab, clearConsole, newFile, save, saveAs, importFile, exportFile, backupAll, restoreAll, removeCurrent, showExamplesDialog, showHelpDialog, selectResult }: Actions): void {
  const { filePanel, textTab, graphicsTab } = elements;
  app.querySelector<HTMLButtonElement>(".tab-button")!.addEventListener("click", insertTab); app.querySelector<HTMLButtonElement>(".clear")!.addEventListener("click", clearConsole); app.querySelector<HTMLButtonElement>(".new-file")!.addEventListener("click", newFile); app.querySelector<HTMLButtonElement>(".save")!.addEventListener("click", () => save()); app.querySelector<HTMLButtonElement>(".save-as")!.addEventListener("click", saveAs); app.querySelector<HTMLButtonElement>(".import")!.addEventListener("click", importFile); app.querySelector<HTMLButtonElement>(".export")!.addEventListener("click", exportFile); app.querySelector<HTMLButtonElement>(".backup-all")!.addEventListener("click", () => { void backupAll(); }); app.querySelector<HTMLButtonElement>(".restore-all")!.addEventListener("click", restoreAll); app.querySelector<HTMLButtonElement>(".delete-file")!.addEventListener("click", removeCurrent); app.querySelector<HTMLButtonElement>(".examples-toggle")!.addEventListener("click", showExamplesDialog); app.querySelector<HTMLButtonElement>(".help-toggle")!.addEventListener("click", showHelpDialog); app.querySelector<HTMLButtonElement>(".files-toggle")!.addEventListener("click", event => { const button = event.currentTarget as HTMLButtonElement; const shown = filePanel.classList.toggle("show"); button.setAttribute("aria-expanded", String(shown)); }); textTab.addEventListener("click", () => selectResult("text")); graphicsTab.addEventListener("click", () => selectResult("graphics"));
}
