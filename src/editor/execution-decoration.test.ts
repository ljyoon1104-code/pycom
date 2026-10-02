import { EditorState } from "@codemirror/state";
import { history, undoDepth } from "@codemirror/commands";
import { expect, it } from "vitest";
import { executionDecoration, executionPointField, setExecutionPoint } from "./execution-decoration";
it("execution decoration never changes document, selection or undo history", () => {
  let state = EditorState.create({doc:'a = 1\nprint(a)',extensions:[history(),executionDecoration]});
  state = state.update({changes:{from:4,to:5,insert:'2'},selection:{anchor:2}}).state;
  const code=state.doc.toString(), selection=state.selection.toJSON(), depth=undoDepth(state);
  for(const point of [{line:1,column:1},{line:2,column:1},null]) {
    state = state.update({effects:setExecutionPoint.of(point)}).state;
    expect(state.doc.toString()).toBe(code); expect(state.selection.toJSON()).toEqual(selection); expect(undoDepth(state)).toBe(depth); expect(state.field(executionPointField)).toEqual(point);
  }
});
it("editing clears stale locations without retaining a wrong line", () => {
  let state=EditorState.create({doc:'print(1)',extensions:[executionDecoration]});
  state=state.update({effects:setExecutionPoint.of({line:1,column:1})}).state;
  state=state.update({changes:{from:0,insert:'\n'}}).state; expect(state.field(executionPointField)).toBeNull();
});
it("out-of-range source points are not drawn", () => {
  const state=EditorState.create({doc:'print(1)',extensions:[executionDecoration]}).update({effects:setExecutionPoint.of({line:99,column:1})}).state;
  expect(state.field(executionPointField)).toBeNull();
});
