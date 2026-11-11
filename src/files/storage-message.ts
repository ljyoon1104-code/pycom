import { MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from "./storage";
import { MAX_BACKUP_JSON_BYTES } from "./backup-budget";

export function storageFailureMessage(reason: unknown): string {
  const code=reason instanceof Error ? reason.message : "";
  if(code==='count-limit')return `저장 파일은 ${MAX_FILES}개를 넘을 수 없습니다.`;
  if(code==='file-limit')return `파일 하나는 ${MAX_FILE_BYTES/1_000_000}MB를 넘을 수 없습니다.`;
  if(code==='total-limit')return `저장 파일 전체는 ${MAX_TOTAL_BYTES/1_000_000}MB를 넘을 수 없습니다.`;
  if(code==='invalid-name')return "파일 이름에 경로·제어문자·위장 공백을 사용할 수 없습니다.";
  if(code==='backup-limit')return `파일 이름과 이스케이프 문자를 포함한 전체 백업이 ${MAX_BACKUP_JSON_BYTES/1_000_000}MB를 넘습니다. 기존 파일은 유지됩니다. 개별 내보내기로 보존해 주세요.`;
  return "파일 변경을 저장하지 못했습니다. 기존 저장 파일과 편집 내용을 확인해 주세요.";
}
