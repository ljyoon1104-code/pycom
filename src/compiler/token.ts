export type TokenKind = "number" | "string" | "fstring" | "identifier" | "keyword" | "operator" | "punctuation" | "newline" | "indent" | "dedent" | "eof";
export interface Token { kind: TokenKind; lexeme: string; value?: number | string; line: number; column: number; endColumn: number; }
export type ErrorCategory = "syntax" | "name" | "type" | "value" | "runtime" | "unsupported";
export interface StudentError { line: number; column: number; endColumn?: number; category: ErrorCategory; message: string; pythonType?: string; fileName?: string; }
export class CompilerError extends Error { constructor(public readonly detail: StudentError) { super(detail.message); } }
