import type { Bytecode, Instruction } from "../compiler/opcode";
import { compile } from "../compiler/compiler";
import { CompilerError } from "../compiler/token";
import type { ModuleValue, Value } from "./value";
import { VMFailure } from "./signals";

type ModuleImport = Extract<Instruction, { op: "import_module" }>;
export type UserModuleState = { value: ModuleValue; loading: boolean };

// The VM still owns the per-run snapshot, cache and frame transition sequence.
export function importedValue(i: Instruction, value: Extract<Value, { kind: "module" }>, member?: string): Value { if (member === undefined) return value; const result = value.attributes.get(member); if (result === undefined) throw new VMFailure({ line: i.line, column: i.column, category: "name", message: `'${value.name}' 모듈에 '${member}' 이름이 없습니다.` }, "ImportError"); return result; }

export function validateModuleImport(i: ModuleImport): void {
    if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(i.module) || i.member === "*") throw new VMFailure({ line: i.line, column: i.column, category: "name", message: "폴더·경로·와일드카드 모듈은 가져올 수 없습니다." }, "ImportError");
}

export function readModuleSource(i: ModuleImport, savedModules: ReadonlyMap<string, string>): { fileName: string; text: string } {
    const fileName = `${i.module}.py`, text = savedModules.get(fileName); if (text === undefined) throw new VMFailure({ line: i.line, column: i.column, category: "name", message: `'${fileName}' 저장 파일을 찾을 수 없습니다.` }, "ImportError");
  return { fileName, text };
}

export function compileModuleSource(text: string, fileName: string): Bytecode {
    let bytecode: Bytecode; try { bytecode = compile(text); } catch (error) { if (error instanceof CompilerError) throw new VMFailure({ ...error.detail, fileName }, "SyntaxError"); throw error; }
  return bytecode;
}
