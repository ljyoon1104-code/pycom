import { compile } from "../compiler/compiler";
import { CompilerError } from "../compiler/token";
import type { FromWorker, ToWorker } from "./protocol";
import { VM, type VMEvent } from "./vm";

let vm: VM | undefined;
let outputBuffer = "";
const post = (message: FromWorker): void => self.postMessage(message);
const flushOutput = () => { if (outputBuffer) { post({ type: "output", text: outputBuffer }); outputBuffer = ""; } };
self.onmessage = ({ data }: MessageEvent<ToWorker>) => {
  if (data.type === "stop") { vm?.stop(); vm = undefined; return; }
  if (data.type === "input") { vm?.resume(data.value); return; }
  try {
    const bytecode = compile(data.code);
    outputBuffer = ""; vm = new VM(bytecode, (event: VMEvent) => {
      if (event.type === "input") { flushOutput(); post({ type: "input-request", prompt: event.prompt }); }
      else if (event.type === "output") { outputBuffer += event.text; if (outputBuffer.length >= 4096) flushOutput(); }
      else if (event.type === "complete" || event.type === "stopped") { flushOutput(); post(event); vm = undefined; }
      else if (event.type === "error") { flushOutput(); post(event); }
      else post(event);
    }, new Map(data.files.map(file => [file.name, file.content])));
    vm.executeAsync();
  } catch (error) {
    if (error instanceof CompilerError) post({ type: "error", error: error.detail });
    else post({ type: "error", error: { line: 1, column: 1, category: "runtime", message: "실행을 준비할 수 없습니다." } });
  }
};
