import type { Expr, Statement, Target } from "./ast";
import { lex } from "./lexer";
import { parse } from "./parser";
import type { Bytecode, Instruction, UnpackPattern } from "./opcode";
import { CompilerError } from "./token";

type Loop = { breaks: number[]; continueTarget: number; cleanupDepth: number };

export function compile(source: string): Bytecode { return compileProgram(parse(lex(source)).body); }
function compileProgram(nodes: Statement[], functionScopes: ReadonlySet<string>[] = []): Bytecode {
  const instructions: Instruction[] = [], loops: Loop[] = [], exceptionNames: string[][] = [];
  const point = (token: { line: number; column: number }) => ({ line: token.line, column: token.column });
  const emit = (instruction: Instruction) => (instructions.push(instruction), instructions.length - 1);
  const patch = (index: number, target: number) => { const instruction = instructions[index]; if ("target" in instruction) instruction.target = target; };

  const expression = (node: Expr): void => {
    switch (node.kind) {
      case "literal": emit({ op: "constant", value: typeof node.value === "number" && /[.eE]/.test(node.token.lexeme) ? { kind: "float", value: node.value } : node.value, ...point(node.token) }); return;
      case "name": emit({ op: "load", name: node.id, ...point(node.token) }); return;
      case "starred": expression(node.value); return;
      case "lambda": makeFunction({ kind: "function", name: "<lambda>", params: node.params, body: [{ kind: "return", value: node.value, token: node.token }], globals: [], token: node.token }); return;
      case "conditional": {
        expression(node.condition);
        const alternative = emit({ op: "jump_if_false", target: -1, ...point(node.token) });
        expression(node.consequent);
        const end = emit({ op: "jump", target: -1, ...point(node.token) });
        patch(alternative, instructions.length); expression(node.alternative); patch(end, instructions.length); return;
      }
      case "unary": expression(node.operand); emit({ op: "unary", operator: node.op, ...point(node.token) }); return;
      case "binary": expression(node.left); expression(node.right); emit({ op: "binary", operator: node.op, ...point(node.token) }); return;
      case "compare": {
        expression(node.operands[0]);
        const exits: number[] = [];
        node.ops.forEach((operator, index) => {
          expression(node.operands[index + 1]);
          if (index < node.ops.length - 1) exits.push(emit({ op: "compare_step", operator, target: -1, ...point(node.token) }));
          else emit({ op: "compare", operators: [operator], count: 2, ...point(node.token) });
        });
        exits.forEach(index => patch(index, instructions.length)); return;
      }
      case "logical": {
        expression(node.left);
        const jump = emit({ op: node.op === "and" ? "jump_if_false_keep" : "jump_if_true_keep", target: -1, ...point(node.token) });
        expression(node.right); patch(jump, instructions.length); return;
      }
      case "list": node.values.forEach(expression); emit({ op: "build_list", count: node.values.length, spreads: node.values.map(value => value.kind === "starred"), ...point(node.token) }); return;
      case "set": node.values.forEach(expression); emit({ op: "build_set", count: node.values.length, ...point(node.token) }); return;
      case "list-comprehension": case "set-comprehension": case "dict-comprehension": {
        const hidden = "\u0000comprehension";
        const iterableName = "\u0000iterable";
        const keyName = "\u0000key";
        const name = { kind: "name", id: hidden, token: node.token } as const;
        const append = node.kind === "dict-comprehension"
          ? { kind: "assign", targets: [{ kind: "subscript", object: name, index: { kind: "name", id: keyName, token: node.token }, token: node.token }], value: node.element, token: node.token } as Statement
          : { kind: "expression", expression: { kind: "call", callee: { kind: "attribute", object: name, name: node.kind === "set-comprehension" ? "add" : "append", token: node.token }, args: [node.element], keywords: [], token: node.token }, token: node.token } as Statement;
        const filters = (clauses: typeof node.clauses[number]["filters"], body: Statement[]): Statement[] => clauses.reduceRight((next, condition) => [{ kind: "if", branches: [{ condition, body: next, token: node.token }], token: node.token } as Statement], body);
        const loops = (index: number): Statement[] => {
          if (index === node.clauses.length) return node.kind === "dict-comprehension" ? [{ kind: "assign", targets: [{ kind: "name", id: keyName, token: node.token }], value: node.key!, token: node.token }, append] : [append];
          const clause = node.clauses[index];
          return [{ kind: "for", target: clause.target, iterable: index === 0 ? { kind: "name", id: iterableName, token: clause.token } : clause.iterable, body: filters(clause.filters, loops(index + 1)), token: clause.token } as Statement];
        };
        const targetNamesForComprehension = (target: Target): string[] => target.kind === "name" ? [target.id] : target.kind === "unpack" ? target.values.flatMap(targetNamesForComprehension) : target.kind === "star-target" ? targetNamesForComprehension(target.target) : [];
        const bytecode = compileProgram([
          { kind: "assign", targets: [name], value: node.kind === "dict-comprehension" ? { kind: "dict", entries: [], token: node.token } : { kind: node.kind === "set-comprehension" ? "set" : "list", values: [], token: node.token }, token: node.token },
          ...loops(0),
          { kind: "return", value: name, token: node.token },
        ]);
        expression(node.clauses[0].iterable);
        emit({ op: "run_comprehension", bytecode, iterableName, localNames: [hidden, iterableName, keyName, ...node.clauses.flatMap(clause => targetNamesForComprehension(clause.target))], ...point(node.token) }); return;
      }
      case "tuple": node.values.forEach(expression); emit({ op: "build_tuple", count: node.values.length, spreads: node.values.map(value => value.kind === "starred"), ...point(node.token) }); return;
      case "dict": node.entries.forEach(entry => { expression(entry.key); expression(entry.value); }); emit({ op: "build_dict", count: node.entries.length, spreads: node.entries.map(entry => !!entry.spread), ...point(node.token) }); return;
      case "slice": if (node.start) expression(node.start); if (node.stop) expression(node.stop); if (node.step) expression(node.step); emit({ op: "build_slice", hasStart: !!node.start, hasStop: !!node.stop, hasStep: !!node.step, ...point(node.token) }); return;
      case "subscript": expression(node.object); expression(node.index); emit({ op: "load_subscript", ...point(node.token) }); return;
      case "attribute": expression(node.object); emit({ op: "load_attr", name: node.name, ...point(node.token) }); return;
      case "fstring": node.parts.forEach(part => { if (typeof part === "string") emit({ op: "constant", value: part, ...point(node.token) }); else { expression(part.expression); if (part.format) emit({ op: "format_value", format: part.format, ...point(node.token) }); } }); emit({ op: "build_string", count: node.parts.length, ...point(node.token) }); return;
      case "call":
        if (node.callee.kind === "attribute") { expression(node.callee.object); node.args.forEach(expression); node.keywords.forEach(keyword => expression(keyword.value)); emit({ op: "call_method", name: node.callee.name, argc: node.args.length, spreads: node.args.map(value => value.kind === "starred"), keywords: node.keywords.map(keyword => keyword.name), ...point(node.token) }); }
        else { expression(node.callee); node.args.forEach(expression); node.keywords.forEach(keyword => expression(keyword.value)); emit({ op: "call_value", argc: node.args.length, spreads: node.args.map(value => value.kind === "starred"), keywords: node.keywords.map(keyword => keyword.name), ...point(node.token) }); }
        return;
    }
  };
  const makeFunction = (node: Extract<Statement, { kind: "function" }>): void => {
    const validateNonlocals = (body: Statement[]): void => body.forEach(statement => {
      if (statement.kind === "nonlocal") for (const name of statement.names) {
        if (!functionScopes.some(scope => scope.has(name))) throw new CompilerError({ ...point(statement.token), category: "syntax", message: `'${name}' 이름의 바깥 함수 변수가 없습니다.` });
      }
      if (statement.kind === "for" || statement.kind === "while" || statement.kind === "with") validateNonlocals(statement.body);
      if (statement.kind === "if") statement.branches.forEach(branch => validateNonlocals(branch.body));
      if ("otherwise" in statement && statement.otherwise) validateNonlocals(statement.otherwise);
      if (statement.kind === "try") { validateNonlocals(statement.body); statement.handlers.forEach(handler => validateNonlocals(handler.body)); if (statement.finalbody) validateNonlocals(statement.finalbody); }
    });
    validateNonlocals(node.body);
    const names = localNames(node.body, node.params.map(parameter => parameter.name), [...node.globals, ...(node.nonlocals ?? [])]);
    const defaults = node.params.filter(parameter => parameter.defaultValue); defaults.forEach(parameter => expression(parameter.defaultValue!));
    const bytecode = compileProgram(node.body, [new Set(names), ...functionScopes]); bytecode.instructions.push({ op: "constant", value: null, ...point(node.token) }, { op: "return_value", ...point(node.token) });
    emit({ op: "make_function", name: node.name, params: node.params.map(parameter => ({ name: parameter.name, kind: parameter.kind, hasDefault: !!parameter.defaultValue })), localNames: localNames(node.body, node.params.map(parameter => parameter.name), [...node.globals, ...(node.nonlocals ?? [])]), globals: node.globals, nonlocals: node.nonlocals, bytecode, ...point(node.token) });
  };
  const prepareTarget = (target: Target) => { if (target.kind === "subscript") { expression(target.object); expression(target.index); } else if (target.kind === "attribute") expression(target.object); };
  const store = (target: Target) => {
    if (target.kind === "star-target") throw new CompilerError({ ...point(target.token), category: "syntax", message: "별표 대입은 언패킹 안에서만 사용할 수 있습니다." });
    if (target.kind === "name") emit({ op: "store", name: target.id, ...point(target.token) });
    else if (target.kind === "unpack") emit({ op: "unpack", names: unpackNames(target), pattern: pattern(target), ...point(target.token) });
    else if (target.kind === "subscript") emit({ op: "store_subscript", ...point(target.token) }); else emit({ op: "store_attr", name: target.name, ...point(target.token) });
  };
  const storeKeepingValue = (target: Target) => {
    if (target.kind === "star-target") throw new CompilerError({ ...point(target.token), category: "syntax", message: "별표 대입은 언패킹 안에서만 사용할 수 있습니다." });
    prepareTarget(target);
    if (target.kind === "name") emit({ op: "store_keep", name: target.id, ...point(target.token) });
    else if (target.kind === "unpack") { emit({ op: "dup", ...point(target.token) }); assignUnpack(target); }
    else if (target.kind === "subscript") emit({ op: "store_subscript_keep", ...point(target.token) }); else emit({ op: "store_attr_keep", name: target.name, ...point(target.token) });
  };
  const unpackLeaves = (target: Target): Exclude<Target, { kind: "unpack" | "star-target" }>[] => target.kind === "unpack" ? target.values.flatMap(unpackLeaves) : target.kind === "star-target" ? unpackLeaves(target.target) : [target];
  const pattern = (target: Target): UnpackPattern => {
    if (target.kind === "star-target") return { kind: "star", target: pattern(target.target) };
    if (target.kind !== "unpack") return { kind: "leaf" };
    if (target.values.filter(value => value.kind === "star-target").length > 1) throw new CompilerError({ ...point(target.token), category: "syntax", message: "언패킹 한 묶음에는 별표를 한 번만 사용할 수 있습니다." });
    return { kind: "sequence", children: target.values.map(pattern) };
  };
  const assignUnpack = (target: Target): void => {
    const leaves = unpackLeaves(target), names = leaves.map((_, index) => `\u0000unpack${index}`);
    emit({ op: "unpack", names, pattern: pattern(target), ...point(target.token) });
    leaves.forEach((leaf, index) => { prepareTarget(leaf); emit({ op: "load", name: names[index], ...point(leaf.token) }); store(leaf); });
  };
  const unpackNames = (target: Target): string[] => {
    const leaves = unpackLeaves(target); if (!leaves.every(leaf => leaf.kind === "name")) throw new CompilerError({ line: target.token.line, column: target.token.column, category: "syntax", message: "이 위치에서는 변수 언패킹만 사용할 수 있습니다." });
    return leaves.map(leaf => (leaf as Extract<Target, { kind: "name" }>).id);
  };
  const targetNames = (target: Target) => target.kind === "name" ? [target.id] : target.kind === "unpack" ? (() => { const leaves = unpackLeaves(target); return leaves.every(leaf => leaf.kind === "name") ? leaves.map(leaf => (leaf as Extract<Target, { kind: "name" }>).id) : undefined; })() : undefined;
  const body = (statements: Statement[]) => statements.forEach(statement);
  const statement = (node: Statement): void => {
    if (node.kind === "import") { emit({ op: "import_module", module: node.module, member: node.member, ...point(node.token) }); emit({ op: "store", name: node.binding, ...point(node.token) }); return; }
    if (node.kind === "class") { const bytecode = compileProgram(node.body, functionScopes); if (node.parent) expression(node.parent); emit({ op: "make_class", name: node.name, bytecode, hasParent: !!node.parent, ...point(node.token) }); emit({ op: "store", name: node.name, ...point(node.token) }); return; }
    if (node.kind === "with") { expression(node.value); const setup = emit({ op: "enter_with", name: node.name, end: -1, ...point(node.token) }); body(node.body); emit({ op: "exit_with", ...point(node.token) }); (instructions[setup] as Extract<Instruction, { op: "enter_with" }>).end = instructions.length; return; }
    if (node.kind === "raise") { if (node.value) expression(node.value); emit({ op: "raise", hasValue: !!node.value, ...point(node.token) }); return; }
    if (node.kind === "delete") {
      const remove = (target: Target): void => { if (target.kind === "unpack") { target.values.forEach(remove); return; } if (target.kind === "attribute") throw new CompilerError({ ...point(target.token), category: "unsupported", message: "속성 삭제는 현재 지원하지 않습니다." }); prepareTarget(target); emit(target.kind === "name" ? { op: "delete_name", name: target.id, ...point(target.token) } : { op: "delete_subscript", ...point(target.token) }); };
      remove(node.target); return;
    }
    if (node.kind === "assert") {
      expression(node.condition); emit({ op: "unary", operator: "not", ...point(node.token) });
      const end = emit({ op: "jump_if_false", target: -1, ...point(node.token) });
      expression({ kind: "call", callee: { kind: "name", id: "AssertionError", token: node.token }, args: node.message ? [node.message] : [], keywords: [], token: node.token });
      emit({ op: "raise", hasValue: true, ...point(node.token) }); patch(end, instructions.length); return;
    }
    if (node.kind === "try") {
      const finalSetup = node.finalbody ? emit({ op: "setup_finally", target: -1, end: -1, ...point(node.token) }) : undefined;
      if (node.handlers.length) {
        const setup = emit({ op: "setup_except", end: -1, handlers: node.handlers.map(handler => ({ type: handler.type, name: handler.name, target: -1, end: -1 })), ...point(node.token) });
        body(node.body); emit({ op: "pop_except", ...point(node.token) });
        const region = instructions[setup] as Extract<Instruction, { op: "setup_except" }>; region.end = instructions.length;
        if (node.otherwise) body(node.otherwise);
        const exits = [emit({ op: "jump", target: -1, ...point(node.token) })];
        node.handlers.forEach((handler, index) => {
          region.handlers[index].target = instructions.length;
          body(handler.body); emit({ op: "end_handler", ...point(handler.token) }); region.handlers[index].end = instructions.length;
          exits.push(emit({ op: "jump", target: -1, ...point(handler.token) }));
        });
        exits.forEach(exit => patch(exit, instructions.length));
      } else body(node.body);
      if (node.finalbody) {
        const normalExit = emit({ op: "jump", target: -1, ...point(node.token) });
        const final = instructions[finalSetup!] as Extract<Instruction, { op: "setup_finally" }>; final.target = instructions.length;
        body(node.finalbody); emit({ op: "end_finally", ...point(node.token) }); final.end = instructions.length;
        patch(normalExit, instructions.length);
      }
      return;
    }
    if (node.kind === "pass") return;
    if (node.kind === "function") { makeFunction(node); emit({ op: "store", name: node.name, ...point(node.token) }); return; }
    if (node.kind === "return") { if (node.value) expression(node.value); else emit({ op: "constant", value: null, ...point(node.token) }); emit({ op: "return_value", ...point(node.token) }); return; }
    if (node.kind === "global" || node.kind === "nonlocal") return;
    if (node.kind === "assign") {
      if (node.targets.length === 1 && node.targets[0].kind === "unpack") {
        expression(node.value); assignUnpack(node.targets[0]);
      }
      else if (node.targets.length === 1) { expression(node.value); storeKeepingValue(node.targets[0]); emit({ op: "pop", ...point(node.token) }); }
      else { expression(node.value); node.targets.forEach(storeKeepingValue); emit({ op: "pop", ...point(node.token) }); }
      return;
    }
    if (node.kind === "augassign") {
      if (node.target.kind === "name") { expression(node.target); expression(node.value); emit({ op: "binary", inplace: true, operator: node.op, ...point(node.token) }); emit({ op: "store", name: node.target.id, ...point(node.token) }); }
      else if(node.target.kind==="subscript") { expression(node.target.object); expression(node.target.index); emit({ op: "dup_two", ...point(node.token) }); emit({ op: "load_subscript", ...point(node.token) }); expression(node.value); emit({ op: "binary", inplace: true, operator: node.op, ...point(node.token) }); emit({ op: "store_subscript", ...point(node.token) }); }
      else { expression(node.target.object); emit({op:"dup",...point(node.token)}); emit({op:"load_attr",name:node.target.name,...point(node.token)}); expression(node.value); emit({op:"binary",inplace:true,operator:node.op,...point(node.token)}); emit({op:"store_attr",name:node.target.name,...point(node.token)}); }
      return;
    }
    if (node.kind === "expression") { expression(node.expression); emit({ op: "pop", ...point(node.token) }); return; }
    if (node.kind === "if") {
      const exits: number[] = [];
      node.branches.forEach((branch, index) => { expression(branch.condition); const next = emit({ op: "jump_if_false", target: -1, ...point(branch.token) }); body(branch.body); if (index < node.branches.length - 1 || node.otherwise) exits.push(emit({ op: "jump", target: -1, ...point(branch.token) })); patch(next, instructions.length); });
      if (node.otherwise) body(node.otherwise); exits.forEach(exit => patch(exit, instructions.length)); return;
    }
    if (node.kind === "while") {
      const start = instructions.length; emit({ op: "loop_guard", ...point(node.token) }); expression(node.condition); const end = emit({ op: "jump_if_false", target: -1, ...point(node.token) }); const loop: Loop = { breaks: [], continueTarget: start, cleanupDepth: exceptionNames.length }; loops.push(loop); body(node.body); loops.pop(); emit({ op: "jump", target: start, ...point(node.token) }); patch(end, instructions.length); if (node.otherwise) body(node.otherwise); loop.breaks.forEach(index => patch(index, instructions.length)); return;
    }
    if (node.kind === "for") {
      const names = targetNames(node.target); if (!names) throw new CompilerError({ line: node.token.line, column: node.token.column, category: "syntax", message: "for 대상이 올바르지 않습니다." });
      expression(node.iterable); emit({ op: "iter_prepare", ...point(node.token) }); const start = instructions.length; emit({ op: "loop_guard", ...point(node.token) }); const next = emit({ op: "iter_next", names, pattern: pattern(node.target), target: -1, ...point(node.token) }); const loop: Loop = { breaks: [], continueTarget: start, cleanupDepth: exceptionNames.length }; loops.push(loop); body(node.body); loops.pop(); emit({ op: "jump", target: start, ...point(node.token) });
      patch(next, instructions.length); emit({ op: "pop", ...point(node.token) }); if (node.otherwise) body(node.otherwise);
      const end = emit({ op: "jump", target: -1, ...point(node.token) });
      loop.breaks.forEach(index => patch(index, instructions.length)); emit({ op: "pop", ...point(node.token) }); patch(end, instructions.length); return;
    }
    const loop = loops.at(-1); if (!loop) throw new CompilerError({ line: node.token.line, column: node.token.column, category: "syntax", message: `'${node.kind}'는 반복문 안에서만 사용할 수 있습니다.` });
    const jump = emit({ op: "jump", target: node.kind === "break" ? -1 : loop.continueTarget, ...point(node.token) }); if (node.kind === "break") loop.breaks.push(jump);
  };
  body(nodes);
  return { instructions };
}

function localNames(nodes: Statement[], params: string[], globals: string[]): string[] {
  const names = new Set(params);
  const add = (target: Target): void => { if (target.kind === "name") names.add(target.id); else if (target.kind === "unpack") target.values.forEach(add); else if (target.kind === "star-target") add(target.target); };
  const visit = (items: Statement[]): void => items.forEach(node => {
    if (node.kind === "import") names.add(node.binding);
    else if (node.kind === "function" || node.kind === "class") names.add(node.name);
    else if (node.kind === "try") { visit(node.body); node.handlers.forEach(handler => { if (handler.name) names.add(handler.name); visit(handler.body); }); if (node.otherwise) visit(node.otherwise); if (node.finalbody) visit(node.finalbody); }
    else if (node.kind === "with") { names.add(node.name); visit(node.body); }
    else if (node.kind === "assign") node.targets.forEach(add);
    else if (node.kind === "augassign") add(node.target);
    else if (node.kind === "delete") add(node.target);
    else if (node.kind === "for" || node.kind === "while") { if (node.kind === "for") add(node.target); visit(node.body); if (node.otherwise) visit(node.otherwise); }
    else if (node.kind === "if") { node.branches.forEach(branch => visit(branch.body)); if (node.otherwise) visit(node.otherwise); }
  });
  visit(nodes); globals.forEach(name => names.delete(name)); return [...names];
}
