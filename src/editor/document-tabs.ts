import { Documents, DOCUMENT_SESSION_KEY, contentOf, isDirty, type EditorDocument } from "./documents";
import { LearningEditor } from "./editor";
import { appFile, checkedPut, type AppFile, type FileStore } from "../files/storage";

type Choice = { value: string; label: string };
interface Options {
  editor: LearningEditor;
  host: HTMLElement;
  store: FileStore;
  files: () => Map<string, AppFile>;
  changed: () => void;
  message: (text: string, error?: boolean) => void;
  running: () => string | undefined;
}

/** One EditorView, independent EditorStates; persistent storage is touched only by explicit operations. */
export class DocumentTabs {
  readonly documents: Documents;
  readonly bar = document.createElement("div");
  private readonly strip = document.createElement("div");
  private readonly warning = document.createElement("div");
  private readonly layer = document.createElement("div");
  private readonly opened = document.createElement("div");
  private modal = false;
  private pending = new Set<string>();
  private reservedNames = new Set<string>();
  private unloadRegistered = false;
  private ready = false;
  private readonly unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
  constructor(private readonly options: Options, initialCode: string) {
    this.documents = new Documents(code => options.editor.createState(code));
    const first = this.documents.create("main.py", initialCode);
    // Preserve the existing clean starter-document policy; it still needs a name on first save.
    first.savedContent = initialCode;
    first.state = options.editor.view.state;
    this.bar.className = "document-bar";
    this.strip.className = "document-tabs"; this.strip.setAttribute("role", "tablist"); this.strip.setAttribute("aria-label", "편집기 문서");
    const add = this.button("+", () => this.newDocument()); add.className = "document-add"; add.setAttribute("aria-label", "새 문서 탭");
    const list = this.button("열린 파일", () => this.showOpened()); list.className = "document-opened";
    this.bar.append(this.strip, add, list);
    options.host.before(this.bar, this.warning);
    options.host.id = "document-panel"; options.host.setAttribute("role", "tabpanel");
    this.warning.className = "document-warning"; this.warning.hidden = true;
    this.layer.className = "dialog-layer document-dialog-layer"; this.layer.hidden = true;
    this.opened.className = "dialog-layer opened-dialog-layer"; this.opened.hidden = true;
    document.querySelector(".app")!.append(this.layer, this.opened);
    this.render();
  }
  get active(): EditorDocument { return this.documents.active; }
  get dirty(): boolean { return this.documents.dirty.length > 0; }
  get busy(): boolean { return this.modal || this.pending.size > 0; }
  allowNavigation(): void { window.removeEventListener("beforeunload", this.unload); this.unloadRegistered = false; }
  capture(): void {
    const doc = this.active; if (!doc) return;
    doc.state = this.options.editor.view.state;
    doc.scrollTop = this.options.editor.view.scrollDOM.scrollTop;
    doc.scrollLeft = this.options.editor.view.scrollDOM.scrollLeft;
    doc.scrollSnapshot = this.options.editor.view.scrollSnapshot();
  }
  edited(): void { this.capture(); this.render(); }
  private display(focus = false): void {
    this.options.editor.view.setState(this.active.state);
    const doc = this.active;
    if (doc.scrollSnapshot) this.options.editor.view.dispatch({ effects: doc.scrollSnapshot });
    requestAnimationFrame(() => {
      if (this.active !== doc) return;
      if (!doc.scrollSnapshot) {
        this.options.editor.view.scrollDOM.scrollTop = doc.scrollTop;
        this.options.editor.view.scrollDOM.scrollLeft = doc.scrollLeft;
      }
      this.strip.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    this.render(); if (focus) this.options.editor.view.focus();
  }
  activate(id: string, focus = false): void { this.capture(); if (this.documents.activate(id)) this.display(focus); }
  newDocument(): void {
    this.capture(); let n = 1;
    const names = new Set([...this.options.files().keys(), ...this.documents.items.map(doc => doc.fileName)]);
    while (names.has(`새 파일 ${n}.py`)) n++;
    this.documents.create(`새 파일 ${n}.py`); this.display(true);
  }
  example(name: string, code: string): void {
    this.capture(); this.documents.create(this.documents.uniqueName(name, this.options.files().keys()), code); this.display(true);
  }
  open(file: AppFile): void { this.capture(); this.documents.open(file); this.display(true); }
  initialize(files: Map<string, AppFile>): void {
    // Do not replace edits made while IndexedDB was opening.
    if (this.documents.items.length === 1 && !this.dirty && this.active.fileName === "main.py") {
      try { if (this.documents.restore(localStorage.getItem(DOCUMENT_SESSION_KEY), files)) this.display(); } catch { /* storage settings may be disabled */ }
    }
    this.ready = true; this.render();
  }
  private button(label: string, action: () => void): HTMLButtonElement {
    const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.onclick = action; return button;
  }
  private present(layer: HTMLElement, title: string, detail: string, choices: Choice[], inputValue?: string): Promise<string | undefined> {
    const previous = document.activeElement as HTMLElement | null;
    layer.replaceChildren();
    const section = document.createElement("section"); section.className = "save-dialog"; section.setAttribute("role", "dialog"); section.setAttribute("aria-modal", "true"); section.setAttribute("aria-label", title);
    const heading = document.createElement("h2"); heading.textContent = title;
    const text = document.createElement("p"); text.className = "document-dialog-detail"; text.textContent = detail;
    section.append(heading, text);
    let input: HTMLInputElement | undefined;
    if (inputValue !== undefined) { input = document.createElement("input"); input.className = "name-input"; input.setAttribute("aria-label", "파일 이름"); input.value = inputValue; section.append(input); }
    const actions = document.createElement("div"); section.append(actions); layer.append(section); layer.hidden = false;
    return new Promise(resolve => {
      const done = (value?: string) => { layer.hidden = true; layer.onkeydown = null; if (previous?.isConnected) previous.focus(); else this.strip.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus(); resolve(value); };
      for (const choice of choices) { const button = this.button(choice.label, () => done(choice.value === "name" ? input!.value : choice.value === "cancel" ? undefined : choice.value)); button.dataset.choice = choice.value; if (choice.value === "name") button.className = "name-confirm"; actions.append(button); }
      layer.onkeydown = event => {
        if (event.key === "Escape") { event.preventDefault(); done(); }
        if (event.key === "Enter" && event.target === input) { event.preventDefault(); done(input!.value); }
        if (event.key === "Tab") {
          const elements = Array.from(section.querySelectorAll<HTMLElement>("button,input")); const first = elements[0], last = elements.at(-1)!;
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      };
      (input ?? actions.querySelector("button"))?.focus();
    });
  }
  private async saveDocument(id: string, as = false): Promise<boolean> {
    this.capture(); const doc = this.documents.find(id); if (!doc || this.pending.has(id)) return false;
    // Capture before any asynchronous prompt; edits while persistence is pending stay dirty.
    const content = contentOf(doc);
    let name = doc.savedFileName;
    if (as || !name) {
      const entered = await this.present(this.layer, "파일 이름", "저장할 파일 이름을 입력하세요.", [{ value: "name", label: "확인" }, { value: "cancel", label: "취소" }], doc.fileName);
      if (entered === undefined) return false;
      name = entered;
    }
    let reserved: string | undefined;
    try {
      const snapshot = { ...this.documents.snapshot(id, name), content };
      if (this.reservedNames.has(snapshot.name)) throw new Error("이 파일을 저장하는 중입니다. 잠시 후 다시 시도해 주세요.");
      if (doc.externalChanged && snapshot.name === doc.savedFileName || snapshot.name !== doc.savedFileName && this.options.files().has(snapshot.name)) {
        const choice = await this.present(this.layer, "덮어쓰기 확인", `‘${snapshot.name}’의 저장된 내용을 덮어쓸까요?`, [{ value: "overwrite", label: "덮어쓰기" }, { value: "cancel", label: "취소" }]);
        if (choice !== "overwrite") return false;
      }
      this.pending.add(id); this.reservedNames.add(snapshot.name); reserved = snapshot.name;
      const file = appFile(snapshot.name, snapshot.content);
      await checkedPut(this.options.store, file);
      this.options.files().set(file.name, file); this.documents.saved(snapshot);
      this.options.message(`${file.name} 파일을 저장했습니다.\n`); this.render(); return true;
    } catch (error) {
      this.options.message(error instanceof Error && /파일 이름|다른 탭|저장하는 중/.test(error.message) ? error.message : `‘${doc.fileName}’ 파일을 저장할 수 없습니다. 변경 내용은 탭에 유지됩니다.`, true);
      return false;
    } finally { this.pending.delete(id); if (reserved) this.reservedNames.delete(reserved); this.render(); }
  }
  async save(as = false): Promise<boolean> {
    if (this.modal || !this.opened.hidden) return false;
    this.modal = true;
    try { return await this.saveDocument(this.active.id, as); } finally { this.modal = false; }
  }
  async protect(purpose = "변경 사항 저장"): Promise<boolean> {
    if (this.busy) return false;
    this.capture(); const dirty = this.documents.dirty; if (!dirty.length) return true;
    this.modal = true;
    try {
      const choice = await this.present(this.layer, purpose, `저장하지 않은 파일이 ${dirty.length}개 있습니다.\n${dirty.map(doc => doc.fileName).join("\n")}`, [{ value: "save", label: "모두 저장" }, { value: "discard", label: "저장하지 않음" }, { value: "cancel", label: "취소" }]);
      if (choice === "discard") return true;
      if (choice !== "save") return false;
      for (const doc of dirty) if (!await this.saveDocument(doc.id)) return false;
      return this.documents.dirty.length === 0;
    } finally { this.modal = false; }
  }
  async close(id: string): Promise<void> {
    if (this.busy) return;
    this.capture(); const doc = this.documents.find(id); if (!doc) return;
    this.modal = true;
    try {
      if (isDirty(doc)) {
        const choice = await this.present(this.layer, "변경 사항 저장", `‘${doc.fileName}’에 저장하지 않은 변경이 있습니다.`, [{ value: "save", label: "저장" }, { value: "discard", label: "저장하지 않음" }, { value: "cancel", label: "취소" }]);
        if (choice !== "save" && choice !== "discard") return;
        if (choice === "save" && (!await this.saveDocument(id) || isDirty(doc))) return;
      }
      this.removeTab(id);
    } finally { this.modal = false; }
  }
  private removeTab(id: string): void {
    this.documents.close(id);
    if (!this.documents.items.length) this.newDocument(); else this.display();
    this.strip.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  }
  async deleteActive(): Promise<void> {
    if (this.busy) return;
    this.capture(); const doc = this.active, name = doc.savedFileName; if (!name) { this.options.message("아직 저장되지 않은 문서입니다. 탭 닫기를 사용하세요."); return; }
    this.modal = true;
    try {
      const dirty = isDirty(doc);
      const choice = await this.present(this.layer, "저장 파일 삭제", dirty ? `‘${name}’은 편집 중입니다. 저장 파일을 삭제하고 편집 내용을 새 문서로 유지할까요?` : `‘${name}’ 파일을 삭제할까요?`, dirty ? [{ value: "keep", label: "새 문서로 유지" }, { value: "delete", label: "삭제하고 닫기" }, { value: "cancel", label: "취소" }] : [{ value: "delete", label: "삭제" }, { value: "cancel", label: "취소" }]);
      if (choice !== "keep" && choice !== "delete") return;
      await this.options.store.delete(name); this.options.files().delete(name);
      if (choice === "keep") { this.documents.detach(doc, this.documents.uniqueName(name, this.options.files().keys())); this.render(); }
      else this.removeTab(doc.id);
      this.options.message(`${name} 저장 파일을 삭제했습니다. ${choice === "keep" ? "편집 내용은 새 문서로 유지됩니다." : "삭제한 저장 파일은 백업이 있어야 복원할 수 있습니다."}\n`);
    } catch { this.options.message("파일을 삭제할 수 없습니다. 문서는 유지됩니다.", true); }
    finally { this.modal = false; }
  }
  external(file: AppFile): void { this.capture(); const prior = this.active.state; this.documents.external(file); if (prior !== this.active.state) this.display(); else this.render(); }
  replaceSaved(files: Map<string, AppFile>): void {
    this.capture();
    for (const doc of [...this.documents.items]) {
      const file = doc.savedFileName ? files.get(doc.savedFileName) : undefined;
      if (file) this.documents.reload(doc, file.content); else this.documents.close(doc.id);
    }
    if (!this.documents.items.length) this.newDocument(); else this.display();
  }
  setError(id: string, line: number | null): void {
    this.capture(); const doc = this.documents.find(id); if (!doc) return;
    doc.state = this.options.editor.errorState(doc.state, line);
    if (this.active.id === id) this.display();
  }
  private showOpened(): void {
    if (this.busy) return;
    const previous = document.activeElement as HTMLElement;
    this.opened.replaceChildren(); const section = document.createElement("section"); section.className = "save-dialog opened-dialog"; section.setAttribute("role", "dialog"); section.setAttribute("aria-modal", "true"); section.setAttribute("aria-label", "열린 파일");
    const title = document.createElement("h2"); title.textContent = `열린 파일 ${this.documents.items.length}개`; section.append(title);
    const exit = () => { this.opened.hidden = true; this.opened.onkeydown = null; previous?.focus(); };
    for (const doc of this.documents.items) {
      const row = document.createElement("div"); row.className = "opened-file-row";
      const select = this.button(`${doc.fileName}${isDirty(doc) ? " *" : ""}${doc.id === this.active.id ? " (현재)" : ""}`, () => { exit(); this.activate(doc.id, true); }); select.title = doc.fileName;
      const close = this.button("닫기", () => { exit(); void this.close(doc.id); }); close.setAttribute("aria-label", `${doc.fileName} 닫기`); row.append(select, close); section.append(row);
    }
    section.append(this.button("목록 닫기", exit)); this.opened.append(section); this.opened.hidden = false;
    this.opened.onkeydown = event => {
      if (event.key === "Escape") { event.preventDefault(); exit(); }
      if (event.key === "Tab") { const buttons = section.querySelectorAll("button"), first = buttons[0], last = buttons[buttons.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
    }; section.querySelector("button")?.focus();
  }
  render(): void {
    const focusId = (document.activeElement as HTMLElement | null)?.dataset.documentId;
    const running = this.options.running();
    this.strip.replaceChildren(...this.documents.items.map(doc => {
      const wrapper = document.createElement("div"); wrapper.className = `document-tab-wrap${doc.id === this.active.id ? " active" : ""}`;
      const tab = this.button("", () => this.activate(doc.id)); tab.id = `tab-${doc.id}`; tab.dataset.documentId = doc.id;
      tab.setAttribute("role", "tab"); tab.setAttribute("aria-controls", "document-panel"); tab.setAttribute("aria-selected", String(doc.id === this.active.id)); tab.tabIndex = doc.id === this.active.id ? 0 : -1;
      const label = `${doc.fileName}${isDirty(doc) ? ", 저장되지 않은 변경 있음" : ""}${running === doc.id ? ", 실행 중" : ""}${doc.externalChanged ? ", 파일이 실행 중 변경되었습니다" : ""}`;
      tab.setAttribute("aria-label", label); tab.title = label;
      const name = document.createElement("span"); name.className = "document-tab-name"; name.textContent = doc.fileName;
      const mark = document.createElement("span"); mark.textContent = `${isDirty(doc) ? " *" : ""}${running === doc.id ? " 실행 중" : ""}${doc.externalChanged ? " ⚠" : ""}`; tab.append(name, mark);
      tab.onkeydown = event => {
        const tabs = Array.from(this.strip.querySelectorAll<HTMLButtonElement>('[role="tab"]')), index = tabs.indexOf(tab);
        const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
        if (next >= 0) { event.preventDefault(); tabs.forEach(item => item.tabIndex = -1); tabs[next].tabIndex = 0; tabs[next].focus(); tabs[next].scrollIntoView({ inline: "nearest", block: "nearest" }); }
        if (event.key === "Delete") { event.preventDefault(); void this.close(doc.id); }
      };
      const close = this.button("×", () => { void this.close(doc.id); }); close.className = "document-close"; close.setAttribute("aria-label", `${doc.fileName} 닫기`); wrapper.append(tab, close); return wrapper;
    }));
    if (focusId) this.strip.querySelector<HTMLButtonElement>(`[data-document-id="${focusId}"]`)?.focus();
    this.options.host.setAttribute("aria-labelledby", `tab-${this.active.id}`);
    this.warning.replaceChildren(); this.warning.hidden = !this.active.externalChanged;
    if (this.active.externalChanged) {
      const text = document.createElement("p"); text.textContent = "파일이 실행 중 변경되었습니다. 편집 내용은 유지했습니다.";
      this.warning.append(text, this.button("편집 내용 유지", () => { this.active.externalChanged = false; this.render(); }), this.button("저장된 내용 다시 불러오기", () => { const file = this.options.files().get(this.active.savedFileName!); if (file) { this.documents.reload(this.active, file.content); this.display(); } }), this.button("다른 이름으로 저장", () => { void this.save(true); }));
    }
    if (this.dirty !== this.unloadRegistered) { this.unloadRegistered = this.dirty; if (this.dirty) window.addEventListener("beforeunload", this.unload); else window.removeEventListener("beforeunload", this.unload); }
    if (this.ready) try { localStorage.setItem(DOCUMENT_SESSION_KEY, this.documents.serialize()); } catch { /* The editor remains usable when session settings cannot be saved. */ }
    this.options.changed();
  }
}
