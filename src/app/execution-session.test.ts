import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionSession, type ExecutionWorker } from "./execution-session";
import type { FromWorker, ToWorker } from "../runtime/protocol";

class FakeWorker implements ExecutionWorker {
  onmessage: ExecutionWorker["onmessage"] = null;
  onerror: ExecutionWorker["onerror"] = null;
  messages: ToWorker[] = [];
  terminated = false;
  postMessage(message: ToWorker) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  emit(message: FromWorker) { this.onmessage?.({ data: message } as MessageEvent<FromWorker>); }
}
afterEach(() => vi.unstubAllGlobals());
describe("shared execution lifetime", () => {
  it("also creates distinct run IDs on classroom HTTP without randomUUID", () => { vi.stubGlobal('crypto', {}); const a = new ExecutionSession(() => new FakeWorker()), b = new ExecutionSession(() => new FakeWorker()); expect(a.runId).toMatch(/^run-/); expect(a.runId).not.toBe(b.runId); });
  it("allocates a unique identifier per run", () => { const a = new ExecutionSession(() => new FakeWorker()), b = new ExecutionSession(() => new FakeWorker()); expect(a.runId).not.toBe(b.runId); });
  it("tags every outgoing command", () => { const worker = new FakeWorker(), session = new ExecutionSession(() => worker); session.postMessage({ type: "next", pauseId: 2 }); expect(worker.messages).toEqual([{ type: "next", pauseId: 2, runId: session.runId }]); });
  it("rejects late messages from a previous run", () => { const worker = new FakeWorker(), session = new ExecutionSession(() => worker); session.onmessage = vi.fn(); worker.emit({ type: "output", text: "old", runId: "previous" }); expect(session.onmessage).not.toHaveBeenCalled(); worker.emit({ type: "output", text: "current", runId: session.runId }); expect(session.onmessage).toHaveBeenCalledOnce(); });
  it("rejects queued events even when their old callback was captured", () => { const worker = new FakeWorker(), session = new ExecutionSession(() => worker), callback = worker.onmessage!; session.onmessage = vi.fn(); session.terminate(); callback({ data: { type: "complete", runId: session.runId } } as MessageEvent<FromWorker>); expect(session.onmessage).not.toHaveBeenCalled(); expect(worker.terminated).toBe(true); });
  it("detaches error handlers and prevents late input after stop", () => { const worker = new FakeWorker(), session = new ExecutionSession(() => worker), callback = worker.onerror!; session.onerror = vi.fn(); session.terminate(); session.postMessage({ type: "input", value: "late" }); callback({} as ErrorEvent); expect(worker.messages).toEqual([]); expect(session.onerror).not.toHaveBeenCalled(); expect(worker.onerror).toBeNull(); });
  it("forwards active Worker failures for UI recovery", () => { const worker = new FakeWorker(), session = new ExecutionSession(() => worker); session.onerror = vi.fn(); worker.onerror!({} as ErrorEvent); expect(session.onerror).toHaveBeenCalledOnce(); });
});
