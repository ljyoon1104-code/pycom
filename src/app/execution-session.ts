import type { FromWorker, ToWorker, WorkerRequest } from "../runtime/protocol";

export interface ExecutionWorker {
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: ToWorker): void;
  terminate(): void;
}
let runSequence = 0;
// Classroom LAN HTTP is not a secure context, so randomUUID may be unavailable.
const createRunId = (): string => globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}-${++runSequence}`;

/** Shared by the editor and the isolated example runner. No persistence dependencies. */
export class ExecutionSession {
  private worker?: ExecutionWorker;
  readonly runId = createRunId();
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  constructor(create: () => ExecutionWorker) {
    const worker = create(); this.worker = worker;
    worker.onmessage = event => { if (this.worker === worker && event.data.runId === this.runId) this.onmessage?.(event); };
    worker.onerror = event => { if (this.worker === worker) this.onerror?.(event); };
  }
  postMessage(message: WorkerRequest): void { this.worker?.postMessage({ ...message, runId: this.runId }); }
  terminate(): void { if (this.worker) { this.worker.onmessage = null; this.worker.onerror = null; this.worker.terminate(); this.worker = undefined; } }
}
