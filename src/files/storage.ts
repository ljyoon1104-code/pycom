import type { StoredEncoding } from "./encoding";
import { validVirtualFileName } from "./file-name";
import { assertExportableFileSet } from "./backup-budget";

export type AppFile = { name: string; content: string; updatedAt: number; encoding: StoredEncoding; byteSize: number };
type LegacyAppFile = Partial<AppFile> & { name: string; content: string; updatedAt: number };

export interface FileStore {
  list(): Promise<AppFile[]>;
  get(name: string): Promise<AppFile | undefined>;
  put(file: AppFile): Promise<void>;
  delete(name: string): Promise<void>;
  replaceAll(files: readonly AppFile[]): Promise<void>;
  /** Read/merge/validate/write inside one transaction. The callback must be synchronous. */
  updateFiles(transform: (current: readonly AppFile[]) => readonly AppFile[]): Promise<AppFile[]>;
}

export const MAX_FILE_BYTES = 1_000_000;
export const MAX_TOTAL_BYTES = 10_000_000;
export const MAX_FILES = 100;
const bytes = (text: string) => new TextEncoder().encode(text).length;
export const appFile = (name: string, content: string, updatedAt = Date.now(), encoding: StoredEncoding = "utf-8", byteSize = bytes(content)): AppFile => ({ name, content, updatedAt, encoding, byteSize });
export const migrateFile = (file: LegacyAppFile): AppFile => appFile(file.name, file.content, file.updatedAt, file.encoding ?? "utf-8", file.byteSize ?? bytes(file.content));

export const validFileName = validVirtualFileName;
export const normalizeName = (name: string): string => { const trimmed = name.trim(); return /\.(py|txt|csv)$/i.test(trimmed) ? trimmed : `${trimmed}.py`; };

export class MemoryFileStore implements FileStore {
  readonly files = new Map<string, AppFile>();
  private pending: Promise<unknown> = Promise.resolve();
  async list(): Promise<AppFile[]> { await this.pending; return [...this.files.values()].map(file => ({ ...file })).sort((a, b) => a.name.localeCompare(b.name, "ko")); }
  async get(name: string): Promise<AppFile | undefined> { await this.pending; const file = this.files.get(name); return file && { ...file }; }
  async put(file: AppFile): Promise<void> { await this.updateFiles(current => [...current.filter(item => item.name !== file.name), file]); }
  async delete(name: string): Promise<void> {
    // Deletion must remain possible even for a legacy workspace above current limits.
    const operation = this.pending.then(() => { this.files.delete(name); });
    this.pending = operation.then(() => undefined, () => undefined); await operation;
  }
  async replaceAll(files: readonly AppFile[]): Promise<void> {
    await this.updateFiles(() => files);
  }
  updateFiles(transform: (current: readonly AppFile[]) => readonly AppFile[]): Promise<AppFile[]> {
    const operation = this.pending.then(() => {
      const next = transform([...this.files.values()].map(file => ({ ...file }))).map(migrateFile);
      validateFileSet(next);
      this.files.clear(); next.forEach(file => this.files.set(file.name, file));
      return next.map(file => ({ ...file })).sort((a, b) => a.name.localeCompare(b.name, "ko"));
    });
    this.pending = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

export class IndexedDbFileStore implements FileStore {
  private db?: Promise<IDBDatabase>;
  private channel?: BroadcastChannel;
  private listeners = new Set<() => void>();
  private ensureChannel(): void {
    if (this.channel || typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
    try {
      this.channel = new BroadcastChannel("python-learning-lab-files");
      this.channel.onmessage = event => { if (event.data?.type === "files-changed") for (const listener of this.listeners) listener(); };
    } catch { /* Atomic IndexedDB writes still work without cross-tab UI notifications. */ }
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener); this.ensureChannel();
    return () => { this.listeners.delete(listener); if (!this.listeners.size) { this.channel?.close(); this.channel = undefined; } };
  }
  private changed(): void {
    try { this.ensureChannel(); this.channel?.postMessage({ type: "files-changed" }); }
    catch { /* A notification failure must not turn a committed save into a reported failure. */ }
  }
  private open(): Promise<IDBDatabase> {
    if (!this.db) this.db = new Promise((resolve, reject) => {
      const request = indexedDB.open("python-learning-lab-files", 2);
      request.onupgradeneeded = event => {
        const store = request.result.objectStoreNames.contains("files") ? request.transaction!.objectStore("files") : request.result.createObjectStore("files", { keyPath: "name" });
        if ((event as IDBVersionChangeEvent).oldVersion < 2) {
          const cursor = store.openCursor();
          cursor.onsuccess = () => { const row = cursor.result; if (row) { row.update(migrateFile(row.value)); row.continue(); } };
        }
      };
      request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); this.db = undefined; }; resolve(db); };
      request.onerror = () => reject(request.error);
    });
    return this.db;
  }
  private async transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("files", mode);
      let result: T;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error ?? new Error("file-transaction-aborted"));
      transaction.onerror = () => { /* The final abort event reports failed persistence. */ };
      try { const request = action(transaction.objectStore("files")); request.onsuccess = () => { result = request.result; }; }
      catch (error) { try { transaction.abort(); } catch { /* Already finished. */ } reject(error); }
    });
  }
  async list(): Promise<AppFile[]> { return (await this.transaction<LegacyAppFile[]>("readonly", store => store.getAll())).map(migrateFile).sort((a, b) => a.name.localeCompare(b.name, "ko")); }
  async get(name: string): Promise<AppFile | undefined> { const file = await this.transaction<LegacyAppFile | undefined>("readonly", store => store.get(name)); return file && migrateFile(file); }
  async put(file: AppFile): Promise<void> { await this.updateFiles(current => [...current.filter(item => item.name !== file.name), file]); }
  async delete(name: string): Promise<void> { await this.transaction("readwrite", store => store.delete(name)); this.changed(); }
  async replaceAll(files: readonly AppFile[]): Promise<void> {
    await this.updateFiles(() => files);
  }
  async updateFiles(transform: (current: readonly AppFile[]) => readonly AppFile[]): Promise<AppFile[]> {
    const db = await this.open();
    const result = await new Promise<AppFile[]>((resolve, reject) => {
      const transaction = db.transaction("files", "readwrite");
      const store = transaction.objectStore("files");
      let result: AppFile[] = [], failure: unknown;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error("file-transaction-aborted"));
      transaction.onerror = () => { /* onabort reports the final transaction failure */ };
      const abort = (error: unknown) => { failure = error; try { transaction.abort(); } catch { reject(error); } };
      try { const read = store.getAll(); read.onsuccess = () => {
        try {
          const current = (read.result as LegacyAppFile[]).map(migrateFile);
          const prior = new Map(current.map(file => [file.name, { ...file }]));
          const proposed = transform(current.map(file => ({ ...file })));
          if (!Array.isArray(proposed)) throw new Error("invalid-file-update");
          result = proposed.map(migrateFile);
          validateFileSet(result);
          const names = new Set(result.map(file => file.name));
          for (const file of prior.values()) if (!names.has(file.name)) store.delete(file.name);
          for (const file of result) {
            const before = prior.get(file.name);
            if (!before || before.content !== file.content || before.updatedAt !== file.updatedAt || before.encoding !== file.encoding || before.byteSize !== file.byteSize) store.put(file);
          }
          result.sort((a, b) => a.name.localeCompare(b.name, "ko"));
        } catch (error) { abort(error); }
      }; } catch (error) { abort(error); }
    });
    this.changed(); return result;
  }
}

export function validateFileSet(files: readonly AppFile[], options: { backupBudget?: boolean } = {}): void {
  if (files.length > MAX_FILES) throw new Error("count-limit");
  const names = new Set<string>();
  let total = 0;
  for (const file of files) {
    if (!validFileName(file.name) || names.has(file.name)) throw new Error("invalid-name");
    names.add(file.name);
    const size = bytes(file.content);
    if (size > MAX_FILE_BYTES) throw new Error("file-limit");
    total += size;
  }
  if (total > MAX_TOTAL_BYTES) throw new Error("total-limit");
  if (options.backupBudget !== false) assertExportableFileSet(files);
}

export async function checkedPut(store: FileStore, file: AppFile): Promise<void> {
  await store.put(file);
}
