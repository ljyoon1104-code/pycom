import { CLASSROOM_EXAMPLES, exampleDocument, rememberWelcomeClosed, type ClassroomExample } from "../app/classroom";
import { APP_VERSION } from "../app/version";
import { formatDiagnostics, type LastExecutionCategory } from "../app/diagnostics";
import { BACKUP_FORMAT_VERSION } from "../files/backup";
import type { FileStore } from "../files/storage";
import type { createAppShell } from "./app-shell";
import type { DialogController } from "./dialogs";
import { formatBytes, utf8Size } from "./presentation";
import { RESOURCE_LIMITS } from "../runtime/resource-limits";
import { STOP_GRACE_MS } from "../app/execution-session";
import { MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from "../files/storage";
import { MAX_BACKUP_JSON_BYTES } from "../files/backup-budget";

type Options = Pick<ReturnType<typeof createAppShell>, "welcomeLayer" | "helpLayer" | "diagnosticsLayer" | "examplesLayer"> & DialogController & {
  store: FileStore;
  lastExecution: () => LastExecutionCategory;
  onExample: (name: string, content: string) => void;
};

export function createHelpController({ welcomeLayer, helpLayer, diagnosticsLayer, examplesLayer, store, lastExecution, onExample, openLayer, closeLayer }: Options) {
  const executionHelp = document.createElement("section");
  executionHelp.innerHTML = `<h3>실행 흐름 따라가기</h3><ul><li><strong>일반</strong>: 기존 속도로 실행하고 입력 대기 줄을 표시합니다.</li><li><strong>따라가기</strong>: 노란 강조·화살표는 다음에 실행할 문장입니다. 간격 100ms·500ms·1초를 선택하고 일시정지·계속·중지할 수 있습니다.</li><li><strong>한 단계</strong>: 첫 문장 앞에서 멈추며 다음 단계로 함수·메서드·콜백 안으로 들어갑니다. 계속 실행은 따라가기로 전환합니다.</li><li>입력은 실제 답을 기다립니다. 다음 단계로 건너뛸 수 없고 중지는 입력 대기도 취소합니다.</li><li>따라가기·한 단계에 참여하는 문서는 읽기 전용이며 중지·완료·오류 후 편집할 수 있습니다. 다른 탭은 계속 편집할 수 있습니다.</li><li>모듈은 마지막 저장본을 실행합니다. 초안과 다르면 ‘실행 중인 저장본’을 임시로 보여주며 초안·실행 취소 기록은 유지합니다.</li><li>빈 줄·주석·pass·global·nonlocal, 내장 함수와 내포의 내부 반복은 별도 단계로 표시하지 않습니다. 그 안에서 호출한 사용자 함수는 표시합니다. 동기 콜백 안의 input()은 기존과 같이 지원하지 않습니다.</li><li>중단점·변수 감시·호출 스택 화면·뒤로 실행·함수 건너뛰기는 제공하지 않습니다. 새로고침하면 실행 상태는 복원하지 않고 일반 모드로 시작합니다.</li></ul>`;
  helpLayer.querySelector(".dialog-scroll")!.prepend(executionHelp);
  const fileSafety = document.createElement("section");
  fileSafety.innerHTML = `<h3>실행과 파일 보관</h3><p>코드 편집 내용은 저장 버튼으로 저장합니다. Python open()의 쓰기·추가 실행은 기기에 저장된 파일을 변경할 수 있습니다. 출처를 모르는 코드는 실행 전에 확인하고 중요한 파일은 백업하세요.</p><p>문자열 생성·출력은 ${RESOURCE_LIMITS.stringCharacters.toLocaleString('ko-KR')} 크기, 컬렉션은 ${RESOURCE_LIMITS.collectionItems.toLocaleString('ko-KR')}개로 제한합니다. 컬렉션 문자열 변환은 중첩 ${RESOURCE_LIMITS.representationDepth}단계·방문 ${RESOURCE_LIMITS.representationVisits.toLocaleString('ko-KR')}회까지이며, 형식 지정자는 ${RESOURCE_LIMITS.formatSpecifierCharacters}자·소수 정밀도 ${RESOURCE_LIMITS.formatPrecision}까지입니다. 이 실행 제한은 except로 잡을 수 없습니다.</p><p>중지 요청에 ${STOP_GRACE_MS/1000}초 동안 응답하지 않으면 실행기를 강제 종료합니다. 저장 완료가 확인되지 않은 파일 변경은 반영되지 않았을 수 있습니다. 파일 본문은 한 번에 ${MAX_FILE_BYTES/1_000_000}MB 한 건이며, 파일 이름과 내용을 합한 전송·대기 중 변경은 ${MAX_FILES}건·${MAX_TOTAL_BYTES/1_000_000}MB 이내로 유지합니다.</p><p>전체 백업은 파일명과 이스케이프 문자를 포함한 JSON 크기 ${MAX_BACKUP_JSON_BYTES/1_000_000}MB까지입니다. 새 저장도 이 예산을 확인하며, 이미 초과한 기존 자료는 유지하고 개별 내보내기를 안내합니다.</p><p>파일명은 기기 폴더 경로가 아닌 앱 내부 이름입니다. 다른 브라우저 탭의 저장도 순서대로 처리하며, 같은 이름에 명시적으로 저장하면 마지막으로 완료된 저장이 적용됩니다. 수정 중인 초안은 덮어쓰지 않고 충돌을 안내합니다.</p>`;
  helpLayer.querySelector(".dialog-scroll")!.prepend(fileSafety);
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
      lastExecution: lastExecution(),
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
    const document = exampleDocument(example);
    onExample(document.name, document.content);
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
  return { showWelcomeDialog, showHelpDialog, showExamplesDialog };
}
