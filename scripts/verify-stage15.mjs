import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const url = process.env.APP_URL ?? "http://127.0.0.1:4173/";
const edge = process.env.EDGE_PATH ?? join(process.env["PROGRAMFILES(X86)"] ?? process.env.PROGRAMFILES ?? "", "Microsoft", "Edge", "Application", "msedge.exe");
const outputDirectory = join(process.cwd(), "artifacts", "stage15");
const backupPath = join(outputDirectory, "classroom.pylab-backup.json");
const offlineBackupPath = join(outputDirectory, "offline.pylab-backup.json");
const packageVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const viewports = [[360, 800], [800, 360], [768, 1024], [1024, 768], [1440, 900]];

const documents = [
  ["main.py", 'print("백업 main 정상")'],
  ["조건문.py", 'score = 90\nif score >= 80:\n    print("통과")'],
  ["거북이.py", 'import turtle\n\nt = turtle.Turtle()\nfor number in range(4):\n    t.forward(70)\n    t.right(90)\nturtle.done()'],
  ["memo.txt", "수업 메모\n한글 유지"],
  ["학생목록.csv", "이름,점수\n민수,90\n지수,95"],
];

if (!existsSync(edge)) throw new Error("Microsoft Edge를 찾을 수 없습니다. EDGE_PATH를 지정해 주세요.");
await mkdir(outputDirectory, { recursive: true });

const normalize = value => value.replace(/\r\n/g, "\n").trimEnd();
async function editorText(page) { return normalize((await page.locator(".cm-line").allTextContents()).join("\n")); }
async function replaceCode(page, code) {
  const editor = page.locator(".cm-content"); await editor.click(); await page.keyboard.press("Control+A"); await page.keyboard.press("Backspace"); await page.keyboard.insertText(code);
  assert.equal(await editorText(page), normalize(code));
}
async function dismissWelcome(page) { if (await page.locator(".welcome-dialog").isVisible()) await page.locator(".welcome-close").click(); }
async function saveCurrent(page) { await page.locator(".save").click(); await page.waitForFunction(() => !document.querySelector(".modified")?.textContent?.includes("*")); }
async function saveAs(page, name) {
  await page.locator(".save-as").click(); await page.locator(".name-input").fill(name); await page.locator(".name-confirm").click();
  await page.waitForFunction(expected => document.querySelector(".current-name")?.textContent === expected && !document.querySelector(".modified")?.textContent?.includes("*"), name);
}
async function newDocument(page) { await page.locator(".new-file").click(); await page.waitForFunction(() => document.querySelector(".current-name")?.textContent?.startsWith("새 파일")); }
async function createDocuments(page) {
  await replaceCode(page, documents[0][1]); await saveCurrent(page);
  for (const [name, content] of documents.slice(1)) { await newDocument(page); await replaceCode(page, content); await saveAs(page, name); }
}
async function storedFiles(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("python-learning-lab-files", 2); request.onerror = () => reject(request.error);
    request.onsuccess = () => { const rows = request.result.transaction("files", "readonly").objectStore("files").getAll(); rows.onerror = () => reject(rows.error); rows.onsuccess = () => resolve(rows.result.sort((a, b) => a.name.localeCompare(b.name, "ko"))); };
  }));
}
async function downloadBackup(page, path) {
  const wait = page.waitForEvent("download"); await page.locator(".backup-all").click(); const download = await wait; assert.match(download.suggestedFilename(), /\.pylab-backup\.json$/); await download.saveAs(path); return JSON.parse(readFileSync(path, "utf8"));
}
async function chooseBackup(page, path) {
  const chooserWait = page.waitForEvent("filechooser"); await page.locator(".restore-all").click(); const chooser = await chooserWait; await chooser.setFiles(path); await page.locator(".restore-dialog").waitFor({ state: "visible" });
}
async function restoreBackup(page, path, policy = "keep") {
  const previous = await page.locator(".console").innerText(); await chooseBackup(page, path); await page.locator(`input[name="restore-policy"][value="${policy}"]`).check(); await page.locator(".restore-confirm").click();
  if (await page.locator(".save-layer .save-dialog").isVisible()) await page.locator('.save-layer [data-choice="discard"]').click();
  await page.waitForFunction(before => { const text = document.querySelector(".console")?.textContent ?? ""; return text !== before && text.includes("전체 복원이 완료되었습니다"); }, previous);
}
async function openFile(page, name) { await page.locator(".file-item > span", { hasText: name, exact: true }).click(); if (await page.locator(".save-layer .save-dialog").isVisible()) await page.locator('.save-layer [data-choice="discard"]').click(); await page.waitForFunction(expected => document.querySelector(".current-name")?.textContent === expected, name); }
async function run(page, answers = []) {
  await page.locator(".run").click();
  for (const answer of answers) { await page.locator(".console-input").waitFor(); await page.locator(".console-input").fill(answer); await page.locator(".input-submit").click(); }
  await page.waitForFunction(() => !document.querySelector(".run")?.hasAttribute("disabled")); return page.locator(".console").innerText();
}
async function canvasInk(page) {
  return page.locator(".turtle-canvas").evaluate(canvas => { const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data; let count = 0; for (let index = 0; index < data.length; index += 4) if (data[index + 3] && (Math.abs(data[index] - 244) > 3 || Math.abs(data[index + 1] - 248) > 3 || Math.abs(data[index + 2] - 255) > 3)) count++; return count; });
}
const boxInside = (box, width, height) => box && box.x >= -1 && box.y >= -1 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1;
const overlap = (one, two) => one.x < two.x + two.width && one.x + one.width > two.x && one.y < two.y + two.height && one.y + one.height > two.y;

const browser = await chromium.launch({ executablePath: edge, headless: true, args: ["--disable-gpu"] });
const report = { url, packageVersion, backup: null, cleanRestore: null, conflicts: null, rollback: null, offline: null, viewports: [] };
try {
  const sourceContext = await browser.newContext({ viewport: { width: 1024, height: 768 }, acceptDownloads: true, serviceWorkers: "allow" });
  const source = await sourceContext.newPage(); await source.goto(url, { waitUntil: "networkidle" }); await dismissWelcome(source); await createDocuments(source);
  assert.deepEqual((await storedFiles(source)).map(file => file.name).sort(), documents.map(([name]) => name).sort());

  await openFile(source, "main.py"); await replaceCode(source, 'print("백업에 들어가면 안 되는 미저장 코드")');
  const dirtyDownload = source.waitForEvent("download"); await source.locator(".backup-all").click();
  const labels = await source.locator(".save-layer button").allTextContents(); assert.deepEqual(labels, ["현재 문서 저장 후 백업", "저장하지 않은 상태로 백업", "취소"]);
  await source.locator('.save-layer [data-choice="discard"]').click(); const dirtyBackup = await dirtyDownload; const dirtyPath = join(outputDirectory, "dirty-excluded.pylab-backup.json"); await dirtyBackup.saveAs(dirtyPath);
  assert.ok(!readFileSync(dirtyPath, "utf8").includes("미저장 코드"), "미저장 편집 내용이 백업에 포함됐습니다.");
  await source.locator(".file-item > span", { hasText: "main.py", exact: true }).click(); await source.locator('.save-layer [data-choice="discard"]').click();
  const backupJson = await downloadBackup(source, backupPath);
  assert.equal(backupJson.format, "python-learning-lab-backup"); assert.equal(backupJson.formatVersion, 1); assert.equal(backupJson.appVersion, packageVersion); assert.equal(backupJson.files.length, 5);
  assert.deepEqual(Object.keys(backupJson).sort(), ["appVersion", "createdAt", "files", "format", "formatVersion"]);
  assert.ok(!/(userAgent|localStorage|output|input|errorLine|cookie|token|absolutePath)/i.test(readFileSync(backupPath, "utf8")));
  report.backup = { files: backupJson.files.map(file => file.name), dirtyEditorExcluded: true, encoding: "UTF-8 JSON", bytes: readFileSync(backupPath).byteLength };
  await sourceContext.close();

  const cleanContext = await browser.newContext({ viewport: { width: 1024, height: 768 }, acceptDownloads: true, serviceWorkers: "allow" });
  const page = await cleanContext.newPage(); const pageErrors = []; page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(url, { waitUntil: "networkidle" }); await dismissWelcome(page); assert.equal((await storedFiles(page)).length, 0);
  await chooseBackup(page, backupPath);
  const summary = await page.locator(".restore-dialog").innerText(); assert.match(summary, /백업 파일\s*5개/); assert.match(summary, /새 파일\s*5개/); assert.match(summary, /이름 충돌\s*0개/);
  await page.locator(".restore-confirm").click(); await page.waitForFunction(() => document.querySelector(".console")?.textContent?.includes("전체 복원이 완료되었습니다") ?? false);
  assert.deepEqual((await storedFiles(page)).map(file => file.name).sort(), documents.map(([name]) => name).sort());
  await openFile(page, "main.py"); assert.match(await run(page), /백업 main 정상/);
  await openFile(page, "memo.txt"); assert.equal(await editorText(page), "수업 메모\n한글 유지");
  await openFile(page, "거북이.py"); await run(page); await page.locator(".graphics-tab").click(); assert.ok(await canvasInk(page) > 250);
  await page.reload({ waitUntil: "networkidle" }); await dismissWelcome(page); assert.deepEqual((await storedFiles(page)).map(file => file.name).sort(), documents.map(([name]) => name).sort());
  report.cleanRestore = { preview: true, fiveFiles: true, KoreanContents: true, mainExecuted: true, memoOpened: true, turtleRendered: true, reloadPreserved: true };

  await openFile(page, "main.py"); await replaceCode(page, 'print("기존 파일 유지")'); await saveCurrent(page); await restoreBackup(page, backupPath, "keep"); await openFile(page, "main.py"); assert.equal(await editorText(page), 'print("기존 파일 유지")');
  await restoreBackup(page, backupPath, "overwrite"); await openFile(page, "main.py"); assert.equal(await editorText(page), documents[0][1]);
  await restoreBackup(page, backupPath, "rename"); const renamed = await storedFiles(page); assert.ok(renamed.some(file => file.name === "main (복원 1).py")); assert.equal(renamed.length, 10);
  report.conflicts = { keep: true, overwrite: true, renameAllConflicts: true, renamedExample: "main (복원 1).py" };

  const beforeFailure = JSON.stringify(await storedFiles(page)); await page.evaluate(() => { const original = IDBObjectStore.prototype.put; let first = true; IDBObjectStore.prototype.put = function (...args) { if (first) { first = false; IDBObjectStore.prototype.put = original; throw new DOMException("simulated", "QuotaExceededError"); } return original.apply(this, args); }; });
  await chooseBackup(page, backupPath); await page.locator('input[value="overwrite"]').check(); await page.locator(".restore-confirm").click(); await page.waitForFunction(() => document.querySelector(".console")?.textContent?.includes("기존 파일은 변경되지 않았습니다") ?? false);
  assert.equal(JSON.stringify(await storedFiles(page)), beforeFailure); report.rollback = { forcedTransactionFailure: true, allExistingFilesPreserved: true };

  await page.locator(".help-toggle").click(); await page.waitForFunction(() => document.querySelector(".storage-info")?.textContent?.includes("저장 파일") ?? false); assert.match(await page.locator(".storage-info").innerText(), /저장 파일/); await page.locator(".show-diagnostics").click(); await page.locator(".diagnostics-dialog").waitFor({ state: "visible" }); await page.waitForFunction(() => document.querySelector(".diagnostics-preview")?.textContent?.includes("앱 버전") ?? false); const diagnostics = await page.locator(".diagnostics-preview").innerText();
  assert.ok(diagnostics.includes(`앱 버전: ${packageVersion}`)); assert.match(diagnostics, /저장 파일 수: 10/); assert.ok(!/main\.py|수업 메모|Mozilla\/5\.0|백업 main/.test(diagnostics)); await page.locator(".diagnostics-close").click();

  await page.evaluate(() => navigator.serviceWorker.ready); if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) await page.reload({ waitUntil: "networkidle" });
  const network = await cleanContext.newCDPSession(page); await network.send("Network.enable"); await network.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }); await cleanContext.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" }); await page.locator(".cm-content").waitFor();
  if (await page.evaluate(() => navigator.onLine)) { await network.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await cleanContext.setOffline(false); await network.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }); await cleanContext.setOffline(true); }
  await page.waitForFunction(() => !navigator.onLine);
  const offlineJson = await downloadBackup(page, offlineBackupPath); assert.equal(offlineJson.files.length, 10);
  await restoreBackup(page, offlineBackupPath, "overwrite"); await openFile(page, "main.py"); assert.match(await run(page), /백업 main 정상/);
  await replaceCode(page, 'with open("offline-stage15.txt", "w") as file:\n    file.write("오프라인 파일")\nwith open("offline-stage15.txt", "r") as file:\n    print(file.read())'); assert.match(await run(page), /오프라인 파일/);
  await openFile(page, "거북이.py"); await run(page); await page.locator(".graphics-tab").click(); assert.ok(await canvasInk(page) > 250); await saveAs(page, "offline-turtle.py");
  await page.reload({ waitUntil: "domcontentloaded" }); await page.locator(".cm-content").waitFor();
  if (await page.evaluate(() => navigator.onLine)) { await network.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await cleanContext.setOffline(false); await network.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }); await cleanContext.setOffline(true); }
  await page.waitForFunction(() => !navigator.onLine && document.querySelector(".connection-status")?.textContent?.includes("오프라인")); assert.ok((await storedFiles(page)).some(file => file.name === "main.py"));
  report.offline = { backup: true, restore: true, python: true, fileIo: true, turtle: true, reload: true, serviceWorker: await page.evaluate(() => Boolean(navigator.serviceWorker.controller)) };
  assert.deepEqual(pageErrors, []); await cleanContext.close();

  for (const [width, height] of viewports) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "allow" }); const sized = await context.newPage(); await sized.goto(url, { waitUntil: "networkidle" }); await dismissWelcome(sized);
    await chooseBackup(sized, backupPath); const dialogBox = await sized.locator(".restore-dialog").boundingBox(); const dialogButtons = await Promise.all([".restore-cancel", ".restore-confirm"].map(selector => sized.locator(selector).boundingBox()));
    assert.ok(boxInside(dialogBox, width, height)); assert.ok(dialogButtons.every(box => boxInside(box, width, height))); assert.ok(!overlap(dialogButtons[0], dialogButtons[1])); await sized.screenshot({ path: join(outputDirectory, `restore-preview-${width}x${height}.png`) }); await sized.locator(".restore-cancel").click();
    const layout = await sized.evaluate(() => { const buttons = [...document.querySelectorAll(".topbar button")].filter(button => getComputedStyle(button).display !== "none").map(button => { const rect = button.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, label: button.textContent.trim() }; }); return { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, buttons }; });
    assert.ok(layout.scrollWidth <= layout.clientWidth); assert.ok(layout.buttons.every(box => box.x >= 0 && box.x + box.width <= width + 1)); assert.ok(!layout.buttons.some((box, index) => layout.buttons.slice(index + 1).some(other => overlap(box, other)))); assert.equal(await sized.locator(".current-name").innerText(), "main.py");
    const screenshot = join(outputDirectory, `responsive-${width}x${height}.png`); await sized.screenshot({ path: screenshot, fullPage: true }); report.viewports.push({ viewport: `${width}x${height}`, screenshot, horizontalScroll: false, buttonsOverlap: false, restoreDialogInside: true }); await context.close();
  }
  await writeFile(join(outputDirectory, "browser-report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
