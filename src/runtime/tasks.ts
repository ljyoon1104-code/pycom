import type { RuntimeTask } from "./value";

/** Keeps partially built results on a generator stack, never re-evaluating user calls. */
export function* mapTasks<T, R>(values: readonly T[], action: (value: T, index: number) => RuntimeTask<R>): RuntimeTask<R[]> {
  const result: R[] = [];
  for (let index = 0; index < values.length; index++) result.push(yield* action(values[index], index));
  return result;
}
