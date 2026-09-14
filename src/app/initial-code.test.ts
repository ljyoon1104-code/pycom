import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { initialCode } from "./initial-code";
import { Documents, contentOf } from "../editor/documents";
import { appFile } from "../files/storage";
import { compile } from "../compiler/compiler";
import { VM, type VMEvent } from "../runtime/vm";

const workspace = () => {
  const docs = new Documents(code => EditorState.create({ doc: code }));
  const first = docs.create("main.py", initialCode);
  first.savedContent = initialCode;
  return docs;
};
describe("최초 문서와 기존 사용자 보호", () => {
  it("기본 코드는 정확한 한 줄이며 실제 실행 결과가 Hello World다", () => {
    expect(initialCode).toBe('print("Hello World")');
    const events: VMEvent[] = [];
    new VM(compile(initialCode), event => events.push(event)).execute();
    expect(events.some(event => event.type === "error" || event.type === "input")).toBe(false);
    expect(events.filter(event => event.type === "output").map(event => event.text).join("")).toBe("Hello World\n");
  });
  it("깨끗한 최초 접속만 기본 문서를 유지한다", () => {
    const docs = workspace();
    expect(docs.restoreInitial(null, new Map())).toBe(false);
    expect(contentOf(docs.active)).toBe(initialCode);
    expect(docs.dirty).toHaveLength(0);
    expect(JSON.parse(docs.serialize()).names).toEqual([]);
  });
  it("탭 기록이 없으면 저장된 main.py를 읽고 파일을 변경하지 않는다", () => {
    const docs = workspace(), file = appFile("main.py", "# 기존 내용"), before = structuredClone(file);
    docs.restoreInitial(null, new Map([[file.name, file]]));
    expect(contentOf(docs.active)).toBe(file.content);
    expect(file).toEqual(before);
    expect(docs.items).toHaveLength(1);
  });
  it("main.py가 없어도 기존 Python 파일을 우선 연다", () => {
    const docs = workspace(), files = [appFile("a.txt", "메모"), appFile("lesson.py", "# 수업")];
    docs.restoreInitial("broken", new Map(files.map(file => [file.name, file])));
    expect(docs.active.fileName).toBe("lesson.py");
  });
  it("텍스트 파일만 저장되어 있어도 기본 코드로 교체하지 않는다", () => {
    const docs = workspace(), file = appFile("memo.txt", "메모");
    docs.restoreInitial(null, new Map([[file.name, file]]));
    expect(contentOf(docs.active)).toBe("메모");
  });
  it("복원 가능한 탭 순서와 활성 문서를 우선 보존한다", () => {
    const docs = workspace(), files = [appFile("main.py", "main"), appFile("lesson.py", "lesson")];
    docs.restoreInitial(JSON.stringify({ names: ["lesson.py", "main.py"], activeName: "lesson.py" }), new Map(files.map(file => [file.name, file])));
    expect(docs.items.map(doc => doc.fileName)).toEqual(["lesson.py", "main.py"]);
    expect(contentOf(docs.active)).toBe("lesson");
  });
  it("저장하지 않은 첫 문서의 수정은 세션에 저장되지 않는다", () => {
    const docs = workspace();
    docs.active.state = EditorState.create({ doc: "# 저장하지 않은 내용" });
    const next = workspace();
    next.restoreInitial(docs.serialize(), new Map());
    expect(contentOf(next.active)).toBe(initialCode);
  });
  it("새 파일은 여전히 빈 문서다", () => {
    expect(contentOf(workspace().create("새 파일 1.py"))).toBe("");
  });
});
