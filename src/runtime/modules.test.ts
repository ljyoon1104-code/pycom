import { describe, expect, it } from "vitest";
import { compile } from "../compiler/compiler";
import { VM, type VMEvent } from "./vm";
import type { ModuleOptions } from "./modules";

function run(code: string, options: ModuleOptions = {}) {
  const events: VMEvent[] = [];
  new VM(compile(code), event => events.push(event), new Map(), options).execute();
  return { events, output: events.filter(e => e.type === "output").map(e => e.text).join(""), error: events.find(e => e.type === "error") };
}
function output(code: string, expected: string, options?: ModuleOptions) {
  const result = run(code, options);
  expect(result.error).toBeUndefined();
  expect(result.events.at(-1)?.type).toBe("complete");
  expect(result.output).toBe(expected);
}

describe("limited built-in imports", () => {
  it.each([
    ['import random\nprint(random.randint(1, 1))', '1\n'],
    ['import random as rnd\nprint(rnd.randint(2, 2))', '2\n'],
    ['import datetime\nprint(datetime.date(2008, 5, 10))', '2008-05-10\n'],
    ['from datetime import date\nprint(date(1, 1, 1))', '0001-01-01\n'],
    ['from datetime import date as Date\nprint(Date(9999, 12, 31))', '9999-12-31\n'],
  ])("loads through normal names: %s", (code, expected) => output(code, expected));
  it("exposes callable values and preserves module identity across imports", () => output('import random\nimport random as other\npick = random.randint\nprint(random == other)\nprint(pick(4, 4))', 'True\n4\n'));
  it("binds imports locally inside functions", () => output('def choose():\n    import random as rnd\n    return rnd.randint(3, 3)\nprint(choose())\ntry:\n    print(rnd)\nexcept NameError:\n    print("지역 이름")', '3\n지역 이름\n'));
  it("reports unsupported imports at the original line", () => {
    const result = run('\nimport os');
    expect(result.error).toMatchObject({ error: { line: 2, column: 1, message: "'os' 모듈은 현재 버전에서 지원하지 않습니다." } });
  });
});

describe("random", () => {
  it("replays all APIs with the same seed and call order", () => {
    const calls = 'print(random.randint(-10, 10))\nprint(random.randrange(100))\nprint(random.choice("가나다"))\nprint(random.sample(range(100), 8))';
    const one = run('import random\nrandom.seed(1234)\n' + calls).output;
    output('import random\nrandom.seed(1234)\n' + calls + '\nrandom.seed(1234)\n' + calls, one + one);
  });
  it("keeps random state independent between interleaved VMs", () => {
    const code = compile('import random\nrandom.seed(71)\nprint(random.randint(1, 10000))\ninput()\nprint(random.randint(1, 10000))');
    const logs: string[][] = [[], []];
    const vms = logs.map(log => new VM(code, e => { if (e.type === "output") log.push(e.text); }));
    vms[0].execute(); vms[1].execute(); vms[1].resume(""); vms[0].resume("");
    expect(logs[0]).toEqual(logs[1]);
    expect(logs[0]).toHaveLength(2);
  });
  it("uses supplied entropy for unseeded runs and seed(None)", () => {
    const code = 'import random\nrandom.seed()\nprint(random.sample(range(100000), 10))';
    expect(run(code, { entropy: () => 1 }).output).not.toBe(run(code, { entropy: () => 2 }).output);
    expect(run(code, { entropy: () => 5 }).output).toBe(run(code.replace('seed()', 'seed(None)'), { entropy: () => 5 }).output);
  });
  it("includes both randint endpoints", () => output('import random\nrandom.seed(8)\na = [random.randint(-1, 1) for x in range(100)]\nprint(min(a), max(a))\nprint(random.randint(5, 5))', '-1 1\n5\n'));
  it.each(['random.randrange(5)', 'random.randrange(0, 5)', 'random.randrange(0, 5, 2)', 'random.randrange(5, -1, -2)'])("uses range membership: %s", call => {
    const result = run('import random\nrandom.seed(8)\nprint([' + call + ' for x in range(100)])');
    expect(result.error).toBeUndefined();
    const values = JSON.parse(result.output) as number[];
    const allowed = call.includes('-2') ? [5, 3, 1] : call.includes(', 2)') ? [0, 2, 4] : [0, 1, 2, 3, 4];
    expect(values.every(value => allowed.includes(value))).toBe(true);
    expect(new Set(values).size).toBe(allowed.length);
  });
  it.each(['["민수"]', '("민수",)', '"민"', 'range(7, 8)'])("chooses from %s", population => {
    const expected = population === '"민"' ? '민\n' : population.startsWith('range') ? '7\n' : '민수\n';
    output('import random\nprint(random.choice(' + population + '))', expected);
  });
  it("samples unique indices into a new list without changing the source", () => {
    const result = run('import random\nrandom.seed(42)\noriginal = [1, 2, 3, 4, 5]\nresult = random.sample(original, 5)\nprint(result)\nprint(original)\nresult.append(6)\nprint(original)');
    expect(result.error).toBeUndefined();
    const lines = result.output.trim().split('\n');
    expect(new Set(JSON.parse(lines[0])).size).toBe(5);
    expect(lines.slice(1)).toEqual(['[1, 2, 3, 4, 5]', '[1, 2, 3, 4, 5]']);
  });
  it("supports empty samples and large lazy range populations", () => output('import random\nprint(random.sample([], 0))\nprint(len(random.sample(range(1000000000), 3)))', '[]\n3\n'));
  it("binds keyword module and date calls instead of discarding arguments", () => output('import random\nfrom datetime import date\nprint(random.randint(a=4, b=4))\nprint(date(day=29, year=2024, month=2))', '4\n2024-02-29\n'));
});

describe("datetime.date", () => {
  it("uses the injected local calendar clock without changing system time", () => output('from datetime import date\ntoday = date.today()\nprint(today)\nprint(today.year, today.month, today.day)', '2032-02-29\n2032 2 29\n', { clock: () => new Date(2032, 1, 29, 23, 59) }));
  it("formats constructor, str and f-string results", () => output('from datetime import date\nd = date(2008, 5, 10)\nprint(d)\nprint(str(d))\nprint(f"{d}")', '2008-05-10\n2008-05-10\n2008-05-10\n'));
  it("compares date contents using all six operators", () => output('from datetime import date\na = date(2000, 1, 1)\nb = date(2000, 1, 1)\nc = date(2000, 1, 2)\nprint(a == b, a != c, a < c, a <= b, c > a, b >= a)\nprint(a == "2000-01-01")', 'True True True True True True\nFalse\n'));
  it.each([2000, 2024, 2400])("accepts leap year %s", year => output('from datetime import date\nprint(date(' + year + ', 2, 29))', year + '-02-29\n'));
  it("works through class methods using the production call path", () => output('from datetime import date\nclass Book:\n    def __init__(self, year):\n        self.year = year\n    def age(self):\n        return date.today().year - self.year\nbook = Book(1919)\nprint(book.age())', '107\n', { clock: () => new Date(2026, 8, 11) }));
});

const failures = [
  ['import os', 'ImportError'], ['import sys', 'ImportError'], ['import random.internal', 'ImportError'],
  ['from datetime import datetime', 'ImportError'], ['from random import randint', 'ImportError'], ['from datetime import *', 'ImportError'],
  ['random.unknown()', 'AttributeError'], ['random.seed = 5', 'AttributeError'], ['date.today = 5', 'AttributeError'],
  ['date(2024, 1, 1).unknown', 'AttributeError'], ['random.randint(1)', 'TypeError'], ['random.randint(1, 2, 3)', 'TypeError'],
  ['random.randint("1", 2)', 'TypeError'], ['random.randint(5, 4)', 'ValueError'], ['random.randint(1, a=2, b=3)', 'TypeError'],
  ['random.randrange(0)', 'ValueError'], ['random.randrange(1, 1)', 'ValueError'], ['random.randrange(1, 2, 0)', 'ValueError'],
  ['random.randrange(1, 2, -1)', 'ValueError'], ['random.randrange(1.5)', 'TypeError'], ['random.randrange()', 'TypeError'],
  ['random.choice([])', 'IndexError'], ['random.choice("")', 'IndexError'], ['random.choice(10)', 'TypeError'],
  ['random.sample([1], 2)', 'ValueError'], ['random.sample([1], -1)', 'ValueError'], ['random.sample(5, 1)', 'TypeError'],
  ['random.sample([1], 0.5)', 'TypeError'], ['random.sample([1], 1, 2)', 'TypeError'], ['random.seed([])', 'TypeError'],
  ['date(2023, 2, 29)', 'ValueError'], ['date(1900, 2, 29)', 'ValueError'], ['date(2024, 13, 1)', 'ValueError'],
  ['date(2024, 4, 31)', 'ValueError'], ['date(0, 1, 1)', 'ValueError'], ['date(10000, 1, 1)', 'ValueError'],
  ['date(2024, 1, 0)', 'ValueError'], ['date(2024, 1)', 'TypeError'], ['date("2024", 1, 1)', 'TypeError'],
  ['date(2024, 1, 1, 1)', 'TypeError'], ['date.today(1)', 'TypeError'], ['date(2024, 1, 1, year=2024)', 'TypeError'],
  ['date(2024, 1, 1, unknown=3)', 'TypeError'],
];
describe("Korean, catchable module errors", () => {
  it.each(failures)("%s raises %s at its call line", (statement, pythonType) => {
    const prefix = 'import random\nfrom datetime import date\n';
    const result = run(prefix + statement);
    expect(result.error).toMatchObject({ error: { line: 3 } });
    expect(result.error?.error.message).toMatch(/[가-힣]/);
    expect(result.error?.error.message).not.toMatch(/TypeError:|ReferenceError:|at VM|\.ts:\d|stack/i);
    output(prefix + 'try:\n    ' + statement + '\nexcept ' + pythonType + ':\n    print("처리됨")', '처리됨\n');
  });
  it("disallows mutation of date fields", () => output('from datetime import date\nd = date(2024, 1, 1)\ntry:\n    d.year = 2000\nexcept AttributeError:\n    print(d.year)', '2024\n'));
  it("rejects mixed date ordering", () => output('from datetime import date\ntry:\n    print(date(2024, 1, 1) < 5)\nexcept TypeError:\n    print("처리됨")', '처리됨\n'));
});

it("sums boolean comparisons used by the textbook baseball game", () => output('print(sum([True, False, True]))\nprint(sum([True], True))', '2\n2\n'));
it("preserves keyword arguments in existing class method calls", () => output('class C:\n    def value(self, x=1):\n        return x\nprint(C().value(x=8))', '8\n'));
it("keeps the original line for module errors inside f-strings", () => {
  expect(run('from datetime import date\n\nprint(f"{date(2023, 2, 29)}")').error).toMatchObject({ error: { line: 3 } });
});
