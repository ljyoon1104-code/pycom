import { afterEach, describe, expect, it, vi } from "vitest";
import { backupJsonBytes, MAX_BACKUP_JSON_BYTES } from "./backup-budget";
import { appFile, MemoryFileStore } from "./storage";
import { BackupValidationError, createWorkspaceBackup, serializeWorkspaceBackup } from "./backup";
import { fileNameLabel } from "./file-name";

const file = (name: string, content = "") => appFile(name, content, 123);
const document = (files: ReturnType<typeof file>[]) => createWorkspaceBackup(files, "2.1.0", new Date("2026-11-11T00:00:00.000Z"));
afterEach(() => vi.restoreAllMocks());

describe("backup JSON allocation preflight", () => {
  it.each(["plain ASCII", "한글 é 😀", '"quoted" \\slash', "\b\t\n\f\r\u0000\u001f", "\ud800x\udc00", "\u2028\u2029"])("%s의 JSON 이스케이프와 UTF-8 크기를 정확히 센다", content => {
    const backup = document([file("학생.py", content)]);
    const actual = new TextEncoder().encode(serializeWorkspaceBackup(backup)).length;
    expect(backupJsonBytes(backup)).toBe(actual);
    expect(backupJsonBytes(backup, actual)).toBe(actual);
    expect(backupJsonBytes(backup, actual - 1)).toBe(actual);
  });
  it("파일 없는 배열과 여러 파일의 들여쓰기·쉼표를 정확히 센다", () => {
    for (const items of [[], [file("a.py"), file("b.txt", "x")]]) {
      const backup = document(items);
      expect(backupJsonBytes(backup)).toBe(new TextEncoder().encode(JSON.stringify(backup, null, 2) + "\n").length);
    }
  });
  it("일반 ASCII 내용의 기존 10MB 저장 용량을 그대로 허용한다", async () => {
    const files = Array.from({ length: 10 }, (_, i) => file(`data-${i}.txt`, "x".repeat(1_000_000)));
    const store = new MemoryFileStore(); await store.replaceAll(files);
    expect(await store.list()).toHaveLength(10);
    expect(backupJsonBytes(document(files))).toBeLessThan(MAX_BACKUP_JSON_BYTES);
  });
  it("총 13.5MB의 안전한 파일명을 전체 JSON 할당 전에 거부한다", async () => {
    // Constructed only in Node tests; never feed an unbounded browser workload.
    const stem = "가".repeat(45_000), files = Array.from({ length: 100 }, (_, i) => file(`${stem}${i}.py`));
    const stringify = vi.spyOn(JSON, "stringify");
    const store = new MemoryFileStore(); await expect(store.replaceAll(files)).rejects.toThrow("backup-limit");
    expect(await store.list()).toEqual([]);
    expect(() => document(files)).toThrow(BackupValidationError);
    expect(stringify.mock.calls.some(([value]) => typeof value === "object" && value !== null && "files" in value)).toBe(false);
  });
  it("제어 문자의 6배 JSON 확장을 새 쓰기 전에 제한한다", async () => {
    const files = Array.from({ length: 3 }, (_, i) => file(`control-${i}.txt`, "\u0000".repeat(990_000)));
    const store = new MemoryFileStore(); await store.put(file("safe.py", "saved")); const before = await store.list();
    await expect(store.updateFiles(current => [...current, ...files])).rejects.toThrow("backup-limit");
    expect(await store.list()).toEqual(before);
    expect(() => document(files)).toThrow("개별 내보내기");
  });
  it("백업 예산에 걸리는 동시 쓰기는 하나만 커밋한다", async () => {
    const store = new MemoryFileStore(); await store.replaceAll([file("old-a.txt", "\u0000".repeat(900_000)), file("old-b.txt", "\u0000".repeat(900_000))]);
    const outcomes = await Promise.allSettled([store.put(file("new-a.txt", "\u0000".repeat(200_000))), store.put(file("new-b.txt", "\u0000".repeat(200_000)))]);
    expect(outcomes.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
    expect((outcomes[1] as PromiseRejectedResult).reason.message).toBe("backup-limit");
    expect((await store.list()).map(item => item.name)).toContain("new-a.txt");
    expect((await store.list()).map(item => item.name)).not.toContain("new-b.txt");
  });
  it("기존 초과 자료를 보존하고 삭제를 통한 공간 회복은 허용한다", async () => {
    const store = new MemoryFileStore(), stem = "가".repeat(45_000);
    for (let i = 0; i < 100; i++) { const item = file(`${stem}${i}.py`); store.files.set(item.name, item); }
    expect(() => document([...store.files.values()])).toThrow("개별 내보내기");
    expect(store.files.size).toBe(100);
    await store.delete(`${stem}0.py`); expect(store.files.size).toBe(99);
    expect(store.files.has(`${stem}1.py`)).toBe(true);
  });
  it("백업 객체를 만든 뒤 커진 내용도 serialize 직전에 거부한다", () => {
    const backup = document([file("a.txt")]);
    backup.files[0].content = "\u0000".repeat(2_100_000);
    const stringify = vi.spyOn(JSON, "stringify");
    expect(() => serializeWorkspaceBackup(backup)).toThrow("12.5MB");
    expect(stringify.mock.calls.some(([value]) => value === backup)).toBe(false);
  });
  it("거대한 파일명과 위장 제어 문자 진단은 짧게 표시한다", () => {
    const name = "\u202e".repeat(100_000);
    const label = fileNameLabel(name);
    expect(label.length).toBeLessThan(1_300); expect(label).toContain("100000자");
    expect(label).not.toContain("\u202e"); expect(label).toContain("\\u202e");
    expect(fileNameLabel("학생.py")).toBe('"학생.py"');
  });
});
