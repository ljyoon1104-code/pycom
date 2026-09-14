import { CollectionError, CollectionLimitError, MAX_COLLECTION_SIZE, hashable } from "./collections-v2";
import { equal, isDict, isTuple, type DictValue, type ListValue, type Value } from "./value";
const error = (message: string, type: "TypeError" | "ValueError" | "KeyError" = "TypeError"): never => { throw new CollectionError(type, message); };
const count = (name: string, args: Value[], min: number, max = min) => { if (args.length < min || args.length > max) error(`${name}() 인수 개수가 올바르지 않습니다.`); };
const integer = (value: Value): number => typeof value === "boolean" ? Number(value) : typeof value === "number" && Number.isSafeInteger(value) ? value : error("정수가 필요합니다.");
const string = (value: Value): string => typeof value === "string" ? value : error("문자열이 필요합니다.");
const size = (length: number) => { if (length > MAX_COLLECTION_SIZE) throw new CollectionLimitError("컬렉션 크기 제한을 초과했습니다."); };
const textSize = (length: number) => { if (length > 100_000) throw new CollectionLimitError("문자열 크기 제한을 초과했습니다."); };
const bound = (value: Value | undefined, length: number, fallback: number): number => value === undefined ? fallback : Math.max(0, integer(value) < 0 ? length + integer(value) : integer(value));
const whitespace = (char: string) => /[\p{White_Space}\u001c-\u001f]/u.test(char);
export const STRING_METHODS = new Set(["join", "find", "rfind", "index", "count", "startswith", "endswith", "lower", "upper", "capitalize", "title", "isdigit", "isalpha", "isalnum", "isspace", "lstrip", "rstrip", "strip", "split", "rsplit", "replace", "center", "ljust", "rjust", "zfill"]);
export function stringMethod(text: string, name: string, args: Value[], items: (value: Value) => Value[]): Value {
  const chars = [...text];
  if (name === "join") { count(name, args, 1); const parts = items(args[0]).map(string); textSize(parts.reduce((n, part) => n + part.length, 0) + Math.max(0, parts.length - 1) * text.length); return parts.join(text); }
  if (["lower", "upper", "capitalize", "title", "isdigit", "isalpha", "isalnum", "isspace"].includes(name)) {
    count(name, args, 0);
    if (name === "lower") return text.toLowerCase(); if (name === "upper") return text.toUpperCase();
    if (name === "capitalize") return (chars[0]?.toUpperCase() ?? "") + chars.slice(1).join("").toLowerCase();
    if (name === "title") { let previous = false; return chars.map(char => { const cased = char.toLowerCase() !== char.toUpperCase(), result = previous ? char.toLowerCase() : char.toUpperCase(); previous = cased; return result; }).join(""); }
    if (name === "isspace") return chars.length > 0 && chars.every(whitespace);
    const pattern = name === "isalpha" ? /^\p{L}+$/u : name === "isalnum" ? /^[\p{L}\p{N}]+$/u : /^[\p{Nd}\u00b2\u00b3\u00b9\u2070\u2074-\u2079\u2080-\u2089]+$/u;
    return pattern.test(text);
  }
  if (["strip", "lstrip", "rstrip"].includes(name)) {
    count(name, args, 0, 1); const stripChars = args[0] === undefined || args[0] === null ? undefined : new Set([...string(args[0])]);
    const remove = (char: string) => stripChars ? stripChars.has(char) : whitespace(char);
    let start = 0, end = chars.length; if (name !== "rstrip") while (start < end && remove(chars[start])) start++; if (name !== "lstrip") while (end > start && remove(chars[end - 1])) end--;
    return chars.slice(start, end).join("");
  }
  if (["find", "rfind", "index", "count", "startswith", "endswith"].includes(name)) {
    count(name, args, 1, 3); const start = bound(args[1], chars.length, 0), end = Math.min(chars.length, bound(args[2], chars.length, chars.length));
    const candidates = (name === "startswith" || name === "endswith") && isTuple(args[0]) ? args[0].items : [args[0]];
    const matchAt = (position: number, needle: string[]) => position >= start && position + needle.length <= end && needle.every((char, index) => chars[position + index] === char);
    if (name === "startswith" || name === "endswith") { for (const candidate of candidates) { const needle = [...string(candidate)]; if (start <= chars.length && start <= end && matchAt(name === "startswith" ? start : end - needle.length, needle)) return true; } return false; }
    const needle = [...string(args[0])]; let found = -1, total = 0;
    for (let pos = start; pos <= end - needle.length; pos++) if (matchAt(pos, needle)) { if (found < 0 || name === "rfind") found = pos; total++; if (name === "find" || name === "index") break; if (name === "count") pos += Math.max(1, needle.length) - 1; }
    if (name === "index" && found < 0) error("문자열에서 해당 내용을 찾을 수 없습니다.", "ValueError"); return name === "count" ? total : found;
  }
  if (name === "split" || name === "rsplit") {
    count(name, args, 0, 2); const separator = args[0] === undefined || args[0] === null ? undefined : string(args[0]), limit = args[1] === undefined ? -1 : integer(args[1]);
    if (separator === "") error("빈 문자열을 구분자로 사용할 수 없습니다.", "ValueError");
    const reverse = name === "rsplit", result: string[] = []; let remaining = text, splits = 0;
    if (separator === undefined) {
      const data = reverse ? [...chars].reverse() : chars; let position = 0;
      while (position < data.length && whitespace(data[position])) position++;
      while (position < data.length) {
        const start = position;
        if (limit >= 0 && splits >= limit) position = data.length;
        else { while (position < data.length && !whitespace(data[position])) position++; }
        const part = data.slice(start, position); result.push((reverse ? part.reverse() : part).join("")); size(result.length); splits++;
        while (position < data.length && whitespace(data[position])) position++;
      }
    } else {
      while (limit < 0 || splits < limit) { const position = reverse ? remaining.lastIndexOf(separator) : remaining.indexOf(separator); if (position < 0) break; result.push(reverse ? remaining.slice(position + separator.length) : remaining.slice(0, position)); size(result.length); remaining = reverse ? remaining.slice(0, position) : remaining.slice(position + separator.length); splits++; }
      result.push(remaining); size(result.length);
    }
    return { kind: "list", items: reverse ? result.reverse() : result };
  }
  if (name === "replace") {
    count(name, args, 2, 3); const old = string(args[0]), replacement = string(args[1]), limit = args[2] === undefined ? -1 : integer(args[2]); let result = "", position = 0, replaced = 0;
    if (!old) { for (let n = 0; n <= chars.length; n++) { if (limit < 0 || replaced < limit) { result += replacement; replaced++; } result += chars[n] ?? ""; textSize(result.length); } return result; }
    while (limit < 0 || replaced < limit) { const next = text.indexOf(old, position); if (next < 0) break; textSize(result.length + next - position + replacement.length); result += text.slice(position, next) + replacement; position = next + old.length; replaced++; }
    textSize(result.length + text.length - position); return result + text.slice(position);
  }
  if (["center", "ljust", "rjust", "zfill"].includes(name)) {
    count(name, args, 1, name === "zfill" ? 1 : 2); const width = integer(args[0]), fill = args[1] === undefined ? " " : string(args[1]); if ([...fill].length !== 1) error("채움 문자는 한 글자여야 합니다.");
    const padding = Math.max(0, width - chars.length); textSize(text.length + padding * fill.length);
    if (name === "zfill") return /^[+-]/.test(text) ? text[0] + "0".repeat(padding) + text.slice(1) : "0".repeat(padding) + text;
    const left = name === "ljust" ? 0 : name === "rjust" ? padding : Math.floor(padding / 2) + (padding % 2 && width % 2 ? 1 : 0);
    return fill.repeat(left) + text + fill.repeat(padding - left);
  }
  return error(`'${name}' 문자열 메서드는 지원하지 않습니다.`);
}
export const LIST_METHODS = new Set(["append", "extend", "insert", "remove", "pop", "clear", "index", "count", "reverse", "copy"]);
export function listMethod(list: ListValue, name: string, args: Value[], items: (value: Value) => Value[]): Value {
  const values = list.items;
  if (name === "append" || name === "extend") { count(name, args, 1); const additions = name === "append" ? args : [...items(args[0])]; size(values.length + additions.length); values.push(...additions); return null; }
  if (name === "insert") { count(name, args, 2); size(values.length + 1); values.splice(Math.min(values.length, bound(args[0], values.length, 0)), 0, args[1]); return null; }
  if (name === "clear" || name === "reverse" || name === "copy") { count(name, args, 0); if (name === "copy") return { kind: "list", items: [...values] }; if (name === "clear") values.length = 0; else values.reverse(); return null; }
  if (name === "count") { count(name, args, 1); return values.filter(value => equal(value, args[0])).length; }
  if (name === "index" || name === "remove") { count(name, args, 1, name === "index" ? 3 : 1); const start = bound(args[1], values.length, 0), end = Math.min(values.length, bound(args[2], values.length, values.length)); let found = -1; for (let index = start; index < end; index++) if (equal(values[index], args[0])) { found = index; break; } if (found < 0) error("리스트에 해당 값이 없습니다.", "ValueError"); if (name === "index") return found; values.splice(found, 1); return null; }
  if (name === "pop") { count(name, args, 0, 1); const raw = args[0] === undefined ? -1 : integer(args[0]), index = raw < 0 ? values.length + raw : raw; if (index < 0 || index >= values.length) throw new CollectionError("IndexError", "리스트 인덱스 범위를 벗어났습니다."); return values.splice(index, 1)[0]; }
  return error(`'${name}' 리스트 메서드는 지원하지 않습니다.`);
}
export const DICT_METHODS = new Set(["keys", "values", "items", "get", "setdefault", "update", "pop", "popitem", "clear", "copy", "fromkeys"]);
export function dictMethod(dict: DictValue, name: string, args: Value[], keywords: Record<string, Value>, items: (value: Value) => Value[]): Value {
  if (name !== "update" && Object.keys(keywords).length) error("이 메서드는 키워드 인수를 지원하지 않습니다.");
  const put = (key: Value, value: Value) => { hashable(key); const entry = dict.entries.find(entry => equal(entry.key, key)); if (entry) entry.value = value; else { size(dict.entries.length + 1); dict.entries.push({ key, value }); } };
  if (["keys", "values", "items", "clear", "copy", "popitem"].includes(name)) {
    count(name, args, 0); if (name === "clear") { dict.entries.length = 0; return null; } if (name === "copy") return { kind: "dict", entries: dict.entries.map(entry => ({ ...entry })) };
    if (name === "popitem") { const entry = dict.entries.pop(); if (!entry) return error("빈 딕셔너리에서 항목을 꺼낼 수 없습니다.", "KeyError"); return { kind: "tuple", items: [entry.key, entry.value] }; }
    return { kind: "list", items: dict.entries.map(entry => name === "keys" ? entry.key : name === "values" ? entry.value : { kind: "tuple", items: [entry.key, entry.value] }) };
  }
  if (name === "get" || name === "setdefault" || name === "pop") {
    count(name, args, 1, 2); hashable(args[0]); const index = dict.entries.findIndex(entry => equal(entry.key, args[0]));
    if (index >= 0) { const value = dict.entries[index].value; if (name === "pop") dict.entries.splice(index, 1); return value; }
    if (name === "pop" && args.length < 2) error("딕셔너리에 해당 키가 없습니다.", "KeyError"); const value = args[1] ?? null; if (name === "setdefault") put(args[0], value); return value;
  }
  if (name === "update") {
    count(name, args, 0, 1);
    if (args.length) { if (isDict(args[0])) args[0].entries.forEach(entry => put(entry.key, entry.value)); else for (const pair of items(args[0])) { const parts = items(pair); if (parts.length !== 2) error("update() 항목은 키와 값 두 개여야 합니다.", "ValueError"); put(parts[0], parts[1]); } }
    Object.entries(keywords).forEach(([key, value]) => put(key, value)); return null;
  }
  if (name === "fromkeys") { count(name, args, 1, 2); const result: DictValue = { kind: "dict", entries: [] }; for (const key of items(args[0])) { hashable(key); if (!result.entries.some(entry => equal(entry.key, key))) { size(result.entries.length + 1); result.entries.push({ key, value: args[1] ?? null }); } } return result; }
  return error(`'${name}' 딕셔너리 메서드는 지원하지 않습니다.`);
}
