import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { editorText, replaceCode } from "./helpers/editor.mjs";

const url = process.env.APP_URL ?? "http://127.0.0.1:4174/pycom/";
const output = path.resolve(process.env.STORAGE_ARTIFACTS ?? "artifacts/security-hardening/storage");
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" });
const report = { url, checks: [], errors: [], passed: false };
const makeFile = (name, content = "") => ({ name, content, updatedAt: 123, encoding: "utf-8", byteSize: Buffer.byteLength(content) });
const backup = files => Buffer.from(JSON.stringify({ format: "python-learning-lab-backup", formatVersion: 1, appVersion: "2.1.0", createdAt: "2026-11-11T00:00:00.000Z", files: files.map(file => ({ name: file.name, content: file.content, encoding: file.encoding, originalByteSize: file.byteSize, updatedAt: new Date(file.updatedAt).toISOString() })) }));
async function ready(page) {
  await page.locator(".editor-host .cm-content").waitFor();
  if (await page.locator(".welcome-dialog").isVisible()) await page.locator(".welcome-close").click();
}
async function pair(items = [], noBroadcast = false) {
  // Never attach to an existing student profile: every scenario owns its context.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  if (noBroadcast) await context.addInitScript(() => {
    Object.defineProperty(window, "BroadcastChannel", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });
  });
  const pages = await Promise.all([context.newPage(), context.newPage()]);
  for (const page of pages) {
    page.setDefaultTimeout(15000); page.on("dialog", dialog => dialog.accept());
    page.on("pageerror", error => report.errors.push(error.message));
    assert.equal((await page.goto(url)).status(), 200); await ready(page);
  }
  await pages[0].evaluate(items => new Promise((resolve, reject) => {
    const open = indexedDB.open("python-learning-lab-files", 2);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => { const db = open.result, tx = db.transaction("files", "readwrite"), store = tx.objectStore("files"); store.clear(); items.forEach(file => store.put(file)); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error); };
  }), items);
  for (const page of pages) { await page.reload(); await ready(page); }
  return { context, pages };
}
async function stored(page, contents = false) {
  return page.evaluate(contents => new Promise((resolve, reject) => {
    const open = indexedDB.open("python-learning-lab-files", 2); open.onerror = () => reject(open.error);
    open.onsuccess = () => { const db = open.result, tx = db.transaction("files", "readonly"), read = tx.objectStore("files").getAll(); tx.oncomplete = () => { db.close(); const rows = read.result.sort((a,b) => a.name.localeCompare(b.name)); resolve(contents ? rows : rows.map(file => ({ name: file.name, length: file.content.length, bytes: new TextEncoder().encode(file.content).length }))); }; tx.onabort = () => reject(tx.error); };
  }), contents);
}
async function prepareSave(page, name, code) {
  await page.locator(".clear").click();
  if (code !== undefined) await replaceCode(page, code);
  await page.locator(".save-as").click(); await page.locator(".document-dialog-layer .name-input").fill(name);
}
async function outcome(page) {
  await page.waitForFunction(() => document.querySelector(".console .console-error") || document.querySelector(".console").textContent.includes("파일을 저장했습니다"));
  return await page.locator(".console .console-error").count() ? "rejected" : "saved";
}
async function saveAs(page, name, code) {
  await prepareSave(page, name, code); await page.locator(".document-dialog-layer .name-confirm").click();
  assert.equal(await outcome(page), "saved");
}
async function openFile(page, name) {
  await page.locator(".file-item > span").filter({ hasText: new RegExp("^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }).click();
  await page.waitForFunction(name => document.querySelector(".current-name").textContent === name, name);
}
async function chooseRestore(page, data, policy = "keep") {
  await page.locator(".restore-input").setInputFiles({ name: "test.pylab-backup.json", mimeType: "application/json", buffer: data });
  await page.locator(".restore-dialog").waitFor(); await page.locator(`input[name="restore-policy"][value="${policy}"]`).check();
}
async function confirmRestore(page, success = true) {
  await page.locator(".restore-confirm").click();
  if (await page.locator('.document-dialog-layer [data-choice="discard"]').isVisible()) await page.locator('.document-dialog-layer [data-choice="discard"]').click();
  await page.waitForFunction(success => {
    const text = document.querySelector(".console").textContent;
    return success ? text.includes("전체 복원이 완료되었습니다") : text.includes("기존 파일은 변경되지 않았습니다");
  }, success);
}
async function countRace(noBroadcast = false) {
  const { context, pages: [a,b] } = await pair(Array.from({ length: 99 }, (_, i) => makeFile(`existing-${i}.txt`)), noBroadcast);
  try {
    await Promise.all([prepareSave(a,"race-a.py","print('a')"), prepareSave(b,"race-b.py","print('b')")]);
    await Promise.all([a.locator(".name-confirm").click(), b.locator(".name-confirm").click()]);
    const outcomes = await Promise.all([outcome(a), outcome(b)]); assert.deepEqual([...outcomes].sort(), ["rejected","saved"]);
    const rows = await stored(a); assert.equal(rows.length,100); assert.equal(rows.filter(file=>file.name.startsWith("race-")).length,1);
    for (let i=0;i<2;i++) if(outcomes[i]==="rejected") { assert.match(await editorText([a,b][i]), /print/); assert.match(await [a,b][i].locator(".modified").textContent(), /\*/); }
    report.checks.push({ case: "99 files, two simultaneous UI saves", noBroadcastOrWebLocks: noBroadcast, outcomes, count: rows.length, rejectedDraftPreserved:true });
  } finally { await context.close(); }
}
try {
  await countRace(); await countRace(true);
  {
    // 9.9 MB + 75 KB + 75 KB: bounded fixtures below ordinary workspace limits.
    const items = [...Array.from({length:9},(_,i)=>makeFile(`large-${i}.txt`,"x".repeat(1_000_000))), makeFile("remainder.txt","x".repeat(825_000)), makeFile("template.txt","t".repeat(75_000))];
    const {context,pages:[a,b]}=await pair(items);
    try {
      await Promise.all([openFile(a,"template.txt"),openFile(b,"template.txt")]);
      await Promise.all([prepareSave(a,"copy-a.txt"),prepareSave(b,"copy-b.txt")]);
      await Promise.all([a.locator(".name-confirm").click(),b.locator(".name-confirm").click()]);
      const outcomes=await Promise.all([outcome(a),outcome(b)]); assert.deepEqual([...outcomes].sort(),["rejected","saved"]);
      const rows=await stored(a), bytes=rows.reduce((sum,file)=>sum+file.bytes,0); assert.equal(bytes,9_975_000);
      report.checks.push({case:"total bytes, two simultaneous UI saves",outcomes,bytes});
    } finally { await context.close(); }
  }
  {
    const {context,pages:[a,b]}=await pair([makeFile("existing.py","print('original')")]);
    try {
      await openFile(a,"existing.py"); await a.locator(".editor-host .cm-content").click(); await a.keyboard.press("Control+End"); await a.keyboard.insertText("\n# local unsaved draft");
      const draft=await editorText(a);
      await openFile(b,"existing.py"); await replaceCode(b,"print('other browser tab')"); await b.locator(".save").click();
      await a.locator(".document-warning").waitFor(); assert.equal(await editorText(a),draft);
      await a.locator(".editor-host .cm-content").click(); await a.keyboard.press("Control+z"); assert.equal(await editorText(a),"print('original')"); await a.keyboard.press("Control+y"); assert.equal(await editorText(a),draft);
      const data=backup([makeFile("backup.py","print('restored')")]);
      await chooseRestore(b,data);
      await saveAs(a,"other-new.py");
      await confirmRestore(b);
      let rows=await stored(b); assert.ok(rows.some(file=>file.name==="other-new.py")); assert.ok(rows.some(file=>file.name==="backup.py"));
      report.checks.push({case:"restore preview followed by other-tab save",newFilePreserved:true,dirtyDraftAndUndoPreserved:true});
      // Fresh backup targets overlap a real explicit save; both must survive either commit order.
      await b.locator(".clear").click();
      await chooseRestore(b,backup([makeFile("overlap.py","print('overlap')")]));
      await prepareSave(a,"overlap-new.py");
      await Promise.all([a.locator(".name-confirm").click(),confirmRestore(b)]);
      rows=await stored(b); assert.ok(rows.some(file=>file.name==="overlap.py")); assert.ok(rows.some(file=>file.name==="overlap-new.py"));
      report.checks.push({case:"overlapping UI restore and save",bothPreserved:true});
    } finally { await context.close(); }
  }
  {
    const {context,pages:[a]}=await pair([makeFile("keep.py","original")]);
    try {
      const before=await stored(a,true);
      await a.evaluate(()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){if(value.name==="rollback-2.py"){IDBObjectStore.prototype.put=original;throw new DOMException("controlled rollback test","QuotaExceededError");}return original.call(this,value,...args);};});
      await chooseRestore(a,backup([makeFile("rollback-1.py","one"),makeFile("rollback-2.py","two")])); await confirmRestore(a,false);
      assert.deepEqual(await stored(a,true),before);
      report.checks.push({case:"second restore put fails after first queued write",rollbackPreservedAllFiles:true});
    } finally { await context.close(); }
  }
  {
    const {context,pages:[a]}=await pair();
    try {
      const names=["CON.py","학생 😀.py","가".repeat(200)+".py"];
      for(const name of names){await a.locator(".clear").click();await saveAs(a,name,"print('보존')");}
      const wait=a.waitForEvent("download");await a.locator(".backup-all").click();const download=await wait;const target=path.join(output,"special-names.pylab-backup.json");await download.saveAs(target);
      const document=JSON.parse(fs.readFileSync(target,"utf8"));assert.deepEqual(document.files.map(file=>file.name).sort(),[...names].sort());
      await chooseRestore(a,fs.readFileSync(target),"rename");await confirmRestore(a);
      const rows=await stored(a);assert.equal(rows.length,6);assert.equal(rows.filter(file=>file.name.includes("복원 1")).length,3);
      await a.screenshot({path:path.join(output,"storage-two-tab-policy.png"),fullPage:true});
      report.checks.push({case:"special names actual UI save, backup, renamed restore",files:rows.length,longRenamedNameValid:true});
    }finally{await context.close();}
  }
  assert.deepEqual(report.errors,[]); report.passed=true;
}finally{fs.writeFileSync(path.join(output,"results.json"),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify(report,null,2));
