import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const url = process.env.APP_URL ?? "http://127.0.0.1:4173/";
const edge = process.env.EDGE_PATH ?? join(process.env["PROGRAMFILES(X86)"] ?? process.env.PROGRAMFILES ?? "", "Microsoft", "Edge", "Application", "msedge.exe");
const outputDirectory = join(process.cwd(), "artifacts", "stage13");
const viewports = [[360, 800], [800, 360], [768, 1024], [1024, 768], [1440, 900]];
const square = `import turtle

t = turtle.Turtle()

for i in range(4):
    t.forward(100)
    t.right(90)

turtle.done()
print("정사각형 완성")`;
const colors = `import turtle

red = turtle.Turtle()
blue = turtle.Turtle()

red.pencolor("red")
blue.pencolor("blue")
red.forward(80)
blue.left(90)
blue.forward(80)
turtle.done()`;
const penUp = `import turtle

t = turtle.Turtle()
t.forward(50)
t.penup()
t.goto(100, 100)
t.pendown()
t.left(90)
t.forward(50)
turtle.done()`;
const triangle = `import turtle

t = turtle.Turtle()
for i in range(3):
    t.forward(80)
    t.left(120)
turtle.done()`;

if (!existsSync(edge)) throw new Error("Microsoft Edge를 찾을 수 없습니다. EDGE_PATH를 지정해 주세요.");
await mkdir(outputDirectory, { recursive: true });

const overlap = (left, right) => left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.height + left.y > right.y;
const visible = box => box && box.width > 0 && box.height > 0;

async function replaceCode(page, code) {
  const editor = page.locator(".cm-content");
  await editor.click(); await page.keyboard.press("Control+A"); await page.keyboard.press("Backspace"); await page.keyboard.insertText(code);
  assert.match(await editor.innerText(), new RegExp(code.split("\n")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
async function execute(page, code) {
  await replaceCode(page, code);
  await page.locator(".run").click();
  await page.locator(".graphics-tab").waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector(".run")?.hasAttribute("disabled"));
  await page.locator(".turtle-canvas").waitFor({ state: "visible" });
}
async function canvasPixels(page) {
  return page.locator(".turtle-canvas").evaluate(canvas => {
    const context = canvas.getContext("2d"), image = context?.getImageData(0, 0, canvas.width, canvas.height).data ?? new Uint8ClampedArray();
    let nonBackground = 0, red = 0, blue = 0;
    for (let index = 0; index < image.length; index += 4) {
      const [r, g, b, a] = [image[index], image[index + 1], image[index + 2], image[index + 3]];
      if (a && (Math.abs(r - 244) > 3 || Math.abs(g - 248) > 3 || Math.abs(b - 255) > 3)) nonBackground++;
      if (r > 170 && g < 100 && b < 100) red++;
      if (b > 170 && r < 100 && g < 150) blue++;
    }
    return { width: canvas.width, height: canvas.height, nonBackground, red, blue };
  });
}
async function layout(page, width) {
  return page.evaluate(width => {
    const box = selector => { const element = document.querySelector(selector); if (!element) return null; const rect = element.getBoundingClientRect(), style = getComputedStyle(element); return style.display === "none" || rect.width <= 0 || rect.height <= 0 ? null : { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; };
    const controls = [...document.querySelectorAll(".topbar button, .result-tabs button")].map(element => ({ label: element.textContent?.trim(), box: (() => { const rect = element.getBoundingClientRect(), style = getComputedStyle(element); return style.display === "none" || rect.width <= 0 || rect.height <= 0 ? null : { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; })() })).filter(item => item.box);
    return { width, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, canvas: box(".turtle-canvas"), editor: box(".editor-host"), controls };
  }, width);
}
function assertLayout(report) {
  assert.ok(report.scrollWidth <= report.clientWidth, `가로 스크롤: ${report.scrollWidth} > ${report.clientWidth}`);
  assert.ok(visible(report.canvas) && report.canvas.x >= 0 && report.canvas.x + report.canvas.width <= report.width, "Canvas가 가로로 잘렸습니다.");
  assert.ok(visible(report.editor) && report.editor.x >= 0 && report.editor.x + report.editor.width <= report.width, "편집기가 가로로 잘렸습니다.");
  const boxes = report.controls.map(control => control.box);
  assert.ok(boxes.every(box => box.x >= 0 && box.x + box.width <= report.width), "버튼이 화면 밖으로 나갔습니다.");
  assert.ok(!boxes.some((box, index) => boxes.slice(index + 1).some(other => overlap(box, other))), "버튼이 서로 겹칩니다.");
}

const browser = await chromium.launch({ executablePath: edge, headless: true, args: ["--disable-gpu"] });
try {
  const report = { url, viewports: [], scenarios: {}, offline: null, browserErrors: [], failedResources: [] };
  for (const [width, height] of viewports) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on("pageerror", error => report.browserErrors.push(error.message));
    page.on("response", response => { if (response.status() >= 400) report.failedResources.push(`${response.status()} ${response.url()}`); });
    try {
      const response = await page.goto(url, { waitUntil: "networkidle" }); assert.equal(response?.status(), 200);
      await execute(page, square);
      await page.locator('[data-result-tab="text"]').click();
      assert.match(await page.locator(".console").innerText(), /정사각형 완성/);
      await page.locator('[data-result-tab="graphics"]').click();
      const pixels = await canvasPixels(page); assert.ok(pixels.nonBackground > 350, "정사각형 Canvas 선분이 충분히 렌더링되지 않았습니다.");
      const check = await layout(page, width); assertLayout(check);
      await page.screenshot({ path: join(outputDirectory, `turtle-${width}x${height}.png`), fullPage: true });
      report.viewports.push({ viewport: `${width}x${height}`, pixels, layout: check });
    } finally { await context.close(); }
  }

  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", error => report.browserErrors.push(error.message));
  page.on("response", response => { if (response.status() >= 400) report.failedResources.push(`${response.status()} ${response.url()}`); });
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await execute(page, colors); const colored = await canvasPixels(page); assert.ok(colored.red > 20 && colored.blue > 20, `빨간색·파란색 선분이 모두 렌더링되지 않았습니다: ${JSON.stringify(colored)}`);
    await page.screenshot({ path: join(outputDirectory, "turtle-red-blue.png"), fullPage: true });
    await execute(page, penUp); const penUpPixels = await canvasPixels(page); assert.ok(penUpPixels.nonBackground > 150, "penup 이후 재개 선분이 렌더링되지 않았습니다.");
    await page.screenshot({ path: join(outputDirectory, "turtle-penup.png"), fullPage: true });
    await page.setViewportSize({ width: 800, height: 640 }); await page.waitForTimeout(80); const resizedPixels = await canvasPixels(page); assert.ok(resizedPixels.nonBackground > 150, "크기 변경 뒤 그림이 보존되지 않았습니다.");
    await replaceCode(page, "import turtle\nt=turtle.Turtle()\nfor i in range(10000):\n    t.forward(1)"); await page.locator(".run").click(); await page.locator(".graphics-tab").waitFor({ state: "visible" }); await page.locator(".stop").click(); await page.waitForFunction(() => !document.querySelector(".run")?.hasAttribute("disabled")); assert.match(await page.locator(".execution-live").textContent(), /실행이 중지되었습니다/);
    await execute(page, square); assert.ok((await canvasPixels(page)).nonBackground > 350, "중지 후 새 실행이 정상 렌더링되지 않았습니다.");
    report.scenarios = { colors: colored, penUp: penUpPixels, resizedPixels, stopAndRestart: true };

    await page.evaluate(() => navigator.serviceWorker.ready);
    if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) await page.reload({ waitUntil: "networkidle" });
    const session = await context.newCDPSession(page); await context.setOffline(true); await session.send("Network.overrideNetworkState", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.locator(".cm-content").waitFor(); await context.setOffline(true); await session.send("Network.overrideNetworkState", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }); await page.waitForFunction(() => !navigator.onLine);
    await execute(page, triangle); const offlinePixels = await canvasPixels(page); assert.ok(offlinePixels.nonBackground > 250, "오프라인 삼각형이 렌더링되지 않았습니다.");
    await page.screenshot({ path: join(outputDirectory, "turtle-offline.png"), fullPage: true });
    report.offline = { connection: await page.locator(".connection-status").innerText(), pixels: offlinePixels, serviceWorker: await page.evaluate(() => Boolean(navigator.serviceWorker.controller)) };
    assert.equal(report.offline.connection, "오프라인 사용 중"); assert.equal(report.offline.serviceWorker, true);
  } finally { await context.close(); }
  assert.deepEqual(report.browserErrors, []); assert.deepEqual(report.failedResources, []);
  await writeFile(join(outputDirectory, "turtle-browser-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
