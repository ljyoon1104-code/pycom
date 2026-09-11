import { normalizeEncoding, type StoredEncoding } from "./encoding";
import { appFile, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, validFileName, validateFileSet, type AppFile } from "./storage";

export const BACKUP_FORMAT = "python-learning-lab-backup";
export const BACKUP_FORMAT_VERSION = 1;
export const MAX_BACKUP_JSON_BYTES = 12_500_000;

export type BackupFile = {
  name: string;
  content: string;
  encoding: StoredEncoding;
  originalByteSize: number;
  updatedAt: string;
};

export type WorkspaceBackup = {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  appVersion: string;
  createdAt: string;
  files: BackupFile[];
};

export type ConflictPolicy = "keep" | "overwrite" | "rename";

export type RestorePreview = {
  createdAt: string;
  appVersion: string;
  fileCount: number;
  addCount: number;
  conflictCount: number;
  expectedBytes: number;
};

export class BackupValidationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const validIsoTime = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
const safeAppVersion = (value: unknown): string => typeof value === "string" && value.trim() && value.length <= 80 ? value : "알 수 없음";

export const validBackupFileName = (name: string): boolean => {
  if (!validFileName(name) || name.length > 180 || name !== name.trim()) return false;
  if (/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(name) || /[. ]$/.test(name)) return false;
  if (!/\.(py|txt|csv)$/iu.test(name)) return false;
  const stem = name.slice(0, name.lastIndexOf("."));
  return !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(stem);
};

export function createWorkspaceBackup(files: readonly AppFile[], appVersion: string, now = new Date()): WorkspaceBackup {
  validateFileSet(files);
  if (!validIsoTime(now.toISOString())) throw new BackupValidationError("invalid-time", "백업 생성 시각이 올바르지 않습니다.");
  const names = new Set<string>();
  const backupFiles = files
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "ko"))
    .map(file => {
      if (!validBackupFileName(file.name) || names.has(file.name)) throw new BackupValidationError("invalid-file", "백업할 파일 정보가 올바르지 않습니다.");
      names.add(file.name);
      if (!Number.isFinite(file.updatedAt)) throw new BackupValidationError("invalid-time", "파일 수정 시각이 올바르지 않습니다.");
      if (!Number.isInteger(file.byteSize) || file.byteSize < 0 || file.byteSize > MAX_FILE_BYTES) throw new BackupValidationError("invalid-size", "파일 원본 크기 정보가 올바르지 않습니다.");
      return { name: file.name, content: file.content, encoding: file.encoding, originalByteSize: file.byteSize, updatedAt: new Date(file.updatedAt).toISOString() };
    });
  return { format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, appVersion: safeAppVersion(appVersion), createdAt: now.toISOString(), files: backupFiles };
}

export const serializeWorkspaceBackup = (backup: WorkspaceBackup): string => `${JSON.stringify(backup, null, 2)}\n`;

const validationError = (code: string, message: string): never => { throw new BackupValidationError(code, message); };

function migrateVersion1(raw: Record<string, unknown>): WorkspaceBackup {
  if (!validIsoTime(raw.createdAt)) validationError("invalid-created-at", "백업 생성 시각이 올바르지 않습니다.");
  const createdAt = raw.createdAt as string;
  const rawFiles = raw.files;
  if (!Array.isArray(rawFiles)) validationError("invalid-files", "백업 파일 목록이 올바르지 않습니다.");
  const candidates = rawFiles as unknown[];
  if (candidates.length > MAX_FILES) validationError("count-limit", `백업은 파일 ${MAX_FILES}개를 넘을 수 없습니다.`);

  const names = new Set<string>();
  let total = 0;
  const files = candidates.map((candidate: unknown, index: number): BackupFile => {
    if (!record(candidate)) validationError("invalid-file", `${index + 1}번째 백업 파일 정보가 올바르지 않습니다.`);
    const item = candidate as Record<string, unknown>;
    const rawName = item.name;
    if (typeof rawName !== "string" || !validBackupFileName(rawName)) validationError("invalid-name", `${index + 1}번째 백업 파일 이름이 올바르지 않습니다.`);
    const name = rawName as string;
    if (names.has(name)) validationError("duplicate-name", "백업에 같은 이름의 파일이 두 번 들어 있습니다.");
    names.add(name);
    if (typeof item.content !== "string") validationError("invalid-content", `${name} 파일 내용이 올바르지 않습니다.`);
    const content = item.content as string;
    const size = utf8Bytes(content);
    if (size > MAX_FILE_BYTES) validationError("file-limit", `${name} 파일이 허용 크기를 넘습니다.`);
    total += size;
    if (total > MAX_TOTAL_BYTES) validationError("total-limit", "백업의 전체 파일 크기가 허용 한도를 넘습니다.");

    let encoding: StoredEncoding;
    try { encoding = item.encoding === undefined ? "utf-8" : normalizeEncoding(String(item.encoding)); }
    catch { validationError("invalid-encoding", `${name} 파일의 인코딩 정보가 올바르지 않습니다.`); }
    const originalByteSize = item.originalByteSize === undefined ? size : item.originalByteSize;
    if (!Number.isInteger(originalByteSize) || (originalByteSize as number) < 0 || (originalByteSize as number) > MAX_FILE_BYTES) validationError("invalid-size", `${name} 파일의 원본 크기 정보가 올바르지 않습니다.`);
    const updatedAt = item.updatedAt === undefined ? createdAt : item.updatedAt;
    if (!validIsoTime(updatedAt)) validationError("invalid-time", `${name} 파일의 수정 시각이 올바르지 않습니다.`);
    return { name, content, encoding: encoding!, originalByteSize: originalByteSize as number, updatedAt: updatedAt as string };
  });
  return { format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, appVersion: safeAppVersion(raw.appVersion), createdAt, files };
}

export function parseWorkspaceBackup(text: string): WorkspaceBackup {
  if (utf8Bytes(text) > MAX_BACKUP_JSON_BYTES) validationError("json-limit", "백업 파일이 너무 큽니다.");
  let raw: unknown;
  try { raw = JSON.parse(text) as unknown; }
  catch { validationError("invalid-json", "백업 파일을 읽을 수 없습니다. 올바른 JSON 백업인지 확인해 주세요."); }
  if (!record(raw)) validationError("invalid-format", "Python 학습실 전체 백업 파일이 아닙니다.");
  const document = raw as Record<string, unknown>;
  if (document.format !== BACKUP_FORMAT) validationError("invalid-format", "Python 학습실 전체 백업 파일이 아닙니다.");
  if (!Number.isInteger(document.formatVersion)) validationError("invalid-version", "백업 형식 버전이 올바르지 않습니다.");
  if ((document.formatVersion as number) > BACKUP_FORMAT_VERSION) validationError("future-version", "이 백업은 더 새로운 앱에서 만들어졌습니다. 앱을 업데이트한 뒤 다시 시도해 주세요.");
  if (document.formatVersion !== 1) validationError("old-version", "이 백업 형식은 현재 지원하지 않습니다.");
  return migrateVersion1(document);
}

export const backupFilesToAppFiles = (backup: WorkspaceBackup): AppFile[] => backup.files.map(file => appFile(file.name, file.content, Date.parse(file.updatedAt), file.encoding, file.originalByteSize));

export function renamedRestoreName(name: string, occupied: ReadonlySet<string>): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  let index = 1;
  let candidate = `${stem} (복원 ${index})${extension}`;
  while (occupied.has(candidate)) candidate = `${stem} (복원 ${++index})${extension}`;
  return candidate;
}

export function buildRestoreSet(existing: readonly AppFile[], backup: WorkspaceBackup, policy: ConflictPolicy): AppFile[] {
  const result = new Map(existing.map(file => [file.name, file]));
  const incoming = backupFilesToAppFiles(backup);
  const occupied = new Set([...result.keys(), ...incoming.map(file => file.name)]);
  for (const file of incoming) {
    if (!result.has(file.name) || policy === "overwrite") result.set(file.name, file);
    else if (policy === "rename") {
      const name = renamedRestoreName(file.name, occupied);
      occupied.add(name);
      result.set(name, { ...file, name });
    }
  }
  const files = [...result.values()];
  try { validateFileSet(files); }
  catch (error) {
    const code = error instanceof Error ? error.message : "restore-limit";
    if (code === "count-limit") validationError(code, `복원 후 파일 수는 ${MAX_FILES}개를 넘을 수 없습니다.`);
    if (code === "file-limit") validationError(code, "복원할 파일 하나가 허용 크기를 넘습니다.");
    if (code === "total-limit") validationError(code, "복원 후 전체 파일 크기가 허용 한도를 넘습니다.");
    validationError("restore-invalid", "복원할 파일 구성이 올바르지 않습니다.");
  }
  return files.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

export function restorePreview(existing: readonly AppFile[], backup: WorkspaceBackup, policy: ConflictPolicy): RestorePreview {
  const existingNames = new Set(existing.map(file => file.name));
  const conflictCount = backup.files.filter(file => existingNames.has(file.name)).length;
  const finalFiles = buildRestoreSet(existing, backup, policy);
  return {
    createdAt: backup.createdAt,
    appVersion: backup.appVersion,
    fileCount: backup.files.length,
    addCount: backup.files.length - conflictCount,
    conflictCount,
    expectedBytes: finalFiles.reduce((sum, file) => sum + utf8Bytes(file.content), 0),
  };
}

export const backupDownloadName = (now = new Date()): string => `python-learning-lab-${now.toISOString().slice(0, 10)}.pylab-backup.json`;
