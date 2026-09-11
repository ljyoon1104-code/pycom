import { describe, expect, it } from "vitest";
import { browserProduct, executionErrorCategory, formatDiagnostics, osFamily, type DiagnosticSnapshot } from "./diagnostics";

const snapshot: DiagnosticSnapshot = { appVersion: "1.1.0", backupFormatVersion: 1, userAgent: "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36", online: true, serviceWorkerControlled: true, installedPwa: false, savedFileCount: 5, approximateBytes: 321, viewportWidth: 360, viewportHeight: 800, lastExecution: "성공" };

describe("개인정보를 제외한 환경 정보", () => {
  it("브라우저 제품과 주 버전만 표시한다", () => expect(browserProduct(snapshot.userAgent)).toBe("Chrome 140"));
  it("Edge를 Chrome보다 먼저 구분한다", () => expect(browserProduct("Chrome/140.0 Edg/140.0")).toBe("Edge 140"));
  it("운영체제 계열만 표시한다", () => { expect(osFamily(snapshot.userAgent)).toBe("Windows"); expect(osFamily("Mozilla Android Chrome/140.0")).toBe("Android"); });
  it("저장 파일 수와 근사 크기를 포함한다", () => { const text = formatDiagnostics(snapshot); expect(text).toContain("저장 파일 수: 5"); expect(text).toContain("321바이트"); });
  it("화면·온라인·PWA 상태를 포함한다", () => { const text = formatDiagnostics(snapshot); expect(text).toContain("360×800"); expect(text).toContain("온라인 상태: 온라인"); expect(text).toContain("PWA 설치 실행: 아니요"); });
  it("전체 User-Agent나 세부 버전을 노출하지 않는다", () => { const text = formatDiagnostics(snapshot); expect(text).not.toContain(snapshot.userAgent); expect(text).not.toContain("140.0.0.0"); });
  it("코드·파일명·입력값 필드가 없다", () => { const text = formatDiagnostics(snapshot); expect(text).not.toMatch(/코드 내용|파일명|입력값|쿠키|토큰|IP 주소/); });
  it("학생 오류 메시지를 범주로만 바꾼다", () => { expect(executionErrorCategory("파일을 찾을 수 없습니다.")).toBe("파일 오류"); expect(executionErrorCategory("이름이 정의되지 않았습니다.")).toBe("실행 오류"); });
  it("문법과 실행 제한을 별도 범주로 구분한다", () => { expect(executionErrorCategory("문법이 올바르지 않습니다.")).toBe("문법 오류"); expect(executionErrorCategory("출력 제한을 초과했습니다.")).toBe("실행 제한"); });
});
