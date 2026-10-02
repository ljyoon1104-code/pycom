import { createAppShell } from "../ui/app-shell";
import { getAppElements } from "../ui/app-elements";
import { createDialogs } from "../ui/dialogs";
import { createOutputView } from "../ui/output-view";
import { renderFileList } from "../ui/file-panel";
import { createHelpController } from "../ui/help-controller";
import { bindWorkspaceActions } from "../ui/workspace-bindings";
import { initialCode } from "./initial-code";
import { ExecutionSession } from "./execution-session";
import { createExecutionControls } from "../ui/execution-controls";
import { ExecutionSources } from "../editor/execution-sources";

import { mountExampleBrowser } from "../examples/browser";
import type { LearningExample } from "../examples/model";
import { shouldShowWelcome } from "./classroom";
import { APP_VERSION } from "./version";
import { executionErrorCategory, type LastExecutionCategory } from "./diagnostics";
import { LearningEditor } from "../editor/editor";
import { DocumentTabs } from "../editor/document-tabs";
import { isDirty } from "../editor/documents";
import { BackupValidationError, backupDownloadName, buildRestoreSet, createWorkspaceBackup, MAX_BACKUP_JSON_BYTES, parseWorkspaceBackup, restorePreview, serializeWorkspaceBackup, type ConflictPolicy, type WorkspaceBackup } from "../files/backup";
import { decodeImportedBytes, FileDecodingError, type ImportEncodingChoice } from "../files/encoding";
import { appFile, checkedPut, IndexedDbFileStore, normalizeName, type AppFile } from "../files/storage";
import { setupPwa } from "../pwa/register";
import { TurtleCanvasRenderer } from "../graphics/turtle-canvas";
import type { FromWorker, WorkerRequest as ToWorker } from "../runtime/protocol";
import type { StudentError } from "../compiler/token";


/** Explicit application lifetime: state and event registration remain local. */
export function bootstrap(): void {
  const store = new IndexedDbFileStore();
  const app = document.querySelector<HTMLDivElement>("#app")!;
  const { appStatus, topbar, nameLayer, importLayer, welcomeLayer, helpLayer, examplesLayer, restoreLayer, restoreInput, diagnosticsLayer } = createAppShell(app);

  const { openLayer, closeLayer } = createDialogs(document);
  const elements = getAppElements(app, appStatus);
  const { host, consoleEl, graphicsTab, turtleCanvas, runButton, stopButton, modified, nameEl, filePanel, fileList, dialog, connectionEl, pwaMessage, iosInstallHint, updateNotice, updateButton, installButton } = elements;
  const turtleRenderer = new TurtleCanvasRenderer(turtleCanvas);
  let restoring = false, worker: ExecutionSession | undefined, editor: LearningEditor, tabs: DocumentTabs, executionSources: ExecutionSources | undefined;
  let execution: { id: string; name: string } | undefined;
  const { resultOwner, append, clearConsole, executionStatus, status, renderRunning, selectResult, showGraphics } = createOutputView(app, elements);
  const traceControls = createExecutionControls(topbar as HTMLElement, message => worker?.postMessage(message), executionStatus);
  const setRunning = (value: boolean, error?: StudentError) => { renderRunning(value, execution?.id === tabs?.active.id); if (!value) { traceControls.finish(); executionSources?.finish(error); } tabs?.render(); };
  let lastExecution: LastExecutionCategory = "실행 전";
  let files = new Map<string, AppFile>();
  const renderFiles = () => renderFileList(fileList, files, tabs?.active.savedFileName, openFile);
  const save = () => tabs.save();
  function openFile(name: string): void { const file = files.get(name); if (file) { tabs.open(file); filePanel.classList.remove("show"); app.querySelector(".files-toggle")!.setAttribute("aria-expanded", "false"); } }
  const newFile = () => tabs.newDocument();
  const saveAs = () => tabs.save(true);
  const removeCurrent = () => tabs.deleteActive();
  const importFile = () => {
    const input = importLayer.querySelector<HTMLInputElement>(".import-file")!, select = importLayer.querySelector<HTMLSelectElement>(".encoding-select")!, error = importLayer.querySelector<HTMLElement>(".import-error")!;
    select.value = "auto"; error.hidden = true; error.textContent = ""; input.value = "";
    const close = () => { closeLayer(importLayer); input.value = ""; };
    importLayer.querySelector<HTMLButtonElement>(".import-cancel")!.onclick = close;
    importLayer.querySelector<HTMLButtonElement>(".import-choose")!.onclick = () => input.click();
    input.onchange = async () => {
      const picked = input.files?.[0]; if (!picked || !/\.(py|txt|csv)$/i.test(picked.name)) return;
      try {
        const decoded = decodeImportedBytes(new Uint8Array(await picked.arrayBuffer()), select.value as ImportEncodingChoice);
        let name = picked.name;
        if (files.has(name)) {
          const choice = window.prompt("같은 이름의 파일이 있습니다: 덮어쓰기 / 다른 이름 / 취소", "덮어쓰기");
          if (choice === "취소" || choice === null) return;
          if (choice === "다른 이름") { const alternative = window.prompt("새 파일 이름", name); if (alternative === null) return; name = normalizeName(alternative); }
        }
        const file = appFile(name, decoded.content, picked.lastModified || Date.now(), decoded.encoding, decoded.byteSize);
        await checkedPut(store, file); files.set(name, file); tabs.external(file); renderFiles(); close();
        append(`${name} 파일을 ${decoded.encoding === "euc-kr" ? "EUC-KR" : "UTF-8"}로 가져왔습니다.\n`, "console-status");
        openFile(name);
      } catch (reason) {
        error.textContent = reason instanceof FileDecodingError ? reason.message : "파일을 가져올 수 없습니다.";
        error.hidden = false; select.focus(); input.value = "";
      }
    };
    openLayer(importLayer, select, close);
  };
  const exportFile = () => { const blob = new Blob([editor.value], { type: "text/plain;charset=utf-8" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = tabs.active.fileName; link.click(); URL.revokeObjectURL(link.href); };
  const downloadText = (text: string, name: string, type: string): void => { const blob = new Blob([text], { type }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0); };
  const backupAll = async (): Promise<void> => {
    if (!await tabs.protect("저장된 파일 전체 백업")) return;
    try {
      const saved = await store.list();
      const backup = createWorkspaceBackup(saved, APP_VERSION);
      downloadText(serializeWorkspaceBackup(backup), backupDownloadName(), "application/json;charset=utf-8");
      status(`저장된 파일 ${backup.files.length}개를 전체 백업했습니다.\n`);
    } catch { append("전체 백업 파일을 만들 수 없습니다.", "console-error"); }
  };

  let pendingBackup: WorkspaceBackup | undefined;
  const selectedRestorePolicy = (): ConflictPolicy => restoreLayer.querySelector<HTMLInputElement>('input[name="restore-policy"]:checked')?.value as ConflictPolicy ?? "keep";
  const setRestoreSummary = (backup: WorkspaceBackup, existing: readonly AppFile[]): void => {
    const error = restoreLayer.querySelector<HTMLElement>(".restore-error")!;
    const confirm = restoreLayer.querySelector<HTMLButtonElement>(".restore-confirm")!;
    try {
      const preview = restorePreview(existing, backup, selectedRestorePolicy());
      restoreLayer.querySelector<HTMLElement>(".restore-created")!.textContent = new Date(preview.createdAt).toLocaleString("ko-KR");
      restoreLayer.querySelector<HTMLElement>(".restore-version")!.textContent = preview.appVersion;
      restoreLayer.querySelector<HTMLElement>(".restore-count")!.textContent = `${preview.fileCount}개`;
      restoreLayer.querySelector<HTMLElement>(".restore-added")!.textContent = `${preview.addCount}개`;
      restoreLayer.querySelector<HTMLElement>(".restore-conflicts")!.textContent = `${preview.conflictCount}개`;
      restoreLayer.querySelector<HTMLElement>(".restore-size")!.textContent = `${preview.expectedBytes.toLocaleString("ko-KR")}바이트`;
      error.hidden = true; error.textContent = ""; confirm.disabled = false;
    } catch (reason) {
      error.textContent = reason instanceof BackupValidationError ? reason.message : "이 백업은 현재 저장 공간에 복원할 수 없습니다.";
      error.hidden = false; confirm.disabled = true;
    }
  };

  const applyRestore = async (): Promise<void> => {
    const backup = pendingBackup; if (!backup || restoring) return;
    closeLayer(restoreLayer);
    if (!await tabs.protect("전체 복원 전 변경 사항 저장")) return;
    worker?.terminate(); worker = undefined; setRunning(false);
    restoring = true;
    app.querySelector<HTMLElement>(".workspace")!.inert = true;
    (topbar as HTMLElement).inert = true;
    const restoreButton = app.querySelector<HTMLButtonElement>(".restore-all")!;
    restoreButton.disabled = true; updateButton.disabled = true;
    try {
      await fileWrites;
      const existing = await store.list();
      const restored = buildRestoreSet(existing, backup, selectedRestorePolicy());
      await store.replaceAll(restored);
      files = new Map(restored.map(file => [file.name, file]));
      tabs.replaceSaved(files); renderFiles();
      status(`전체 복원이 완료되었습니다. 저장 파일 ${restored.length}개\n`);
    } catch (reason) {
      append(reason instanceof BackupValidationError ? reason.message : "전체 복원에 실패했습니다. 기존 파일은 변경되지 않았습니다.", "console-error");
    } finally {
      pendingBackup = undefined; restoring = false; restoreButton.disabled = false; updateButton.disabled = false; restoreInput.value = "";
      app.querySelector<HTMLElement>(".workspace")!.inert = false; (topbar as HTMLElement).inert = false;
    }
  };

  const openRestorePreview = async (backup: WorkspaceBackup): Promise<void> => {
    const existing = await store.list(); pendingBackup = backup;
    const keep = restoreLayer.querySelector<HTMLInputElement>('input[value="keep"]')!; keep.checked = true;
    restoreLayer.querySelectorAll<HTMLInputElement>('input[name="restore-policy"]').forEach(input => { input.onchange = () => setRestoreSummary(backup, existing); });
    const close = () => { pendingBackup = undefined; closeLayer(restoreLayer); restoreInput.value = ""; };
    restoreLayer.querySelector<HTMLButtonElement>(".restore-cancel")!.onclick = close;
    restoreLayer.querySelector<HTMLButtonElement>(".restore-confirm")!.onclick = () => { void applyRestore(); };
    setRestoreSummary(backup, existing);
    openLayer(restoreLayer, keep, close);
  };

  const restoreAll = (): void => { if (!restoring) { restoreInput.value = ""; restoreInput.click(); } };
  restoreInput.addEventListener("change", async () => {
    const selected = restoreInput.files?.[0]; if (!selected) return;
    try {
      if (!selected.name.toLowerCase().endsWith(".pylab-backup.json")) throw new BackupValidationError("file-type", "전체 백업 파일(.pylab-backup.json)을 선택해 주세요.");
      if (selected.size > MAX_BACKUP_JSON_BYTES) throw new BackupValidationError("json-limit", "백업 파일이 너무 큽니다.");
      await openRestorePreview(parseWorkspaceBackup(await selected.text()));
    } catch (reason) {
      restoreInput.value = "";
      append(reason instanceof BackupValidationError ? reason.message : "백업 파일을 읽을 수 없습니다.", "console-error");
    }
  });
  const { showWelcomeDialog, showHelpDialog, showExamplesDialog } = createHelpController({ welcomeLayer, helpLayer, diagnosticsLayer, examplesLayer, store, lastExecution: () => lastExecution, onExample: (name, content) => tabs.example(name, content), openLayer, closeLayer });
  editor = new LearningEditor(host, initialCode, () => { tabs?.edited(); });
  nameLayer.remove(); dialog.remove();
  tabs = new DocumentTabs({ editor, host, store, files: () => files, changed: () => {
    if (!tabs) return;
    nameEl.textContent = tabs.active.fileName; modified.textContent = isDirty(tabs.active) ? " *" : "";
    runButton.disabled = restoring || Boolean(worker && execution?.id === tabs.active.id);
    renderFiles();
  }, message: (text, error) => append(text, error ? "console-error" : "console-status"), running: () => worker ? execution?.id : undefined, activated: () => executionSources?.showDraft() }, initialCode);
  tabs.render();
  executionSources = new ExecutionSources(tabs, host);
  bindWorkspaceActions(app, elements, { insertTab: () => editor.insertTab(), clearConsole, newFile, save, saveAs, importFile, exportFile, backupAll, restoreAll, removeCurrent, showExamplesDialog, showHelpDialog, selectResult });
  window.addEventListener("beforeunload", event => { if (restoring) event.preventDefault(); });
  window.addEventListener("keydown", event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); if (!restoring) void tabs.save(event.shiftKey); } });
  function showInput(prompt: string): void { const source = worker; const row = document.createElement("form"); row.className = "input-row"; row.innerHTML = `<span class="input-owner"></span><span class="input-prompt"></span><input class="console-input" aria-label="프로그램 입력" autocomplete="off" /><button class="input-submit" type="submit">입력</button>`; row.querySelector<HTMLElement>(".input-owner")!.textContent = `입력 대기: ${execution?.name ?? ""}`; row.querySelector<HTMLElement>(".input-prompt")!.textContent = prompt; const input = row.querySelector<HTMLInputElement>("input")!; input.setAttribute("aria-label", `${execution?.name} 프로그램 입력`); row.addEventListener("submit", event => { event.preventDefault(); if (source !== worker) return; const value = input.value; const answer = document.createElement("span"); answer.className = "console-line"; answer.textContent = `${prompt}${value}\n`; row.replaceWith(answer); source?.postMessage({ type: "input", value } satisfies ToWorker); }); consoleEl.append(row); input.focus({ preventScroll: false }); row.scrollIntoView({ block: "nearest" }); }
  function finish(kind: "complete" | "stopped"): void { lastExecution = kind === "complete" ? "성공" : "사용자 중지"; executionStatus(kind === "complete" ? "실행이 완료되었습니다." : "실행이 중지되었습니다."); worker?.terminate(); worker = undefined; setRunning(false); }
  let fileWrites: Promise<void> = Promise.resolve();
  function receive(message: FromWorker): void { switch (message.type) { case "source": executionSources?.source(message.source); break; case "execution": traceControls.receive(message); if (message.location && message.state !== "running") executionSources?.location(message.location); else if (!message.location) executionSources?.clearLocation(); break; case "output": append(message.text); break; case "graphics": showGraphics(); turtleRenderer.apply(message.commands); break; case "input-request": showInput(message.prompt); break; case "file-change": { const file = appFile(message.name, message.content); fileWrites = fileWrites.then(async () => { await checkedPut(store, file); files.set(file.name, file); tabs.external(file); }).catch(() => append("파일 변경을 저장할 수 없습니다. 편집 내용은 유지됩니다.", "console-error")); break; } case "error": {
      lastExecution = executionErrorCategory(message.error.message);
      const moduleError = message.error.fileName && message.error.fileName !== execution?.name;
      if (execution && !moduleError) tabs.setError(execution.id, message.error.line);
      append(`${moduleError ? `${message.error.fileName}: ` : ""}${message.error.line}번째 줄: ${message.error.message}`, "console-error"); worker?.terminate(); worker = undefined; setRunning(false, message.error); break;
    } case "complete": finish("complete"); break; case "stopped": finish("stopped"); break; } }
  let runGeneration = 0;
  runButton.addEventListener("click", async () => {
    if (restoring) return;
    const generation = ++runGeneration;
    const id = tabs.active.id, name = tabs.active.fileName, code = editor.value;
    worker?.terminate(); worker = undefined; setRunning(false);
    await fileWrites;
    if (restoring || generation !== runGeneration) return;
    clearConsole(); turtleRenderer.reset(); graphicsTab.hidden = true; selectResult("text");
    execution = { id, name }; resultOwner.textContent = `실행: ${name}`; tabs.setError(id, null); executionStatus("실행 중입니다.");
    const source = new ExecutionSession(() => new Worker(new URL("../runtime/worker.ts", import.meta.url), { type: "module" })); worker = source;
    executionSources?.start(id, traceControls.mode); traceControls.start(); setRunning(true);
    source.onmessage = ({ data }: MessageEvent<FromWorker>) => { if (worker === source) receive(data); };
    source.onerror = () => {
      if (worker !== source) return;
      lastExecution = "시스템 오류"; append("실행 중 오류가 발생했습니다.", "console-error"); source.terminate(); worker = undefined; setRunning(false);
    };
    source.postMessage({ type: "run", code, fileName: name, mode: traceControls.mode, speed: traceControls.speed, files: [...files.values()].map(file => ({ name: file.name, content: file.content, encoding: file.encoding })) } satisfies ToWorker);
  });
  stopButton.addEventListener("click", () => worker?.postMessage({ type: "stop" } satisfies ToWorker));
  store.list().then(saved => { files = new Map(saved.map(file => [file.name, file])); tabs.initialize(files); renderFiles(); }).catch(() => append("저장소를 열 수 없습니다.", "console-error"));
  setupPwa({
    onConnection: text => { connectionEl.textContent = text; },
    onMessage: text => { pwaMessage.textContent = text; pwaMessage.hidden = false; },
    onIosInstallHint: () => { iosInstallHint.hidden = false; },
    onInstallAvailable: install => { installButton.hidden = false; installButton.onclick = async () => { await install(); installButton.hidden = true; }; },
    onUpdate: activate => {
      updateNotice.hidden = false; updateButton.hidden = false;
      updateButton.onclick = async () => {
        if (restoring) { pwaMessage.textContent = "전체 복원이 끝난 뒤 업데이트해 주세요."; pwaMessage.hidden = false; return; }
        if (!await tabs.protect("앱 업데이트 전 변경 사항 저장")) return;
        tabs.allowNavigation(); updateButton.disabled = true; activate();
      };
    },
  });

  const textbookDataLayer = document.createElement("div");
  textbookDataLayer.className = "dialog-layer textbook-data-layer"; textbookDataLayer.hidden = true;
  textbookDataLayer.innerHTML = `<section class="save-dialog" role="dialog" aria-modal="true" aria-labelledby="textbook-data-title"><h2 id="textbook-data-title">예제 데이터 가져오기</h2><p>코드는 저장 버튼을 누르기 전까지 저장되지 않습니다. 데이터를 함께 가져오면 아래 정책으로 기기에 저장합니다.</p><label for="textbook-conflict">같은 이름의 파일 처리</label><select id="textbook-conflict"><option value="keep">기존 파일 유지</option><option value="overwrite">예제 데이터로 덮어쓰기</option><option value="rename">예제 데이터 이름 변경</option></select><p>이름을 바꾸면 코드의 open() 파일명도 직접 바꿔 주세요.</p><div><button data-import="code" type="button">코드만 가져오기</button><button data-import="data" type="button">코드와 예제 데이터 가져오기</button><button data-import="cancel" type="button">취소</button></div></section>`;
  app.querySelector(".app")!.append(textbookDataLayer);
  async function editTextbookExample(example: LearningExample): Promise<boolean> {
    if (restoring) return false;
    const sourceHash = location.hash;
    let includeData = false, policy: ConflictPolicy = "keep";
    if (example.dataFiles?.length) {
      const choice = await new Promise<string>(resolve => {
        const select = textbookDataLayer.querySelector<HTMLSelectElement>("select")!; select.value = "keep";
        const done = (value: string) => { policy = select.value as ConflictPolicy; closeLayer(textbookDataLayer); resolve(value); };
        textbookDataLayer.querySelectorAll<HTMLButtonElement>("button").forEach(button => button.onclick = () => done(button.dataset.import!));
        openLayer(textbookDataLayer, textbookDataLayer.querySelector<HTMLButtonElement>("button")!, () => done("cancel"));
      });
      if (choice === "cancel" || location.hash !== sourceHash) return false;
      includeData = choice === "data";
    }
      if (location.hash !== sourceHash) return false;
      if (includeData) {
        const samples = example.dataFiles!.map(file => appFile(file.name, file.content));
        const merged = buildRestoreSet(await store.list(), createWorkspaceBackup(samples, APP_VERSION), policy);
        await store.replaceAll(merged);
        files = new Map(merged.map(file => [file.name, file]));
        merged.forEach(file => tabs.external(file));
      }
      location.hash = "#/editor"; tabs.example(example.suggestedFileName, example.code); return true;
  }
  const textbookNavigation = document.createElement("nav"); textbookNavigation.className = "textbook-nav"; textbookNavigation.setAttribute("aria-label", "학습실 페이지");
  const editorLink = document.createElement("a"); editorLink.href = "#/editor"; editorLink.textContent = "코드 편집";
  const textbookLink = document.createElement("a"); textbookLink.href = "#/examples"; textbookLink.textContent = "교과서 예제";
  textbookNavigation.append(editorLink, textbookLink); topbar.prepend(textbookNavigation);
  app.querySelector<HTMLButtonElement>(".files-toggle")!.addEventListener("click", () => { if (location.hash.startsWith("#/examples")) location.hash = "#/editor"; });
  const textbookHelp = document.createElement("section"); const textbookHelpTitle = document.createElement("h3"); textbookHelpTitle.textContent = "교과서 예제";
  const textbookHelpText = document.createElement("p"); textbookHelpText.textContent = "교과서 예제에서 쪽 번호·제목·문법으로 검색하고 주제로 좁힐 수 있습니다. 예제 실행은 현재 문서와 저장 파일을 건드리지 않는 임시 공간을 사용합니다. 데이터 파일도 임시로만 제공됩니다. 편집기에서 수정하기로 가져온 코드는 자동 저장되지 않습니다. 예제 링크 복사로 학생에게 직접 주소를 전달하세요. 교과서 원문이 아니라 같은 개념을 보여주는 자체 제작 코드입니다. 최초 온라인 접속 후 오프라인에서도 사용할 수 있습니다.";
  textbookHelp.append(textbookHelpTitle, textbookHelpText); helpLayer.querySelector(".dialog-scroll")!.append(textbookHelp);
  const tabsHelp = document.createElement("section");
  tabsHelp.innerHTML = `<h3>여러 문서 탭</h3><ul><li><strong>+ / 새 파일</strong>과 파일 목록으로 현재 탭 오른쪽에 문서를 엽니다. 같은 저장 파일은 기존 탭으로 이동합니다.</li><li>탭 전환은 저장이 아닙니다. 내용·커서·선택·스크롤·실행 취소 기록을 탭별로 유지합니다. <strong>*</strong>는 저장된 내용과 다르다는 뜻입니다.</li><li><strong>저장 / Ctrl·Cmd+S</strong>는 현재 탭만 저장합니다. 새 문서는 이름을 확인합니다. <strong>다른 이름으로 / Ctrl·Cmd+Shift+S</strong>는 원래 저장 파일을 남깁니다.</li><li>닫기 × 또는 Delete는 수정 내용의 저장·버리기·취소를 확인합니다. <strong>열린 파일</strong> 목록에서도 탭 선택과 닫기를 할 수 있습니다.</li><li>탭에서 화살표·Home·End로 포커스를 옮기고 Enter·Space로 전환합니다.</li><li>새로고침 경고를 무시하면 미저장 코드와 새 문서·undo 기록은 복원되지 않습니다. 저장된 탭의 이름·순서만 기억하며 코드는 IndexedDB에서 다시 읽습니다. 자동 저장하지 않습니다.</li><li>업데이트·전체 복원은 모든 수정 탭의 이름과 수를 표시합니다. 모두 저장 중 하나라도 실패하거나 이름 입력을 취소하면 작업을 중단합니다.</li><li>교과서·기초 예제를 가져오면 기존 문서를 덮어쓰지 않고 새 수정 탭을 만듭니다.</li><li>편집기는 한 번에 하나의 Python 프로그램을 실행합니다. 결과의 ‘실행: 파일명’과 입력창의 파일명을 확인하세요. 다른 탭에서 실행하면 이전 실행을 종료합니다.</li><li>Python이 열린 파일을 바꾸면 수정 탭은 유지하고 충돌을 알립니다. 편집 내용 유지·저장된 내용 다시 불러오기·다른 이름으로 저장 중 선택합니다.</li></ul>`;
  helpLayer.querySelector(".dialog-scroll")!.prepend(tabsHelp);
  mountExampleBrowser(app.querySelector<HTMLElement>(".app")!, active => {
    if (active) { ++runGeneration; if (worker) finish("stopped"); }
    app.querySelector<HTMLElement>(".workspace")!.hidden = active;
    app.querySelector<HTMLElement>(".app")!.classList.toggle("browsing-examples", active);
    if (active) { textbookLink.setAttribute("aria-current", "page"); editorLink.removeAttribute("aria-current"); }
    else { editorLink.setAttribute("aria-current", "page"); textbookLink.removeAttribute("aria-current"); }
  }, editTextbookExample);

  try {
    if (shouldShowWelcome(localStorage)) showWelcomeDialog();
  } catch {
    showWelcomeDialog();
  }
}
