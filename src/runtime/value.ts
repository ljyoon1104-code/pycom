import { isFloat, floatText, numeric, numberValue, type FloatValue } from "./numbers-v2";
export interface RangeValue { kind: "range"; start: number; stop: number; step: number; }
export interface IteratorValue { kind: "iterator"; values: Value[]; index: number; pull?: () => Value | undefined; validate?: () => string | undefined; file?: FileValue; exhausted?: boolean; }
export interface BuiltinValue { kind: "builtin"; name: string; }
export interface ModuleValue { kind: "module"; name: string; attributes: ReadonlyMap<string, Value>; }
export interface DateValue { kind: "date"; readonly year: number; readonly month: number; readonly day: number; }
/** Mutable VM-only state. Canvas receives serialized snapshots, never this object. */
export interface TurtleValue { kind: "turtle"; id: number; x: number; y: number; heading: number; penDown: boolean; color: string; fillColor: string; width: number; visible: boolean; speed: number; }
export interface TurtleMethodValue { kind: "turtle-method"; turtle: TurtleValue; name: string; }
export interface LexicalScope { env: Map<string, Value>; names: ReadonlySet<string>; }
export interface FunctionValue { kind: "function"; name: string; params: { name: string; kind?: import("../compiler/ast").ParameterKind; hasDefault: boolean }[]; defaults: Value[]; localNames: string[]; globals: string[]; nonlocals?: string[]; closure?: LexicalScope[]; globalEnv?: Map<string, Value>; ownerClass?: ClassValue; fileName?: string; bytecode: import("../compiler/opcode").Bytecode; }
export interface ClassValue { kind: "class"; name: string; attributes: Map<string, Value>; parent?: ClassValue; }
export interface SuperValue { kind: "super"; parent?: ClassValue; instance: InstanceValue; }
export interface InstanceValue { kind: "instance"; classValue: ClassValue; attributes: Map<string, Value>; }
export interface BoundMethodValue { kind: "bound-method"; functionValue: FunctionValue; instance: InstanceValue; }
export interface FileValue { kind: "file"; name: string; mode: string; content: string; position: number; closed: boolean; dirty: boolean; }
export interface ErrorTypeValue { kind: "error-type"; name: string; }
export interface ExceptionValue { kind: "exception"; name: string; message: string; line: number; column: number; }
export interface MapValue { kind: "map"; fn: Value; sources: (IteratorValue | MapValue)[]; }
export interface ListValue { kind: "list"; items: Value[]; }
export interface SetValue { kind: "set"; items: Value[]; }
export interface TupleValue { kind: "tuple"; items: Value[]; }
export interface DictValue { kind: "dict"; entries: { key: Value; value: Value }[]; }
export interface SliceValue { kind: "slice"; start?: number; stop?: number; step?: number; }
export interface AttrValue { kind: "attr"; object: Value; name: string; }
export type Value = number | string | boolean | null | FloatValue | SuperValue | ModuleValue | DateValue | TurtleValue | TurtleMethodValue | RangeValue | IteratorValue | BuiltinValue | FunctionValue | ClassValue | InstanceValue | BoundMethodValue | FileValue | ErrorTypeValue | ExceptionValue | MapValue | ListValue | SetValue | TupleValue | DictValue | SliceValue | AttrValue;

export const object = (value: Value): value is Exclude<Value, number | string | boolean | null> => typeof value === "object" && value !== null;
export const isRange = (value: Value): value is RangeValue => object(value) && value.kind === "range";
export const isIterator = (value: Value): value is IteratorValue => object(value) && value.kind === "iterator";
export const isBuiltin = (value: Value): value is BuiltinValue => object(value) && value.kind === "builtin";
export const isModule = (value: Value): value is ModuleValue => object(value) && value.kind === "module";
export const isDate = (value: Value): value is DateValue => object(value) && value.kind === "date";
export const isTurtle = (value: Value): value is TurtleValue => object(value) && value.kind === "turtle";
export const isTurtleMethod = (value: Value): value is TurtleMethodValue => object(value) && value.kind === "turtle-method";
export const dateISO = (value: DateValue) => `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
export const isFunction = (value: Value): value is FunctionValue => object(value) && value.kind === "function";
export const isClass = (value: Value): value is ClassValue => object(value) && value.kind === "class";
export const isInstance = (value: Value): value is InstanceValue => object(value) && value.kind === "instance";
export const isBoundMethod = (value: Value): value is BoundMethodValue => object(value) && value.kind === "bound-method";
export const isFile = (value: Value): value is FileValue => object(value) && value.kind === "file";
export const isErrorType = (value: Value): value is ErrorTypeValue => object(value) && value.kind === "error-type";
export const isException = (value: Value): value is ExceptionValue => object(value) && value.kind === "exception";
export const isMap = (value: Value): value is MapValue => object(value) && value.kind === "map";
export const isList = (value: Value): value is ListValue => object(value) && value.kind === "list";
export const isSet = (value: Value): value is SetValue => object(value) && value.kind === "set";
export const isTuple = (value: Value): value is TupleValue => object(value) && value.kind === "tuple";
export const isDict = (value: Value): value is DictValue => object(value) && value.kind === "dict";
export const isSlice = (value: Value): value is SliceValue => object(value) && value.kind === "slice";
export const isAttr = (value: Value): value is AttrValue => object(value) && value.kind === "attr";
export const isSuper = (value: Value): value is SuperValue => object(value) && value.kind === "super";
export function classAttribute(cls: ClassValue, name: string): Value | undefined { for (let current: ClassValue | undefined = cls; current; current = current.parent) if (current.attributes.has(name)) return current.attributes.get(name); return undefined; }
export function subclass(cls: ClassValue, parent: ClassValue): boolean { for (let current: ClassValue | undefined = cls; current; current = current.parent) if (current === parent) return true; return false; }
export const equal = (left: Value, right: Value): boolean =>
  isSet(left) && isSet(right) ? left.items.length === right.items.length && left.items.every(value => right.items.some(other => elementEqual(value, other))) :
  numeric(left) && numeric(right) ? numberValue(left) === numberValue(right) :
  isDate(left) && isDate(right) ? dateISO(left) === dateISO(right) :
  (isList(left) && isList(right)) || (isTuple(left) && isTuple(right)) ? left.items.length === right.items.length && left.items.every((value, index) => elementEqual(value, right.items[index])) :
    isDict(left) && isDict(right) ? left.entries.length === right.entries.length && left.entries.every(entry => { const match = right.entries.find(candidate => elementEqual(entry.key, candidate.key)); return !!match && elementEqual(entry.value, match.value); }) : left === right;
/** Container lookups test identity before equality (NaN is not equal to itself). */
export const elementEqual = (left: Value, right: Value): boolean => left === right || equal(left, right);
export const keyOK = (value: Value): boolean => isTuple(value) ? value.items.every(keyOK) : !isSet(value) && !isModule(value) && !isList(value) && !isDict(value) && !isSlice(value) && !isIterator(value) && !isMap(value) && !isBuiltin(value) && !isFunction(value) && !isClass(value) && !isInstance(value) && !isBoundMethod(value) && !isFile(value) && !isTurtle(value) && !isTurtleMethod(value) && !isErrorType(value) && !isException(value) && !isAttr(value);
function quoteString(value: string): string {
  let result = "'";
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (character === "'" || character === "\\") result += "\\" + character;
    else if (character === "\n") result += "\\n";
    else if (character === "\r") result += "\\r";
    else if (character === "\t") result += "\\t";
    else if (code < 32 || (code >= 127 && code <= 160)) result += "\\x" + code.toString(16).padStart(2, "0");
    else if (code >= 0xd800 && code <= 0xdfff) result += "\\u" + code.toString(16).padStart(4, "0");
    else result += character;
  }
  return result + "'";
}
export const repr = (value: Value): string => isFloat(value) ? floatText(value.value) : isSet(value) ? value.items.length ? `{${value.items.map(repr).join(", ")}}` : "set()" : value === null ? "None" : typeof value === "number" ? (Number.isFinite(value) ? String(value) : floatText(value)) : typeof value === "boolean" ? (value ? "True" : "False") : isDate(value) ? dateISO(value) : isModule(value) ? `<module '${value.name}'>` : typeof value === "string" ? quoteString(value) : isList(value) ? `[${value.items.map(repr).join(", ")}]` : isTuple(value) ? `(${value.items.map(repr).join(", ")}${value.items.length === 1 ? "," : ""})` : isDict(value) ? `{${value.entries.map(entry => `${repr(entry.key)}: ${repr(entry.value)}`).join(", ")}}` : isRange(value) ? `range(${value.start}, ${value.stop}, ${value.step})` : isBuiltin(value) ? `<built-in function ${value.name}>` : isTurtleMethod(value) ? `<built-in method turtle.${value.name}>` : isFunction(value) ? `<function ${value.name}>` : isException(value) ? value.message : isErrorType(value) ? `<class '${value.name}'>` : isFile(value) ? `<파일 '${value.name}'>` : isTurtle(value) ? "<turtle.Turtle 객체>" : isInstance(value) ? `<${value.classValue.name} 객체>` : isClass(value) ? `<class '${value.name}'>` : isMap(value) ? "<map object>" : "<값>";
export const printable = (value: Value) => typeof value === "string" ? value : repr(value);
export const typeName = (value: Value): string => isFloat(value) ? "float" : isSet(value) ? "set" : value === null ? "NoneType" : typeof value === "number" ? (Number.isInteger(value) ? "int" : "float") : typeof value === "string" ? "str" : typeof value === "boolean" ? "bool" : isDate(value) ? "date" : isTurtle(value) ? "Turtle" : isModule(value) ? "module" : isList(value) ? "list" : isTuple(value) ? "tuple" : isDict(value) ? "dict" : isRange(value) ? "range" : isMap(value) ? "map" : isBuiltin(value) || isTurtleMethod(value) || isFunction(value) ? "function" : "object";
export const truthy = (value: Value) => isRange(value) ? (value.step > 0 ? value.start < value.stop : value.start > value.stop) : isFloat(value) ? value.value !== 0 : value !== null && value !== false && value !== 0 && value !== "" && (!isSet(value) || value.items.length > 0) && (!isList(value) || value.items.length > 0) && (!isTuple(value) || value.items.length > 0) && (!isDict(value) || value.entries.length > 0);
