import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { chromium } from "playwright-core";
import { editorText, replaceCode, runCurrent } from "./helpers/editor.mjs";

const output = path.resolve(process.env.CLEANUP_ARTIFACTS ?? "artifacts/code-cleanup-stage2/browser");
const currentRoot = path.resolve("dist");
const baselineRoot = process.env.BASELINE_DIST ? path.resolve(process.env.BASELINE_DIST) : undefined;
const previousLayouts = process.env.PREVIOUS_LAYOUT_RESULTS ? JSON.parse(fs.readFileSync(process.env.PREVIOUS_LAYOUT_RESULTS, "utf8")) : undefined;
let servedRoot = baselineRoot ?? currentRoot;
fs.mkdirSync(output, { recursive: true });
// Read-only static preview; switching roots exercises a real Service Worker update.
// No application endpoints, test hooks, real profiles, or database deletion.
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = http.createServer((request, response) => {
  try {
    if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405).end(); return; }
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = path.resolve(servedRoot, "." + (pathname === "/" ? "/index.html" : pathname));
    const relative = path.relative(servedRoot, file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) { response.writeHead(403).end(); return; }
    const bytes = fs.readFileSync(file);
    response.writeHead(200, { "Content-Type": mime[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    response.end(request.method === "HEAD" ? undefined : bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port + "/";
const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const report = { url, browser: browser.version(), baseline: null, viewports: [], errors: [], layoutErrors: [] };
const inputCode = 'name = input("이름: ")\nprint(f"안녕하세요, {name}")';
const moduleCode = "from helper import add\nprint(add(3, 4))";
const turtleCode = "import turtle\nt = turtle.Turtle()\nt.forward(80)\nturtle.done()";
function observe(page, label) {
  const workers = [];
  page.on("worker", worker => workers.push(worker.url()));
  page.on("pageerror", error => report.errors.push(label + ": " + String(error)));
  page.on("console", message => { if (message.type() === "error") report.errors.push(label + ": " + message.text()); });
  page.on("response", response => { if (response.status() >= 400) report.errors.push(label + ": " + response.status() + " " + response.url()); });
  return workers;
}
async function ready(page) {
  await page.locator(".editor-host .cm-content").waitFor();
  if (await page.locator(".welcome-dialog").isVisible()) await page.locator(".welcome-close").click();
}
async function clean(page) { await page.waitForFunction(() => !document.querySelector(".modified").textContent.includes("*")); }
async function saveAs(page, name) {
  await page.locator(".save-as").click();
  await page.locator(".document-dialog-layer .name-input").fill(name);
  await page.locator(".document-dialog-layer .name-confirm").click();
  await page.waitForFunction(name => document.querySelector(".current-name").textContent === name, name);
  await clean(page);
  assert.equal(await page.locator(".current-name").textContent(), name);
}
async function save(page) { await page.locator(".save").click(); await clean(page); }
const tab = (page, name) => page.locator('.document-tabs [role="tab"]').filter({ has: page.getByText(name, { exact: true }) });
async function openFile(page, name) {
  if (!await page.locator(".file-panel").isVisible()) await page.locator(".files-toggle").click();
  await page.locator(".file-item").filter({ has: page.getByText(name, { exact: true }) }).click();
  assert.equal(await page.locator(".current-name").textContent(), name);
}
async function storedFiles(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("python-learning-lab-files", 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction("files", "readonly"), all = transaction.objectStore("files").getAll();
      all.onerror = () => reject(all.error);
      transaction.oncomplete = () => { db.close(); resolve(all.result.sort((a, b) => a.name.localeCompare(b.name, "ko"))); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  }));
}
async function backup(page, name) {
  const downloaded = page.waitForEvent("download");
  await page.locator(".backup-all").click();
  const file = path.join(output, name), download = await downloaded;
  assert.match(download.suggestedFilename(), /\.pylab-backup\.json$/); await download.saveAs(file);
  return { path: file, data: JSON.parse(fs.readFileSync(file, "utf8")) };
}
async function restoreKeep(page, file) {
  const chosen = page.waitForEvent("filechooser");
  await page.locator(".restore-all").click(); await (await chosen).setFiles(file);
  await page.locator(".restore-dialog").waitFor({ state: "visible" });
  await page.locator('input[name="restore-policy"][value="keep"]').check();
  await page.locator(".restore-confirm").click();
  await page.waitForFunction(() => document.querySelector(".console").textContent.includes("전체 복원이 완료되었습니다."));
  await page.waitForFunction(() => !document.querySelector(".workspace").inert);
}
async function serviceWorkerReady(page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}
async function runCode(page, code, answers, workers) {
  await replaceCode(page, code); const count = workers.length;
  const text = await runCurrent(page, answers);
  assert.equal(workers.length - count, 1, "one click must create exactly one Worker");
  assert.equal(await page.locator(".console-status").count(), 0);
  return text;
}
async function assertLayout(page) {
  await page.evaluate(() => scrollTo(0, 0));
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > width) throw Error("horizontal overflow");
    const buttons = [...document.querySelectorAll(".topbar button")].filter(button => button.getClientRects().length);
    const boxes = buttons.map(button => { const r = button.getBoundingClientRect(); return { name: button.textContent, x: r.x, y: r.y, width: r.width, height: r.height }; });
    const touch = matchMedia("(max-width: 760px), (max-height: 600px)").matches;
    for (const box of boxes) if (box.x < -1 || box.x + box.width > width + 1 || box.height < (touch ? 44 : 24) || touch && box.width < 44) throw Error("button bounds: " + box.name);
    for (let i = 0; i < boxes.length; i++) for (const other of boxes.slice(i + 1)) {
      const box = boxes[i];
      if (box.x < other.x + other.width - 1 && box.x + box.width > other.x + 1 && box.y < other.y + other.height - 1 && box.y + box.height > other.y + 1) throw Error("overlap: " + box.name + "/" + other.name);
    }
    return { width, scrollWidth: document.documentElement.scrollWidth, buttons: boxes };
  });
}
async function focusDialog(page) {
  await page.locator(".help-toggle").click();
  await page.waitForFunction(() => document.activeElement?.classList.contains("help-close"));
  const selectors = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
  const bounds = await page.locator(".help-dialog").boundingBox(), viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= viewport.width + 1);
  assert.ok(bounds.y >= -1 && bounds.y + bounds.height <= viewport.height + 1);
  await page.locator(".help-dialog").evaluate((dialog, selectors) => [...dialog.querySelectorAll(selectors)].filter(node => !node.hidden)[0].focus(), selectors);
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.locator(".help-close").evaluate(node => node === document.activeElement), true);
  await page.keyboard.press("Tab");
  assert.equal(await page.locator(".help-dialog").evaluate((dialog, selectors) => [...dialog.querySelectorAll(selectors)].filter(node => !node.hidden)[0] === document.activeElement, selectors), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".help-toggle").evaluate(node => node === document.activeElement), true);
}
async function canvasInk(page) {
  await page.locator(".turtle-canvas").waitFor({ state: "visible" });
  assert.equal(await page.locator(".turtle-canvas").evaluate(canvas => {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 4; i < data.length; i += 4) if (data[i] !== data[0] || data[i + 1] !== data[1] || data[i + 2] !== data[2]) return true;
    return false;
  }), true);
}
try {
  if (baselineRoot) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    try {
      const page = await context.newPage(); observe(page, "upgrade");
      await page.goto(url); await ready(page); await serviceWorkerReady(page);
      await replaceCode(page, 'print("기존 파일")'); await saveAs(page, "기존.py");
      await page.locator(".new-file").click(); await replaceCode(page, "한글,자료\n민수,90"); await saveAs(page, "기존.csv");
      const original = await storedFiles(page), oldBackup = await backup(page, "v2.0.1.pylab-backup.json");
      const savedTabs = await page.locator(".document-tab-name").allTextContents();
      await replaceCode(page, "저장하지 않은 변경"); servedRoot = currentRoot;
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
      await page.locator(".update").waitFor({ state: "visible" });
      let reloads = 0; page.on("load", () => reloads++);
      await page.locator(".update").click(); await page.locator('.document-dialog-layer [data-choice="cancel"]').click();
      assert.equal(await editorText(page), "저장하지 않은 변경"); assert.equal(reloads, 0);
      assert.deepEqual(await storedFiles(page), original);
      await page.locator(".update").click();
      await Promise.all([page.waitForEvent("load"), page.locator('.document-dialog-layer [data-choice="discard"]').click()]);
      await ready(page); assert.deepEqual(await storedFiles(page), original);
      assert.deepEqual(await page.locator(".document-tab-name").allTextContents(), savedTabs);
      await restoreKeep(page, oldBackup.path); assert.deepEqual(await storedFiles(page), original);
      const newBackup = await backup(page, "after-update.pylab-backup.json"); assert.deepEqual(newBackup.data.files, oldBackup.data.files);
      report.baseline = { updateCancelPreserved: true, actualServiceWorkerUpdate: true, savedTabs, unchangedFilesAndMetadata: original.length, backupCompatible: true };
    } finally { await context.close(); }
  }
  servedRoot = currentRoot;
  for (const [width, height] of [[360,800],[800,360],[768,1024],[1024,768],[1440,900]]) {
    const name = width + "x" + height;
    const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
    const page = await context.newPage(), workers = observe(page, name);
    try {
      assert.equal((await page.goto(url)).status(), 200); await ready(page);
      assert.equal(await editorText(page), 'print("Hello World")');
      assert.equal(await runCode(page, 'print("Hello World")', [], workers), "Hello World\n"); await saveAs(page, "lesson.py");
      await page.locator(".editor-host .cm-content").click(); await page.keyboard.press("Control+End"); await page.keyboard.insertText("\n# 탭별 실행 취소");
      await page.locator(".new-file").click(); await replaceCode(page, 'print("다른 탭")'); await saveAs(page, "other.py");
      await tab(page, "lesson.py").click(); await page.locator(".editor-host .cm-content").click(); await page.keyboard.press("Control+z");
      assert.equal(await editorText(page), 'print("Hello World")');
      await page.keyboard.press("Control+y"); assert.match(await editorText(page), /탭별 실행 취소/);
      await replaceCode(page, 'print("Hello World")'); await save(page); await saveAs(page, "복사.py");
      assert.ok((await storedFiles(page)).some(file => file.name === "lesson.py" && file.content === 'print("Hello World")'));
      await replaceCode(page, 'print("미저장")');
      await tab(page, "복사.py").locator("..").locator(".document-close").click();
      await page.locator('.document-dialog-layer [data-choice="cancel"]').click(); assert.equal(await editorText(page), 'print("미저장")');
      await tab(page, "복사.py").locator("..").locator(".document-close").click(); await page.locator('.document-dialog-layer [data-choice="discard"]').click();
      await openFile(page, "lesson.py");
      assert.equal(await runCode(page, "x = 10", [], workers), "");
      assert.equal(await runCode(page, 'print("실행 중...")', [], workers), "실행 중...\n");
      assert.equal(await runCode(page, inputCode, ["민수"], workers), "이름: 민수\n안녕하세요, 민수\n");
      assert.match(await runCode(page, "print(10 / 0)", [], workers), /1번째 줄: 0으로 나눌 수 없습니다/);
      assert.equal(await page.locator(".cm-student-error").count(), 1);
      await replaceCode(page, 'input("중지 확인: ")'); await page.locator(".run").click(); await page.locator(".console-input").waitFor();
      await page.locator(".stop").click(); await page.waitForFunction(() => document.querySelector(".stop").disabled);
      assert.equal(await runCode(page, 'print("재실행")', [], workers), "재실행\n");
      await replaceCode(page, inputCode); await save(page);
      await page.locator(".new-file").click(); await replaceCode(page, "def add(a, b):\n    return a + b"); await saveAs(page, "helper.py");
      await tab(page, "lesson.py").click(); assert.equal(await runCode(page, moduleCode, [], workers), "7\n"); await save(page);
      await page.goto(url + "#/examples/page-120-accumulate"); await page.reload();
      await page.locator(".example-run").click(); await page.waitForFunction(() => !document.querySelector(".example-run").disabled);
      assert.equal(await page.locator(".example-output").textContent(), "12 42\n");
      const priorFiles = await storedFiles(page), exampleCode = (await page.locator(".example-code .cm-line").allTextContents()).join("\n");
      await page.locator(".example-edit").click(); await page.locator(".editor-host .cm-content").waitFor({ state: "visible" });
      assert.equal(await editorText(page), exampleCode.trimEnd()); assert.match(await page.locator(".modified").textContent(), /\*/);
      assert.deepEqual(await storedFiles(page), priorFiles);
      await page.goBack(); await page.locator(".example-run").waitFor(); await page.goForward(); await page.locator(".editor-host .cm-content").waitFor({ state: "visible" });
      await page.locator(".document-tab-wrap.active .document-close").click(); await page.locator('.document-dialog-layer [data-choice="discard"]').click();
      await tab(page, "lesson.py").click();
      assert.equal(await runCode(page, 'with open("메모.txt", "w") as file:\n    file.write("한글 파일")\nwith open("메모.txt") as file:\n    print(file.read())', [], workers), "한글 파일\n");
      await page.locator(".file-item span").filter({ hasText: "메모.txt" }).waitFor({ state: "attached" });
      assert.equal(await runCode(page, turtleCode, [], workers), ""); await canvasInk(page); await focusDialog(page);
      const layout = await assertLayout(page);
      if (previousLayouts) assert.deepEqual(layout, previousLayouts.viewports.find(viewport => viewport.viewport === name).layout, "normal-scale header geometry must stay unchanged");
      await page.screenshot({ path: path.join(output, "responsive-" + name + ".png"), fullPage: true });
      // Real Chromium reflow at the effective CSS viewport for 200% zoom, not mocked DOM sizes.
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: Math.floor(width/2), height: Math.floor(height/2), deviceScaleFactor: 2, mobile: false });
      let zoomLayout;
      try { zoomLayout = await assertLayout(page); }
      catch (error) { report.layoutErrors.push({ viewport: name, scale: 2, error: String(error) }); }
      await focusDialog(page);
      if (width === 360) {
        // Exercise real keyboard and dialog controls at the effective 180px width.
        const documentButton = tab(page, "lesson.py");
        await documentButton.scrollIntoViewIfNeeded(); await documentButton.focus();
        await page.keyboard.press("ArrowRight"); await page.keyboard.press("Enter");
        assert.equal(await page.locator(".current-name").textContent(), "helper.py");
        await tab(page, "lesson.py").click();
        assert.equal(await runCode(page, inputCode, ["민수"], workers), "이름: 민수\n안녕하세요, 민수\n");
        await page.locator(".save-as").click();
        const nameBox = await page.locator(".document-dialog-layer .name-input").boundingBox();
        assert.ok(nameBox.x >= 0 && nameBox.x + nameBox.width <= 180);
        await page.keyboard.press("Escape");
        assert.equal(await page.locator(".save-as").evaluate(node => node === document.activeElement), true);
        await page.locator(".document-tab-wrap.active .document-close").click();
        const choices = page.locator(".document-dialog-layer [data-choice]");
        assert.equal(await choices.count(), 3);
        for (const button of await choices.all()) {
          await button.scrollIntoViewIfNeeded(); const box = await button.boundingBox();
          assert.ok(box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= 180);
        }
        await page.locator('.document-dialog-layer [data-choice="cancel"]').click();
        await page.locator(".document-tabs").evaluate(strip => { strip.scrollLeft = 0; });
        for (const selector of [".document-add", ".document-opened", ".document-tab-wrap.active [role=tab]", ".document-tab-wrap.active .document-close"]) {
          const control = page.locator(selector); await control.scrollIntoViewIfNeeded(); const box = await control.boundingBox();
          assert.ok(box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= 180, selector);
        }
        await assertLayout(page);
      }
      // Capture with the same CDP metrics: Playwright fullPage can temporarily
      // restore its tracked (unzoomed) viewport and crop an emulated viewport.
      const zoomClip = await page.evaluate(() => ({ x: 0, y: 0, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, scale: 1 }));
      const zoomShot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: zoomClip });
      fs.writeFileSync(path.join(output, "zoom-200-" + name + ".png"), Buffer.from(zoomShot.data, "base64"));
      await cdp.send("Emulation.clearDeviceMetricsOverride"); await page.setViewportSize({ width, height });
      await cdp.detach();
      await replaceCode(page, inputCode); await save(page); await serviceWorkerReady(page); await page.reload(); await ready(page);
      const savedTabs = await page.locator(".document-tab-name").allTextContents();
      await context.setOffline(true); await page.reload(); await ready(page);
      await page.waitForFunction(() => document.querySelector(".connection-status").textContent.includes("오프라인"));
      assert.match(await page.locator(".connection-status").textContent(), /오프라인/);
      assert.deepEqual(await page.locator(".document-tab-name").allTextContents(), savedTabs);
      assert.equal(await runCode(page, inputCode, ["민수"], workers), "이름: 민수\n안녕하세요, 민수\n");
      assert.equal(await runCode(page, moduleCode, [], workers), "7\n");
      assert.equal(await runCode(page, 'with open("메모.txt") as file:\n    print(file.read())', [], workers), "한글 파일\n");
      assert.equal(await runCode(page, turtleCode, [], workers), ""); await canvasInk(page);
      await replaceCode(page, inputCode); await save(page);
      await page.locator(".new-file").click(); await replaceCode(page, 'print("오프라인 저장")'); await saveAs(page, "offline.py");
      await tab(page, "lesson.py").click(); await openFile(page, "offline.py"); assert.equal(await editorText(page), 'print("오프라인 저장")');
      const snapshot = await storedFiles(page), copy = await backup(page, "offline-" + name + ".pylab-backup.json");
      await restoreKeep(page, copy.path); assert.deepEqual(await storedFiles(page), snapshot);
      await page.reload(); await ready(page); assert.equal(await runCurrent(page), "오프라인 저장\n");
      await page.goto(url + "#/examples/page-120-accumulate"); await page.locator(".example-run").click(); await page.waitForFunction(() => !document.querySelector(".example-run").disabled);
      assert.equal(await page.locator(".example-output").textContent(), "12 42\n");
      report.viewports.push({ viewport: name, layout, zoomLayout, initial: true, tabsUndoRedo: true, saveAs: true, closeCancel: true, input: "안녕하세요, 민수", errorLine: true, stopRestart: true, module: "7", textbook: "12 42", exampleImportNotSaved: true, files: true, turtle: true, focus: true, offline: true, backupRestoreMetadata: true, workers: workers.length });
      console.log("PASS " + name);
    } finally { await context.close(); }
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.layoutErrors, [], "all 200% reflow checks must pass");
} catch (error) { report.failure = String(error.stack ?? error); throw error; }
finally {
  fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(report, null, 2));
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
