import { describe, expect, it } from "vitest";
import { compile } from "../compiler/compiler";
import { MemoryFileStore, appFile, checkedPut } from "../files/storage";
import { VM, type VMEvent } from "./vm";

const execute = (code: string, files: Record<string, string> = {}) => { const events: VMEvent[] = []; const vm = new VM(compile(code), event => events.push(event), new Map(Object.entries(files))); vm.execute(); return events; };
const output = (events: VMEvent[]) => events.filter((event): event is Extract<VMEvent, { type: "output" }> => event.type === "output").map(event => event.text).join("");
const error = (code: string, files?: Record<string, string>) => execute(code, files).at(-1) as Extract<VMEvent, { type: "error" }>;

describe("6단계 파일", () => {
  it("기본 읽기와 read 계열을 처리한다", () => expect(output(execute('file = open("memo.txt")\nprint(file.read(2))\nprint(file.readline())\nprint(file.readlines())', { "memo.txt": "가나다\n라마\n" }))).toBe("가나\n다\n\n['라마\\n']\n"));
  it("w와 a 모드의 생성·비우기·이어쓰기를 처리한다", () => { const events = execute('file = open("memo.txt", "w")\nprint(file.write("첫째\\n"))\nfile.close()\nfile = open("memo.txt", "a")\nfile.write("둘째")\nfile.close()', { "memo.txt": "이전" }); expect(output(events)).toBe("3\n"); expect(events.filter((event): event is Extract<VMEvent, { type: "file-change" }> => event.type === "file-change").at(-1)).toMatchObject({ name: "memo.txt", content: "첫째\n둘째" }); });
  it("close, closed, 줄 순회와 with 종료를 처리한다", () => expect(output(execute('with open("memo.txt", "r") as file:\n    for line in file:\n        print(line, end="")\nprint(file.closed)', { "memo.txt": "a\nb\n" }))).toBe("a\nb\nTrue\n"));
  it("with에서 오류가 나도 파일을 닫는다", () => { const events = execute('with open("memo.txt", "w") as file:\n    file.write("ok")\n    1 / 0'); expect(events.at(-1)).toMatchObject({ type: "error", error: { line: 3 } }); expect(events.filter((event): event is Extract<VMEvent, { type: "file-change" }> => event.type === "file-change").at(-1)).toMatchObject({ name: "memo.txt", content: "ok" }); });
  it("with 내부 return에서도 파일을 닫는다", () => expect(output(execute('def save():\n    with open("memo.txt", "w") as file:\n        file.write("ok")\n        return file\nfile = save()\nprint(file.closed)'))).toBe("True\n"));
  it("모드·경로·닫힌 파일·권한 오류를 학생 오류로 처리한다", () => { for (const [code, line] of [['open("none.txt")', 1], ['open("../memo.txt")', 1], ['open("memo.txt", "rb")', 1], ['file=open("memo.txt", "r")\nfile.close()\nfile.read()', 3], ['file=open("memo.txt", "r")\nfile.write("x")', 2], ['file=open("memo.txt", "w")\nfile.read()', 2], ['file=open("memo.txt", "w")\nfile.write(1)', 2]] as [string, number][]) { const result = error(code, { "memo.txt": "x" }); expect(result.error.line).toBe(line); expect(result.error.message).not.toMatch(/Error|stack|undefined/); } });
  it("메모리 저장소는 명시적 저장과 제한을 처리한다", async () => { const store = new MemoryFileStore(); await checkedPut(store, appFile("main.py", "print(1)", 1)); expect((await store.get("main.py"))?.content).toBe("print(1)"); await expect(checkedPut(store, appFile("../bad.py", "", 1))).rejects.toThrow("invalid-name"); await expect(checkedPut(store, appFile("large.txt", "x".repeat(1_000_001), 1))).rejects.toThrow("file-limit"); });
});
