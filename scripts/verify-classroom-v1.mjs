import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const url = process.env.APP_URL ?? "http://127.0.0.1:4173/";
const packageVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const edge = process.env.EDGE_PATH ?? join(process.env["PROGRAMFILES(X86)"] ?? process.env.PROGRAMFILES ?? "", "Microsoft", "Edge", "Application", "msedge.exe");
const outputDirectory = join(process.cwd(), "artifacts", "stage14");
const viewports = [[360, 800], [800, 360], [768, 1024], [1024, 768], [1440, 900]];

const inputProgram = `name = input("이름: ")
score = int(input("점수: "))

if score >= 80:
    grade = "통과"
else:
    grade = "다시 도전"

print(f"{name}: {grade}")`;
const classProgram = `class Student:
    def __init__(self, name):
        self.name = name

    def show(self):
        print(f"학생: {self.name}")

student = Student("지수")
student.show()`;
const fileProgram = `with open("lesson.txt", "w") as file:
    file.write("수업 준비 완료")

try:
    with open("lesson.txt", "r") as file:
        print(file.read())
except FileNotFoundError:
    print("파일이 없습니다.")`;
const moduleProgram = `import random
import datetime

random.seed(10)
print(random.randint(1, 10))

today = datetime.date.today()
print(today)`;
const turtleProgram = `import turtle

t = turtle.Turtle()

for i in range(4):
    t.forward(80)
    t.right(90)

turtle.done()`;

if (!existsSync(edge)) throw new Error("Microsoft Edge를 찾을 수 없습니다. EDGE_PATH를 지정해 주세요.");
await mkdir(outputDirectory, { recursive: true });

const overlap = (one, two) => one.x < two.x + two.width && one.x + one.width > two.x && one.y < two.y + two.height && one.y + one.height > two.y;
const normalize = value => value.replace(/\r\n/g, "\n").trimEnd();

async function editorText(page) {
  return normalize((await page.locator(".cm-line").allTextContents()).join("\n"));
}

async function replaceCode(page, code) {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(code);
  assert.equal(await editorText(page), normalize(code));
}

async function runCurrent(page, answers = [], graphics = false) {
  await page.locator(".run").click();
  for (const answer of answers) {
    const input = page.locator(".console-input");
    await input.waitFor({ state: "visible" });
    assert.match(await page.locator('.input-row [role="status"]').innerText(), /입력을 기다리고 있습니다/);
    const box = await input.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= (await page.evaluate(() => innerWidth)), "input() 입력창이 가로로 잘렸습니다.");
    await input.fill(answer);
    await page.locator(".input-submit").click();
  }
  await page.waitForFunction(() => !document.querySelector(".run")?.hasAttribute("disabled"));
  if (graphics) {
    await page.locator(".graphics-tab").waitFor({ state: "visible" });
    await page.locator(".graphics-tab").click();
    await page.locator(".turtle-canvas").waitFor({ state: "visible" });
    assert.match(await page.locator(".turtle-canvas").getAttribute("aria-label"), /거북이 그래픽/);
  }
  return page.locator(".console").innerText();
}

async function execute(page, code, answers = [], graphics = false) {
  await replaceCode(page, code);
  return runCurrent(page, answers, graphics);
}

async function canvasPixels(page) {
  return page.locator(".turtle-canvas").evaluate(canvas => {
    const context = canvas.getContext("2d");
    const image = context?.getImageData(0, 0, canvas.width, canvas.height).data ?? new Uint8ClampedArray();
    let nonBackground = 0;
    for (let index = 0; index < image.length; index += 4) {
      const [r, g, b, a] = [image[index], image[index + 1], image[index + 2], image[index + 3]];
      if (a && (Math.abs(r - 244) > 3 || Math.abs(g - 248) > 3 || Math.abs(b - 255) > 3)) nonBackground++;
    }
    return { width: canvas.width, height: canvas.height, nonBackground };
  });
}

async function dialogMetrics(page, selector) {
  return page.locator(selector).evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
}

function assertDialogInside(metrics, label) {
  assert.ok(metrics.x >= 0 && metrics.y >= 0, `${label} 왼쪽 또는 위가 화면 밖입니다.`);
  assert.ok(metrics.x + metrics.width <= metrics.viewportWidth + 1, `${label} 오른쪽이 화면 밖입니다.`);
  assert.ok(metrics.y + metrics.height <= metrics.viewportHeight + 1, `${label} 아래가 화면 밖입니다.`);
  assert.ok(metrics.clientHeight > 0, `${label} 내용 영역을 사용할 수 없습니다.`);
}

async function dismissFirstWelcome(page, screenshotPath) {
  const layer = page.locator(".welcome-dialog");
  await layer.waitFor({ state: "visible" });
  assertDialogInside(await dialogMetrics(page, ".welcome-dialog"), "첫 화면 안내");
  assert.equal(await page.locator(".welcome-remember").isChecked(), true);
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("welcome-close")), true, "첫 화면 안내로 포커스가 이동하지 않았습니다.");
  if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.locator(".welcome-close").click();
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator(".welcome-dialog").isVisible(), false, "닫은 안내가 재접속 때 자동 표시됐습니다.");
}

async function checkHelpKeyboard(page, screenshotPath) {
  const trigger = page.locator(".help-toggle");
  await trigger.focus();
  await trigger.press("Enter");
  await page.locator(".help-dialog").waitFor({ state: "visible" });
  assertDialogInside(await dialogMetrics(page, ".help-dialog"), "도움말");
  assert.match(await page.locator(".help-dialog").innerText(), /브라우저 데이터를 삭제하면 로컬 파일도 삭제될 수 있습니다/);
  assert.match(await page.locator(".help-dialog").innerText(), /앱 업데이트는 로컬 파일을 삭제하지 않습니다/);
  assert.ok((await page.locator(".help-dialog").innerText()).includes(`Python 학습실 ${packageVersion}`));
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("help-close")), true, "도움말로 포커스가 이동하지 않았습니다.");
  if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.locator(".show-welcome").click();
  await page.locator(".welcome-dialog").waitFor({ state: "visible" });
  assertDialogInside(await dialogMetrics(page, ".welcome-dialog"), "도움말에서 다시 연 시작 안내");
  await page.locator(".welcome-close").click();
  await trigger.focus();
  await trigger.press("Enter");
  await page.locator(".help-dialog").waitFor({ state: "visible" });
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("show-welcome")), true, "대화상자 Tab 순환이 동작하지 않았습니다.");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".help-dialog").isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("help-toggle")), true, "도움말을 닫은 뒤 원래 버튼으로 포커스가 돌아오지 않았습니다.");
}

async function openExample(page, id, unsavedChoice) {
  await page.locator(".examples-toggle").click();
  const dialog = page.locator(".examples-dialog");
  await dialog.waitFor({ state: "visible" });
  assert.equal(await page.locator(".example-item").count(), 11);
  assertDialogInside(await dialogMetrics(page, ".examples-dialog"), "예제 선택");
  await page.locator(`[data-example-id="${id}"]`).click();
  if (unsavedChoice) {
    const saveDialog = page.locator(".save-layer .save-dialog");
    await saveDialog.waitFor({ state: "visible" });
    assertDialogInside(await dialogMetrics(page, ".save-layer .save-dialog"), "저장 확인");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-choice")), "save", "저장 확인 기본 포커스가 저장에 있지 않습니다.");
    await page.locator(`.save-layer [data-choice="${unsavedChoice}"]`).click();
  }
}

async function storedNames(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("python-learning-lab-files", 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const rows = database.transaction("files", "readonly").objectStore("files").getAll();
      rows.onerror = () => reject(rows.error);
      rows.onsuccess = () => resolve(rows.result.map(file => file.name));
    };
  }));
}

async function layoutMetrics(page) {
  await page.evaluate(() => scrollTo(0, 0));
  return page.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll(".topbar button")).filter(element => getComputedStyle(element).display !== "none").map(element => {
      const rect = element.getBoundingClientRect();
      return { name: element.textContent?.trim(), x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    const rect = selector => { const element = document.querySelector(selector); if (!element) return null; const value = element.getBoundingClientRect(); return { x: value.x, y: value.y, width: value.width, height: value.height }; };
    const unnamedButtons = Array.from(document.querySelectorAll("button")).filter(button => !button.textContent?.trim() && !button.getAttribute("aria-label") && !button.getAttribute("title")).length;
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, controls: boxes, editor: rect(".editor-host"), canvas: rect(".turtle-canvas"), unnamedButtons };
  });
}

function assertLayout(metrics) {
  assert.ok(metrics.scrollWidth <= metrics.clientWidth, `가로 스크롤: ${metrics.scrollWidth} > ${metrics.clientWidth}`);
  assert.ok(metrics.controls.every(box => box.x >= 0 && box.x + box.width <= metrics.width + 1), "헤더 버튼이 가로로 잘렸습니다.");
  assert.ok(!metrics.controls.some((box, index) => metrics.controls.slice(index + 1).some(other => overlap(box, other))), "헤더 버튼이 서로 겹칩니다.");
  assert.ok(metrics.controls.every(box => box.height >= 40), `터치 버튼 높이가 너무 작습니다: ${JSON.stringify(metrics.controls.filter(box => box.height < 40))}`);
  assert.ok(metrics.editor && metrics.editor.x >= 0 && metrics.editor.x + metrics.editor.width <= metrics.width + 1, "편집기가 가로로 잘렸습니다.");
  assert.ok(metrics.canvas && metrics.canvas.x >= 0 && metrics.canvas.x + metrics.canvas.width <= metrics.width + 1, "Canvas가 가로로 잘렸습니다.");
  assert.equal(metrics.unnamedButtons, 0, "접근성 이름이 없는 버튼이 있습니다.");
}

async function verifyViewport(browser, width, height, report) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [], failedResources = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("response", response => { if (response.status() >= 400) failedResources.push(`${response.status()} ${response.url()}`); });
  try {
    const response = await page.goto(url, { waitUntil: "networkidle" });
    assert.equal(response?.status(), 200);
    await dismissFirstWelcome(page, join(outputDirectory, `welcome-${width}x${height}.png`));
    await checkHelpKeyboard(page, join(outputDirectory, `help-${width}x${height}.png`));

    const originalCode = await editorText(page), originalName = await page.locator(".current-name").innerText();
    await replaceCode(page, 'print("보호할 코드")');
    assert.equal(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }), true, "수정 문서의 새로고침·탭 닫기 경고가 설정되지 않았습니다.");
    await openExample(page, "output-calculation", "cancel");
    assert.equal(await editorText(page), 'print("보호할 코드")');
    assert.equal(await page.locator(".current-name").innerText(), originalName);

    await openExample(page, "output-calculation", "save");
    assert.ok((await storedNames(page)).includes(originalName), "저장 선택 뒤 기존 문서가 저장되지 않았습니다.");
    assert.match(await page.locator(".modified").innerText(), /\*/);
    assert.equal((await storedNames(page)).includes("예제 - 출력과 계산.py"), false, "예제가 자동 저장됐습니다.");
    assert.match(await runCurrent(page), /합계: 4500/);

    await openExample(page, "input-condition", "discard");
    assert.match(await runCurrent(page, ["민수", "85"]), /민수: 통과/);

    await openExample(page, "turtle-shape", "discard");
    await runCurrent(page, [], true);
    const pixels = await canvasPixels(page);
    assert.ok(pixels.nonBackground > 350, "turtle 예제가 Canvas에 렌더링되지 않았습니다.");
    const layout = await layoutMetrics(page);
    assertLayout(layout);

    let rotationPreserved = null;
    if (width === 360 && height === 800) {
      const nameBeforeRotation = await page.locator(".current-name").innerText();
      const codeBeforeRotation = await editorText(page);
      await page.setViewportSize({ width: 800, height: 360 });
      await page.waitForTimeout(100);
      rotationPreserved = nameBeforeRotation === await page.locator(".current-name").innerText() && codeBeforeRotation === await editorText(page);
      assert.equal(rotationPreserved, true, "화면 회전 뒤 편집 상태가 유지되지 않았습니다.");
      await page.setViewportSize({ width, height });
    }
    await page.screenshot({ path: join(outputDirectory, `classroom-${width}x${height}.png`), fullPage: true });
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(failedResources, []);
    report.viewports.push({ viewport: `${width}x${height}`, pixels, layout, rotationPreserved, originalCodeAvailable: originalCode.length > 0 });
  } finally {
    await context.close();
  }
}

async function verifyRegression(browser, report) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, acceptDownloads: true });
  const page = await context.newPage();
  const pageErrors = [], failedResources = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("response", response => { if (response.status() >= 400) failedResources.push(`${response.status()} ${response.url()}`); });
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.locator(".welcome-close").click();
    const inputOutput = await execute(page, inputProgram, ["민수", "85"]);
    assert.match(inputOutput, /민수: 통과/);
    const classOutput = await execute(page, classProgram);
    assert.match(classOutput, /학생: 지수/);
    const fileOutput = await execute(page, fileProgram);
    assert.match(fileOutput, /수업 준비 완료/);
    const moduleOutput = await execute(page, moduleProgram);
    assert.match(moduleOutput, /\d+\s+\d{4}-\d{2}-\d{2}/s);
    await execute(page, turtleProgram, [], true);
    const turtlePixels = await canvasPixels(page);
    assert.ok(turtlePixels.nonBackground > 300);

    const backupCode = 'message = "내보내기 복원"\nprint(message)';
    await replaceCode(page, backupCode);
    await page.locator(".save").click();
    await page.waitForFunction(() => !document.querySelector(".modified")?.textContent?.includes("*"));
    const downloadPromise = page.waitForEvent("download");
    await page.locator(".export").click();
    const download = await downloadPromise;
    const downloadedPath = await download.path();
    assert.ok(downloadedPath);
    const buffer = readFileSync(downloadedPath);
    await page.locator(".import").click();
    const chooserPromise = page.waitForEvent("filechooser");
    await page.locator(".import-choose").click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: "복원.py", mimeType: "text/x-python", buffer });
    await page.waitForFunction(() => document.querySelector(".current-name")?.textContent === "복원.py");
    assert.equal(await editorText(page), backupCode);
    assert.ok((await storedNames(page)).includes("복원.py"));
    const restoredOutput = await runCurrent(page);
    assert.match(restoredOutput, /내보내기 복원/);

    await replaceCode(page, 'print("전환 보호")');
    const protectedName = await page.locator(".current-name").innerText();
    await page.locator(".new-file").click();
    await page.locator('.save-layer [data-choice="cancel"]').click();
    assert.equal(await editorText(page), 'print("전환 보호")');
    assert.equal(await page.locator(".current-name").innerText(), protectedName);
    await page.locator(".file-item", { hasText: "main.py" }).click();
    await page.locator('.save-layer [data-choice="cancel"]').click();
    assert.equal(await editorText(page), 'print("전환 보호")');
    assert.equal(await page.locator(".current-name").innerText(), protectedName);
    const errorOutput = await execute(page, "print(missing_name)");
    assert.match(errorOutput, /변수가 정의되지 않았습니다/);
    assert.equal(await page.locator('.console-error[role="alert"]').count(), 1, "오류 메시지가 스크린 리더 알림으로 표시되지 않았습니다.");
    assert.match(await execute(page, 'print("오류 뒤 다시 실행")'), /오류 뒤 다시 실행/);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(failedResources, []);
    report.regression = { input: "민수: 통과", class: "학생: 지수", file: "수업 준비 완료", modules: normalize(moduleOutput), turtlePixels, exportImportRestored: true, newAndOpenProtected: true, beforeUnloadProtected: true, accessibleErrorsAndInput: true, rerunnable: true };
  } finally {
    await context.close();
  }
}

async function verifyZoom(browser, report) {
  const context = await browser.newContext({ viewport: { width: 720, height: 800 } });
  const page = await context.newPage();
  try {
    const session = await context.newCDPSession(page);
    await session.send("Emulation.setDeviceMetricsOverride", { width: 360, height: 400, deviceScaleFactor: 2, mobile: false, screenWidth: 720, screenHeight: 800 });
    await page.goto(url, { waitUntil: "networkidle" });
    assert.equal(await page.evaluate(() => innerWidth), 360);
    assertDialogInside(await dialogMetrics(page, ".welcome-dialog"), "200% 확대 시작 안내");
    await page.locator(".welcome-close").click();
    await page.locator(".help-toggle").click();
    assertDialogInside(await dialogMetrics(page, ".help-dialog"), "200% 확대 도움말");
    await page.screenshot({ path: join(outputDirectory, "zoom-200.png"), fullPage: true });
    report.zoom200 = { effectiveCssViewport: "360x400", dialogsInsideViewport: true, keyboardFocus: await page.evaluate(() => document.activeElement?.classList.contains("help-close")) };
  } finally {
    await context.close();
  }
}

async function verifyOffline(browser, report) {
  const context = await browser.newContext({ viewport: { width: 800, height: 640 }, serviceWorkers: "allow" });
  const page = await context.newPage();
  const pageErrors = [], failedResources = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("response", response => { if (response.status() >= 400) failedResources.push(`${response.status()} ${response.url()}`); });
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.locator(".welcome-close").click();
    await replaceCode(page, 'print("기존 사용자 파일")');
    await page.locator(".save").click();
    await page.evaluate(() => navigator.serviceWorker.ready);
    if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) await page.reload({ waitUntil: "networkidle" });
    const session = await context.newCDPSession(page);
    await session.send("Network.enable");
    await session.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".cm-content").waitFor();
    if (await page.evaluate(() => navigator.onLine)) {
      await session.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await context.setOffline(false);
      await session.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
      await context.setOffline(true);
    }
    await page.waitForFunction(() => !navigator.onLine);
    assert.equal(await page.locator(".connection-status").innerText(), "오프라인 사용 중");
    assert.ok((await storedNames(page)).includes("main.py"), "오프라인 재실행 뒤 기존 IndexedDB 파일이 사라졌습니다.");

    await page.locator(".help-toggle").click();
    assert.ok((await page.locator(".help-dialog").innerText()).includes(`Python 학습실 ${packageVersion}`));
    await page.locator(".help-close").click();
    await openExample(page, "output-calculation");
    assert.match(await runCurrent(page), /합계: 4500/);
    const offlineInput = await execute(page, inputProgram, ["민수", "85"]);
    assert.match(offlineInput, /민수: 통과/);
    await page.locator(".save").click();
    const offlineFile = await execute(page, fileProgram);
    assert.match(offlineFile, /수업 준비 완료/);
    await execute(page, turtleProgram, [], true);
    const pixels = await canvasPixels(page);
    assert.ok(pixels.nonBackground > 300);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".cm-content").waitFor();
    assert.ok((await storedNames(page)).includes("예제 - 출력과 계산.py"), "오프라인 저장 파일이 새로고침 뒤 유지되지 않았습니다.");
    const rerunOutput = await execute(page, 'print("오프라인 다시 실행")');
    assert.match(rerunOutput, /오프라인 다시 실행/);
    await page.screenshot({ path: join(outputDirectory, "offline-classroom.png"), fullPage: true });
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(failedResources, []);
    report.offline = { connection: "오프라인 사용 중", help: true, examples: true, input: "민수: 통과", fileIo: "수업 준비 완료", turtlePixels: pixels, reloadAndRerun: true, indexedDbPreserved: true, serviceWorker: await page.evaluate(() => Boolean(navigator.serviceWorker.controller)) };
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ executablePath: edge, headless: true, args: ["--disable-gpu"] });
try {
  const report = { url, viewports: [], regression: null, offline: null, zoom200: null };
  if (!process.env.ONLY_OFFLINE) {
    for (const [width, height] of viewports) await verifyViewport(browser, width, height, report);
    await verifyRegression(browser, report);
    await verifyZoom(browser, report);
  }
  await verifyOffline(browser, report);
  await writeFile(join(outputDirectory, "browser-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ url: report.url, viewports: report.viewports.map(item => item.viewport), regression: report.regression, offline: report.offline }, null, 2));
} finally {
  await browser.close();
}
