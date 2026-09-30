import type { Statement, Target } from "./ast";

export function localNames(nodes: Statement[], params: string[], globals: string[]): string[] {
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
