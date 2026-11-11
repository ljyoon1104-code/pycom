import { afterEach, describe, expect, it, vi } from "vitest";
import { compile } from "../compiler/compiler";
import { CompilerError } from "../compiler/token";
import { VM, type VMEvent } from "./vm";
import { repr, type ListValue, type Value } from "./value";
import { RESOURCE_LIMITS, ResourceLimitError, TextBudget } from "./resource-limits";
import { execute } from "./test-helpers";

const output = (events: VMEvent[]) => events.filter(event => event.type === "output").map(event => event.text).join("");
const lastError = (code: string) => execute(code).events.at(-1);
afterEach(() => vi.restoreAllMocks());

describe("allocation and representation budgets", () => {
  it.each(["[]", "()"])("empty %s repetition never allocates a multiplier-sized intermediate", sequence => {
    const native = Array.from;
    const allocations = vi.spyOn(Array, "from").mockImplementation(((value: { length?: number }, ...rest: unknown[]) => {
      if (typeof value.length === "number" && value.length > RESOURCE_LIMITS.collectionItems) throw Error("oversized intermediate");
      return Reflect.apply(native, Array, [value, ...rest]);
    }) as typeof Array.from);
    const { events } = execute(`values = ${sequence} * 1000000000\nprint(len(values))`);
    expect(output(events)).toBe("0\n"); expect(events.at(-1)).toEqual({ type: "complete" });
    expect(allocations.mock.calls.some(([value]) => "length" in value && value.length === 1000000000)).toBe(false);
  });
  it("empty string repetition avoids even an unnecessary repeat call", () => {
    const repeated = vi.spyOn(String.prototype, "repeat");
    expect(output(execute('print(len("" * 100000000000000000000))').events)).toBe("0\n");
    expect(repeated).not.toHaveBeenCalled();
  });
  it.each(["[1]", "(1,)"])("nonempty %s repetition rejects final size before allocation", sequence => {
    expect(lastError(`values = ${sequence} * 1000000000`)).toMatchObject({ type: "error", error: { line: 1, category: "runtime", message: "값의 크기 제한을 초과했습니다." } });
  });
  it("list repetition preserves shared element identity", () => {
    expect(output(execute('child = []\nvalues = [child] * 3\nchild.append(7)\nprint(values)\nprint(values[0] is values[2])').events)).toBe("[[7], [7], [7]]\nTrue\n");
  });
  it.each(["<", ">", "^", "0"])("oversized f-string %s width never reaches padding", align => {
    const start = vi.spyOn(String.prototype, "padStart"), end = vi.spyOn(String.prototype, "padEnd"), repeat = vi.spyOn(String.prototype, "repeat");
    expect(lastError(`text = f"{1:${align}200000}"`)).toMatchObject({ type: "error", error: { line: 1, category: "runtime", message: "문자열 크기 제한을 초과했습니다." } });
    expect(start).not.toHaveBeenCalled(); expect(end).not.toHaveBeenCalled(); expect(repeat).not.toHaveBeenCalled();
  });
  it("an unsafe numeric format width is rejected without native RangeError", () => {
    expect(lastError('text = f"{1:>9007199254740992}"')).toMatchObject({ type: "error", error: { line: 1, category: "runtime", message: "문자열 크기 제한을 초과했습니다." } });
  });
  it("an abnormally long specifier is refused before numeric parsing", () => {
    expect(() => compile(`text = f"{1:>${"9".repeat(RESOURCE_LIMITS.formatSpecifierCharacters)}}"`)).toThrow(/형식 길이 제한/);
    try { compile(`text = f"{1:>${"9".repeat(RESOURCE_LIMITS.formatSpecifierCharacters)}}"`); } catch (error) { expect((error as CompilerError).detail.line).toBe(1); }
  });
  it.each([Number.POSITIVE_INFINITY, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("rejects non-finite or unsafe bytecode width %s", width => {
    const events: VMEvent[] = [];
    new VM({ instructions: [{ op: "constant", value: 1, line: 4, column: 3 }, { op: "format_value", format: { kind: "align", align: ">", width }, line: 4, column: 3 }] }, event => events.push(event)).execute();
    expect(events.at(-1)).toMatchObject({ type: "error", error: { line: 4, column: 3, category: "runtime", message: "문자열 크기 제한을 초과했습니다." } });
  });
  it("precision is limited before toFixed", () => {
    const fixed = vi.spyOn(Number.prototype, "toFixed");
    expect(lastError('text = f"{1.2:.101f}"')).toMatchObject({ type: "error", error: { line: 1, message: "f-string 정밀도 제한을 초과했습니다." } });
    expect(fixed).not.toHaveBeenCalled();
  });
  it("normal alignment, zero fill and precision preserve results", () => {
    expect(output(execute('print(f"{12:<4}|{12:>4}|{12:^4}|{12:05}|{3.14159:.2f}")').events)).toBe("12  |  12| 12 |00012|3.14\n");
  });
  it("the exact f-string character boundary is accepted", () => {
    expect(output(execute('text = f"{1:>100000}"\nprint(len(text))').events)).toBe("100000\n");
  });
  it("all f-string components share a character budget before the final join", () => {
    expect(lastError('a = "x" * 60000\ntext = f"{a}{a}"')).toMatchObject({ type: "error", error: { line: 2, category: "runtime", message: "문자열 크기 제한을 초과했습니다." } });
  });
  it.each(['>', '<', '0'])("multipart %s padding stops before allocating the second oversized result", format => {
    const start = vi.spyOn(String.prototype, 'padStart'), end = vi.spyOn(String.prototype, 'padEnd');
    const source = 'text = f"' + Array(100).fill(`{1:${format}100000}`).join('') + '"';
    const events = execute(source).events;
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { line: 1, category: 'runtime', message: '문자열 크기 제한을 초과했습니다.' } });
    expect(start.mock.calls.filter(([width]) => width === 100000).length + end.mock.calls.filter(([width]) => width === 100000).length).toBe(1);
    expect(output(events)).toBe('');
  });
  it("multipart center padding also reserves before allocating its spaces", () => {
    const repeat = vi.spyOn(String.prototype, 'repeat');
    const events = execute('text = f"{1:^100000}{2:^100000}{3:^100000}"').events;
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { category: 'runtime' } });
    expect(repeat.mock.calls).toHaveLength(2);
    expect(repeat.mock.calls.reduce((total, [count]) => total + count, 0)).toBe(99999);
  });
  it("literal parts reduce the remaining budget before later padding", () => {
    const start = vi.spyOn(String.prototype, 'padStart');
    const events = execute('text = f"literal{1:>100000}"').events;
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { line: 1, category: 'runtime' } });
    expect(start).not.toHaveBeenCalled();
  });
  it("unformatted string parts are charged before the next expression is evaluated", () => {
    const source = 'def later():\n    print("later")\n    return "x"\na = "x" * 60000\ntext = f"{a}{a}{later()}"';
    const events = execute(source).events;
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { line: 5, category: 'runtime' } });
    expect(output(events)).toBe('');
  });
  it("mixed literal and unformatted string parts stop before a later padded allocation", () => {
    const start = vi.spyOn(String.prototype, 'padStart');
    const events = execute('a = "x" * 60000\ntext = f"' + 'L'.repeat(60000) + '{a}{1:>100000}"').events;
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { line: 2, category: 'runtime' } });
    expect(start).not.toHaveBeenCalled();
  });
  it("nested f-string scopes on one activation stack do not charge each other", () => {
    const events = execute('text = f"{f\'hello\'}{1:>99995}"\nprint(len(text))').events;
    expect(output(events)).toBe('100000\n'); expect(events.at(-1)).toEqual({ type: 'complete' });
  });
  it("formatting callbacks with their own f-strings restore the outer allocation scope", () => {
    const source = 'class Item:\n    def __str__(self):\n        return f"ok"\ntext = f"{Item():>4}{1:>99996}"\nprint(len(text))';
    const events = execute(source).events;
    expect(output(events)).toBe('100000\n'); expect(events.at(-1)).toEqual({ type: 'complete' });
  });
  it("recursive invocations keep separate budgets for the same compiled f-string", () => {
    const source = 'def make(n):\n    if n == 0:\n        return "x"\n    return f"{make(n - 1):>2}"\ntext = f"{make(3):>5}{1:>99995}"\nprint(len(text))';
    const events = execute(source).events;
    expect(output(events)).toBe('100000\n'); expect(events.at(-1)).toEqual({ type: 'complete' });
  });
  it("an exception-abandoned scope resets when the same f-string is retried in a loop", () => {
    const source = 'for n in range(2):\n    try:\n        text = f"{1:>99999}{1 // n}"\n    except ZeroDivisionError:\n        pass\nprint(len(text))';
    const events = execute(source).events;
    expect(output(events)).toBe('100000\n'); expect(events.at(-1)).toEqual({ type: 'complete' });
  });
  it("budgets belong to each f-string, never accumulate across normal executions", () => {
    const events = execute('for n in range(30):\n    text = f"{n:>10000}"\nprint(len(text))').events;
    expect(output(events)).toBe('10000\n'); expect(events.at(-1)).toEqual({ type: 'complete' });
  });
  it("normal expression and formatted __str__ evaluation order is preserved", () => {
    const source = 'events = []\nclass Item:\n    def __str__(self):\n        events.append("str")\n        return "x"\ndef mark():\n    events.append("next")\n    return "y"\ntext = f"{Item():>2}{mark()}"\nprint(events)\nprint(text)';
    expect(output(execute(source).events)).toBe("['str', 'next']\n xy\n");
  });
  it("unformatted __str__ conversion keeps its existing delayed evaluation order", () => {
    const source = 'events = []\nclass Item:\n    def __str__(self):\n        events.append("str")\n        return "x"\ndef mark():\n    events.append("next")\n    return "y"\ntext = f"{Item()}{mark()}"\nprint(events)\nprint(text)';
    expect(output(execute(source).events)).toBe("['next', 'str']\nxy\n");
  });
  it("all print arguments share an output budget", () => {
    const { events } = execute('a = "x" * 60000\nprint(a, a)');
    expect(output(events)).toBe(""); expect(events.at(-1)).toMatchObject({ type: "error", error: { line: 2, message: "출력량 제한을 초과했습니다." } });
  });
  it("print separators and terminators count before joining", () => {
    const { events } = execute('print("", "", "", sep="x" * 60000)');
    expect(output(events)).toBe(""); expect(events.at(-1)).toMatchObject({ type: "error", error: { line: 1, message: "출력량 제한을 초과했습니다." } });
  });
  it("custom __str__ callbacks share the same print budget and keep the caller line", () => {
    const { events } = execute('class Item:\n    def __str__(self):\n        return "x" * 60000\nprint(Item(), Item())');
    expect(output(events)).toBe("");
    expect(events.at(-1)).toMatchObject({ type: "error", error: { line: 4, message: "출력량 제한을 초과했습니다." } });
  });
  it.each([
    ['bare except', 'except:', 'value = [1] * 10001'],
    ['Exception', 'except Exception:', 'value = [1] * 10001'],
    ['bare except', 'except:', 'value = f"{1:>200000}"'],
    ['Exception', 'except Exception:', 'value = f"{1:>200000}"'],
  ])("%s cannot catch allocation limit in %s", (_label, handler, statement) => {
    const { events } = execute(`try:\n    ${statement}\n${handler}\n    print("caught")`);
    expect(output(events)).toBe(""); expect(events.at(-1)).toMatchObject({ type: "error", error: { line: 2, category: "runtime" } });
  });
  it.each(['step', 'follow'] as const)("%s execution keeps resource termination uncatchable", mode => {
    vi.useFakeTimers();
    try {
      const code = 'try:\n    text = f"{1:>200000}"\nexcept:\n    print("caught")';
      const events: VMEvent[] = [];
      const vm = new VM(compile(code, { sourceId: 'entry', fileName: 'main.py', code }), event => events.push(event), new Map(), { executionMode: mode });
      vm.execute();
      for (let count = 0; count < 20 && events.at(-1)?.type !== 'error'; count++) {
        const position = events.filter(event => event.type === 'execution').at(-1);
        if (mode === 'follow') vi.runOnlyPendingTimers();
        else if (position?.type === 'execution' && position.pauseId !== undefined) vm.advance(position.pauseId);
      }
      expect(output(events)).toBe(''); expect(events.at(-1)).toMatchObject({ type: 'error', error: { line: 2, category: 'runtime' } });
    } finally { vi.useRealTimers(); }
  });
  it("print preserves the existing exact-boundary output limit", () => {
    expect(lastError('print("x" * 100000)')).toMatchObject({ type: "error", error: { message: "출력량 제한을 초과했습니다." } });
  });
  it("self-referencing lists terminate with the Python cycle marker", () => {
    expect(output(execute('a = []\na.append(a)\nprint(a)\nprint(str(a))\nprint(f"{a}")').events)).toBe("[[...]]\n[[...]]\n[[...]]\n");
  });
  it("self-referencing dictionaries and indirect cycles terminate", () => {
    expect(output(execute('a = {}\na["self"] = a\nprint(a)\nb = []\nc = [b]\nb.append(c)\nprint(b)').events)).toBe("{'self': {...}}\n[[[...]]]\n");
  });
  it("ordinary shared references are rendered fully, never as cycles", () => {
    expect(output(execute('a = [1, "가"]\nprint([a, a])').events)).toBe("[[1, '가'], [1, '가']]\n");
  });
  it.each(["str(value)", 'f"{value}"', "print(value)"])("exponential shared representation %s is bounded and uncatchable", expression => {
    const { events } = execute(`value = [0]\nfor i in range(18):\n    value = [value, value]\ntry:\n    ${expression}\nexcept:\n    print("caught")`);
    expect(events.at(-1)).toMatchObject({ type: "error", error: { line: 5, category: "runtime" } });
    expect(output(events)).toBe("");
  });
  it("representation depth is bounded below the JavaScript call-stack limit", () => {
    expect(lastError('value = 0\nfor i in range(65):\n    value = [value]\nstr(value)')).toMatchObject({ type: "error", error: { line: 4, message: "값의 표현 깊이 제한을 초과했습니다." } });
  });
  it("escaped representation checks the escaped length as it is written", () => {
    const value: ListValue = { kind: "list", items: ["\n".repeat(50000)] };
    expect(() => repr(value)).toThrow(ResourceLimitError);
  });
  it("representation visits have an independent finite budget", () => {
    const budget = new TextBudget();
    for (let index = 0; index < RESOURCE_LIMITS.representationVisits; index++) budget.visit(0);
    expect(() => budget.visit(0)).toThrow(/표현 작업 제한/);
  });
  it("repr preserves Unicode, quotes and escape spelling", () => {
    const value: Value = { kind: "list", items: ["한글😀", "'\\\n\r\t\u0001"] };
    expect(repr(value)).toBe("['한글😀', '\\'\\\\\\n\\r\\t\\x01']");
  });
  it("bare except cannot bypass the file-count budget or create the rejected file", () => {
    const files = new Map(Array.from({ length: 100 }, (_, index) => [`f${index}.txt`, ""]));
    const events: VMEvent[] = [];
    new VM(compile('try:\n    open("extra.txt", "w")\nexcept:\n    print("caught")'), event => events.push(event), files).execute();
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { line: 2, message: '파일은 최대 100개까지 만들 수 있습니다.' } });
    expect(output(events)).toBe(''); expect(files.size).toBe(100); expect(files.has('extra.txt')).toBe(false);
  });
  it("Exception cannot bypass the per-file byte budget and prior content survives", () => {
    const content = 'x'.repeat(1_000_000), files = new Map([['big.txt', content]]), events: VMEvent[] = [];
    new VM(compile('try:\n    file = open("big.txt", "a")\n    file.write("x")\nexcept Exception:\n    print("caught")'), event => events.push(event), files).execute();
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { line: 3, message: '파일 하나는 1MB를 넘을 수 없습니다.' } });
    expect(output(events)).toBe(''); expect(files.get('big.txt')).toBe(content);
  });
  it("bare except cannot bypass the total byte budget and no partial write is applied", () => {
    // Share the large fixture string in memory; no disk files or oversized allocation.
    const block = 'x'.repeat(1_000_000), files = new Map(Array.from({ length: 10 }, (_, index) => [`f${index}.txt`, index === 9 ? block.slice(0, 999_990) : block]));
    files.set('target.txt', ''); const events: VMEvent[] = [];
    new VM(compile('try:\n    file = open("target.txt", "a")\n    file.write("12345678901")\nexcept:\n    print("caught")'), event => events.push(event), files).execute();
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { line: 3, message: '전체 파일 용량은 10MB를 넘을 수 없습니다.' } });
    expect(output(events)).toBe(''); expect(files.get('target.txt')).toBe(''); expect(files.get('f0.txt')).toBe(block);
  });
});
