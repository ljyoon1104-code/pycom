import { CompilerError, type Token } from "./token";

const reserved = new Set(["True", "False", "None", "and", "or", "not", "if", "elif", "else", "while", "for", "in", "break", "continue", "def", "return", "global", "class", "pass", "with", "as", "try", "except"]);
const syntax = (line: number, column: number, message: string): never => { throw new CompilerError({ line, column, category: "syntax", message }); };
const matching: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
const identifierStart = /[\p{L}_]/u;
const identifierPart = /[\p{L}\p{N}_]/u;

export function lex(source: string): Token[] {
  const tokens: Token[] = [], levels = [0], brackets: string[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const add = (kind: Token["kind"], lexeme: string, line: number, column: number, value?: number | string) => tokens.push({ kind, lexeme, value, line, column, endColumn: column + lexeme.length });
  for (let row = 0; row < lines.length; row++) {
    const text = lines[row], line = row + 1;
    let offset = 0; while (text[offset] === " " || text[offset] === "\t") offset++;
    const prefix = text.slice(0, offset), body = text.slice(offset);
    if (body === "" || body.startsWith("#")) continue;
    if (prefix.includes(" ") && prefix.includes("\t")) syntax(line, 1, "탭과 공백을 섞어 들여쓸 수 없습니다.");
    const indentation = prefix.includes("\t") ? prefix.length * 4 : prefix.length;
    if (brackets.length === 0 && indentation > levels.at(-1)!) { levels.push(indentation); add("indent", "", line, 1); }
    else if (brackets.length === 0 && indentation < levels.at(-1)!) { while (indentation < levels.at(-1)!) { levels.pop(); add("dedent", "", line, 1); } if (indentation !== levels.at(-1)) syntax(line, 1, "이전 들여쓰기 깊이와 맞지 않습니다."); }
    let index = brackets.length ? 0 : offset, column = index + 1;
    while (index < text.length) {
      const char = text[index]; if (char === " " || char === "\t") { index++; column++; continue; } if (char === "#") break;
      const start = column;
      if (/[0-9]/.test(char)) { let raw = ""; while (/[0-9]/.test(text[index] ?? "")) { raw += text[index++]; column++; } if (text[index] === "." && /[0-9]/.test(text[index + 1] ?? "")) { raw += text[index++]; column++; while (/[0-9]/.test(text[index] ?? "")) { raw += text[index++]; column++; } } add("number", raw, line, start, Number(raw)); continue; }
      if ((char === "f" || char === "F") && (text[index + 1] === "'" || text[index + 1] === '"')) { const quote = text[index + 1]; let raw = char + quote, value = "", closed = false; index += 2; column += 2; while (index < text.length) { const next = text[index++]; column++; raw += next; if (next === quote) { closed = true; break; } if (next === "\\") { const escaped = text[index++]; column++; raw += escaped ?? ""; const escapes: Record<string, string> = { n: "\n", t: "\t", "\\": "\\", "'": "'", '"': '"' }; if (!(escaped in escapes)) syntax(line, column - 1, "지원하지 않는 이스케이프 문자입니다."); value += escapes[escaped]; } else value += next; } if (!closed) syntax(line, start, "닫는 f-string 따옴표가 필요합니다."); add("fstring", raw, line, start, value); continue; }
      if (identifierStart.test(char)) { let name = ""; while (identifierPart.test(text[index] ?? "")) { name += text[index++]; column++; } add(reserved.has(name) ? "keyword" : "identifier", name, line, start); continue; }
      if (char === "'" || char === '"') { const quote = char; let raw = quote, value = "", closed = false; index++; column++; while (index < text.length) { const next = text[index++]; column++; raw += next; if (next === quote) { closed = true; break; } if (next === "\\") { const escaped = text[index++]; column++; raw += escaped ?? ""; const escapes: Record<string, string> = { n: "\n", t: "\t", "\\": "\\", "'": "'", '"': '"' }; if (!(escaped in escapes)) syntax(line, column - 1, "지원하지 않는 이스케이프 문자입니다."); value += escapes[escaped]; } else value += next; } if (!closed) syntax(line, start, "닫는 따옴표가 필요합니다."); add("string", raw, line, start, value); continue; }
      const three = text.slice(index, index + 3), two = text.slice(index, index + 2);
      if (["**=", "//="].includes(three)) { add("operator", three, line, column); index += 3; column += 3; continue; }
      if (["==", "!=", "<=", ">=", "//", "**", "+=", "-=", "*=", "/=", "%="].includes(two)) { add("operator", two, line, column); index += 2; column += 2; continue; }
      if ("+-*/%=<>() ,:[]{}.;".includes(char) && char !== " ") { if (char === "(" || char === "[" || char === "{") brackets.push(char); if (char in matching) { const open = brackets.pop(); if (open !== matching[char]) syntax(line, column, "괄호 종류가 맞지 않습니다."); } add("(),:[]{}.;".includes(char) ? "punctuation" : "operator", char, line, column); index++; column++; continue; }
      syntax(line, column, "이 문자는 사용할 수 없습니다.");
    }
    if (row < lines.length - 1 && brackets.length === 0) add("newline", "\n", line, text.length + 1);
  }
  if (brackets.length) syntax(lines.length, 1, "닫는 괄호가 필요합니다.");
  while (levels.length > 1) { levels.pop(); add("dedent", "", lines.length, 1); }
  add("eof", "", lines.length, 1);
  return tokens;
}
