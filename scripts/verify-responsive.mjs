import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const url = process.env.APP_URL ?? "http://127.0.0.1:4173";
const edge = process.env.EDGE_PATH ?? join(process.env["PROGRAMFILES(X86)"] ?? process.env.PROGRAMFILES ?? "", "Microsoft", "Edge", "Application", "msedge.exe");
const outputDirectory = join(process.cwd(), "artifacts", "responsive");
const viewports = [
  { width: 360, height: 800, name: "responsive-360x800.png" },
  { width: 800, height: 360, name: "responsive-800x360.png" },
  { width: 768, height: 1024, name: "responsive-768x1024.png" },
  { width: 1024, height: 768, name: "responsive-1024x768.png" },
  { width: 1440, height: 900, name: "responsive-1440x900.png" },
];
const inputProgram = 'name = input("이름: ")\nprint(f"안녕하세요, {name}")';
const longOutputProgram = `print("${"긴출력".repeat(180)}")`;

const overlaps = (left, right) => left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
const insideHorizontally = (box, width) => box && box.x >= 0 && box.x + box.width <= width;
const visibleBox = async (page, selector) => page.locator(selector).evaluate(element => {
  const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0 ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
}).catch(() => null);

async function replaceCode(page, code) {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(code);
}

async function runInputProgram(page) {
  await replaceCode(page, inputProgram);
  await page.locator(".run").click();
  const input = page.locator(".console-input");
  await input.waitFor();
  const inputBox = await input.boundingBox();
  await input.fill("민수");
  await page.locator(".input-submit").click();
  await page.waitForFunction(() => document.querySelector(".console")?.textContent?.includes("안녕하세요, 민수") ?? false);
  return inputBox;
}

async function checkUnsavedDialog(page, width, errors) {
  await page.locator(".new-file").click();
  const dialog = page.locator(".dialog-layer:not([hidden]) .save-dialog");
  await dialog.waitFor();
  const dialogBox = await dialog.boundingBox();
  const choices = await Promise.all(["save", "discard", "cancel"].map(choice => page.locator(`[data-choice="${choice}"]`).boundingBox()));
  if (!insideHorizontally(dialogBox, width) || !choices.every(box => insideHorizontally(box, width)) || choices.some((box, index) => choices.slice(index + 1).some(other => overlaps(box, other)))) errors.push("저장 확인창 또는 세 버튼이 화면 안에 겹치지 않고 배치되지 않았습니다.");
  await page.locator('[data-choice="cancel"]').click();
}

async function inspectViewport(browser, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    const inputBox = await runInputProgram(page);
    const modified = (await page.locator(".modified").textContent())?.includes("*");
    if (!modified) errors.push("코드 수정 표시(*)가 나타나지 않았습니다.");

    if (viewport.width === 360 || viewport.width === 1024) {
      await page.locator(".files-toggle").click();
      const filePanel = await visibleBox(page, ".file-panel");
      if (!insideHorizontally(filePanel, viewport.width)) errors.push("파일 패널이 화면 밖으로 벗어났습니다.");
      if (viewport.width === 360) await page.locator(".files-toggle").click();
      await checkUnsavedDialog(page, viewport.width, errors);
      await page.locator(".save").click();
    }

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(outputDirectory, viewport.name), fullPage: true });
    await replaceCode(page, longOutputProgram);
    await page.locator(".run").click();
    await page.waitForFunction(() => document.querySelector(".console")?.textContent?.includes("긴출력") ?? false);

    const layout = await page.evaluate(() => {
      const box = selector => {
        const element = document.querySelector(selector); if (!element) return null;
        const style = getComputedStyle(element), rect = element.getBoundingClientRect();
        return style.display === "none" || rect.width === 0 || rect.height === 0 ? null : { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        editor: box(".editor-host"), console: box(".console"), status: box(".app-status"), input: box(".console-input"),
        buttons: [...document.querySelectorAll(".topbar button")].map(button => ({ label: button.textContent?.trim(), box: box(`.${[...button.classList].join(".")}`) })),
      };
    });
    if (layout.scrollWidth > layout.clientWidth) errors.push(`문서 가로 스크롤(${layout.scrollWidth}px > ${layout.clientWidth}px)이 발생했습니다.`);
    if (![layout.editor, layout.console, layout.status].every(box => insideHorizontally(box, viewport.width))) errors.push("편집기·결과·상태 영역 중 하나가 가로로 잘렸습니다.");
    if (!insideHorizontally(inputBox, viewport.width)) errors.push("프로그램 입력창이 화면 밖으로 벗어났습니다.");
    const buttonBoxes = layout.buttons.map(item => item.box).filter(Boolean);
    if (!buttonBoxes.every(box => insideHorizontally(box, viewport.width))) errors.push("헤더 버튼이 화면 밖으로 벗어났습니다.");
    if (buttonBoxes.some((box, index) => buttonBoxes.slice(index + 1).some(other => overlaps(box, other)))) errors.push("헤더 버튼이 겹쳤습니다.");
    return { viewport: `${viewport.width}x${viewport.height}`, screenshot: join(outputDirectory, viewport.name), errors, layout };
  } finally {
    await context.close();
  }
}

if (!existsSync(edge)) throw new Error("Microsoft Edge를 찾을 수 없습니다. EDGE_PATH를 지정해 주세요.");
await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ executablePath: edge, headless: true, args: ["--disable-gpu"] });
try {
  const report = [];
  for (const viewport of viewports) report.push(await inspectViewport(browser, viewport));
  await writeFile(join(outputDirectory, "responsive-report.json"), JSON.stringify(report, null, 2));
  const failures = report.flatMap(result => result.errors.map(error => `${result.viewport}: ${error}`));
  if (failures.length) throw new Error(failures.join("\n"));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
