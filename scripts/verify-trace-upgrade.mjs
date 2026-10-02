import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright-core";
import { replaceCode, editorText, runCurrent } from "./helpers/editor.mjs";

const output = path.resolve(process.env.TRACE_UPGRADE_ARTIFACTS ?? "artifacts/execution-tracing/upgrade");
fs.mkdirSync(output, { recursive: true });
const oldRoot = path.resolve(process.env.BASELINE_DIST ?? "artifacts/code-cleanup-stage2/baseline-dist"), currentRoot = path.resolve("dist");
let root = oldRoot;
assert.ok(fs.existsSync(path.join(oldRoot, "sw.js")), "provide an existing production baseline");
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req,res) => {
  try {
    if (!["GET","HEAD"].includes(req.method)) { res.writeHead(405).end(); return; }
    const url = new URL(req.url,"http://localhost"), name = decodeURIComponent(url.pathname).replace(/^\/pycom\//,"");
    const file = path.resolve(root,name || "index.html"), relative = path.relative(root,file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) { res.writeHead(403).end(); return; }
    const data = fs.readFileSync(file); res.writeHead(200,{"Content-Type":mime[path.extname(file)] ?? "application/octet-stream","Cache-Control":"no-cache"}).end(req.method === "HEAD" ? undefined : data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser = await chromium.launch({headless:true,executablePath:process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",args:["--host-resolver-rules=MAP classroom.test 127.0.0.1","--no-proxy-server"]});
const context = await browser.newContext({ viewport:{width:1440,height:900},acceptDownloads:true });
const page = await context.newPage(), report={errors:[]}; page.on('dialog', d=>d.accept()); page.on('pageerror',e=>report.errors.push(e.message));
const ready=async()=>{await page.locator('.editor-host .cm-content').waitFor();if(await page.locator('.welcome-dialog').isVisible())await page.locator('.welcome-close').click();};
async function saveAs(name){await page.locator('.save-as').click();await page.locator('.name-input').fill(name);await page.locator('.name-confirm').click();await page.waitForFunction(()=>!document.querySelector('.modified').textContent.includes('*'));}
async function files(){return page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('python-learning-lab-files',2);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('files','readonly'),all=tx.objectStore('files').getAll();tx.oncomplete=()=>{db.close();resolve(all.result);};};}));}
async function backup(name){const d=page.waitForEvent('download');await page.locator('.backup-all').click();const file=path.join(output,name);await(await d).saveAs(file);return {file,data:JSON.parse(fs.readFileSync(file,'utf8'))};}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/pycom/`);await ready();await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await replaceCode(page,'print("기존 파일")');await saveAs('기존.py');await page.locator('.new-file').click();await replaceCode(page,'이름,점수\n민수,90');await saveAs('기존.csv');
  const original=await files(), oldBackup=await backup('before.pylab-backup.json'), tabs=await page.locator('.document-tab-name').allTextContents();
  await replaceCode(page,'저장하지 않은 초안');root=currentRoot;
  await page.evaluate(async()=>(await navigator.serviceWorker.getRegistration()).update());await page.locator('.update').waitFor();
  await page.locator('.update').click();await page.locator('.document-dialog-layer [data-choice="cancel"]').click();assert.equal(await editorText(page),'저장하지 않은 초안');assert.deepEqual(await files(),original);
  await page.locator('.update').click();await Promise.all([page.waitForEvent('load'),page.locator('.document-dialog-layer [data-choice="discard"]').click()]);await ready();
  assert.equal(await page.locator('.execution-mode').inputValue(),'normal');assert.deepEqual(await files(),original);assert.deepEqual(await page.locator('.document-tab-name').allTextContents(),tabs);
  const newBackup=await backup('after.pylab-backup.json');assert.deepEqual(newBackup.data.files,oldBackup.data.files);
  const chooser=page.waitForEvent('filechooser');await page.locator('.restore-all').click();await(await chooser).setFiles(oldBackup.file);await page.locator('.restore-confirm').click();await page.waitForFunction(()=>document.querySelector('.console').textContent.includes('전체 복원이 완료되었습니다.'));
  assert.deepEqual(await files(),original);assert.deepEqual(report.errors,[]);
  await page.screenshot({path:path.join(output,'after-update.png'),fullPage:true});
  const lanContext=await browser.newContext(), lan=await lanContext.newPage();
  try {
    await lan.goto(`http://classroom.test:${server.address().port}/pycom/`);await lan.locator('.editor-host .cm-content').waitFor();if(await lan.locator('.welcome-dialog').isVisible())await lan.locator('.welcome-close').click();
    assert.equal(await lan.evaluate(()=>isSecureContext),false);assert.equal(await lan.evaluate(()=>typeof crypto.randomUUID),'undefined');
    await replaceCode(lan,'print("LAN 실행")');assert.equal(await runCurrent(lan),'LAN 실행\n');
  } finally {await lanContext.close();}
  Object.assign(report,{passed:true,actualServiceWorkerUpdate:true,cancelPreservedDraft:true,unchangedFiles:original.length,tabs,backupCompatible:true,insecureHttpRun:true});
} finally {fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify(report));
