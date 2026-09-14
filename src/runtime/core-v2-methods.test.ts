import { describe, expect, it } from "vitest";
import { compile } from "../compiler/compiler";
import { VM, type VMEvent } from "./vm";
const run = (source: string) => { const events: VMEvent[] = []; new VM(compile(source), event => events.push(event)).execute(); return events; };
const prints = (source: string, expected: string) => { const events = run(source); expect(events.at(-1)).toEqual({ type: "complete" }); expect(events.filter(e => e.type === "output").map(e => e.text).join("")).toBe(expected + "\n"); };
describe("Core v2 문자열 메서드", () => {
  it.each([
    ['"-".join(["가", "나"])', '가-나'], ['"가😀나".find("나")', '2'], ['"banana".rfind("an")', '3'],
    ['"banana".index("an", 2)', '3'], ['"aaaa".count("aa")', '2'], ['"ab".count("")', '3'],
    ['"abc".find("", 4)', '-1'], ['"abc".startswith("", 4)', 'False'], ['"abcd".endswith(("x", "bc"), 0, 3)', 'True'],
    ['"abcd".startswith("bc", 1, 3)', 'True'], ['"HELLO".lower()', 'hello'], ['"hello".upper()', 'HELLO'],
    ['"hELLO".capitalize()', 'Hello'], ['"they\'re HERE".title()', "They'Re Here"], ['"한글".isalpha()', 'True'],
    ['"한글2".isalnum()', 'True'], ['"²１２".isdigit()', 'True'], ['"".isdigit()', 'False'], ['" \t".isspace()', 'True'],
    ['"xy가xy".strip("xy")', '가'], ['"  가  ".lstrip()', '가  '], ['"  가  ".rstrip()', '  가'],
    ['" 가 나  ".split()', "['가', '나']"], ['"a,,b,".split(",")', "['a', '', 'b', '']"],
    ['" a b  ".split(None, 0)', "['a b  ']"], ['" a b  ".rsplit(None, 0)', "[' a b']"],
    ['"a,b,c".rsplit(",", 1)', "['a,b', 'c']"], ['"a a a".replace("a", "b", 2)', 'b b a'],
    ['"😀가".replace("", "-", 2)', '-😀-가'], ['"가".center(4, "-")', '-가--'],
    ['"ab".center(5, "-")', '--ab-'], ['"가".ljust(3, "-")', '가--'], ['"가".rjust(3, "-")', '--가'],
    ['"long".center(2)', 'long'], ['"-12".zfill(5)', '-0012'],
  ])("%s", (expression, expected) => prints(`print(${expression})`, expected));
  it.each([
    ['"a".index("x")', 'ValueError'], ['"a".split("")', 'ValueError'], ['"a".join([1])', 'TypeError'],
    ['"a".lower(1)', 'TypeError'], ['"a".find(1)', 'TypeError'], ['"a".center(4, "--")', 'TypeError'],
    ['"a".replace("a", "b", "2")', 'TypeError'], ['"a".find("a", 1.5)', 'TypeError'],
  ])("오류 %s", (expression, pythonType) => expect(run(`x = 1\n${expression}`).at(-1)).toMatchObject({ type: "error", error: { line: 2, pythonType } }));
});
describe("Core v2 리스트·딕셔너리 메서드", () => {
  it("리스트 제자리 수정과 None 반환", () => prints('a = [1]\nb = a\nprint(a.extend(a), a.insert(-100, 0), a.reverse())\nprint(b)', 'None None None\n[1, 1, 0]'));
  it("리스트 index·count 범위", () => prints('a = [1, 2, 1]\nprint(a.index(1, 1), a.count(1))', '2 2'));
  it("리스트 copy는 얕은 복사", () => prints('a = [[]]\nb = a.copy()\nb[0].append(1)\nb.append(2)\nprint(a, b)', '[[1]] [[1], 2]'));
  it("리스트 clear와 pop", () => prints('a = [1, 2]\nprint(a.pop(0), a.pop())\nprint(a.clear(), a)', '1 2\nNone []'));
  it.each(['[].pop()', '[1].pop(2)', '[1].pop(-2)'])("pop 인덱스 오류 %s", expression => expect(run(expression).at(-1)).toMatchObject({ type: "error", error: { pythonType: "IndexError" } }));
  it("dict get은 None 값을 기본값으로 대체하지 않음", () => prints('d = {"x": None}\nprint(d.get("x", 9), d.get("y", 9))', 'None 9'));
  it("setdefault 참조와 삽입 순서", () => prints('d = {}\na = d.setdefault("x", [])\na.append(1)\nd.setdefault("y", 2)\nd.setdefault("x", 3)\nprint(d)', "{'x': [1], 'y': 2}"));
  it("update 딕셔너리·키값 쌍·키워드", () => prints('d = {"a": 1}\nprint(d.update({"b": 2}, a=3))\nd.update([("c", 4)])\nprint(d)', "None\n{'a': 3, 'b': 2, 'c': 4}"));
  it("dict copy 항목 독립과 값 공유", () => prints('a = {"x": []}\nb = a.copy()\nb["x"].append(1)\nb["y"] = 2\nb["x"] = 3\nprint(a, b)', "{'x': [1]} {'x': 3, 'y': 2}"));
  it("fromkeys는 값 참조 공유", () => prints('d = dict.fromkeys(["a", "b", "a"], [])\nd["a"].append(1)\nprint(d)', "{'a': [1], 'b': [1]}"));
  it("pop 기본값과 popitem LIFO", () => prints('d = {"a": 1, "b": 2}\nprint(d.pop("x", 3), d.popitem(), d.pop("a"))\nprint(d.clear(), d)', "3 ('b', 2) 1\nNone {}"));
  it.each(['{}.pop("x")', '{}.popitem()'])("KeyError %s", expression => expect(run(expression).at(-1)).toMatchObject({ type: "error", error: { pythonType: "KeyError" } }));
  it.each(['{}.get([])', '{}.setdefault([])', 'dict.fromkeys([[]])'])("변경 가능 키 거부 %s", expression => expect(run(expression).at(-1)).toMatchObject({ type: "error", error: { pythonType: "TypeError" } }));
});
