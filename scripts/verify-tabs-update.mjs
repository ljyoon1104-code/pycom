import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

// Serve the production build with two real Service Worker revisions. No app globals or test UI.
let revision = 1;
const root = resolve("dist"), output = "artifacts/document-tabs";
await mkdir(output, { recursive: true });
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://localhost").pathname.replace(/^\/pycom\//, "");
    const file = resolve(root, path || "index.html"); if (!file.startsWith(root + "\\")) { response.writeHead(403).end(); return; }
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
    const bytes = await readFile(file);
    response.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    response.end(path === "sw.js" ? `${bytes.toString("utf8")}\n// Test-server revision ${revision}\n` : bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(4176, "127.0.0.1", resolve));
const browser = await chromium.launch({ executablePath: join(process.env["PROGRAMFILES(X86)"] ?? process.env.PROGRAMFILES, "Microsoft/Edge/Application/msedge.exe"), headless: true });
const context = await browser.newContext({ viewport: { width: 360, height: 800 } }), page = await context.newPage();
const results = [], errors = []; page.on("pageerror", error => errors.push(error.message));
const record = value => { results.push(value); console.log(`PASS ${value}`); };
async function code(value) { await page.locator(".editor-host .cm-content").click(); await page.keyboard.press("Control+A"); await page.keyboard.press("Backspace"); await page.keyboard.insertText(value); }
async function update() { revision++; await page.evaluate(async () => { const registration = await navigator.serviceWorker.ready; await registration.update(); }); await page.locator(".update").waitFor({ state: "visible" }); }
try {
  await page.goto("http://127.0.0.1:4176/pycom/"); await page.locator(".welcome-close").click(); await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await code('print("stored")'); await page.locator(".save").click(); await page.locator(".document-dialog-layer .name-input").fill("main.py"); await page.locator('[data-choice="name"]').click(); await page.waitForFunction(() => !document.querySelector(".modified").textContent.includes("*"));
  await code('print("changed main")'); await page.locator(".document-add").click(); await code('print("new draft")');
  await update(); let navigations = 0; page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigations++; });
  await page.locator(".update").click(); await page.locator('[data-choice="cancel"]').click(); assert.equal(navigations, 0); assert.equal(await page.locator('.document-tabs [aria-label*="변경 있음"]').count(), 2); record("real waiting SW: update cancel retains two dirty tabs without reload");
  await page.locator(".update").click(); await page.locator('[data-choice="save"]').click(); await page.locator(".document-dialog-layer .name-input").waitFor(); await page.keyboard.press("Escape"); assert.equal(navigations, 0); assert.equal(await page.locator('.document-tabs [aria-label*="변경 있음"]').count(), 1); assert.match(await page.locator(".console").textContent(), /main.py 파일을 저장했습니다/); record("save-all first succeeds, untitled name cancel stops update and preserves draft");
  await page.locator(".update").click(); await page.screenshot({ path: `${output}/update-confirm-360x800.png` }); await page.locator('[data-choice="save"]').click(); await page.locator(".document-dialog-layer .name-input").fill("new.py"); await page.locator('[data-choice="name"]').click(); await page.waitForFunction(() => document.querySelectorAll('.document-tabs [role="tab"]').length === 2 && !document.querySelector(".update")?.offsetWidth && !document.querySelector(".modified").textContent.includes("*")); assert.ok(navigations > 0); record("all saves succeed before real SW activation/reload; saved tabs restored");
  await code('print("discard this")'); await update(); const before = navigations; let unloadDialogs = 0; page.on("dialog", async dialog => { unloadDialogs++; await dialog.accept(); });
  await page.locator(".update").click(); await page.locator('[data-choice="discard"]').click(); await page.waitForFunction(() => !document.querySelector(".modified").textContent.includes("*")); assert.ok(navigations > before); assert.equal(unloadDialogs, 0); record("explicit discard updates without a second native prompt; only saved content restored");
  assert.deepEqual(errors, []);
} finally { await writeFile(`${output}/update-results.json`, JSON.stringify({ results, errors }, null, 2)); await browser.close(); await new Promise(resolve => server.close(resolve)); }
