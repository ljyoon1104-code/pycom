import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { normalizeName, validFileName, type AppFile } from "../files/storage";

export const DOCUMENT_SESSION_KEY = "python-learning-lab-document-session-v1";
export interface EditorDocument {
  readonly id: string;
  fileName: string;
  savedFileName?: string;
  savedContent: string;
  state: EditorState;
  scrollTop: number;
  scrollLeft: number;
  scrollSnapshot?: ReturnType<EditorView["scrollSnapshot"]>;
  externalChanged: boolean;
}
export const contentOf = (doc: EditorDocument): string => doc.state.doc.toString();
export const isDirty = (doc: EditorDocument): boolean => contentOf(doc) !== doc.savedContent;
export const isUntitled = (doc: EditorDocument): boolean => doc.savedFileName === undefined;
export interface SaveSnapshot { id: string; name: string; content: string }

/** In-memory documents only. The session serializer deliberately allowlists names. */
export class Documents {
  readonly items: EditorDocument[] = [];
  activeId = "";
  private sequence = 0;
  constructor(private readonly createState: (content: string) => EditorState) {}
  get active(): EditorDocument { return this.items.find(doc => doc.id === this.activeId)!; }
  get dirty(): EditorDocument[] { return this.items.filter(isDirty); }
  find(id: string): EditorDocument | undefined { return this.items.find(doc => doc.id === id); }
  named(name: string): EditorDocument | undefined { return this.items.find(doc => doc.savedFileName === name); }
  uniqueName(suggestion: string, saved: Iterable<string>): string {
    const occupied = new Set([...saved, ...this.items.map(doc => doc.fileName)]);
    const name = normalizeName(suggestion);
    if (!occupied.has(name)) return name;
    const dot = name.lastIndexOf(".");
    for (let n = 2; ; n++) { const next = `${name.slice(0, dot)} ${n}${name.slice(dot)}`; if (!occupied.has(next)) return next; }
  }
  create(fileName: string, content = "", saved = false): EditorDocument {
    const doc: EditorDocument = { id: `document-${++this.sequence}`, fileName, savedFileName: saved ? fileName : undefined, savedContent: saved ? content : "", state: this.createState(content), scrollTop: 0, scrollLeft: 0, externalChanged: false };
    const index = this.items.findIndex(item => item.id === this.activeId);
    this.items.splice(index + 1, 0, doc); this.activeId = doc.id;
    return doc;
  }
  open(file: AppFile): EditorDocument {
    const existing = this.named(file.name);
    if (existing) { this.activeId = existing.id; return existing; }
    return this.create(file.name, file.content, true);
  }
  activate(id: string): boolean { if (!this.find(id)) return false; this.activeId = id; return true; }
  close(id: string): void {
    const index = this.items.findIndex(doc => doc.id === id); if (index < 0) return;
    this.items.splice(index, 1);
    if (this.activeId === id) this.activeId = (this.items[index] ?? this.items[index - 1])?.id ?? "";
  }
  snapshot(id: string, name: string): SaveSnapshot {
    const doc = this.find(id); if (!doc) throw new Error("문서가 닫혔습니다.");
    if (!name.trim()) throw new Error("파일 이름이 올바르지 않습니다.");
    name = normalizeName(name);
    if (!validFileName(name)) throw new Error("파일 이름이 올바르지 않습니다.");
    if (this.items.some(item => item.id !== id && (item.savedFileName === name || item.fileName === name))) throw new Error("다른 탭에서 열린 파일 이름입니다. 다른 이름을 선택해 주세요.");
    return { id, name, content: contentOf(doc) };
  }
  saved(snapshot: SaveSnapshot): void {
    const doc = this.find(snapshot.id); if (!doc) return;
    doc.fileName = snapshot.name; doc.savedFileName = snapshot.name;
    doc.savedContent = snapshot.content; doc.externalChanged = false;
  }
  external(file: AppFile): void {
    const doc = this.named(file.name); if (!doc) return;
    if (file.content === doc.savedContent) return;
    if (isDirty(doc)) {
      doc.savedContent = file.content;
      doc.externalChanged = contentOf(doc) !== file.content;
      return;
    }
    this.reload(doc, file.content);
  }
  reload(doc: EditorDocument, content: string): void {
    const anchor = Math.min(doc.state.selection.main.anchor, content.length);
    doc.state = this.createState(content).update({ selection: { anchor } }).state;
    doc.scrollSnapshot = undefined;
    doc.savedContent = content; doc.externalChanged = false;
  }
  detach(doc: EditorDocument, name: string): void { doc.savedFileName = undefined; doc.fileName = name; doc.savedContent = ""; doc.externalChanged = false; }
  serialize(): string {
    return JSON.stringify({ names: this.items.flatMap(doc => doc.savedFileName ? [doc.savedFileName] : []), activeName: this.active?.savedFileName ?? null });
  }
  restoreInitial(raw: string | null, files: ReadonlyMap<string, AppFile>): boolean {
    if (this.restore(raw, files)) return true;
    // Older users may have saved files but no tab-session record.
    const file = files.get("main.py") ?? [...files.values()].find(file => file.name.endsWith(".py")) ?? files.values().next().value;
    if (!file) return false;
    this.items.splice(0); this.activeId = "";
    this.open(file);
    return true;
  }
  restore(raw: string | null, files: ReadonlyMap<string, AppFile>): boolean {
    let session: { names?: unknown; activeName?: unknown };
    try { session = JSON.parse(raw ?? "null"); } catch { return false; }
    if (!session || !Array.isArray(session.names)) return false;
    const names = [...new Set(session.names.filter((name): name is string => typeof name === "string" && files.has(name)))];
    if (!names.length) return false;
    this.items.splice(0); this.activeId = "";
    names.forEach(name => this.open(files.get(name)!));
    if (typeof session.activeName === "string") this.activeId = this.named(session.activeName)?.id ?? this.activeId;
    return true;
  }
}
