import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CACHE_PREFIX, connectionText, isIosBrowser, MANIFEST, shouldConfirmUpdate, shouldShowInstall } from "./config";
import { serviceWorkerUrl } from "./register";
import { buildServiceWorker, shellFiles } from "./service-worker";

const publicFile = (name: string) => readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8");
const worker = () => buildServiceWorker(["assets/index-a.js", "assets/worker-b.js", "assets/index-c.css"]);

describe("8단계 PWA", () => {
  it("매니페스트 필수 항목을 제공한다", () => {
    const manifest = JSON.parse(publicFile("manifest.webmanifest"));
    expect(manifest).toMatchObject(MANIFEST);
    expect(manifest.icons).toHaveLength(3);
  });
  it("학습용 아이콘과 favicon을 제공한다", () => {
    expect(publicFile("icons/icon-192.svg")).toContain('width="192"');
    expect(publicFile("icons/icon-512.svg")).toContain('width="512"');
    expect(publicFile("icons/maskable.svg")).toContain('width="512"');
    expect(publicFile("icons/favicon.svg")).toContain("<svg");
  });
  it("앱 셸과 매니페스트를 사전 캐시한다", () => {
    expect(shellFiles).toEqual(expect.arrayContaining(["./", "./index.html", "./manifest.webmanifest"]));
    expect(worker()).toContain("cache.addAll(PRECACHE)");
  });
  it("인터프리터 Worker 번들을 오프라인 캐시에 포함한다", () => expect(worker()).toContain("./assets/worker-b.js"));
  it("오래된 앱 캐시만 정리한다", () => {
    expect(worker()).toContain(`name.startsWith(CACHE_PREFIX)`);
    expect(worker()).not.toContain("indexedDB.deleteDatabase");
  });
  it("사용자 IndexedDB 파일 저장소를 캐시 갱신과 분리한다", () => expect(worker()).not.toContain("python-learning-lab-files"));
  it("온라인과 오프라인 상태 문구를 구분한다", () => {
    expect(connectionText(true)).toBe("온라인");
    expect(connectionText(false)).toBe("오프라인 사용 중");
  });
  it("수정되지 않은 문서는 바로 업데이트할 수 있다", () => expect(shouldConfirmUpdate(false)).toBe(false));
  it("수정된 문서는 업데이트 전 저장 확인이 필요하다", () => expect(shouldConfirmUpdate(true)).toBe(true));
  it("설치 이벤트가 있을 때만 설치 버튼을 표시한다", () => expect(shouldShowInstall(true)).toBe(true));
  it("설치 이벤트가 없으면 설치 버튼을 숨긴다", () => expect(shouldShowInstall(false)).toBe(false));
  it("iPhone과 iPad 설치 안내 대상을 구분한다", () => {
    expect(isIosBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(true);
    expect(isIosBrowser("Mozilla/5.0 (Windows NT 10.0)")).toBe(false);
  });
  it("GitHub Pages 하위 경로에서 Service Worker 주소를 계산한다", () => {
    expect(serviceWorkerUrl("https://example.github.io/python-learning/assets/index-a.js")).toBe("https://example.github.io/python-learning/sw.js");
  });
  it("새 Worker는 사용자 선택 후에만 즉시 활성화한다", () => {
    const source = worker();
    expect(source).toContain('event.data?.type === "SKIP_WAITING"');
    expect(source).not.toContain('self.skipWaiting();\n});\n\nself.addEventListener("activate"');
  });
});
