import type { ExecutionSource, ExecutionPoint } from "../compiler/opcode";

export type ExecutionMode = "normal" | "follow" | "step";
export type ExecutionSpeed = 100 | 500 | 1000;
export type ExecutionLocation = ExecutionPoint & { sourceId: string; fileName: string };
export type ExecutionState = "running" | "following" | "paused" | "input";
export type ExecutionUpdate = { state: ExecutionState; location?: ExecutionLocation; pauseId?: number };

/** A one-use ticket identifies a stop, not a line (loops revisit the same line). */
export class ExecutionControl {
  private timer?: ReturnType<typeof setTimeout>;
  private ticket = 0;
  private permit = false;
  private stopped = false;
  private suspended = false;
  private inputWaiting = false;
  private transportHeld = false;
  private location?: ExecutionLocation;
  constructor(private mode: Exclude<ExecutionMode, "normal">, private speed: ExecutionSpeed, private readonly notify: (update: ExecutionUpdate) => void, private readonly resume: () => void) {}
  before(source: ExecutionSource, point: ExecutionPoint): boolean {
    if (this.permit) { this.permit = false; return false; }
    this.location = { ...point, sourceId: source.sourceId, fileName: source.fileName };
    this.suspended = true; this.ticket++;
    this.publish(); if (this.mode === "follow") this.schedule();
    return true;
  }
  private publish(): void { this.notify({ state: this.inputWaiting ? "input" : this.mode === "step" ? "paused" : "following", location: this.location, pauseId: this.suspended && !this.inputWaiting ? this.ticket : undefined }); }
  private cancelTimer(): void { if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined; }
  private schedule(): void { this.cancelTimer(); if (this.transportHeld) return; const ticket = this.ticket; this.timer = setTimeout(() => this.release(ticket), this.speed); }
  private release(ticket: number): void {
    if (this.stopped || this.transportHeld || this.inputWaiting || !this.suspended || ticket !== this.ticket) return;
    this.cancelTimer(); this.suspended = false; this.permit = true;
    this.notify({ state: "running", location: this.location }); this.resume();
  }
  next(ticket: number): void { if (!this.suspended || ticket !== this.ticket || this.inputWaiting) return; this.mode = "step"; this.release(ticket); }
  follow(ticket: number): void { if (!this.suspended || ticket !== this.ticket || this.inputWaiting) return; this.mode = "follow"; this.publish(); this.schedule(); }
  pause(): void { if (this.stopped || this.inputWaiting) return; this.mode = "step"; this.cancelTimer(); if (this.suspended) this.publish(); }
  setSpeed(speed: ExecutionSpeed): void { this.speed = speed; if (this.suspended && this.mode === "follow" && !this.inputWaiting) this.schedule(); }
  input(location: ExecutionLocation): void { this.cancelTimer(); this.location = location; this.inputWaiting = true; this.notify({ state: "input", location }); }
  answered(): void { this.inputWaiting = false; this.notify({ state: "running", location: this.location }); }
  holdTransport(): void { this.transportHeld = true; this.cancelTimer(); }
  releaseTransport(): void { this.transportHeld = false; if (!this.stopped && this.suspended && this.mode === "follow" && !this.inputWaiting) this.schedule(); }
  stop(): void { this.stopped = true; this.suspended = false; this.permit = false; this.cancelTimer(); }
  get waiting(): boolean { return this.suspended; }
}
