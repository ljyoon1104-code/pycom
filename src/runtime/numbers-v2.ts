/** Python float provenance, without exposing a JavaScript object to student code. */
export interface FloatValue { kind: "float"; value: number; }
export const isFloat = (value: unknown): value is FloatValue => typeof value === "object" && value !== null && "kind" in value && value.kind === "float";
export const float = (value: number): FloatValue => ({ kind: "float", value });
export const numeric = (value: unknown): value is number | boolean | FloatValue => typeof value === "number" || typeof value === "boolean" || isFloat(value);
export const numberValue = (value: number | boolean | FloatValue): number => isFloat(value) ? value.value : Number(value);
export function floatText(value: number): string {
  if (Number.isNaN(value)) return "nan"; if (!Number.isFinite(value)) return value < 0 ? "-inf" : "inf"; if (Object.is(value, -0)) return "-0.0";
  const absolute = Math.abs(value), exponential = absolute !== 0 && (absolute < 0.0001 || absolute >= 1e16);
  let text = exponential ? value.toExponential() : String(value);
  if (text.includes("e")) text = text.replace(/e([+-]?)(\d+)$/, (_, sign, digits) => `e${sign || "+"}${digits.padStart(2, "0")}`);
  else if (!text.includes(".")) text += ".0";
  return text;
}
