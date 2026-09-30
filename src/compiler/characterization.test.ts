import { describe, expect, it } from "vitest";
import { compile } from "./compiler";
import { compilerCases } from "./characterization-cases";
import baseline from "./fixtures/bytecode-baseline.json";
import { VM, type VMEvent } from "../runtime/vm";

// JSON's omission of undefined would hide changes in instruction arguments.
function structure(value: unknown): unknown {
  if (value === undefined) return { $undefined: true };
  if (Array.isArray(value)) return value.map(structure);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, structure(item)]));
  return value;
}
describe("compiler pre-refactor bytecode contract", () => {
  it.each(compilerCases)("$name: opcode, arguments, targets and source positions", ({ name, source, output }) => {
    const code = compile(source);
    expect(structure(code)).toStrictEqual(baseline[name]);
    const events: VMEvent[] = [];
    new VM(code, event => events.push(event), new Map([["helper.py", "value = 7"]])).execute();
    expect(events.filter(event => event.type === "error")).toEqual([]);
    expect(events.filter(event => event.type === "output").map(event => event.text).join("")).toBe(output);
    expect(events.at(-1)).toEqual({ type: "complete" });
  });
});
