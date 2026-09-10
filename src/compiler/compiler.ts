import type { Expr, Statement, Target } from "./ast";
import { lex } from "./lexer";
import { parse } from "./parser";
import type { Bytecode, Instruction } from "./opcode";
import { CompilerError } from "./token";

type Loop = { breaks: number[]; continueTarget: number; cleanupDepth: number };

export function compile(source: string): Bytecode { return compileProgram(parse(lex(source)).body); }
function compileProgram(nodes: Statement[]): Bytecode {
  const instructions: Instruction[] = [], loops: Loop[] = [], exceptionNames: string[][] = [];
  const point = (token: { line: number; column: number }) => ({ line: token.line, column: token.column });
  const emit = (instruction: Instruction) => (instructions.push(instruction), instructions.length - 1);
  const patch = (index: number, target: number) => { const instruction = instructions[index]; if ("target" in instruction) instruction.target = target; };

  const expression = (node: Expr): void => {
    switch (node.kind) {
      case "literal": emit({ op: "constant", value: node.value, ...point(node.token) }); return;
      case "name": emit({ op: "load", name: node.id, ...point(node.token) }); return;
      case "unary": expression(node.operand); emit({ op: "unary", operator: node.op, ...point(node.token) }); return;
      case "binary": expression(node.left); expression(node.right); emit({ op: "binary", operator: node.op, ...point(node.token) }); return;
      case "compare": node.operands.forEach(expression); emit({ op: "compare", operators: node.ops, count: node.operands.length, ...point(node.token) }); return;
      case "logical": {
        expression(node.left);
        const jump = emit({ op: node.op === "and" ? "jump_if_false_keep" : "jump_if_true_keep", target: -1, ...point(node.token) });
        expression(node.right); patch(jump, instructions.length); return;
      }
      case "list": node.values.forEach(expression); emit({ op: "build_list", count: node.values.length, ...point(node.token) }); return;
      case "list-comprehension": {
        const hidden = "\u0000comprehension";
        const name = { kind: "name", id: hidden, token: node.token } as const;
        const append = { kind: "expression", expression: { kind: "call", callee: { kind: "attribute", object: name, name: "append", token: node.token }, args: [node.element], keywords: [], token: node.token }, token: node.token } as Statement;
        const filters = (clauses: typeof node.clauses[number]["filters"], body: Statement[]): Statement[] => clauses.reduceRight((next, condition) => [{ kind: "if", branches: [{ condition, body: next, token: node.token }], token: node.token } as Statement], body);
        const loops = (index: number): Statement[] => {
          if (index === node.clauses.length) return [append];
          const clause = node.clauses[index];
          return [{ kind: "for", target: clause.target, iterable: clause.iterable, body: filters(clause.filters, loops(index + 1)), token: clause.token } as Statement];
        };
        const targetNamesForComprehension = (target: Target): string[] => target.kind === "name" ? [target.id] : target.kind === "unpack" ? target.values.flatMap(targetNamesForComprehension) : [];
        const bytecode = compileProgram([
          { kind: "assign", targets: [name], value: { kind: "list", values: [], token: node.token }, token: node.token },
          ...loops(0),
          { kind: "return", value: name, token: node.token },
        ]);
        emit({ op: "run_comprehension", bytecode, localNames: [hidden, ...node.clauses.flatMap(clause => targetNamesForComprehension(clause.target))], ...point(node.token) }); return;
      }
      case "tuple": node.values.forEach(expression); emit({ op: "build_tuple", count: node.values.length, ...point(node.token) }); return;
      case "dict": node.entries.forEach(entry => { expression(entry.key); expression(entry.value); }); emit({ op: "build_dict", count: node.entries.length, ...point(node.token) }); return;
      case "slice": if (node.start) expression(node.start); if (node.stop) expression(node.stop); if (node.step) expression(node.step); emit({ op: "build_slice", hasStart: !!node.start, hasStop: !!node.stop, hasStep: !!node.step, ...point(node.token) }); return;
      case "subscript": expression(node.object); expression(node.index); emit({ op: "load_subscript", ...point(node.token) }); return;
      case "attribute": expression(node.object); emit({ op: "load_attr", name: node.name, ...point(node.token) }); return;
      case "fstring": node.parts.forEach(part => { if (typeof part === "string") emit({ op: "constant", value: part, ...point(node.token) }); else { expression(part.expression); if (part.format) emit({ op: "format_value", format: part.format, ...point(node.token) }); } }); emit({ op: "build_string", count: node.parts.length, ...point(node.token) }); return;
      case "call":
        if (node.callee.kind === "attribute") { expression(node.callee.object); node.args.forEach(expression); emit({ op: "call_method", name: node.callee.name, argc: node.args.length, ...point(node.token) }); }
        else { expression(node.callee); node.args.forEach(expression); node.keywords.forEach(keyword => expression(keyword.value)); emit({ op: "call_value", argc: node.args.length, keywords: node.keywords.map(keyword => keyword.name), ...point(node.token) }); }
        return;
    }
  };
  const prepareTarget = (target: Target) => { if (target.kind === "subscript") { expression(target.object); expression(target.index); } else if (target.kind === "attribute") expression(target.object); };
  const store = (target: Target) => {
    if (target.kind === "name") emit({ op: "store", name: target.id, ...point(target.token) });
    else if (target.kind === "unpack") emit({ op: "unpack", names: unpackNames(target), ...point(target.token) });
    else if (target.kind === "subscript") emit({ op: "store_subscript", ...point(target.token) }); else emit({ op: "store_attr", name: target.name, ...point(target.token) });
  };
  const storeKeepingValue = (target: Target) => {
    prepareTarget(target);
    if (target.kind === "name") emit({ op: "store_keep", name: target.id, ...point(target.token) });
    else if (target.kind === "unpack") emit({ op: "unpack", names: unpackNames(target), ...point(target.token) });
    else if (target.kind === "subscript") emit({ op: "store_subscript_keep", ...point(target.token) }); else emit({ op: "store_attr_keep", name: target.name, ...point(target.token) });
  };
  const unpackLeaves = (target: Target): Exclude<Target, { kind: "unpack" }>[] => target.kind === "unpack" ? target.values.flatMap(unpackLeaves) : [target];
  const unpackNames = (target: Target): string[] => {
    const leaves = unpackLeaves(target); if (!leaves.every(leaf => leaf.kind === "name")) throw new CompilerError({ line: target.token.line, column: target.token.column, category: "syntax", message: "이 위치에서는 변수 언패킹만 사용할 수 있습니다." });
    return leaves.map(leaf => (leaf as Extract<Target, { kind: "name" }>).id);
  };
  const targetNames = (target: Target) => target.kind === "name" ? [target.id] : target.kind === "unpack" ? (() => { const leaves = unpackLeaves(target); return leaves.every(leaf => leaf.kind === "name") ? leaves.map(leaf => (leaf as Extract<Target, { kind: "name" }>).id) : undefined; })() : undefined;
  const body = (statements: Statement[]) => statements.forEach(statement);
  const cleanupForTransfer = (targetDepth: number, token: { line: number; column: number }) => {
    exceptionNames.slice(targetDepth).flat().reverse().forEach(name => emit({ op: "clear_exception", name, ...point(token) }));
  };
  const statement = (node: Statement): void => {
    if (node.kind === "class") { const bytecode = compileProgram(node.body); emit({ op: "make_class", name: node.name, bytecode, ...point(node.token) }); emit({ op: "store", name: node.name, ...point(node.token) }); return; }
    if (node.kind === "with") { expression(node.value); emit({ op: "enter_with", name: node.name, ...point(node.token) }); body(node.body); emit({ op: "exit_with", ...point(node.token) }); return; }
    if (node.kind === "try") { const setup = emit({ op: "setup_except", handlers: node.handlers.map(handler => ({ type: handler.type, name: handler.name, target: -1 })), ...point(node.token) }); body(node.body); emit({ op: "pop_except", ...point(node.token) }); if (node.otherwise) body(node.otherwise); const exits: number[] = [emit({ op: "jump", target: -1, ...point(node.token) })]; node.handlers.forEach((handler, index) => { (instructions[setup] as Extract<Instruction, { op: "setup_except" }>).handlers[index].target = instructions.length; exceptionNames.push(handler.name ? [handler.name] : []); body(handler.body); exceptionNames.pop(); if (handler.name) emit({ op: "clear_exception", name: handler.name, ...point(handler.token) }); exits.push(emit({ op: "jump", target: -1, ...point(handler.token) })); }); exits.forEach(exit => patch(exit, instructions.length)); return; }
    if (node.kind === "pass") return;
    if (node.kind === "function") { const defaults = node.params.filter(parameter => parameter.defaultValue); defaults.forEach(parameter => expression(parameter.defaultValue!)); const bytecode = compileProgram(node.body); bytecode.instructions.push({ op: "constant", value: null, ...point(node.token) }, { op: "return_value", ...point(node.token) }); emit({ op: "make_function", name: node.name, params: node.params.map(parameter => ({ name: parameter.name, hasDefault: !!parameter.defaultValue })), localNames: localNames(node.body, node.params.map(parameter => parameter.name), node.globals), globals: node.globals, bytecode, ...point(node.token) }); emit({ op: "store", name: node.name, ...point(node.token) }); return; }
    if (node.kind === "return") { if (node.value) expression(node.value); else emit({ op: "constant", value: null, ...point(node.token) }); cleanupForTransfer(0, node.token); emit({ op: "return_value", ...point(node.token) }); return; }
    if (node.kind === "global") return;
    if (node.kind === "assign") {
      if (node.targets.length === 1 && node.targets[0].kind === "unpack") {
        const leaves = unpackLeaves(node.targets[0]);
        const names = leaves.map((_, index) => `\u0000unpack${index}`);
        expression(node.value); emit({ op: "unpack", names, ...point(node.token) });
        leaves.forEach((target, index) => { prepareTarget(target); emit({ op: "load", name: names[index], ...point(target.token) }); store(target); });
      }
      else if (node.targets.length === 1) { prepareTarget(node.targets[0]); expression(node.value); store(node.targets[0]); }
      else { expression(node.value); node.targets.forEach(storeKeepingValue); emit({ op: "pop", ...point(node.token) }); }
      return;
    }
    if (node.kind === "augassign") {
      if (node.target.kind === "name") { expression(node.target); expression(node.value); emit({ op: "binary", operator: node.op, ...point(node.token) }); emit({ op: "store", name: node.target.id, ...point(node.token) }); }
      else if(node.target.kind==="subscript") { expression(node.target.object); expression(node.target.index); emit({ op: "load_subscript", ...point(node.token) }); expression(node.value); emit({ op: "binary", operator: node.op, ...point(node.token) }); emit({ op: "store_subscript", ...point(node.token) }); }
      else { expression(node.target.object); emit({op:"dup",...point(node.token)}); emit({op:"load_attr",name:node.target.name,...point(node.token)}); expression(node.value); emit({op:"binary",operator:node.op,...point(node.token)}); emit({op:"store_attr",name:node.target.name,...point(node.token)}); }
      return;
    }
    if (node.kind === "expression") { expression(node.expression); emit({ op: "pop", ...point(node.token) }); return; }
    if (node.kind === "if") {
      const exits: number[] = [];
      node.branches.forEach((branch, index) => { expression(branch.condition); const next = emit({ op: "jump_if_false", target: -1, ...point(branch.token) }); body(branch.body); if (index < node.branches.length - 1 || node.otherwise) exits.push(emit({ op: "jump", target: -1, ...point(branch.token) })); patch(next, instructions.length); });
      if (node.otherwise) body(node.otherwise); exits.forEach(exit => patch(exit, instructions.length)); return;
    }
    if (node.kind === "while") {
      const start = instructions.length; emit({ op: "loop_guard", ...point(node.token) }); expression(node.condition); const end = emit({ op: "jump_if_false", target: -1, ...point(node.token) }); const loop: Loop = { breaks: [], continueTarget: start, cleanupDepth: exceptionNames.length }; loops.push(loop); body(node.body); loops.pop(); emit({ op: "jump", target: start, ...point(node.token) }); patch(end, instructions.length); loop.breaks.forEach(index => patch(index, instructions.length)); return;
    }
    if (node.kind === "for") {
      const names = targetNames(node.target); if (!names) throw new CompilerError({ line: node.token.line, column: node.token.column, category: "syntax", message: "for 대상이 올바르지 않습니다." });
      expression(node.iterable); emit({ op: "iter_prepare", ...point(node.token) }); const start = instructions.length; emit({ op: "loop_guard", ...point(node.token) }); const next = emit({ op: "iter_next", names, target: -1, ...point(node.token) }); const loop: Loop = { breaks: [], continueTarget: start, cleanupDepth: exceptionNames.length }; loops.push(loop); body(node.body); loops.pop(); emit({ op: "jump", target: start, ...point(node.token) }); const clean = emit({ op: "pop", ...point(node.token) }); patch(next, clean); loop.breaks.forEach(index => patch(index, clean)); return;
    }
    const loop = loops.at(-1); if (!loop) throw new CompilerError({ line: node.token.line, column: node.token.column, category: "syntax", message: `'${node.kind}'는 반복문 안에서만 사용할 수 있습니다.` });
    cleanupForTransfer(loop.cleanupDepth, node.token); const jump = emit({ op: "jump", target: node.kind === "break" ? -1 : loop.continueTarget, ...point(node.token) }); if (node.kind === "break") loop.breaks.push(jump);
  };
  body(nodes);
  return { instructions };
}

function localNames(nodes: Statement[], params: string[], globals: string[]): string[] { const names = new Set(params); const add = (target: Target) => { if (target.kind === "name") names.add(target.id); else if (target.kind === "unpack") target.values.forEach(add); }; const visit = (items: Statement[]) => items.forEach(node => { if (node.kind === "assign") node.targets.forEach(add); else if (node.kind === "augassign") add(node.target); else if (node.kind === "for") { add(node.target); visit(node.body); } else if (node.kind === "if") { node.branches.forEach(branch => visit(branch.body)); if (node.otherwise) visit(node.otherwise); } else if (node.kind === "while") visit(node.body); }); visit(nodes); globals.forEach(name => names.delete(name)); return [...names]; }
