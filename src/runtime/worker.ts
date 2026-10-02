import { compile } from "../compiler/compiler";
import { CompilerError } from "../compiler/token";
import type { FromWorker, ToWorker, WorkerEvent } from "./protocol";
import { VM, type VMEvent } from "./vm";
import type { TurtleGraphicsCommand } from "./turtle";

/** One lifetime per run; all buffers and callbacks are tagged, including late failures. */
export function createWorkerRuntime(post: (message: FromWorker) => void) {
  let vm: VM | undefined, runId: string | undefined;
  return (data: ToWorker): void => {
    if (data.type !== "run") {
      if (!runId || data.runId !== runId) return;
      if (data.type === "stop") { vm?.stop(); vm = undefined; }
      else if (data.type === "input") vm?.resume(data.value);
      else if (data.type === "pause") vm?.pause();
      else if (data.type === "next") vm?.advance(data.pauseId);
      else if (data.type === "follow") vm?.follow(data.pauseId);
      else if (data.type === "speed" && [100, 500, 1000].includes(data.speed)) vm?.setSpeed(data.speed);
      return;
    }
    vm?.stop(); vm = undefined; runId = data.runId;
    const id = data.runId;
    let output = "", graphics: TurtleGraphicsCommand[] = [];
    const send = (event: WorkerEvent) => { if (id === runId) post({ ...event, runId: id }); };
    const flush = () => {
      if (output) { send({ type: "output", text: output }); output = ""; }
      if (graphics.length) { send({ type: "graphics", commands: graphics }); graphics = []; }
    };
    try {
      const fileName = data.fileName ?? "main.py";
      const bytecode = compile(data.code, { sourceId: "entry", fileName, code: data.code });
      vm = new VM(bytecode, (event: VMEvent) => {
        if (id !== runId) return;
        if (event.type === "output") { output += event.text; if (output.length >= 4096) { send({ type: "output", text: output }); output = ""; } }
        else if (event.type === "graphics") { graphics.push(...event.commands); if (graphics.length >= 96 || event.commands.some(command => command.type === "finish")) flush(); }
        else { flush(); send(event.type === "input" ? { type: "input-request", prompt: event.prompt } : event); }
      }, new Map(data.files.map(file => [file.name, file.content])), { fileName, fileEncodings: new Map(data.files.map(file => [file.name, file.encoding ?? "utf-8"])), executionMode: data.mode ?? "normal", executionSpeed: data.speed ?? 500, inputLocation: true });
      vm.executeAsync();
    } catch (error) {
      flush();
      send({ type: "error", error: error instanceof CompilerError ? error.detail : { line: 1, column: 1, category: "runtime", message: "실행을 준비할 수 없습니다." } });
    }
  };
}
// Importable by runtime tests without introducing product-only test hooks.
if (typeof self !== "undefined") {
  const receive = createWorkerRuntime(message => self.postMessage(message));
  self.onmessage = ({ data }: MessageEvent<ToWorker>) => receive(data);
}
