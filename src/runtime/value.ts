export interface RangeValue { kind: "range"; start: number; stop: number; step: number; }
export interface IteratorValue { kind: "iterator"; values: Value[]; index: number; }
export interface BuiltinValue { kind: "builtin"; name: string; }
export interface ModuleValue { kind: "module"; name: string; attributes: ReadonlyMap<string, Value>; }
export interface DateValue { kind: "date"; readonly year: number; readonly month: number; readonly day: number; }
export interface FunctionValue { kind: "function"; name: string; params: { name: string; hasDefault: boolean }[]; defaults: Value[]; localNames: string[]; globals: string[]; bytecode: import("../compiler/opcode").Bytecode; }
export interface ClassValue { kind: "class"; name: string; attributes: Map<string, Value>; }
export interface InstanceValue { kind: "instance"; classValue: ClassValue; attributes: Map<string, Value>; }
export interface BoundMethodValue { kind: "bound-method"; functionValue: FunctionValue; instance: InstanceValue; }
export interface FileValue { kind: "file"; name: string; mode: string; content: string; position: number; closed: boolean; dirty: boolean; }
export interface ErrorTypeValue { kind: "error-type"; name: string; }
export interface ExceptionValue { kind: "exception"; name: string; message: string; line: number; column: number; }
export interface MapValue { kind: "map"; fn: Value; sources: (IteratorValue | MapValue)[]; }
export interface ListValue { kind: "list"; items: Value[]; }
export interface TupleValue { kind: "tuple"; items: Value[]; }
export interface DictValue { kind: "dict"; entries: { key: Value; value: Value }[]; }
export interface SliceValue { kind: "slice"; start?: number; stop?: number; step?: number; }
export interface AttrValue { kind: "attr"; object: Value; name: string; }
export type Value = number | string | boolean | null | ModuleValue | DateValue | RangeValue | IteratorValue | BuiltinValue | FunctionValue | ClassValue | InstanceValue | BoundMethodValue | FileValue | ErrorTypeValue | ExceptionValue | MapValue | ListValue | TupleValue | DictValue | SliceValue | AttrValue;

export const object = (value: Value): value is Exclude<Value, number | string | boolean | null> => typeof value === "object" && value !== null;
export const isRange = (value: Value): value is RangeValue => object(value) && value.kind === "range";
export const isIterator = (value: Value): value is IteratorValue => object(value) && value.kind === "iterator";
export const isBuiltin = (value: Value): value is BuiltinValue => object(value) && value.kind === "builtin";
export const isModule = (value: Value): value is ModuleValue => object(value) && value.kind === "module";
export const isDate = (value: Value): value is DateValue => object(value) && value.kind === "date";
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
export const isTuple = (value: Value): value is TupleValue => object(value) && value.kind === "tuple";
export const isDict = (value: Value): value is DictValue => object(value) && value.kind === "dict";
export const isSlice = (value: Value): value is SliceValue => object(value) && value.kind === "slice";
export const isAttr = (value: Value): value is AttrValue => object(value) && value.kind === "attr";
export const equal = (left: Value, right: Value): boolean =>
  isDate(left) && isDate(right) ? dateISO(left) === dateISO(right) :
  (isList(left) && isList(right)) || (isTuple(left) && isTuple(right)) ? left.items.length === right.items.length && left.items.every((value, index) => equal(value, right.items[index])) :
    isDict(left) && isDict(right) ? left.entries.length === right.entries.length && left.entries.every(entry => { const match = right.entries.find(candidate => equal(entry.key, candidate.key)); return !!match && equal(entry.value, match.value); }) : left === right;
export const keyOK = (value: Value) => !isModule(value) && !isList(value) && !isDict(value) && !isSlice(value) && !isIterator(value) && !isMap(value) && !isBuiltin(value) && !isFunction(value) && !isClass(value) && !isInstance(value) && !isBoundMethod(value) && !isFile(value) && !isErrorType(value) && !isException(value) && !isAttr(value);
export const repr = (value: Value): string => value === null ? "None" : typeof value === "number" ? String(value) : typeof value === "boolean" ? (value ? "True" : "False") : isDate(value) ? dateISO(value) : isModule(value) ? `<module '${value.name}'>` : typeof value === "string" ? `'${value.replace(/'/g, "\\'")}'` : isList(value) ? `[${value.items.map(repr).join(", ")}]` : isTuple(value) ? `(${value.items.map(repr).join(", ")}${value.items.length === 1 ? "," : ""})` : isDict(value) ? `{${value.entries.map(entry => `${repr(entry.key)}: ${repr(entry.value)}`).join(", ")}}` : isRange(value) ? `range(${value.start}, ${value.stop}, ${value.step})` : isBuiltin(value) ? `<built-in function ${value.name}>` : isFunction(value) ? `<function ${value.name}>` : isException(value) ? value.message : isErrorType(value) ? `<class '${value.name}'>` : isFile(value) ? `<파일 '${value.name}'>` : isInstance(value) ? `<${value.classValue.name} 객체>` : isClass(value) ? `<class '${value.name}'>` : isMap(value) ? "<map object>" : "<값>";
export const printable = (value: Value) => typeof value === "string" ? value : repr(value);
export const typeName = (value: Value): string => value === null ? "NoneType" : typeof value === "number" ? (Number.isInteger(value) ? "int" : "float") : typeof value === "string" ? "str" : typeof value === "boolean" ? "bool" : isDate(value) ? "date" : isModule(value) ? "module" : isList(value) ? "list" : isTuple(value) ? "tuple" : isDict(value) ? "dict" : isRange(value) ? "range" : isMap(value) ? "map" : isBuiltin(value) || isFunction(value) ? "function" : "object";
export const truthy = (value: Value) => value !== null && value !== false && value !== 0 && value !== "" && (!isList(value) || value.items.length > 0) && (!isTuple(value) || value.items.length > 0) && (!isDict(value) || value.entries.length > 0);
