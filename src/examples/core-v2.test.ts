import { expect, it } from "vitest";
import { CORE_EXAMPLES } from "./core-v2";
import { compile } from "../compiler/compiler";
import { VM, type VMEvent } from "../runtime/vm";
it.each(CORE_EXAMPLES)("Core 예제 $id", example => { const events: VMEvent[] = []; new VM(compile(example.code), event => events.push(event), new Map(example.dataFiles?.map(file => [file.name, file.content]))).execute(); expect(events.at(-1)).toEqual({ type: "complete" }); expect(events.filter(event => event.type === "output").map(event => event.text).join("")).toBe(example.expectedOutput); });
