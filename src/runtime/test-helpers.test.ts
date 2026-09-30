import { describe, expect, it } from "vitest";
import { execute, runEvents } from "./test-helpers";
describe("작은 VM 실행 helper의 격리", () => {
  it("호출마다 VM과 이벤트 배열이 독립적이다", () => {
    const first = execute('x = 10'), second = execute('print("별도")');
    expect(first.vm).not.toBe(second.vm); expect(first.events).not.toBe(second.events);
    expect(first.events).toEqual([{ type: "complete" }]);
    expect(second.events.filter(event => event.type === "output").map(event => event.text).join("")).toBe("별도\n");
  });
  it("입력 대기와 재개는 반환한 VM에만 적용된다", () => {
    const first = execute('print(input("값: "))'), second = execute('pass');
    expect(first.events.at(-1)?.type).toBe("input");
    first.vm.resume("민수");
    expect(first.events.filter(event => event.type === "output").map(event => event.text).join("")).toBe("민수\n");
    expect(second.events).toEqual([{ type: "complete" }]);
  });
  it("events adapter가 오류를 삼키거나 성공으로 바꾸지 않는다", () => {
    expect(runEvents("print(1 / 0)").at(-1)).toMatchObject({ type: "error", error: { pythonType: "ZeroDivisionError" } });
  });
});
