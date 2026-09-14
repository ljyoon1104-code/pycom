import { describe, expect, it, vi } from "vitest";
import { compile } from "../compiler/compiler";
import { VM, type VMEvent } from "../runtime/vm";
import { CLASSROOM_EXAMPLES } from "../app/classroom";
import { appFile, validateFileSet, validFileName } from "../files/storage";
import { buildRestoreSet, createWorkspaceBackup } from "../files/backup";
import { TEXTBOOK_EXAMPLES } from "./catalog";
import { emptyFilters, exampleHash, exampleRoute, filterExamples, STATUS, TOPICS, type LearningExample } from "./model";
import { ExampleRunner, type ExampleWorker } from "./runner";
import type { FromWorker, ToWorker } from "../runtime/protocol";

export function executeExample(example: Pick<LearningExample, "code" | "inputGuide" | "dataFiles">) {
  const events: VMEvent[] = [];
  const virtualFiles = new Map((example.dataFiles ?? []).map(file => [file.name, file.content]));
  const vm = new VM(compile(example.code), event => events.push(event), virtualFiles);
  vm.execute();
  let index = 0;
  while (events.at(-1)?.type === "input" && index < (example.inputGuide?.length ?? 0)) vm.resume(example.inputGuide![index++]);
  return { events, output: events.filter(event => event.type === "output").map(event => event.text).join(""), virtualFiles };
}
describe("textbook catalog", () => {
  it("has 56 unique stable IDs and retains 11 basic examples", () => {
    expect(TEXTBOOK_EXAMPLES).toHaveLength(56); expect(CLASSROOM_EXAMPLES).toHaveLength(11);
    expect(new Set(TEXTBOOK_EXAMPLES.map(e => e.id)).size).toBe(56);
  });
  it("validates metadata and temporary file limits", () => {
    for (const e of TEXTBOOK_EXAMPLES) {
      expect(e.title.trim()).not.toBe(""); expect(e.summary.trim()).not.toBe("");
      expect(e.collection).toBe("textbook"); expect(Number.isInteger(e.page)).toBe(true); expect(Number.isInteger(e.order)).toBe(true);
      expect(e.topics.length).toBeGreaterThan(0); expect(validFileName(e.suggestedFileName)).toBe(true);
      validateFileSet((e.dataFiles ?? []).map(file => appFile(file.name, file.content)));
      if (e.status === "input") expect(e.inputGuide?.length).toBeGreaterThan(0);
      if (e.status === "data") expect(e.dataFiles?.length).toBeGreaterThan(0);
    }
  });
  it("orders by numeric page and stable within-page position", () => {
    expect(filterExamples([...TEXTBOOK_EXAMPLES].reverse(), emptyFilters())).toEqual(TEXTBOOK_EXAMPLES);
  });
  it.each(["153", "turtle", "INPUT", "리스트", "readline", "CSV"])("searches page, concept and syntax %s", query => {
    expect(filterExamples(TEXTBOOK_EXAMPLES, { ...emptyFilters(), query }).length).toBeGreaterThan(0);
  });
  it.each(TOPICS)("filters topic %s", topic => {
    const results = filterExamples(TEXTBOOK_EXAMPLES, { ...emptyFilters(), topic });
    expect(results.length).toBeGreaterThan(0); expect(results.every(e => e.topics.includes(topic))).toBe(true);
  });
  it.each(Object.keys(STATUS))("filters status %s", status => {
    const results = filterExamples(TEXTBOOK_EXAMPLES, { ...emptyFilters(), status });
    expect(results.length).toBeGreaterThan(0); expect(results.every(e => e.status === status)).toBe(true);
  });
  it("handles empty search results and reset without mutation", () => {
    const filters = { query: "없는검색결과12345", topic: "", status: "" };
    expect(filterExamples(TEXTBOOK_EXAMPLES, filters)).toEqual([]);
    expect(filterExamples(TEXTBOOK_EXAMPLES, emptyFilters())).toHaveLength(56);
    expect(filters.query).toBe("없는검색결과12345");
  });
  it("documents all six corrected concepts without original code", () => {
    const corrected = TEXTBOOK_EXAMPLES.filter(e => e.status === "corrected"); expect(corrected).toHaveLength(6);
    expect(corrected.every(e => !!e.correctionNote)).toBe(true);
  });
  it.each(TEXTBOOK_EXAMPLES)("compiles and executes $id with its own inputs/data", example => {
    const before = JSON.stringify(example); const result = executeExample(example);
    expect(result.events.find(event => event.type === "error")).toBeUndefined();
    expect(result.events.at(-1)?.type).toBe("complete");
    if (example.expectedOutput !== undefined) expect(result.output).toBe(example.expectedOutput);
    if (example.expectedGraphic) expect(result.events.some(event => event.type === "graphics")).toBe(true);
    expect(JSON.stringify(example)).toBe(before);
  });
});
describe("hash routing", () => {
  it.each(TEXTBOOK_EXAMPLES)("round trips direct link $id", example => expect(exampleRoute(exampleHash(example.id))).toEqual({ active: true, id: example.id }));
  it.each(["#/examples", "#/examples/"])("opens list %s", hash => expect(exampleRoute(hash)).toEqual({ active: true }));
  it("keeps unknown and malformed links inside the examples error page", () => {
    expect(exampleRoute("#/examples/no-such-example")).toEqual({ active: true, id: "no-such-example" });
    expect(exampleRoute("#/examples/%xx")).toEqual({ active: true, id: "invalid" });
    expect(exampleRoute("#/editor")).toEqual({ active: false });
  });
});
class FakeWorker implements ExampleWorker {
  onmessage: ExampleWorker["onmessage"] = null; onerror: ExampleWorker["onerror"] = null;
  postMessage = vi.fn<(message: ToWorker) => void>(); terminate = vi.fn();
  emit(data: FromWorker) { this.onmessage?.({ data } as MessageEvent<FromWorker>); }
}
describe("isolated Worker lifecycle", () => {
  const data = TEXTBOOK_EXAMPLES.find(e => e.status === "data")!;
  function setup() { const workers: FakeWorker[] = [], events: FromWorker[] = []; const runner = new ExampleRunner(() => { const worker = new FakeWorker(); workers.push(worker); return worker; }, event => events.push(event)); return { workers, events, runner }; }
  it("passes only own sample files; never forwards file writes to student storage", () => {
    const { workers, events, runner } = setup(); runner.start(data);
    expect(workers[0].postMessage).toHaveBeenCalledWith({ type: "run", code: data.code, files: data.dataFiles });
    workers[0].emit({ type: "file-change", name: "student.py", content: "changed" }); expect(events).toEqual([]);
  });
  it.each(["complete", "stopped"] as const)("discards worker and files on %s", type => {
    const { workers, runner, events } = setup(); runner.start(data); workers[0].emit({ type });
    expect(workers[0].terminate).toHaveBeenCalledOnce(); expect(workers[0].onmessage).toBeNull(); expect(events).toEqual([{ type }]);
  });
  it("stops at input and starts a fresh worker with pristine samples", () => {
    const { workers, runner, events } = setup(); runner.start(data); runner.stop(); runner.start(data);
    expect(workers).toHaveLength(2); expect(events).toContainEqual({ type: "stopped" });
    expect(workers[1].postMessage).toHaveBeenCalledWith({ type: "run", code: data.code, files: data.dataFiles });
  });
  it("forwards input through the standard protocol", () => {
    const { workers, runner } = setup(); runner.start(data); runner.input("민수");
    expect(workers[0].postMessage).toHaveBeenCalledWith({ type: "input", value: "민수" });
  });
  it("ignores stale callbacks after navigation and disposes listeners", () => {
    const { workers, runner, events } = setup(); runner.start(data); const late = workers[0].onmessage!;
    runner.dispose(); late({ data: { type: "output", text: "late" } } as MessageEvent<FromWorker>);
    expect(events).toEqual([]); expect(workers[0].onerror).toBeNull();
  });
  it("preserves error lines and supports restart after limits", () => {
    const { workers, runner, events } = setup(); runner.start(data);
    const error: FromWorker = { type: "error", error: { line: 3, column: 1, category: "runtime", message: "출력 제한" } };
    workers[0].emit(error); expect(events).toEqual([error]); expect(workers[0].terminate).toHaveBeenCalledOnce(); runner.start(data); expect(workers).toHaveLength(2);
  });
  it("hides internal system error details", () => {
    const { workers, runner, events } = setup(); runner.start(data); workers[0].onerror!({ message: "secret stack" } as ErrorEvent);
    expect(JSON.stringify(events)).not.toContain("secret"); expect(workers[0].terminate).toHaveBeenCalledOnce();
  });
  it("validates path escape before creating a worker", () => {
    const { workers, runner } = setup(); expect(() => runner.start({ ...data, dataFiles: [{ name: "../student.py", content: "x", encoding: "utf-8" }] })).toThrow(); expect(workers).toHaveLength(0);
  });
  it.each(["keep", "overwrite", "rename"] as const)("uses existing data conflict policy %s", policy => {
    const existing = [appFile("observations.csv", "student")], backup = createWorkspaceBackup([appFile("observations.csv", "example")], "1.2.0");
    const merged = buildRestoreSet(existing, backup, policy);
    expect(existing[0].content).toBe("student");
    expect(merged.length).toBe(policy === "rename" ? 2 : 1);
    expect(merged.find(file => file.name === "observations.csv")?.content).toBe(policy === "overwrite" ? "example" : "student");
  });
});
