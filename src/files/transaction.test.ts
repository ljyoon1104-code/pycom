import { afterEach, expect, it, vi } from "vitest";
import { appFile, IndexedDbFileStore } from "./storage";

afterEach(() => vi.unstubAllGlobals());
function database() {
  let success: (() => void) | undefined, complete: (() => void) | undefined, abort: (() => void) | undefined;
  const tx = { oncomplete: null as (() => void) | null, onabort: null as (() => void) | null, onerror: null, error: null, objectStore: () => ({ put: () => request, delete: () => request, getAll: () => request }), abort: () => tx.onabort?.() };
  const request = { result: undefined as unknown, onsuccess: null as (() => void) | null };
  vi.stubGlobal("indexedDB", { open: () => {
    const open = { result: { transaction: () => { success = () => request.onsuccess?.(); complete = () => tx.oncomplete?.(); abort = () => tx.onabort?.(); return tx; } }, onsuccess: null as (() => void) | null };
    queueMicrotask(() => open.onsuccess?.()); return open;
  } });
  return { ready: () => vi.waitFor(() => expect(success).toBeDefined()), success: () => success!(), complete: () => complete!(), abort: () => abort!() };
}
it("파일 저장은 요청 성공만으로 완료되지 않고 transaction commit을 기다린다", async () => {
  const db = database(); let settled = false; const pending = new IndexedDbFileStore().put(appFile("a.py", "A")).then(() => { settled = true; });
  await db.ready(); db.success(); await Promise.resolve(); expect(settled).toBe(false); db.complete(); await pending; expect(settled).toBe(true);
});
it("put 요청 성공 뒤 transaction abort가 나면 저장 실패를 반환한다", async () => {
  const db = database(), pending = new IndexedDbFileStore().put(appFile("a.py", "A")); const failure = expect(pending).rejects.toThrow("file-transaction-aborted");
  await db.ready(); db.success(); db.abort(); await failure;
});
it("파일 삭제도 transaction commit을 기다린다", async () => {
  const db = database(); let settled = false; const pending = new IndexedDbFileStore().delete("a.py").then(() => { settled = true; });
  await db.ready(); db.success(); await Promise.resolve(); expect(settled).toBe(false); db.complete(); await pending; expect(settled).toBe(true);
});
it("파일 삭제 transaction abort는 성공으로 표시되지 않는다", async () => {
  const db = database(), pending = new IndexedDbFileStore().delete("a.py"), failure = expect(pending).rejects.toThrow("file-transaction-aborted");
  await db.ready(); db.success(); db.abort(); await failure;
});
