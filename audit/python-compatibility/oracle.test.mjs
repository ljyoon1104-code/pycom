import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createOracle,processAlive} from './oracle-process.mjs';
import {normalized,auditCase} from './comparison.mjs';
const base=fs.mkdtempSync(path.resolve('artifacts/audit-unit-'));
const oracle=createOracle({workRoot:base});
const run=(code,extra={})=>oracle.run({id:'test',code,files:[],...extra});
after(()=>{assert.deepEqual(fs.readdirSync(base),[]);fs.rmdirSync(base);});
test('CPython version and actual hash/UTF8 flags are pinned',()=>{const info=oracle.initialize();assert.equal(info.version,'3.12.14');assert.equal(info.hashRandomization,0);assert.equal(info.ignoreEnvironment,0);assert.equal(info.utf8,1);});
test('normal completion and empty output',async()=>{const r=await run('x = 10');assert.equal(r.completion,'complete');assert.equal(r.stdout,'');assert.equal(r.execution.processTerminated,true);assert.equal(r.execution.cleaned,true);});
test('student exception is not an audit error and keeps its line',async()=>{const r=await run('x = 1\nraise ValueError("문제")');assert.equal(r.completion,'error');assert.equal(r.errorType,'ValueError');assert.equal(r.line,2);assert.equal(r.message,'문제');});
test('Unicode stdout and input round trip',async()=>{const r=await run('name = input("이름: ")\nprint(name)',{input:['민수😀']});assert.equal(r.stdout,'이름: 민수😀\n');});
test('CRLF output is preserved rather than globally stripped',async()=>{const r=await run('print("a\\r\\nb", end="")');assert.equal(r.stdout,'a\r\nb');});
test('stdout and stderr are fully consumed together',async()=>{const r=await run('import sys\nfor n in range(1000):\n    print("out")\n    print("err", file=sys.stderr)');assert.equal(r.stdout,'out\n'.repeat(1000));assert.equal(r.stderr,'err\n'.repeat(1000));});
test('raw stderr pipe is consumed as well as redirected stderr',async()=>{const r=await run('import os\nos.write(2, b"pipe-error")\nprint("done")');assert.equal(r.stdout,'done\n');assert.equal(r.stderr,'pipe-error');});
test('large output is bounded without a successful comparison',async()=>{const r=await run('print("x" * 2100000)');assert.equal(r.completion,'harness-error');assert.equal(r.message,'captured-output-limit');assert.ok(r.stdout.length<=2000000);assert.equal(r.execution.cleaned,true);});
test('file creation has separate timings and leaves no stale files',async()=>{
 const r=await run('for n in range(101):\n    with open(f"f{n}.txt", "w") as f:\n        f.write("x")');
 assert.equal(r.completion,'complete');assert.equal(Object.keys(r.files).length,101);assert.ok(r.timings.executionMs>=0);assert.ok(r.timings.fileWriteMs>=0);assert.ok(r.timings.collectionMs>=0);assert.ok(r.timings.cleanupMs>=0);assert.equal(fs.existsSync(r.execution.directory),false);
 const next=await run('pass');assert.deepEqual(next.files,{});assert.notEqual(next.execution.directory,r.execution.directory);
});
test('fixture preparation failure is infrastructure failure and is cleaned',async()=>{const r=await run('pass',{files:[{name:'../bad.txt',content:'x'}]});assert.equal(r.completion,'harness-error');assert.equal(r.execution.cleaned,true);});
test('result collection failures are distinct from student errors',async()=>{const r=await run('with open("large.txt", "w") as f:\n    f.write("x" * 2000001)');assert.equal(r.completion,'harness-error');assert.equal(r.message,'file-result-limit');});
test('malformed stdout protocol is an audit parsing error',async()=>{const r=await run('import os\nos.write(1, b"not-json\\n")');assert.equal(r.completion,'harness-error');assert.match(r.message,/protocol-json/);assert.equal(r.execution.cleaned,true);});
test('unexpected process exit is not reported as a student exception',async()=>{const r=await run('import os\nos._exit(3)');assert.equal(r.completion,'harness-error');assert.equal(r.execution.exitCode,3);assert.match(r.message,/process-exit/);});
test('timeout kills the process tree before cleanup',async()=>{
 const timed=createOracle({workRoot:base,limits:{execute:1500,fileExecute:1500}});
 const promise=timed.run({code:'import subprocess, sys, time\np = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])\nwith open("child.pid", "w") as f:\n    f.write(str(p.pid))\nwhile True:\n    time.sleep(1)',files:[]});
 let pid;const deadline=Date.now()+10000;
 while(!pid&&Date.now()<deadline){for(const d of fs.readdirSync(base)){const f=path.join(base,d,'child.pid');if(fs.existsSync(f))pid=Number(fs.readFileSync(f,'utf8'));}if(!pid)await new Promise(r=>setTimeout(r,20));}
 const r=await promise;assert.ok(pid);assert.equal(r.completion,'harness-error');assert.match(r.message,/timeout:execute/);assert.equal(processAlive(pid),false);assert.equal(r.execution.processTerminated,true);assert.equal(r.execution.cleaned,true);
});
test('same case twice has identical normalized results',async()=>{
 const c=auditCase({id:'collection-set-order',code:'print({"가", "나", "다"})',files:[]});
 assert.deepEqual(normalized(c,await oracle.run(c)),normalized(c,await oracle.run(c)));
});
test('the date oracle stays fixed across processes',async()=>{const c=auditCase({id:'standard-date-today',code:'from datetime import date\nprint(date.today())',files:[]});assert.equal((await oracle.run(c)).stdout,'2026-09-15\n');});
