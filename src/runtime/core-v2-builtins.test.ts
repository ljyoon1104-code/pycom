import { describe, expect, it } from "vitest";
import { compile } from "../compiler/compiler";
import { VM, type VMEvent } from "./vm";
const run = (source: string) => { const events: VMEvent[] = []; new VM(compile(source), event => events.push(event)).execute(); return events; };
const prints = (source: string, expected: string) => { const events = run(source); expect(events.at(-1)).toEqual({ type: "complete" }); expect(events.filter(e => e.type === "output").map(e => e.text).join("")).toBe(expected + "\n"); };
describe("Core v2 내장 함수", () => {
  it("dict 생성자는 독립된 항목과 얕은 값 공유", () => prints('a = {"x": []}\nb = dict(a, y=2)\nb["x"].append(1)\nb["x"] = 3\nprint(a, b)', "{'x': [1]} {'x': 3, 'y': 2}"));
  it("len은 반복자를 소비하지 않음", () => prints('it = map(int, ["1"])\ntry:\n    len(it)\nexcept TypeError:\n    print(list(it))', '[1]'));
  it.each(['float(None)', 'sum([1], None)', 'enumerate([], None)'])("명시적 None 인수는 생략과 구분 %s", code => expect(run(code).at(-1)).toMatchObject({ type: "error", error: { pythonType: "TypeError" } }));
  it("enumerate 시작 번호와 소모", () => prints('it = enumerate(["가", "나"], start=1)\nprint(list(it), list(it))', "[(1, '가'), (2, '나')] []"));
  it("zip은 가장 짧은 반복자에서 종료", () => prints('it = zip([1, 2], [3], [4, 5])\nprint(list(it), list(it), list(zip()))', '[(1, 3, 4)] [] []'));
  it("zip 생성은 map을 소비하지 않음", () => prints('log = []\ndef f(x):\n    log.append(x)\n    return x\nit = zip(map(f, [1, 2]), [3])\nprint(log)\nprint(list(it))\nprint(log)', '[]\n[(1, 3)]\n[1, 2]'));
  it("독립적인 역순 반복자", () => prints('a = reversed([1, 2])\nb = reversed("가나")\nprint(list(a), list(b), list(a))', "[2, 1] ['나', '가'] []"));
  it("any/all은 단락 평가", () => prints('def f(x):\n    if x == 2:\n        raise ValueError("소비하면 안 됨")\n    return x\nprint(any(map(f, [1, 2])), all(map(f, [0, 2])))\nprint(any([]), all([]))', 'True False\nFalse True'));
  it("for문에서 zip/enumerate 순회", () => prints('for n, pair in enumerate(zip([1], [2])):\n    print(n, pair)', '0 (1, 2)'));
  it.each(['enumerate([], start="x")', 'enumerate([], 1, start=2)', 'zip(1)', 'reversed({1})', 'any()', 'all([], [])'])("반복 내장 함수 인수 오류 %s", code => expect(run(code).at(-1)).toMatchObject({ type: "error", error: { pythonType: "TypeError" } }));
  it.each([
    ['abs(-5)', '5'], ['round(2.5)', '2'], ['round(3.5)', '4'], ['round(-2.5)', '-2'],
    ['round(1.25, 1)', '1.2'], ['round(2.675, 2)', '2.67'], ['round(1250, -2)', '1200'],
    ['round(number=3.14159, ndigits=2)', '3.14'], ['pow(2, 10)', '1024'], ['pow(2, 10, 17)', '4'],
    ['pow(3, -1, 11)', '4'], ['pow(2, 3, -5)', '-2'], ['divmod(-7, 3)', '(-3, 2)'],
    ['chr(128512)', '😀'], ['ord("😀")', '128512'], ['bin(-10)', '-0b1010'], ['oct(-10)', '-0o12'], ['hex(-255)', '-0xff'],
  ])("%s", (expression, expected) => prints(`print(${expression})`, expected));
  it("같은 내장 함수 객체", () => prints('f = abs\nprint(f is abs, f(-3), int is int)', 'True 3 True'));
  it.each([
    ['abs()', 'TypeError'], ['round(1, "2")', 'TypeError'], ['pow(1)', 'TypeError'], ['pow(2, 3, 0)', 'ValueError'],
    ['pow(2, -1, 4)', 'ValueError'], ['divmod(1, 0)', 'ZeroDivisionError'], ['chr(-1)', 'ValueError'], ['ord("ab")', 'TypeError'], ['hex(1.5)', 'TypeError'],
  ])("오류 %s", (expression, pythonType) => expect(run(`x = 1\n${expression}`).at(-1)).toMatchObject({ type: "error", error: { line: 2, pythonType } }));
});
describe("Core v2 정렬", () => {
  it("sorted는 새 리스트", () => prints('a = [3, 1, 2]\nb = sorted(a)\nprint(a, b, a is b)', '[3, 1, 2] [1, 2, 3] False'));
  it("sort는 원본 변경과 None 반환", () => prints('a = [1, 3, 2]\nb = a\nprint(a.sort(reverse=True))\nprint(b)', 'None\n[3, 2, 1]'));
  it("람다 정렬과 안정성", () => prints('a = [("a", 2), ("b", 1), ("c", 2)]\na.sort(key=lambda item: item[1], reverse=True)\nprint(a)', "[('a', 2), ('c', 2), ('b', 1)]"));
  it("key는 원래 순서로 한 번씩", () => prints('log = []\ndef key(x):\n    log.append(x)\n    return -x\nprint(sorted([1, 3, 2], key=key))\nprint(log)', '[3, 2, 1]\n[1, 3, 2]'));
  it("튜플 사전식 정렬", () => prints('print(sorted([(2, 1), (1, 2), (1, 1)]))', '[(1, 1), (1, 2), (2, 1)]'));
  it("key 내부 오류 줄", () => expect(run('def key(x):\n    return missing\nprint(sorted([1], key=key))').at(-1)).toMatchObject({ type: "error", error: { line: 2, pythonType: "NameError" } }));
  it("key 오류를 호출자가 처리", () => prints('try:\n    sorted([1], key=lambda x: 1 / 0)\nexcept ZeroDivisionError:\n    print("처리")\nprint("복귀")', '처리\n복귀'));
  it("비교 오류", () => expect(run('sorted([1, "a"])').at(-1)).toMatchObject({ type: "error", error: { pythonType: "TypeError" } }));
  it("key 내부 input 대기와 복귀", () => { const events: VMEvent[] = []; const vm = new VM(compile('def key(x):\n    return int(input("순서: "))\nprint(sorted([10, 20], key=key))'), event => events.push(event)); vm.execute(); expect(events.at(-1)).toEqual({ type: "input", prompt: "순서: " }); vm.resume("2"); expect(events.at(-1)).toEqual({ type: "input", prompt: "순서: " }); vm.resume("1"); expect(events.at(-1)).toEqual({ type: "complete" }); expect(events.filter(e => e.type === "output").map(e => e.text).join("")).toBe('[20, 10]\n'); });
  it("정렬 key 실행 중 비동기 중지", async () => { const events: VMEvent[] = []; const vm = new VM(compile('def key(x):\n    while True:\n        pass\ntry:\n    sorted([1], key=key)\nexcept:\n    print("잡음")'), event => events.push(event)); vm.executeAsync(); vm.stop(); await new Promise(resolve => setTimeout(resolve, 10)); expect(events).toEqual([{ type: "stopped" }]); });
});
