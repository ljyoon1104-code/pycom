import { describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BackupValidationError,
  backupDownloadName,
  buildRestoreSet,
  createWorkspaceBackup,
  parseWorkspaceBackup,
  renamedRestoreName,
  restorePreview,
  serializeWorkspaceBackup,
  validBackupFileName,
  type WorkspaceBackup,
} from "./backup";
import { appFile, MAX_FILE_BYTES, MemoryFileStore } from "./storage";

const when = Date.parse("2026-09-11T01:02:03.000Z");
const now = new Date("2026-09-11T04:05:06.000Z");
const file = (name: string, content: string, encoding: "utf-8" | "euc-kr" = "utf-8") => appFile(name, content, when, encoding, new TextEncoder().encode(content).length);
const backup = (items = [file("main.py", "print('안녕')")]): WorkspaceBackup => createWorkspaceBackup(items, "1.1.0", now);
const changed = (document: WorkspaceBackup, update: (raw: Record<string, unknown>) => void): string => {
  const raw = JSON.parse(JSON.stringify(document)) as Record<string, unknown>;
  update(raw);
  return JSON.stringify(raw);
};
const expectCode = (text: string, code: string) => {
  try { parseWorkspaceBackup(text); throw new Error("expected-validation-error"); }
  catch (error) { expect(error).toBeInstanceOf(BackupValidationError); expect((error as BackupValidationError).code).toBe(code); expect((error as Error).stack ?? "").not.toContain("print('안녕')"); }
};

describe("전체 백업 형식", () => {
  it("고정된 형식 식별자와 버전을 사용한다", () => { expect(BACKUP_FORMAT).toBe("python-learning-lab-backup"); expect(BACKUP_FORMAT_VERSION).toBe(1); });
  it("앱 버전과 생성 시각을 기록한다", () => { const value = backup(); expect(value).toMatchObject({ appVersion: "1.1.0", createdAt: now.toISOString(), formatVersion: 1 }); });
  it("파일을 이름순으로 저장한다", () => { expect(backup([file("z.py", "a"), file("a.py", "b")]).files.map(item => item.name)).toEqual(["a.py", "z.py"]); });
  it("필요한 파일 메타데이터만 기록한다", () => { expect(Object.keys(backup().files[0]).sort()).toEqual(["content", "encoding", "name", "originalByteSize", "updatedAt"]); });
  it("한글 내용을 UTF-8 JSON으로 왕복한다", () => { const parsed = parseWorkspaceBackup(serializeWorkspaceBackup(backup())); expect(parsed.files[0].content).toBe("print('안녕')"); });
  it("EUC-KR 원본 메타데이터를 보존한다", () => { const value = backup([appFile("학생.csv", "이름,점수", when, "euc-kr", 9)]); expect(parseWorkspaceBackup(serializeWorkspaceBackup(value)).files[0]).toMatchObject({ encoding: "euc-kr", originalByteSize: 9 }); });
  it("백업 파일명을 날짜와 전용 확장자로 만든다", () => expect(backupDownloadName(now)).toBe("python-learning-lab-2026-09-11.pylab-backup.json"));
  it("형식 1의 누락된 파일 메타데이터에 안전한 기본값을 넣는다", () => {
    const text = changed(backup(), raw => { const entry = (raw.files as Record<string, unknown>[])[0]; delete entry.encoding; delete entry.originalByteSize; delete entry.updatedAt; });
    expect(parseWorkspaceBackup(text).files[0]).toMatchObject({ encoding: "utf-8", updatedAt: now.toISOString() });
  });
  it("형식 1의 인코딩 별칭을 정규화한다", () => { const text = changed(backup(), raw => { (raw.files as Record<string, unknown>[])[0].encoding = "cp949"; }); expect(parseWorkspaceBackup(text).files[0].encoding).toBe("euc-kr"); });
  it("앱 버전 메타데이터가 없으면 안전한 표시값을 사용한다", () => { const text = changed(backup(), raw => { delete raw.appVersion; }); expect(parseWorkspaceBackup(text).appVersion).toBe("알 수 없음"); });
  it("저장 파일이 없는 빈 백업도 왕복한다", () => expect(parseWorkspaceBackup(serializeWorkspaceBackup(backup([]))).files).toEqual([]));
});

describe("전체 백업 입력 검증", () => {
  it("깨진 JSON을 거부한다", () => expectCode("{not-json", "invalid-json"));
  it("다른 형식 파일을 거부한다", () => expectCode(JSON.stringify({ format: "other", formatVersion: 1 }), "invalid-format"));
  it("숫자가 아닌 형식 버전을 거부한다", () => expectCode(changed(backup(), raw => { raw.formatVersion = "1"; }), "invalid-version"));
  it("미래 형식 버전을 별도 안내로 거부한다", () => expectCode(changed(backup(), raw => { raw.formatVersion = 2; }), "future-version"));
  it("지원하지 않는 과거 형식을 거부한다", () => expectCode(changed(backup(), raw => { raw.formatVersion = 0; }), "old-version"));
  it("파일 배열이 없으면 거부한다", () => expectCode(changed(backup(), raw => { raw.files = {}; }), "invalid-files"));
  it("파일 개수 제한을 검사한다", () => expectCode(changed(backup(), raw => { raw.files = Array.from({ length: 101 }, (_, index) => ({ name: `file-${index}.py`, content: "", encoding: "utf-8", originalByteSize: 0, updatedAt: now.toISOString() })); }), "count-limit"));
  it("중복 파일명을 거부한다", () => expectCode(changed(backup(), raw => { const first = (raw.files as unknown[])[0]; raw.files = [first, first]; }), "duplicate-name"));
  it("상위 경로 파일명을 거부한다", () => expectCode(changed(backup(), raw => { (raw.files as Record<string, unknown>[])[0].name = "../main.py"; }), "invalid-name"));
  it("절대 경로 파일명을 거부한다", () => expectCode(changed(backup(), raw => { (raw.files as Record<string, unknown>[])[0].name = "C:\\main.py"; }), "invalid-name"));
  it("허용하지 않는 파일 유형을 거부한다", () => expectCode(changed(backup(), raw => { (raw.files as Record<string, unknown>[])[0].name = "photo.png"; }), "invalid-name"));
  it("양방향 제어 문자를 넣은 위장 파일명을 거부한다", () => expect(validBackupFileName("report\u202Eyp.exe")).toBe(false));
  it("Windows 장치 예약 파일명을 거부한다", () => expect(validBackupFileName("CON.py")).toBe(false));
  it("문자열이 아닌 내용을 거부한다", () => expectCode(changed(backup(), raw => { (raw.files as Record<string, unknown>[])[0].content = { code: "secret" }; }), "invalid-content"));
  it("파일 하나의 크기 제한을 검사한다", () => expectCode(changed(backup(), raw => { (raw.files as Record<string, unknown>[])[0].content = "가".repeat(Math.ceil(MAX_FILE_BYTES / 3) + 1); }), "file-limit"));
  it("전체 내용 크기 제한을 검사한다", () => expectCode(changed(backup(), raw => { raw.files = Array.from({ length: 11 }, (_, index) => ({ name: `large-${index}.txt`, content: "x".repeat(950_000), encoding: "utf-8", originalByteSize: 950_000, updatedAt: now.toISOString() })); }), "total-limit"));
  it("과도하게 큰 JSON 자체를 파싱 전에 거부한다", () => expectCode(" ".repeat(12_500_001), "json-limit"));
  it("지원하지 않는 인코딩을 거부한다", () => expectCode(changed(backup(), raw => { (raw.files as Record<string, unknown>[])[0].encoding = "utf-16"; }), "invalid-encoding"));
  it("음수 원본 크기를 거부한다", () => expectCode(changed(backup(), raw => { (raw.files as Record<string, unknown>[])[0].originalByteSize = -1; }), "invalid-size"));
  it("잘못된 파일 시각을 거부한다", () => expectCode(changed(backup(), raw => { (raw.files as Record<string, unknown>[])[0].updatedAt = "어제"; }), "invalid-time"));
  it("잘못된 생성 시각을 거부한다", () => expectCode(changed(backup(), raw => { raw.createdAt = "2026-99-99"; }), "invalid-created-at"));
  it("프로토타입 키가 포함돼도 전역 객체를 오염시키지 않는다", () => {
    const text = serializeWorkspaceBackup(backup([file("safe.py", "__proto__ = {'polluted': True}")]));
    parseWorkspaceBackup(text); expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("전체 복원 계획", () => {
  const existing = [file("main.py", "old"), file("memo.txt", "memo")];
  const incoming = backup([file("main.py", "new"), file("조건문.py", "if True:\n    pass")]);

  it("미리보기의 추가와 충돌 개수를 계산한다", () => expect(restorePreview(existing, incoming, "keep")).toMatchObject({ fileCount: 2, addCount: 1, conflictCount: 1 }));
  it("기존 파일 유지 정책은 충돌 내용을 바꾸지 않는다", () => { const result = buildRestoreSet(existing, incoming, "keep"); expect(result.find(item => item.name === "main.py")?.content).toBe("old"); });
  it("덮어쓰기 정책은 백업 내용을 사용한다", () => { const result = buildRestoreSet(existing, incoming, "overwrite"); expect(result.find(item => item.name === "main.py")?.content).toBe("new"); });
  it("이름 변경 정책은 확장자 앞에 복원 번호를 붙인다", () => { const result = buildRestoreSet(existing, incoming, "rename"); expect(result.find(item => item.name === "main (복원 1).py")?.content).toBe("new"); });
  it("이미 사용 중인 복원 번호를 건너뛴다", () => expect(renamedRestoreName("main.py", new Set(["main.py", "main (복원 1).py"]))).toBe("main (복원 2).py"));
  it("텍스트와 CSV 확장자도 보존한다", () => { expect(renamedRestoreName("memo.txt", new Set(["memo.txt"]))).toBe("memo (복원 1).txt"); expect(renamedRestoreName("학생.csv", new Set(["학생.csv"]))).toBe("학생 (복원 1).csv"); });
  it("덮어쓰기에서도 충돌하지 않는 기존 파일을 보존한다", () => expect(buildRestoreSet(existing, incoming, "overwrite").map(item => item.name)).toContain("memo.txt"));
  it("복원 파일의 수정 시각과 인코딩을 보존한다", () => { const result = buildRestoreSet([], backup([appFile("학생.csv", "민수,90", when, "euc-kr", 7)]), "keep")[0]; expect(result).toMatchObject({ updatedAt: when, encoding: "euc-kr", byteSize: 7 }); });
  it("허용 파일 수를 넘는 합치기를 커밋 전에 거부한다", () => {
    const many = Array.from({ length: 100 }, (_, index) => file(`old-${index}.py`, ""));
    expect(() => buildRestoreSet(many, backup([file("new.py", "")]), "keep")).toThrow(BackupValidationError);
  });
  it("복원 검증 실패 시 메모리 저장소의 기존 집합이 유지된다", async () => {
    const store = new MemoryFileStore(); await store.put(existing[0]); const before = await store.list();
    const invalid = backup([file("new.py", "x")]); invalid.files[0].content = "가".repeat(Math.ceil(MAX_FILE_BYTES / 3) + 1);
    expect(() => buildRestoreSet(before, invalid, "keep")).toThrow(BackupValidationError);
    expect(await store.list()).toEqual(before);
  });
  it("메모리 저장소는 전체 집합을 한 번에 교체한다", async () => {
    const store = new MemoryFileStore(); await store.put(existing[0]); await store.replaceAll([file("new.py", "new")]);
    expect((await store.list()).map(item => item.name)).toEqual(["new.py"]);
  });
  it("교체 준비 중 읽기 오류가 나면 기존 메모리 파일을 지운 적이 없다", async () => {
    const store = new MemoryFileStore(); await store.put(existing[0]);
    const bad = new Proxy(file("bad.py", "x"), { get(target, property, receiver) { if (property === "content") throw new Error("simulated"); return Reflect.get(target, property, receiver); } });
    await expect(store.replaceAll([bad])).rejects.toThrow("simulated"); expect((await store.list())[0].content).toBe("old");
  });
});
