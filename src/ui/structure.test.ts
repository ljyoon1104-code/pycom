import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { cycleDialogFocus, createDialogs } from "./dialogs";
import { createOutputView } from "./output-view";
import { createHelpController } from "./help-controller";
import { bindWorkspaceActions } from "./workspace-bindings";
import { bootstrap } from "../app/bootstrap";

const sourceRoot = resolve("src");
const files = readdirSync(sourceRoot, { recursive: true }).map(String).filter(file => file.endsWith(".ts"));
const edges: { from: string; to: string }[] = [];
for (const file of files) {
  const ast = ts.createSourceFile(file, readFileSync(resolve(sourceRoot, file), "utf8"), ts.ScriptTarget.Latest, true);
  for (const node of ast.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || !node.moduleSpecifier.text.startsWith(".")) continue;
    const target = ts.resolveModuleName(node.moduleSpecifier.text, resolve(sourceRoot, file), { moduleResolution: ts.ModuleResolutionKind.Bundler }, ts.sys).resolvedModule?.resolvedFileName;
    if (target) edges.push({ from: file.replaceAll("\\", "/"), to: relative(sourceRoot, target).replaceAll("\\", "/") });
  }
}
describe("UI 의존성 경계", () => {
  it("controller import만으로 DOM 조회나 이벤트 등록을 하지 않는다", () => {
    expect(typeof document).toBe("undefined");
    for (const factory of [createDialogs, createOutputView, createHelpController, bindWorkspaceActions]) expect(typeof factory).toBe("function");
  });
  it("bootstrap도 호출 전에는 앱을 생성하지 않는다", () => {
    expect(typeof bootstrap).toBe("function"); expect(typeof document).toBe("undefined");
  });
  it("하위 모듈은 main이나 bootstrap을 참조하지 않는다", () => {
    expect(edges.filter(edge => edge.to === "main.ts" || edge.to === "app/bootstrap.ts" && edge.from !== "main.ts" && !edge.from.endsWith(".test.ts"))).toEqual([]);
  });
  it("UI는 compiler 내부나 IndexedDB schema를 참조하지 않는다", () => {
    expect(edges.filter(edge => edge.from.startsWith("ui/") && !edge.from.endsWith(".test.ts") && edge.to.startsWith("compiler/"))).toEqual([]);
    for (const file of files.filter(file => file.replaceAll("\\", "/").startsWith("ui/") && !file.endsWith(".test.ts"))) {
      expect(readFileSync(resolve(sourceRoot, file), "utf8")).not.toMatch(/indexedDB|objectStore|createObjectStore/);
    }
  });
  it("타입 import를 포함해 순환 의존이 없다", () => {
    const done = new Set<string>();
    const visit = (file: string, stack: string[]): void => {
      expect(stack, `순환 의존: ${[...stack, file].join(" -> ")}`).not.toContain(file);
      if (done.has(file)) return;
      for (const edge of edges.filter(edge => edge.from === file)) visit(edge.to, [...stack, file]);
      done.add(file);
    };
    for (const edge of edges) visit(edge.from, []);
  });
});

describe("대화상자 포커스 경계", () => {
  const fixture = (key = "Tab", shiftKey = false) => {
    const first = { focus: vi.fn() }, middle = { focus: vi.fn() }, last = { focus: vi.fn() };
    const event = { key, shiftKey, preventDefault: vi.fn() };
    return { first, middle, last, event, apply: (active: object) => cycleDialogFocus(event as unknown as KeyboardEvent, [first, middle, last] as unknown as HTMLElement[], active as Element) };
  };
  it("마지막 Tab은 첫 항목으로 이동", () => { const f = fixture(); f.apply(f.last); expect(f.first.focus).toHaveBeenCalledOnce(); expect(f.event.preventDefault).toHaveBeenCalledOnce(); });
  it("첫 Shift+Tab은 마지막으로 이동", () => { const f = fixture("Tab", true); f.apply(f.first); expect(f.last.focus).toHaveBeenCalledOnce(); expect(f.event.preventDefault).toHaveBeenCalledOnce(); });
  it("중간 항목에서는 기본 이동 유지", () => { const f = fixture(); f.apply(f.middle); expect(f.event.preventDefault).not.toHaveBeenCalled(); });
  it("Tab 이외 키를 가로채지 않는다", () => { const f = fixture("Enter"); f.apply(f.last); expect(f.event.preventDefault).not.toHaveBeenCalled(); });
  it("빈 대화상자에서도 안전하다", () => { const event = { key: "Tab", preventDefault: vi.fn() }; cycleDialogFocus(event as unknown as KeyboardEvent, [], null); expect(event.preventDefault).not.toHaveBeenCalled(); });
});
