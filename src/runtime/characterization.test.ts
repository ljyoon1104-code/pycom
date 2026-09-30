import { describe, expect, it } from "vitest";
import { compile } from "../compiler/compiler";
import { VM, type VMEvent } from "./vm";

function run(source: string, files = new Map<string, string>(), inputs: string[] = []) {
  const events: VMEvent[] = [];
  const vm = new VM(compile(source), event => events.push(event), files, { fileName: "main.py" });
  vm.execute();
  for (const input of inputs) { expect(events.at(-1)?.type).toBe("input"); vm.resume(input); }
  return { vm, events, output: events.filter(event => event.type === "output").map(event => event.text).join("") };
}
function success(source: string, expected: string, inputs: string[] = []) {
  const result = run(source, undefined, inputs);
  expect(result.events.filter(event => event.type === "error")).toEqual([]);
  expect(result.events.at(-1)).toEqual({ type: "complete" });
  expect(result.output).toBe(expected);
  return result;
}
describe("VM control-flow characterization", () => {
  it("nested frame entry and return preserve evaluation order", () => success('def f(x):\n    print(x)\n    return x + 1\nprint(f(f(1)))', "1\n2\n3\n"));
  it("cross-frame exception executes inner finally before outer handler", () => success('def f():\n    try:\n        print(1 / 0)\n    finally:\n        print("inner")\ntry:\n    f()\nexcept ZeroDivisionError:\n    print("caught")\nfinally:\n    print("outer")', "inner\ncaught\nouter\n"));
  it("return value survives finally", () => success('def f():\n    try:\n        return 7\n    finally:\n        print("cleanup")\nprint(f())', "cleanup\n7\n"));
  it("finally return replaces pending return", () => success('def f():\n    try:\n        return 1\n    finally:\n        return 2\nprint(f())', "2\n"));
  it("continue and break run only exited finally regions", () => success('for n in range(3):\n    try:\n        if n == 0:\n            continue\n        break\n    finally:\n        print(n)\nprint("done")', "0\n1\ndone\n"));
  it("input resumes the suspended function and caller", () => {
    const result = success('def f():\n    return int(input("값: ")) + 1\nprint(f() * 2)', "12\n", ["5"]);
    expect(result.events).toEqual([{ type: "input", prompt: "값: " }, { type: "output", text: "12\n" }, { type: "complete" }]);
  });
  it("stop cannot enter except or resume a closed frame", () => {
    const { vm, events } = run('try:\n    input("대기")\nexcept:\n    print("caught")');
    vm.stop(); vm.resume("5"); vm.execute();
    expect(events).toEqual([{ type: "input", prompt: "대기" }, { type: "stopped" }]);
    success('print("restart")', "restart\n");
  });
  it.each([
    ['output', 'try:\n    for n in range(1000):\n        print("x" * 1000)\nexcept:\n    print("caught")', "출력량 제한을 초과했습니다.", ("x".repeat(1000) + "\n").repeat(99)],
    ['loop', 'try:\n    while True:\n        pass\nexcept Exception:\n    print("caught")', "실행을 중지했습니다. 반복문이 끝나는 조건을 확인해 주세요.", ""],
  ])("%s limit is not a Python exception", (_, source, message, expected) => {
    const result = run(source);
    expect(result.output).toBe(expected);
    expect(result.events.at(-1)).toMatchObject({ type: "error", error: { category: "runtime", message } });
    success('print("restart")', "restart\n");
  });
  it("nested handler variables are removed only when their region exits", () => success('try:\n    1 / 0\nexcept ZeroDivisionError as outer:\n    for n in range(1):\n        try:\n            missing\n        except NameError as inner:\n            continue\n    print(str(outer))\ntry:\n    print(inner)\nexcept NameError:\n    print("inner cleared")\ntry:\n    print(outer)\nexcept NameError:\n    print("outer cleared")', "0으로 나눌 수 없습니다.\ninner cleared\nouter cleared\n"));
  it("new exception clears handler variable across frame unwinding", () => success('def f():\n    try:\n        1 / 0\n    except ZeroDivisionError as error:\n        missing\ntry:\n    f()\nexcept NameError:\n    print("caught")\ntry:\n    print(error)\nexcept NameError:\n    print("cleared")', "caught\ncleared\n"));
});

describe("value characterization", () => {
  it.each([
    ["bool equality and identity", "print(True == 1, True is 1, None is None)", "True False True\n"],
    ["list equality and identity", "a = [1]; b = [1]; c = a\nprint(a == b, a is b, a is c)", "True False True\n"],
    ["NaN identity in dictionary keys", 'n = float("nan")\nd = {n: 7}\nprint(n == n, n is n, d[n], len(d))', "False True 7 1\n"],
    ["negative zero representation", "print(-0.0, [-0.0], -0.0 == 0.0)", "-0.0 [-0.0] True\n"],
    ["nested collection representation", "print([{'x': (1, None)}, [True, 'a']])", "[{'x': (1, None)}, [True, 'a']]\n"],
    ["mutable keys are rejected", 'try:\n    d = {[]: 1}\nexcept TypeError:\n    print("unhashable")', "unhashable\n"],
    ["bound method callable", "class A:\n    def f(self, x):\n        return x + 1\na = A(); method = a.f\nprint(method(2), list(map(method, [3])))", "3 [4]\n"],
    ["boolean indices", "a = [10, 20]; a[False] = 30\nprint(a[True], a[False])", "20 30\n"],
    ["slice clipping and reverse", "a = [0, 1, 2, 3]\nprint(a[-100:100], a[100:-100:-1], a[3:0:-2])", "[0, 1, 2, 3] [3, 2, 1, 0] [3, 1]\n"],
  ])("%s", (_, source, expected) => { success(source, expected); });
});

describe("saved module characterization", () => {
  const files = () => new Map([["helper.py", 'print("init")\nvalue = 7\nprint(__name__)']]);
  it("aliases and from import initialize exactly once per execution", () => {
    const source = "import helper as a\nimport helper as b\nfrom helper import value\nprint(a is b, value)";
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = run(source, files());
      expect(result.output).toBe("init\nhelper\nTrue 7\n"); expect(result.events.at(-1)).toEqual({ type: "complete" });
    }
  });
  it("snapshot excludes a module created after VM construction", () => {
    const saved = new Map<string, string>(), events: VMEvent[] = [];
    const vm = new VM(compile("import draft"), event => events.push(event), saved);
    saved.set("draft.py", "value = 99"); vm.execute();
    expect(events.at(-1)).toMatchObject({ type: "error", error: { pythonType: "ImportError", line: 1, column: 1 } });
  });
  it("non-Python saved files cannot become modules", () => {
    expect(run("import draft", new Map([["draft.txt", "value = 1"]])).events.at(-1)).toMatchObject({ type: "error", error: { pythonType: "ImportError", fileName: "main.py", line: 1, column: 1 } });
  });
  it("circular import is attributed to the importing module", () => {
    expect(run("import a", new Map([["a.py", "import b"], ["b.py", "import a"]])).events.at(-1)).toMatchObject({ type: "error", error: { pythonType: "ImportError", fileName: "b.py", line: 1, column: 1 } });
  });
  it("module runtime error retains file and exact source point", () => {
    expect(run("import helper", new Map([["helper.py", "value = 1\nprint(missing)"]])).events.at(-1)).toMatchObject({ type: "error", error: { pythonType: "NameError", fileName: "helper.py", line: 2, column: 7, message: "'missing' 변수가 정의되지 않았습니다." } });
  });
  it("failed module is removed from cache before retry", () => {
    const result = run('for n in range(2):\n    try:\n        import bad\n    except NameError:\n        print("caught")', new Map([["bad.py", 'print("init")\nmissing']]));
    expect(result.output).toBe("init\ncaught\ninit\ncaught\n"); expect(result.events.at(-1)).toEqual({ type: "complete" });
  });
  it("missing member reports import site", () => {
    expect(run("from helper import absent", new Map([["helper.py", "value = 7"]])).events.at(-1)).toMatchObject({ type: "error", error: { pythonType: "ImportError", fileName: "main.py", line: 1, column: 1 } });
  });
});
