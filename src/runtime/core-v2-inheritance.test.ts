import { describe, expect, it } from "vitest";
import { compile } from "../compiler/compiler";
import { VM, type VMEvent } from "./vm";
const run = (source: string) => { const events: VMEvent[] = []; new VM(compile(source), event => events.push(event)).execute(); return events; };
const prints = (source: string, expected: string) => { const events = run(source); expect(events.at(-1)).toEqual({ type: "complete" }); expect(events.filter(e => e.type === "output").map(e => e.text).join("")).toBe(expected + "\n"); };
describe("Core v2 단일 상속", () => {
  it("부모 클래스 속성과 자식 가리기", () => prints('class A:\n    x = 1\nclass B(A):\n    pass\nb = B()\nprint(B.x, b.x)\nB.x = 2\nprint(A.x, b.x)', '1 1\n1 2'));
  it("인스턴스 가리기", () => prints('class A:\n    x = 1\nclass B(A):\n    pass\nb = B()\nb.x = 3\nA.x = 2\nprint(b.x, B().x)', '3 2'));
  it("상속 생성자 기본값과 키워드", () => prints('class A:\n    def __init__(self, x=3):\n        self.x = x\nclass B(A):\n    pass\nprint(B().x, B(x=5).x)', '3 5'));
  it("부모 생성자 super 호출", () => prints('class Person:\n    def __init__(self, name):\n        self.name = name\nclass Student(Person):\n    def __init__(self, name, grade):\n        super().__init__(name)\n        self.grade = grade\na = Student("민수", 2)\nprint(a.name, a.grade, isinstance(a, Person), isinstance(a, Student))', '민수 2 True True'));
  it("다단계 super는 정의 클래스 기준", () => prints('class A:\n    def f(self):\n        return "A"\nclass B(A):\n    def f(self):\n        return super().f() + "B"\nclass C(B):\n    def f(self):\n        return super().f() + "C"\nprint(C().f())', 'ABC'));
  it("상속된 결합 메서드와 직접 호출", () => prints('class A:\n    def f(self, x=2):\n        return x * 2\nclass B(A):\n    pass\nb = B()\nf = b.f\nprint(f(x=3), B.f(b, 4))', '6 8'));
  it("issubclass 계층", () => prints('class A:\n    pass\nclass B(A):\n    pass\nprint(issubclass(B, A), issubclass(A, B), issubclass(A, A), isinstance(1, A))', 'True False True False'));
  it("super 인스턴스 중복 바인딩 없음", () => prints('class A:\n    def f(self, value):\n        return value\nclass B(A):\n    def f(self, value):\n        method = super().f\n        return method(value=value)\nprint(B().f(9))', '9'));
  it.each([
    ['class A(1):\n    pass', 1, 'TypeError'], ['super()', 1, 'RuntimeError'], ['issubclass(1, 2)', 1, 'TypeError'],
    ['class A:\n    def f(self):\n        return super().missing()\nA().f()', 3, 'AttributeError'],
  ])("오류 %s", (source, line, pythonType) => expect(run(source).at(-1)).toMatchObject({ type: "error", error: { line, pythonType } }));
  it("다중 상속은 명시적으로 제외", () => expect(() => compile('class C(A, B):\n    pass')).toThrow());
  it("상속 __str__", () => prints('class A:\n    def __str__(self):\n        return "상속"\nclass B(A):\n    pass\nprint(B())', '상속'));
});
