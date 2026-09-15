import { elementEqual as equal, keyOK, type SetValue, type SliceValue, type Value } from "./value";
export class CollectionError extends Error {
  constructor(readonly pythonType: "TypeError" | "ValueError" | "KeyError" | "IndexError" | "ZeroDivisionError" | "OverflowError", message: string) { super(message); }
}
export class CollectionLimitError extends Error {}
export const MAX_COLLECTION_SIZE = 10_000;
export function hashable(value: Value): void { if (!keyOK(value)) throw new CollectionError("TypeError", "변경 가능한 값은 집합 원소나 딕셔너리 키가 될 수 없습니다."); }
export function addSet(set: SetValue, value: Value): void {
  hashable(value);
  if (set.items.some(item => equal(item, value))) return;
  if (set.items.length >= MAX_COLLECTION_SIZE) throw new CollectionLimitError("컬렉션 크기 제한을 초과했습니다.");
  set.items.push(value);
}
export function makeSet(values: Value[]): SetValue { const result: SetValue = { kind: "set", items: [] }; values.forEach(value => addSet(result, value)); return result; }
export function setMethod(set: SetValue, name: string, args: Value[], items: (value: Value) => Value[]): Value {
  const count = (min: number, max = min) => { if (args.length < min || args.length > max) throw new CollectionError("TypeError", `${name}() 인수 개수가 올바르지 않습니다.`); };
  if (name === "add") { count(1); addSet(set, args[0]); return null; }
  if (name === "remove" || name === "discard") { count(1); hashable(args[0]); const index = set.items.findIndex(value => equal(value, args[0])); if (index >= 0) set.items.splice(index, 1); else if (name === "remove") throw new CollectionError("KeyError", "집합에 해당 값이 없습니다."); return null; }
  if (name === "pop") { count(0); if (!set.items.length) throw new CollectionError("KeyError", "빈 집합에서 값을 꺼낼 수 없습니다."); return set.items.pop()!; }
  if (name === "clear") { count(0); set.items.length = 0; return null; }
  if (name === "update" || name === "union") { const result = name === "update" ? set : makeSet(set.items); for (const arg of args) items(arg).forEach(value => addSet(result, value)); return name === "update" ? null : result; }
  if (name === "intersection" || name === "difference") {
    let result = [...set.items];
    for (const arg of args) { const other = makeSet(items(arg)); result = result.filter(value => other.items.some(item => equal(item, value)) === (name === "intersection")); }
    return makeSet(result);
  }
  if (name === "issubset" || name === "issuperset") { count(1); const other = makeSet(items(args[0])); const [left, right] = name === "issubset" ? [set, other] : [other, set]; return left.items.every(value => right.items.some(item => equal(item, value))); }
  throw new CollectionError("TypeError", `'${name}' 집합 메서드는 지원하지 않습니다.`);
}
export function setBinary(left: SetValue, right: SetValue, operator: string): SetValue {
  const contains = (set: SetValue, value: Value) => set.items.some(item => equal(item, value));
  if (operator === "|") return makeSet([...left.items, ...right.items]);
  if (operator === "&") return makeSet(left.items.filter(value => contains(right, value)));
  if (operator === "-") return makeSet(left.items.filter(value => !contains(right, value)));
  if (operator === "^") return makeSet([...left.items.filter(value => !contains(right, value)), ...right.items.filter(value => !contains(left, value))]);
  throw new CollectionError("TypeError", "집합에 사용할 수 없는 연산입니다.");
}
export function sliceIndices(length: number, slice: SliceValue): number[] {
  const step = slice.step ?? 1;
  if (step === 0) throw new CollectionError("ValueError", "슬라이스 간격은 0이 될 수 없습니다.");
  const low = step > 0 ? 0 : -1, high = step > 0 ? length : length - 1;
  const bound = (value: number) => Math.max(low, Math.min(high, value < 0 ? value + length : value));
  const start = slice.start === undefined ? (step > 0 ? 0 : length - 1) : bound(slice.start);
  const stop = slice.stop === undefined ? (step > 0 ? length : -1) : bound(slice.stop);
  const result: number[] = [];
  for (let index = start; step > 0 ? index < stop : index > stop; index += step) result.push(index);
  return result;
}
