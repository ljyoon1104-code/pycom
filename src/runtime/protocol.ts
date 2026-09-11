import type { StudentError } from "../compiler/token";
import type { TurtleGraphicsCommand } from "./turtle";
export type ToWorker = { type: "run"; code: string; files: { name: string; content: string; encoding?: "utf-8" | "euc-kr" }[] } | { type: "input"; value: string } | { type: "stop" };
export type FromWorker = { type: "output"; text: string } | { type: "input-request"; prompt: string } | { type: "file-change"; name: string; content: string } | { type: "graphics"; commands: TurtleGraphicsCommand[] } | { type: "error"; error: StudentError } | { type: "complete" } | { type: "stopped" };
