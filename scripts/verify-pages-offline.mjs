import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const url = process.env.APP_URL ?? "https://ljyoon1104-code.github.io/pycom/";
const edge = process.env.EDGE_PATH ?? join(process.env["PROGRAMFILES(X86)"] ?? process.env.PROGRAMFILES ?? "", "Microsoft", "Edge", "Application", "msedge.exe");
const code = 'name = input("이름: ")\nprint(f"안녕하세요, {name}")';

if (!existsSync(edge)) throw new Error("Microsoft Edge를 찾을 수 없습니다. EDGE_PATH를 지정해 주세요.");
const browser = await chromium.launch({ executablePath: edge, headless: true, args: ["--disable-gpu"] });
try {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await context.newPage();
  const failedResources = [];
  page.on("response", response => { if (response.status() >= 400) failedResources.push(`${response.status()} ${response.url()}`); });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const manifest = await page.evaluate(async () => (await fetch("./manifest.webmanifest")).ok);
  if (!manifest || failedResources.length) throw new Error(`온라인 정적 자원 오류: ${failedResources.join(", ")}`);

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".cm-content").waitFor();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(code);
  await page.locator(".run").click();
  await page.locator(".console-input").fill("민수");
  await page.locator(".input-submit").click();
  await page.waitForFunction(() => document.querySelector(".console")?.textContent?.includes("안녕하세요, 민수") ?? false);
  console.log("Service Worker 제어, 매니페스트, 오프라인 Worker 입력 실행 확인");
  await context.close();
} finally {
  await browser.close();
}
