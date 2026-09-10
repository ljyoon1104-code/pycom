import { describe, expect, it } from "vitest";
import { compile } from "../compiler/compiler";
import { CompilerError } from "../compiler/token";
import { VM, type VMEvent } from "./vm";

function execute(code: string): { events: VMEvent[]; vm: VM } { const events: VMEvent[] = []; const vm = new VM(compile(code), event => events.push(event)); vm.execute(); return { events, vm }; }
const text = (events: VMEvent[]) => events.filter((event): event is Extract<VMEvent, { type: "output" }> => event.type === "output").map(event => event.text).join("");
describe("2단계 제어 흐름", () => {
  it("비교 연산과 연속 비교를 처리한다", () => { expect(text(execute('print(1 == 1, 1 != 2, 1 < 2, 2 <= 2, 3 > 2, 3 >= 3)\nprint(0 <= 50 <= 100)').events)).toBe("True True True True True True\nTrue\n"); });
  it("논리 우선순위와 단락 평가를 처리한다", () => { expect(text(execute('print(not False and False or "ok")\nprint(False and unknown)\nprint(True or unknown)').events)).toBe("ok\nFalse\nTrue\n"); });
  it("if, elif, else와 중첩 조건문을 실행한다", () => { expect(text(execute('score = 85\nif score >= 90:\n    print("A")\nelif score >= 80:\n    if score <= 100:\n        print("B")\nelse:\n    print("C")').events)).toBe("B\n"); });
  it("while과 모든 복합 대입을 실행한다", () => { expect(text(execute('value = 1\nvalue += 2\nvalue -= 1\nvalue *= 4\nvalue /= 2\nvalue //= 2\nvalue %= 3\nvalue **= 3\ncount = 0\nwhile count < 3:\n    print(count, end=" ")\n    count += 1\nprint(value)').events)).toBe("0 1 2 8\n"); });
  it("range의 형태와 문자열 for를 실행한다", () => { expect(text(execute('for n in range(3):\n    print(n, end="")\nfor n in range(2, 5):\n    print(n, end="")\nfor n in range(5, 0, -2):\n    print(n, end="")\nfor letter in "가나":\n    print(letter, end="")').events)).toBe("012234531가나"); });
  it("break와 continue는 가장 가까운 반복문에 적용된다", () => { const code = 'for outer in range(2):\n    for inner in range(4):\n        if inner == 1:\n            continue\n        if inner == 3:\n            break\n        print(outer, inner, sep="", end=" ")'; expect(text(execute(code).events)).toBe("00 02 10 12 "); });
  it("반복문 안에서 input을 대기하고 재개한다", () => { const result = execute('for n in range(2):\n    name = input("이름: ")\n    print(n, name)'); expect(result.events.at(-1)).toEqual({ type: "input", prompt: "이름: " }); result.vm.resume("민수"); expect(result.events.at(-1)).toEqual({ type: "input", prompt: "이름: " }); result.vm.resume("지수"); expect(text(result.events)).toBe("0 민수\n1 지수\n"); });
  it("반복 제한과 range 오류를 학생 오류로 만든다", () => { const limit = execute('while True:\n    print("x", end="")').events.at(-1); expect(limit).toMatchObject({ type: "error", error: { category: "runtime", line: 1 } }); const zero = execute('for n in range(1, 5, 0):\n    print(n)').events.at(-1); expect(zero).toMatchObject({ type: "error", error: { category: "value", line: 1 } }); });
  it("들여쓰기와 제어문 오류 위치를 제공한다", () => { const expectError = (code: string) => { try { compile(code); } catch (error) { return (error as CompilerError).detail; } throw new Error("오류가 필요합니다."); }; expect(expectError('if True\n    print(1)')).toMatchObject({ line: 1, category: "syntax" }); expect(expectError('if True:\n  print(1)\n    print(2)')).toMatchObject({ line: 3, column: 1 }); expect(expectError('break')).toMatchObject({ line: 1, category: "syntax" }); expect(expectError('for n range(2):\n    print(n)')).toMatchObject({ line: 1, category: "syntax" }); });
});
