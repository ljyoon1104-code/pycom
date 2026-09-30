import { CLASSROOM_EXAMPLES, exampleDocument, rememberWelcomeClosed, type ClassroomExample } from "../app/classroom";
import { APP_VERSION } from "../app/version";
import { formatDiagnostics, type LastExecutionCategory } from "../app/diagnostics";
import { BACKUP_FORMAT_VERSION } from "../files/backup";
import type { FileStore } from "../files/storage";
import type { createAppShell } from "./app-shell";
import type { DialogController } from "./dialogs";
import { formatBytes, utf8Size } from "./presentation";

type Options = Pick<ReturnType<typeof createAppShell>, "welcomeLayer" | "helpLayer" | "diagnosticsLayer" | "examplesLayer"> & DialogController & {
  store: FileStore;
  lastExecution: () => LastExecutionCategory;
  onExample: (name: string, content: string) => void;
};

export function createHelpController({ welcomeLayer, helpLayer, diagnosticsLayer, examplesLayer, store, lastExecution, onExample, openLayer, closeLayer }: Options) {
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
