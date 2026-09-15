import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { cases } from './cases/index.mjs';
import { runCPython, python } from './run-cpython.mjs';
import { createLearningRunner } from './run-learning-vm.mjs';
await mkdir('artifacts', { recursive: true });
const runner=await createLearningRunner(), results=[];
const baselinePath='artifacts/python-compatibility-audit-v2-before-fixes.json';
try { await writeFile(baselinePath, await readFile('artifacts/python-compatibility-audit-v2.json'), {flag:'wx'}); }
catch(error) { if(error.code!=='EEXIST')throw error; }
const baseline=JSON.parse(await readFile(baselinePath,'utf8'));
if(baseline.total!==cases.length || cases.some(c=>!baseline.results.some(r=>r.id===c.id&&r.code===c.code&&JSON.stringify(r.input)===JSON.stringify(c.input)&&JSON.stringify(r.files)===JSON.stringify(c.files))))throw Error('Original audit cases changed');
const prior=process.argv.includes('--reuse')?JSON.parse(await readFile('artifacts/python-compatibility-audit-v2.json','utf8')):null;
if(prior&&prior.environment.commit!==execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim())throw Error('Cannot reuse a different commit');
const equality=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function numericComparison(a,b) {
  const convert = text => { const s=text.trim(); if(!/^[+-]?(?:inf|nan|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i.test(s))return undefined; return /^[-+]?inf$/i.test(s)?s[0]==='-'?-Infinity:Infinity:Number(s); };
  const x=convert(a),y=convert(b); if(x===undefined||y===undefined)return null;
  const finite=Number.isFinite(x)&&Number.isFinite(y), abs=finite?Math.abs(x-y):null, rel=finite?abs/Math.max(Math.abs(x),Math.abs(y),Number.MIN_VALUE):null;
  return { exactText:a===b, absoluteError:abs, relativeError:rel, withinTolerance:finite?abs<=1e-12+1e-12*Math.max(Math.abs(x),Math.abs(y)):Object.is(x,y)||Number.isNaN(x)&&Number.isNaN(y), tolerance:'abs 1e-12 + rel 1e-12; this does not imply repr or integer equality' };
}
try {
  for(const c of cases) {
    const cached=prior?.results.find(r=>r.id===c.id&&r.code===c.code&&equality(r.input,c.input)&&equality(r.files,c.files));
    const cp=cached?.cpython??runCPython(c), vm=runner.run(c), differences=[];
    if(!cp.skipped) {
      if(cp.stdout!==vm.stdout)differences.push('stdout'); if(cp.errorType!==vm.errorType)differences.push('errorType');
      if(cp.completion!==vm.completion)differences.push('completion');
      if(cp.errorType&&vm.errorType&&(cp.file!==vm.file||cp.line!==vm.line))differences.push('errorLocation');
      if(!equality(Object.entries(cp.files??{}).sort(),Object.entries(vm.files??{}).sort()))differences.push('files');
    }
    const numeric=numericComparison(cp.stdout,vm.stdout); let classification;
    if(cp.completion==='harness-error') classification='audit-error';
    else if(cp.skipped||c.category==='safety') classification=c.policy??'intentional-difference';
    else if(c.policy==='unsupported') classification='unsupported';
    else if(!differences.length) classification=cp.errorType&&cp.message!==vm.message?'educational-compatible':'exact';
    else if(c.policy) classification=c.policy;
    else if(c.semantic==='set'&&cp.stdout.trim().slice(1,-1).split(', ').sort().join()===vm.stdout.trim().slice(1,-1).split(', ').sort().join())classification='educational-compatible';
    else classification='interpreter-defect';
    results.push({...c,cpython:cp,learningVm:vm,classification,differences,numeric,columnsEqual:cp.column===vm.column,unsupportedSilentlyRuns:c.policy==='unsupported'&&vm.completion==='complete'});
    if(results.length%40===0)console.log(`Measured ${results.length}/${cases.length}`);
  }
} finally {await runner.close();}
const env={time:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),version:JSON.parse(await readFile('package.json','utf8')).version,python,cpython:results.find(x=>x.cpython.environment)?.cpython.environment,node:process.version,os:`${os.type()} ${os.release()} ${os.arch()}`,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,unicodeJS:process.versions.unicode};
const counts={},categories={};for(const r of results){counts[r.classification]=(counts[r.classification]??0)+1;categories[r.category]??={total:0};categories[r.category].total++;categories[r.category][r.classification]=(categories[r.category][r.classification]??0)+1;}
const transitions=results.map(r=>({id:r.id,before:baseline.results.find(b=>b.id===r.id).classification,after:r.classification}));
const report={environment:env,total:results.length,comparisonDenominator:results.filter(r=>!r.cpython.skipped).length,vmOnly:results.filter(r=>r.cpython.skipped).length,counts,categories,results,beforeCounts:baseline.counts,transitions};
await writeFile('artifacts/python-compatibility-audit-v2.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({total:report.total,counts,categories},null,2));
