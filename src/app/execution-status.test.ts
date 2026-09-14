import { describe, expect, it } from "vitest";
import { announceExecution } from "./execution-status";
import { compile } from "../compiler/compiler";
import { VM, type VMEvent } from "../runtime/vm";

function liveRegion() {
  const classes = new Set<string>(), attributes = new Map<string, string>();
  const element = { textContent: "", classList: { toggle(name: string, on: boolean) { if (on) classes.add(name); else classes.delete(name); } }, setAttribute(name: string, value: string) { attributes.set(name, value); } };
  return { element: element as unknown as HTMLElement, classes, attributes };
}
describe("실행 상태와 학생 출력 분리", () => {
  for (const text of ["실행 중", "실행 완료", "실행 중지", "입력을 기다리고 있습니다."]) {
    it(`${text}: 시각적 출력 대신 접근성 알림으로 유지`, () => {
      const live = liveRegion(); announceExecution(live.element, text);
      expect(live.classes.has("sr-only")).toBe(true);
      expect(live.attributes.get("role")).toBe("status");
      expect(live.attributes.get("aria-live")).toBe("polite");
      expect(live.attributes.get("aria-atomic")).toBe("true");
      expect(live.element.textContent).toBe(text);
    });
  }
  it("오류는 표시하고 다음 실행 상태는 다시 화면에서 숨긴다", () => {
    const live = liveRegion(); announceExecution(live.element, "1번째 줄: 오류", true);
    expect(live.classes.has("sr-only")).toBe(false);
    announceExecution(live.element, "실행 중"); expect(live.classes.has("sr-only")).toBe(true);
  });
  for (const [code, output] of [[ 'print("Hello World")', "Hello World\n" ], ["x = 10\ny = 20\nz = x + y", ""], ['print("실행 중...")', "실행 중...\n"]]) {
    it(`학생 출력 보존: ${code}`, () => {
      const events: VMEvent[] = []; new VM(compile(code), event => events.push(event)).execute();
      expect(events.filter(event => event.type === "output").map(event => event.text).join("")).toBe(output);
      expect(events.some(event => event.type === "error")).toBe(false);
    });
  }
});
