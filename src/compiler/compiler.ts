import { lex } from "./lexer";
import { parse } from "./parser";
import type { Bytecode } from "./opcode";
import { compileProgram } from "./program";

/** Public source-to-bytecode boundary. Runtime imports do not reach the AST builder. */
export function compile(source: string): Bytecode { return compileProgram(parse(lex(source)).body); }
