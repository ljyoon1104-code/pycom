import { describe, expect, it } from "vitest";
import { compile } from "../compiler/compiler";
import { VM, type VMEvent } from "./vm";

const execute = (code: string) => { const events: VMEvent[] = []; const vm = new VM(compile(code), event => events.push(event)); vm.execute(); return { events, vm }; };
const output = (events: VMEvent[]) => events.filter((event): event is Extract<VMEvent, { type: "output" }> => event.type === "output").map(event => event.text).join("");

describe("4단계 함수", () => {
  it("매개변수 없는 함수와 명시적·암시적 None 반환을 처리한다", () => expect(output(execute('def hello():\n    print("안녕")\ndef empty():\n    return\ndef implicit():\n    print("x")\nhello()\nprint(empty())\nprint(implicit())').events)).toBe("안녕\nNone\nx\nNone\n"));
  it("매개변수, 조건문과 반복문 안의 return을 처리한다", () => expect(output(execute('def find(values):\n    for value in values:\n        if value > 2:\n            return value\n    return 0\nprint(find([1, 2, 3]))').events)).toBe("3\n"));
  it("지역 변수는 분리되고 전역 변수는 읽는다", () => expect(output(execute('value = 10\ntax = 0.1\ndef change(price):\n    value = 20\n    print(value)\n    return price + price * tax\nprint(change(100))\nprint(value)').events)).toBe("20\n110\n10\n"));
  it("초기화되지 않은 지역 변수 오류를 표시한다", () => expect(execute('value = 10\ndef wrong():\n    print(value)\n    value = 20\nwrong()').events.at(-1)).toMatchObject({ type: "error", error: { category: "name", line: 3 } }));
  it("global로 전역값을 변경한다", () => expect(output(execute('total = 0\ndef add(price):\n    global total\n    total += price\nadd(3)\nadd(2)\nprint(total)').events)).toBe("5\n"));
  it("기본값은 정의 시 한 번 평가되고 키워드 인수를 받는다", () => expect(output(execute('def add(item, values=[]):\n    values.append(item)\n    return values\ndef introduce(name, age=17):\n    print(name, age)\nprint(add("A"))\nprint(add("B"))\nintroduce(age=18, name="지수")').events)).toBe("['A']\n['A', 'B']\n지수 18\n"));
  it("사용자 함수 값과 map을 처리한다", () => expect(output(execute('def double(number):\n    return number * 2\nfunction = double\nprint(function(10))\nprint(list(map(double, [1, 2, 3])) )').events)).toBe("20\n[2, 4, 6]\n"));
  it("f-string과 __name__을 처리한다", () => expect(output(execute('name = "민수"\nprint(f"{name} {10 + 20} {{Python}}")\ndef main():\n    print("완료")\nif __name__ == "__main__":\n    main()').events)).toBe("민수 30 {Python}\n완료\n"));
  it("함수 안 input 대기와 재개를 유지한다", () => { const result = execute('def ask():\n    return input("이름: ")\nprint(ask())'); expect(result.events.at(-1)).toEqual({ type: "input", prompt: "이름: " }); result.vm.resume("민수"); expect(output(result.events)).toBe("민수\n"); });
  it("필수·중복·알 수 없는 인수 오류를 처리한다", () => { const code = 'def introduce(name, age=17):\n    print(name, age)\n'; expect(execute(code + "introduce()").events.at(-1)).toMatchObject({ type: "error", error: { category: "type" } }); expect(execute(code + 'introduce("민수", name="지수")').events.at(-1)).toMatchObject({ type: "error", error: { category: "type" } }); expect(execute(code + 'introduce(level=1, name="민수")').events.at(-1)).toMatchObject({ type: "error", error: { category: "type" } }); });
  it("global 선언 오류를 처리한다", () => { expect(() => compile('def wrong(value):\n    global value\n')).toThrow(); expect(() => compile('def wrong():\n    value = 1\n    global value\n')).toThrow(); });
  it("f-string 안의 인덱스 표현식을 처리한다", () => expect(output(execute('print(f"첫 값: {[10, 20][0]}")').events)).toBe("첫 값: 10\n"));
  it("재귀와 잘못된 f-string을 오류로 처리한다", () => { expect(execute('def again():\n    return again()\nagain()').events.at(-1)).toMatchObject({ type: "error", error: { category: "runtime" } }); expect(() => compile('print(f"{")')).toThrow(); });
});
