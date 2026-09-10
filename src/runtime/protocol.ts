import type { StudentError } from "../compiler/token";
export type ToWorker = { type: "run"; code: string; files: { name: string; content: string }[] } | { type: "input"; value: string } | { type: "stop" };
export type FromWorker = { type: "output"; text: string } | { type: "input-request"; prompt: string } | { type: "file-change"; name: string; content: string } | { type: "error"; error: StudentError } | { type: "complete" } | { type: "stopped" };
