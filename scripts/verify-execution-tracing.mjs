import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { editorText, replaceCode, runCurrent } from "./helpers/editor.mjs";

const url = process.env.TRACE_URL ?? "http://127.0.0.1:4173/pycom/";
const version = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const output = path.resolve(process.env.TRACE_ARTIFACTS ?? "artifacts/execution-tracing/browser");
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" });
const report = { url, version, browser: browser.version(), checks: [], layouts: [], errors: [] };
const loop = 'total = 0\n\nfor number in range(1, 4):\n    total += number\n\nprint(total)';
const input = 'def double(value):\n    return value * 2\n\nnumber = int(input("숫자: "))\nresult = double(number)\nprint(result)';
const turtle = 'import turtle\nt = turtle.Turtle()\nfor side in range(4):\n    t.forward(80)\n    t.left(90)\nturtle.done()';
const controls = ".topbar .execution-controls";
async function ready(page) {
  await page.locator(".editor-host .cm-content").waitFor();
  if (await page.locator(".welcome-dialog").isVisible()) await page.locator(".welcome-close").click();
  assert.equal(await page.locator(".app-version").textContent(), version);
}
async function settled(page, example = false) {
  const root = example ? ".example-controls" : ".topbar", stop = example ? ".example-stop" : ".stop", input = example ? ".example-input-form" : ".input-row";
  await page.waitForFunction(({ root, stop, input }) => document.querySelector(stop)?.disabled || !document.querySelector(`${root} .trace-next`)?.disabled || [...document.querySelectorAll(input)].some(node => node.getClientRects().length), { root, stop, input });
}
async function point(page, example = false) {
  const selector = example ? ".example-code .execution-arrow" : ".workspace .execution-arrow";
  const arrows = page.locator(selector).filter({ visible: true });
  if (!await arrows.count()) return null;
  const label = await arrows.first().getAttribute("aria-label");
  const [, line, column] = label.match(/(\d+)줄 (\d+)열/);
  return [Number(line), Number(column)];
}
async function begin(page, code, mode = "step") {
  await replaceCode(page, code);
  await page.locator(`${controls} .execution-mode`).selectOption(mode);
  await page.locator(".run").click();
  await page.locator('.workspace .execution-arrow').filter({visible:true}).first().waitFor();
  await settled(page);
}
async function next(page, example = false) {
  await page.locator(`${example ? ".example-controls" : controls} .trace-next`).click(); await settled(page, example);
}
async function stop(page) { await page.locator(".stop").click(); await page.waitForFunction(() => document.querySelector(".stop").disabled); }
async function finish(page, example = false, answers = [], visit) {
  const stop = page.locator(example ? ".example-stop" : ".stop"), positions = [];
  for (let index = 0; index < 200 && await stop.isEnabled(); index++) {
    await settled(page, example);
    const current = await point(page, example); positions.push(current);
    await visit?.(current, index);
    const field = page.locator(example ? "#example-answer" : ".console-input");
    if (await field.isVisible()) {
      assert.ok(answers.length, "unexpected input request");
      assert.equal(await page.locator(`${example ? ".example-controls" : controls} .trace-next`).isDisabled(), true);
      await field.fill(answers.shift()); await page.locator(example ? ".example-input-form button" : ".input-submit").click(); await settled(page, example);
    } else if (await stop.isEnabled()) await next(page, example);
  }
  assert.equal(await stop.isDisabled(), true, "bounded program must finish");
  assert.equal(await page.locator(example ? ".example-run" : ".run").isEnabled(), true);
  assert.equal(await point(page, example), null);
  return positions;
}
async function saveAs(page, name) {
  await page.locator(".save-as").click(); await page.locator(".document-dialog-layer .name-input").fill(name);
  await page.locator(".document-dialog-layer .name-confirm").click();
  await page.waitForFunction(name => document.querySelector(".current-name").textContent === name && !document.querySelector(".modified").textContent.includes("*"), name);
}
const tab = (page, name) => page.locator('.document-tabs [role="tab"]').filter({ has: page.getByText(name, { exact: true }) });
async function files(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("python-learning-lab-files", 2); request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result, tx = db.transaction("files", "readonly"), all = tx.objectStore("files").getAll(); tx.oncomplete = () => { db.close(); resolve(all.result.sort((a, b) => a.name.localeCompare(b.name))); }; tx.onabort = () => reject(tx.error); };
  }));
}
async function layout(page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth, scrollWidth = document.documentElement.scrollWidth;
    if (scrollWidth > width) throw Error(`overflow ${scrollWidth}/${width}`);
    const boxes = [...document.querySelectorAll(".topbar button, .topbar select")].filter(node => node.getClientRects().length).map(node => {
      const { x, y, width, height } = node.getBoundingClientRect(); return { name: node.textContent, x, y, width, height, trace: !!node.closest(".execution-controls") };
    });
    for (const b of boxes) if (b.x < -1 || b.x + b.width > width + 1 || b.trace && (b.width < 44 || b.height < 44)) throw Error("control bounds: " + JSON.stringify(b));
    for (let i = 0; i < boxes.length; i++) for (const b of boxes.slice(i + 1)) { const a = boxes[i]; if (a.x < b.x+b.width-1 && a.x+a.width > b.x+1 && a.y < b.y+b.height-1 && a.y+a.height > b.y+1) throw Error("overlap " + a.name + "/" + b.name); }
    return { width, scrollWidth, boxes };
  });
}
async function measureEditorForCapture(page) {
  // At 200% the editor can be below the fold. Let CodeMirror measure wrapped lines
  // while visible before a full-page image includes its otherwise estimated gutters.
  await page.locator('.editor-host .cm-line').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const line = [...document.querySelectorAll('.editor-host .cm-line')].find(node => node.textContent.startsWith('for number'));
    const gutter = [...document.querySelectorAll('.editor-host .cm-lineNumbers .cm-gutterElement')].find(node => node.textContent === '3' && getComputedStyle(node).visibility !== 'hidden');
    return line && gutter && Math.abs(line.getBoundingClientRect().top - gutter.getBoundingClientRect().top) < 2;
  });
  await page.evaluate(() => scrollTo(0, 0));
}
async function follow(page) {
  await begin(page, loop, "follow");
  await page.locator(`${controls} .trace-pause`).click();
  await page.waitForFunction(() => document.querySelector(".topbar .trace-pause").textContent === "계속 실행");
  const before = await point(page); await page.waitForTimeout(650); assert.deepEqual(await point(page), before);
  await page.locator(`${controls} .trace-speed`).selectOption("100");
  await page.locator(`${controls} .trace-pause`).click();
  await page.waitForFunction(() => document.querySelector(".stop").disabled);
  assert.equal(await page.locator(".console").textContent(), "6\n");
}
async function scenarios(page, label) {
  await begin(page, loop);
  assert.deepEqual(await point(page), [1, 1]);
  await page.waitForTimeout(600); assert.deepEqual(await point(page), [1, 1]);
  assert.equal(await page.locator(".console").textContent(), "");
  const positions = await finish(page);
  assert.deepEqual(positions.map(p => p?.[0]), [1,3,4,3,4,3,4,3,6]);
  assert.equal(await page.locator(".console").textContent(), "6\n");
  await follow(page);
  await begin(page, 'for value in [input("값: ")]:\n    print(value)');
  assert.deepEqual(await point(page), [1,1]);
  assert.equal(await page.locator('.console-input').count(), 0, 'first for must pause before requesting input');
  await next(page); await page.locator('.console-input').waitFor();
  await page.locator('.console-input').fill('확인'); await page.locator('.input-submit').click(); await settled(page);
  assert.deepEqual(await point(page), [2,5]);
  await finish(page); assert.equal(await page.locator('.console').textContent(), '값: 확인\n확인\n');
  await begin(page, input); const inputPositions = await finish(page, false, ["5"]);
  assert.ok(inputPositions.some(p => p?.[0] === 2));
  assert.equal(await page.locator(".console").textContent(), "숫자: 5\n10\n");
  await begin(page, 'try:\n    raise ValueError("확인")\nexcept ValueError:\n    print("처리")\nfinally:\n    print("정리")');
  const finallyPositions = await finish(page);
  assert.deepEqual(finallyPositions.map(p => p?.[0]), [2,4,6]);
  assert.equal(await page.locator(".console").textContent(), "처리\n정리\n");
  await begin(page, turtle);
  const images = new Set();
  await finish(page, false, [], async current => { if (current?.[0] === 5) images.add(await page.locator(".turtle-canvas").evaluate(canvas => canvas.toDataURL())); });
  assert.equal(images.size, 4, "four distinct incremental turtle drawings");
  await begin(page, 'input("중지: ")\nprint("실행되면 안 됨")'); await next(page);
  await page.locator(".console-input").waitFor(); await stop(page);
  assert.equal(await page.locator(".console-input").count(), 0);
  await begin(page, 'print("재실행")'); await finish(page); assert.equal(await page.locator(".console").textContent(), "재실행\n");
  await begin(page, "print(10 / 0)"); await finish(page);
  assert.match(await page.locator(".console").textContent(), /0으로 나눌 수 없습니다/);
  assert.equal(await page.locator(".cm-student-error").count(), 1);
  await replaceCode(page, input); await page.locator(`${controls} .execution-mode`).selectOption("normal"); await page.locator(".run").click(); await page.locator(".console-input").waitFor();
  assert.deepEqual(await point(page), [4,1]);
  assert.equal(await page.locator(".editor-host .cm-content").getAttribute("contenteditable"), "true");
  await page.locator(".console-input").fill("5"); await page.locator(".input-submit").click(); await page.waitForFunction(() => document.querySelector(".stop").disabled);
  assert.equal(await point(page), null); assert.equal(await page.locator(".console").textContent(), "숫자: 5\n10\n");
  await begin(page, input, "follow"); await page.locator(".console-input").waitFor();
  assert.deepEqual(await point(page), [4,1]); await page.locator(".console-input").fill("5"); await page.locator(".input-submit").click();
  await page.waitForFunction(() => document.querySelector(".stop").disabled); assert.equal(await page.locator(".console").textContent(), "숫자: 5\n10\n");
  // A virtualized document: inspect both endpoints with real keyboard navigation.
  const longSource = ['print("처음")', ...Array(70).fill('# 화면 밖 실행 위치'), 'print("끝")'].join('\n');
  await page.locator('.editor-host .cm-content').click(); await page.keyboard.press('Control+A'); await page.keyboard.insertText(longSource);
  await page.keyboard.press('Control+Home'); assert.match(await page.locator('.editor-host .cm-line').first().textContent(), /처음/);
  await page.keyboard.press('Control+End'); assert.match(await page.locator('.editor-host .cm-line').last().textContent(), /끝/);
  await page.locator(`${controls} .execution-mode`).selectOption('step'); await page.locator('.run').click(); await settled(page);
  await page.locator('.editor-host .cm-execution-line').filter({hasText:'처음'}).waitFor();
  const bodyScroll = await page.evaluate(()=>scrollY); await next(page);
  await page.locator('.editor-host .cm-execution-line').filter({hasText:'끝'}).waitFor();
  assert.equal(await page.evaluate(()=>scrollY),bodyScroll); assert.ok(await page.locator('.editor-host .cm-scroller').evaluate(node=>node.scrollTop>0));
  await finish(page); assert.equal(await page.locator('.console').textContent(),'처음\n끝\n');
  report.checks.push({ label, loop: positions, input: inputPositions, finally: finallyPositions, turtleFrames: images.size, stopRestart: true, errorRecovery: true });
}
async function moduleScenario(page, label) {
  const saved = 'def double(value):\n    return value * 2';
  await page.locator(".new-file").click(); await replaceCode(page, saved); await saveAs(page, "helper.py");
  await page.locator(".editor-host .cm-content").click(); await page.keyboard.press("Control+End"); await page.keyboard.insertText("\n# 보존할 편집 초안");
  const draft = await editorText(page);
  await page.locator(".new-file").click(); await replaceCode(page, 'import helper\nprint(helper.double(5))'); await saveAs(page, "lesson.py");
  await page.locator(`${controls} .execution-mode`).selectOption("step"); await page.locator(".run").click(); await settled(page);
  assert.equal(await page.locator(".editor-host .cm-content").getAttribute("contenteditable"), "false");
  await tab(page, "lesson.py").locator("..").locator(".document-close").click();
  assert.match(await page.locator(".document-dialog-layer").textContent(), /먼저 중지/); await page.keyboard.press("Escape");
  await next(page);
  assert.match(await page.locator(".execution-source-label").textContent(), /helper.py.*실행 중인 저장본/);
  assert.equal(await page.locator(".execution-source-code .cm-content").getAttribute("contenteditable"), "false");
  await tab(page, "helper.py").click(); assert.equal(await editorText(page), draft);
  assert.equal(await page.locator(".editor-host .cm-content").getAttribute("contenteditable"), "false");
  await page.locator(".new-file").click(); await replaceCode(page, '# 다른 문서는 편집 가능');
  assert.equal(await page.locator(".editor-host .cm-content").getAttribute("contenteditable"), "true");
  await finish(page); assert.equal(await page.locator(".console").textContent(), "10\n");
  await tab(page, "helper.py").click(); assert.equal(await editorText(page), draft);
  assert.match(await page.locator(".modified").textContent(), /\*/);
  await page.locator(".editor-host .cm-content").click(); await page.keyboard.press("Control+z"); assert.equal(await editorText(page), saved);
  await page.keyboard.press("Control+y"); assert.equal(await editorText(page), draft);
  assert.equal((await files(page)).find(f => f.name === "helper.py").content, saved);
  await page.locator(".new-file").click(); await replaceCode(page, 'def fail():\n    return 10 / 0'); await saveAs(page, "broken.py");
  await replaceCode(page, '# 오류 줄을 잘못 강조하면 안 되는 초안');
  await tab(page, "lesson.py").click(); await begin(page, 'import broken\nbroken.fail()'); await finish(page);
  assert.match(await page.locator(".execution-source-label").textContent(), /broken.py.*실행 중인 저장본/);
  assert.equal(await page.locator(".execution-source-code .cm-student-error").textContent(), "    return 10 / 0");
  await tab(page, "broken.py").click(); assert.equal(await editorText(page), '# 오류 줄을 잘못 강조하면 안 되는 초안');
  assert.equal(await page.locator(".editor-host .cm-content").getAttribute("contenteditable"), "true");
  await tab(page, "lesson.py").click();
  report.checks.push({ label, moduleSavedSnapshot: true, draftAndUndo: true, participatingReadonly: true, otherDocumentEditable: true });
}
async function examples(page, label) {
  const before = await files(page);
  await page.goto(url + "#/examples/core-v2-modules"); await page.locator(".example-run").waitFor();
  await page.locator(".example-controls .execution-mode").selectOption("step"); await page.locator(".example-run").click(); await settled(page, true);
  let moduleVisible = false;
  await finish(page, true, [], async () => { if ((await page.locator(".textbook-detail").textContent()).includes("실행 중인 저장본")) moduleVisible = true; });
  assert.equal(await page.locator(".example-output").textContent(), "7\n"); assert.equal(moduleVisible, true);
  await page.goto(url + "#/examples/core-v2-finally"); await page.locator(".example-controls .execution-mode").selectOption("step");
  await page.locator(".example-run").click(); await finish(page, true);
  assert.equal(await page.locator(".example-output").textContent(), "검사 완료\n17\n");
  await page.goto(url + "#/examples/page-122-greeting"); await page.locator(".example-controls .execution-mode").selectOption("step");
  await page.locator(".example-run").click(); await finish(page, true, ["민수"]);
  assert.equal(await page.locator(".example-output").textContent(), "안녕하세요, 민수\n");
  await page.goto(url + "#/examples/page-153-turtle-square"); await page.locator(".example-controls .execution-mode").selectOption("step");
  await page.locator(".example-run").click(); const drawings = new Set();
  await finish(page, true, [], async current => { if (current?.[0] === 7) drawings.add(await page.locator(".example-canvas").evaluate(canvas => canvas.toDataURL())); });
  assert.equal(drawings.size, 4); assert.equal(await page.locator(".example-canvas").isVisible(), true);
  await page.locator(".example-controls .execution-mode").selectOption("follow"); await page.locator(".example-controls .trace-speed").selectOption("100"); await page.locator(".example-run").click();
  await page.waitForFunction(() => document.querySelector(".example-stop").disabled);
  assert.equal(await page.locator(".example-output").textContent(), ""); assert.equal(await page.locator(".example-canvas").isVisible(), true);
  assert.deepEqual(await files(page), before);
  await page.goto(url + "#/editor"); await ready(page);
  report.checks.push({ label, examplesModuleAndFinally: true, examplesInputAndTurtle: true, isolatedFiles: true });
}
try {
  const dimensions = process.env.TRACE_QUICK ? [[1440,900],[360,800]] : [[360,800],[800,360],[768,1024],[1024,768],[1440,900]];
  for (const [width, height] of dimensions) {
    const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
    const page = await context.newPage(), label = `${width}x${height}`;
    page.setDefaultTimeout(12000); page.on("dialog", dialog => dialog.accept());
    page.on("pageerror", error => report.errors.push(label + ": " + error.message));
    page.on("response", response => { if (response.status() >= 400) report.errors.push(`${label}: ${response.status()} ${response.url()}`); });
    try {
      assert.equal((await page.goto(url)).status(), 200); await ready(page);
      await scenarios(page, label);
      await begin(page, loop);
      await measureEditorForCapture(page);
      report.layouts.push({ label, zoom: 100, ...await layout(page) });
      await page.screenshot({ path: path.join(output, `responsive-${label}.png`), fullPage: true });
      await page.locator(`${controls} .trace-next`).focus(); await page.keyboard.press("Enter"); await settled(page); assert.deepEqual(await point(page), [3,1]);
      await stop(page);
      if (!process.env.TRACE_QUICK) {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: Math.floor(width/2), height: Math.floor(height/2), deviceScaleFactor: 2, mobile: false });
        await begin(page, loop); await measureEditorForCapture(page); report.layouts.push({ label, zoom: 200, ...await layout(page) });
        // Full-page Playwright capture resets the tracked, unzoomed metrics. Keep the real CDP reflow.
        const clip = await page.evaluate(() => ({ x: 0, y: 0, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, scale: 1 }));
        const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip });
        fs.writeFileSync(path.join(output, `zoom-200-${label}.png`), Buffer.from(shot.data, "base64"));
        await page.locator(`${controls} .trace-next`).click(); await settled(page); await stop(page);
        await cdp.send("Emulation.clearDeviceMetricsOverride"); await page.setViewportSize({ width, height });
      }
      if (width === 360 || width === 1440) {
        await moduleScenario(page, label); await examples(page, label);
        const original = await files(page), savedTabs = await page.locator(".document-tab-name").allTextContents();
        const downloadPromise = page.waitForEvent("download"); await page.locator(".backup-all").click();
        if (await page.locator('.document-dialog-layer [data-choice="discard"]').isVisible()) await page.locator('.document-dialog-layer [data-choice="discard"]').click();
        const download = await downloadPromise, backupPath = path.join(output, `saved-${label}.pylab-backup.json`); await download.saveAs(backupPath);
        const backup = JSON.parse(fs.readFileSync(backupPath, "utf8")); assert.equal(backup.files.length, original.length);
        await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
        await context.setOffline(true); await page.reload(); await ready(page);
        // Edge may restore an existing network override on reload; reapply both state and transport.
        await context.setOffline(true); const offline = await context.newCDPSession(page);
        await offline.send("Network.enable"); await offline.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        assert.equal(await page.evaluate(() => navigator.onLine), false);
        assert.equal(await page.evaluate(() => fetch("offline-proof-" + Date.now(), { cache: "no-store" }).then(() => false, () => true)), true);
        assert.equal(await page.locator(`${controls} .execution-mode`).inputValue(), "normal");
        assert.deepEqual(await files(page), original);
        assert.ok(savedTabs.includes("helper.py") && (await page.locator(".document-tab-name").allTextContents()).includes("helper.py"));
        await scenarios(page, label + " offline");
        await tab(page, "lesson.py").click(); await begin(page, 'import helper\nprint(helper.double(5))'); await finish(page); assert.equal(await page.locator(".console").textContent(), "10\n");
        await examples(page, label + " offline"); assert.deepEqual(await files(page), original);
        report.checks.push({ label, offline: true, unchangedFiles: original.length, backupFiles: backup.files.length, savedTabsRestored: true });
      }
      console.log(label + " passed");
    } catch (error) { await page.screenshot({ path: path.join(output, `failure-${label}.png`), fullPage: true }).catch(() => {}); throw error; }
    finally { await context.close(); }
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, layouts: report.layouts.length, output }));
