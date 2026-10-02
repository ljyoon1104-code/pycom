import { describe, expect, it } from "vitest";
import { compile } from "./compiler";
import { executionMetadataOf } from "./opcode";
import { compilerCases } from "./characterization-cases";

const tracked = (code: string) => compile(code, { sourceId: "entry", fileName: "main.py", code });
describe("out-of-band execution metadata", () => {
  it.each(compilerCases)("$name: does not alter existing bytecode", ({ source }) => expect(tracked(source)).toStrictEqual(compile(source)));
  it("normal callers need no metadata", () => expect(executionMetadataOf(compile("print(1)"))).toBeUndefined());
  it("marks statements, not expression instructions; excludes comments and blanks", () => {
    const code = tracked('# comment\n\na = 1 + 2\nprint(a)');
    expect([...executionMetadataOf(code)!.points.values()].map(p => [p.line, p.column])).toEqual([[3, 1], [4, 1]]);
  });
  it("distinguishes semicolon columns", () => {
    const code = tracked('a = 1; b = 2; print(a + b)');
    expect([...executionMetadataOf(code)!.points.values()].map(p => p.column)).toEqual([1, 8, 15]);
  });
  it("multiline statements stop on the starting line", () => {
    const code = tracked('value = (\n  1 + 2\n)\nprint(\n  value\n)');
    expect([...executionMetadataOf(code)!.points.values()].map(p => p.line)).toEqual([1, 4]);
  });
  it("nested function and class metadata share the real source", () => {
    const code = tracked('class A:\n    def f(self):\n        return 1');
    const cls = code.instructions.find(i => i.op === "make_class")!;
    if (cls.op !== "make_class") throw new Error("class");
    const fn = cls.bytecode.instructions.find(i => i.op === "make_function")!;
    if (fn.op !== "make_function") throw new Error("function");
    expect(executionMetadataOf(fn.bytecode)?.source).toBe(executionMetadataOf(code)?.source);
    expect([...executionMetadataOf(fn.bytecode)!.points.values()].map(p => p.line)).toEqual([3]);
  });
  it("synthetic comprehension instructions have no separate stops", () => {
    const code = tracked('a = [n for n in range(3)]');
    const instruction = code.instructions.find(i => i.op === "run_comprehension")!;
    if (instruction.op !== "run_comprehension") throw new Error("comprehension");
    expect(executionMetadataOf(instruction.bytecode)).toBeUndefined();
  });
});
