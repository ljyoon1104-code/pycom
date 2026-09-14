import { describe, expect, it } from "vitest";
import { compile } from "../compiler/compiler";
import { VM, MAX_CALL_DEPTH, type VMEvent } from "./vm";
const start = (code: string) => { const events: VMEvent[] = [], vm = new VM(compile(code), event => events.push(event)); vm.execute(); return { vm, events }; };
const text = (events: VMEvent[]) => events.filter(e => e.type === "output").map(e => e.text).join("");
const expectOutput = (code: string, expected: string) => { const { events } = start(code); expect(events.at(-1)).toEqual({ type: "complete" }); expect(text(events)).toBe(expected); };
describe("Core v2 재귀와 프레임", () => {
  it("직접 재귀 팩토리얼", () => expectOutput('def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\nprint(factorial(5))', "120\n"));
  it("간접 재귀", () => expectOutput('def even(n):\n    if n == 0:\n        return True\n    return odd(n - 1)\ndef odd(n):\n    if n == 0:\n        return False\n    return even(n - 1)\nprint(even(10), odd(10))', "True False\n"));
  it("함수 별칭을 통한 재귀", () => expectOutput('def count(n):\n    if n == 0:\n        return 0\n    return 1 + alias(n - 1)\nalias = count\nprint(count(7))', "7\n"));
  it("호출 깊이 경계 직전에는 정상 실행", () => expectOutput(`def count(n):\n    if n == 0:\n        return 0\n    return 1 + count(n - 1)\nprint(count(${MAX_CALL_DEPTH - 1}))`, `${MAX_CALL_DEPTH - 1}\n`));
  it("깊이 초과는 정확한 줄의 한국어 RecursionError", () => {
    const event = start('def forever():\n    return forever()\nforever()').events.at(-1);
    expect(event).toMatchObject({ type: "error", error: { pythonType: "RecursionError", line: 2, column: 12 } });
    if (event?.type === "error") { expect(event.error.message).toMatch(/호출 깊이/); expect(event.error.message).not.toMatch(/RangeError|stack|at VM/i); }
  });
  it("RecursionError는 잡은 뒤 다음 함수를 호출할 수 있다", () => expectOutput('def forever():\n    return forever()\ntry:\n    forever()\nexcept RecursionError:\n    print("깊이 제한")\ndef done():\n    return 7\nprint(done())', "깊이 제한\n7\n"));
  it("RuntimeError는 하위 RecursionError도 잡는다", () => expectOutput('def forever():\n    return forever()\ntry:\n    forever()\nexcept RuntimeError:\n    print("처리")', "처리\n"));
  it("재귀 중 입력 대기와 모든 프레임 복귀", () => {
    const { events, vm } = start('def ask(n):\n    if n == 0:\n        return int(input("수: "))\n    return ask(n - 1) + 1\nprint(ask(3))');
    expect(events.at(-1)).toEqual({ type: "input", prompt: "수: " }); vm.resume("5");
    expect(text(events)).toBe("8\n"); expect(events.at(-1)).toEqual({ type: "complete" });
  });
  it("재귀 중 예외를 가장 가까운 호출 프레임에서 처리", () => expectOutput('def divide(n):\n    if n == 0:\n        return 1 / 0\n    try:\n        return divide(n - 1)\n    except ZeroDivisionError:\n        return n\nprint(divide(5))', "1\n"));
  it("함수 반환 후 남은 except가 후속 예외를 가로채지 않는다", () => {
    const result = start('def f():\n    try:\n        return 3\n    except NameError:\n        print("실패")\nf()\nprint(missing)');
    expect(text(result.events)).toBe(""); expect(result.events.at(-1)).toMatchObject({ type: "error", error: { line: 7, pythonType: "NameError" } });
  });
  it("반복적으로 잡는 예외도 JS 호출 스택을 늘리지 않는다", () => expectOutput('for n in range(5000):\n    try:\n        int("x")\n    except ValueError:\n        pass\nprint("끝")', "끝\n"));
  it("재귀 메서드는 self와 지역 변수를 프레임별로 보존", () => expectOutput('class Count:\n    def down(self, n):\n        if n == 0:\n            return 0\n        return self.down(n - 1) + 1\nprint(Count().down(10))', "10\n"));
  it("중지된 재귀 입력에 뒤늦은 응답을 넣어도 재개하지 않는다", () => {
    const { events, vm } = start('def ask(n):\n    if n == 0:\n        return input()\n    return ask(n - 1)\nprint(ask(3))');
    vm.stop(); vm.resume("뒤늦은 입력"); expect(events.at(-1)).toEqual({ type: "stopped" }); expect(text(events)).toBe("");
    expectOutput('print("재실행")', "재실행\n");
  });
  it("재귀를 반복 재시도해도 명령 제한을 except로 우회하지 못한다", () => {
    const { events } = start('def again():\n    try:\n        return again()\n    except Exception:\n        return again()\ntry:\n    again()\nexcept:\n    print("우회")');
    expect(text(events)).not.toContain("우회"); expect(events.at(-1)).toMatchObject({ type: "error", error: { message: "명령 실행 횟수 제한을 초과했습니다." } });
  });
});
