import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compile } from "../compiler/compiler";
import { decodeImportedBytes } from "../files/encoding";
import { appFile, MemoryFileStore } from "../files/storage";
import { VM, type VMEvent } from "../runtime/vm";
import { APP_VERSION } from "./version";
import {
  CLASSROOM_EXAMPLES,
  exampleDocument,
  exampleFileName,
  mayReplaceDocument,
  rememberWelcomeClosed,
  shouldShowWelcome,
  WELCOME_SETTINGS_KEY,
} from "./classroom";

class MemorySettings implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function executeExample(code: string): VMEvent[] {
  const events: VMEvent[] = [];
  const vm = new VM(compile(code), event => events.push(event), new Map(), { clock: () => new Date(2026, 2, 1), entropy: () => 10 });
  vm.execute();
  const answers = ["민수", "85"];
  while (events.at(-1)?.type === "input") vm.resume(answers.shift() ?? "");
  return events;
}

describe("14단계 첫 화면 설정", () => {
  it("첫 접속에는 시작 안내를 표시한다", () => expect(shouldShowWelcome(new MemorySettings())).toBe(true));
  it("다시 보지 않기를 저장하면 재접속 때 자동 표시하지 않는다", () => {
    const settings = new MemorySettings();
    rememberWelcomeClosed(settings, true);
    expect(settings.getItem(WELCOME_SETTINGS_KEY)).toBe("hidden");
    expect(shouldShowWelcome(settings)).toBe(false);
  });
  it("다시 보지 않기를 선택하지 않으면 자동 표시 설정을 바꾸지 않는다", () => {
    const settings = new MemorySettings();
    rememberWelcomeClosed(settings, false);
    expect(shouldShowWelcome(settings)).toBe(true);
  });
  it("안내 설정 키는 IndexedDB 파일 저장소 이름과 분리되어 있다", () => {
    expect(WELCOME_SETTINGS_KEY).not.toContain("python-learning-lab-files");
  });
});

describe("14단계 자체 제작 예제", () => {
  it("필수 주제의 자체 제작 예제 11개를 중복 없이 제공한다", () => {
    expect(CLASSROOM_EXAMPLES).toHaveLength(11);
    expect(new Set(CLASSROOM_EXAMPLES.map(example => example.id)).size).toBe(11);
    expect(CLASSROOM_EXAMPLES.map(example => example.title)).toEqual([
      "출력과 계산", "input()과 조건문", "for 반복문", "리스트와 리스트 내포", "함수", "클래스",
      "파일 쓰기와 읽기", "예외 처리", "random", "datetime.date", "turtle 도형",
    ]);
  });
  it.each(CLASSROOM_EXAMPLES)("$title 예제가 현재 인터프리터에서 끝까지 실행된다", example => {
    const events = executeExample(example.code);
    expect(events.find(event => event.type === "error")).toBeUndefined();
    expect(events.at(-1)?.type).toBe("complete");
  });
  it("input 예제는 대표 입력을 받아 조건문 결과를 출력한다", () => {
    const example = CLASSROOM_EXAMPLES.find(item => item.id === "input-condition")!;
    const output = executeExample(example.code).filter(event => event.type === "output").map(event => event.text).join("");
    expect(output).toBe("민수: 통과\n");
  });
  it("turtle 예제는 텍스트 가짜 출력이 아닌 그래픽 명령을 만든다", () => {
    const example = CLASSROOM_EXAMPLES.find(item => item.id === "turtle-shape")!;
    const events = executeExample(example.code);
    expect(events.some(event => event.type === "graphics" && event.commands.some(command => command.type === "line"))).toBe(true);
  });
  it("예제 문서는 Python 파일 이름과 수정 상태를 갖지만 저장 객체는 만들지 않는다", () => {
    const example = CLASSROOM_EXAMPLES[0];
    expect(exampleDocument(example)).toEqual({ name: exampleFileName(example.title), content: example.code, dirty: true });
  });
  it("예제 실행 뒤 별도의 일반 코드를 다시 실행할 수 있다", () => {
    executeExample(CLASSROOM_EXAMPLES.at(-1)!.code);
    const output = executeExample('print("다시 실행")').filter(event => event.type === "output").map(event => event.text).join("");
    expect(output).toBe("다시 실행\n");
  });
});

describe("14단계 저장 보호 정책", () => {
  it.each([
    [false, undefined, true, true],
    [true, "save", true, true],
    [true, "save", false, false],
    [true, "discard", true, true],
    [true, "cancel", true, false],
  ] as const)("dirty=%s choice=%s save=%s 전환 결과를 계산한다", (dirty, choice, saved, expected) => {
    expect(mayReplaceDocument(dirty, choice, saved)).toBe(expected);
  });
  it("UTF-8 내보내기 바이트를 다시 가져오면 코드가 동일하게 복원된다", async () => {
    const source = 'name = "민수"\nprint(name)';
    const decoded = decodeImportedBytes(new TextEncoder().encode(source), "auto");
    const store = new MemoryFileStore();
    await store.put(appFile("복원.py", decoded.content, 123, decoded.encoding, decoded.byteSize));
    expect(await store.get("복원.py")).toMatchObject({ content: source, encoding: "utf-8" });
  });
});

describe("14단계 버전", () => {
  it("package.json에서 주입한 수업 배포판 버전을 사용한다", () => {
    const packageVersion = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
    expect(APP_VERSION).toBe(packageVersion);
  });
});
