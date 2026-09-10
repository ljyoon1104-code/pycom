export const CACHE_PREFIX = "python-learning-app-";
export const MANIFEST = {
  name: "학생용 Python 학습 앱",
  short_name: "Python 학습",
  display: "standalone",
  orientation: "any",
  start_url: "./",
  scope: "./",
  lang: "ko",
  theme_color: "#171f2e",
  background_color: "#101622",
} as const;

export const connectionText = (online: boolean): string => online ? "온라인" : "오프라인 사용 중";
export const shouldConfirmUpdate = (isDirty: boolean): boolean => isDirty;
export const shouldShowInstall = (hasInstallPrompt: boolean): boolean => hasInstallPrompt;
export const isIosBrowser = (userAgent: string): boolean => /iPad|iPhone|iPod/i.test(userAgent);
