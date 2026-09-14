import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const url = process.env.APP_URL ?? "https://ljyoon1104-code.github.io/pycom/";
const label = url.includes("github.io") ? "pages" : "local";
const directory = "artifacts/stage11";
const executablePath = process.env.EDGE_PATH ?? join(process.env["PROGRAMFILES(X86)"] ?? process.env.PROGRAMFILES ?? "", "Microsoft", "Edge", "Application", "msedge.exe");
const random = 'import random\n\nrandom.seed(1234)\nnumbers = random.sample(range(10), 3)\n\nprint(len(numbers))\nprint(numbers[0] != numbers[1])\nprint(numbers[1] != numbers[2])';
const datetime = 'from datetime import date\n\nclass Book:\n    def __init__(self, title, publish_year):\n        self.title = title\n        self.publish_year = publish_year\n\n    def age(self):\n        return date.today().year - self.publish_year\n\nbook = Book("데미안", 1919)\n\nprint(book.title)\nprint(book.age())';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const results = [];
try {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await context.newPage();
  const errors = [], failedResources = [];
  page.on("requestfailed", request => console.log("request failed", request.url(), request.failure()));
  page.on("console", message => { if (message.type() === "error") console.log("console error", message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => { if (response.status() >= 400) failedResources.push(response.url()); });
  const response = await page.goto(url, { waitUntil: "networkidle" });
  assert.equal(response.status(), 200);
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) await page.reload({ waitUntil: "networkidle" });
  const manifest = await page.evaluate(async () => (await fetch(new URL("manifest.webmanifest", location.href))).json());
  assert.ok(manifest.icons.length >= 2);
  const year = await page.evaluate(() => new Date().getFullYear());
  async function execute(name, code, expected, input) {
    const editor = page.locator(".cm-content");
    await editor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.insertText(code);
    const visible = await editor.innerText();
    assert.ok(visible.includes(code.split("\n")[0]), name + ": first editor line");
    assert.ok(visible.includes(code.split("\n").at(-1)), name + ": last editor line");
    await page.locator(".run").click();
    if (input !== undefined) {
      await page.locator(".console-input").fill(input);
      await page.locator(".input-submit").click();
    }
    await page.waitForFunction(() => !document.querySelector(".run").disabled, { timeout: 15000 });
    assert.equal(await page.locator(".console-error").count(), 0, name + ": student error");
    const output = await page.locator(".console-line").allTextContents();
    assert.equal(output.join(""), expected, name);
    assert.equal(await page.locator(".execution-live").textContent(), "실행이 완료되었습니다.");
    await page.locator(".save").click();
    await page.waitForFunction(() => document.querySelector(".modified").textContent === "");
    await page.screenshot({ path: directory + "/" + label + "-" + name + ".png", fullPage: true });
    results.push({ name, output: output.join("") });
  }
  await execute("online-random", random, "3\nTrue\nTrue\n");
  await execute("online-datetime", datetime, "데미안\n" + (year - 1919) + "\n");
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  assert.ok(scope.endsWith(new URL(url).pathname));
  const cachedURLs = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(request => request.url)))).flat());
  assert.ok(cachedURLs.some(value => /assets\/worker-.*\.js$/.test(value)));
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  try { await page.locator(".cm-content").waitFor({ timeout: 10000 }); }
  catch (error) { await page.screenshot({ path: directory + "/" + label + "-offline-failure.png" }); console.log("offline failure", { errors, failedResources, url: page.url(), html: await page.content() }); throw error; }
  // Reapply after a service-worker navigation so Edge also updates the new renderer.
  await context.setOffline(true);
  const devtools = await context.newCDPSession(page);
  await devtools.send("Network.overrideNetworkState", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await page.waitForFunction(() => !navigator.onLine);
  const offline = await page.evaluate(async () => {
    try { await fetch("./offline-probe-" + Date.now(), { cache: "no-store" }); return false; } catch { return true; }
  });
  assert.equal(offline, true, "uncached network request must fail while offline");
  await execute("offline-random", random, "3\nTrue\nTrue\n");
  await execute("offline-datetime", datetime, "데미안\n" + (year - 1919) + "\n");
  await execute("offline-input", 'name = input("이름: ")\nprint(f"안녕하세요, {name}")', "이름: 민수\n안녕하세요, 민수\n", "민수");
  await execute("offline-files", 'with open("stage11.txt", "w") as file:\n    file.write("오프라인 유지")\nwith open("stage11.txt", "r") as file:\n    print(file.read())', "오프라인 유지\n");
  await execute("offline-exceptions", 'try:\n    import os\nexcept ImportError:\n    print("가져오기 차단")', "가져오기 차단\n");
  assert.deepEqual(errors, []);
  assert.deepEqual(failedResources, []);
  const report = { url, scope, year, offlineNetworkBlocked: offline, connectionStatus: await page.locator(".connection-status").innerText(), results, errors, failedResources };
  await writeFile(directory + "/" + label + "-browser-results.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await context.close();
} finally { await browser.close(); }
