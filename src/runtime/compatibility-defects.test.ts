import { describe, expect, it } from "vitest";
import { compile } from "../compiler/compiler";
import { CompilerError, type StudentError } from "../compiler/token";
import { VM } from "./vm";
import type { VMEvent as RuntimeEvent } from "./vm";
import cases from "../../tests/fixtures/compatibility-defects-v2.json";
import boundaries from "../../tests/fixtures/compatibility-boundaries-v2.json";

export function execute(code: string, initial: {name: string; content: string}[] = []) {
  const events: RuntimeEvent[] = [], files = new Map(initial.map(f => [f.name, f.content]));
  let error: StudentError | undefined;
  try { new VM(compile(code), event => events.push(event), files, {fileName: "main.py"}).execute(); }
  catch (reason) { if (!(reason instanceof CompilerError)) throw reason; error = reason.detail; }
  const failure = events.find(e => e.type === "error");
  if (failure?.type === "error") error = failure.error;
  return { stdout: events.filter(e => e.type === "output").map(e => e.text).join(""), error, files, events };
}

describe("CPython 3.12.14 audit defects (unchanged original cases)", () => {
  it("boundary-unicode-literal-reopen: 실제 결합 문자의 쓰기·재열기", () => {
    const result = execute('with open("문자.txt","w") as f:\n    print(f.write("가😀𐐀é"))\nwith open("문자.txt") as f:\n    print(f.read(3))\n    print(f.read())');
    expect(result.error).toBeUndefined();
    expect(result.stdout).toBe("5\n가😀𐐀\né\n");
    expect(result.files.get("문자.txt")).toBe("가😀𐐀é");
  });
  it("boundary-supported-escapes: 지원되는 문자열 이스케이프", () => {
    const result = execute(String.raw`print(["\n","\t","\\","\""])
print("\'")`);
    expect(result.error).toBeUndefined();
    expect(result.stdout).toBe("['\\n', '\\t', '\\\\', '\"']\n'\n");
  });
  for (const c of [...cases, ...boundaries.map(c => ({...c, severity: "boundary", group: "추가 경계"}))]) it(`${c.severity} ${c.group}: ${c.id}`, () => {
    const result = execute(c.code, c.files);
    if ("unsupported" in c && c.unsupported) {
      expect(result.stdout).toBe("");
      expect(result.error).toMatchObject({ category: "syntax", line: c.id === "boundary-unicode-write-reopen" ? 2 : 1 });
      expect(result.error?.message).toContain("지원하지 않는 이스케이프");
      return;
    }
    expect(result.stdout).toBe(c.expected.stdout);
    expect(result.error ? result.error.pythonType ?? "SyntaxError" : null).toBe(c.expected.errorType);
    if (c.expected.errorType) {
      expect(result.error?.line).toBe(c.expected.line);
      expect(result.error?.fileName ?? "main.py").toBe(c.expected.file);
      expect(result.error?.message).toMatch(/[가-힣]/);
      expect(result.error?.message).not.toMatch(/TypeError:|ReferenceError:|\bat .+\(|\.ts:\d/);
    }
    expect(Object.fromEntries([...result.files].filter(([name]) => /\.(txt|csv)$/.test(name)))).toEqual(c.expected.files);
  });
});
