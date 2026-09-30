import type { Bytecode, Instruction } from "../compiler/opcode";
import type { ClassValue, FileValue, FunctionValue, LexicalScope, Value } from "./value";
import type { VMFailure } from "./signals";

export type Frame = { bytecode: Bytecode; pc: number; stack: Value[]; env: Map<string, Value>; outerEnvs: LexicalScope[]; localNames: Set<string>; globalNames: Set<string>; nonlocalNames: Set<string>; globalsEnv: Map<string, Value>; functionName?: string; classValue?: ClassValue; currentFunction?: FunctionValue; fileName?: string; moduleLoad?: { name: string; member?: string; instruction: Instruction } };
export type Transfer = { kind: "jump"; target: number } | { kind: "return"; value: Value } | { kind: "throw"; failure: VMFailure };
export type RegionBase = { depth: number; start: number; end: number; stackHeight: number };
export type Region = RegionBase & (
  { kind: "except"; handlers: { type?: string; name?: string; target: number; end: number }[] }
  | { kind: "handler"; failure: VMFailure; binding?: { env: Map<string, Value>; name: string } }
  | { kind: "finally"; target: number; finish: number }
  | { kind: "finalizing"; pending: Transfer }
  | { kind: "with"; file: FileValue }
);
