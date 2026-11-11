import assert from "node:assert/strict";

// Editor verification only: execution output is never normalized or filtered.
export const normalizeEditorText = value => value.replace(/\r\n/g, "\n").trimEnd();
export async function editorText(page) {
  return normalizeEditorText((await page.locator(".editor-host .cm-line").allTextContents()).join("\n"));
}
export async function replaceCode(page, code) {
  const editor = page.locator(".editor-host .cm-content");
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(code);
  assert.equal(await editorText(page), normalizeEditorText(code));
}
export async function runCurrent(page, answers = []) {
  await page.locator(".run").click();
  for (const answer of answers) {
    const input = page.locator(".console-input");
    await input.waitFor({ state: "visible" });
    await input.fill(answer);
    await page.locator(".input-submit").click();
  }
  await page.waitForFunction(() => document.querySelector(".stop")?.disabled === true && document.querySelector(".run")?.disabled === false);
  assert.equal(await page.locator(".run").isEnabled(), true);
  return page.locator(".console").textContent();
}
