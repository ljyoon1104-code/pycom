import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { editorText, replaceCode } from "./helpers/editor.mjs";

const url=process.env.APP_URL??"http://127.0.0.1:4174/pycom/";
const output=path.resolve(process.env.SECURITY_ARTIFACTS??"artifacts/security-hardening/browser");
fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.EDGE_PATH??"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const report={url,browser:browser.version(),checks:[],errors:[]};
async function ready(page){await page.locator('.editor-host .cm-content').waitFor();if(await page.locator('.welcome-close').isVisible())await page.locator('.welcome-close').click();}
async function files(page){return page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('python-learning-lab-files',2);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('files','readonly'),all=tx.objectStore('files').getAll();tx.oncomplete=()=>{db.close();resolve(all.result);};tx.onabort=()=>reject(tx.error);};}));}
async function run(page,code,answers=[],beforeInput){
  await replaceCode(page,code);await page.locator('.topbar .execution-mode').selectOption('normal');
  // Run startup includes asynchronous storage refresh. Observe a real running ->
  // finished transition instead of mistaking the initially disabled Stop for completion.
  const done=page.evaluate(()=>new Promise((resolve,reject)=>{
    const stop=document.querySelector('.stop');let started=!stop.disabled;
    const timeout=setTimeout(()=>{observer.disconnect();reject(Error('execution did not complete'));},12000);
    const observer=new MutationObserver(()=>{if(!stop.disabled)started=true;else if(started){clearTimeout(timeout);observer.disconnect();resolve();}});
    observer.observe(stop,{attributes:true,attributeFilter:['disabled']});
  }));
  await page.locator('.run').click();
  for(const answer of answers){await page.locator('.console-input').waitFor();await beforeInput?.();await page.locator('.console-input').fill(answer);await page.locator('.input-submit').click();}
  await done;assert.equal(await page.locator('.run').isEnabled(),true);return page.locator('.console').textContent();
}
async function file(page,name){return (await files(page)).find(f=>f.name===name);}
async function scenarios(page,label){
  assert.equal(await run(page,'values = [] * 1000000\nprint(len(values))'),'0\n');
  assert.equal(await run(page,'values = () * 1000000\nprint(len(values))'),'0\n');
  for(const [name,code] of [
    ['format','try:\n    text = f"{1:>200000}"\nexcept:\n    print("잡으면 안 됨")'],
    ['multipart-format','try:\n    text = f"{1:>60000}{2:>60000}{3:>60000}"\nexcept:\n    print("잡으면 안 됨")'],
    ['shared-expansion','value = [0]\nfor i in range(18):\n    value = [value, value]\ntry:\n    text = str(value)\nexcept:\n    print("잡으면 안 됨")'],
    ['repeat-limit','try:\n    value = [1] * 1000000\nexcept:\n    print("잡으면 안 됨")'],
  ]){
    const result=await run(page,code);assert.match(result,/제한|크기/);assert.doesNotMatch(result,/잡으면 안 됨|RangeError|Maximum call stack|at VM/);
    report.checks.push({label,name,result});
  }
  assert.equal(await run(page,'a = []\na.append(a)\nprint(a)\nshared = [1]\nprint([shared, shared])'),'[[...]]\n[[1], [1]]\n');
  assert.equal(await run(page,'text = "x" * 100000\nfor i in range(100):\n    with open("repeated.txt", "w") as f:\n        f.write(text)\nprint("저장 완료")'),'저장 완료\n');
  assert.equal((await file(page,'repeated.txt')).content,'x'.repeat(100000));
  assert.equal(await run(page,'with open("order.txt", "w") as f:\n    f.write("A")\nwith open("order.txt", "a") as f:\n    f.write("B")\nwith open("order.txt", "r") as f:\n    print(f.read())'),'AB\n');
  assert.equal((await file(page,'order.txt')).content,'AB');
  assert.equal(await run(page,'f = open("unclosed.txt", "w")\nf.write("A")\nname = input("이름: ")\nprint(name)',['민수'],async()=>assert.equal((await file(page,'unclosed.txt')).content,'A')),'이름: 민수\n민수\n');
  assert.equal((await file(page,'unclosed.txt')).content,'A');
  assert.equal(await run(page,'f = open("unclosed.txt", "w")\nf.write("완료 시 저장")\nprint("완료")'),'완료\n');assert.equal((await file(page,'unclosed.txt')).content,'완료 시 저장');
  const failure=await run(page,'with open("order.txt", "w") as f:\n    f.write("오류 전 저장")\n    print(1 / 0)');assert.match(failure,/0으로 나눌 수 없습니다/);assert.equal((await file(page,'order.txt')).content,'오류 전 저장');
  const truncation=await run(page,'with open("order.txt", "w") as f:\n    print(missing_name)');assert.match(truncation,/정의|이름/);assert.equal((await file(page,'order.txt')).content,'');
  await run(page,'print("가져오기 전 초안")');const draft=await editorText(page),before=await files(page);
  await page.locator('.import').click();
  await page.locator('.import-file').evaluate(input=>{
    const picked=new File(['tiny'],'oversized.csv',{type:'text/csv'});let reads=0;
    Object.defineProperty(picked,'size',{value:1000001});picked.arrayBuffer=async()=>{reads++;throw Error('must not read oversized input');};
    Object.defineProperty(input,'securityReadCalls',{get:()=>reads});const transfer=new DataTransfer();transfer.items.add(picked);input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.locator('.import-error').waitFor({state:'visible'});assert.match(await page.locator('.import-error').textContent(),/1MB|너무 큽|한도|크기/);
  assert.equal(await page.locator('.import-file').evaluate(input=>input.securityReadCalls),0);
  await page.locator('.import-cancel').click();assert.equal(await editorText(page),draft);assert.deepEqual(await files(page),before);
  await page.screenshot({path:path.join(output,label.replaceAll(' ','-')+'.png'),fullPage:true});
  report.checks.push({label,name:'file-semantics',repeatedFileBytes:(await file(page,'repeated.txt')).content.length,truncationPersisted:true,preReadRejection:true});
}
async function forcedStop(page,label){
  // Only this fresh test context replaces its next Worker. The real Worker executes
  // a bounded 2-second CPU loop on stop, without allocating large data or changing app code.
  await page.evaluate(()=>{
    const NativeWorker=window.Worker;let first=true;
    const source='self.onmessage=({data})=>{if(data.type==="run"){self.postMessage({type:"file-change",name:"accepted-before-stop.txt",content:"전달된 변경",writeId:1,runId:data.runId});self.postMessage({type:"input-request",prompt:"모의 입력:",runId:data.runId});}else if(data.type==="stop"){const end=performance.now()+2000;while(performance.now()<end){}self.postMessage({type:"output",text:"늦은 출력",runId:data.runId});self.postMessage({type:"stopped",runId:data.runId});}}';
    window.Worker=class extends NativeWorker{constructor(url,options){const fake=first;first=false;super(fake?URL.createObjectURL(new Blob([source],{type:'text/javascript'})):url,options);}};
  });
  await replaceCode(page,'print("모의 Worker")');await page.locator('.topbar .execution-mode').selectOption('step');await page.locator('.run').click();await page.locator('.console-input').waitFor();
  assert.equal(await page.locator('.editor-host .cm-content').getAttribute('contenteditable'),'false');
  const staleForm=await page.locator('.input-row').elementHandle();const started=Date.now();await page.locator('.stop').click();
  await page.waitForFunction(()=>document.querySelector('.stop').disabled);assert.equal(await page.locator('.run').isEnabled(),true);
  await page.waitForFunction(()=>document.querySelector('.file-save-status')?.textContent.includes('강제 종료'));
  const elapsedMs=Date.now()-started;assert.ok(elapsedMs>=400&&elapsedMs<1900,'bounded Worker should be force-stopped near the 500ms deadline: '+elapsedMs);
  assert.equal((await file(page,'accepted-before-stop.txt')).content,'전달된 변경');assert.equal(await page.locator('.console-input').count(),0);
  assert.equal(await page.locator('.editor-host .cm-content').getAttribute('contenteditable'),'true');assert.equal(await page.locator('.execution-arrow').count(),0);
  await staleForm.evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.doesNotMatch(await page.locator('.console').textContent(),/늦은 출력/);
  assert.equal(await run(page,'print("다시 실행")'),'다시 실행\n');
  report.checks.push({label,name:'forced-stop',elapsedMs,acceptedWritePersisted:true,lateInputIgnored:true,restarted:true});
}
try{
  for(const [width,height] of [[1440,900],[360,800]]){
    const context=await browser.newContext({viewport:{width,height},acceptDownloads:true});const page=await context.newPage();const label=width+'x'+height;
    page.setDefaultTimeout(15000);page.on('dialog',d=>d.accept());page.on('pageerror',e=>report.errors.push(label+': '+e.message));
    try{
      assert.equal((await page.goto(url)).status(),200);await ready(page);await scenarios(page,label+' online');await forcedStop(page,label+' online');
      const original=await files(page);await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
      await context.setOffline(true);await page.reload();await ready(page);await context.setOffline(true);
      const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
      assert.equal(await page.evaluate(()=>navigator.onLine),false);assert.equal(await page.evaluate(()=>fetch('uncached-proof-'+Date.now(),{cache:'no-store'}).then(()=>false,()=>true)),true);
      assert.deepEqual(await files(page),original);await scenarios(page,label+' offline');await forcedStop(page,label+' offline');
      const metrics=await page.evaluate(()=>({width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth}));assert.ok(metrics.scrollWidth<=metrics.width);
      report.checks.push({label,name:'offline',filesPreserved:original.length,...metrics});console.log(label+' passed');
    }catch(error){await page.screenshot({path:path.join(output,'failure-'+label+'.png'),fullPage:true}).catch(()=>{});throw error;}finally{await context.close();}
  }
  assert.deepEqual(report.errors,[]);report.passed=true;
}finally{fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,output}));
