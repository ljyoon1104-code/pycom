import type { Expr, FStringFormat, Name, Program, Statement, Target } from "./ast";
import { lex } from "./lexer";
import { pythonErrorNames } from "./python-errors";
import { CompilerError, type Token } from "./token";

const unsupported = new Set<string>();
const errorTypes = pythonErrorNames;
const compounds = new Set(["+=", "-=", "*=", "/=", "//=", "%=", "**="]);
const comparisons = new Set(["==", "!=", "<", "<=", ">", ">=", "is"]);

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
    if (token.lexeme === "import" || token.lexeme === "from") return this.importStmt();
    if (unsupported.has(token.lexeme)) this.fail(token, "이 문법은 현재 버전에서 지원하지 않습니다.", "unsupported");
    if (token.lexeme === "class") return this.classStmt(); if (token.lexeme === "def") return this.functionStmt(); if (token.lexeme === "if") return this.ifStmt(); if (token.lexeme === "while") return this.whileStmt(); if (token.lexeme === "for") return this.forStmt(); if (token.lexeme === "with") return this.withStmt(); if (token.lexeme === "try") return this.tryStmt();
    if (token.lexeme === "elif" || token.lexeme === "else") this.fail(token, "앞에 if 문이 없는 조건문입니다."); if (token.lexeme === "except") this.fail(token, "앞에 try 문이 없는 except입니다.");
    if (token.lexeme === "break" || token.lexeme === "continue") { this.advance(); return { kind: token.lexeme, token }; }
    if (token.lexeme === "pass") { this.advance(); return { kind: "pass", token }; }
    if (token.lexeme === "raise") { this.advance(); return { kind: "raise", value: ["newline", "dedent", "eof"].includes(this.cur().kind) || this.cur().lexeme === ";" ? undefined : this.expression(), token }; }
    if (token.lexeme === "del") { this.advance(); const target = this.assignmentTarget(); if (!target) this.fail(this.cur(), "삭제할 이름이나 첨자가 필요합니다."); return { kind: "delete", target, token }; }
    if (token.lexeme === "assert") { this.advance(); const condition = this.expression(), message = this.match(",") ? this.expression() : undefined; return { kind: "assert", condition, message, token }; }
    if (token.lexeme === "return") { if (!this.functionDepth) this.fail(token, "return은 함수 안에서만 사용할 수 있습니다."); this.advance(); return { kind: "return", value: ["newline", "dedent", "eof"].includes(this.cur().kind) ? undefined : this.assignmentValue(), token }; }
    if (token.lexeme === "global") { if (!this.functionDepth) this.fail(token, "global은 함수 안에서만 사용할 수 있습니다."); this.advance(); const names: string[] = []; while (true) { if (this.cur().kind !== "identifier") this.fail(this.cur(), "global 뒤에는 변수 이름이 필요합니다."); names.push(this.advance().lexeme); if (!this.match(",")) break; } return { kind: "global", names, token }; }
    if (token.lexeme === "nonlocal") { if (!this.functionDepth) this.fail(token, "nonlocal은 중첩 함수 안에서만 사용할 수 있습니다."); this.advance(); const names: string[] = []; while (true) { if (this.cur().kind !== "identifier") this.fail(this.cur(), "nonlocal 뒤에는 변수 이름이 필요합니다."); names.push(this.advance().lexeme); if (!this.match(",")) break; } return { kind: "nonlocal", names, token }; }

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
  private importStmt(): Statement {
    const token = this.advance();
    const identifier = () => { const value = this.cur(); if (value.kind !== "identifier") this.fail(value, "가져올 이름이 필요합니다."); return this.advance().lexeme; };
    let module = identifier();
    while (this.match(".")) module += "." + identifier();
    let member: string | undefined;
    if (token.lexeme === "from") {
      if (!this.match("import")) this.fail(this.cur(), "from 뒤에는 import가 필요합니다.");
      member = this.match("*") ? "*" : identifier();
    }
    const binding = this.match("as") ? identifier() : member ?? module.split(".")[0];
    return { kind: "import", module, member, binding, token };
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
    const values = [first]; let comma = false;
    while (this.match(",")) { comma = true; if ([")", "]", "=", "in"].includes(this.cur().lexeme)) break; const next = this.assignmentTargetAtom(); if (!next) this.fail(this.cur(), "대입 대상이 필요합니다."); values.push(next); }
    return comma ? { kind: "unpack", values, token: first.token } : first;
  }
  private assignmentTargetAtom(): Target | undefined {
    if (this.cur().lexeme === "*") { const token = this.advance(), target = this.assignmentTargetAtom(); if (!target || target.kind === "star-target") this.fail(token, "별표 뒤에는 대입 대상이 필요합니다."); return { kind: "star-target", target, token }; }
    if (this.cur().lexeme === "(" && this.peek().kind !== "identifier" && !["[", "(", "*"].includes(this.peek().lexeme)) return undefined;
    if (this.match("(")) {
      const target = this.assignmentTarget();
      if (!target) this.fail(this.cur(), "대입 대상이 필요합니다.");
      if (!this.match(")")) this.fail(this.cur(), "닫는 괄호가 필요합니다.");
      return target;
    }
    if (this.cur().lexeme === "[" && this.peek().kind !== "identifier" && !["[", "(", "*"].includes(this.peek().lexeme)) return undefined;
    if (this.match("[")) {
      const target = this.assignmentTarget();
      if (!target) this.fail(this.cur(), "대입 대상이 필요합니다.");
      if (!this.match("]")) this.fail(this.cur(), "닫는 대괄호가 필요합니다.");
      return target.kind === "unpack" ? target : { kind: "unpack", values: [target], token: target.token };
    }
    if (this.cur().kind !== "identifier") return undefined;
    const firstToken = this.advance(), first: Name = { kind: "name", id: firstToken.lexeme, token: firstToken };
    const node = this.postfix(first);
    return node.kind === "name" || node.kind === "subscript" || node.kind === "attribute" ? node : undefined;
  }
  private classStmt(): Statement { const token = this.advance(), name = this.cur(); if (name.kind !== "identifier") this.fail(name, "클래스 이름이 필요합니다."); this.advance(); let parent: Expr | undefined; if (this.match("(")) { if (!this.match(")")) { parent = this.expression(); if (this.match(",") && this.cur().lexeme !== ")") this.fail(this.cur(), "부모 클래스는 하나만 지정할 수 있습니다.", "unsupported"); if (!this.match(")")) this.fail(this.cur(), "닫는 괄호가 필요합니다."); } } const body = this.suite(token); for (const statement of body) if (!(["assign", "function", "pass"] as string[]).includes(statement.kind)) this.fail((statement as { token: Token }).token, "클래스 본문에는 속성 대입, 메서드 정의, pass만 사용할 수 있습니다."); return { kind: "class", name: name.lexeme, parent, body, token }; }
  private parameters(end: string): import("./ast").FunctionDef["params"] {
    const params: import("./ast").FunctionDef["params"] = [], names = new Set<string>(); let defaultSeen = false, keywordOnly = false, vararg = false, varkw = false;
    if (this.match(end)) return params;
    while (true) {
      let kind: import("./ast").ParameterKind = keywordOnly ? "keyword-only" : "positional";
      if (varkw) this.fail(this.cur(), "**kwargs 뒤에는 매개변수를 둘 수 없습니다.");
      if (this.match("**")) { kind = "varkw"; varkw = true; }
      else if (this.match("*")) { if (vararg) this.fail(this.cur(), "*args는 한 번만 사용할 수 있습니다."); kind = "varargs"; vararg = true; keywordOnly = true; }
      const parameter = this.cur(); if (parameter.kind !== "identifier") this.fail(parameter, "매개변수 이름이 필요합니다."); this.advance();
      if (names.has(parameter.lexeme)) this.fail(parameter, "같은 매개변수 이름을 두 번 사용할 수 없습니다."); names.add(parameter.lexeme);
      let defaultValue: Expr | undefined;
      if (this.match("=")) { if (kind === "varargs" || kind === "varkw") this.fail(parameter, "가변 인수에는 기본값을 지정할 수 없습니다."); defaultValue = this.expression(); if (kind === "positional") defaultSeen = true; }
      else if (kind === "positional" && defaultSeen) this.fail(parameter, "기본값 있는 매개변수 뒤에는 기본값 없는 매개변수를 둘 수 없습니다.");
      params.push({ name: parameter.lexeme, kind, defaultValue, token: parameter });
      if (this.match(end)) return params;
      if (!this.match(",")) this.fail(this.cur(), "쉼표 또는 매개변수의 끝이 필요합니다.");
      if (this.match(end)) return params;
    }
  }
  private functionStmt(): Statement {
    const token = this.advance(), name = this.cur(); if (name.kind !== "identifier") this.fail(name, "함수 이름이 필요합니다."); this.advance();
    if (!this.match("(")) this.fail(this.cur(), "함수 이름 뒤에는 '('가 필요합니다.");
    const params = this.parameters(")"); this.functionDepth++; const body = this.suite(token); this.functionDepth--;
    const seen = new Set(params.map(p => p.name)), globals: string[] = [], nonlocals: string[] = [];
    const rememberExpression = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach(rememberExpression); return; }
      const node = value as Record<string, unknown>;
      if (node.kind === "name") { seen.add(node.id as string); return; }
      if (node.kind === "lambda") { (value as Extract<Expr, {kind: "lambda"}>).params.forEach(p => rememberExpression(p.defaultValue)); return; }
      if (typeof node.kind === "string" && node.kind.endsWith("-comprehension")) {
        rememberExpression((value as Extract<Expr, {kind: "list-comprehension"}>).clauses[0].iterable); return;
      }
      for (const [key, child] of Object.entries(node)) if (key !== "token") rememberExpression(child);
    };
    const remember = (target: Target): void => { if (target.kind === "name") seen.add(target.id); else if (target.kind === "unpack") target.values.forEach(remember); else if (target.kind === "star-target") remember(target.target); };
    const visit = (nodes: Statement[]): void => nodes.forEach(statement => {
      for (const [key, value] of Object.entries(statement)) {
        if (!["token", "body", "otherwise", "finalbody", "handlers", "branches", "params"].includes(key)) rememberExpression(value);
      }
      if (statement.kind === "function") { statement.params.forEach(p => rememberExpression(p.defaultValue)); seen.add(statement.name); }
      if (statement.kind === "class") seen.add(statement.name);
      if (statement.kind === "import") seen.add(statement.binding);
      if (statement.kind === "global" || statement.kind === "nonlocal") {
        for (const id of statement.names) { if (seen.has(id)) this.fail(statement.token, "지역 변수로 사용한 이름은 global/nonlocal로 선언할 수 없습니다."); const own = statement.kind === "global" ? globals : nonlocals, other = statement.kind === "global" ? nonlocals : globals; if (other.includes(id)) this.fail(statement.token, "global과 nonlocal을 함께 선언할 수 없습니다."); if (!own.includes(id)) own.push(id); }
      } else if (statement.kind === "assign") statement.targets.forEach(remember);
      else if (statement.kind === "augassign" || statement.kind === "delete") remember(statement.target);
      else if (statement.kind === "for" || statement.kind === "while") { if (statement.kind === "for") remember(statement.target); visit(statement.body); if (statement.otherwise) visit(statement.otherwise); }
      else if (statement.kind === "if") { statement.branches.forEach(branch => { rememberExpression(branch.condition); visit(branch.body); }); if (statement.otherwise) visit(statement.otherwise); }
      else if (statement.kind === "try") { visit(statement.body); statement.handlers.forEach(handler => visit(handler.body)); if (statement.otherwise) visit(statement.otherwise); if (statement.finalbody) visit(statement.finalbody); }
      else if (statement.kind === "with") visit(statement.body);
    });
    visit(body); return { kind: "function", name: name.lexeme, params, body, globals, nonlocals, token };
  }
  private ifStmt(): Statement { const token = this.advance(), condition = this.expression(), branches = [{ condition, body: this.suite(token), token }]; let otherwise: Statement[] | undefined; while (this.cur().lexeme === "elif") { const branchToken = this.advance(); branches.push({ condition: this.expression(), body: this.suite(branchToken), token: branchToken }); } if (this.cur().lexeme === "else") { const branchToken = this.advance(); otherwise = this.suite(branchToken); } return { kind: "if", branches, otherwise, token }; }
  private whileStmt(): Statement { const token = this.advance(), condition = this.expression(), body = this.suite(token); const otherwise = this.match("else") ? this.suite(token) : undefined; return { kind: "while", condition, body, otherwise, token }; }
  private forStmt(): Statement { const token = this.advance(), target = this.assignmentTarget(); if (!target) this.fail(this.cur(), "for 뒤에는 변수 이름이 필요합니다."); if (!this.match("in")) this.fail(this.cur(), "for 문에는 in이 필요합니다."); const iterable = this.expression(), body = this.suite(token); const otherwise = this.match("else") ? this.suite(token) : undefined; return { kind: "for", target, iterable, body, otherwise, token }; }
  private withStmt(): Statement { const token = this.advance(), value = this.expression(); if (value.kind !== "call" || value.callee.kind !== "name" || value.callee.id !== "open") this.fail(token, "with에는 open() 파일 하나만 사용할 수 있습니다.", "unsupported"); if (!this.match("as")) this.fail(this.cur(), "with open() 뒤에는 as 파일변수가 필요합니다."); const name = this.cur(); if (name.kind !== "identifier") this.fail(name, "as 뒤에는 파일변수 이름이 필요합니다."); this.advance(); return { kind: "with", value, name: name.lexeme, body: this.suite(token), token }; }
  private tryStmt(): Statement {
    const token = this.advance(), body = this.suite(token), handlers: { type?: string; name?: string; body: Statement[]; token: Token }[] = [];
    let bare = false;
    while (this.cur().lexeme === "except") {
      if (bare) this.fail(this.cur(), "bare except는 마지막에만 사용할 수 있습니다.");
      const except = this.advance(); let type: string | undefined, name: string | undefined;
      if (this.cur().lexeme !== ":") {
        const value = this.cur(); if (value.kind !== "identifier" || !errorTypes.has(value.lexeme)) this.fail(value, "알 수 없는 오류 종류입니다."); type = this.advance().lexeme;
        if (this.match("as")) { const variable = this.cur(); if (variable.kind !== "identifier") this.fail(variable, "as 뒤에는 변수 이름이 필요합니다."); name = this.advance().lexeme; }
      } else bare = true;
      handlers.push({ type, name, body: this.suite(except), token: except });
    }
    let otherwise: Statement[] | undefined, finalbody: Statement[] | undefined;
    if (this.cur().lexeme === "else") { const next = this.advance(); if (!handlers.length) this.fail(next, "try의 else 앞에는 except가 필요합니다."); otherwise = this.suite(next); }
    if (this.cur().lexeme === "finally") { const next = this.advance(); finalbody = this.suite(next); }
    if (!handlers.length && !finalbody) this.fail(token, "try에는 except 또는 finally가 필요합니다.");
    return { kind: "try", body, handlers, otherwise, finalbody, token };
  }
  private suite(token: Token) { if (!this.match(":")) this.fail(this.cur(), "':'이 필요합니다."); if (this.cur().kind !== "newline") this.fail(this.cur(), "':' 뒤에는 줄바꿈이 필요합니다."); this.skip(); if (this.cur().kind !== "indent") this.fail(this.cur(), "들여쓴 본문이 필요합니다."); this.advance(); const body = this.statements("dedent"); if (!body.length) this.fail(token, "들여쓴 본문이 필요합니다."); return body; }
  private expression(min = 0): Expr {
    let left = this.prefix();
    while (true) {
      const token = this.cur();
      if (token.lexeme === "if" && min <= 5) { this.advance(); const condition = this.expression(6); if (!this.match("else")) this.fail(this.cur(), "조건 표현식에는 else가 필요합니다."); left = { kind: "conditional", condition, consequent: left, alternative: this.expression(5), token }; continue; }
      if (comparisons.has(token.lexeme) && 30 >= min) { const operands = [left], ops: string[] = []; while (comparisons.has(this.cur().lexeme)) { let op = this.advance().lexeme; if (op === "is" && this.match("not")) op = "is not"; ops.push(op); operands.push(this.expression(31)); } left = { kind: "compare", operands, ops, token }; continue; }
      if ((token.lexeme === "in" || (token.lexeme === "not" && this.peek().lexeme === "in")) && 30 >= min) { this.advance(); if (token.lexeme === "not") this.advance(); left = { kind: "binary", op: token.lexeme === "not" ? "not in" : "in", left, right: this.expression(31), token }; continue; }
      const binding = this.binding(token.lexeme); if (!binding || binding.left < min) break; this.advance(); const right = this.expression(binding.right); left = token.lexeme === "and" || token.lexeme === "or" ? { kind: "logical", op: token.lexeme, left, right, token } : { kind: "binary", op: token.lexeme, left, right, token };
    }
    return left;
  }
  private binding(op: string) { if (op === "or") return { left: 10, right: 11 }; if (op === "and") return { left: 20, right: 21 }; if (op === "|") return { left: 35, right: 36 }; if (op === "^") return { left: 37, right: 38 }; if (op === "&") return { left: 39, right: 40 }; if (op === "**") return { left: 80, right: 80 }; if (["*", "/", "//", "%"].includes(op)) return { left: 60, right: 61 }; if (["+", "-"].includes(op)) return { left: 50, right: 51 }; return undefined; }
  private prefix(): Expr {
    const token = this.advance(); let node: Expr;
    if (token.kind === "number" || token.kind === "string") node = { kind: "literal", value: token.value!, token };
    else if (token.lexeme === "lambda") node = { kind: "lambda", params: this.parameters(":"), value: this.expression(), token };
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
  private spreadExpression(): Expr { const token = this.match("*"); return token ? { kind: "starred", value: this.expression(), token } : this.expression(); }
  private postfix(node: Expr): Expr {
    while (true) {
      if (this.match("(")) {
        const args: Expr[] = [], keywords: { name: string; value: Expr; token: Token }[] = [], names = new Set<string>(); let keywordSeen = false, mappingSeen = false;
        if (!this.match(")")) while (true) {
          if (this.cur().lexeme === "**") { const token = this.advance(); keywords.push({ name: "", value: this.expression(), token }); keywordSeen = true; mappingSeen = true; }
          else if (this.cur().kind === "identifier" && this.peek().lexeme === "=") { const token = this.advance(); this.advance(); if (names.has(token.lexeme)) this.fail(token, "같은 키워드 인수를 두 번 전달할 수 없습니다."); names.add(token.lexeme); keywordSeen = true; keywords.push({ name: token.lexeme, value: this.expression(), token }); }
          else { if (this.cur().lexeme === "*") { if (mappingSeen) this.fail(this.cur(), "** 인수 뒤에는 * 인수를 둘 수 없습니다."); args.push(this.spreadExpression()); } else { if (keywordSeen) this.fail(this.cur(), "키워드 인수 뒤에는 위치 인수를 둘 수 없습니다."); args.push(this.expression()); } }
          if (this.match(")")) break; if (!this.match(",")) this.fail(this.cur(), "쉼표 또는 닫는 괄호가 필요합니다."); if (this.match(")")) break;
        }
        node = { kind: "call", callee: node, args, keywords, token: node.token }; continue;
      }
      if (this.match("[")) { node = { kind: "subscript", object: node, index: this.subscript(node.token), token: node.token }; continue; }
      if (this.match(".")) { const name = this.cur(); if (name.kind !== "identifier") this.fail(name, "속성 이름이 필요합니다."); this.advance(); node = { kind: "attribute", object: node, name: name.lexeme, token: name }; continue; }
      return node;
    }
  }
  private subscript(token: Token): Expr | Extract<Expr, { kind: "slice" }> { let start: Expr | undefined, stop: Expr | undefined, step: Expr | undefined; if (this.cur().lexeme !== ":" && this.cur().lexeme !== "]") start = this.expression(); if (this.match(":")) { if (this.cur().lexeme !== ":" && this.cur().lexeme !== "]") stop = this.expression(); if (this.match(":")) if (this.cur().lexeme !== "]") step = this.expression(); if (!this.match("]")) this.fail(this.cur(), "닫는 대괄호가 필요합니다."); return { kind: "slice", start, stop, step, token }; } if (!this.match("]")) this.fail(this.cur(), "닫는 대괄호가 필요합니다."); if (!start) this.fail(token, "인덱스가 필요합니다."); return start; }
  private sequence(token: Token): Expr {
    if (this.match("]")) return { kind: "list", values: [], token };
    const first = this.spreadExpression();
    if (this.cur().lexeme === "for") {
      if (first.kind === "starred") this.fail(first.token, "내포의 결과에는 별표를 사용할 수 없습니다.");
      const clauses: { target: Target; iterable: Expr; filters: Expr[]; token: Token }[] = [];
      while (this.cur().lexeme === "for") {
        const forToken = this.advance(), target = this.assignmentTarget();
        if (!target) this.fail(this.cur(), "리스트 내포의 for 뒤에는 변수 이름이 필요합니다.");
        const validTarget = (value: Target): boolean => value.kind === "name" || (value.kind === "unpack" && value.values.every(validTarget)) || value.kind === "star-target" && validTarget(value.target);
        if (!validTarget(target)) this.fail(forToken, "리스트 내포에는 변수 대입만 사용할 수 있습니다.");
        if (!this.match("in")) this.fail(this.cur(), "리스트 내포의 for에는 in이 필요합니다.");
        const iterable = this.expression(6), filters: Expr[] = [];
        while (this.cur().lexeme === "if") { this.advance(); filters.push(this.expression(6)); }
        clauses.push({ target, iterable, filters, token: forToken });
      }
      if (!this.match("]")) this.fail(this.cur(), "리스트 내포의 닫는 대괄호가 필요합니다.");
      return { kind: "list-comprehension", element: first, clauses, token };
    }
    const values = [first];
    while (!this.match("]")) { if (!this.match(",")) this.fail(this.cur(), "쉼표 또는 닫는 대괄호가 필요합니다."); if (this.match("]")) break; values.push(this.spreadExpression()); }
    return { kind: "list", values, token };
  }
  private paren(token: Token): Expr { if (this.match(")")) return { kind: "tuple", values: [], token }; const first = this.spreadExpression(); if (!this.match(",")) { if (first.kind === "starred") this.fail(token, "별표 튜플에는 쉼표가 필요합니다."); if (!this.match(")")) this.fail(this.cur(), "닫는 괄호가 필요합니다."); return first; } const values = [first]; while (!this.match(")")) { values.push(this.spreadExpression()); if (!this.match(",")) { if (!this.match(")")) this.fail(this.cur(), "닫는 괄호가 필요합니다."); break; } } return { kind: "tuple", values, token }; }
  private dict(token: Token): Expr {
    if (this.match("}")) return { kind: "dict", entries: [], token };
    const spread = !!this.match("**");
    const first: Expr = spread ? { kind: "literal", value: null, token } : this.expression();
    const dictionary = spread || !!this.match(":"), value = dictionary ? this.expression() : first;
    if (this.cur().lexeme === "for") {
      const clauses: import("./ast").ComprehensionClause[] = [];
      while (this.cur().lexeme === "for") {
        const next = this.advance(), target = this.assignmentTarget();
        const valid = (t: Target): boolean => t.kind === "name" || t.kind === "unpack" && t.values.every(valid) || t.kind === "star-target" && valid(t.target);
        if (!target || !valid(target)) this.fail(next, "내포의 반복 대상에는 변수 이름이 필요합니다.");
        if (!this.match("in")) this.fail(this.cur(), "내포의 for에는 in이 필요합니다.");
        const iterable = this.expression(6), filters: Expr[] = [];
        while (this.match("if")) filters.push(this.expression(6));
        clauses.push({ target, iterable, filters, token: next });
      }
      if (!this.match("}")) this.fail(this.cur(), "내포의 닫는 중괄호가 필요합니다.");
      return { kind: dictionary ? "dict-comprehension" : "set-comprehension", element: value, key: dictionary ? first : undefined, clauses, token };
    }
    const entries = [{ key: first, value, spread }], values = [first];
    while (!this.match("}")) {
      if (!this.match(",")) this.fail(this.cur(), "쉼표 또는 닫는 중괄호가 필요합니다.");
      if (this.match("}")) break;
      if (dictionary && this.match("**")) { entries.push({ key: { kind: "literal", value: null, token }, value: this.expression(), spread: true }); continue; }
      const key = this.expression();
      if (dictionary) { if (!this.match(":")) this.fail(this.cur(), "딕셔너리 키 뒤에는 ':'이 필요합니다."); entries.push({ key, value: this.expression(), spread: false }); }
      else values.push(key);
    }
    return dictionary ? { kind: "dict", entries, token } : { kind: "set", values, token };
  }
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
        try { const tokens = lex(expression).map(inner => ({ ...inner, line: token.line, column: token.column + index + 2 + inner.column, endColumn: token.column + index + 2 + inner.endColumn })); const program = new Parser(tokens).parse(); if (program.body.length !== 1 || program.body[0].kind !== "expression") this.fail(token, "f-string 표현식이 올바르지 않습니다."); parts.push({ expression: program.body[0].expression, format }); }
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
