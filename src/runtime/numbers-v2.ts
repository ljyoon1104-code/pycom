/** Python float provenance, without exposing a JavaScript object to student code. */
export interface FloatValue { kind: "float"; value: number; }
export const isFloat = (value: unknown): value is FloatValue => typeof value === "object" && value !== null && "kind" in value && value.kind === "float";
export const float = (value: number): FloatValue => ({ kind: "float", value });
export const numeric = (value: unknown): value is number | boolean | FloatValue => typeof value === "number" || typeof value === "boolean" || isFloat(value);
export const numberValue = (value: number | boolean | FloatValue): number => isFloat(value) ? value.value : Number(value);
/** Floor quotient is derived from the remainder, not rounded division.
 * Matches CPython 3.12 float divmod, including signed zero and NaN.
 */
export function floatDivmod(a: number, b: number): [number, number] {
  let remainder = a % b, quotient = (a - remainder) / b;
  if (remainder !== 0) {
    if ((b < 0) !== (remainder < 0)) { remainder += b; quotient -= 1; }
  } else remainder = b < 0 || Object.is(b, -0) ? -0 : 0;
  if (quotient !== 0) {
    const floor = Math.floor(quotient);
    quotient = floor + (quotient - floor > 0.5 ? 1 : 0);
  } else quotient = a / b < 0 || Object.is(a / b, -0) ? -0 : 0;
  return [quotient, remainder];
}
export function floatText(value: number): string {
  if (Number.isNaN(value)) return "nan"; if (!Number.isFinite(value)) return value < 0 ? "-inf" : "inf"; if (Object.is(value, -0)) return "-0.0";
  const absolute = Math.abs(value), exponential = absolute !== 0 && (absolute < 0.0001 || absolute >= 1e16);
  let text = exponential ? value.toExponential() : String(value);
  if (text.includes("e")) text = text.replace(/e([+-]?)(\d+)$/, (_, sign, digits) => `e${sign || "+"}${digits.padStart(2, "0")}`);
  else if (!text.includes(".")) text += ".0";
  return text;
}
