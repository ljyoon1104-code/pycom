import { compile } from "../compiler/compiler";
import { CompilerError } from "../compiler/token";
import type { FromWorker, ToWorker } from "./protocol";
import { VM, type VMEvent } from "./vm";
import type { TurtleGraphicsCommand } from "./turtle";

let vm: VM | undefined;
let outputBuffer = "";
let graphicsBuffer: TurtleGraphicsCommand[] = [];
const post = (message: FromWorker): void => self.postMessage(message);
const flushOutput = () => { if (outputBuffer) { post({ type: "output", text: outputBuffer }); outputBuffer = ""; } };
const flushGraphics = () => { if (graphicsBuffer.length) { post({ type: "graphics", commands: graphicsBuffer }); graphicsBuffer = []; } };
self.onmessage = ({ data }: MessageEvent<ToWorker>) => {
  if (data.type === "stop") { vm?.stop(); vm = undefined; return; }
  if (data.type === "input") { vm?.resume(data.value); return; }
  try {
    const bytecode = compile(data.code);
    outputBuffer = ""; graphicsBuffer = []; vm = new VM(bytecode, (event: VMEvent) => {
      if (event.type === "input") { flushOutput(); flushGraphics(); post({ type: "input-request", prompt: event.prompt }); }
      else if (event.type === "output") { outputBuffer += event.text; if (outputBuffer.length >= 4096) flushOutput(); }
      else if (event.type === "graphics") { graphicsBuffer.push(...event.commands); if (graphicsBuffer.length >= 96 || event.commands.some(command => command.type === "finish")) flushGraphics(); }
      else if (event.type === "complete" || event.type === "stopped") { flushOutput(); flushGraphics(); post(event); vm = undefined; }
      else if (event.type === "error") { flushOutput(); flushGraphics(); post(event); }
      else post(event);
    }, new Map(data.files.map(file => [file.name, file.content])), { fileEncodings: new Map(data.files.map(file => [file.name, file.encoding ?? "utf-8"])) });
    vm.executeAsync();
  } catch (error) {
    if (error instanceof CompilerError) post({ type: "error", error: error.detail });
    else post({ type: "error", error: { line: 1, column: 1, category: "runtime", message: "실행을 준비할 수 없습니다." } });
  }
};
