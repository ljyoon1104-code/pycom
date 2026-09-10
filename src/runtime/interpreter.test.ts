import { describe, expect, it } from "vitest";
import { compile } from "../compiler/compiler";
import { lex } from "../compiler/lexer";
import { CompilerError } from "../compiler/token";
import { VM, type VMEvent } from "./vm";

function execute(code: string): { events: VMEvent[]; vm: VM } { const events: VMEvent[] = []; const vm = new VM(compile(code), event => events.push(event)); vm.execute(); return { events, vm }; }
const output = (events: VMEvent[]) => events.filter((event): event is Extract<VMEvent, { type: "output" }> => event.type === "output").map(event => event.text).join("");
describe("1단계 Python 실행기", () => {
  it("숫자와 이스케이프 문자열을 토큰화한다", () => { const tokens = lex('12 3.5 "a\\n\\t\\\\"'); expect(tokens.filter(token => token.kind !== "eof").map(token => token.value)).toEqual([12, 3.5, "a\n\t\\"]); });
  it("우선순위와 괄호를 Python처럼 계산한다", () => { expect(output(execute("print(2 + 3 * 4)\nprint((2 + 3) * 4)\nprint(-2 ** 2)").events)).toBe("14\n20\n-4\n"); });
  it("변수와 수·문자열 연산을 실행한다", () => { expect(output(execute('name = "가"\ncount = 3\nprint(name * count + "나")\nprint(7 // 2, 7 % 2, 7 / 2)').events)).toBe("가가가나\n3 1 3.5\n"); });
  it("print의 여러 인수, sep, end를 처리한다", () => { expect(output(execute('print(1, 2, 3, sep="-")\nprint("안녕", end="!")').events)).toBe("1-2-3\n안녕!"); });
  it("input 대기 후 같은 VM을 재개하고 변환한다", () => { const result = execute('name = input("이름: ")\nage = int(input("나이: "))\nprint(name, age + 1)'); expect(result.events.at(-1)).toEqual({ type: "input", prompt: "이름: " }); result.vm.resume("민수"); expect(result.events.at(-1)).toEqual({ type: "input", prompt: "나이: " }); result.vm.resume("17"); expect(output(result.events)).toBe("민수 18\n"); expect(result.events.at(-1)).toEqual({ type: "complete" }); });
  it("정의되지 않은 변수와 문법 오류의 줄·열을 알린다", () => { const undefinedName = execute("print(score)").events.at(-1); expect(undefinedName).toMatchObject({ type: "error", error: { category: "name", line: 1, column: 7 } }); expect(() => compile('a = "닫히지 않음')).toThrow(CompilerError); try { compile('a = "닫히지 않음'); } catch (error) { expect((error as CompilerError).detail).toMatchObject({ line: 1, column: 5, category: "syntax" }); } });
  it("잘못된 대입과 미지원 문법을 오류로 보고한다", () => { expect(() => compile("a =")).toThrow(/대입할 값/); try { compile("if True:\n    print(1)"); } catch (error) { expect((error as CompilerError).detail.category).toBe("unsupported"); } });
  it("중지와 출력량 제한을 처리한다", () => { const paused = execute('input()'); paused.vm.stop(); expect(paused.events.at(-1)).toEqual({ type: "stopped" }); const excessive = execute('print("x" * 100001)').events.at(-1); expect(excessive).toMatchObject({ type: "error", error: { category: "runtime" } }); });
});
