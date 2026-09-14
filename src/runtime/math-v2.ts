import { CollectionError } from "./collections-v2";
import { float, isFloat, numeric, numberValue } from "./numbers-v2";
import type { ModuleValue, Value } from "./value";
export const MATH_FUNCTIONS = ["sqrt", "ceil", "floor", "trunc", "fabs", "factorial", "gcd", "pow", "sin", "cos", "tan", "radians", "degrees", "log", "log10", "exp", "isfinite", "isinf", "isnan"];
export function mathModule(): ModuleValue { return { kind: "module", name: "math", attributes: new Map<string, Value>([...[['pi', Math.PI], ['e', Math.E], ['tau', 2 * Math.PI], ['inf', Infinity], ['nan', NaN]].map(([key, value]) => [key as string, float(value as number)] as [string, Value]), ...MATH_FUNCTIONS.map(name => [name, { kind: "builtin", name: `math.${name}` }] as [string, Value])]) }; }
const invalid = (message: string, type: "ValueError" | "TypeError" = "ValueError"): never => { throw new CollectionError(type, message); };
export function mathBuiltin(name: string, args: Value[], keywords: Record<string, Value>): Value {
  const fn = name.slice(5); if (!MATH_FUNCTIONS.includes(fn)) return invalid("지원하지 않는 math 함수입니다.", "TypeError");
  const min = fn === "gcd" ? 0 : fn === "pow" ? 2 : 1, max = fn === "gcd" ? Infinity : fn === "pow" || fn === "log" ? 2 : 1;
  if (Object.keys(keywords).length || args.length < min || args.length > max) return invalid(`${name}() 인수 개수가 올바르지 않습니다.`, "TypeError");
  const values = args.map(value => numeric(value) ? numberValue(value) : invalid("숫자 인수가 필요합니다.", "TypeError")), x = values[0];
  if (fn === "factorial" || fn === "gcd") {
    if (args.some(value => isFloat(value)) || values.some(value => !Number.isSafeInteger(value))) return invalid("안전한 범위의 정수가 필요합니다.", "TypeError");
    if (fn === "gcd") { let result = 0n; for (const value of values) { let other = BigInt(Math.abs(value)); while (other) [result, other] = [other, result % other]; } return Number(result); }
    if (x < 0) return invalid("factorial()에는 0 이상의 정수가 필요합니다."); if (x > 18) return invalid("정확한 정수 범위를 위해 factorial()은 18까지 지원합니다."); let result = 1; for (let n = 2; n <= x; n++) result *= n; return result;
  }
  if (fn === "isfinite") return Number.isFinite(x); if (fn === "isinf") return x === Infinity || x === -Infinity; if (fn === "isnan") return Number.isNaN(x);
  if (fn === "ceil" || fn === "floor" || fn === "trunc") { if (!Number.isFinite(x)) return invalid("무한대 또는 NaN을 정수로 바꿀 수 없습니다."); return fn === "ceil" ? Math.ceil(x) : fn === "floor" ? Math.floor(x) : Math.trunc(x); }
  if ((fn === "sqrt" && x < 0) || ((fn === "log" || fn === "log10") && x <= 0) || (["sin", "cos", "tan"].includes(fn) && !Number.isFinite(x) && !Number.isNaN(x))) return invalid("이 값은 함수의 계산 범위를 벗어났습니다.");
  if (fn === "log" && values.length === 2 && (values[1] <= 0 || values[1] === 1)) return invalid("로그의 밑은 양수이며 1이 아니어야 합니다.");
  if (fn === "pow" && ((x < 0 && !Number.isInteger(values[1])) || (x === 0 && values[1] < 0))) return invalid("이 거듭제곱은 계산할 수 없습니다.");
  const result = fn === "sqrt" ? Math.sqrt(x) : fn === "fabs" ? Math.abs(x) : fn === "pow" ? Math.pow(x, values[1]) : fn === "sin" ? Math.sin(x) : fn === "cos" ? Math.cos(x) : fn === "tan" ? Math.tan(x) : fn === "radians" ? x * Math.PI / 180 : fn === "degrees" ? x * 180 / Math.PI : fn === "log" ? Math.log(x) / (values.length === 2 ? Math.log(values[1]) : 1) : fn === "log10" ? Math.log10(x) : Math.exp(x);
  if (!Number.isFinite(result) && !Number.isNaN(result) && values.every(Number.isFinite)) return invalid("계산 결과가 실수 범위를 초과했습니다."); return float(result);
}
