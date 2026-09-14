import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
const url = process.env.APP_URL ?? "http://127.0.0.1:4174/pycom/", directory = "artifacts/core-v2-upgrade", capture = process.argv.includes("--capture");
await mkdir(directory, { recursive: true });
const backup = JSON.parse(await readFile("artifacts/core-v2-tabs/saved-files.pylab-backup.json", "utf8")); assert.equal(backup.appVersion, "1.3.2");
const browser = await chromium.launch({ executablePath: join(process.env["PROGRAMFILES(X86)"] ?? process.env.PROGRAMFILES, "Microsoft/Edge/Application/msedge.exe"), headless: true });
const state = join(directory, "v1.3.2-state.json"), baselinePath = join(directory, "v1.3.2-baseline.json");
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(capture ? {} : { storageState: state }) }), page = await context.newPage();
page.on('dialog', dialog => dialog.accept());
const stored = () => page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open("python-learning-lab-files", 2); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result, tx = db.transaction("files"), all = tx.objectStore("files").getAll(); all.onsuccess = () => resolve(all.result.sort((a, b) => a.name.localeCompare(b.name))); tx.oncomplete = () => db.close(); }; }));
const snapshot = async () => ({ files: await stored(), session: await page.evaluate(() => JSON.parse(localStorage.getItem("python-learning-lab-document-session-v1"))), names: await page.locator('.document-tab-name').allTextContents(), active: await page.locator('.current-name').textContent() });
try {
  await page.goto(url); await page.locator('.editor-host .cm-content').waitFor(); if (await page.locator('.welcome-dialog').isVisible()) await page.locator('.welcome-close').click();
  if (capture) {
    assert.equal(await page.locator('.app-version').textContent(), '1.3.2'); const chooser = page.waitForEvent('filechooser'); await page.locator('.restore-all').click(); await (await chooser).setFiles('artifacts/core-v2-tabs/saved-files.pylab-backup.json'); await page.locator('.restore-confirm').click();
    await page.waitForFunction(count => document.querySelectorAll('.file-item').length === count, backup.files.length);
    for (const file of backup.files.slice(0, 2)) await page.locator('.file-item').filter({ hasText: file.name }).click();
    // v1.3.2 persists saved tabs only, never an unsaved placeholder or draft.
    await page.reload(); await page.locator('.editor-host .cm-content').waitFor();
    const baseline = await snapshot(); assert.equal(baseline.files.length, backup.files.length);
    for (const original of backup.files) { const actual = baseline.files.find(file => file.name === original.name); assert.deepEqual(actual, { name: original.name, content: original.content, updatedAt: Date.parse(original.updatedAt), encoding: original.encoding, byteSize: original.originalByteSize }); }
    await writeFile(baselinePath, JSON.stringify(baseline, null, 2)); await context.storageState({ path: state, indexedDB: true }); console.log('CAPTURE v1.3.2 files, metadata and tab session');
  } else {
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8')); assert.deepEqual(await snapshot(), baseline); await page.evaluate(() => navigator.serviceWorker.ready); await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const cdp = await context.newCDPSession(page); await cdp.send('Network.enable'); await context.setOffline(true); await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }); await page.reload(); await page.locator('.editor-host .cm-content').waitFor(); assert.deepEqual(await snapshot(), baseline);
    await writeFile(join(directory, 'results.json'), JSON.stringify({ url, version: await page.locator('.app-version').textContent(), originalVersion: backup.appVersion, files: baseline.files.length, fileContentAndMetadata: true, tabs: true, offlineReload: true }, null, 2)); console.log('PASS old backup / IndexedDB / tab session / offline reload');
  }
} finally { await browser.close(); }
