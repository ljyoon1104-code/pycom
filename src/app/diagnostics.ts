export type LastExecutionCategory = "실행 전" | "성공" | "사용자 중지" | "문법 오류" | "파일 오류" | "실행 제한" | "실행 오류" | "시스템 오류";

export type DiagnosticSnapshot = {
  appVersion: string;
  backupFormatVersion: number;
  userAgent: string;
  online: boolean;
  serviceWorkerControlled: boolean;
  installedPwa: boolean;
  savedFileCount: number;
  approximateBytes: number;
  viewportWidth: number;
  viewportHeight: number;
  lastExecution: LastExecutionCategory;
};

export function browserProduct(userAgent: string): string {
  const match = userAgent.match(/Edg\/(\d+)/) ?? userAgent.match(/Chrome\/(\d+)/) ?? userAgent.match(/Firefox\/(\d+)/) ?? userAgent.match(/Version\/(\d+).+Safari\//);
  if (!match) return "알 수 없는 브라우저";
  const product = match[0].startsWith("Edg/") ? "Edge" : match[0].startsWith("Chrome/") ? "Chrome" : match[0].startsWith("Firefox/") ? "Firefox" : "Safari";
  return `${product} ${match[1]}`;
}

export function osFamily(userAgent: string): string {
  if (/Windows/i.test(userAgent)) return "Windows";
  if (/Android/i.test(userAgent)) return "Android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "iOS/iPadOS";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "macOS";
  if (/Linux/i.test(userAgent)) return "Linux";
  return "알 수 없음";
}

export function executionErrorCategory(message: string): LastExecutionCategory {
  if (/문법|닫히지|예상하지 못한|들여쓰기/.test(message)) return "문법 오류";
  if (/파일|인코딩/.test(message)) return "파일 오류";
  if (/제한|너무 많은|중단/.test(message)) return "실행 제한";
  return "실행 오류";
}

export function formatDiagnostics(snapshot: DiagnosticSnapshot): string {
  return [
    `앱 버전: ${snapshot.appVersion}`,
    `백업 형식 버전: ${snapshot.backupFormatVersion}`,
    `브라우저: ${browserProduct(snapshot.userAgent)}`,
    `운영체제: ${osFamily(snapshot.userAgent)}`,
    `온라인 상태: ${snapshot.online ? "온라인" : "오프라인"}`,
    `Service Worker 제어: ${snapshot.serviceWorkerControlled ? "예" : "아니요"}`,
    `PWA 설치 실행: ${snapshot.installedPwa ? "예" : "아니요"}`,
    `저장 파일 수: ${snapshot.savedFileCount}`,
    `저장 파일 근사 크기: ${snapshot.approximateBytes}바이트`,
    `화면 크기: ${snapshot.viewportWidth}×${snapshot.viewportHeight}`,
    `마지막 실행: ${snapshot.lastExecution}`,
  ].join("\n");
}
