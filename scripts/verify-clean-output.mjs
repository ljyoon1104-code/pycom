import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
const url = process.env.APP_URL ?? "http://127.0.0.1:4174/pycom/";
const directory = process.env.OUTPUT_ARTIFACTS ?? "artifacts/clean-output";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: join(process.env["PROGRAMFILES(X86)"] ?? process.env.PROGRAMFILES, "Microsoft/Edge/Application/msedge.exe"), headless: true });
const results = [], errors = [];
async function code(page, value) {
  await page.locator(".editor-host .cm-content").click(); await page.keyboard.press("Control+A"); await page.keyboard.press("Backspace"); await page.keyboard.insertText(value);
  assert.equal((await page.locator(".editor-host .cm-line").allTextContents()).join("\n"), value);
}
async function run(page, source, answers = []) {
  await code(page, source); await page.locator(".run").click();
  for (const answer of answers) {
    await page.locator(".console-input").waitFor(); assert.equal(await page.locator(".run").isDisabled(), true);
    assert.equal(await page.locator(".stop").isEnabled(), true);
    assert.equal(await page.locator(".input-prompt").textContent(), "이름: ");
    await page.locator(".console-input").fill(answer); await page.locator(".input-submit").click();
  }
  await page.waitForFunction(() => document.querySelector(".stop").disabled);
  assert.equal(await page.locator(".run").isEnabled(), true);
  assert.equal(await page.locator(".console-status").count(), 0);
  return page.locator(".console").textContent();
}
async function drawn(page, selector) {
  await page.locator(selector).waitFor({ state: "visible" });
  assert.equal(await page.locator(selector).evaluate(canvas => {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 4; i < data.length; i += 4) if (data[i] !== data[0] || data[i + 1] !== data[1] || data[i + 2] !== data[2]) return true;
    return false;
  }), true);
}
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 360, height: 800 }]) {
    const context = await browser.newContext({ viewport }), page = await context.newPage();
    page.on("dialog", d => d.accept()); page.on("pageerror", e => errors.push(e.message));
    page.on("response", r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    assert.equal((await page.goto(url)).status(), 200);
    await page.locator(".editor-host .cm-content").waitFor();
    if (await page.locator(".welcome-dialog").isVisible()) await page.locator(".welcome-close").click();
    assert.equal(await run(page, 'print("Hello World")'), "Hello World\n");
    assert.equal(await page.locator(".execution-live").getAttribute("aria-live"), "polite");
    assert.ok((await page.locator(".execution-live").getAttribute("class")).includes("sr-only"));
    assert.match(await page.locator(".execution-owner").textContent(), /main.py/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await page.screenshot({ path: join(directory, `output-${viewport.width}x${viewport.height}.png`), fullPage: true });
    assert.equal(await run(page, "x = 10\ny = 20\nz = x + y"), "");
    assert.equal(await run(page, 'print("실행 중...")'), "실행 중...\n");
    assert.equal(await run(page, 'name = input("이름: ")\nprint(f"안녕하세요, {name}")', ["민수"]), "이름: 민수\n안녕하세요, 민수\n");
    assert.match(await run(page, "print(10 / 0)"), /1번째 줄:.*0으로 나눌 수 없습니다/);
    assert.equal(await page.locator(".cm-student-error").count(), 1);
    assert.equal(await run(page, 'print("재실행")'), "재실행\n");
    await page.locator(".clear").click(); assert.equal(await page.locator(".console").textContent(), "");
    assert.equal(await run(page, 'import turtle\nt = turtle.Turtle()\nt.forward(80)\nturtle.done()'), "");
    await drawn(page, ".turtle-canvas");
    await code(page, 'input("이름: ")'); await page.locator(".run").click(); await page.locator(".console-input").waitFor();
    await page.locator(".stop").click(); await page.waitForFunction(() => document.querySelector(".stop").disabled);
    assert.equal(await page.locator(".console").textContent(), "");
    for (const id of ["page-120-accumulate", "page-122-greeting", "page-153-turtle-square"]) {
      await page.evaluate(id => { location.hash = `#/examples/${id}`; }, id);
      await page.locator(".example-run").waitFor(); await page.locator(".example-run").click();
      if (id.includes("greeting")) {
        await page.locator("#example-answer").fill("민수");
        assert.match(await page.locator(".example-input-form label").textContent(), /이름:/);
        assert.equal(await page.locator(".example-run").isDisabled(), true);
        await page.locator(".example-input-form button").click();
      }
      await page.waitForFunction(() => !document.querySelector(".example-run").disabled);
      assert.equal(await page.locator(".example-output").textContent(), id.includes("accumulate") ? "12 42\n" : id.includes("greeting") ? "안녕하세요, 민수\n" : "");
      assert.ok((await page.locator(".example-live").getAttribute("class")).includes("sr-only"));
      if (id.includes("turtle")) await drawn(page, ".example-canvas");
    }
    await page.evaluate(() => { location.hash = "#/examples/page-124-area"; });
    await page.locator(".example-run").click(); await page.locator("#example-answer").fill("잘못된 숫자"); await page.locator(".example-input-form button").click();
    await page.waitForFunction(() => !document.querySelector(".example-run").disabled);
    assert.match(await page.locator(".example-live").textContent(), /번째 줄/);
    assert.ok(!(await page.locator(".example-live").getAttribute("class")).includes("sr-only"));
    assert.equal(await page.locator(".cm-student-error").count(), 1);
    await page.locator(".example-run").click(); await page.locator("#example-answer").fill("6"); await page.locator(".example-input-form button").click();
    await page.waitForFunction(() => !document.querySelector(".example-run").disabled);
    assert.equal(await page.locator(".example-output").textContent(), "넓이: 36\n");
    results.push({ viewport, output: "passed", empty: "passed", input: "passed", error: "passed", turtle: "passed", stop: "passed", textbook: "passed" });
    console.log("PASS", viewport); await context.close();
  }
  assert.deepEqual(errors, []); await writeFile(join(directory, "results.json"), JSON.stringify({ url, results, errors }, null, 2));
} finally { await browser.close(); }
