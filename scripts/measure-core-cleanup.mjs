import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createServer } from "vite";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

// Development-only, paired baseline/current measurements. No production hooks.
const roots = [process.env.CORE_BASELINE ?? "artifacts/code-cleanup-stage3/baseline", "."];
const output = process.env.CORE_PERFORMANCE_OUTPUT ?? "artifacts/code-cleanup-stage3/performance.json";
const cases = [
  ["loop-10000", "x = 0\nfor n in range(10000):\n    x += 1"],
  ["function-calls", "def f(x):\n    return x + 1\nfor n in range(1500):\n    f(n)"],
  ["recursion", "def f(n):\n    if n < 1:\n        return 0\n    return f(n - 1) + 1\nfor n in range(30):\n    f(40)"],
  ["list-dict", "a = []; d = {}\nfor n in range(1000):\n    a.append(n)\n    d[n] = a[-1]"],
  ["sorting", "for n in range(80):\n    sorted(range(100, 0, -1))"],
  ["module-first-import", "import helper\nprint(helper.value)"],
  ["module-cached-import", "import helper\nfor n in range(1000):\n    import helper as again"],
  ["exceptions", "for n in range(1000):\n    try:\n        1 / 0\n    except ZeroDivisionError:\n        pass"],
];
const servers = [];
try {
  const runtimes = [];
  for (const root of roots) {
    if (process.env.CORE_BUNDLE === "1") {
      const outfile = path.resolve(path.dirname(output), "performance-bundles", `runtime-${runtimes.length}.mjs`);
      await build({ stdin: { contents: 'export { compile } from "./src/compiler/compiler.ts"; export { VM } from "./src/runtime/vm.ts";', resolveDir: path.resolve(root) }, bundle: true, format: "esm", platform: "node", outfile, logLevel: "silent" });
      runtimes.push(await import(pathToFileURL(outfile).href));
      continue;
    }
    const server = await createServer({ root: path.resolve(root), configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
    servers.push(server);
    const { compile } = await server.ssrLoadModule("/src/compiler/compiler.ts");
    const { VM } = await server.ssrLoadModule("/src/runtime/vm.ts");
    runtimes.push({ compile, VM });
  }
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const report = { node: process.version, platform: process.platform, mode: process.env.CORE_BUNDLE === "1" ? "bundled" : "vite-ssr", warmups: 5, rounds: 15, gc: !!global.gc, results: [] };
  for (const [name, source] of [...cases, ["compiler", cases.map(([, source]) => source).join("\n")]]) {
    const codes = runtimes.map(runtime => runtime.compile(source));
    const actions = runtimes.map((runtime, index) => name === "compiler"
      ? () => { for (let count = 0; count < 30; count++) runtime.compile(source); }
      : () => { for (let count = 0; count < (name === "module-first-import" ? 100 : 3); count++) {
        const events = [];
        new runtime.VM(codes[index], event => events.push(event), new Map([["helper.py", "value = 7"]])).execute();
        if (name === "loop-10000") {
          // Existing guard counts the final loop check too; preserve this limit.
          assert.equal(events.at(-1)?.type, "error");
          assert.equal(events.at(-1)?.error.message, "실행을 중지했습니다. 반복문이 끝나는 조건을 확인해 주세요.");
        } else assert.equal(events.at(-1)?.type, "complete", JSON.stringify(events.at(-1)));
      } });
    for (let round = 0; round < report.warmups; round++) for (const action of actions) action();
    const samples = [[], []], retained = [[], []];
    for (let round = 0; round < report.rounds; round++) {
      for (const index of round % 2 ? [1, 0] : [0, 1]) {
        global.gc?.(); const before = process.memoryUsage().heapUsed;
        const start = performance.now(); actions[index](); samples[index].push(performance.now() - start);
        global.gc?.(); retained[index].push(process.memoryUsage().heapUsed - before);
      }
    }
    const before = median(samples[0]), after = median(samples[1]);
    report.results.push({ name, beforeMs: before, afterMs: after, changePercent: (after / before - 1) * 100, samples, retainedHeapMedian: retained.map(median) });
  }
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.results.map(({ samples, ...result }) => result), null, 2));
} finally { for (const server of servers) await server.close(); }
