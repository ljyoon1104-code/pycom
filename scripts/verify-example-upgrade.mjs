import { chromium } from "playwright-core";
import { join, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const mode = process.argv[2];
if (!["prepare", "check"].includes(mode)) throw new Error("Use prepare before deployment, then check after deployment.");
const root = resolve("artifacts/textbook-upgrade"); await mkdir(root, { recursive: true });
const context = await chromium.launchPersistentContext(join(root, "browser-profile"), {
  executablePath: join(process.env["PROGRAMFILES(X86)"] ?? process.env.PROGRAMFILES, "Microsoft/Edge/Application/msedge.exe"),
  headless: true, acceptDownloads: true, viewport: { width: 1024, height: 768 },
});
const page = await context.newPage(); const errors = []; page.on("pageerror", error => errors.push(error.message)); page.on("dialog", dialog => dialog.accept());
try {
  await page.goto("https://ljyoon1104-code.github.io/pycom/", { waitUntil: "networkidle" });
  if (await page.locator(".welcome-dialog").isVisible()) await page.locator(".welcome-close").click();
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (mode === "prepare") {
    await page.locator(".editor-host .cm-content").click(); await page.keyboard.press("Control+A"); await page.keyboard.insertText('print("업데이트 보존 확인")');
    await page.locator(".save-as").click(); await page.locator(".name-input").fill("upgrade-check.py"); await page.locator(".name-confirm").click();
    await page.locator(".help-toggle").click(); assert.equal(await page.locator(".app-version").textContent(), "1.1.0");
    await page.locator(".help-close").click();
  } else {
    await page.locator(".file-item").filter({ hasText: "upgrade-check.py" }).click();
    assert.equal((await page.locator(".editor-host .cm-line").allTextContents()).join("\n"), 'print("업데이트 보존 확인")');
    await page.locator(".run").click(); await page.waitForFunction(() => !document.querySelector(".run").disabled); assert.match(await page.locator(".console").textContent(), /업데이트 보존 확인/);
    await page.locator(".help-toggle").click(); assert.equal(await page.locator(".app-version").textContent(), "1.2.0"); await page.locator(".help-close").click();
    const downloadPromise = page.waitForEvent("download"); await page.locator(".backup-all").click(); const download = await downloadPromise; await download.saveAs(join(root, "after-update.pylab-backup.json"));
  }
  assert.deepEqual(errors, []); await writeFile(join(root, `${mode}.json`), JSON.stringify({ passed: true, mode, errors })); console.log(`PASS real Pages upgrade ${mode}`);
} finally { await context.close(); }
