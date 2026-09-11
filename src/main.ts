import "./styles/app.css";
import { CLASSROOM_EXAMPLES, exampleDocument, rememberWelcomeClosed, shouldShowWelcome, type ClassroomExample } from "./app/classroom";
import { APP_VERSION } from "./app/version";
import { executionErrorCategory, formatDiagnostics, type LastExecutionCategory } from "./app/diagnostics";
import { LearningEditor } from "./editor/editor";
import { BACKUP_FORMAT_VERSION, BackupValidationError, backupDownloadName, buildRestoreSet, createWorkspaceBackup, MAX_BACKUP_JSON_BYTES, parseWorkspaceBackup, restorePreview, serializeWorkspaceBackup, type ConflictPolicy, type WorkspaceBackup } from "./files/backup";
import { decodeImportedBytes, FileDecodingError, type ImportEncodingChoice } from "./files/encoding";
import { appFile, checkedPut, IndexedDbFileStore, normalizeName, validFileName, type AppFile } from "./files/storage";
import { setupPwa } from "./pwa/register";
import { TurtleCanvasRenderer } from "./graphics/turtle-canvas";
import type { FromWorker, ToWorker } from "./runtime/protocol";

const initialCode = `name = input("이름을 입력하세요: ")
age = int(input("나이를 입력하세요: "))

print("안녕하세요,", name)
print("내년에는", age + 1, "살입니다.")`;
const store = new IndexedDbFileStore();
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `<main class="app"><header class="topbar"><div class="filename"><span class="current-name">main.py</span><span class="modified" aria-label="수정됨"></span></div><div class="actions"><button class="files-toggle" type="button" aria-expanded="false">파일</button><button class="examples-toggle" type="button">예제</button><button class="help-toggle" type="button">도움말</button><button class="new-file" type="button">새 파일</button><button class="save" type="button">저장</button><button class="save-as" type="button">다른 이름으로</button><button class="import" type="button">가져오기</button><button class="export" type="button">내보내기</button><button class="backup-all" type="button">전체 백업</button><button class="restore-all" type="button">전체 복원</button><button class="delete-file" type="button">삭제</button><button class="stop" type="button" disabled>중지</button><button class="run" type="button">실행</button></div></header><section class="workspace"><aside class="file-panel" aria-label="파일 목록"><div class="panel-heading">파일</div><div class="file-list"></div></aside><section class="panel"><div class="panel-heading">코드 편집기</div><div class="editor-host"></div><div class="editor-tools"><button class="tab-button" type="button" aria-label="편집기에 네 칸 들여쓰기 삽입">Tab</button></div></section><section class="panel result-panel"><div class="panel-heading">실행 결과</div><div class="result-tabs" role="tablist" aria-label="실행 결과 종류"><button class="result-tab selected" data-result-tab="text" role="tab" aria-selected="true" aria-controls="text-result" type="button">텍스트</button><button class="result-tab graphics-tab" data-result-tab="graphics" role="tab" aria-selected="false" aria-controls="graphics-result" type="button" hidden>그래픽</button></div><section id="text-result" class="result-view text-view" role="tabpanel"><button class="clear" type="button">결과 지우기</button><div class="console" role="log" aria-live="polite" aria-relevant="additions text"><span class="console-empty">실행 결과가 여기에 표시됩니다.</span></div></section><section id="graphics-result" class="result-view graphics-view" role="tabpanel" hidden><p class="graphics-help" id="graphics-help">원점은 가운데이며, 위쪽이 양의 y 방향입니다.</p><div class="turtle-canvas-wrap"><canvas class="turtle-canvas" role="img" aria-label="교육용 거북이 그래픽 실행 결과" aria-describedby="graphics-help"></canvas></div></section></section></section><div class="dialog-layer save-layer" hidden><section class="save-dialog" role="dialog" aria-modal="true" aria-labelledby="save-question" aria-describedby="save-detail"><h2 id="save-question">변경 사항 저장</h2><p id="save-detail">현재 문서의 변경 사항을 저장하시겠습니까?</p><div><button data-choice="save" type="button">저장</button><button data-choice="discard" type="button">저장하지 않음</button><button data-choice="cancel" type="button">취소</button></div></section></div></main>`;
const appStatus = document.createElement("div"); appStatus.className = "app-status"; appStatus.setAttribute("aria-live", "polite"); appStatus.innerHTML = `<span class="connection-status"></span><span class="pwa-message" hidden></span><span class="ios-install-hint" hidden>공유 버튼을 누른 뒤 ‘홈 화면에 추가’를 선택하세요.</span><span class="update-notice" hidden>새 버전을 사용할 수 있습니다.</span><button class="update" type="button" hidden>업데이트</button><button class="install" type="button" hidden>앱 설치</button>`; const topbar = app.querySelector(".topbar")!; topbar.insertBefore(appStatus, topbar.querySelector(".actions"));
const nameLayer = document.createElement("div"); nameLayer.className = "dialog-layer"; nameLayer.hidden = true; nameLayer.innerHTML = `<section class="save-dialog" role="dialog" aria-modal="true" aria-label="파일 이름"><p class="name-question">파일 이름을 입력하세요.</p><input class="name-input" aria-label="파일 이름" /><div><button class="name-confirm" type="button">확인</button><button class="name-cancel" type="button">취소</button></div></section>`; app.querySelector(".app")!.append(nameLayer);
const importLayer = document.createElement("div"); importLayer.className = "dialog-layer"; importLayer.hidden = true; importLayer.innerHTML = `<section class="save-dialog import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-question"><p id="import-question">가져올 파일의 인코딩</p><label for="import-encoding">인코딩 선택</label><select id="import-encoding" class="encoding-select"><option value="auto">자동 감지</option><option value="utf-8">UTF-8</option><option value="euc-kr">EUC-KR</option></select><p class="import-help">TXT·CSV는 자동 감지를 권장합니다. EUC-KR 쓰기와 내보내기는 지원하지 않습니다.</p><p class="import-error" role="alert" hidden></p><div><button class="import-choose" type="button">파일 선택</button><button class="import-cancel" type="button">취소</button></div><input class="import-file" type="file" accept=".py,.txt,.csv,text/plain,text/csv" hidden /></section>`; app.querySelector(".app")!.append(importLayer);
const welcomeLayer = document.createElement("div"); welcomeLayer.className = "dialog-layer"; welcomeLayer.hidden = true; welcomeLayer.innerHTML = `<section class="content-dialog welcome-dialog" role="dialog" aria-modal="true" aria-labelledby="welcome-title" aria-describedby="welcome-description"><h2 id="welcome-title">Python 학습실 시작 안내</h2><div id="welcome-description"><ol><li>코드를 작성합니다.</li><li>실행 버튼을 누릅니다.</li><li><code>input()</code>이 실행되면 입력창에 값을 입력합니다.</li><li>파일은 저장 버튼을 눌러야 기기에 저장됩니다.</li><li>작성한 코드는 서버로 전송되지 않습니다.</li></ol></div><label class="remember-choice"><input class="welcome-remember" type="checkbox" checked /> 다시 보지 않기</label><div class="dialog-actions"><button class="welcome-close primary" type="button">확인</button></div></section>`; app.querySelector(".app")!.append(welcomeLayer);
const helpLayer = document.createElement("div"); helpLayer.className = "dialog-layer"; helpLayer.hidden = true; helpLayer.innerHTML = `<section class="content-dialog help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" aria-describedby="help-intro"><h2 id="help-title">도움말</h2><p id="help-intro">Python 설치와 회원가입 없이 브라우저에서 연습할 수 있습니다.</p><div class="dialog-scroll"><section><h3>기본 사용법</h3><ul><li>코드를 작성하고 <strong>실행</strong>을 누릅니다.</li><li><code>input()</code> 입력창이 나타나면 값을 입력합니다.</li><li>실행 중에는 <strong>중지</strong>를 사용할 수 있습니다.</li><li>오류가 나면 메시지와 강조된 코드 줄을 확인합니다.</li><li><strong>결과 지우기</strong>로 출력을 비우고, turtle은 <strong>그래픽</strong> 탭에서 확인합니다.</li></ul></section><section><h3>파일 사용법</h3><ul><li><strong>저장</strong>, <strong>다른 이름으로</strong>, 파일 목록, <strong>가져오기</strong>·<strong>내보내기</strong>를 사용합니다.</li><li>Python <code>open()</code> 파일도 이 브라우저의 기기 저장소에 보관됩니다.</li><li>자동 저장하지 않습니다. 다른 기기로 옮길 때는 내보내기·가져오기로 백업하세요.</li><li>브라우저 데이터를 삭제하면 로컬 파일도 삭제될 수 있습니다. 앱 업데이트는 로컬 파일을 삭제하지 않습니다.</li><li>EUC-KR은 읽기 전용이며 쓰기와 내보내기는 UTF-8입니다.</li></ul></section><section><h3>설치와 오프라인</h3><ul><li>첫 온라인 접속 뒤 홈 화면에 추가하거나 앱으로 설치하면 오프라인에서도 실행할 수 있습니다.</li><li>새 버전 알림에서 업데이트를 누르면 수정 문서의 저장 여부를 먼저 확인합니다.</li></ul></section><section><h3>지원 범위</h3><p>변수와 기본 자료형, 조건문과 반복문, 리스트·튜플·딕셔너리, 함수, 클래스 기본 기능, 파일 입출력, 예외 처리, random, datetime.date, 교육용 turtle을 지원합니다.</p><p>고급 Python 전체와 외부 패키지는 지원하지 않습니다.</p></section></div><footer><p>Python 학습실 <span class="app-version"></span><br /><span>브라우저에서 실행되는 교육용 Python 환경</span></p><div class="dialog-actions"><button class="show-welcome" type="button">시작 안내 다시 보기</button><button class="help-close primary" type="button">닫기</button></div></footer></section>`; app.querySelector(".app")!.append(helpLayer);
const examplesLayer = document.createElement("div"); examplesLayer.className = "dialog-layer"; examplesLayer.hidden = true; examplesLayer.innerHTML = `<section class="content-dialog examples-dialog" role="dialog" aria-modal="true" aria-labelledby="examples-title" aria-describedby="examples-description"><h2 id="examples-title">자체 제작 예제</h2><p id="examples-description">불러온 예제는 자동 저장되지 않습니다. 필요한 경우 저장 버튼을 누르세요.</p><div class="example-list"></div><div class="dialog-actions"><button class="examples-close primary" type="button">닫기</button></div></section>`; app.querySelector(".app")!.append(examplesLayer);
const restoreLayer = document.createElement("div"); restoreLayer.className = "dialog-layer"; restoreLayer.hidden = true; restoreLayer.innerHTML = `<section class="content-dialog restore-dialog" role="dialog" aria-modal="true" aria-labelledby="restore-title" aria-describedby="restore-description"><h2 id="restore-title">전체 복원 미리보기</h2><p id="restore-description">백업 내용을 확인하고 같은 이름의 파일 처리 방법을 선택하세요.</p><div class="restore-scroll"><dl class="restore-summary"><div><dt>백업 생성</dt><dd class="restore-created"></dd></div><div><dt>백업 앱 버전</dt><dd class="restore-version"></dd></div><div><dt>백업 파일</dt><dd class="restore-count"></dd></div><div><dt>새 파일</dt><dd class="restore-added"></dd></div><div><dt>이름 충돌</dt><dd class="restore-conflicts"></dd></div><div><dt>복원 후 예상 크기</dt><dd class="restore-size"></dd></div></dl><fieldset><legend>같은 이름의 파일 처리</legend><label><input type="radio" name="restore-policy" value="keep" checked /> 기존 파일 유지</label><label><input type="radio" name="restore-policy" value="overwrite" /> 백업 파일로 덮어쓰기</label><label><input type="radio" name="restore-policy" value="rename" /> 백업 파일 이름 변경</label></fieldset><p class="restore-error" role="alert" hidden></p></div><div class="dialog-actions"><button class="restore-cancel" type="button">취소</button><button class="restore-confirm primary" type="button">전체 복원</button></div></section>`; app.querySelector(".app")!.append(restoreLayer);
const restoreInput = document.createElement("input"); restoreInput.className = "restore-input"; restoreInput.type = "file"; restoreInput.accept = ".pylab-backup.json,application/json"; restoreInput.hidden = true; app.querySelector(".app")!.append(restoreInput);
const diagnosticsLayer = document.createElement("div"); diagnosticsLayer.className = "dialog-layer"; diagnosticsLayer.hidden = true; diagnosticsLayer.innerHTML = `<section class="content-dialog diagnostics-dialog" role="dialog" aria-modal="true" aria-labelledby="diagnostics-title" aria-describedby="diagnostics-description"><h2 id="diagnostics-title">환경 정보 확인</h2><p id="diagnostics-description">아래 정보에는 코드, 파일명, 입력값, 전체 브라우저 문자열이 포함되지 않습니다. 확인한 뒤 복사하세요.</p><div class="dialog-scroll"><pre class="diagnostics-preview" tabindex="0"></pre><p class="diagnostics-status" role="status" aria-live="polite"></p></div><div class="dialog-actions"><button class="diagnostics-close" type="button">닫기</button><button class="diagnostics-copy primary" type="button">환경 정보 복사</button></div></section>`; app.querySelector(".app")!.append(diagnosticsLayer);
const operationsHelp = document.createElement("section"); operationsHelp.innerHTML = `<h3>전체 백업·복원</h3><ul><li><strong>전체 백업</strong>은 저장된 파일만 한 JSON 파일로 내려받습니다. 편집 중인 미저장 내용은 선택 없이 자동 저장하지 않습니다.</li><li><strong>전체 복원</strong>은 백업을 먼저 검사한 뒤 새 파일 추가, 기존 파일 유지·덮어쓰기·이름 변경을 한 번에 처리합니다.</li><li>백업 파일은 기기 사이 이동에 사용하며, 브라우저 캐시나 앱 설정은 포함하지 않습니다.</li></ul><p class="storage-info" role="status">저장 공간 정보를 확인하는 중입니다.</p>`;
helpLayer.querySelector<HTMLElement>(".dialog-scroll")!.append(operationsHelp);
helpLayer.querySelector<HTMLElement>(".dialog-actions")!.prepend(Object.assign(document.createElement("button"), { className: "show-diagnostics", type: "button", textContent: "환경 정보 확인" }));
helpLayer.querySelector<HTMLElement>(".app-version")!.textContent = APP_VERSION;

const focusReturns = new WeakMap<HTMLElement, HTMLElement>();
const focusableIn = (layer: HTMLElement): HTMLElement[] => Array.from(layer.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')).filter(element => !element.hidden);
const openLayer = (layer: HTMLElement, initial: HTMLElement, cancel: () => void): void => {
  if (document.activeElement instanceof HTMLElement) focusReturns.set(layer, document.activeElement);
  layer.hidden = false;
  layer.onkeydown = event => {
    if (event.key === "Escape") { event.preventDefault(); cancel(); return; }
    if (event.key !== "Tab") return;
    const focusable = focusableIn(layer); if (!focusable.length) return;
    const first = focusable[0], last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  queueMicrotask(() => initial.focus());
};
const closeLayer = (layer: HTMLElement): void => {
  layer.hidden = true; layer.onkeydown = null;
  const previous = focusReturns.get(layer); focusReturns.delete(layer);
  if (previous?.isConnected) previous.focus();
};
const host = app.querySelector<HTMLElement>(".editor-host")!, consoleEl = app.querySelector<HTMLElement>(".console")!, textView = app.querySelector<HTMLElement>(".text-view")!, graphicsView = app.querySelector<HTMLElement>(".graphics-view")!, graphicsTab = app.querySelector<HTMLButtonElement>(".graphics-tab")!, textTab = app.querySelector<HTMLButtonElement>('[data-result-tab="text"]')!, turtleRenderer = new TurtleCanvasRenderer(app.querySelector<HTMLCanvasElement>(".turtle-canvas")!);
const runButton = app.querySelector<HTMLButtonElement>(".run")!, stopButton = app.querySelector<HTMLButtonElement>(".stop")!, modified = app.querySelector<HTMLElement>(".modified")!, nameEl = app.querySelector<HTMLElement>(".current-name")!, filePanel = app.querySelector<HTMLElement>(".file-panel")!, fileList = app.querySelector<HTMLElement>(".file-list")!, dialog = app.querySelector<HTMLElement>(".save-layer")!;
const connectionEl = appStatus.querySelector<HTMLElement>(".connection-status")!, pwaMessage = appStatus.querySelector<HTMLElement>(".pwa-message")!, iosInstallHint = appStatus.querySelector<HTMLElement>(".ios-install-hint")!, updateNotice = appStatus.querySelector<HTMLElement>(".update-notice")!, updateButton = appStatus.querySelector<HTMLButtonElement>(".update")!, installButton = appStatus.querySelector<HTMLButtonElement>(".install")!;
let dirty = false, restoring = false, worker: Worker | undefined, editor: LearningEditor, currentName = "main.py";
let lastExecution: LastExecutionCategory = "실행 전";
let files = new Map<string, AppFile>();
const append = (text: string, className = "console-line") => { const node = document.createElement("span"); node.className = className; node.textContent = text; if (className === "console-error") node.setAttribute("role", "alert"); consoleEl.append(node); consoleEl.scrollTop = consoleEl.scrollHeight; };
const clearConsole = () => consoleEl.replaceChildren();
const status = (text: string) => append(text, "console-status");
const setRunning = (value: boolean) => { runButton.disabled = value; stopButton.disabled = !value; consoleEl.setAttribute("aria-busy", String(value)); };
const setDirty = (value: boolean) => { dirty = value; modified.textContent = value ? " *" : ""; };
const selectResult = (kind: "text" | "graphics") => { const graphics = kind === "graphics"; textView.hidden = graphics; graphicsView.hidden = !graphics; textTab.classList.toggle("selected", !graphics); graphicsTab.classList.toggle("selected", graphics); textTab.setAttribute("aria-selected", String(!graphics)); graphicsTab.setAttribute("aria-selected", String(graphics)); };
const showGraphics = () => { graphicsTab.hidden = false; selectResult("graphics"); };
const typeLabel = (name: string) => name.split(".").at(-1)?.toUpperCase() ?? "파일";
const renderFiles = () => { fileList.replaceChildren(...[...files.values()].sort((a, b) => a.name.localeCompare(b.name, "ko")).map(file => { const button = document.createElement("button"); button.type = "button"; button.className = `file-item${file.name === currentName ? " selected" : ""}`; button.setAttribute("aria-current", String(file.name === currentName)); button.innerHTML = `<span></span><small>${typeLabel(file.name)}</small>`; button.querySelector("span")!.textContent = file.name; button.title = `가져오기 인코딩: ${file.encoding.toUpperCase()} · 원본 ${file.byteSize}바이트`; button.addEventListener("click", () => openFile(file.name)); return button; })); };
const save = async (name = currentName, content = editor.value): Promise<boolean> => { try { const previous = files.get(name); const file = appFile(name, content, Date.now(), previous?.encoding ?? "utf-8", previous?.byteSize); await checkedPut(store, file); files.set(name, file); currentName = name; nameEl.textContent = name; setDirty(false); renderFiles(); return true; } catch { append("파일을 저장할 수 없습니다.", "console-error"); return false; } };
const chooseUnsaved = (purpose: "replace" | "backup" = "replace"): Promise<"save" | "discard" | "cancel"> => new Promise(resolve => {
  dialog.querySelector<HTMLElement>("#save-question")!.textContent = purpose === "backup" ? "현재 문서와 전체 백업" : "변경 사항 저장";
  dialog.querySelector<HTMLElement>("#save-detail")!.textContent = purpose === "backup" ? "편집 중인 문서는 아직 저장되지 않았습니다. 어떻게 백업할까요?" : "현재 문서의 변경 사항을 저장하시겠습니까?";
  dialog.querySelector<HTMLButtonElement>('[data-choice="save"]')!.textContent = purpose === "backup" ? "현재 문서 저장 후 백업" : "저장";
  dialog.querySelector<HTMLButtonElement>('[data-choice="discard"]')!.textContent = purpose === "backup" ? "저장하지 않은 상태로 백업" : "저장하지 않음";
  const buttons = dialog.querySelectorAll<HTMLButtonElement>("button");
  const done = (choice: "save" | "discard" | "cancel") => { closeLayer(dialog); buttons.forEach(button => button.onclick = null); resolve(choice); };
  buttons.forEach(button => button.onclick = () => done(button.dataset.choice as "save" | "discard" | "cancel"));
  openLayer(dialog, dialog.querySelector<HTMLButtonElement>('[data-choice="save"]')!, () => done("cancel"));
});
const askName = (question: string, value: string): Promise<string | undefined> => new Promise(resolve => { const input = nameLayer.querySelector<HTMLInputElement>(".name-input")!; nameLayer.querySelector<HTMLElement>(".name-question")!.textContent = question; input.value = value; const done = (result?: string) => { closeLayer(nameLayer); resolve(result); }; nameLayer.querySelector<HTMLButtonElement>(".name-confirm")!.onclick = () => done(input.value); nameLayer.querySelector<HTMLButtonElement>(".name-cancel")!.onclick = () => done(); openLayer(nameLayer, input, () => done()); });
const protect = async (next: () => void | Promise<void>): Promise<boolean> => { if (dirty) { const choice = await chooseUnsaved(); if (choice === "cancel") return false; if (choice === "save" && !await save()) return false; } await next(); return true; };
const nextNewName = () => { let index = 1, name = "새 파일.py"; while (files.has(name)) name = `새 파일 ${++index}.py`; return name; };
async function openFile(name: string): Promise<void> { const file = files.get(name); if (!file) return; await protect(() => { currentName = name; nameEl.textContent = name; editor.setValue(file.content); setDirty(false); renderFiles(); }); }
const newFile = async () => protect(() => { currentName = nextNewName(); nameEl.textContent = currentName; editor.setValue(""); setDirty(false); renderFiles(); });
const saveAs = async () => { const entered = await askName("새 파일 이름을 입력하세요.", currentName); if (entered === undefined) return; const name = normalizeName(entered); if (!validFileName(name)) { window.alert("파일 이름이 올바르지 않습니다."); return; } if (files.has(name) && !window.confirm(`'${name}' 파일을 덮어쓸까요?`)) return; await save(name); };
const removeCurrent = async () => protect(async () => { if (!files.has(currentName) || !window.confirm(`'${currentName}' 파일을 삭제할까요?`)) return; try { await store.delete(currentName); files.delete(currentName); currentName = nextNewName(); nameEl.textContent = currentName; editor.setValue(""); setDirty(false); renderFiles(); } catch { append("파일을 삭제할 수 없습니다.", "console-error"); } });
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
      await checkedPut(store, file); files.set(name, file); renderFiles(); close();
      append(`${name} 파일을 ${decoded.encoding === "euc-kr" ? "EUC-KR" : "UTF-8"}로 가져왔습니다.\n`, "console-status");
      if (name.endsWith(".py")) await openFile(name);
    } catch (reason) {
      error.textContent = reason instanceof FileDecodingError ? reason.message : "파일을 가져올 수 없습니다.";
      error.hidden = false; select.focus(); input.value = "";
    }
  };
  openLayer(importLayer, select, close);
};
const exportFile = () => { const blob = new Blob([editor.value], { type: "text/plain;charset=utf-8" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = currentName; link.click(); URL.revokeObjectURL(link.href); };
const downloadText = (text: string, name: string, type: string): void => { const blob = new Blob([text], { type }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0); };
const backupAll = async (): Promise<void> => {
  if (dirty) {
    const choice = await chooseUnsaved("backup");
    if (choice === "cancel") return;
    if (choice === "save" && !await save()) return;
  }
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
  if (dirty) {
    const choice = await chooseUnsaved();
    if (choice === "cancel") return;
    if (choice === "save" && !await save()) return;
  }
  restoring = true;
  const restoreButton = app.querySelector<HTMLButtonElement>(".restore-all")!;
  restoreButton.disabled = true; updateButton.disabled = true;
  try {
    const existing = await store.list();
    const restored = buildRestoreSet(existing, backup, selectedRestorePolicy());
    await store.replaceAll(restored);
    files = new Map(restored.map(file => [file.name, file]));
    let opened = files.get(currentName);
    if (!opened) { opened = restored.find(file => file.name.endsWith(".py")); currentName = opened?.name ?? nextNewName(); }
    nameEl.textContent = currentName;
    editor.setValue(opened?.content ?? ""); setDirty(false); renderFiles();
    status(`전체 복원이 완료되었습니다. 저장 파일 ${restored.length}개\n`);
  } catch (reason) {
    append(reason instanceof BackupValidationError ? reason.message : "전체 복원에 실패했습니다. 기존 파일은 변경되지 않았습니다.", "console-error");
  } finally {
    pendingBackup = undefined; restoring = false; restoreButton.disabled = false; updateButton.disabled = false; restoreInput.value = "";
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
const showWelcomeDialog = (): void => {
  const remember = welcomeLayer.querySelector<HTMLInputElement>(".welcome-remember")!;
  remember.checked = true;
  const close = () => {
    try { rememberWelcomeClosed(localStorage, remember.checked); } catch { /* 설정 저장을 사용할 수 없어도 안내창은 닫습니다. */ }
    closeLayer(welcomeLayer);
  };
  welcomeLayer.querySelector<HTMLButtonElement>(".welcome-close")!.onclick = close;
  openLayer(welcomeLayer, welcomeLayer.querySelector<HTMLButtonElement>(".welcome-close")!, close);
};
const utf8Size = (text: string): number => new TextEncoder().encode(text).length;
const formatBytes = (value: number): string => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}MB` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}KB` : `${value}바이트`;
const updateStorageInfo = async (): Promise<void> => {
  const target = helpLayer.querySelector<HTMLElement>(".storage-info")!;
  const saved = await store.list().catch(() => []);
  const appBytes = saved.reduce((sum, file) => sum + utf8Size(file.content), 0);
  if (!navigator.storage?.estimate) { target.textContent = `저장 파일 ${saved.length}개 · 앱 파일 약 ${formatBytes(appBytes)} · 브라우저 저장 공간 정보는 이 환경에서 확인할 수 없습니다.`; return; }
  try {
    const estimate = await navigator.storage.estimate();
    target.textContent = `저장 파일 ${saved.length}개 · 앱 파일 약 ${formatBytes(appBytes)} · 브라우저 사용량 ${formatBytes(estimate.usage ?? 0)} / 할당량 ${formatBytes(estimate.quota ?? 0)}`;
  } catch { target.textContent = `저장 파일 ${saved.length}개 · 앱 파일 약 ${formatBytes(appBytes)} · 브라우저 저장 공간 정보를 확인할 수 없습니다.`; }
};
const installedPwa = (): boolean => matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
const showDiagnosticsDialog = async (): Promise<void> => {
  const saved = await store.list().catch(() => []);
  const text = formatDiagnostics({
    appVersion: APP_VERSION,
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    userAgent: navigator.userAgent,
    online: navigator.onLine,
    serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
    installedPwa: installedPwa(),
    savedFileCount: saved.length,
    approximateBytes: saved.reduce((sum, file) => sum + utf8Size(file.content), 0),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    lastExecution,
  });
  const preview = diagnosticsLayer.querySelector<HTMLElement>(".diagnostics-preview")!;
  const copyStatus = diagnosticsLayer.querySelector<HTMLElement>(".diagnostics-status")!;
  preview.textContent = text; copyStatus.textContent = "";
  const close = () => closeLayer(diagnosticsLayer);
  diagnosticsLayer.querySelector<HTMLButtonElement>(".diagnostics-close")!.onclick = close;
  diagnosticsLayer.querySelector<HTMLButtonElement>(".diagnostics-copy")!.onclick = async () => {
    try { await navigator.clipboard.writeText(text); copyStatus.textContent = "환경 정보를 복사했습니다."; }
    catch { copyStatus.textContent = "자동 복사를 사용할 수 없습니다. 위 내용을 선택해 복사해 주세요."; preview.focus(); }
  };
  openLayer(diagnosticsLayer, diagnosticsLayer.querySelector<HTMLButtonElement>(".diagnostics-copy")!, close);
};
const showHelpDialog = (): void => {
  const close = () => closeLayer(helpLayer);
  helpLayer.querySelector<HTMLButtonElement>(".help-close")!.onclick = close;
  helpLayer.querySelector<HTMLButtonElement>(".show-welcome")!.onclick = () => { close(); showWelcomeDialog(); };
  helpLayer.querySelector<HTMLButtonElement>(".show-diagnostics")!.onclick = () => { close(); void showDiagnosticsDialog(); };
  void updateStorageInfo();
  openLayer(helpLayer, helpLayer.querySelector<HTMLButtonElement>(".help-close")!, close);
};
const loadExample = async (example: ClassroomExample): Promise<void> => {
  closeLayer(examplesLayer);
  await protect(() => {
    const document = exampleDocument(example);
    currentName = document.name;
    nameEl.textContent = currentName;
    editor.setValue(document.content);
    setDirty(document.dirty);
    renderFiles();
  });
};
const exampleList = examplesLayer.querySelector<HTMLElement>(".example-list")!;
exampleList.replaceChildren(...CLASSROOM_EXAMPLES.map((example, index) => {
  const button = document.createElement("button");
  const descriptionId = `example-description-${index}`;
  button.type = "button"; button.className = "example-item"; button.dataset.exampleId = example.id; button.setAttribute("aria-describedby", descriptionId);
  button.innerHTML = `<strong></strong><span id="${descriptionId}"></span>`;
  button.querySelector("strong")!.textContent = example.title;
  button.querySelector("span")!.textContent = example.description;
  button.addEventListener("click", () => { void loadExample(example); });
  return button;
}));
const showExamplesDialog = (): void => {
  const close = () => closeLayer(examplesLayer);
  examplesLayer.querySelector<HTMLButtonElement>(".examples-close")!.onclick = close;
  openLayer(examplesLayer, examplesLayer.querySelector<HTMLButtonElement>(".example-item")!, close);
};
editor = new LearningEditor(host, initialCode, () => { if (!dirty) setDirty(true); editor.setError(null); });
app.querySelector<HTMLButtonElement>(".tab-button")!.addEventListener("click", () => editor.insertTab()); app.querySelector<HTMLButtonElement>(".clear")!.addEventListener("click", clearConsole); app.querySelector<HTMLButtonElement>(".new-file")!.addEventListener("click", newFile); app.querySelector<HTMLButtonElement>(".save")!.addEventListener("click", () => save()); app.querySelector<HTMLButtonElement>(".save-as")!.addEventListener("click", saveAs); app.querySelector<HTMLButtonElement>(".import")!.addEventListener("click", importFile); app.querySelector<HTMLButtonElement>(".export")!.addEventListener("click", exportFile); app.querySelector<HTMLButtonElement>(".backup-all")!.addEventListener("click", () => { void backupAll(); }); app.querySelector<HTMLButtonElement>(".restore-all")!.addEventListener("click", restoreAll); app.querySelector<HTMLButtonElement>(".delete-file")!.addEventListener("click", removeCurrent); app.querySelector<HTMLButtonElement>(".examples-toggle")!.addEventListener("click", showExamplesDialog); app.querySelector<HTMLButtonElement>(".help-toggle")!.addEventListener("click", showHelpDialog); app.querySelector<HTMLButtonElement>(".files-toggle")!.addEventListener("click", event => { const button = event.currentTarget as HTMLButtonElement; const shown = filePanel.classList.toggle("show"); button.setAttribute("aria-expanded", String(shown)); }); textTab.addEventListener("click", () => selectResult("text")); graphicsTab.addEventListener("click", () => selectResult("graphics"));
window.addEventListener("beforeunload", event => { if (dirty || restoring) event.preventDefault(); });
function showInput(prompt: string): void { const row = document.createElement("form"); row.className = "input-row"; row.innerHTML = `<span class="sr-only" role="status">프로그램이 입력을 기다리고 있습니다.</span><span class="input-prompt"></span><input class="console-input" aria-label="프로그램 입력" autocomplete="off" /><button class="input-submit" type="submit">입력</button>`; row.querySelector<HTMLElement>(".input-prompt")!.textContent = prompt; const input = row.querySelector<HTMLInputElement>("input")!; row.addEventListener("submit", event => { event.preventDefault(); const value = input.value; const answer = document.createElement("span"); answer.className = "console-line"; answer.textContent = `${prompt}${value}\n`; row.replaceWith(answer); worker?.postMessage({ type: "input", value } satisfies ToWorker); }); consoleEl.append(row); input.focus({ preventScroll: false }); row.scrollIntoView({ block: "nearest" }); }
function finish(kind: "complete" | "stopped"): void { lastExecution = kind === "complete" ? "성공" : "사용자 중지"; status(kind === "complete" ? "실행이 완료되었습니다." : "실행이 중지되었습니다."); setRunning(false); worker?.terminate(); worker = undefined; }
function receive(message: FromWorker): void { switch (message.type) { case "output": append(message.text); break; case "graphics": showGraphics(); turtleRenderer.apply(message.commands); break; case "input-request": showInput(message.prompt); break; case "file-change": { const file = appFile(message.name, message.content); files.set(file.name, file); renderFiles(); checkedPut(store, file).catch(() => append("파일 변경을 저장할 수 없습니다.", "console-error")); break; } case "error": lastExecution = executionErrorCategory(message.error.message); editor.setError(message.error.line); append(`${message.error.line}번째 줄: ${message.error.message}`, "console-error"); setRunning(false); worker?.terminate(); worker = undefined; break; case "complete": finish("complete"); break; case "stopped": finish("stopped"); break; } }
runButton.addEventListener("click", () => { if (restoring) return; worker?.terminate(); clearConsole(); turtleRenderer.reset(); graphicsTab.hidden = true; selectResult("text"); editor.setError(null); setRunning(true); status("실행 중..."); worker = new Worker(new URL("./runtime/worker.ts", import.meta.url), { type: "module" }); worker.onmessage = ({ data }: MessageEvent<FromWorker>) => receive(data); worker.onerror = () => { lastExecution = "시스템 오류"; append("실행 중 오류가 발생했습니다.", "console-error"); setRunning(false); worker?.terminate(); worker = undefined; }; worker.postMessage({ type: "run", code: editor.value, files: [...files.values()].map(file => ({ name: file.name, content: file.content, encoding: file.encoding })) } satisfies ToWorker); });
stopButton.addEventListener("click", () => worker?.postMessage({ type: "stop" } satisfies ToWorker));
store.list().then(saved => { files = new Map(saved.map(file => [file.name, file])); renderFiles(); }).catch(() => append("저장소를 열 수 없습니다.", "console-error"));
setupPwa({
  onConnection: text => { connectionEl.textContent = text; },
  onMessage: text => { pwaMessage.textContent = text; pwaMessage.hidden = false; },
  onIosInstallHint: () => { iosInstallHint.hidden = false; },
  onInstallAvailable: install => { installButton.hidden = false; installButton.onclick = async () => { await install(); installButton.hidden = true; }; },
  onUpdate: activate => {
    updateNotice.hidden = false; updateButton.hidden = false;
    updateButton.onclick = async () => {
      if (restoring) { pwaMessage.textContent = "전체 복원이 끝난 뒤 업데이트해 주세요."; pwaMessage.hidden = false; return; }
      if (dirty) { const choice = await chooseUnsaved(); if (choice === "cancel") return; if (choice === "save" && !await save()) return; }
      updateButton.disabled = true; activate();
    };
  },
});

try {
  if (shouldShowWelcome(localStorage)) showWelcomeDialog();
} catch {
  showWelcomeDialog();
}
