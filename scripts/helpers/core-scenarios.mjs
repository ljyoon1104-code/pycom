import assert from "node:assert/strict";

export async function verifyCoreScenarios(run) {
  const cases = [
    ["conditions-loops", "total = 0\nfor n in range(5):\n    if n % 2 == 0:\n        total += n\nprint(total)", "6\n"],
    ["recursion", "def fact(n):\n    if n < 2:\n        return 1\n    return n * fact(n - 1)\nprint(fact(6))", "720\n"],
    ["finally", 'def f():\n    try:\n        1 / 0\n    finally:\n        print("정리")\ntry:\n    f()\nexcept ZeroDivisionError:\n    print("처리")', "정리\n처리\n"],
    ["closure", "def outer(x):\n    def inner(y):\n        return x + y\n    return inner\nadd = outer(5)\nprint(add(7))", "12\n"],
    ["inheritance-super", "class A:\n    def value(self):\n        return 7\nclass B(A):\n    def value(self):\n        return super().value() + 1\nprint(B().value())", "8\n"],
  ];
  for (const [name, source, expected] of cases) assert.equal(await run(source), expected, name);
  const output = await run('try:\n    for n in range(1000):\n        print("x" * 1000)\nexcept:\n    print("caught")');
  assert.match(output, /출력량 제한을 초과했습니다/); assert.ok(!output.includes("caught"));
  assert.equal(await run('print("출력 제한 후 재실행")'), "출력 제한 후 재실행\n");
  const nestedCalls = 'f('.repeat(20) + '1' + ')'.repeat(20);
  const instructions = await run('def f(x):\n    return x + 1\ntry:\n    while True:\n        ' + nestedCalls + '\nexcept Exception:\n    print("caught")');
  assert.match(instructions, /명령 실행 횟수 제한을 초과했습니다/); assert.ok(!instructions.includes("caught"));
  assert.equal(await run('print("명령 제한 후 재실행")'), "명령 제한 후 재실행\n");
  return { programs: cases.map(([name]) => name), outputLimitRestart: true, instructionLimitRestart: true };
}
