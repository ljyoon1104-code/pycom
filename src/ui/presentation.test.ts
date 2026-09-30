import { describe, expect, it } from "vitest";
import { createAppShell } from "./app-shell";
import { getAppElements } from "./app-elements";
import { formatBytes, typeLabel, utf8Size } from "./presentation";

describe("UI 표시 계산과 명시적 초기화", () => {
  it("DOM 없이 import할 수 있다", () => {
    expect(typeof createAppShell).toBe("function");
    expect(typeof getAppElements).toBe("function");
    expect(typeof document).toBe("undefined");
  });
  it("기존 바이트 표기 경계를 보존한다", () => {
    expect([0, 999, 1000, 999999, 1000000].map(formatBytes)).toEqual(["0바이트", "999바이트", "1.0KB", "1000.0KB", "1.0MB"]);
  });
  it("한글과 emoji UTF-8 크기를 계산한다", () => { expect(utf8Size("가😀")).toBe(7); });
  it("기존 확장자 표시를 유지한다", () => {
    expect(["main.py", "학생.csv", "README", ""].map(typeLabel)).toEqual(["PY", "CSV", "README", ""]);
  });
});
