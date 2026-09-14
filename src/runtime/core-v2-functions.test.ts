import { describe, expect, it } from "vitest";
import { compile } from "../compiler/compiler";
import { VM, type VMEvent } from "./vm";
const events = (code: string) => { const result: VMEvent[] = []; new VM(compile(code), event => result.push(event)).execute(); return result; };
const prints = (code: string, expected: string) => { const result = events(code); expect(result.at(-1)).toEqual({ type: "complete" }); expect(result.filter(e => e.type === "output").map(e => e.text).join("")).toBe(expected); };
describe("Core v2 함수와 언패킹", () => {
  it("map 콜백 내부에서 처리한 예외 후 반환", () => prints('def f(x):\n    try:\n        raise ValueError("x")\n    except ValueError:\n        return x\nprint(list(map(f, [1, 2])))', '[1, 2]\n'));
  it("map에 sorted 내장 함수 전달", () => prints('print(list(map(sorted, [[2, 1], [4, 3]])))', '[[1, 2], [3, 4]]\n'));
  it("별표만 있는 리스트 대입", () => prints('[*rest] = [1, 2]\nprint(rest)', '[1, 2]\n'));
  it("별표만 있는 튜플 대입", () => prints('(*rest,) = [1, 2]\nprint(rest)', '[1, 2]\n'));
  it("튜플 대상 마지막 쉼표", () => prints('a, = [1]\nprint(a)', '1\n'));
  it("클로저는 클래스 이름 공간을 건너뜀", () => prints('x = 10\nclass C:\n    x = 20\n    def read(self):\n        return x\nprint(C().read())', '10\n'));
  it("클로저의 아직 없는 지역 바인딩은 전역으로 대체하지 않음", () => prints('x = 9\ndef outer():\n    def inner():\n        return x\n    try:\n        print(inner())\n    except NameError:\n        print("미정의")\n    x = 1\nouter()', '미정의\n'));
  it("클로저에서 nonlocal 삭제", () => prints('def outer():\n    x = 1\n    def inner():\n        nonlocal x\n        del x\n    inner()\n    try:\n        print(x)\n    except NameError:\n        print("삭제")\nouter()', '삭제\n'));
  it("가변 위치 인수는 튜플", () => prints('def f(*args):\n    print(args)\nf()\nf(1, 2)', '()\n(1, 2)\n'));
  it("가변 키워드는 딕셔너리", () => prints('def f(**kwargs):\n    print(kwargs)\nf(name="민수")', "{'name': '민수'}\n"));
  it("기본값과 가변 인수 결합", () => prints('def f(a, b=10, *args, **kwargs):\n    print(a, b, args, kwargs)\nf(1, 2, 3, x=4)', "1 2 (3,) {'x': 4}\n"));
  it("기본값은 정의 시 한 번", () => prints('def f(*args, items=[]):\n    items.append(1)\n    print(items)\nf()\nf()', '[1]\n[1, 1]\n'));
  it("호출 별표와 키워드 확장", () => prints('print(*[1, 2], **{"end": "!"})', '1 2!'));
  it("람다를 map에 전달", () => prints('double = lambda x: x * 2\nprint(list(map(double, [1, 2])))', '[2, 4]\n'));
  it("람다 기본값", () => prints('f = lambda x=3: x + 1\nprint(f(), f(5))', '4 6\n'));
  it("반환된 클로저의 어휘적 범위", () => prints('def factory(amount):\n    def add(value):\n        return value + amount\n    return add\nf = factory(10)\namount = 99\nprint(f(2), factory(20)(2))', '12 22\n'));
  it("nonlocal 공유 셀", () => prints('def factory():\n    count = 0\n    def add():\n        nonlocal count\n        count += 1\n        return count\n    return add\nf = factory()\nprint(f(), f(), factory()())', '1 2 1\n'));
  it("중첩 재귀", () => prints('def factory():\n    def f(n):\n        return 1 if n == 0 else n * f(n - 1)\n    return f\nprint(factory()(5))', '120\n'));
  it("동적 호출자의 지역 변수를 조회하지 않음", () => prints('value = 1\ndef read():\n    return value\ndef caller():\n    value = 2\n    return read()\nprint(caller())', '1\n'));
  it("별표 가운데 대입", () => prints('a, *middle, z = [1, 2, 3, 4]\nprint(a, middle, z)', '1 [2, 3] 4\n'));
  it("별표 빈 나머지", () => prints('[first, *rest] = [1]\nprint(first, rest)', '1 []\n'));
  it("중첩 별표 대입", () => prints('a, (b, *c) = [1, [2, 3, 4]]\nprint(a, b, c)', '1 2 [3, 4]\n'));
  it("별표 개수 불일치 시 부분 저장 없음", () => prints('a = 9\ntry:\n    a, (b, c) = [1, [2]]\nexcept ValueError:\n    print(a)', '9\n'));
  it("별표 반복 대상", () => prints('for a, *rest in [[1, 2, 3]]:\n    print(a, rest)', '1 [2, 3]\n'));
  it("컬렉션 별표 생성", () => prints('values = [1, 2]\nprint([0, *values, 9], (*values, 9))', '[0, 1, 2, 9] (1, 2, 9)\n'));
  it("딕셔너리 병합은 나중 값 우선", () => prints('print({**{"x": 1}, **{"x": 2}, "y": 3})', "{'x': 2, 'y': 3}\n"));
  it.each([
    'def f(a):\n    pass\nf()',
    'def f(a):\n    pass\nf(1, 2)',
    'def f(a):\n    pass\nf(1, **{"a": 2})',
    'def f(a):\n    pass\nf(x=1)',
    'def f(**kwargs):\n    pass\nf(**{"a": 1}, **{"a": 2})',
    'def f(**kwargs):\n    pass\nf(**{1: 2})',
    'def f(*args):\n    pass\nf(*1)',
    'def f(**kwargs):\n    pass\nf(**1)',
  ])("잘못된 호출의 줄과 오류 종류: %s", code => expect(events(code).at(-1)).toMatchObject({ type: "error", error: { line: 3, pythonType: "TypeError" } }));
});
