import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer } from "vite";

// CPython is a development oracle only; it is never bundled or used by the app.
const python = process.env.CORE_V2_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const probe = spawnSync(python, ["--version"], { encoding: "utf8", timeout: 5000 });
if (probe.status !== 0) throw new Error("CPython을 찾을 수 없습니다. CORE_V2_PYTHON을 지정하세요.");
const server = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
const results = [];
try {
  const { compile } = await server.ssrLoadModule("/src/compiler/compiler.ts");
  const { VM } = await server.ssrLoadModule("/src/runtime/vm.ts");
  const cases = [
    ["for else", 'for n in range(3):\n    print(n)\nelse:\n    print("끝")'],
    ["empty for", 'for n in []:\n    print(n)\nelse:\n    print("끝")'],
    ["break else", 'for n in range(3):\n    break\nelse:\n    print("실패")'],
    ["while else", 'n = 3\nwhile n:\n    n -= 1\nelse:\n    print(n)'],
    ["nested prime loop", 'for n in range(2, 10):\n    for d in range(2, n):\n        if n % d == 0:\n            break\n    else:\n        print(n)'],
    ["conditional", 'print(1 if False else 2 if True else 3)\nprint("ok" if True else missing)'],
    ["comprehension conditional", 'print([x if x else 9 for x in range(4) if x < 3 if x != 1])'],
    ["identity reference", 'a = [1]\nb = a\nc = [1]\nprint(a is b, a is c, a == c, a is not c)'],
    ["nested augmented store", 'a = [[1]]\na[0][0] += 5\nprint(a)'],
    ["augmented evaluation order", 'a = [10]\ndef rhs():\n    a[0] = 100\n    return 2\na[0] += rhs()\nprint(a)'],
    ["factorial", 'def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\nprint(factorial(5))'],
    ["finally return", 'def f():\n    try:\n        return 1\n    finally:\n        print("정리")\nprint(f())'],
    ["finally override", 'def f():\n    try:\n        return 1\n    finally:\n        return 2\nprint(f())'],
    ["finally continue", 'for n in range(3):\n    try:\n        continue\n    finally:\n        print(n)'],
    ["finally exception", 'try:\n    raise ValueError("x")\nfinally:\n    print("정리")', "ValueError"],
    ["finally replace exception", 'try:\n    raise ValueError("x")\nfinally:\n    raise TypeError("y")', "TypeError"],
    ["bare raise error", 'raise', "RuntimeError"],
    ["set operations", 'print(({1, 2} | {2, 3}) == {1, 2, 3})\nprint(({1, 2} ^ {2, 3}) == {1, 3})'],
    ["dict comprehension", 'print({x % 2: x for x in range(4)})'],
    ["slice extremes", 'a = [0, 1, 2, 3, 4]\nprint(a[100::-1], a[:-100:-1], a[::2])'],
    ["variadic defaults", 'def f(a, b=10, *args, **kwargs):\n    print(a, b, args, kwargs)\nf(1, 2, 3, x=4)'],
    ["lambda map", 'print(list(map(lambda x: x * 2, [1, 2, 3])))'],
    ["lexical closure", 'def factory(amount):\n    def add(value):\n        return value + amount\n    return add\nf = factory(10)\namount = 99\nprint(f(2), factory(20)(2))'],
    ["nonlocal counter", 'def factory():\n    count = 0\n    def add():\n        nonlocal count\n        count += 1\n        return count\n    return add\nf = factory()\nprint(f(), f(), factory()())'],
    ["starred assignment", 'a, *middle, z = [1, 2, 3, 4]\nprint(a, middle, z)\n(*rest,) = [1, 2]\nprint(rest)'],
    ["collection expansion", 'a = [1, 2]\nprint([0, *a, 3], (*a, 3), {**{"x": 1}, **{"x": 2}})'],
    ["duplicate keyword expansion", 'def f(**kwargs):\n    pass\nf(**{"x": 1}, **{"x": 2})', "TypeError"],
    ["round ties", 'print(round(2.5), round(3.5), round(1.25, 1), round(2.675, 2), round(1250, -2))'],
    ["power and divmod", 'print(pow(2, 10, 17), pow(3, -1, 11), pow(2, 3, -5), divmod(-7, 3))'],
    ["unicode and radix", 'print(chr(128512), ord("😀"), bin(-10), oct(-10), hex(-255))'],
    ["sorting", 'a = [("a", 2), ("b", 1), ("c", 2)]\na.sort(key=lambda x: x[1], reverse=True)\nprint(a)'],
    ["sort key once", 'log = []\ndef key(x):\n    log.append(x)\n    return -x\nprint(sorted([1, 3, 2], key=key))\nprint(log)'],
    ["iterator consumption", 'it = enumerate(zip([1, 2], [3]), start=1)\nprint(list(it), list(it), list(reversed("가나")))'],
    ["any all", 'print(any([0, 1]), all([1, 2]), any([]), all([]))'],
    ["string indices", 'print("가😀나".find("나"), "banana".rfind("an"), "abc".count(""))'],
    ["string splitting", 'print(" a b  ".split(None, 0), " a b  ".rsplit(None, 0), "a,b,c".rsplit(",", 1))'],
    ["string padding", 'print("ab".center(5, "-"), "가".center(4, "-"), "-12".zfill(5))'],
    ["string replacement", 'print("😀가".replace("", "-", 2), "aaaa".replace("a", "b", 2))'],
    ["string strip and predicates", 'print("xy가xy".strip("xy"), "한글".isalpha(), "한글2".isalnum(), "²１２".isdigit())'],
    ["list methods", 'a = [1]\na.extend(a)\na.insert(-100, 0)\na.reverse()\nprint(a, a.index(1), a.count(1), a.pop())'],
    ["dictionary methods", 'd = {"a": 1}\nd.update({"b": 2}, a=3)\nprint(d, d.popitem(), d.get("x", 9))'],
    ["fromkeys reference", 'd = dict.fromkeys(["a", "b"], [])\nd["a"].append(1)\nprint(d)'],
    ["inheritance super", 'class A:\n    def f(self):\n        return "A"\nclass B(A):\n    def f(self):\n        return super().f() + "B"\nprint(B().f(), isinstance(B(), A), issubclass(B, A))'],
    ["inherited init", 'class A:\n    def __init__(self, x=3):\n        self.x = x\nclass B(A):\n    pass\nprint(B().x, B(x=5).x)'],
    ["float representation", 'print(1.0, -0.0, 0.1 + 0.2, float("inf"), float("-inf"), float("nan"))\nprint(1e-7, 1e16, 1e15, [2.0])'],
    ["float arithmetic", 'print(1 + 2.0, 4.0 // 2, 5.0 % 2, sum([1, 2.0]), round(2.5, 0))'],
    ["math", 'import math\nprint(math.sqrt(81), math.factorial(5), round(math.pi, 2), math.gcd(12, 18))\nprint(math.log(8, 2), math.isinf(math.inf), math.isnan(math.nan))'],
    ["saved module globals", 'import helper\nprint(helper.add(3, 4), helper.__name__, __name__)', undefined, { "helper.py": 'def add(a, b):\n    return a + b' }],
    ["saved module init cache", 'import helper\nimport helper as second\nprint(helper is second)', undefined, { "helper.py": 'print("초기화")' }],
    ["saved module exception", 'import helper\nhelper.fail()', "ValueError", { "helper.py": 'def fail():\n    raise ValueError("오류")' }],
    ["map caught callback error", 'def f(x):\n    try:\n        raise ValueError("x")\n    except ValueError:\n        return x\nprint(list(map(f, [1, 2])))'],
    ["map sorted", 'print(list(map(sorted, [[2, 1], [4, 3]])))'],
  ];
  for (const [name, source, errorType, modules] of cases) {
    let referenceSource = source;
    if (modules) { const directory = resolve("artifacts/core-v2-cpython", String(results.length)); await mkdir(directory, { recursive: true }); for (const [file, content] of Object.entries(modules)) { assert.match(file, /^\w+\.py$/); await writeFile(join(directory, file), content); } referenceSource = `import sys\nsys.path.insert(0, ${JSON.stringify(directory)})\n${source}`; }
    const reference = spawnSync(python, ["-I", "-X", "utf8", "-c", referenceSource], { encoding: "utf8", timeout: 5000 });
    if (errorType) { assert.equal(reference.status, 1, name); assert.match(reference.stderr, new RegExp(`\\b${errorType}(?::|\\s|$)`), name); }
    else assert.equal(reference.status, 0, `${name}: ${reference.stderr}`);
    const events = []; new VM(compile(source), event => events.push(event), new Map(Object.entries(modules ?? {}))).execute();
    if (errorType) { assert.equal(events.at(-1)?.type, "error", name); assert.equal(events.at(-1)?.error.pythonType, errorType, name); }
    else assert.equal(events.at(-1)?.type, "complete", name);
    const actual = events.filter(event => event.type === "output").map(event => event.text).join("");
    const expected = reference.stdout.replaceAll("\r\n", "\n");
    assert.equal(actual, expected, name);
    results.push({ name, matched: true, output: actual });
  }
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/python-core-v2-differential.json", JSON.stringify({ python: probe.stdout.trim(), results }, null, 2));
  console.log(`${probe.stdout.trim()}: ${results.length} differential cases passed`);
} finally { await server.close(); }
