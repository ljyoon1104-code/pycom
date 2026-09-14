import type { FromWorker, ToWorker } from "../runtime/protocol";
import type { LearningExample } from "./model";
import { appFile, validateFileSet } from "../files/storage";

export interface ExampleWorker {
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: ToWorker): void;
  terminate(): void;
}
/** Owns only an ephemeral Worker. There is deliberately no student FileStore dependency. */
export class ExampleRunner {
  private worker?: ExampleWorker;
  constructor(private readonly create: () => ExampleWorker, private readonly receive: (event: FromWorker) => void) {}
  start(example: LearningExample): void {
    this.dispose();
    const files = (example.dataFiles ?? []).map(file => appFile(file.name, file.content));
    validateFileSet(files);
    const worker = this.create(); this.worker = worker;
    worker.onmessage = ({ data }) => {
      if (this.worker !== worker || data.type === "file-change") return;
      if (["error", "complete", "stopped"].includes(data.type)) this.dispose();
      this.receive(data);
    };
    worker.onerror = () => {
      if (this.worker !== worker) return;
      this.dispose();
      this.receive({ type: "error", error: { line: 1, column: 1, category: "runtime", message: "예제를 실행할 수 없습니다. 다시 실행해 주세요." } });
    };
    worker.postMessage({ type: "run", code: example.code, files: files.map(({ name, content, encoding }) => ({ name, content, encoding })) });
  }
  input(value: string): void { this.worker?.postMessage({ type: "input", value }); }
  stop(): void { if (this.worker) { this.dispose(); this.receive({ type: "stopped" }); } }
  dispose(): void {
    if (this.worker) { this.worker.onmessage = null; this.worker.onerror = null; this.worker.terminate(); this.worker = undefined; }
  }
}
