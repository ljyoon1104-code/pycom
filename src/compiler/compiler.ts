import { lex } from "./lexer";
import { parse } from "./parser";
import type { Bytecode, ExecutionSource } from "./opcode";
import { compileProgram } from "./program";

/** Public source-to-bytecode boundary. Runtime imports do not reach the AST builder. */
export function compile(source: string, executionSource?: ExecutionSource): Bytecode { return compileProgram(parse(lex(source)).body, [], executionSource); }
