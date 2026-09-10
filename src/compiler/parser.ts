import type { Expr, FStringFormat, Name, Program, Statement, Target } from "./ast";
import { lex } from "./lexer";
import { CompilerError, type Token } from "./token";

const unsupported = new Set(["import", "from", "lambda"]);
const errorTypes = new Set(["Exception", "NameError", "TypeError", "ValueError", "ZeroDivisionError", "IndexError", "KeyError", "AttributeError", "FileNotFoundError", "RuntimeError"]);
const compounds = new Set(["+=", "-=", "*=", "/=", "//=", "%=", "**="]);
const comparisons = new Set(["==", "!=", "<", "<=", ">", ">="]);

export class Parser {
  private index = 0; private functionDepth = 0;
  constructor(private readonly tokens: Token[]) {}
  private cur() { return this.tokens[this.index]; }
  private peek(amount = 1) { return this.tokens[this.index + amount] ?? this.cur(); }
  private advance() { return this.tokens[this.index++]; }
  private fail(token: Token, message: string, category: "syntax" | "unsupported" = "syntax"): never { throw new CompilerError({ line: token.line, column: token.column, endColumn: token.endColumn, category, message }); }
  private match(value: string) { return this.cur().lexeme === value ? this.advance() : undefined; }
  private skip() { while (this.cur().kind === "newline") this.advance(); }
  parse(): Program { this.skip(); return { kind: "program", body: this.statements("eof") }; }
  private end() {
    let separated = false;
    while (this.match(";")) separated = true;
    if (separated && ["if", "for", "while", "def", "class", "try", "with"].includes(this.cur().lexeme)) this.fail(this.cur(), "세미콜론 뒤에는 복합문을 사용할 수 없습니다.", "unsupported");
    if (separated && !["newline", "eof", "dedent"].includes(this.cur().kind)) return;
    if (!["newline", "eof", "dedent"].includes(this.cur().kind)) this.fail(this.cur(), "문장 끝에 줄바꿈이 필요합니다.");
    this.skip();
  }
  private statements(end: "eof" | "dedent"): Statement[] {
    const body: Statement[] = [];
    while (this.cur().kind !== end && this.cur().kind !== "eof") { while (this.match(";")) {} if (this.cur().kind === "newline") { this.skip(); continue; } if (this.cur().kind === "indent") this.fail(this.cur(), "예상하지 않은 들여쓰기입니다."); const node = this.statement(); body.push(node); if (!["if", "while", "for", "function", "class", "with", "try"].includes(node.kind)) this.end(); }
    if (end === "dedent") { if (this.cur().kind !== "dedent") this.fail(this.cur(), "들여쓴 본문이 필요합니다."); this.advance(); }
    return body;
  }
  private statement(): Statement {
    const token = this.cur();
    if (unsupported.has(token.lexeme)) this.fail(token, "이 문법은 현재 버전에서 지원하지 않습니다.", "unsupported");
    if (token.lexeme === "class") return this.classStmt(); if (token.lexeme === "def") return this.functionStmt(); if (token.lexeme === "if") return this.ifStmt(); if (token.lexeme === "while") return this.whileStmt(); if (token.lexeme === "for") return this.forStmt(); if (token.lexeme === "with") return this.withStmt(); if (token.lexeme === "try") return this.tryStmt();
    if (token.lexeme === "elif" || token.lexeme === "else") this.fail(token, "앞에 if 문이 없는 조건문입니다."); if (token.lexeme === "except") this.fail(token, "앞에 try 문이 없는 except입니다.");
    if (token.lexeme === "break" || token.lexeme === "continue") { this.advance(); return { kind: token.lexeme, token }; }
    if (token.lexeme === "pass") { this.advance(); return { kind: "pass", token }; }
    if (token.lexeme === "return") { if (!this.functionDepth) this.fail(token, "return은 함수 안에서만 사용할 수 있습니다."); this.advance(); return { kind: "return", value: ["newline", "dedent", "eof"].includes(this.cur().kind) ? undefined : this.assignmentValue(), token }; }
    if (token.lexeme === "global") { if (!this.functionDepth) this.fail(token, "global은 함수 안에서만 사용할 수 있습니다."); this.advance(); const names: string[] = []; while (true) { if (this.cur().kind !== "identifier") this.fail(this.cur(), "global 뒤에는 변수 이름이 필요합니다."); names.push(this.advance().lexeme); if (!this.match(",")) break; } return { kind: "global", names, token }; }

    const start = this.index, first = this.assignmentTarget();
    if (first && (this.cur().lexeme === "=" || compounds.has(this.cur().lexeme))) {
      const operator = this.advance();
      if (operator.lexeme !== "=" && first.kind === "unpack") this.fail(operator, "여러 변수에는 복합 대입을 사용할 수 없습니다.");
      if (operator.lexeme !== "=") {
        if (["newline", "eof", "dedent"].includes(this.cur().kind)) this.fail(this.cur(), "대입할 값이 필요합니다.");
        return { kind: "augassign", target: first as Name | Extract<Expr, { kind: "subscript" }>, op: operator.lexeme.slice(0, -1), value: this.assignmentValue(), token };
      }
      const targets = [first];
      while (true) {
        const mark = this.index; let next: Target | undefined;
        try { next = this.assignmentTarget(); } catch (error) { if (!(error instanceof CompilerError)) throw error; this.index = mark; break; }
        if (next && this.cur().lexeme === "=") { targets.push(next); this.advance(); continue; }
        this.index = mark; break;
      }
      if (["newline", "eof", "dedent"].includes(this.cur().kind)) this.fail(this.cur(), "대입할 값이 필요합니다.");
      return { kind: "assign", targets, value: this.assignmentValue(), token };
    }
    this.index = start;
    return { kind: "expression", expression: this.expression(), token };
  }
  private assignmentValue(): Expr {
    const first = this.expression();
    if (!this.match(",")) return first;
    const values = [first];
    while (true) { if (["newline", "eof", "dedent"].includes(this.cur().kind)) break; values.push(this.expression()); if (!this.match(",")) break; }
    return { kind: "tuple", values, token: (first as { token: Token }).token };
  }
  private assignmentTarget(): Target | undefined {
    const first = this.assignmentTargetAtom();
    if (!first) return undefined;
    const values = [first];
    while (this.match(",")) { const next = this.assignmentTargetAtom(); if (!next) this.fail(this.cur(), "대입 대상이 필요합니다."); values.push(next); }
    return values.length === 1 ? first : { kind: "unpack", values, token: first.token };
  }
  private assignmentTargetAtom(): Target | undefined {
    if (this.cur().lexeme === "(" && this.peek().kind !== "identifier" && this.peek().lexeme !== "[" && this.peek().lexeme !== "(") return undefined;
    if (this.match("(")) {
      const target = this.assignmentTarget();
      if (!target) this.fail(this.cur(), "대입 대상이 필요합니다.");
      if (!this.match(")")) this.fail(this.cur(), "닫는 괄호가 필요합니다.");
      return target;
    }
    if (this.cur().lexeme === "[" && this.peek().kind !== "identifier" && this.peek().lexeme !== "[" && this.peek().lexeme !== "(") return undefined;
    if (this.match("[")) {
      const target = this.assignmentTarget();
      if (!target) this.fail(this.cur(), "대입 대상이 필요합니다.");
      if (!this.match("]")) this.fail(this.cur(), "닫는 대괄호가 필요합니다.");
      return target.kind === "unpack" ? target : { kind: "unpack", values: [target], token: target.token };
    }
    if (this.cur().kind !== "identifier") return undefined;
    const firstToken = this.advance(), first: Name = { kind: "name", id: firstToken.lexeme, token: firstToken };
    let node: Expr = first;
    while (true) { if (this.match("[")) { node = { kind: "subscript", object: node, index: this.subscript(firstToken), token: firstToken }; continue; } if (this.match(".")) { const name = this.cur(); if (name.kind !== "identifier") this.fail(name, "속성 이름이 필요합니다."); this.advance(); node = { kind: "attribute", object: node, name: name.lexeme, token: name }; continue; } break; }
    return node.kind === "name" || node.kind === "subscript" || node.kind === "attribute" ? node : undefined;
  }
  private classStmt(): Statement { const token = this.advance(), name = this.cur(); if (name.kind !== "identifier") this.fail(name, "클래스 이름이 필요합니다."); this.advance(); if (this.cur().lexeme === "(") this.fail(this.cur(), "상속은 현재 버전에서 지원하지 않습니다.", "unsupported"); const body = this.suite(token); for (const statement of body) if (!(["assign", "function", "pass"] as string[]).includes(statement.kind)) this.fail((statement as { token: Token }).token, "클래스 본문에는 속성 대입, 메서드 정의, pass만 사용할 수 있습니다."); return { kind: "class", name: name.lexeme, body, token }; }
  private functionStmt(): Statement { const token = this.advance(); const name = this.cur(); if (name.kind !== "identifier") this.fail(name, "함수 이름이 필요합니다."); this.advance(); if (!this.match("(")) this.fail(this.cur(), "함수 이름 뒤에는 '('가 필요합니다."); const params: { name: string; defaultValue?: Expr; token: Token }[] = [], names = new Set<string>(); let defaultSeen = false; if (!this.match(")")) while (true) { const parameter = this.cur(); if (parameter.kind !== "identifier") this.fail(parameter, "매개변수 이름이 필요합니다."); this.advance(); if (names.has(parameter.lexeme)) this.fail(parameter, "같은 매개변수 이름을 두 번 사용할 수 없습니다."); names.add(parameter.lexeme); let defaultValue: Expr | undefined; if (this.match("=")) { defaultSeen = true; defaultValue = this.expression(); } else if (defaultSeen) this.fail(parameter, "기본값 있는 매개변수 뒤에는 기본값 없는 매개변수를 둘 수 없습니다."); params.push({ name: parameter.lexeme, defaultValue, token: parameter }); if (this.match(")")) break; if (!this.match(",")) this.fail(this.cur(), "쉼표 또는 닫는 괄호가 필요합니다."); } this.functionDepth++; const body = this.suite(token); this.functionDepth--; const seen = new Set(params.map(parameter => parameter.name)), globals: string[] = []; const remember = (target: Target): void => { if (target.kind === "name") seen.add(target.id); else if (target.kind === "unpack") target.values.forEach(remember); }; for (const statement of body) { if (statement.kind === "global") { for (const global of statement.names) { if (seen.has(global)) this.fail(statement.token, "지역 변수로 사용한 이름은 global로 선언할 수 없습니다."); if (!globals.includes(global)) globals.push(global); } } else if (statement.kind === "assign") statement.targets.forEach(remember); else if (statement.kind === "augassign") remember(statement.target); else if (statement.kind === "for") remember(statement.target); } for (const parameter of params) if (globals.includes(parameter.name)) this.fail(parameter.token, "매개변수 이름은 global로 선언할 수 없습니다."); return { kind: "function", name: name.lexeme, params, body, globals, token }; }
  private ifStmt(): Statement { const token = this.advance(), condition = this.expression(), branches = [{ condition, body: this.suite(token), token }]; let otherwise: Statement[] | undefined; while (this.cur().lexeme === "elif") { const branchToken = this.advance(); branches.push({ condition: this.expression(), body: this.suite(branchToken), token: branchToken }); } if (this.cur().lexeme === "else") { const branchToken = this.advance(); otherwise = this.suite(branchToken); } return { kind: "if", branches, otherwise, token }; }
  private whileStmt(): Statement { const token = this.advance(); return { kind: "while", condition: this.expression(), body: this.suite(token), token }; }
  private forStmt(): Statement { const token = this.advance(), target = this.assignmentTarget(); if (!target) this.fail(this.cur(), "for 뒤에는 변수 이름이 필요합니다."); if (!this.match("in")) this.fail(this.cur(), "for 문에는 in이 필요합니다."); return { kind: "for", target, iterable: this.expression(), body: this.suite(token), token }; }
  private withStmt(): Statement { const token = this.advance(), value = this.expression(); if (value.kind !== "call" || value.callee.kind !== "name" || value.callee.id !== "open") this.fail(token, "with에는 open() 파일 하나만 사용할 수 있습니다.", "unsupported"); if (!this.match("as")) this.fail(this.cur(), "with open() 뒤에는 as 파일변수가 필요합니다."); const name = this.cur(); if (name.kind !== "identifier") this.fail(name, "as 뒤에는 파일변수 이름이 필요합니다."); this.advance(); return { kind: "with", value, name: name.lexeme, body: this.suite(token), token }; }
  private tryStmt(): Statement { const token = this.advance(), body = this.suite(token), handlers: { type?: string; name?: string; body: Statement[]; token: Token }[] = []; let bare = false; while (this.cur().lexeme === "except") { if (bare) this.fail(this.cur(), "bare except는 마지막에만 사용할 수 있습니다."); const except = this.advance(); let type: string | undefined, name: string | undefined; if (this.cur().lexeme !== ":") { const value = this.cur(); if (value.kind !== "identifier" || !errorTypes.has(value.lexeme)) this.fail(value, "알 수 없는 오류 종류입니다."); type = this.advance().lexeme; if (this.match("as")) { const variable = this.cur(); if (variable.kind !== "identifier") this.fail(variable, "as 뒤에는 변수 이름이 필요합니다."); name = this.advance().lexeme; } } else bare = true; handlers.push({ type, name, body: this.suite(except), token: except }); } if (!handlers.length) this.fail(token, "try에는 except가 하나 이상 필요합니다."); let otherwise: Statement[] | undefined; if (this.cur().lexeme === "else") { const elseToken = this.advance(); otherwise = this.suite(elseToken); } return { kind: "try", body, handlers, otherwise, token }; }
  private suite(token: Token) { if (!this.match(":")) this.fail(this.cur(), "':'이 필요합니다."); if (this.cur().kind !== "newline") this.fail(this.cur(), "':' 뒤에는 줄바꿈이 필요합니다."); this.skip(); if (this.cur().kind !== "indent") this.fail(this.cur(), "들여쓴 본문이 필요합니다."); this.advance(); const body = this.statements("dedent"); if (!body.length) this.fail(token, "들여쓴 본문이 필요합니다."); return body; }
  private expression(min = 0): Expr {
    let left = this.prefix();
    while (true) {
      const token = this.cur();
      if (comparisons.has(token.lexeme) && 30 >= min) { const operands = [left], ops: string[] = []; while (comparisons.has(this.cur().lexeme)) { ops.push(this.advance().lexeme); operands.push(this.expression(31)); } left = { kind: "compare", operands, ops, token }; continue; }
      if ((token.lexeme === "in" || (token.lexeme === "not" && this.peek().lexeme === "in")) && 30 >= min) { this.advance(); if (token.lexeme === "not") this.advance(); left = { kind: "binary", op: token.lexeme === "not" ? "not in" : "in", left, right: this.expression(31), token }; continue; }
      const binding = this.binding(token.lexeme); if (!binding || binding.left < min) break; this.advance(); const right = this.expression(binding.right); left = token.lexeme === "and" || token.lexeme === "or" ? { kind: "logical", op: token.lexeme, left, right, token } : { kind: "binary", op: token.lexeme, left, right, token };
    }
    return left;
  }
  private binding(op: string) { if (op === "or") return { left: 10, right: 11 }; if (op === "and") return { left: 20, right: 21 }; if (op === "**") return { left: 80, right: 80 }; if (["*", "/", "//", "%"].includes(op)) return { left: 60, right: 61 }; if (["+", "-"].includes(op)) return { left: 50, right: 51 }; return undefined; }
  private prefix(): Expr {
    const token = this.advance(); let node: Expr;
    if (token.kind === "number" || token.kind === "string") node = { kind: "literal", value: token.value!, token };
    else if (token.kind === "fstring") node = this.fstring(token);
    else if (["True", "False", "None"].includes(token.lexeme)) node = { kind: "literal", value: token.lexeme === "True" ? true : token.lexeme === "False" ? false : null, token };
    else if ((token.kind === "operator" && ["+", "-"].includes(token.lexeme)) || token.lexeme === "not") node = { kind: "unary", op: token.lexeme, operand: this.expression(token.lexeme === "not" ? 25 : 70), token };
    else if (token.lexeme === "[") node = this.sequence(token);
    else if (token.lexeme === "{") node = this.dict(token);
    else if (token.lexeme === "(") node = this.paren(token);
    else if (token.kind === "identifier") node = { kind: "name", id: token.lexeme, token };
    else this.fail(token, "값이 필요합니다.");
    return this.postfix(node);
  }
  private postfix(node: Expr): Expr { while (true) { if (this.match("(")) { const args: Expr[] = [], keywords: { name: string; value: Expr; token: Token }[] = [], names = new Set<string>(); let keywordSeen = false; if (!this.match(")")) while (true) { if (this.cur().kind === "identifier" && this.peek().lexeme === "=") { const token = this.advance(); this.advance(); if (names.has(token.lexeme)) this.fail(token, "같은 키워드 인수를 두 번 전달할 수 없습니다."); names.add(token.lexeme); keywordSeen = true; keywords.push({ name: token.lexeme, value: this.expression(), token }); } else { if (keywordSeen) this.fail(this.cur(), "키워드 인수 뒤에는 위치 인수를 둘 수 없습니다."); args.push(this.expression()); } if (this.match(")")) break; if (!this.match(",")) this.fail(this.cur(), "쉼표 또는 닫는 괄호가 필요합니다."); if (this.match(")")) break; } node = { kind: "call", callee: node, args, keywords, token: (node as { token: Token }).token }; continue; } if (this.match("[")) { node = { kind: "subscript", object: node, index: this.subscript((node as { token: Token }).token), token: (node as { token: Token }).token }; continue; } if (this.match(".")) { const name = this.cur(); if (name.kind !== "identifier") this.fail(name, "속성 이름이 필요합니다."); this.advance(); node = { kind: "attribute", object: node, name: name.lexeme, token: name }; continue; } break; } return node; }
  private subscript(token: Token): Expr | Extract<Expr, { kind: "slice" }> { let start: Expr | undefined, stop: Expr | undefined, step: Expr | undefined; if (this.cur().lexeme !== ":" && this.cur().lexeme !== "]") start = this.expression(); if (this.match(":")) { if (this.cur().lexeme !== ":" && this.cur().lexeme !== "]") stop = this.expression(); if (this.match(":")) if (this.cur().lexeme !== "]") step = this.expression(); if (!this.match("]")) this.fail(this.cur(), "닫는 대괄호가 필요합니다."); return { kind: "slice", start, stop, step, token }; } if (!this.match("]")) this.fail(this.cur(), "닫는 대괄호가 필요합니다."); if (!start) this.fail(token, "인덱스가 필요합니다."); return start; }
  private sequence(token: Token): Expr {
    if (this.match("]")) return { kind: "list", values: [], token };
    const first = this.expression();
    if (this.cur().lexeme === "for") {
      const clauses: { target: Target; iterable: Expr; filters: Expr[]; token: Token }[] = [];
      while (this.cur().lexeme === "for") {
        const forToken = this.advance(), target = this.assignmentTarget();
        if (!target) this.fail(this.cur(), "리스트 내포의 for 뒤에는 변수 이름이 필요합니다.");
        const validTarget = (value: Target): boolean => value.kind === "name" || (value.kind === "unpack" && value.values.every(validTarget));
        if (!validTarget(target)) this.fail(forToken, "리스트 내포에는 변수 대입만 사용할 수 있습니다.");
        if (!this.match("in")) this.fail(this.cur(), "리스트 내포의 for에는 in이 필요합니다.");
        const iterable = this.expression(), filters: Expr[] = [];
        while (this.cur().lexeme === "if") { this.advance(); filters.push(this.expression()); }
        clauses.push({ target, iterable, filters, token: forToken });
      }
      if (!this.match("]")) this.fail(this.cur(), "리스트 내포의 닫는 대괄호가 필요합니다.");
      return { kind: "list-comprehension", element: first, clauses, token };
    }
    const values = [first];
    while (!this.match("]")) { if (!this.match(",")) this.fail(this.cur(), "쉼표 또는 닫는 대괄호가 필요합니다."); if (this.match("]")) break; values.push(this.expression()); }
    return { kind: "list", values, token };
  }
  private paren(token: Token): Expr { if (this.match(")")) return { kind: "tuple", values: [], token }; const first = this.expression(); if (!this.match(",")) { if (!this.match(")")) this.fail(this.cur(), "닫는 괄호가 필요합니다."); return first; } const values = [first]; while (!this.match(")")) { values.push(this.expression()); if (!this.match(",")) { if (!this.match(")")) this.fail(this.cur(), "닫는 괄호가 필요합니다."); break; } } return { kind: "tuple", values, token }; }
  private dict(token: Token): Expr { const entries: { key: Expr; value: Expr }[] = []; if (!this.match("}")) while (true) { const key = this.expression(); if (!this.match(":")) this.fail(this.cur(), "딕셔너리 키 뒤에는 ':'이 필요합니다."); entries.push({ key, value: this.expression() }); if (this.match("}")) break; if (!this.match(",")) this.fail(this.cur(), "쉼표 또는 닫는 중괄호가 필요합니다."); if (this.match("}")) break; } return { kind: "dict", entries, token }; }
  private fstring(token: Token): Expr {
    const source = String(token.value ?? ""), parts: (string | { expression: Expr; format?: FStringFormat })[] = [];
    let text = "";
    for (let index = 0; index < source.length; index++) {
      const char = source[index];
      if (char === "{") {
        if (source[index + 1] === "{") { text += "{"; index++; continue; }
        if (text) { parts.push(text); text = ""; }
        const end = source.indexOf("}", index + 1); if (end < 0) this.fail(token, "f-string의 '}'가 필요합니다.");
        const raw = source.slice(index + 1, end), separator = raw.indexOf(":"), expression = separator < 0 ? raw : raw.slice(0, separator), spec = separator < 0 ? undefined : raw.slice(separator + 1);
        if (!expression.trim()) this.fail(token, "f-string의 중괄호 안에는 표현식이 필요합니다.");
        let format: FStringFormat | undefined;
        if (spec !== undefined) {
          const align = /^([<>^])([1-9][0-9]*)$/.exec(spec), zero = /^0([1-9][0-9]*)$/.exec(spec), fixed = /^\.([0-9]+)f$/.exec(spec);
          if (align) format = { kind: "align", align: align[1] as "<" | ">" | "^", width: Number(align[2]) };
          else if (zero) format = { kind: "zero", width: Number(zero[1]) };
          else if (fixed) format = { kind: "fixed", precision: Number(fixed[1]) };
          else this.fail(token, "지원하지 않는 f-string 형식입니다.");
        }
        try { const program = new Parser(lex(expression)).parse(); if (program.body.length !== 1 || program.body[0].kind !== "expression") this.fail(token, "f-string 표현식이 올바르지 않습니다."); parts.push({ expression: program.body[0].expression, format }); }
        catch (error) { if (error instanceof CompilerError) this.fail(token, "f-string 표현식이 올바르지 않습니다."); throw error; }
        index = end; continue;
      }
      if (char === "}") { if (source[index + 1] === "}") { text += "}"; index++; continue; } this.fail(token, "f-string의 단독 '}'는 사용할 수 없습니다."); }
      text += char;
    }
    if (text) parts.push(text); return { kind: "fstring", parts, token };
  }
}
export const parse = (tokens: Token[]) => new Parser(tokens).parse();
