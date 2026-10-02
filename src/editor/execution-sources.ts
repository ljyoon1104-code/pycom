import type { ExecutionSource } from "../compiler/opcode";
import type { StudentError } from "../compiler/token";
import type { ExecutionLocation, ExecutionMode } from "../runtime/execution-control";
import type { DocumentTabs } from "./document-tabs";
import { contentOf } from "./documents";
import { LearningEditor } from "./editor";

/** Temporary source views never enter Documents, session serialization or FileStore. */
export class ExecutionSources {
  private sources = new Map<string, ExecutionSource>();
  private locked = new Set<string>();
  private marked?: string;
  private viewer?: LearningEditor;
  private shown?: string;
  private readonly panel = document.createElement("section");
  private readonly label = document.createElement("p");
  private readonly code = document.createElement("div");
  private entryId = "";
  private mode: ExecutionMode = "normal";
  constructor(private readonly tabs: DocumentTabs, private readonly host: HTMLElement) {
    this.panel.className = "execution-source"; this.panel.hidden = true;
    this.label.className = "execution-source-label"; this.code.className = "execution-source-code";
    this.panel.append(this.label, this.code); host.after(this.panel);
  }
  start(id: string, mode: ExecutionMode): void { this.finish(); this.entryId = id; this.mode = mode; if (mode !== "normal") this.lock(id); }
  source(source: ExecutionSource): void {
    this.sources.set(source.sourceId, source);
    const doc = source.sourceId === "entry" ? this.tabs.documents.find(this.entryId) : this.tabs.documents.named(source.fileName);
    if (doc && this.mode !== "normal") this.lock(doc.id);
  }
  private lock(id: string): void { if (!this.locked.has(id)) { this.locked.add(id); this.tabs.lockExecution(id, true); } }
  location(point: ExecutionLocation): void {
    const source = this.sources.get(point.sourceId); if (!source) return;
    this.tabs.capture();
    const doc = point.sourceId === "entry" ? this.tabs.documents.find(this.entryId) : this.tabs.documents.named(source.fileName);
    if (this.marked && this.marked !== doc?.id) this.tabs.highlightExecution(this.marked, null);
    if (doc && contentOf(doc) === source.code) {
      this.hideSnapshot();
      if (this.tabs.active !== doc && this.mode !== "normal") this.tabs.activate(doc.id, false, false);
      this.tabs.highlightExecution(doc.id, point); this.marked = doc.id;
    } else {
      if (this.marked) this.tabs.highlightExecution(this.marked, null); this.marked = undefined;
      this.showSnapshot(source);
      this.viewer?.setExecution(point);
    }
  }
  private showSnapshot(source: ExecutionSource): LearningEditor {
    this.host.hidden = true; this.panel.hidden = false;
    if (this.shown !== source.sourceId) { this.viewer?.destroy(); this.code.replaceChildren(); this.viewer = new LearningEditor(this.code, source.code, () => {}, true); this.shown = source.sourceId; }
    this.label.textContent = `${source.fileName} · ${source.sourceId === "entry" ? "실행 시작 시점 코드" : "실행 중인 저장본"} (읽기 전용 · 편집 초안은 유지됩니다)`;
    return this.viewer!;
  }
  showDraft(): void {
    this.hideSnapshot();
    if (this.mode !== "normal") for (const source of this.sources.values()) {
      const doc = source.sourceId === "entry" ? this.tabs.documents.find(this.entryId) : this.tabs.documents.named(source.fileName);
      if (doc) this.lock(doc.id);
    }
  }
  clearLocation(): void { if (this.marked) this.tabs.highlightExecution(this.marked, null); this.marked = undefined; this.hideSnapshot(); }
  private hideSnapshot(): void { this.host.hidden = false; this.panel.hidden = true; }
  finish(error?: StudentError): void {
    const failedSource = this.mode !== "normal" && error ? [...this.sources.values()].find(source => error.fileName ? source.fileName === error.fileName : source.sourceId === "entry") : undefined;
    if (this.marked) this.tabs.highlightExecution(this.marked, null); this.marked = undefined;
    for (const id of this.locked) this.tabs.lockExecution(id, false);
    this.locked.clear(); this.sources.clear(); this.hideSnapshot(); this.viewer?.destroy(); this.viewer = undefined; this.shown = undefined; this.code.replaceChildren();
    if (failedSource && error) {
      const doc = failedSource.sourceId === "entry" ? this.tabs.documents.find(this.entryId) : this.tabs.documents.named(failedSource.fileName);
      if (doc && contentOf(doc) === failedSource.code) { this.tabs.activate(doc.id); this.tabs.setError(doc.id, error.line); }
      else this.showSnapshot(failedSource).setError(error.line);
    }
  }
}
