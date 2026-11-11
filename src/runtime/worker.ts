import { compile } from "../compiler/compiler";
import { CompilerError } from "../compiler/token";
import { MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES } from "../files/storage";
import { fileNameLabel } from "../files/file-name";
import type { FromWorker, ToWorker, WorkerEvent } from "./protocol";
import { VMFailure } from "./signals";
import { VM, type VMEvent } from "./vm";
import type { TurtleGraphicsCommand } from "./turtle";

/** At most one acknowledged payload in flight, using the existing VFS budget. */
export const FILE_FLOW_LIMITS = { bytes: MAX_TOTAL_BYTES, events: MAX_FILES, contentBytes: MAX_FILE_BYTES, payloadBytes: MAX_TOTAL_BYTES } as const;
export function createWorkerRuntime(post: (message: FromWorker) => void) {
  let vm: VM | undefined, runId: string | undefined;
  let acknowledge: ((id: number, ok: boolean) => void) | undefined;
  let requestStop: (() => void) | undefined, abandon: (() => void) | undefined;
  return (data: ToWorker): void => {
    if (data.type !== "run") {
      if (!runId || data.runId !== runId) return;
      if (data.type === "stop") requestStop?.();
      else if (data.type === "file-ack") acknowledge?.(data.writeId, data.ok);
      else if (data.type === "input") vm?.resume(data.value);
      else if (data.type === "pause") vm?.pause();
      else if (data.type === "next") vm?.advance(data.pauseId);
      else if (data.type === "follow") vm?.follow(data.pauseId);
      else if (data.type === "speed" && [100, 500, 1000].includes(data.speed)) vm?.setSpeed(data.speed);
      return;
    }
    abandon?.(); vm?.stop(); vm = undefined; runId = data.runId;
    const id = data.runId;
    let output = "", graphics: TurtleGraphicsCommand[] = [];
    let ended = false, stopping = false, sequence = 0, pendingBytes = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: { writeId: number; name: string; bytes: number } | undefined;
    const pending = new Map<string, { content: string; bytes: number }>();
    const observed = new Map(data.files.map(file => [file.name, file.content]));
    let checkpointFailed = false;
    let deferred: WorkerEvent[] = [], storageError: Extract<WorkerEvent, { type: "error" }> | undefined;
    const terminal = (event: WorkerEvent) => ["complete", "error", "stopped"].includes(event.type);
    const send = (event: WorkerEvent) => { if (id === runId && !ended) { if (terminal(event) && storageError) event = storageError; post({ ...event, runId: id }); if (terminal(event)) ended = true; } };
    const cancelTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
    const flush = () => {
      if (output) { send({ type: "output", text: output }); output = ""; }
      if (graphics.length) { send({ type: "graphics", commands: graphics }); graphics = []; }
    };
    const flushFiles = () => {
      cancelTimer();
      if (ended || id !== runId) return;
      checkpoint();
      if (ended) return;
      if (inFlight || pending.size) {
        vm?.holdTransport();
        if (inFlight) return;
        const [name, change] = pending.entries().next().value!;
        pending.delete(name); pendingBytes -= change.bytes;
        inFlight = { name, bytes: change.bytes, writeId: ++sequence };
        send({ type: "file-change", name, content: change.content, writeId: sequence });
        return;
      }
      const events = deferred; deferred = [];
      for (let event of events) {
        if (terminal(event) && storageError) event = storageError;
        else if (terminal(event) && stopping && event.type !== "error") event = { type: "stopped" };
        if (!stopping || terminal(event)) send(event);
      }
      vm?.releaseTransport();
    };
    const barrier = (event: WorkerEvent) => {
      checkpoint();
      flush();
      if (pending.size || inFlight) { vm?.holdTransport(); deferred.push(event); flushFiles(); }
      else send(event);
    };
    const addFile = (name: string, content: string) => {
      const fail = () => { checkpointFailed = true; throw new VMFailure({ line: 1, column: 1, category: "runtime", message: "실행을 중지했습니다. 저장 대기 중인 파일 변경이 너무 많습니다." }, "RuntimeError", false); };
      if (content.length > FILE_FLOW_LIMITS.contentBytes || name.length > FILE_FLOW_LIMITS.payloadBytes) fail();
      const encoder = new TextEncoder(), contentBytes = encoder.encode(content).length;
      const bytes = contentBytes + encoder.encode(name).length, prior = pending.get(name);
      const total = pendingBytes - (prior?.bytes ?? 0) + bytes + (inFlight?.bytes ?? 0);
      if (contentBytes > FILE_FLOW_LIMITS.contentBytes || bytes > FILE_FLOW_LIMITS.payloadBytes || total > FILE_FLOW_LIMITS.bytes || pending.size + (prior ? 0 : 1) + (inFlight ? 1 : 0) > FILE_FLOW_LIMITS.events) fail();
      // A replacement keeps the order of the latest write across different files.
      if (prior) pending.delete(name);
      pending.set(name, { content, bytes }); pendingBytes += bytes - (prior?.bytes ?? 0);
      if (timer === undefined && !inFlight) timer = setTimeout(flushFiles, 0);
    };
    const observeChange = (name: string, content: string, explicit = false) => {
      // Cleanup after a rejected persistence request must not silently retry that
      // same version and then report failure after a later retry has succeeded.
      const same = observed.has(name) && observed.get(name) === content;
      if (checkpointFailed || same && (!explicit || storageError !== undefined)) return;
      addFile(name, content); observed.set(name, content);
    };
    const checkpoint = () => {
      if (!vm || checkpointFailed || ended) return;
      try { for (const [name, content] of vm.fileSnapshot()) observeChange(name, content); }
      catch (reason) {
        // A failure while reporting another error must not recursively retry this snapshot.
        checkpointFailed = true;
        storageError ??= { type: "error", error: reason instanceof VMFailure ? reason.error : { line: 1, column: 1, category: "runtime", message: "파일 변경을 전달하지 못해 실행을 중지했습니다." } };
        stopping = true; deferred = deferred.filter(terminal); vm.stop();
      }
    };
    abandon = () => { ended = true; cancelTimer(); pending.clear(); deferred = []; };
    requestStop = () => {
      if (ended || stopping) return;
      stopping = true; deferred = deferred.filter(terminal);
      vm?.stop();
      if (!deferred.some(terminal) && !ended) deferred.push({ type: "stopped" });
      flush(); flushFiles();
    };
    acknowledge = (writeId, ok) => {
      if (ended || !inFlight || writeId !== inFlight.writeId) return;
      const fileName = inFlight.name; inFlight = undefined;
      if (!ok) {
        storageError ??= { type: "error", error: { line: 1, column: 1, category: "runtime", message: fileNameLabel(fileName) + " 파일을 저장하지 못해 실행을 중지했습니다. 파일 저장 안내를 확인해 주세요." } };
        stopping = true; deferred = deferred.filter(terminal);
        vm?.stop();
        if (!deferred.some(terminal) && !ended) deferred.push(storageError);
      }
      flushFiles();
    };
    try {
      const fileName = data.fileName ?? "main.py";
      const bytecode = compile(data.code, { sourceId: "entry", fileName, code: data.code });
      vm = new VM(bytecode, (event: VMEvent) => {
        if (id !== runId || ended) return;
        if (event.type === "file-change") observeChange(event.name, event.content, true);
        else if (event.type === "output") { output += event.text; if (output.length >= 4096) { send({ type: "output", text: output }); output = ""; } }
        else if (event.type === "graphics") { graphics.push(...event.commands); if (graphics.length >= 96 || event.commands.some(command => command.type === "finish")) flush(); }
        else barrier(event.type === "input" ? { type: "input-request", prompt: event.prompt } : event);
      }, new Map(data.files.map(file => [file.name, file.content])), { fileName, fileEncodings: new Map(data.files.map(file => [file.name, file.encoding ?? "utf-8"])), executionMode: data.mode ?? "normal", executionSpeed: data.speed ?? 500, inputLocation: true });
      vm.executeAsync();
    } catch (error) {
      flush();
      barrier({ type: "error", error: error instanceof CompilerError ? error.detail : { line: 1, column: 1, category: "runtime", message: "실행을 준비할 수 없습니다." } });
    }
  };
}
if (typeof self !== "undefined") {
  const receive = createWorkerRuntime(message => self.postMessage(message));
  self.onmessage = ({ data }: MessageEvent<ToWorker>) => receive(data);
}
