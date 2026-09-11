import type { StoredEncoding } from "./encoding";

export type AppFile = { name: string; content: string; updatedAt: number; encoding: StoredEncoding; byteSize: number };
type LegacyAppFile = Partial<AppFile> & { name: string; content: string; updatedAt: number };

export interface FileStore {
  list(): Promise<AppFile[]>;
  get(name: string): Promise<AppFile | undefined>;
  put(file: AppFile): Promise<void>;
  delete(name: string): Promise<void>;
}

export const MAX_FILE_BYTES = 1_000_000;
export const MAX_TOTAL_BYTES = 10_000_000;
export const MAX_FILES = 100;
const bytes = (text: string) => new TextEncoder().encode(text).length;
export const appFile = (name: string, content: string, updatedAt = Date.now(), encoding: StoredEncoding = "utf-8", byteSize = bytes(content)): AppFile => ({ name, content, updatedAt, encoding, byteSize });
export const migrateFile = (file: LegacyAppFile): AppFile => appFile(file.name, file.content, file.updatedAt, file.encoding ?? "utf-8", file.byteSize ?? bytes(file.content));

export const validFileName = (name: string): boolean => !!name.trim() && !/[\\/:*?"<>|]/.test(name) && !name.includes("..") && !/^[a-zA-Z]:/.test(name);
export const normalizeName = (name: string): string => { const trimmed = name.trim(); return /\.(py|txt|csv)$/i.test(trimmed) ? trimmed : `${trimmed}.py`; };

export class MemoryFileStore implements FileStore {
  readonly files = new Map<string, AppFile>();
  async list(): Promise<AppFile[]> { return [...this.files.values()].sort((a, b) => a.name.localeCompare(b.name, "ko")); }
  async get(name: string): Promise<AppFile | undefined> { return this.files.get(name); }
  async put(file: AppFile): Promise<void> { this.files.set(file.name, migrateFile(file)); }
  async delete(name: string): Promise<void> { this.files.delete(name); }
}

export class IndexedDbFileStore implements FileStore {
  private db?: Promise<IDBDatabase>;
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
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.db;
  }
  private async transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => { const request = action(db.transaction("files", mode).objectStore("files")); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  }
  async list(): Promise<AppFile[]> { return (await this.transaction<LegacyAppFile[]>("readonly", store => store.getAll())).map(migrateFile).sort((a, b) => a.name.localeCompare(b.name, "ko")); }
  async get(name: string): Promise<AppFile | undefined> { const file = await this.transaction<LegacyAppFile | undefined>("readonly", store => store.get(name)); return file && migrateFile(file); }
  async put(file: AppFile): Promise<void> { await this.transaction("readwrite", store => store.put(file)); }
  async delete(name: string): Promise<void> { await this.transaction("readwrite", store => store.delete(name)); }
}

export async function checkedPut(store: FileStore, file: AppFile): Promise<void> {
  if (!validFileName(file.name)) throw new Error("invalid-name");
  if (bytes(file.content) > MAX_FILE_BYTES) throw new Error("file-limit");
  const all = await store.list(); const prior = all.find(item => item.name === file.name);
  if (!prior && all.length >= MAX_FILES) throw new Error("count-limit");
  const total = all.reduce((sum, item) => sum + bytes(item.content), 0) - (prior ? bytes(prior.content) : 0) + bytes(file.content);
  if (total > MAX_TOTAL_BYTES) throw new Error("total-limit");
  await store.put(file);
}
