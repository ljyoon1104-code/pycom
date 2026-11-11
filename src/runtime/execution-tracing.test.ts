import { afterEach, describe, expect, it, vi } from "vitest";
import { compile } from "../compiler/compiler";
import { VM, type VMEvent } from "./vm";
import type { ExecutionMode } from "./execution-control";

function start(code: string, mode: ExecutionMode = "step", files = new Map<string, string>()) {
  const events: VMEvent[] = [];
  const vm = new VM(compile(code, { sourceId: "entry", fileName: "main.py", code }), event => events.push(event), files, { fileName: "main.py", executionMode: mode });
  vm.execute();
  const paused = () => { let index=events.length-1; while(index>=0 && events[index].type!=="execution")index--; return events[index] as Extract<VMEvent, { type: "execution" }>; };
  const next = () => { const ticket = paused()?.pauseId; if (ticket !== undefined) vm.advance(ticket); };
  const finish = () => { let n = 0; while (!['complete', 'error', 'input', 'stopped'].includes(events.at(-1)!.type) && ++n < 2000) { if (mode === 'follow') vi.runOnlyPendingTimers(); else next(); } expect(n).toBeLessThan(2000); };
  const lines = () => events.filter(event => event.type === "execution" && event.state === "paused").map(event => event.type === "execution" ? event.location!.line : 0);
  return { vm, events, paused, next, finish, lines, output: () => events.filter(event => event.type === "output").map(event => event.text).join("") };
}
afterEach(() => vi.useRealTimers());
describe("statement stepping", () => {
  it("pauses before evaluating the first for iterable, including input", () => { const t = start('for x in [input("값: ")]:\n    print(x)'); expect(t.events.at(-1)).toMatchObject({type:'execution',state:'paused',location:{line:1}}); expect(t.events.some(e=>e.type==='input')).toBe(false); t.next(); expect(t.events.at(-1)).toEqual({type:'input',prompt:'값: '}); t.vm.resume('ok'); expect(t.paused().location?.line).toBe(2); t.finish(); expect(t.output()).toBe('ok\n'); });
  it("shows the for header before entering its iterable callback without a duplicate first stop", () => { const t = start('def values():\n    print("prepare")\n    return [1]\nfor x in values():\n    print(x)'); t.finish(); expect(t.lines()).toEqual([1,4,2,3,5,4]); expect(t.output()).toBe('prepare\n1\n'); });
  it("keeps first-for-stop coalescing independent in recursive frames", () => { const t = start('def f(n):\n    if n == 0:\n        return [0]\n    for x in f(n - 1):\n        print(n)\n    return [n]\nprint(f(2))'); t.finish(); expect(t.lines()).toEqual([1,7,2,4,2,4,2,3,5,4,6,5,4,6]); expect(t.output()).toBe('1\n2\n[2]\n'); });
  it.each(['step','follow'] as const)('%s iteration limits cannot be caught by Python', mode => { vi.useFakeTimers(); const t = start('try:\n    while True:\n        pass\nexcept Exception:\n    print("caught")',mode); let steps = 0; while(t.events.at(-1)?.type !== 'error' && ++steps < 10010) { if(mode==='follow') vi.runOnlyPendingTimers(); else t.next(); } expect(steps).toBeLessThan(10010); expect(t.events.at(-1)).toMatchObject({type:'error',error:{message:'실행을 중지했습니다. 반복문이 끝나는 조건을 확인해 주세요.'}}); expect(t.output()).toBe(''); });
  it("semicolon statements stop at independent columns without duplicate evaluation", () => { const t = start('print(1); print(2); print(3)'); t.finish(); expect(t.lines()).toEqual([1,1,1]); expect(t.events.filter(e=>e.type==='execution'&&e.state==='paused').map(e=>e.type==='execution'&&e.location?.column)).toEqual([1,11,21]); expect(t.output()).toBe('1\n2\n3\n'); });
  it("with entry and its body are separate statements", () => { const t = start('with open("a.txt", "w") as f:\n    f.write("a")\nprint("done")'); t.finish(); expect(t.lines()).toEqual([1,2,3]); expect(t.output()).toBe('done\n'); });
  it.each(['step','follow'] as const)('%s output limits remain uncatchable and end execution', mode => { vi.useFakeTimers(); const t = start('try:\n    print("x" * 100001)\nexcept:\n    print("caught")',mode); t.finish(); expect(t.events.at(-1)?.type).toBe('error'); expect(t.output()).not.toContain('caught'); t.vm.stop(); vi.runAllTimers(); expect(t.events.at(-1)?.type).toBe('error'); });
  it("waiting time never consumes the operation budget", () => { vi.useFakeTimers(); const t = start('x = input("값:")\nprint(x)'); vi.advanceTimersByTime(3600000); t.next(); vi.advanceTimersByTime(3600000); t.vm.resume('ok'); t.finish(); expect(t.output()).toBe('ok\n'); expect(t.events.at(-1)).toEqual({type:'complete'}); });
  it("starts before executing the first statement and completes after the last", () => { const t = start('print(1)\nprint(2)'); expect(t.output()).toBe(''); expect(t.lines()).toEqual([1]); t.next(); expect(t.output()).toBe('1\n'); expect(t.lines()).toEqual([1,2]); t.next(); expect(t.events.at(-1)).toEqual({type:'complete'}); });
  it("skips unexecuted branches, comments, and blank lines", () => { const t = start('# comment\n\nx = 1\nif x == 0:\n    print(0)\nelif x == 1:\n    print(1)\nelse:\n    print(2)\nprint(3)'); t.finish(); expect(t.lines()).toEqual([3,4,6,7,10]); });
  it("revisits for and body once per iteration, including exhaustion", () => { const t = start('total = 0\nfor n in range(3):\n    total += n\nprint(total)'); t.finish(); expect(t.lines()).toEqual([1,2,3,2,3,2,3,2,4]); expect(t.output()).toBe('3\n'); });
  it("while, continue, break and loop else follow actual control flow", () => { const t = start('n = 0\nwhile n < 3:\n    n += 1\n    if n == 1:\n        continue\n    break\nelse:\n    print(99)\nprint(n)'); t.finish(); expect(t.lines()).toEqual([1,2,3,4,5,2,3,4,6,9]); });
  it("enters a function and returns to the next caller statement", () => { const t = start('def f(x):\n    return x * 2\na = f(5)\nprint(a)'); t.finish(); expect(t.lines()).toEqual([1,3,2,4]); expect(t.output()).toBe('10\n'); });
  it("recursion retains all frames", () => { const t = start('def f(n):\n    if n == 0:\n        return 0\n    return f(n - 1) + n\nprint(f(3))'); t.finish(); expect(t.lines().filter(n => n === 2)).toHaveLength(4); expect(t.output()).toBe('6\n'); });
  it("constructor, bound method and super step into actual bodies", () => { const t = start('class A:\n    def f(self):\n        return 1\nclass B(A):\n    def __init__(self):\n        self.x = 2\n    def f(self):\n        return super().f() + self.x\nb = B()\nmethod = b.f\nprint(method())'); t.finish(); expect(t.lines()).toEqual([1,2,4,5,7,9,6,10,11,8,3]); expect(t.output()).toBe('3\n'); });
  it("module initialization and functions identify the saved source", () => { const t = start('import helper\nprint(helper.f())', 'step', new Map([['helper.py', 'x = 7\ndef f():\n    return x']])); t.finish(); expect(t.events.filter(e => e.type === 'execution' && e.state === 'paused').map(e => e.type === 'execution' && [e.location!.fileName, e.location!.line])).toEqual([['main.py',1],['helper.py',1],['helper.py',2],['main.py',2],['helper.py',3]]); expect(t.output()).toBe('7\n'); });
  it("return and cross-frame raise run finally then the actual handler", () => { const t = start('def f():\n    try:\n        raise ValueError("x")\n    finally:\n        print("finally")\ntry:\n    f()\nexcept ValueError:\n    print("caught")'); t.finish(); expect(t.lines()).toEqual([1,7,3,5,9]); expect(t.output()).toBe('finally\ncaught\n'); });
  it("input cannot be skipped and resumes at the next statement", () => { const t = start('a = input("값: ")\nprint(a)'); t.next(); expect(t.events.at(-1)).toEqual({type:'input',prompt:'값: '}); t.vm.advance(1); expect(t.output()).toBe(''); t.vm.resume('민수'); expect(t.paused().location?.line).toBe(2); t.next(); expect(t.output()).toBe('민수\n'); });
  it("duplicate next ticket cannot execute another step", () => { const t = start('print(1)\nprint(2)\nprint(3)'); const ticket = t.paused().pauseId!; t.vm.advance(ticket); t.vm.advance(ticket); expect(t.lines()).toEqual([1,2]); expect(t.output()).toBe('1\n'); });
  it("flushes turtle commands before the next pause", () => { const t = start('import turtle\nt = turtle.Turtle()\nt.forward(80)\nprint("done")'); t.next(); t.next(); t.next(); const events = t.events; expect(events.some(e => e.type === 'graphics')).toBe(true); expect(events.at(-1)).toMatchObject({type:'execution',state:'paused',location:{line:4}}); });
  it("normal execution has the exact original event order", () => { const t = start('print(1)\nx = input("값: ")\nprint(x)', 'normal'); t.vm.resume('5'); expect(t.events).toEqual([{type:'output',text:'1\n'},{type:'input',prompt:'값: '},{type:'output',text:'5\n'},{type:'complete'}]); });
  it("follow waits before each statement; speed changes cancel the prior timer", () => { vi.useFakeTimers(); const t = start('print(1)\nprint(2)', 'follow'); expect(t.output()).toBe(''); vi.advanceTimersByTime(499); expect(t.output()).toBe(''); t.vm.setSpeed(100); vi.advanceTimersByTime(100); expect(t.output()).toBe('1\n'); t.vm.pause(); vi.advanceTimersByTime(1000); expect(t.output()).toBe('1\n'); t.vm.follow(t.paused().pauseId!); vi.advanceTimersByTime(100); expect(t.output()).toBe('1\n2\n'); });
  it.each(['step','follow'] as const)('%s stop clears waits and timers', mode => { vi.useFakeTimers(); const t = start('print(1)', mode); t.vm.stop(); vi.runAllTimers(); t.vm.advance(1); t.vm.resume('5'); expect(t.events.at(-1)).toEqual({type:'stopped'}); expect(t.output()).toBe(''); });
});

describe("resumable user callbacks", () => {
  it("map enters each body and does not repeat object mutations", () => {
    const t = start('values = []\ndef f(x):\n    values.append(x)\n    return x * 2\nprint(list(map(f, [1, 2])))\nprint(values)');
    t.finish(); expect(t.lines()).toEqual([1,2,5,3,4,3,4,6]); expect(t.output()).toBe('[2, 4]\n[1, 2]\n');
  });
  it("lambda callbacks have a source column and return to the caller", () => {
    const t = start('fn = lambda x: x + 1\nprint(list(map(fn, [1, 2])))'); t.finish();
    const points = t.events.filter(e => e.type === 'execution' && e.state === 'paused').map(e => e.type === 'execution' && [e.location!.line,e.location!.column]);
    expect(points).toEqual([[1,1],[2,1],[1,6],[1,6]]); expect(t.output()).toBe('[2, 3]\n');
  });
  it("sorted key frames step into the callback", () => { const t = start('def key(x):\n    return -x\nprint(sorted([1, 3, 2], key=key))'); t.finish(); expect(t.lines()).toEqual([1,3,2,2,2]); expect(t.output()).toBe('[3, 2, 1]\n'); });
  it("__str__ preserves a suspended partially formatted print", () => { const t = start('class A:\n    def __str__(self):\n        print("inside")\n        return "A"\na = A()\nprint(a, a)'); t.finish(); expect(t.lines()).toEqual([1,2,5,6,3,4,3,4]); expect(t.output()).toBe('inside\ninside\nA A\n'); });
  it("a map exception unwinds the pending builtin instead of resuming it", () => { const t = start('def f(x):\n    try:\n        return 1 / x\n    finally:\n        print("clean")\ntry:\n    print(list(map(f, [0, 1])))\nexcept ZeroDivisionError:\n    print("caught")\nprint("done")'); t.finish(); expect(t.output()).toBe('clean\ncaught\ndone\n'); expect(t.events.at(-1)).toEqual({type:'complete'}); });
  it("a handled callback exception resumes its original builtin", () => { const t = start('def f(x):\n    try:\n        return 1 / x\n    except ZeroDivisionError:\n        return 0\nprint(list(map(f, [0, 1])))'); t.finish(); expect(t.output()).toBe('[0, 1.0]\n'); });
  it("nested lazy iterators preserve yield order", () => { const t = start('def f(x):\n    print(x)\n    return x\nprint(list(enumerate(zip(map(f, [1, 2]), [3, 4]))))'); t.finish(); expect(t.output()).toBe('1\n2\n[(0, (1, 3)), (1, (2, 4))]\n'); });
});

const equivalentPrograms = [
  ['conditions/loops', 'total = 0\nfor n in range(4):\n    if n == 1:\n        continue\n    total += n\nelse:\n    print(total)'],
  ['while/break', 'n = 0\nwhile True:\n    n += 1\n    if n == 3:\n        break\nprint(n)'],
  ['functions/recursion', 'def f(n):\n    return 1 if n < 2 else n * f(n - 1)\nprint(f(5))'],
  ['map side effects', 'out = []\ndef f(x):\n    out.append(x)\n    return x * 2\nprint(list(map(f, [1, 2])))\nprint(out)'],
  ['lazy any', 'def f(x):\n    print(x)\n    return x\nprint(any(map(f, [1, 2])))'],
  ['lazy all', 'def f(x):\n    print(x)\n    return x\nprint(all(map(f, [0, 1])))'],
  ['nested iterators', 'print(list(enumerate(zip(map(lambda x: x + 1, [1, 2]), [3, 4]))))'],
  ['iterable methods', 'a = []\na.extend(map(lambda x: x + 1, [1, 2]))\ns = set()\ns.update(map(int, ["3", "4"]))\nprint(a, sorted(s))'],
  ['dict update callbacks', 'd = {}\nd.update(map(lambda x: (x, x * 2), [1, 2]))\nprint(d)'],
  ['string join callbacks', 'print(",".join(map(str, [1, 2])))'],
  ['augmented list sharing', 'a = [0]; b = a\na += map(lambda x: x + 1, [1, 2])\nprint(a is b, b)'],
  ['unpacking callbacks', 'a, b = map(lambda x: x + 1, [1, 2])\nprint(a, b)'],
  ['spreads', 'def f(a, b):\n    print(a, b)\nf(*map(lambda x: x + 1, [1, 2]))'],
  ['comprehensions', 'print([[x * y for y in range(3)] for x in range(2)])'],
  ['bound methods/super', 'class A:\n    def f(self, x):\n        return x\nclass B(A):\n    def f(self, x):\n        return super().f(x) + 1\nprint(list(map(B().f, [1, 2])))'],
  ['str/format', 'class A:\n    def __str__(self):\n        return "한글"\na = A()\nprint(a, f"{a:>5}")'],
  ['finally return', 'def f():\n    try:\n        return 3\n    finally:\n        print("clean")\nprint(f())'],
  ['finally error', 'def f():\n    try:\n        raise ValueError("x")\n    finally:\n        print("clean")\ntry:\n    f()\nexcept ValueError as e:\n    print(str(e))'],
  ['modules', 'import helper\nprint(helper.double(5))'],
  ['files', 'with open("out.txt", "w") as f:\n    f.write("저장")\nwith open("out.txt") as f:\n    print(f.read())'],
  ['turtle', 'import turtle\nt = turtle.Turtle()\nfor n in range(4):\n    t.forward(20)\n    t.right(90)\nturtle.done()'],
  ['input', 'def f():\n    return int(input("숫자: ")) * 2\nprint(f())'],
  ['documented map input error', 'def f(x):\n    return input("값:")\nprint(list(map(f, [1])))'],
  ['runtime error', 'print(10 / 0)'],
] as const;
describe("three-mode semantic equivalence", () => {
  it.each(equivalentPrograms)('%s', (_, code) => {
    vi.useFakeTimers();
    const results = (['normal', 'follow', 'step'] as const).map(mode => {
      const files = new Map([['helper.py', 'def double(x):\n    return x * 2']]);
      const t = start(code, mode, files); t.finish();
      if (t.events.at(-1)?.type === 'input') { t.vm.resume('5'); t.finish(); }
      return { output: t.output(), files: [...files], error: t.events.filter(e => e.type === 'error'), terminal: t.events.at(-1), graphics: t.events.flatMap(e => e.type === 'graphics' ? e.commands : []) };
    });
    expect(results[1]).toEqual(results[0]); expect(results[2]).toEqual(results[0]);
  });
});
