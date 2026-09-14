import { EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, Decoration, type DecorationSet, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

const exampleHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#d4b5ff" }, { tag: tags.string, color: "#a8e4b8" },
  { tag: tags.number, color: "#ffd18a" }, { tag: tags.comment, color: "#a7b4c8" },
  { tag: tags.name, color: "#c8e4ff" }, { tag: tags.operator, color: "#ecdfbb" },
]);

const setErrorLine = StateEffect.define<number | null>();
const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) { value = value.map(tr.changes); for (const effect of tr.effects) if (effect.is(setErrorLine)) return effect.value === null ? Decoration.none : Decoration.set([Decoration.line({ attributes: { class: "cm-student-error" } }).range(tr.state.doc.line(effect.value).from)]); return value; },
  provide: field => EditorView.decorations.from(field),
});
export class LearningEditor {
  readonly view: EditorView;
  private readonly extensions: Extension[];
  constructor(parent: HTMLElement, code: string, onChange: () => void, readOnly = false) {
    this.extensions = [lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), history(), python(), closeBrackets(), errorLineField, keymap.of([...defaultKeymap, ...historyKeymap, ...closeBracketsKeymap, indentWithTab]), readOnly ? [syntaxHighlighting(exampleHighlight), EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.contentAttributes.of({ "aria-label": "읽기 전용 Python 예제 코드", tabindex: "0" })] : EditorView.lineWrapping, EditorView.updateListener.of(update => { if (update.docChanged) onChange(); })];
    this.view = new EditorView({ state: this.createState(code), parent });
  }
  createState(code: string): EditorState { return EditorState.create({ doc: code, extensions: this.extensions }); }
  errorState(state: EditorState, line: number | null): EditorState { return state.update({ effects: setErrorLine.of(line && line <= state.doc.lines ? line : null) }).state; }
  get value(): string { return this.view.state.doc.toString(); }
  setValue(value: string): void { this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: value } }); }
  setError(line: number | null): void { this.view.dispatch({ effects: setErrorLine.of(line) }); if (line) this.view.dispatch({ selection: { anchor: this.view.state.doc.line(line).from }, scrollIntoView: true }); }
  insertTab(): void { const range = this.view.state.selection.main; this.view.dispatch({ changes: { from: range.from, to: range.to, insert: "    " }, selection: { anchor: range.from + 4 } }); this.view.focus(); }
  destroy(): void { this.view.destroy(); }
}
