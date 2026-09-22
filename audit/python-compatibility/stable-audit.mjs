import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { cases as originalCases } from './cases/index.mjs';
import { runCPython, python, warmupCPython } from './run-cpython.mjs';
import { createLearningRunner } from './run-learning-vm.mjs';
import { auditCase, compareCase, equal, reproducibleReport, resultHash } from './comparison.mjs';

export async function runAudit({ runs = 1, directory = 'artifacts/python-compatibility-stable', baselineRoot } = {}) {
  assert.ok(Number.isInteger(runs) && runs >= 1 && runs <= 10);
  await mkdir(directory, { recursive: true });
  const original = JSON.parse(await readFile('artifacts/python-compatibility-audit-v2-before-fixes.json', 'utf8'));
  assert.equal(original.total, 714); assert.equal(originalCases.length, 714);
  for (const c of originalCases) {
    const old = original.results.find(r => r.id === c.id); assert.ok(old, c.id);
    for (const key of ['code','input','files']) assert.ok(equal(c[key], old[key]), `${c.id}:${key}`);
  }
  const cases = originalCases.map(auditCase), warmup = warmupCPython(), summaries = [];
  let prior, baseline;
  if (baselineRoot) {
    const runner = await createLearningRunner({ root: path.resolve(baselineRoot) });
    try { baseline = cases.map(c => ({ id: c.id, result: runner.run(c) })); }
    finally { await runner.close(); }
    await writeFile(path.join(directory, 'baseline-vm.json'), JSON.stringify(baseline, null, 2));
  }
  const runner = await createLearningRunner();
  try {
    for (let run = 1; run <= runs; run++) {
      const results = [];
      for (const c of cases) {
        const cp = await runCPython(c), vm = runner.run(c);
        if (baseline) assert.ok(equal(vm, baseline.find(x => x.id === c.id).result), `baseline VM changed: ${c.id}`);
        results.push({ ...c, cpython: cp, learningVm: vm, ...compareCase(c, cp, vm) });
        if (results.length % 100 === 0) console.log(`Run ${run}/${runs}: ${results.length}/714`);
      }
      const counts = { exact:0, 'educational-compatible':0, 'intentional-difference':0, 'interpreter-defect':0, unsupported:0, 'audit-error':0 }, categories = {};
      for (const r of results) { counts[r.classification]++; categories[r.category] ??= { total:0 }; categories[r.category].total++; categories[r.category][r.classification] = (categories[r.category][r.classification] ?? 0) + 1; }
      const report = { environment: { time: new Date().toISOString(), commit: execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(), python, version: JSON.parse(await readFile('package.json','utf8')).version, node:process.version, os:`${os.type()} ${os.release()}`, timezone:Intl.DateTimeFormat().resolvedOptions().timeZone, warmup }, total:714, comparisonDenominator:711, vmOnly:3, counts, categories, results };
      const normalized = reproducibleReport(report), hash = resultHash(report);
      await writeFile(path.join(directory, `run-${run}.json`), JSON.stringify(report, null, 2), {flag:'wx'});
      await writeFile(path.join(directory, `run-${run}-normalized.json`), JSON.stringify(normalized), {flag:'wx'});
      const summary = { run, hash, counts, total:714, baselineVmEqual:baseline?.length ?? null }; summaries.push(summary);
      await writeFile(path.join(directory,'summary.json'),JSON.stringify(summaries,null,2));
      console.log(JSON.stringify(summary));
      assert.equal(counts['audit-error'],0,'Audit infrastructure failure (raw report preserved)');
      assert.equal(counts['interpreter-defect'],0,'Unexpected interpreter difference');
      if (prior) assert.deepEqual(normalized, prior, 'Non-reproducible normalized result');
      prior = normalized;
    }
  } finally { await runner.close(); }
  return summaries;
}
