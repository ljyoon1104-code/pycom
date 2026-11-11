import type { FromWorker, ToWorker, WorkerRequest } from "../runtime/protocol";

export interface ExecutionWorker {
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: ToWorker): void;
  terminate(): void;
}
let runSequence = 0;
export const STOP_GRACE_MS = 500;
// Classroom LAN HTTP is not a secure context, so randomUUID may be unavailable.
const createRunId = (): string => globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}-${++runSequence}`;

/** Shared by the editor and the isolated example runner. No persistence dependencies. */
export class ExecutionSession {
  private worker?: ExecutionWorker;
  private stopTimer?: ReturnType<typeof setTimeout>;
  private stopping = false;
  private finished = false;
  private settle!: () => void;
  readonly settled = new Promise<void>(resolve => { this.settle = resolve; });
  readonly runId = createRunId();
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  constructor(create: () => ExecutionWorker) {
    const worker = create(); this.worker = worker;
    worker.onmessage = event => {
      if (this.worker !== worker || this.finished || event.data.runId !== this.runId) return;
      const terminal = ["complete", "error", "stopped"].includes(event.data.type);
      if (terminal) { this.clearStopTimer(); this.finished = true; this.settle(); }
      if (this.stopping && (event.data.type === "input-request" || event.data.type === "execution" || event.data.type === "source")) return;
      this.onmessage?.(event);
    };
    worker.onerror = event => { if (this.worker === worker) { this.clearStopTimer(); this.settle(); this.onerror?.(event); } };
  }
  postMessage(message: WorkerRequest): void {
    if (message.type === "stop") { this.stop(); return; }
    if (this.finished || this.stopping && message.type !== "file-ack") return;
    this.worker?.postMessage({ ...message, runId: this.runId });
  }
  stop(): void {
    const worker = this.worker;
    if (!worker || this.stopping || this.finished) return;
    this.stopping = true;
    this.stopTimer = setTimeout(() => {
      if (this.worker !== worker || this.finished) return;
      this.terminate(); this.finished = true;
      this.onmessage?.({ data: { type: "stopped", runId: this.runId, forced: true } } as MessageEvent<FromWorker>);
    }, STOP_GRACE_MS);
    worker.postMessage({ type: "stop", runId: this.runId });
  }
  private clearStopTimer(): void { if (this.stopTimer !== undefined) clearTimeout(this.stopTimer); this.stopTimer = undefined; }
  terminate(): void { this.clearStopTimer(); this.settle(); if (this.worker) { this.worker.onmessage = null; this.worker.onerror = null; this.worker.terminate(); this.worker = undefined; } }
}
