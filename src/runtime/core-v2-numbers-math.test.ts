import { describe, expect, it } from "vitest";
import { compile } from "../compiler/compiler";
import { VM, type VMEvent } from "./vm";
const run = (source: string) => { const events: VMEvent[] = []; new VM(compile(source), event => events.push(event)).execute(); return events; };
const prints = (source: string, expected: string) => { const events = run(source); expect(events.at(-1)).toEqual({ type: "complete" }); expect(events.filter(e => e.type === "output").map(e => e.text).join("")).toBe(expected + "\n"); };
describe("Core v2 실수 표기", () => {
  it("대표 실수 출력", () => prints('print(1.0)\nprint(-0.0)\nprint(0.1 + 0.2)\nprint(float("inf"))\nprint(float("-inf"))\nprint(float("nan"))', '1.0\n-0.0\n0.30000000000000004\ninf\n-inf\nnan'));
  it("정수와 실수 구분", () => prints('print(type(1), type(1.0), type(2 / 1))\nprint(1 == 1.0, bool(0.0), int(2.9))', "<class 'int'> <class 'float'> <class 'float'>\nTrue False 2"));
  it("컬렉션과 fstring 실수", () => prints('print([1.0, -0.0], (2.0,), {"a": 3.0})\nprint(f"{1.0} {3.14159:.2f}")', "[1.0, -0.0] (2.0,) {'a': 3.0}\n1.0 3.14"));
  it("지수 표기와 크기", () => prints('print(1e-7, 1e16, 1e-4, 1e15)', '1e-07 1e+16 0.0001 1000000000000000.0'));
  it("혼합 연산과 합계", () => prints('print(1 + 2.0, 4.0 // 2, 5.0 % 2, sum([1, 2.0]))', '3.0 2.0 1.0 3.0'));
  it("반올림 반환 자료형", () => prints('print(round(2.5), round(2.5, 0), round(1.25, 1), abs(-1.0))', '2 2.0 1.2 1.0'));
  it("실수 비교와 정렬", () => prints('print(1 < 1.5, max(1.0, 2.0), sorted([2.0, 1]))', 'True 2.0 [1, 2.0]'));
  it("실수와 정수는 동등한 키", () => prints('d = {1: "a"}\nd[1.0] = "b"\nprint(len(d), len({1, 1.0}))', '1 1'));
  it("실수인 인덱스 거부", () => expect(run('a = [1]\nprint(a[0.0])').at(-1)).toMatchObject({ type: 'error', error: { line: 2, pythonType: 'TypeError' } }));
  it("리스트의 잘못된 연산 거부", () => expect(run('[1] - [2]').at(-1)).toMatchObject({ type: 'error', error: { pythonType: 'TypeError' } }));
});
describe("Core v2 math", () => {
  it("대표 math 프로그램", () => prints('import math\nprint(math.sqrt(81))\nprint(math.factorial(5))\nprint(round(math.pi, 2))', '9.0\n120\n3.14'));
  it("alias와 from import", () => prints('import math as m\nfrom math import sqrt\nprint(sqrt(4), m is m)', '2.0 True'));
  it.each([
    ['ceil(-1.2)', '-1'], ['floor(-1.2)', '-2'], ['trunc(-1.2)', '-1'], ['fabs(-2)', '2.0'], ['gcd(12, 18, 30)', '6'], ['gcd()', '0'],
    ['pow(2, 3)', '8.0'], ['sin(0)', '0.0'], ['cos(0)', '1.0'], ['tan(0)', '0.0'], ['degrees(math.pi)', '180.0'],
    ['radians(180) == math.pi', 'True'], ['log(8, 2)', '3.0'], ['log10(100)', '2.0'], ['exp(0)', '1.0'],
    ['isfinite(math.pi)', 'True'], ['isinf(math.inf)', 'True'], ['isnan(math.nan)', 'True'],
  ])("math.%s", (expression, expected) => prints(`import math\nprint(math.${expression})`, expected));
  it.each([
    ['sqrt(-1)', 'ValueError'], ['log(0)', 'ValueError'], ['log(2, 1)', 'ZeroDivisionError'], ['factorial(-1)', 'ValueError'],
    ['factorial(3.0)', 'TypeError'], ['gcd(1.5, 2)', 'TypeError'], ['sqrt("4")', 'TypeError'], ['sqrt()', 'TypeError'], ['exp(1000)', 'OverflowError'],
  ])("math 오류 %s", (expression, pythonType) => expect(run(`import math\nmath.${expression}`).at(-1)).toMatchObject({ type: 'error', error: { line: 2, pythonType } }));
});
