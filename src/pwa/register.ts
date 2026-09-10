import { connectionText, isIosBrowser, shouldShowInstall } from "./config";

type InstallPromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type PwaOptions = {
  onConnection: (text: string) => void;
  onUpdate: (activate: () => void) => void;
  onMessage: (text: string) => void;
  onInstallAvailable: (install: () => Promise<void>) => void;
  onIosInstallHint: () => void;
};

export const serviceWorkerUrl = (moduleUrl: string): string => new URL("../sw.js", moduleUrl).href;

export function setupPwa(options: PwaOptions): void {
  const updateConnection = () => options.onConnection(connectionText(navigator.onLine));
  updateConnection();
  window.addEventListener("online", updateConnection);
  window.addEventListener("offline", updateConnection);

  let deferredInstall: InstallPromptEvent | undefined;
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstall = event as InstallPromptEvent;
    if (shouldShowInstall(true)) options.onInstallAvailable(async () => {
      if (!deferredInstall) return;
      try {
        await deferredInstall.prompt();
        await deferredInstall.userChoice;
      } finally {
        deferredInstall = undefined;
      }
    });
  });
  if (isIosBrowser(navigator.userAgent) && !("standalone" in navigator)) options.onIosInstallHint();
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  let reloadAfterUpdate = false;
  const startUpdate = (registration: ServiceWorkerRegistration) => {
    const waiting = registration.waiting;
    if (!waiting) return;
    options.onUpdate(() => {
      reloadAfterUpdate = true;
      try { waiting.postMessage({ type: "SKIP_WAITING" }); }
      catch { reloadAfterUpdate = false; options.onMessage("업데이트를 완료할 수 없습니다. 현재 버전을 계속 사용합니다."); }
    });
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (reloadAfterUpdate) window.location.reload(); });
  navigator.serviceWorker.register(serviceWorkerUrl(import.meta.url)).then(registration => {
    startUpdate(registration);
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      installing?.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) startUpdate(registration);
      });
    });
  }).catch(() => options.onMessage("오프라인 기능을 준비할 수 없습니다. 현재 앱은 계속 사용할 수 있습니다."));
}
