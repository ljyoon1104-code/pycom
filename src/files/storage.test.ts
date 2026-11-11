import { describe, expect, it } from "vitest";
import { appFile, checkedPut, MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES, MemoryFileStore, validFileName } from "./storage";
import { buildRestoreSet, createWorkspaceBackup, parseWorkspaceBackup, serializeWorkspaceBackup, validBackupFileName } from "./backup";
import { compile } from "../compiler/compiler";
import { VM, type VMEvent } from "../runtime/vm";

const file = (name: string, content = "") => appFile(name, content, 123);
const snapshot = (items: ReturnType<typeof file>[]) => createWorkspaceBackup(items, "2.1.0", new Date("2026-11-11T00:00:00.000Z"));

describe("atomic storage mutations", () => {
  it("99개에서 두 동시 저장 중 한 개만 성공한다", async () => {
    const store = new MemoryFileStore();
    await store.replaceAll(Array.from({ length: 99 }, (_, i) => file(`old-${i}.txt`)));
    const results = await Promise.allSettled([checkedPut(store, file("a.txt")), checkedPut(store, file("b.txt"))]);
    expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
    expect((results[1] as PromiseRejectedResult).reason.message).toBe("count-limit");
    expect(await store.list()).toHaveLength(MAX_FILES);
    expect(await store.get("a.txt")).toBeDefined(); expect(await store.get("b.txt")).toBeUndefined();
  });
  it("전체 용량 경계의 동시 저장을 순서대로 검증한다", async () => {
    const store = new MemoryFileStore();
    await store.replaceAll(Array.from({ length: 10 }, (_, i) => file(`large-${i}.txt`, "x".repeat(MAX_FILE_BYTES - 1))));
    const results = await Promise.allSettled([store.put(file("a.txt", "123456")), store.put(file("b.txt", "123456"))]);
    expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
    expect((results[1] as PromiseRejectedResult).reason.message).toBe("total-limit");
    const total = (await store.list()).reduce((sum, item) => sum + new TextEncoder().encode(item.content).length, 0);
    expect(total).toBe(MAX_TOTAL_BYTES - 4);
  });
  it("같은 파일에 명시적으로 저장한 순서를 보존한다", async () => {
    const store = new MemoryFileStore();
    await Promise.all([store.put(file("same.txt", "first")), store.put(file("same.txt", "second"))]);
    expect((await store.get("same.txt"))?.content).toBe("second");
  });
  it("복원은 이전 미리보기가 아니라 실제 커밋 시점의 파일을 합친다", async () => {
    const store = new MemoryFileStore(); await store.put(file("existing.py", "before"));
    const stalePreview = await store.list();
    const backup = snapshot([file("backup.py", "backup")]);
    await Promise.all([store.put(file("other-tab.py", "new")), store.updateFiles(current => buildRestoreSet(current, backup, "keep"))]);
    expect(stalePreview.map(item => item.name)).not.toContain("other-tab.py");
    expect((await store.list()).map(item => item.name)).toEqual(["backup.py", "existing.py", "other-tab.py"]);
  });
  it("동시 복원 keep 충돌은 최신 저장 내용을 유지한다", async () => {
    const store = new MemoryFileStore(); await store.put(file("same.py", "old"));
    const backup = snapshot([file("same.py", "backup")]);
    await Promise.all([store.put(file("same.py", "other tab")), store.updateFiles(current => buildRestoreSet(current, backup, "keep"))]);
    expect((await store.get("same.py"))?.content).toBe("other tab");
  });
  it("동시 복원 rename 충돌은 최신 파일을 보존하고 이름을 배정한다", async () => {
    const store = new MemoryFileStore(); await store.put(file("same.py", "old"));
    const backup = snapshot([file("same.py", "backup")]);
    await Promise.all([store.put(file("same (복원 1).py", "other tab")), store.updateFiles(current => buildRestoreSet(current, backup, "rename"))]);
    expect((await store.get("same (복원 1).py"))?.content).toBe("other tab");
    expect((await store.get("same (복원 2).py"))?.content).toBe("backup");
  });
  it("변환 또는 한도 검증 실패는 기존 집합을 유지한다", async () => {
    const store = new MemoryFileStore(); await store.put(file("safe.py", "saved")); const before = await store.list();
    await expect(store.updateFiles(current => { current[0].content = "changed"; throw Error("failed"); })).rejects.toThrow("failed");
    await expect(store.updateFiles(current => [...current, file("large.txt", "x".repeat(MAX_FILE_BYTES + 1))])).rejects.toThrow("file-limit");
    expect(await store.list()).toEqual(before);
  });
  it("실패한 저장 뒤 다음 저장을 정상 처리한다", async () => {
    const store = new MemoryFileStore();
    await expect(store.put(file("../bad.py"))).rejects.toThrow("invalid-name");
    await store.put(file("good.py", "good")); expect(await store.list()).toEqual([file("good.py", "good")]);
  });
});

describe("one virtual file name policy", () => {
  it.each(["CON.py", "AUX.txt", "com1.csv", "학생 😀.py", "e\u0301.txt", "data", "photo.png", `${"가".repeat(200)}.py`])("안전한 가상 이름 %s을 저장·백업·복원한다", async name => {
    const store = new MemoryFileStore(); const original = file(name, "원본");
    expect(validFileName(name)).toBe(true); expect(validBackupFileName(name)).toBe(true);
    await checkedPut(store, original);
    const backup = parseWorkspaceBackup(serializeWorkspaceBackup(snapshot(await store.list())));
    await store.updateFiles(current => buildRestoreSet(current, backup, "rename"));
    expect((await store.get(name))?.content).toBe("원본");
    const renamed = (await store.list()).find(item => item.name !== name)!;
    expect(renamed.content).toBe("원본"); expect(validBackupFileName(renamed.name)).toBe(true);
    expect(parseWorkspaceBackup(serializeWorkspaceBackup(snapshot(await store.list()))).files).toHaveLength(2);
  });
  it.each(["../a.py", "a/b.py", "a\\b.py", "C:a.py", " a.py", "a.py ", "a.py.", "a\u0000.py", "a\u0085.py", "a\u202E.py", "a\u2066.py"])("위험하거나 위장한 이름 %s은 모든 경로에서 거부한다", async name => {
    const store = new MemoryFileStore(); expect(validFileName(name)).toBe(false); expect(validBackupFileName(name)).toBe(false);
    await expect(checkedPut(store, file(name))).rejects.toThrow("invalid-name");
    expect(() => snapshot([file(name)])).toThrow("개별 내보내기");
  });
  it("오래된 잘못된 파일을 지우지 않고 구체적인 보존 안내를 한다", async () => {
    const store = new MemoryFileStore(); store.files.set("bad\u202E.py", file("bad\u202E.py", "important"));
    expect(() => snapshot([...store.files.values()])).toThrow('"bad\\u202e.py"');
    expect((await store.get("bad\u202E.py"))?.content).toBe("important");
  });
  it("Python open도 같은 가상 파일명 정책을 사용한다", () => {
    const events: VMEvent[] = [];
    new VM(compile('with open("CON.py", "w") as f:\n    f.write("saved")\nwith open("CON.py") as f:\n    print(f.read())'), event => events.push(event)).execute();
    expect(events.filter(event => event.type === "output").map(event => event.text).join("")).toBe("saved\n");
    expect(events.at(-1)?.type).toBe("complete");
  });
});
