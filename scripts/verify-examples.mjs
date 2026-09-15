import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const base = process.env.EXAMPLES_URL ?? "http://localhost:4173/pycom/";
const directory = process.env.EXAMPLES_ARTIFACTS ?? "artifacts/textbook-browser";
await mkdir(directory, { recursive: true });
const executablePath = join(process.env["PROGRAMFILES(X86)"] ?? process.env.PROGRAMFILES, "Microsoft/Edge/Application/msedge.exe");
const browser = await chromium.launch({ executablePath, headless: true, args: ["--disable-gpu"] });
const results = [], errors = [], badResponses = [], writes = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage(); page.on("dialog", dialog => dialog.accept());
page.on("pageerror", error => errors.push(error.message));
page.on("response", response => { if (response.status() >= 400) badResponses.push([response.url(), response.status()]); });
page.on("request", request => { if (!["GET", "HEAD"].includes(request.method())) writes.push(request.url()); });
const record = name => { results.push({ name, passed: true }); console.log(`PASS ${name}`); };
async function welcome(p) { await p.locator(".editor-host .cm-content").waitFor({ state: "attached" }); if (await p.locator(".welcome-dialog").isVisible()) await p.locator(".welcome-close").click(); }
async function navigate(id, p = page) {
  await p.evaluate(hash => { location.hash = hash; }, id ? `#/examples/${id}` : "#/examples");
  if (id) await p.locator(".textbook-detail h2").waitFor(); else await p.locator("#textbook-search").waitFor();
  if (id) await p.waitForFunction(id => document.querySelector('.textbook-card[aria-current]')?.getAttribute("data-example-id") === id, id);
}
async function run(answers = [], p = page) {
  await p.locator(".example-run").click();
  for (const answer of answers) { await p.locator("#example-answer").waitFor(); await p.locator("#example-answer").fill(answer); await p.locator(".example-input-form button").click(); }
  await p.waitForFunction(() => !document.querySelector(".example-run").disabled);
  assert.equal(await p.locator(".example-live").textContent(), "실행 완료");
  return await p.locator(".example-output").textContent();
}
async function code(value) {
  await page.locator(".editor-host .cm-content").click(); await page.keyboard.press("Control+A"); await page.keyboard.press("Backspace"); await page.keyboard.insertText(value);
  assert.equal((await page.locator(".editor-host .cm-line").allTextContents()).join("\n"), value);
}
const stored = () => page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open("python-learning-lab-files", 2);
  request.onsuccess = () => { const db = request.result, tx = db.transaction("files"), all = tx.objectStore("files").getAll(); all.onsuccess = () => resolve(all.result); tx.oncomplete = () => db.close(); tx.onerror = () => reject(tx.error); };
  request.onerror = () => reject(request.error);
}));
async function shape(p = page) {
  await p.locator(".example-canvas").scrollIntoViewIfNeeded();
  await p.waitForFunction(() => {
    const canvas = document.querySelector(".example-canvas"); if (!canvas || !canvas.width) return false;
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0; for (let i = 0; i < data.length; i += 4) if (data[i + 3] && (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200)) colored++;
    return colored > 200;
  });
}
async function layout(p) {
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, "page horizontal overflow");
  const bad = await p.locator(".textbook-page button, .textbook-nav a, .textbook-page input, .textbook-page select").evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).filter(node => {
    const r = node.getBoundingClientRect(); return r.width < 1 || r.height < 43 || r.left < -1 || r.right > innerWidth + 1;
  }).map(node => ({ text: node.textContent, rect: node.getBoundingClientRect().toJSON() })));
  assert.deepEqual(bad, [], "control size / overflow");
  const overlap = await p.locator(".textbook-page button, .textbook-page input, .textbook-page select, .topbar button, .textbook-nav a").evaluateAll(nodes => {
    const boxes = nodes.filter(node => node.getClientRects().length).map(node => ({ text: node.textContent, r: node.getBoundingClientRect() }));
    return boxes.flatMap((a, i) => boxes.slice(i + 1).filter(b => a.r.left < b.r.right - 1 && a.r.right > b.r.left + 1 && a.r.top < b.r.bottom - 1 && a.r.bottom > b.r.top + 1).map(b => [a.text, b.text]));
  }); assert.deepEqual(overlap, [], "overlapping controls");
}
try {
  await page.goto(base); await welcome(page);
  await code('print("학생 원본")'); await page.locator(".save").click(); await page.locator(".name-input").fill("main.py"); await page.locator(".name-confirm").click(); await page.waitForFunction(() => !document.querySelector(".modified").textContent.includes("*")); await page.locator(".run").click(); await page.waitForFunction(() => !document.querySelector(".run").disabled);
  await code("학생의 CSV"); await page.locator(".save-as").click(); await page.locator(".name-input").fill("observations.csv"); await page.locator(".name-confirm").click();
  await page.locator(".file-item").filter({ hasText: "main.py" }).click();
  await code('print("미저장 학생 문서")');
  const mainOutput = await page.locator(".console").textContent();
  const original = await stored();
  await page.locator('.textbook-nav a[href="#/examples"]').click();
  await page.locator("#textbook-search").fill("153"); assert.equal(await page.locator(".textbook-card").count(), 3);
  await page.locator('[data-example-id="page-153-turtle-square"]').click(); await run(); await shape(); record("153 search and actual turtle Canvas");
  assert.equal(await page.locator(".console").textContent(), mainOutput); assert.equal(await page.locator(".current-name").textContent(), "main.py"); assert.match(await page.locator(".modified").textContent(), /\*/); assert.match(await page.locator(".editor-host").textContent(), /미저장 학생 문서/); assert.deepEqual(await stored(), original); record("current code/name/dirty/output/IndexedDB preserved during isolated run");
  assert.equal(await page.locator(".example-code .cm-content").getAttribute("contenteditable"), "false");
  const readonlyCode = await page.locator(".example-code .cm-content").textContent(); await page.locator(".example-code .cm-content").focus(); await page.keyboard.insertText("수정 시도"); assert.equal(await page.locator(".example-code .cm-content").textContent(), readonlyCode);
  assert.ok(await page.locator(".example-code .cm-line span").count());
  await page.locator(".example-copy").click(); const copied = await page.evaluate(() => navigator.clipboard.readText()); assert.equal(copied, `${base}#/examples/page-153-turtle-square`);
  await page.goto(copied); await page.reload(); await welcome(page); await page.locator(".example-run").waitFor(); record("read-only highlighted code / copied direct link / reload");
  await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }); });
  await page.locator(".example-copy").click(); assert.equal(await page.locator(".example-link").inputValue(), copied); record("clipboard fallback selectable URL");
  await page.locator(".textbook-detail").getByRole("button", { name: "목록으로", exact: true }).click();
  await page.getByRole("button", { name: "필터 초기화", exact: true }).click();
  await page.locator("#textbook-topic").selectOption("반복문"); assert.ok(await page.locator(".textbook-card").count() > 0);
  await page.locator("#textbook-search").fill("no-matching-example-123"); assert.equal(await page.locator(".textbook-card").count(), 0);
  await page.getByRole("button", { name: "필터 초기화", exact: true }).click(); assert.equal(await page.locator(".textbook-card").count(), 65); record("topic filter / empty results / reset (56 textbook + 9 Core examples)");
  await page.locator("#textbook-status").selectOption("corrected"); assert.equal(await page.locator(".textbook-card").count(), 6); await page.getByRole("button", { name: "필터 초기화", exact: true }).click();
  await page.evaluate(() => { location.hash = "#/examples/unknown-example"; }); await page.getByText("예제를 찾을 수 없습니다.", { exact: true }).waitFor(); await page.locator(".textbook-detail").getByRole("button", { name: "목록으로", exact: true }).click(); record("status filter and unknown direct link recovery");
  await page.locator('[data-example-id="page-122-greeting"]').click();
  await page.waitForFunction(() => document.activeElement?.tagName === "H2" && document.querySelector('.textbook-card[aria-current]')?.getAttribute("data-example-id") === "page-122-greeting");
  await page.goBack(); await page.waitForFunction(() => document.activeElement?.getAttribute("data-example-id") === "page-122-greeting"); await page.goForward();
  await page.waitForFunction(() => document.activeElement?.tagName === "H2"); assert.equal(await run(["민수"]), "안녕하세요, 민수\n"); record("history / focus / input and output");
  await page.locator(".example-run").click(); await page.locator("#example-answer").waitFor(); await page.locator(".example-stop").click(); assert.equal(await page.locator(".example-live").textContent(), "실행 중지"); assert.equal(await run(["민수"]), "안녕하세요, 민수\n"); record("stop then fresh run");
  await navigate("page-124-area"); await page.locator(".example-run").click(); await page.locator("#example-answer").fill("잘못된 숫자"); await page.locator(".example-input-form button").click(); await page.locator(".cm-student-error").waitFor(); assert.match(await page.locator(".example-live").textContent(), /1번째 줄:/); record("real error line / Korean live status");
  await navigate("page-124-csv"); assert.equal(await run(), "새싹 3\n꽃 5\n"); assert.deepEqual(await stored(), original); record("temporary CSV does not read or write same-name student CSV");
  await navigate("page-123-write"); await run(); assert.deepEqual(await stored(), original); record("temporary file writes discarded");
  // Re-establish unsaved state after the intentional direct-link full navigation above.
  await page.locator('.textbook-nav a[href="#/editor"]').click(); await code('print("미저장 학생 문서")');
  await navigate("page-121-conversion"); await page.locator(".example-correction").waitFor(); await run();
  await page.locator(".example-edit").click();
  await page.locator(".editor-host").waitFor(); assert.equal(await page.locator(".current-name").textContent(), "121-conversion.py"); assert.match(await page.locator(".modified").textContent(), /\*/); assert.deepEqual(await stored(), original);
  await page.locator('.document-tabs [role="tab"]').filter({ hasText: "main.py" }).click(); assert.match(await page.locator(".editor-host").textContent(), /미저장 학생 문서/); record("corrected note / new tab import preserves existing dirty document without autosave");
  await navigate("page-122-print"); await page.locator(".example-edit").click(); await page.locator(".editor-host").waitFor();
  assert.ok(!(await stored()).some(file => file.name === "121-conversion.py")); record("additional example imports do not implicitly save previous tabs");
  await navigate("page-124-csv"); await page.locator(".example-edit").click(); await page.locator('[data-import="cancel"]').click(); assert.equal(await page.locator(".textbook-page").isVisible(), true);
  for (const policy of ["keep", "rename", "overwrite"]) {
    await page.locator(".example-edit").click(); await page.locator("#textbook-conflict").selectOption(policy); await page.locator('[data-import="data"]').click();
    await page.locator(".editor-host").waitFor();
    const all = await stored(); assert.equal(all.find(f => f.name === "observations.csv").content, policy === "overwrite" ? "대상,개수\r\n새싹,3\r\n꽃,5\r\n" : "학생의 CSV");
    if (policy === "rename") assert.ok(all.some(f => f.name !== "observations.csv" && f.content.startsWith("대상,개수")));
    await navigate("page-124-csv");
  }
  record("data import cancel and keep/rename/overwrite policies");
  await page.locator(".example-edit").click(); await page.locator('[data-import="code"]').click(); await page.locator(".editor-host").waitFor();
  const editorBefore = await page.locator(".editor-host").textContent(); await navigate("page-153-turtle-square"); await run(); await page.locator('.textbook-nav a[href="#/editor"]').click(); assert.equal(await page.locator(".editor-host").textContent(), editorBefore); record("navigation preserves imported dirty code / code-only option");
  await page.locator(".examples-toggle").click(); assert.equal(await page.locator(".example-item").count(), 11); await page.locator(".examples-close").click(); record("11 basic examples retained");
  const beforeOffline = await stored();
  await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const cdp = await context.newCDPSession(page); await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }); await context.setOffline(true);
  await page.reload();
  if (await page.evaluate(() => navigator.onLine)) { await context.setOffline(false); await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await context.setOffline(true); await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }); }
  await page.waitForFunction(() => !navigator.onLine);
  await navigate(); await page.locator("#textbook-search").fill("153"); assert.equal(await page.locator(".textbook-card").count(), 3); await page.getByRole("button", { name: "필터 초기화", exact: true }).click();
  for (const [id, answers] of [["page-120-accumulate", []], ["page-122-greeting", ["민수"]], ["page-124-csv", []], ["page-153-turtle-square", []]]) { await navigate(id); await run(answers); if (id.includes("turtle")) await shape(); }
  await page.reload(); await page.locator(".example-run").waitFor(); await run(); await shape(); assert.deepEqual(await stored(), beforeOffline);
  await page.locator(".example-edit").click(); await page.locator(".editor-host").waitFor(); assert.match(await page.locator(".modified").textContent(), /\*/);
  await page.locator(".backup-all").click(); const downloadPromise = page.waitForEvent("download"); await page.locator('.document-dialog-layer [data-choice="discard"]').click(); const download = await downloadPromise; assert.match(download.suggestedFilename(), /backup.json$/); record("offline list/search/direct reload/normal/input/data/turtle/import/backup and student files");
  await context.setOffline(false); await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  for (const [width, height] of [[360, 800], [800, 360], [768, 1024], [1024, 768], [1440, 900]]) {
    const ctx = await browser.newContext({ viewport: { width, height } }), p = await ctx.newPage();
    p.on("pageerror", error => errors.push(error.message)); await p.goto(`${base}#/examples`); await welcome(p); await layout(p);
    await p.screenshot({ path: `${directory}/list-${width}x${height}.png` });
    await navigate("page-122-greeting", p); assert.equal(await run(["민수"], p), "안녕하세요, 민수\n"); await layout(p);
    await p.screenshot({ path: `${directory}/responsive-${width}x${height}.png`, fullPage: true });
    if (width === 360 || width === 1024) {
      await p.locator(".example-edit").click(); await p.locator(".editor-host").waitFor(); await navigate("page-124-csv", p); await p.locator(".example-edit").click();
      const dialog = await p.locator(".textbook-data-layer .save-dialog").boundingBox(); assert.ok(dialog.x >= 0 && dialog.y >= 0 && dialog.x + dialog.width <= width && dialog.y + dialog.height <= height);
      await p.keyboard.press("Escape"); await p.locator(".example-edit").click(); await p.locator('[data-import="code"]').click();
      await p.locator(".editor-host").waitFor(); await p.locator(".backup-all").click(); await p.locator('.document-dialog-layer [data-choice="save"]').waitFor(); await p.keyboard.press("Shift+Tab"); assert.equal(await p.evaluate(() => document.activeElement.dataset.choice), "cancel"); await p.keyboard.press("Tab"); assert.equal(await p.evaluate(() => document.activeElement.dataset.choice), "save"); await p.keyboard.press("Escape");
    }
    record(`viewport ${width}x${height}: actual rendering/input/output/touch layout`); await ctx.close();
  }
  await page.setViewportSize({ width: 720, height: 450 }); await navigate("page-122-greeting"); await page.evaluate(() => { document.documentElement.style.zoom = "2"; }); await run(["민수"]); await layout(page); await page.screenshot({ path: `${directory}/zoom-200.png`, fullPage: true }); record("200% zoom controls");
  assert.deepEqual(errors, []); assert.deepEqual(badResponses, []); assert.deepEqual(writes, []); record("no page errors / HTTP errors / server writes");
} catch (error) {
  results.push({ name: "검증 중단", passed: false, message: String(error), hash: await page.evaluate(() => location.hash).catch(() => "unavailable"), focus: await page.evaluate(() => document.activeElement?.outerHTML).catch(() => "unavailable") });
  await page.screenshot({ path: `${directory}/failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${directory}/results.json`, JSON.stringify({ base, results, errors, badResponses, writes }, null, 2)); await browser.close();
}
