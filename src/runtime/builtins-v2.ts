import { CollectionError } from "./collections-v2";
import type { Value } from "./value";
import { float, isFloat, numeric, numberValue } from "./numbers-v2";
export const SCALAR_BUILTINS = new Set(["abs", "round", "pow", "divmod", "chr", "ord", "bin", "oct", "hex"]);
const fail = (type: "TypeError" | "ValueError" | "ZeroDivisionError", message: string): never => { throw new CollectionError(type, message); };
const number = (value: Value): number => numeric(value) ? numberValue(value) : fail("TypeError", "숫자가 필요합니다.");
const integer = (value: Value): number => { const result = number(value); if (isFloat(value) || !Number.isSafeInteger(result)) return fail("TypeError", "안전한 범위의 정수가 필요합니다."); return result; };
const even = (value: number): number => { const lower = Math.floor(value), part = value - lower; return part < .5 ? lower : part > .5 ? lower + 1 : lower % 2 === 0 ? lower : lower + 1; };
function decimalRound(value: number, digits: number): number {
  const buffer = new ArrayBuffer(8), view = new DataView(buffer); view.setFloat64(0, Math.abs(value)); const bits = view.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n);
  let numerator = (bits & ((1n << 52n) - 1n)) + (exponent ? 1n << 52n : 0n), denominator = 1n;
  const shift = (exponent || 1) - 1023 - 52; if (shift >= 0) numerator <<= BigInt(shift); else denominator <<= BigInt(-shift);
  if (digits >= 0) numerator *= 10n ** BigInt(digits); else denominator *= 10n ** BigInt(-digits);
  let quotient = numerator / denominator; const remainder = numerator % denominator; if (remainder * 2n > denominator || (remainder * 2n === denominator && quotient % 2n !== 0n)) quotient++;
  const rounded = Number(`${quotient}e${-digits}`); return value < 0 || Object.is(value, -0) ? -rounded : rounded;
}
function scalarRaw(name: string, args: Value[], keywords: Record<string, Value>): Value {
  const allowed = name === "round" ? ["number", "ndigits"] : name === "pow" ? ["base", "exp", "mod"] : [];
  const values = [...args];
  for (const [key, value] of Object.entries(keywords)) { const index = allowed.indexOf(key); if (index < 0 || index < args.length) return fail("TypeError", "지원하지 않거나 중복된 키워드 인수입니다."); values[index] = value; }
  const min = name === "pow" || name === "divmod" ? 2 : 1, max = name === "pow" ? 3 : name === "round" || name === "divmod" ? 2 : 1;
  if (values.length < min || values.length > max || Array.from({ length: min }, (_, n) => values[n]).some(value => value === undefined)) return fail("TypeError", `${name}() 인수 개수가 올바르지 않습니다.`);
  if (name === "abs") return Math.abs(number(values[0]));
  if (name === "ord") { if (typeof values[0] !== "string" || [...values[0]].length !== 1) return fail("TypeError", "ord()에는 한 글자 문자열이 필요합니다."); return values[0].codePointAt(0)!; }
  if (name === "chr") { const value = integer(values[0]); if (value < 0 || value > 0x10ffff) return fail("ValueError", "Unicode 문자 범위를 벗어났습니다."); return String.fromCodePoint(value); }
  if (["bin", "oct", "hex"].includes(name)) { const value = integer(values[0]), radix = name === "bin" ? 2 : name === "oct" ? 8 : 16; return (value < 0 ? "-" : "") + (name === "bin" ? "0b" : name === "oct" ? "0o" : "0x") + Math.abs(value).toString(radix); }
  if (name === "round") { const value = number(values[0]), digits = values[1] === undefined || values[1] === null ? undefined : integer(values[1]); if (!Number.isFinite(value)) { if (digits !== undefined) return value; return fail("ValueError", "무한대 또는 NaN을 정수로 반올림할 수 없습니다."); } if (digits === undefined) return even(value); if (digits > 323) return value; if (digits < -308) return value < 0 ? -0 : 0; return decimalRound(value, digits); }
  if (name === "divmod") { const a = number(values[0]), b = number(values[1]); if (b === 0) return fail("ZeroDivisionError", "0으로 나눌 수 없습니다."); const quotient = Math.floor(a / b); return { kind: "tuple", items: [quotient, a - quotient * b] }; }
  if (name === "pow") {
    if (values[2] !== undefined && values[2] !== null) {
      const a = BigInt(integer(values[0])), b = BigInt(integer(values[1])), mod = BigInt(integer(values[2])); if (!mod) return fail("ValueError", "pow()의 나머지 기준은 0이 될 수 없습니다.");
      const magnitude = mod < 0n ? -mod : mod; let base = ((a % magnitude) + magnitude) % magnitude, exponent = b;
      if (exponent < 0n) { let oldR = base, r = magnitude, oldS = 1n, s = 0n; while (r) { const q = oldR / r; [oldR, r] = [r, oldR - q * r]; [oldS, s] = [s, oldS - q * s]; } if (oldR !== 1n) return fail("ValueError", "이 값에는 모듈러 역수가 없습니다."); base = ((oldS % magnitude) + magnitude) % magnitude; exponent = -exponent; }
      let result = 1n % magnitude; while (exponent > 0n) { if (exponent & 1n) result = result * base % magnitude; base = base * base % magnitude; exponent >>= 1n; } return Number(mod < 0n && result ? result - magnitude : result);
    }
    const a = number(values[0]), b = number(values[1]); if (a === 0 && b < 0) return fail("ZeroDivisionError", "0의 음수 거듭제곱은 계산할 수 없습니다."); if (a < 0 && !Number.isInteger(b)) return fail("ValueError", "복소수 결과는 지원하지 않습니다."); return a ** b;
  }
  return fail("TypeError", "지원하지 않는 내장 함수입니다.");
}
export function scalarBuiltin(name: string, args: Value[], keywords: Record<string, Value>): Value {
  const result = scalarRaw(name, args, keywords), first = args[0] ?? keywords.number ?? keywords.base, second = args[1] ?? keywords.ndigits ?? keywords.exp;
  const asFloat = name === "round" ? isFloat(first) && second !== undefined && second !== null : name === "abs" ? isFloat(first) : name === "pow" ? isFloat(first) || isFloat(second) || (typeof second === "number" && second < 0 && args[2] === undefined && keywords.mod === undefined) : name === "divmod" ? args.some(isFloat) : false;
  if (asFloat && typeof result === "number") return float(result);
  if (asFloat && typeof result === "object" && result?.kind === "tuple") return { kind: "tuple", items: result.items.map(value => typeof value === "number" ? float(value) : value) };
  return result;
}
