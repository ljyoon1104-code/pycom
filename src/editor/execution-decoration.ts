import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, gutter } from "@codemirror/view";

export type EditorExecutionPoint = { line: number; column: number };
export const setExecutionPoint = StateEffect.define<EditorExecutionPoint | null>();
export const executionPointField = StateField.define<EditorExecutionPoint | null>({
  create: () => null,
  update(value, tr) { for (const effect of tr.effects) if (effect.is(setExecutionPoint)) return effect.value && effect.value.line <= tr.state.doc.lines ? effect.value : null; return tr.docChanged ? null : value; },
});
class ExecutionArrow extends GutterMarker {
  constructor(readonly location: EditorExecutionPoint) { super(); }
  eq(other: GutterMarker): boolean { return other instanceof ExecutionArrow && this.location.line === other.location.line && this.location.column === other.location.column; }
  toDOM(): HTMLElement { const node = document.createElement("span"); node.textContent = "➜"; node.className = "execution-arrow"; node.setAttribute("role", "img"); node.setAttribute("aria-label", `다음 실행: ${this.location.line}줄 ${this.location.column}열`); return node; }
}
const decorations = (state: EditorState) => {
  const point = state.field(executionPointField); if (!point) return Decoration.none;
  const line = state.doc.line(point.line), column = Math.min(line.to, line.from + point.column - 1);
  const marks = [Decoration.line({ attributes: { class: "cm-execution-line" } }).range(line.from)];
  if (column < line.to) marks.push(Decoration.mark({ class: "cm-execution-token" }).range(column, column + 1));
  return Decoration.set(marks, true);
};
export const executionDecoration = [executionPointField, EditorView.decorations.compute([executionPointField], decorations), gutter({
  class: "execution-gutter",
  lineMarker(view, line) { const point = view.state.field(executionPointField); return point && view.state.doc.line(point.line).from === line.from ? new ExecutionArrow(point) : null; },
  lineMarkerChange: update => update.startState.field(executionPointField) !== update.state.field(executionPointField),
})];
