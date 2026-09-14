import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
const url = process.env.TABS_URL ?? "http://127.0.0.1:4174/pycom/", output = process.env.TABS_ARTIFACTS ?? "artifacts/document-tabs";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: join(process.env["PROGRAMFILES(X86)"] ?? process.env.PROGRAMFILES, "Microsoft/Edge/Application/msedge.exe"), headless: true });
const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, acceptDownloads: true }), page = await context.newPage();
page.on("dialog", d => d.accept()); const results = [], errors = []; page.on("pageerror", e => errors.push(e.message));
const record = name => { results.push(name); console.log(`PASS ${name}`); };
const tab = name => page.locator('.document-tabs [role="tab"]').filter({ has: page.locator(".document-tab-name", { hasText: new RegExp(`^${name.replace(".", "\\.")}$`) }) });
async function code(text) { await page.locator(".editor-host .cm-content").click(); await page.keyboard.press("Control+A"); await page.keyboard.press("Backspace"); await page.keyboard.insertText(text); }
async function save(name) { await page.locator(".save").click(); if (name) { await page.locator(".document-dialog-layer .name-input").fill(name); await page.locator('[data-choice="name"]').click(); } await page.waitForFunction(() => !document.querySelector(".modified").textContent.includes("*")); }
const files = () => page.evaluate(() => new Promise(resolve => { const req = indexedDB.open("python-learning-lab-files", 2); req.onsuccess = () => { const db = req.result, tx = db.transaction("files"), all = tx.objectStore("files").getAll(); all.onsuccess = () => resolve(all.result); tx.oncomplete = () => db.close(); }; }));
async function abortNextPut() {
  // Fault injection at the browser storage boundary, not a product test hook.
  await page.evaluate(() => { const original = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(...args) { IDBObjectStore.prototype.put = original; const request = original.apply(this, args), tx = this.transaction; request.addEventListener("success", () => tx.abort(), { once: true }); return request; }; });
}
try {
  await page.goto(url); await page.locator(".welcome-close").click();
  await page.locator(".document-close").click(); assert.equal(await page.locator('.document-tabs [role="tab"]').count(), 1); assert.equal(await page.locator(".current-name").textContent(), "새 파일 1.py"); assert.deepEqual(await files(), []); record("last clean tab closes to one new empty unsaved tab");
  await code("A saved"); await save("a.txt"); await page.locator(".document-add").click(); await code("B saved"); await save("b.txt");
  await tab("a.txt").click(); await code("A captured");
  await page.evaluate(() => { const original = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(...args) { IDBObjectStore.prototype.put = original; const request = original.apply(this, args), objectStore = this, until = performance.now() + 4000; request.addEventListener("success", () => { const keepAlive = () => { if (performance.now() < until) objectStore.get(args[0].name).onsuccess = keepAlive; }; keepAlive(); }); return request; }; });
  await page.keyboard.press("Control+s"); await tab("b.txt").click(); await code("B draft during A save"); await tab("a.txt").click(); await code("A newer than snapshot"); await page.waitForTimeout(4200);
  const saved = await files(); assert.equal(saved.find(f => f.name === "a.txt").content, "A captured"); assert.equal(saved.find(f => f.name === "b.txt").content, "B saved"); assert.equal(await page.locator('.document-tabs [aria-label*="변경 있음"]').count(), 2); record("real delayed IndexedDB save stays bound to starting ID/content while switching and editing both tabs");
  await abortNextPut(); await page.keyboard.press("Control+Shift+s"); await page.locator(".document-dialog-layer .name-input").fill("failed.txt"); await page.locator('[data-choice="name"]').click(); await page.getByText(/a.txt.*저장할 수 없습니다/).waitFor(); assert.equal(await page.locator(".current-name").textContent(), "a.txt"); assert.ok(!(await files()).some(f => f.name === "failed.txt")); assert.match(await tab("a.txt").getAttribute("aria-label"), /변경 있음/); record("save shortcuts and abort after put success keep original name, content, dirty state and roll back file");
  await abortNextPut(); await tab("a.txt").locator("..").locator(".document-close").click(); await page.locator('[data-choice="save"]').click(); await page.waitForTimeout(200); assert.equal(await tab("a.txt").count(), 1); record("save failure during close leaves the tab open");
  await page.locator(".document-add").click(); await code("new to save"); const newName = await page.locator(".current-name").textContent(); await page.locator('.document-tab-wrap.active .document-close').click(); await page.locator('[data-choice="save"]').click(); await page.keyboard.press("Escape"); assert.equal(await tab(newName).count(), 1); record("untitled close-save name cancellation preserves tab");
  await page.locator('.document-tab-wrap.active .document-close').click(); await page.locator('[data-choice="discard"]').click(); assert.equal(await tab(newName).count(), 0); record("explicit discard closes only selected dirty tab");
  await page.locator(".import").click(); await page.locator(".import-file").setInputFiles({ name: "한글메모.txt", mimeType: "text/plain", buffer: Buffer.from("직접 작성한 가져오기 자료", "utf8") }); await tab("한글메모.txt").waitFor();
  const downloadWait = page.waitForEvent("download"); await page.locator(".export").click(); const download = await downloadWait; assert.equal(download.suggestedFilename(), "한글메모.txt"); record("TXT import opens saved tab and UTF-8 export uses active filename");
  await page.locator(".delete-file").click(); await page.locator('[data-choice="delete"]').click(); await page.waitForFunction(() => ![...document.querySelectorAll(".document-tab-name")].some(n => n.textContent === "한글메모.txt")); assert.ok(!(await files()).some(f => f.name === "한글메모.txt")); record("clean saved-file deletion closes matching tab without affecting others");
  // Exercise real internal scrolling and cursor restoration, not fixed fake DOM dimensions.
  await page.locator(".document-add").click(); const longName = await page.locator(".current-name").textContent(); await code(Array.from({ length: 300 }, (_, i) => `print(${i})`).join("\n")); await page.keyboard.press("Control+Home"); await page.locator(".editor-host .cm-scroller").hover(); await page.mouse.wheel(0, 1500); await page.waitForTimeout(200);
  const visibleLine = () => page.locator(".cm-scroller").evaluate(n => { const top = n.getBoundingClientRect().top, line = [...n.querySelectorAll(".cm-line")].find(line => line.getBoundingClientRect().bottom > top); return { top: n.scrollTop, text: line?.textContent, offset: line?.getBoundingClientRect().top - top }; });
  await page.waitForTimeout(500); const scroll = await visibleLine(); assert.ok(scroll.top > 0, JSON.stringify(scroll));
  await tab("b.txt").click(); await tab(longName).click(); await page.waitForTimeout(500); const after = await visibleLine();
  // CodeMirror may revise estimates above the viewport; the visible line and its offset must remain identical.
  assert.equal(after.text, scroll.text); assert.ok(Math.abs(after.offset - scroll.offset) < 3, JSON.stringify({ before: scroll, after })); record("real CodeMirror visible line and offset survive tab roundtrip");
  assert.deepEqual(errors, []);
} catch (error) { await page.screenshot({ path: `${output}/safety-failure.png`, fullPage: true }); throw error; }
finally { await writeFile(`${output}/safety-results.json`, JSON.stringify({ results, errors }, null, 2)); await browser.close(); }
