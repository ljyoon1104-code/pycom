import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const url = process.env.APP_URL ?? "http://127.0.0.1:4174/pycom/";
const output = process.env.INITIAL_ARTIFACTS ?? "artifacts/initial-code";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: join(process.env["PROGRAMFILES(X86)"] ?? process.env.PROGRAMFILES, "Microsoft/Edge/Application/msedge.exe"), headless: true });
const results = [], errors = [];
const text = page => page.locator(".editor-host .cm-line").allTextContents().then(lines => lines.join("\n"));
const files = page => page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open("python-learning-lab-files", 2);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => { const db = request.result, tx = db.transaction("files"), all = tx.objectStore("files").getAll(); all.onsuccess = () => resolve(all.result); tx.oncomplete = () => db.close(); };
}));
async function ready(page) {
  await page.locator(".editor-host .cm-content").waitFor();
  if (await page.locator(".welcome-dialog").isVisible()) await page.locator(".welcome-close").click();
  await page.waitForFunction(() => !document.querySelector(".save").disabled);
}
async function edit(page, code) {
  await page.locator(".editor-host .cm-content").click();
  await page.keyboard.press("Control+A"); await page.keyboard.press("Backspace"); await page.keyboard.insertText(code);
  assert.equal(await text(page), code);
}
async function save(page, name) {
  await page.locator(".save").click();
  await page.locator(".document-dialog-layer .name-input").fill(name);
  await page.locator('.document-dialog-layer [data-choice="name"]').click();
  await page.waitForFunction(() => !document.querySelector(".modified").textContent.includes("*"));
}
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 360, height: 800 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    page.on("dialog", dialog => dialog.accept());
    assert.equal((await page.goto(url)).status(), 200); await ready(page);
    assert.equal(await text(page), 'print("Hello World")'); assert.deepEqual(await files(page), []);
    await page.locator(".run").click();
    await page.waitForFunction(() => document.querySelector(".console").textContent.includes("Hello World") && document.querySelector(".stop").disabled);
    assert.equal(await page.locator(".console-input").count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await page.screenshot({ path: join(output, `initial-${viewport.width}x${viewport.height}.png`), fullPage: true });
    await edit(page, 'print("저장하지 않은 수정")'); await page.reload(); await ready(page);
    assert.equal(await text(page), 'print("Hello World")'); assert.deepEqual(await files(page), []);
    await edit(page, 'print("기존 파일")'); await save(page, "main.py");
    await page.locator(".new-file").click(); assert.equal(await text(page), "");
    await edit(page, 'print("두 번째 파일")'); await save(page, "lesson.py");
    const stored = await files(page);
    await page.reload(); await ready(page);
    await page.waitForFunction(() => document.querySelector(".current-name").textContent === "lesson.py");
    assert.equal(await text(page), 'print("두 번째 파일")'); assert.deepEqual(await files(page), stored);
    assert.equal(await page.locator('.document-tabs [role="tab"]').count(), 2);
    await page.evaluate(() => localStorage.removeItem("python-learning-lab-document-session-v1"));
    await page.reload(); await ready(page);
    await page.waitForFunction(() => document.querySelector(".editor-host").textContent.includes("기존 파일"));
    assert.equal(await text(page), 'print("기존 파일")'); assert.deepEqual(await files(page), stored);
    results.push({ viewport, initialCode: "passed", output: "Hello World", noAutosave: "passed", storedFilesAndSession: "passed", missingSessionFallback: "passed" });
    console.log("PASS", viewport);
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(join(output, "results.json"), JSON.stringify({ url, results, errors }, null, 2));
} finally { await browser.close(); }
