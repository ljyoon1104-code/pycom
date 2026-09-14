import { describe, expect, it } from "vitest";
import { compile } from "../compiler/compiler";
import { VM, type VMEvent } from "./vm";
const events = (code: string) => { const result: VMEvent[] = []; new VM(compile(code), event => result.push(event)).execute(); return result; };
const prints = (code: string, expected: string) => { const result = events(code); expect(result.at(-1)).toEqual({ type: "complete" }); expect(result.filter(e => e.type === "output").map(e => e.text).join("")).toBe(expected); };
describe("Core v2 집합·내포·삭제", () => {
  it("빈 집합과 딕셔너리를 구분", () => prints('print(set(), {}, type(set()), type({}))', "set() {} <class 'set'> <class 'dict'>\n"));
  it("집합 리터럴과 생성자의 중복 제거", () => prints('print({1, 2, 2} == set([1, 2]))\nprint(len({1, True, 1}))', "True\n1\n"));
  it("집합 동일성은 내용 동등성과 구분", () => prints('a = {1}\nb = a\nprint(a is b, a is {1}, a == {1})', "True False True\n"));
  it("집합의 합·교·차·대칭차 연산", () => prints('a = {1, 2}\nb = {2, 3}\nprint((a | b) == {1, 2, 3})\nprint((a & b) == {2})\nprint((a - b) == {1})\nprint((a ^ b) == {1, 3})', "True\nTrue\nTrue\nTrue\n"));
  it("집합 멤버십과 반복", () => prints('a = {1, 2}\nprint(1 in a, 3 not in a, sum(a), bool(set()))', "True True 3 False\n"));
  it("add와 remove는 동일 참조를 수정하고 None 반환", () => prints('a = set()\nb = a\nprint(a.add(1), a.add(1))\nprint(b == {1})\nprint(a.remove(1), len(b))', "None None\nTrue\nNone 0\n"));
  it("discard는 없는 값을 허용", () => prints('a = {1}\nprint(a.discard(2), a == {1})', "None True\n"));
  it("pop은 원소 하나를 반환하고 clear는 비운다", () => prints('a = {1}\nprint(a.pop(), a.clear(), len(a))', "1 None 0\n"));
  it("update와 union은 여러 iterable 사용", () => prints('a = {1}\nprint(a.update([2], (3,)))\nb = a.union([4], {5})\nprint(a == {1, 2, 3}, b == {1, 2, 3, 4, 5})', "None\nTrue True\n"));
  it("intersection과 difference는 새 집합 반환", () => prints('a = {1, 2, 3}\nprint(a.intersection([2, 3], [3]) == {3})\nprint(a.difference([1], [2]) == {3})\nprint(a == {1, 2, 3})', "True\nTrue\nTrue\n"));
  it("부분·상위 집합 메서드", () => prints('print({1}.issubset([1, 2]), {1, 2}.issuperset([1]))', "True True\n"));
  it.each(['{[]}', 'set([{}])', '{set()}', '{([1],)}', '{([1],): 2}'])("hashability: %s", code => expect(events(code).at(-1)).toMatchObject({ type: "error", error: { line: 1, pythonType: "TypeError" } }));
  it.each(['set().pop()', '{1}.remove(2)'])("없는 집합 원소 KeyError: %s", code => expect(events(code).at(-1)).toMatchObject({ type: "error", error: { line: 1, pythonType: "KeyError" } }));
  it("집합 인수 개수 오류", () => expect(events('a = set()\na.add()').at(-1)).toMatchObject({ type: "error", error: { line: 2, pythonType: "TypeError" } }));
  it("집합은 첨자 접근 금지", () => expect(events('print({1}[0])').at(-1)).toMatchObject({ type: "error", error: { pythonType: "TypeError" } }));
  it("집합 내포의 다중 for와 if", () => prints('print({x + y for x in range(3) for y in range(3) if x != y if x + y > 1} == {2, 3})', "True\n"));
  it("딕셔너리 내포의 중복 키는 나중 값으로 대체", () => prints('print({x % 2: x for x in range(4)})', "{0: 2, 1: 3}\n"));
  it("중첩 내포와 함수 호출", () => prints('def square(x):\n    return x * x\na = {x: [square(y) for y in range(x)] for x in range(3)}\nprint(a)', "{0: [], 1: [0], 2: [0, 1]}\n"));
  it("내포의 첫 iterable은 바깥에서 평가", () => prints('x = [1, 2]\nprint([x for x in x])\nprint({x for x in x} == {1, 2})\nprint({x: x for x in x})\nprint(x)', "[1, 2]\nTrue\n{1: 1, 2: 2}\n[1, 2]\n"));
  it("딕셔너리 내포는 키를 값보다 먼저 한 번 평가", () => prints('log = []\ndef record(x):\n    log.append(x)\n    return x\na = {record(1): record(2) for n in range(1)}\nprint(log)', "[1, 2]\n"));
  it("내포 언패킹과 변수 비유출", () => prints('a = {name: score for name, score in [("민수", 90)]}\ntry:\n    print(name)\nexcept NameError:\n    print(a)', "{'민수': 90}\n"));
  it("del 이름과 global", () => prints('value = 1\ndef remove():\n    global value\n    del value\nremove()\ntry:\n    print(value)\nexcept NameError:\n    print("삭제")', "삭제\n"));
  it("del 리스트·딕셔너리·음수 인덱스", () => prints('a = [1, 2, 3]\nd = {"x": 1}\ndel a[-1], d["x"]\nprint(a, d)', "[1, 2] {}\n"));
  it("del 슬라이스와 역방향 step", () => prints('a = [0, 1, 2, 3, 4, 5]\ndel a[1:3]\nprint(a)\ndel a[::-2]\nprint(a)', "[0, 3, 4, 5]\n[0, 4]\n"));
  it.each([['del missing', 'NameError'], ['a = []\ndel a[0]', 'IndexError'], ['a = {}\ndel a["x"]', 'KeyError'], ['a = (1,)\ndel a[0]', 'TypeError']])("삭제 오류 %s", (code, type) => expect(events(code).at(-1)).toMatchObject({ type: "error", error: { pythonType: type } }));
  it("assert 성공 시 설명은 평가하지 않는다", () => prints('assert True, missing\nprint("성공")', "성공\n"));
  it("assert 실패와 한국어 설명", () => prints('try:\n    assert False, "조건 확인"\nexcept AssertionError as error:\n    print(str(error))', "조건 확인\n"));
  it("assert 오류 위치", () => expect(events('a = 1\nassert a == 2').at(-1)).toMatchObject({ type: "error", error: { line: 2, pythonType: "AssertionError" } }));
});
describe("Core v2 step 슬라이싱 경계", () => {
  it.each([
    ['[::2]', '[0, 2, 4]'], ['[::-1]', '[4, 3, 2, 1, 0]'], ['[100::-1]', '[4, 3, 2, 1, 0]'],
    ['[-100:100]', '[0, 1, 2, 3, 4]'], ['[-100::-1]', '[]'], ['[:-100:-1]', '[4, 3, 2, 1, 0]'],
    ['[3:-1:-1]', '[]'], ['[4:0:-2]', '[4, 2]'], ['[0:4:-1]', '[]'], ['[100:200]', '[]'],
  ])("%s", (slice, expected) => prints(`a = [0, 1, 2, 3, 4]\nprint(a${slice})`, `${expected}\n`));
  it("문자열과 튜플은 자료형 유지", () => prints('print("가나다"[::-1], (1, 2, 3)[::2])', "다나가 (1, 3)\n"));
  it("step 0은 ValueError", () => expect(events('a = [1]\nprint(a[::0])').at(-1)).toMatchObject({ type: "error", error: { line: 2, pythonType: "ValueError" } }));
});
