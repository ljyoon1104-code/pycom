import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const url = process.env.APP_URL ?? "https://ljyoon1104-code.github.io/pycom/";
const label = url.includes("github.io") ? "pages" : "local";
const outputDirectory = "artifacts/stage12";
const executablePath = process.env.EDGE_PATH ?? join(process.env["PROGRAMFILES(X86)"] ?? process.env.PROGRAMFILES ?? "", "Microsoft", "Edge", "Application", "msedge.exe");
const bytes = Buffer.from("wMy4pyzBobz2DQq5zrz2LDkwDQrB9rz2LDk1DQo=", "base64");
const expectedText = "이름,점수\r\n민수,90\r\n지수,95\r\n";
const code = 'with open("students-euckr.csv", "r", encoding="euc-kr") as file:\n    file.readline()\n\n    for line in file.readlines():\n        values = line.strip().split(",")\n        print(values[0], values[1])';
new TextDecoder("utf-8", { fatal: true });
assert.throws(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes));
assert.equal(new TextDecoder("euc-kr", { fatal: true }).decode(bytes), expectedText);
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await context.newPage(), browserErrors = [], serverWrites = [], failedResources = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  page.on("request", request => { if (!["GET", "HEAD"].includes(request.method())) serverWrites.push(request.method() + " " + request.url()); });
  page.on("response", response => { if (response.status() >= 400) failedResources.push(response.status() + " " + response.url()); });

  // Make a real version-1 database before application code opens version 2.
  await page.goto(new URL("manifest.webmanifest", url).href);
  await page.evaluate(() => new Promise((resolve, reject) => {
    const removing = indexedDB.deleteDatabase("python-learning-lab-files");
    removing.onerror = () => reject(removing.error);
    removing.onsuccess = () => {
      const opening = indexedDB.open("python-learning-lab-files", 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore("files", { keyPath: "name" });
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const db = opening.result, transaction = db.transaction("files", "readwrite");
        transaction.objectStore("files").put({ name: "기존.py", content: 'print("보존")', updatedAt: 123 });
        transaction.oncomplete = () => { db.close(); resolve(undefined); };
        transaction.onerror = () => reject(transaction.error);
      };
    };
  }));

  const response = await page.goto(url, { waitUntil: "networkidle" });
  assert.equal(response.status(), 200);
  await page.locator(".cm-content").waitFor();
  const legacy = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("python-learning-lab-files");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, read = db.transaction("files").objectStore("files").get("기존.py");
      read.onsuccess = () => { db.close(); resolve(read.result); };
      read.onerror = () => reject(read.error);
    };
  }));
  assert.deepEqual(legacy, { name: "기존.py", content: 'print("보존")', updatedAt: 123, encoding: "utf-8", byteSize: 15 });

  await page.locator(".import").click();
  const dialog = page.locator(".import-dialog"), select = page.locator(".encoding-select");
  await dialog.waitFor();
  assert.deepEqual(await select.locator("option").allTextContents(), ["자동 감지", "UTF-8", "EUC-KR"]);
  assert.equal(await select.inputValue(), "auto");
  const box = await dialog.boundingBox();
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 360 && box.y + box.height <= 800);
  await page.screenshot({ path: `${outputDirectory}/${label}-mobile-import-dialog.png`, fullPage: true });
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator(".import-choose").click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: "students-euckr.csv", mimeType: "text/csv", buffer: bytes });
  await page.waitForFunction(() => document.querySelector(".console")?.textContent?.includes("EUC-KR로 가져왔습니다."));
  assert.equal(await dialog.isHidden(), true);
  const item = page.locator(".file-item", { hasText: "students-euckr.csv" });
  await item.waitFor({ state: "attached" });
  await page.locator(".files-toggle").click();
  await item.waitFor();
  assert.match(await item.getAttribute("title"), /EUC-KR.*원본 29바이트/);
  await page.screenshot({ path: `${outputDirectory}/${label}-mobile-file-name.png`, fullPage: true });
  await page.locator(".files-toggle").click();

  const imported = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("python-learning-lab-files");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, read = db.transaction("files").objectStore("files").get("students-euckr.csv");
      read.onsuccess = () => { db.close(); resolve(read.result); };
      read.onerror = () => reject(read.error);
    };
  }));
  assert.equal(imported.name, "students-euckr.csv");
  assert.equal(imported.content, expectedText);
  assert.equal(imported.encoding, "euc-kr");
  assert.equal(imported.byteSize, bytes.length);
  assert.ok(imported.updatedAt > 0);

  async function execute(expected) {
    const editor = page.locator(".cm-content");
    await editor.click(); await page.keyboard.press("Control+A"); await page.keyboard.press("Backspace"); await page.keyboard.insertText(code);
    assert.match(await editor.innerText(), /^with open/);
    await page.locator(".run").click();
    await page.waitForFunction(() => !document.querySelector(".run").disabled);
    assert.equal(await page.locator(".console-error").count(), 0);
    const output = (await page.locator(".console-line").allTextContents()).join("");
    assert.equal(output, expected);
    return output;
  }
  const onlineOutput = await execute("민수 90\n지수 95\n");
  await page.reload({ waitUntil: "networkidle" });
  await item.waitFor({ state: "attached" });
  const reopenedOutput = await execute("민수 90\n지수 95\n");
  await page.screenshot({ path: `${outputDirectory}/${label}-online-euckr.png`, fullPage: true });

  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) await page.reload({ waitUntil: "networkidle" });
  const devtools = await context.newCDPSession(page);
  await context.setOffline(true);
  await devtools.send("Network.overrideNetworkState", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".cm-content").waitFor();
  await context.setOffline(true);
  await devtools.send("Network.overrideNetworkState", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await page.waitForFunction(() => !navigator.onLine);
  assert.equal(await page.locator(".connection-status").innerText(), "오프라인 사용 중");
  const offlineOutput = await execute("민수 90\n지수 95\n");
  await page.screenshot({ path: `${outputDirectory}/${label}-offline-euckr.png`, fullPage: true });

  assert.deepEqual(browserErrors, []);
  assert.deepEqual(failedResources, []);
  assert.deepEqual(serverWrites, []);
  const result = { url, fixture: { byteSize: bytes.length, utf8Rejected: true, decoded: expectedText }, migration: legacy, imported, onlineOutput, reopenedOutput, offlineOutput, mobileDialogInsideViewport: true, connectionStatus: "오프라인 사용 중", browserErrors, failedResources, serverWrites };
  await writeFile(`${outputDirectory}/${label}-results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await context.close();
} finally { await browser.close(); }
