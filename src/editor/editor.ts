import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { EditorView, Decoration, type DecorationSet, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";

const setErrorLine = StateEffect.define<number | null>();
const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) { value = value.map(tr.changes); for (const effect of tr.effects) if (effect.is(setErrorLine)) return effect.value === null ? Decoration.none : Decoration.set([Decoration.line({ attributes: { class: "cm-student-error" } }).range(tr.state.doc.line(effect.value).from)]); return value; },
  provide: field => EditorView.decorations.from(field),
});
export class LearningEditor {
  readonly view: EditorView;
  constructor(parent: HTMLElement, code: string, onChange: () => void) {
    this.view = new EditorView({ state: EditorState.create({ doc: code, extensions: [lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), history(), python(), closeBrackets(), errorLineField, keymap.of([...defaultKeymap, ...historyKeymap, ...closeBracketsKeymap, indentWithTab]), EditorView.lineWrapping, EditorView.updateListener.of(update => { if (update.docChanged) onChange(); })] }), parent });
  }
  get value(): string { return this.view.state.doc.toString(); }
  setValue(value: string): void { this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: value } }); }
  setError(line: number | null): void { this.view.dispatch({ effects: setErrorLine.of(line) }); if (line) this.view.dispatch({ selection: { anchor: this.view.state.doc.line(line).from }, scrollIntoView: true }); }
  insertTab(): void { const range = this.view.state.selection.main; this.view.dispatch({ changes: { from: range.from, to: range.to, insert: "    " }, selection: { anchor: range.from + 4 } }); this.view.focus(); }
  destroy(): void { this.view.destroy(); }
}
