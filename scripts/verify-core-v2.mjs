import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
const url = process.env.APP_URL ?? "http://127.0.0.1:4174/pycom/", directory = process.env.CORE_ARTIFACTS ?? "artifacts/core-v2-browser";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: join(process.env["PROGRAMFILES(X86)"] ?? process.env.PROGRAMFILES, "Microsoft/Edge/Application/msedge.exe"), headless: true });
const results = [], errors = [];
const programs = [
  ['sort', 'students = [("민수", 80), ("지수", 95)]\nstudents.sort(key=lambda student: student[1], reverse=True)\nfor index, student in enumerate(students, start=1):\n    print(index, student)', "1 ('지수', 95)\n2 ('민수', 80)\n"],
  ['inheritance', 'class Person:\n    def __init__(self, name):\n        self.name = name\nclass Student(Person):\n    def __init__(self, name, grade):\n        super().__init__(name)\n        self.grade = grade\nstudent = Student("민수", 2)\nprint(student.name, student.grade)\nprint(isinstance(student, Person))', '민수 2\nTrue\n'],
  ['recursion', 'def factorial(n):\n    return 1 if n <= 1 else n * factorial(n - 1)\nprint(factorial(5))', '120\n'],
  ['math', 'import math\nprint(math.sqrt(81))\nprint(math.factorial(5))\nprint(round(math.pi, 2))', '9.0\n120\n3.14\n'],
  ['sets', 'print(sorted({x for x in [1, 2, 2, 3]}))\nprint({x: x * x for x in range(3)})', '[1, 2, 3]\n{0: 0, 1: 1, 2: 4}\n'],
  ['finally', 'def f():\n    try:\n        return 17\n    finally:\n        print("검사 완료")\nprint(f())', '검사 완료\n17\n'],
  ['map-callback', 'def f(x):\n    try:\n        raise ValueError("검사")\n    except ValueError:\n        return x\nprint(list(map(f, [1, 2])))\nprint(list(map(sorted, [[2, 1]])))', '[1, 2]\n[[1, 2]]\n'],
];
const tab = (page, name) => page.locator('.document-tabs [role="tab"]').filter({ has: page.locator('.document-tab-name', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }) });
async function code(page, text) { await page.locator('.editor-host .cm-content').click(); await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace'); await page.keyboard.insertText(text); assert.equal((await page.locator('.editor-host .cm-line').allTextContents()).join('\n'), text); }
async function run(page, source, answers = []) { await code(page, source); await page.locator('.run').click(); for (const answer of answers) { await page.locator('.console-input').fill(answer); await page.locator('.input-submit').click(); } await page.waitForFunction(() => document.querySelector('.stop').disabled); assert.equal(await page.locator('.run').isEnabled(), true); return page.locator('.console').textContent(); }
async function save(page, name) { await page.locator('.save').click(); if (name) { await page.locator('.document-dialog-layer .name-input').fill(name); await page.locator('[data-choice="name"]').click(); } await page.waitForFunction(() => !document.querySelector('.modified').textContent.includes('*')); }
async function layout(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  const outside = await page.locator('.topbar button,.document-add,.document-opened,.input-submit').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).filter(node => { const r = node.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1 || r.width < 1; }).map(node => node.className)); assert.deepEqual(outside, []);
  const overlaps = await page.locator('.topbar button,.topbar a').evaluateAll(nodes => { const boxes = nodes.filter(node => node.getClientRects().length).map(node => node.getBoundingClientRect()); return boxes.flatMap((a, i) => boxes.slice(i + 1).filter(b => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1)); }); assert.deepEqual(overlaps, []);
}
try {
  for (const [width, height] of [[360, 800], [800, 360], [768, 1024], [1024, 768], [1440, 900]]) {
    const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true }), page = await context.newPage(); page.on('dialog', dialog => dialog.accept()); page.on('pageerror', error => errors.push(error.message));
    assert.equal((await page.goto(url)).status(), 200); await page.locator('.editor-host .cm-content').waitFor(); if (await page.locator('.welcome-dialog').isVisible()) await page.locator('.welcome-close').click();
    for (const [name, source, expected] of programs) assert.equal(await run(page, source), expected, `${width}: ${name}`);
    assert.equal(await run(page, 'name = input("이름: ")\nprint(f"안녕하세요, {name}")', ['민수']), '이름: 민수\n안녕하세요, 민수\n');
    assert.equal(await run(page, 'def key(x):\n    return int(input("순서: "))\nprint(sorted([10, 20], key=key))', ['2', '1']), '순서: 2\n순서: 1\n[20, 10]\n');
    await code(page, 'def key(x):\n    while True:\n        pass\ntry:\n    sorted([1], key=key)\nexcept:\n    print("잡으면 안 됨")'); await page.locator('.run').click(); await page.locator('.stop').click(); await page.waitForFunction(() => document.querySelector('.stop').disabled); assert.equal(await page.locator('.console').textContent(), '');
    await code(page, 'def add(a, b):\n    return a + b'); await save(page, 'calculator.py');
    await page.locator('.document-add').click(); await code(page, 'from calculator import add\nprint(add(3, 4))'); await save(page, 'main.py');
    await tab(page, 'calculator.py').click(); await code(page, 'def add(a, b):\n    return 999'); await tab(page, 'main.py').click(); assert.equal(await run(page, 'from calculator import add\nprint(add(3, 4))'), '7\n');
    await page.locator('.document-add').click(); await code(page, 'def fail():\n    return missing_value'); const module = 'very_long_saved_module_error_name'; await save(page, `${module}.py`); await tab(page, 'main.py').click();
    assert.match(await run(page, `import ${module}\n${module}.fail()`), /very_long_saved_module_error_name.py: 2번째 줄:/); assert.equal(await page.locator('.cm-student-error').count(), 0); await layout(page);
    await page.locator('.help-toggle').click(); await page.locator('.core-help').scrollIntoViewIfNeeded(); const dialog = await page.locator('.help-dialog').boundingBox(); assert.ok(dialog && dialog.x >= -1 && dialog.y >= -1 && dialog.x + dialog.width <= width + 1 && dialog.y + dialog.height <= height + 1); await page.locator('.help-close').click();
    await page.screenshot({ path: join(directory, `responsive-${width}x${height}.png`), fullPage: true });
    await page.evaluate(() => navigator.serviceWorker.ready); await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const cdp = await context.newCDPSession(page); await cdp.send('Network.enable'); await context.setOffline(true); await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }); await page.reload(); await page.locator('.editor-host .cm-content').waitFor();
    assert.equal(await run(page, 'from calculator import add\nprint(add(3, 4))'), '7\n');
    for (const [name, source, expected] of programs) assert.equal(await run(page, source), expected, `offline ${width}: ${name}`);
    assert.equal(await run(page, 'with open("core.txt", "w") as file:\n    file.write("오프라인 저장")\nwith open("core.txt") as file:\n    print(file.read())'), '오프라인 저장\n');
    assert.equal(await run(page, 'name = input("이름: ")\nprint(name)', ['민수']), '이름: 민수\n민수\n');
    await run(page, 'import turtle\nt = turtle.Turtle()\nt.forward(80)\nturtle.done()'); assert.equal(await page.locator('.turtle-canvas').isVisible(), true);
    await layout(page); results.push({ viewport: `${width}x${height}`, programs: programs.map(p => p[0]), input: true, savedModuleOnly: true, moduleError: true, help: true, offline: true, fileIO: true, turtle: true }); console.log(`PASS ${width}x${height}`); await context.close();
  }
  assert.deepEqual(errors, []); await writeFile(join(directory, 'results.json'), JSON.stringify({ url, results, errors }, null, 2));
} finally { await browser.close(); }
