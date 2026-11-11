import type { StudentError } from "../compiler/token";
import type { TurtleGraphicsCommand } from "./turtle";
import type { ExecutionMode, ExecutionSpeed, ExecutionUpdate } from "./execution-control";
import type { ExecutionSource } from "../compiler/opcode";
export type WorkerRequest = { type: "run"; code: string; fileName?: string; mode?: ExecutionMode; speed?: ExecutionSpeed; files: { name: string; content: string; encoding?: "utf-8" | "euc-kr" }[] } | { type: "input"; value: string } | { type: "stop" | "pause" } | { type: "next" | "follow"; pauseId: number } | { type: "speed"; speed: ExecutionSpeed } | { type: "file-ack"; writeId: number; ok: boolean; message?: string };
export type WorkerEvent = { type: "source"; source: ExecutionSource } | ({ type: "execution" } & ExecutionUpdate) | { type: "output"; text: string } | { type: "input-request"; prompt: string } | { type: "file-change"; name: string; content: string; writeId?: number } | { type: "graphics"; commands: TurtleGraphicsCommand[] } | { type: "error"; error: StudentError } | { type: "complete" } | { type: "stopped"; forced?: boolean };
export type ToWorker = WorkerRequest & { runId: string };
export type FromWorker = WorkerEvent & { runId: string };
