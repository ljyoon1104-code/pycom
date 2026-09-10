import { describe, expect, it } from "vitest";
import { compile } from "../compiler/compiler";
import { VM, type VMEvent } from "./vm";

const execute = (code: string) => { const events: VMEvent[] = []; new VM(compile(code), event => events.push(event)).execute(); return events; };
const output = (events: VMEvent[]) => events.filter((event): event is Extract<VMEvent, { type: "output" }> => event.type === "output").map(event => event.text).join("");

describe("10단계 교과서 문법", () => {
  it("기본·표현식·필터 리스트 내포를 실행한다", () => expect(output(execute('numbers = [number for number in range(5)]\nsquares = [number * number for number in range(5)]\nevens = [number for number in range(10) if number % 2 == 0]\nprint(numbers)\nprint(squares)\nprint(evens)'))).toBe("[0, 1, 2, 3, 4]\n[0, 1, 4, 9, 16]\n[0, 2, 4, 6, 8]\n"));
  it("중첩·여러 for·언패킹 리스트 내포를 실행한다", () => expect(output(execute('maps = [[0 for column in range(2)] for row in range(2)]\npairs = [(x, y) for x in range(2) for y in range(3)]\nscores = [score for name, score in [("민수", 90), ("지수", 95)]]\nprint(maps)\nprint(pairs)\nprint(scores)'))).toBe("[[0, 0], [0, 0]]\n[(0, 0), (0, 1), (0, 2), (1, 0), (1, 1), (1, 2)]\n[90, 95]\n"));
  it("리스트 내포 변수는 바깥 범위로 유출되지 않는다", () => expect(output(execute('number = 100\nvalues = [number for number in range(3)]\nprint(number)\nprint(values)'))).toBe("100\n[0, 1, 2]\n"));
  it("첨자·혼합·중첩 첨자 언패킹 대입을 실행한다", () => expect(output(execute('numbers = [0, 0]\nnumbers[0], numbers[1] = 10, 20\nvalue, numbers[0] = 30, 40\nvalues = [[0, 0]]\n(values[0][0], values[0][1]) = (50, 60)\nprint(numbers)\nprint(value)\nprint(values)'))).toBe("[40, 20]\n30\n[[50, 60]]\n"));
  it("언패킹 값 개수 오류에서는 일부 대상도 바꾸지 않는다", () => { const events = execute('numbers = [0, 0]\nnumbers[0], numbers[1] = [10]\nprint(numbers)'); expect(events.at(-1)).toMatchObject({ type: "error", error: { category: "value", line: 2 } }); expect(output(events)).toBe(""); });
  it("f-string 정렬·너비·0 채움·소수점 형식을 실행한다", () => expect(output(execute('print(f"{\'제목\':<10}")\nprint(f"{\'제목\':>10}")\nprint(f"{\'제목\':^10}")\nprint(f"{123:05}")\nprint(f"{3.14159:.2f}")'))).toBe("제목        \n        제목\n    제목    \n00123\n3.14\n"));
  it("잘못된 f-string 형식은 학생 오류를 낸다", () => { expect(() => compile('print(f"{1:abc}")')).toThrow(/f-string/); expect(() => compile('print(f"{1:<0}")')).toThrow(/f-string/); });
  it("세미콜론으로 여러 단순문·마지막 세미콜론·주석을 구분한다", () => expect(output(execute('a = 10; b = 20; print(a + b)\nprint("완료"); # 끝\n;\nprint("다음")'))).toBe("30\n완료\n다음\n"));
  it("세미콜론 뒤 복합문은 오류로 막는다", () => expect(() => compile('print(1); if True:\n    print(2)')).toThrow(/세미콜론/));
  it("잘못된 내포의 for·in·언패킹은 오류를 낸다", () => { for (const code of ['[x x in range(2)]', '[x for x range(2)]', '[x for item[0] in [[1]]]']) expect(() => compile(code)).toThrow(); });
  it("리스트 내포 안에서 메서드·인덱싱·f-string을 사용한다", () => expect(output(execute('words = ["a", "bb"]\nvalues = [f"{word.replace(\'b\', \'B\')}:{word[0]}" for word in words]\nprint(values)'))).toBe("['a:a', 'BB:b']\n"));
  it("리스트 내포는 함수 지역값과 기존 함수를 읽는다", () => expect(output(execute('def double(value):\n    return value * 2\ndef make(offset):\n    return [double(number + offset) for number in range(3) if number > 0]\nprint(make(10))'))).toBe("[22, 24]\n"));
  it("언패킹 오른쪽 식은 한 번만 평가한다", () => expect(output(execute('count = 0\ndef values():\n    global count\n    count += 1\n    return (10, 20)\nnumbers = [0]\nvalue, numbers[0] = values()\nprint(count, value, numbers[0])'))).toBe("1 10 20\n"));
  it("언패킹 대상의 잘못된 첨자는 학생 오류를 낸다", () => expect(execute('numbers = [0]\nnumbers[1], value = 10, 20').at(-1)).toMatchObject({ type: "error", error: { category: "value", line: 2 } }));
  it("f-string 형식에는 표현식 결과를 사용할 수 있다", () => expect(output(execute('value = 12\nprint(f"{value + 1:05}")\nprint(f"{value / 4:.2f}")'))).toBe("00013\n3.00\n"));
  it("가운데 정렬은 너비가 부족하면 값을 자르지 않는다", () => expect(output(execute('print(f"{\'긴제목\':^2}")'))).toBe("긴제목\n"));
  it("0 채움과 소수점 형식의 자료형 오류를 학생 오류로 만든다", () => { expect(execute('print(f"{\'x\':05}")').at(-1)).toMatchObject({ type: "error", error: { category: "type", line: 1 } }); expect(execute('print(f"{\'x\':.2f}")').at(-1)).toMatchObject({ type: "error", error: { category: "type", line: 1 } }); });
  it("형식 너비와 닫히지 않은 형식은 컴파일 오류를 낸다", () => { for (const code of ['print(f"{1:<0}")', 'print(f"{1:>no}")', 'print(f"{1:05")']) expect(() => compile(code)).toThrow(); });
  it("교과서 게임 종료 세미콜론 형태를 실행한다", () => expect(output(execute('print("<GAME OVER>"); print("=" * 4)'))).toBe("<GAME OVER>\n====\n"));
  it("세미콜론의 빈 문장은 안전하게 건너뛴다", () => expect(output(execute(';;print("ok");;'))).toBe("ok\n"));
  it("세미콜론 뒤 함수 정의는 지원하지 않는 문법이다", () => expect(() => compile('print(1); def hello():\n    pass')).toThrow(/세미콜론/));
});
