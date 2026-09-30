import type { Instruction } from "./opcode";

export type Loop = { breaks: number[]; continueTarget: number; cleanupDepth: number };
export const point = (token: { line: number; column: number }) => ({ line: token.line, column: token.column });

/** One instruction array per compilation; patch indices retain emission order. */
export function createEmission() {
  const instructions: Instruction[] = [];
  const emit = (instruction: Instruction) => (instructions.push(instruction), instructions.length - 1);
  const patch = (index: number, target: number) => { const instruction = instructions[index]; if ("target" in instruction) instruction.target = target; };
  return { instructions, emit, patch };
}
