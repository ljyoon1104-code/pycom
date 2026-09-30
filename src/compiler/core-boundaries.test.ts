import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { expect, it } from "vitest";
import ts from "typescript";
import { createEmission, point } from "./emission";

const root = resolve("src");
const sources = readdirSync(root, { recursive: true }).map(String).filter(file => file.endsWith(".ts") && !file.endsWith(".test.ts"));
const edges: { from: string; to: string; typeOnly: boolean }[] = [];
for (const file of sources) {
  const ast = ts.createSourceFile(file, readFileSync(resolve(root, file), "utf8"), ts.ScriptTarget.Latest, true);
  const add = (specifier: string, typeOnly = false) => {
    if (!specifier.startsWith(".")) return;
    const target = ts.resolveModuleName(specifier, resolve(root, file), { moduleResolution: ts.ModuleResolutionKind.Bundler }, ts.sys).resolvedModule?.resolvedFileName;
    if (target) edges.push({ from: file.replaceAll("\\", "/"), to: relative(root, target).replaceAll("\\", "/"), typeOnly });
  };
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) add(node.moduleSpecifier.text, ts.isImportDeclaration(node) ? !!node.importClause?.isTypeOnly : node.isTypeOnly);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) add(node.argument.literal.text, true);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) add(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(ast);
}
it("compiler emission arrays are isolated and patching preserves argument/source identity", () => {
  const a = createEmission(), b = createEmission();
  const instruction = { op: "jump", target: -1, line: 2, column: 3 } as const;
  expect(a.emit(instruction)).toBe(0); a.patch(0, 4);
  expect(a.instructions).toEqual([{ op: "jump", target: 4, line: 2, column: 3 }]);
  expect(a.instructions[0]).toBe(instruction); expect(b.instructions).toEqual([]);
});
it("source location helper copies only line and column", () => {
  const token = { line: 4, column: 7, lexeme: "name" };
  expect(point(token)).toEqual({ line: 4, column: 7 }); expect(token.lexeme).toBe("name");
});
it("runtime depends on the compiler public entry or data types, never its AST implementation", () => {
  const allowed = ["compiler/compiler.ts", "compiler/opcode.ts", "compiler/token.ts", "compiler/python-errors.ts"];
    expect(edges.filter(edge => edge.from.startsWith("runtime/") && edge.to.startsWith("compiler/") && !allowed.includes(edge.to) && !(edge.typeOnly && edge.to === "compiler/ast.ts"))).toEqual([]);
});
it("compiler, values and module resolver do not depend on higher-level execution or UI", () => {
  expect(edges.filter(edge => edge.from.startsWith("compiler/") && edge.to === "runtime/worker.ts")).toEqual([]);
  expect(edges.filter(edge => edge.from === "runtime/value.ts" && edge.to === "runtime/vm.ts")).toEqual([]);
  expect(edges.filter(edge => /runtime\/.*modules?\.ts$/.test(edge.from) && /^(ui|app)\//.test(edge.to))).toEqual([]);
});
it("including export, inline type and dynamic import edges there are no cycles", () => {
  const done = new Set<string>();
  const visit = (file: string, stack: string[]): void => {
    expect(stack, [...stack, file].join(" -> ")).not.toContain(file);
    if (done.has(file)) return;
    for (const edge of edges.filter(edge => edge.from === file)) visit(edge.to, [...stack, file]);
    done.add(file);
  };
  for (const edge of edges) visit(edge.from, []);
});
