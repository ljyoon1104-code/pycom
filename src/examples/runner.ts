import type { WorkerEvent, WorkerRequest } from "../runtime/protocol";
import { ExecutionSession, type ExecutionWorker } from "../app/execution-session";
import type { ExecutionMode, ExecutionSpeed } from "../runtime/execution-control";
import type { LearningExample } from "./model";
import { appFile, validateFileSet } from "../files/storage";

export type ExampleWorker = ExecutionWorker;
/** Owns only an ephemeral Worker. There is deliberately no student FileStore dependency. */
export class ExampleRunner {
  private worker?: ExecutionSession;
  get runId(): string | undefined { return this.worker?.runId; }
  constructor(private readonly create: () => ExampleWorker, private readonly receive: (event: WorkerEvent) => void) {}
  start(example: LearningExample, mode: ExecutionMode = "normal", speed: ExecutionSpeed = 500): void {
    this.dispose();
    const files = (example.dataFiles ?? []).map(file => appFile(file.name, file.content));
    validateFileSet(files);
    const worker = new ExecutionSession(this.create); this.worker = worker;
    worker.onmessage = ({ data }) => {
      if (this.worker !== worker) return;
      if (data.type === "file-change") { if (data.writeId !== undefined) worker.postMessage({ type: "file-ack", writeId: data.writeId, ok: true }); return; }
      if (["error", "complete", "stopped"].includes(data.type)) this.dispose();
      const { runId: _runId, ...event } = data; this.receive(event);
    };
    worker.onerror = () => {
      if (this.worker !== worker) return;
      this.dispose();
      this.receive({ type: "error", error: { line: 1, column: 1, category: "runtime", message: "예제를 실행할 수 없습니다. 다시 실행해 주세요." } });
    };
    worker.postMessage({ type: "run", code: example.code, fileName: example.suggestedFileName, mode, speed, files: files.map(({ name, content, encoding }) => ({ name, content, encoding })) });
  }
  control(message: WorkerRequest): void { this.worker?.postMessage(message); }
  input(value: string): void { this.worker?.postMessage({ type: "input", value }); }
  stop(): void { this.worker?.stop(); }
  dispose(): void {
    if (this.worker) { this.worker.onmessage = null; this.worker.onerror = null; this.worker.terminate(); this.worker = undefined; }
  }
}
