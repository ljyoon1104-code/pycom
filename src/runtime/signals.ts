import type { StudentError } from "../compiler/token";

export class ResumeExecution {}
export class VMFailure { constructor(readonly error: StudentError, readonly type: string, readonly catchable = true) { error.pythonType = type; } }
