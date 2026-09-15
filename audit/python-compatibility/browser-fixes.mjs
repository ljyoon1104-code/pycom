import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createLearningRunner } from './run-learning-vm.mjs';
const url=process.env.APP_URL??'http://127.0.0.1:4174/pycom/';
const directory=process.env.FIXES_ARTIFACTS??'artifacts/compatibility-fixes-browser';
await mkdir(directory,{recursive:true});
const cases=JSON.parse(await readFile('tests/fixtures/compatibility-defects-v2.json','utf8'));
const expectedVersion=JSON.parse(await readFile('package.json','utf8')).version;
const groups=new Set();
const selected=cases.filter(c=>c.severity==='P1'||(!groups.has(c.group)&&groups.add(c.group)));
const browser=await chromium.launch({executablePath:join(process.env['PROGRAMFILES(X86)'],'Microsoft/Edge/Application/msedge.exe'),headless:true});
const runner=await createLearningRunner(), results=[], errors=[], badResponses=[], persistence=[];
const literal=value=>JSON.stringify(value).replaceAll('\\r','"+chr(13)+"');
async function edit(page,source){
  await page.locator('.editor-host .cm-content').click();
  await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace'); await page.keyboard.insertText(source);
  assert.equal((await page.locator('.editor-host .cm-line').allTextContents()).join('\n'),source);
}
async function run(page,source,answers=[]){
  await edit(page,source); await page.locator('.run').click();
  for(const answer of answers){await page.locator('.console-input').fill(answer);await page.locator('.input-submit').click();}
  await page.waitForFunction(()=>document.querySelector('.stop').disabled,{},{timeout:25000});
  assert.equal(await page.locator('.run').isEnabled(),true);
  return {stdout:(await page.locator('.console > .console-line').allTextContents()).join(''),error:(await page.locator('.console-error').allTextContents()).join(''),highlight:await page.locator('.cm-student-error').count()};
}
async function save(page,name){await page.locator('.save').click();if(await page.locator('.document-dialog-layer .name-input').isVisible()){await page.locator('.document-dialog-layer .name-input').fill(name);await page.locator('[data-choice="name"]').click();}await page.waitForFunction(()=>!document.querySelector('.modified').textContent.includes('*'));}
async function file(page,name){if(!await page.locator('.file-panel').isVisible())await page.locator('.files-toggle').click();await page.locator('.file-item').filter({hasText:name}).click();}
async function tab(page,name){await page.locator('.document-tabs [role="tab"]').filter({has:page.locator('.document-tab-name',{hasText:new RegExp('^'+name.replaceAll('.','\\.')+'$')})}).click();}
async function setup(page,c){if(c.files.length){const source=c.files.map(f=>`with open(${literal(f.name)}, "w") as fixture:\n    fixture.write(${literal(f.content)})`).join('\n');const r=await run(page,source);assert.equal(r.error,'');}}
try{
 for(const [width,height]of [[1440,900],[360,800]]){
  const context=await browser.newContext({viewport:{width,height},acceptDownloads:true}),page=await context.newPage();
  page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));
  page.on('response',response=>{if(response.status()>=400)badResponses.push({url:response.url(),status:response.status()});});
  assert.equal((await page.goto(url)).status(),200);await page.locator('.editor-host .cm-content').waitFor();
  if(await page.locator('.welcome-dialog').isVisible())await page.locator('.welcome-close').click();
  const version=await page.locator('.app-version').textContent();
  assert.equal(version,expectedVersion,'The tested deployment must match the current package version');
  await edit(page,'print("저장 기준")');await save(page,'main.py');
  for(const c of selected){
    await setup(page,c); const expected=runner.run(c),actual=await run(page,c.code,c.input);
    assert.equal(expected.stdout,c.expected.stdout,`${c.id}: reference mismatch`);
    assert.equal(expected.errorType,c.expected.errorType,`${c.id}: error type mismatch`);
    assert.equal(actual.stdout,c.expected.stdout,`${width}: ${c.id}`);
    if(c.expected.errorType){assert.ok(actual.error.includes(expected.message));assert.ok(actual.error.includes(`${c.expected.line}번째 줄`));assert.ok(actual.highlight>0);assert.match(actual.error,/[가-힣]/);assert.doesNotMatch(actual.error,/ReferenceError:|TypeError:|\.ts:\d|\bat .+\(/);}
    else assert.equal(actual.error,'');
    assert.equal(await page.locator('.current-name').textContent(),'main.py');
    results.push({id:c.id,severity:c.severity,group:c.group,viewport:`${width}x${height}`,version,...actual});
    assert.equal((await run(page,'print("다시 실행")')).stdout,'다시 실행\n');
  }
  assert.equal((await run(page,'print("실행 중...")')).stdout,'실행 중...\n');
  assert.equal((await run(page,'x=1')).stdout,'');
  assert.equal((await run(page,'name=input("이름: ")\nprint(f"안녕하세요, {name}")',['민수'])).stdout,'이름: 민수\n안녕하세요, 민수\n');
  const text='가😀𐐀é\n다음\n끝';
  assert.equal((await run(page,`with open("문자.txt","w") as f:\n    print(f.write(${literal(text)}))`)).stdout,'10\n');
  await file(page,'문자.txt');assert.equal((await page.locator('.editor-host .cm-line').allTextContents()).join('\n'),text);
  await save(page,'문자.txt');await tab(page,'main.py');await page.reload();await page.locator('.editor-host .cm-content').waitFor();
  await file(page,'문자.txt');assert.equal((await page.locator('.editor-host .cm-line').allTextContents()).join('\n'),text);await tab(page,'main.py');
  await edit(page,'def add(a,b):\n    return a+b');await page.locator('.document-add').click();await edit(page,'def add(a,b):\n    return a+b');await save(page,'helper.py');await tab(page,'main.py');
  await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const pwa=await page.evaluate(async()=>{
    const registration=await navigator.serviceWorker.ready, manifestUrl=document.querySelector('link[rel="manifest"]').href;
    const response=await fetch(manifestUrl),manifest=await response.json();
    const icons=await Promise.all(manifest.icons.map(async icon=>({url:new URL(icon.src,manifestUrl).href,status:(await fetch(new URL(icon.src,manifestUrl))).status})));
    return {scope:registration.scope,worker:registration.active.scriptURL,manifest:response.status,icons};
  });
  assert.equal(pwa.scope,new URL('./',url).href);assert.ok(pwa.worker.startsWith(pwa.scope));assert.equal(pwa.manifest,200);assert.ok(pwa.icons.length>0);assert.ok(pwa.icons.every(icon=>icon.status===200));
  const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await context.setOffline(true);await cdp.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});await page.reload();await page.locator('.editor-host .cm-content').waitFor();
  for(const id of ['assignment-aug-list-ref','builtin-map-bound','numeric-float-floor-edge']){const c=cases.find(c=>c.id===id);assert.equal((await run(page,c.code)).stdout,c.expected.stdout);}
  assert.equal((await run(page,'from helper import add\nprint(add(3,4))')).stdout,'7\n');
  assert.equal((await run(page,'def f(n):\n    return 1 if n<=1 else n*f(n-1)\nprint(f(5))')).stdout,'120\n');
  assert.equal((await run(page,'name=input("이름: ")\nprint(name)',['민수'])).stdout,'이름: 민수\n민수\n');
  assert.equal((await run(page,'with open("문자.txt") as f:\n    print(f.read(3))\n    print(f.read(2))')).stdout,'가😀𐐀\né\n');
  assert.equal((await run(page,'with open("오프라인.txt","w") as f:\n    f.write("한글😀")\nwith open("오프라인.txt") as f:\n    print(f.read())')).stdout,'한글😀\n');
  await run(page,'import turtle\nt=turtle.Turtle()\nt.forward(80)\nturtle.done()');assert.equal(await page.locator('.turtle-canvas').isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
  await page.screenshot({path:join(directory,`fixes-${width}x${height}.png`),fullPage:true});
  persistence.push({viewport:`${width}x${height}`,pwa,unicodeSaveReopenReload:true,offlineWorker:true,offlineModules:true,offlineListReference:true,offlineBoundMap:true,offlineFloatDivision:true,offlineRecursion:true,offlineInput:true,offlineTurtle:true,tabs:true});
  console.log(`PASS ${selected.length} defect cases + offline ${width}x${height}`);await context.close();
 }
 assert.deepEqual(errors,[]);
 assert.deepEqual(badResponses,[]);
 await writeFile(join(directory,'results.json'),JSON.stringify({url,browser:browser.version(),selected:selected.map(c=>c.id),executions:results.length,results,persistence,errors,badResponses},null,2));
}finally{await runner.close();await browser.close();}
