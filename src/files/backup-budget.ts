// Format-1 export/import share this byte budget. Count JSON escapes before allocation.
export const MAX_BACKUP_JSON_BYTES = 12_500_000;

type BudgetFile = { name: string; content: string; encoding: string; byteSize: number; updatedAt: number };
const exceeded = Symbol("json-budget-exceeded");

/** Exact UTF-8 size of JSON.stringify(value, null, 2) plus the export's final newline.
 * Only the small backup descriptor is traversed; strings are counted in place.
 * Returns limit + 1 as soon as the budget is crossed. */
export function backupJsonBytes(value: unknown, limit = MAX_BACKUP_JSON_BYTES): number {
  let total = 1;
  const add = (size: number) => { total += size; if (total > limit) throw exceeded; };
  const string = (text: string) => {
    add(2);
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) add(2);
      else if (code < 32) add(6);
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { add(4); index++; } else add(6);
      } else if (code >= 0xdc00 && code <= 0xdfff) add(6);
      else add(code < 0x80 ? 1 : code < 0x800 ? 2 : 3);
    }
  };
  const visit = (item: unknown, depth: number): void => {
    if (typeof item === "string") { string(item); return; }
    if (typeof item === "number") { add(JSON.stringify(item).length); return; }
    if (item === null || typeof item === "boolean") { add(String(item).length); return; }
    if (typeof item !== "object") throw new Error("invalid-file-metadata");
    if (Array.isArray(item)) {
      add(2); if (!item.length) return;
      add(1);
      item.forEach((child, index) => { add((depth + 1) * 2); visit(child, depth + 1); add(index < item.length - 1 ? 2 : 1); });
      add(depth * 2); return;
    }
    const entries = Object.entries(item); add(2); if (!entries.length) return;
    add(1);
    entries.forEach(([key, child], index) => { add((depth + 1) * 2); string(key); add(2); visit(child, depth + 1); add(index < entries.length - 1 ? 2 : 1); });
    add(depth * 2);
  };
  try { visit(value, 0); return total; } catch (error) { if (error === exceeded) return limit + 1; throw error; }
}

export function assertExportableFileSet(files: readonly BudgetFile[]): void {
  const descriptor = {
    format: "python-learning-lab-backup", formatVersion: 1,
    appVersion: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "알 수 없음", createdAt: "2000-01-01T00:00:00.000Z",
    files: files.map(file => ({ name: file.name, content: file.content, encoding: file.encoding, originalByteSize: file.byteSize, updatedAt: new Date(file.updatedAt).toISOString() })),
  };
  if (backupJsonBytes(descriptor) > MAX_BACKUP_JSON_BYTES) throw new Error("backup-limit");
}
