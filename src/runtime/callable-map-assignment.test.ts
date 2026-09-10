import { describe, expect, it } from "vitest";
import { compile } from "../compiler/compiler";
import { CompilerError } from "../compiler/token";
import { VM, type VMEvent } from "./vm";

const execute = (code: string) => { const events: VMEvent[] = []; const vm = new VM(compile(code), event => events.push(event)); vm.execute(); return { events, vm }; };
const text = (events: VMEvent[]) => events.filter((event): event is Extract<VMEvent, { type: "output" }> => event.type === "output").map(event => event.text).join("");

describe("호출 가능한 내장 함수와 map", () => {
  it("내장 함수를 값으로 저장해 호출한다", () => expect(text(execute('converter = int\nword = str\nprint(converter("10"))\nprint(word(20))').events)).toBe("10\n20\n"));
  it("호출 불가능한 값은 호출한 줄에 오류를 낸다", () => expect(execute("value = 10\nvalue()").events.at(-1)).toMatchObject({ type: "error", error: { category: "type", line: 2, message: "이 값은 함수처럼 호출할 수 없습니다." } }));
  it("map 결과를 list로 변환한다", () => expect(text(execute('print(list(map(int, ["10", "20"])))\nprint(list(map(str, [1, 2])))').events)).toBe("[10, 20]\n['1', '2']\n"));
  it("map은 소모형이며 for 문에서 순회한다", () => expect(text(execute('values = map(str, [1, 2, 3])\nprint(list(values))\nprint(list(values))\nfor value in map(int, ["4", "5"]):\n    print(value, end=" ")').events)).toBe("['1', '2', '3']\n[]\n4 5 "));
  it("여러 반복 대상은 가장 짧은 대상까지 지연 처리한다", () => expect(text(execute("values = map(max, [1, 5, 3], [4, 2])\nprint(list(values))").events)).toBe("[4, 5]\n"));
  it("map 인수와 지연 변환 오류를 호출 위치에서 처리한다", () => { expect(execute("map(10, [1])").events.at(-1)).toMatchObject({ type: "error", error: { category: "type", line: 1 } }); expect(execute("values = map(int, [\"x\"])\nprint(list(values))").events.at(-1)).toMatchObject({ type: "error", error: { category: "value", line: 2 } }); expect(execute("map(int, 10)").events.at(-1)).toMatchObject({ type: "error", error: { category: "type", line: 1 } }); });
});

describe("연속 대입", () => {
  it("두 변수와 세 변수에 동일한 값을 저장한다", () => expect(text(execute('a = b = 0\nfirst = second = third = "Python"\nprint(a, b)\nprint(first, second, third)').events)).toBe("0 0\nPython Python Python\n"));
  it("오른쪽 input 표현식을 한 번만 평가한다", () => { const result = execute('a = b = input("값: ")\nprint(a)\nprint(b)'); expect(result.events).toEqual([{ type: "input", prompt: "값: " }]); result.vm.resume("10"); expect(text(result.events)).toBe("10\n10\n"); });
  it("변경 가능한 리스트와 딕셔너리의 참조를 보존한다", () => expect(text(execute('first = second = []\nfirst.append("공유")\na = b = {}\na["x"] = 1\nprint(first)\nprint(second)\nprint(b)').events)).toBe("['공유']\n['공유']\n{'x': 1}\n"));
  it("변수와 첨자 대상을 왼쪽부터 처리한다", () => expect(text(execute('numbers = [0, 0]\nvalue = numbers[0] = numbers[1] = 7\nprint(value)\nprint(numbers)').events)).toBe("7\n[7, 7]\n"));
  it("언패킹은 연속 대입과 구분한다", () => expect(text(execute('a, b = 10, 20\nx = y = [10, 20]\n[first, second] = [30, 40]\nprint(a, b)\nprint(x)\nprint(first, second)').events)).toBe("10 20\n[10, 20]\n30 40\n"));
  it("잘못된 대입 대상은 문법 오류다", () => { expect(() => compile("1 = value")).toThrow(CompilerError); expect(() => compile("a + b = 10")).toThrow(CompilerError); });
});
