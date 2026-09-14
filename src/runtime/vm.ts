import type { Bytecode, Instruction, UnpackPattern } from "../compiler/opcode";
import { compile } from "../compiler/compiler";
import { CompilerError } from "../compiler/token";
import { isSuper, classAttribute, subclass } from "./value";
import { SCALAR_BUILTINS, scalarBuiltin } from "./builtins-v2";
import { STRING_METHODS, LIST_METHODS, DICT_METHODS, stringMethod, listMethod, dictMethod } from "./methods-v2";
import { isSet, type LexicalScope } from "./value";
import { CollectionError, CollectionLimitError, MAX_COLLECTION_SIZE, hashable, makeSet, setBinary, setMethod, sliceIndices } from "./collections-v2";
import type { StudentError } from "../compiler/token";
import { BuiltinModules, ModuleError, type ModuleOptions } from "./modules";
import { GraphicsLimitError, TurtleError, type TurtleGraphicsCommand } from "./turtle";
import { isDate, isModule, equal, isBoundMethod, isBuiltin, isClass, isDict, isException, isFile, isFunction, isInstance, isIterator, isList, isMap, isRange, isSlice, isTuple, isTurtle, isTurtleMethod, keyOK, printable, repr, truthy, typeName, type ClassValue, type FileValue, type FunctionValue, type IteratorValue, type Value } from "./value";

export type VMEvent = { type: "output"; text: string } | { type: "input"; prompt: string } | { type: "file-change"; name: string; content: string } | { type: "graphics"; commands: TurtleGraphicsCommand[] } | { type: "complete" } | { type: "error"; error: StudentError } | { type: "stopped" };
export interface VMOptions extends ModuleOptions { fileEncodings?: ReadonlyMap<string, "utf-8" | "euc-kr">; fileName?: string; }
const MAX_OUTPUT = 100_000, MAX_ITERATIONS = 10_000, ASYNC_BATCH = 400, GRAPHICS_BATCH = 48;
export const MAX_CALL_DEPTH = 128;
const MAX_INSTRUCTIONS = 1_000_000;
const BUILTINS = new Set(["int", "float", "str", "bool", "len", "list", "tuple", "dict", "set", "sum", "min", "max", "map", "input", "print", "range", "type", "open", "sorted", "enumerate", "zip", "reversed", "any", "all"]);
const ERROR_TYPES = new Set(["ImportError", "Exception", "NameError", "TypeError", "ValueError", "ZeroDivisionError", "IndexError", "KeyError", "AttributeError", "FileNotFoundError", "RuntimeError", "RecursionError", "AssertionError"]);
type Frame = { bytecode: Bytecode; pc: number; stack: Value[]; env: Map<string, Value>; outerEnvs: LexicalScope[]; localNames: Set<string>; globalNames: Set<string>; nonlocalNames: Set<string>; globalsEnv: Map<string, Value>; functionName?: string; classValue?: ClassValue; currentFunction?: FunctionValue; fileName?: string; moduleLoad?: { name: string; member?: string; instruction: Instruction } };
type Transfer = { kind: "jump"; target: number } | { kind: "return"; value: Value } | { kind: "throw"; failure: VMFailure };
type RegionBase = { depth: number; start: number; end: number; stackHeight: number };
type Region = RegionBase & (
  { kind: "except"; handlers: { type?: string; name?: string; target: number; end: number }[] }
  | { kind: "handler"; failure: VMFailure; binding?: { env: Map<string, Value>; name: string } }
  | { kind: "finally"; target: number; finish: number }
  | { kind: "finalizing"; pending: Transfer }
  | { kind: "with"; file: FileValue }
);
export class VM {
  private pc = 0; private stack: Value[] = []; private globals = new Map<string, Value>([["__name__", "__main__"]]); private env = this.globals;
  private outerEnvs: LexicalScope[] = []; private localNames = new Set<string>(); private globalNames = new Set<string>(); private nonlocalNames = new Set<string>();
  private frames: Frame[] = []; private activeFunctions: string[] = []; private pendingInstances: { depth: number; instance: Extract<Value,{kind:"instance"}>; instruction: Instruction }[] = [];
  private withFiles: { file: FileValue; depth: number }[] = []; private waiting = false; private stopped = false; private finished = false; private asyncMode = false; private outputSize = 0; private iterations = 0; private graphics: TurtleGraphicsCommand[] = [];
  private readonly modules: BuiltinModules;
  private instructionCount = 0;
  private regions: Region[] = [];
  private readonly builtinValues = new Map<string, Value>();
  private currentFunction?: FunctionValue;
  private currentFile?: string;
  private readonly savedModules = new Map<string, string>();
  private readonly userModules = new Map<string, { value: Extract<Value, { kind: "module" }>; loading: boolean }>();
  constructor(private bytecode: Bytecode, private readonly notify: (event: VMEvent) => void, private readonly files = new Map<string, string>(), private readonly options: VMOptions = {}) { this.modules = new BuiltinModules({ ...options, emitGraphics: command => this.graphicsCommand(command) }); this.currentFile = options.fileName; for (const [name, text] of files) if (name.endsWith(".py")) this.savedModules.set(name, text); }
  private graphicsCommand(command: TurtleGraphicsCommand): void { this.graphics.push(command); if (this.graphics.length >= GRAPHICS_BATCH || command.type === "finish") this.flushGraphics(); }
  private flushGraphics(): void { if (this.graphics.length) { this.notify({ type: "graphics", commands: this.graphics }); this.graphics = []; } }
  private library<T>(i: Instruction, action: () => T): T { try { return action(); } catch (error) { if (error instanceof GraphicsLimitError || error instanceof CollectionLimitError) return this.systemFail(i, error.message); if (error instanceof TurtleError) throw new VMFailure({ line: i.line, column: i.column, category: error.pythonType === "TypeError" ? "type" : error.pythonType === "AttributeError" ? "name" : "value", message: error.message }, error.pythonType); if (!(error instanceof ModuleError) && !(error instanceof CollectionError)) throw error; throw new VMFailure({ line: i.line, column: i.column, category: error.pythonType === "TypeError" ? "type" : error.pythonType === "ImportError" || error.pythonType === "AttributeError" ? "name" : "value", message: error.message }, error.pythonType); } }
  stop(): void { if (this.finished || this.stopped) return; this.closeAll(); this.clearBindings(); this.stopped = true; this.waiting = false; this.finished = true; this.flushGraphics(); this.notify({ type: "stopped" }); }
  resume(input: string): void { if (!this.waiting || this.stopped || this.finished) return; this.waiting = false; this.stack.push(input); this.asyncMode ? this.executeAsync() : this.execute(); }
  execute(): void { this.asyncMode = false; this.run(Number.POSITIVE_INFINITY); }
  executeAsync(): void { this.asyncMode = true; this.run(ASYNC_BATCH); }
  private run(budget: number): void {
    let count = 0;
    while (!this.waiting && !this.stopped && !this.finished && count++ < budget) {
      try {
        if (this.pc >= this.bytecode.instructions.length) {
          if (this.frames.at(-1)?.moduleLoad) { this.finishModule(); continue; }
          if (this.frames.at(-1)?.classValue) { this.finishClass(); continue; }
          this.finished = true; this.flushGraphics(); this.notify({ type: "complete" }); break;
        }
        this.step(this.bytecode.instructions[this.pc++]);
      } catch (reason) {
        if (reason instanceof ResumeExecution) continue;
        if (reason instanceof VMFailure && !reason.error.fileName && this.currentFile) reason.error.fileName = this.currentFile;
        if (reason instanceof VMFailure && reason.catchable && this.handle(reason)) continue;
        this.closeAll(); this.clearBindings(); this.finished = true; this.flushGraphics();
        if (reason instanceof VMFailure) this.notify({ type: "error", error: reason.error });
        else this.notify({ type: "error", error: { line: 1, column: 1, category: "runtime", message: "실행 중 오류가 발생했습니다." } });
      }
    }
    if (!this.waiting && !this.stopped && !this.finished && this.asyncMode) setTimeout(() => this.run(ASYNC_BATCH), 0);
  }
  private fail(instruction: Instruction, category: StudentError["category"], message: string): never { const type = category === "name" ? (message.includes("파일을 찾") ? "FileNotFoundError" : message.includes("속성") ? "AttributeError" : "NameError") : category === "type" ? "TypeError" : category === "value" ? (message.includes("0으로 나") ? "ZeroDivisionError" : message.includes("키가 없") ? "KeyError" : message.includes("위치") || message.includes("인덱스") ? "IndexError" : "ValueError") : "RuntimeError"; throw new VMFailure({ line: instruction.line, column: instruction.column, category, message }, type); }
  private systemFail(instruction: Instruction, message: string): never { throw new VMFailure({ line: instruction.line, column: instruction.column, category: "runtime", message }, "RuntimeError", false); }
  private clearBindings(depth = -1): void { this.regions = this.regions.filter(region => { if (region.depth < depth) return true; this.releaseRegion(region); return false; }); }
  private releaseRegion(region: Region): void {
    if (region.kind === "handler" && region.binding) region.binding.env.delete(region.binding.name);
    if (region.kind === "with") { this.close(region.file); this.withFiles = this.withFiles.filter(item => item.file !== region.file); }
  }
  private activeException(): VMFailure | undefined {
    for (let index = this.regions.length - 1; index >= 0; index--) {
      const region = this.regions[index];
      if (region.kind === "handler") return region.failure;
      if (region.kind === "finalizing" && region.pending.kind === "throw") return region.pending.failure;
    }
    return undefined;
  }
  private unwindFrame(): void {
    const frame = this.frames.pop()!;
    if (frame.moduleLoad) this.userModules.delete(frame.moduleLoad.name);
    this.restoreFrame(frame);
    if (frame.functionName !== undefined) this.activeFunctions.pop();
    this.pendingInstances = this.pendingInstances.filter(item => item.depth < this.frames.length);
  }
  /** One exit path for jumps, returns and Python failures; only exited regions unwind. */
  private transfer(action: Transfer): boolean {
    while (true) {
      const region = this.regions.at(-1);
      if (region && region.depth === this.frames.length) {
        if (action.kind === "jump" && action.target >= region.start && action.target < region.end) { this.pc = action.target; return true; }
        this.regions.pop();
        if (region.kind === "finally") {
          this.stack.length = region.stackHeight;
          this.regions.push({ ...region, kind: "finalizing", start: region.target, end: region.finish, pending: action });
          this.pc = region.target; return true;
        }
        if (region.kind === "except" && action.kind === "throw") {
          const failure = action.failure;
          const match = region.handlers.find(handler => !handler.type || handler.type === "Exception" || handler.type === failure.type || handler.type === "RuntimeError" && failure.type === "RecursionError");
          if (match) {
            this.stack.length = region.stackHeight;
            const binding = match.name ? { env: this.bindingEnv(match.name), name: match.name } : undefined;
            if (binding) binding.env.set(binding.name, { kind: "exception", name: failure.type, message: failure.error.message, line: failure.error.line, column: failure.error.column });
            this.regions.push({ ...region, kind: "handler", start: match.target, end: match.end, failure, binding });
            this.pc = match.target; return true;
          }
        }
        this.releaseRegion(region);
        continue;
      }
      if (action.kind === "jump") { this.pc = action.target; return true; }
      if (action.kind === "return") { this.returnFromFunction(action.value); return true; }
      if (!this.frames.length) return false;
      this.unwindFrame();
    }
  }
  private handle(failure: VMFailure): boolean { return this.transfer({ kind: "throw", failure }); }
  private pop(instruction: Instruction): Value { const value = this.stack.pop(); if (value === undefined) return this.fail(instruction, "runtime", "계산 중 오류가 발생했습니다."); return value; }
  private loadName(instruction: Instruction, name: string): Value {
    if (!this.globalNames.has(name)) {
      if (!this.nonlocalNames.has(name) && this.env.has(name)) return this.env.get(name)!;
      if (this.localNames.has(name)) return this.fail(instruction, "name", `지역 변수 '${name}'에 아직 값이 없습니다.`);
      for (const outer of this.outerEnvs) { if (outer.env.has(name)) return outer.env.get(name)!; if (outer.names.has(name)) return this.fail(instruction, "name", `바깥 변수 '${name}'에 아직 값이 없습니다.`); }
    }
    if (this.globals.has(name)) return this.globals.get(name)!;
    if (ERROR_TYPES.has(name) || BUILTINS.has(name) || SCALAR_BUILTINS.has(name) || ["super", "isinstance", "issubclass"].includes(name)) { if (!this.builtinValues.has(name)) this.builtinValues.set(name, { kind: ERROR_TYPES.has(name) ? "error-type" : "builtin", name }); return this.builtinValues.get(name)!; }
    return this.fail(instruction, "name", `'${name}' 변수가 정의되지 않았습니다.`);
  }
  private bindingEnv(name: string): Map<string, Value> { return this.globalNames.has(name) ? this.globals : this.nonlocalNames.has(name) ? this.outerEnvs.find(scope => scope.names.has(name))!.env : this.env; }
  private storeName(name: string, value: Value): void { this.bindingEnv(name).set(name, value); }
  private saveFrame(extra: { functionName?: string; classValue?: ClassValue; moduleLoad?: Frame["moduleLoad"] } = {}): Frame { return { bytecode: this.bytecode, pc: this.pc, stack: this.stack, env: this.env, outerEnvs: this.outerEnvs, localNames: this.localNames, globalNames: this.globalNames, nonlocalNames: this.nonlocalNames, globalsEnv: this.globals, currentFunction: this.currentFunction, fileName: this.currentFile, ...extra }; }
  private restoreFrame(frame: Frame): void { this.bytecode = frame.bytecode; this.pc = frame.pc; this.stack = frame.stack; this.env = frame.env; this.outerEnvs = frame.outerEnvs; this.localNames = frame.localNames; this.globalNames = frame.globalNames; this.nonlocalNames = frame.nonlocalNames; this.globals = frame.globalsEnv; this.currentFunction = frame.currentFunction; this.currentFile = frame.fileName; }
  private importedValue(i: Instruction, value: Extract<Value, { kind: "module" }>, member?: string): Value { if (member === undefined) return value; const result = value.attributes.get(member); if (result === undefined) throw new VMFailure({ line: i.line, column: i.column, category: "name", message: `'${value.name}' 모듈에 '${member}' 이름이 없습니다.` }, "ImportError"); return result; }
  private finishModule(): void { const frame = this.frames.pop()!, load = frame.moduleLoad!, entry = this.userModules.get(load.name)!; entry.loading = false; this.restoreFrame(frame); this.stack.push(this.importedValue(load.instruction, entry.value, load.member)); }
  private importModule(i: Extract<Instruction, { op: "import_module" }>): void {
    if (this.modules.has(i.module)) { this.stack.push(this.library(i, () => this.modules.load(i.module, i.member))); return; }
    if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(i.module) || i.member === "*") throw new VMFailure({ line: i.line, column: i.column, category: "name", message: "폴더·경로·와일드카드 모듈은 가져올 수 없습니다." }, "ImportError");
    const cached = this.userModules.get(i.module); if (cached) { if (cached.loading) throw new VMFailure({ line: i.line, column: i.column, category: "name", message: `'${i.module}' 모듈의 순환 가져오기가 발생했습니다.` }, "ImportError"); this.stack.push(this.importedValue(i, cached.value, i.member)); return; }
    const fileName = `${i.module}.py`, text = this.savedModules.get(fileName); if (text === undefined) throw new VMFailure({ line: i.line, column: i.column, category: "name", message: `'${fileName}' 저장 파일을 찾을 수 없습니다.` }, "ImportError");
    if (this.frames.length >= MAX_CALL_DEPTH) throw new VMFailure({ line: i.line, column: i.column, category: "runtime", message: "모듈 호출 깊이 제한을 초과했습니다." }, "RecursionError");
    let bytecode: Bytecode; try { bytecode = compile(text); } catch (error) { if (error instanceof CompilerError) throw new VMFailure({ ...error.detail, fileName }, "SyntaxError"); throw error; }
    const globals = new Map<string, Value>([["__name__", i.module]]), value: Extract<Value, { kind: "module" }> = { kind: "module", name: i.module, attributes: globals };
    this.userModules.set(i.module, { value, loading: true }); this.frames.push(this.saveFrame({ moduleLoad: { name: i.module, member: i.member, instruction: i } })); this.bytecode = bytecode; this.pc = 0; this.stack = []; this.env = globals; this.globals = globals; this.outerEnvs = []; this.localNames = new Set(); this.globalNames = new Set(); this.nonlocalNames = new Set(); this.currentFunction = undefined; this.currentFile = fileName;
  }
  private finishClass(): void { const frame = this.frames.pop()!; this.restoreFrame(frame); this.stack.push(frame.classValue!); }
  private attribute(i: Instruction, object: Value, name: string): Value {
    if (isSuper(object)) { const value = object.parent ? classAttribute(object.parent, name) : undefined; if (value === undefined) this.fail(i, "name", `부모 클래스에 '${name}' 속성이 없습니다.`); return isFunction(value) ? { kind: "bound-method", functionValue: value, instance: object.instance } : value; }
    if (isModule(object)) { const value = object.attributes.get(name); if (value === undefined) return this.fail(i, "name", `${object.name}에 '${name}' 속성이 없습니다.`); return value; }
    if (isBuiltin(object) && object.name === "datetime.date") return this.library(i, () => this.modules.dateAttribute(name));
    if (isTurtle(object)) return this.library(i, () => this.modules.turtleAttribute(object, name));
    if (isDate(object)) { if (name === "year" || name === "month" || name === "day") return object[name]; return this.fail(i, "name", `date에 '${name}' 속성이 없습니다.`); }
    if (isFile(object)) { if (name === "closed") return object.closed; this.fail(i, "name", `파일에 '${name}' 속성이 없습니다.`); }
    if (isInstance(object)) { if (object.attributes.has(name)) return object.attributes.get(name)!; const value = classAttribute(object.classValue, name); if (value === undefined) this.fail(i, "name", `${object.classValue.name} 객체에 '${name}' 속성이 없습니다.`); return isFunction(value) ? { kind: "bound-method", functionValue: value, instance: object } : value; }
    if (isClass(object)) { const value = classAttribute(object, name); if (value === undefined) this.fail(i, "name", `${object.name} 클래스에 '${name}' 속성이 없습니다.`); return value; }
    this.fail(i, "type", "이 값에는 속성이 없습니다.");
  }
  private setAttribute(i: Instruction, object: Value, name: string, value: Value): void { if (isModule(object) || isDate(object) || isBuiltin(object) || isTurtle(object)) return this.fail(i, "name", "이 속성은 수정할 수 없습니다."); if (isInstance(object)) { object.attributes.set(name, value); return; } if (isClass(object)) { object.attributes.set(name, value); return; } this.fail(i, "type", "이 값에는 속성을 저장할 수 없습니다."); }
  private close(file: FileValue): void { if (file.closed) return; file.closed = true; if (file.dirty) this.notify({ type: "file-change", name: file.name, content: file.content }); }
  private closeAll(): void { this.withFiles.splice(0).forEach(item => this.close(item.file)); }
  private fileLines(file: FileValue): string[] { const rest = file.content.slice(file.position); file.position = file.content.length; return rest.match(/[^\n]*\n|[^\n]+/g) ?? []; }
  private fileLine(file: FileValue): string { const end = file.content.indexOf("\n", file.position); const line = file.content.slice(file.position, end < 0 ? undefined : end + 1); file.position += line.length; return line; }
  private fileRead(i: Instruction, file: FileValue, size?: Value): string { if (file.closed) return this.fail(i, "value", "닫힌 파일은 사용할 수 없습니다."); if (file.mode !== "r") return this.fail(i, "type", "쓰기 모드로 연 파일에서는 읽을 수 없습니다."); if (size !== undefined && (typeof size !== "number" || !Number.isInteger(size) || size < 0)) return this.fail(i, "type", "read() 크기는 0 이상의 정수여야 합니다."); const result = file.content.slice(file.position, size === undefined ? undefined : file.position + size); file.position += result.length; return result; }
  private fileWrite(i: Instruction, file: FileValue, text: Value): number { if (file.closed) return this.fail(i, "value", "닫힌 파일은 사용할 수 없습니다."); if (file.mode === "r") return this.fail(i, "type", "읽기 모드로 연 파일에는 쓸 수 없습니다."); if (typeof text !== "string") return this.fail(i, "type", "write()에는 문자열이 필요합니다."); const next = file.content.slice(0, file.position) + text + file.content.slice(file.position); if (new TextEncoder().encode(next).length > 1_000_000) return this.fail(i, "runtime", "파일 하나는 1MB를 넘을 수 없습니다."); const total = [...this.files.entries()].reduce((sum, [name, content]) => sum + new TextEncoder().encode(name === file.name ? next : content).length, 0); if (total > 10_000_000) return this.fail(i, "runtime", "전체 파일 용량은 10MB를 넘을 수 없습니다."); file.content = next; file.position += text.length; file.dirty = true; this.files.set(file.name, next); return text.length; }
  private openFile(i: Instruction, args: Value[], keywords: Record<string, Value>): void { const allowed = new Set(["mode", "encoding"]); if (Object.keys(keywords).some(name => !allowed.has(name)) || args.length < 1 || args.length > 2) return this.fail(i, "type", "open() 인수가 올바르지 않습니다."); const name = args[0]; const mode = args[1] ?? keywords.mode ?? "r", encoding = keywords.encoding; if (args.length === 2 && keywords.mode !== undefined) return this.fail(i, "type", "mode 인수가 중복되었습니다."); if (typeof name !== "string") return this.fail(i, "type", "파일 이름은 문자열이어야 합니다."); if (!name || name.includes("..") || /[\\/:]/.test(name) || /^[a-zA-Z]:/.test(name) || /^https?:/i.test(name)) return this.fail(i, "value", "앱의 파일 공간 밖에는 접근할 수 없습니다."); if (typeof mode !== "string" || !["r", "w", "a"].includes(mode)) return this.fail(i, "value", "지원하지 않는 파일 모드입니다."); let normalizedEncoding = "utf-8"; if (encoding !== undefined) { if (typeof encoding !== "string") return this.fail(i, "type", "encoding은 문자열이어야 합니다."); const label = encoding.trim().toLowerCase().replaceAll("_", "-"); if (label === "utf8" || label === "utf-8") normalizedEncoding = "utf-8"; else if (label === "euc-kr" || label === "euckr" || label === "cp949") normalizedEncoding = "euc-kr"; else return this.fail(i, "value", `'${encoding}' 인코딩은 현재 지원하지 않습니다.`); } if (normalizedEncoding === "euc-kr" && mode !== "r") return this.fail(i, "value", "EUC-KR은 현재 읽기만 지원합니다. 쓰기는 UTF-8을 사용해 주세요."); const exists = this.files.has(name); const storedEncoding = this.options.fileEncodings?.get(name); if (mode === "r" && exists && storedEncoding && storedEncoding !== normalizedEncoding) return this.fail(i, "value", `이 파일을 ${normalizedEncoding === "euc-kr" ? "EUC-KR" : "UTF-8"}로 읽을 수 없습니다.`); if (mode === "r" && !exists) return this.fail(i, "name", `'${name}' 파일을 찾을 수 없습니다.`); if (!exists && this.files.size >= 100) return this.fail(i, "runtime", "파일은 최대 100개까지 만들 수 있습니다."); const content = mode === "w" ? "" : this.files.get(name) ?? ""; const file: FileValue = { kind: "file", name, mode, content, position: mode === "a" ? content.length : 0, closed: false, dirty: mode !== "r", }; this.files.set(name, content); if (file.dirty) this.notify({ type: "file-change", name, content }); this.stack.push(file); }
  private step(instruction: Instruction): void {
    if (++this.instructionCount > MAX_INSTRUCTIONS) this.systemFail(instruction, "명령 실행 횟수 제한을 초과했습니다.");
    if (instruction.op === "build_set") { this.stack.push(this.library(instruction, () => makeSet(this.stack.splice(this.stack.length - instruction.count)))); return; }
    if (instruction.op === "delete_name") { if (!this.bindingEnv(instruction.name).delete(instruction.name)) this.fail(instruction, "name", `'${instruction.name}' 변수가 정의되지 않았습니다.`); return; }
    if (instruction.op === "delete_subscript") {
      const key = this.pop(instruction), object = this.pop(instruction);
      if (isList(object)) {
        if (isSlice(key)) { const indices = this.library(instruction, () => sliceIndices(object.items.length, key)); indices.sort((a, b) => b - a).forEach(index => object.items.splice(index, 1)); return; }
        if (typeof key !== "number" || !Number.isInteger(key)) this.fail(instruction, "type", "인덱스는 정수여야 합니다.");
        const index = key < 0 ? key + object.items.length : key; if (index < 0 || index >= object.items.length) this.fail(instruction, "value", "삭제할 인덱스가 범위를 벗어났습니다."); object.items.splice(index, 1); return;
      }
      if (isDict(object)) { this.library(instruction, () => hashable(key)); const index = object.entries.findIndex(entry => equal(entry.key, key)); if (index < 0) this.fail(instruction, "value", "삭제할 키가 없습니다."); object.entries.splice(index, 1); return; }
      this.fail(instruction, "type", "이 값의 요소는 삭제할 수 없습니다.");
    }
    if (instruction.op === "binary" && ["|", "&", "^", "-"].includes(instruction.operator) && (isSet(this.stack.at(-1)!) || isSet(this.stack.at(-2)!))) {
      const right = this.pop(instruction), left = this.pop(instruction); if (!isSet(left) || !isSet(right)) this.fail(instruction, "type", "집합 연산에는 두 집합이 필요합니다."); this.stack.push(this.library(instruction, () => setBinary(left, right, instruction.operator))); return;
    }
    if (instruction.op === "binary" && ["in", "not in"].includes(instruction.operator) && isSet(this.stack.at(-1)!)) {
      const right = this.pop(instruction), left = this.pop(instruction); this.library(instruction, () => hashable(left)); const found = isSet(right) && right.items.some(item => equal(item, left)); this.stack.push(instruction.operator === "in" ? found : !found); return;
    }
    if (instruction.op === "import_module") { this.importModule(instruction); return; }
    if (instruction.op === "constant") { this.stack.push(instruction.value as Value); return; }
    if (instruction.op === "sort_values") {
      const keys = this.stack.splice(this.stack.length - instruction.count), snapshot = this.pop(instruction), target = this.pop(instruction);
      if (!isList(snapshot) || !isList(target)) this.systemFail(instruction, "정렬 상태를 복원할 수 없습니다.");
      const sorted = snapshot.items.map((value, index) => ({ value, key: keys[index], index }));
      sorted.sort((a, b) => (instruction.reverse ? -1 : 1) * this.order(instruction, a.key, b.key) || a.index - b.index);
      if (instruction.inplace && (target.items.length !== snapshot.items.length || target.items.some((value, index) => value !== snapshot.items[index]))) this.fail(instruction, "value", "정렬 중 리스트가 변경되었습니다.");
      target.items.splice(0, target.items.length, ...sorted.map(item => item.value)); this.stack.push(instruction.inplace ? null : target); return;
    }
    if (instruction.op === "setup_except") { this.regions.push({ kind: "except", depth: this.frames.length, start: this.pc, end: instruction.end, stackHeight: this.stack.length, handlers: instruction.handlers }); return; }
    if (instruction.op === "setup_finally") { this.regions.push({ kind: "finally", depth: this.frames.length, start: this.pc, end: instruction.target, stackHeight: this.stack.length, target: instruction.target, finish: instruction.end }); return; }
    if (instruction.op === "pop_except" || instruction.op === "end_handler") { const region = this.regions.pop(); if (region) this.releaseRegion(region); return; }
    if (instruction.op === "end_finally") { const region = this.regions.pop(); if (region?.kind !== "finalizing") this.systemFail(instruction, "정리 영역을 종료할 수 없습니다."); if (!this.transfer(region.pending) && region.pending.kind === "throw") throw region.pending.failure; return; }
    if (instruction.op === "raise") {
      if (!instruction.hasValue) { const failure = this.activeException(); if (!failure) this.fail(instruction, "runtime", "다시 발생시킬 오류가 없습니다."); throw failure; }
      const value = this.pop(instruction);
      if (isException(value)) throw new VMFailure({ line: instruction.line, column: instruction.column, category: "runtime", message: value.message }, value.name);
      if (typeof value === "object" && value?.kind === "error-type") throw new VMFailure({ line: instruction.line, column: instruction.column, category: "runtime", message: "" }, value.name);
      this.fail(instruction, "type", "raise에는 오류 객체가 필요합니다.");
    }
    if (instruction.op === "load") { this.stack.push(this.loadName(instruction, instruction.name)); return; }
    if (instruction.op === "dup") { const value = this.stack.at(-1); if (value === undefined) this.fail(instruction, "runtime", "계산 중 오류가 발생했습니다."); this.stack.push(value); return; }
    if (instruction.op === "dup_two") { if (this.stack.length < 2) this.fail(instruction, "runtime", "계산 중 오류가 발생했습니다."); this.stack.push(...this.stack.slice(-2)); return; }
    if (instruction.op === "store") { this.storeName(instruction.name, this.pop(instruction)); return; }
    if (instruction.op === "store_keep") { const value = this.stack.at(-1); if (value === undefined) this.fail(instruction, "runtime", "계산 중 오류가 발생했습니다."); this.storeName(instruction.name, value); return; }
    if (instruction.op === "pop") { this.pop(instruction); return; }
    if (instruction.op === "loop_guard") { if (++this.iterations > MAX_ITERATIONS) this.systemFail(instruction, "실행을 중지했습니다. 반복문이 끝나는 조건을 확인해 주세요."); return; }
    if (instruction.op === "jump") { this.transfer({ kind: "jump", target: instruction.target }); return; }
    if (instruction.op === "jump_if_false") { if (!truthy(this.pop(instruction))) this.pc = instruction.target; return; }
    if (instruction.op === "jump_if_false_keep" || instruction.op === "jump_if_true_keep") { const value = this.stack.at(-1); if (value === undefined) this.fail(instruction, "runtime", "계산 중 오류가 발생했습니다."); const keep = instruction.op === "jump_if_false_keep" ? !truthy(value) : truthy(value); if (keep) this.pc = instruction.target; else this.stack.pop(); return; }
    if (instruction.op === "build_list" || instruction.op === "build_tuple") { const raw = this.stack.splice(this.stack.length - instruction.count), items = this.expand(instruction, raw, instruction.spreads); this.stack.push({ kind: instruction.op === "build_list" ? "list" : "tuple", items }); return; }
    if (instruction.op === "build_dict") {
      const raw = this.stack.splice(this.stack.length - instruction.count * 2), dictionary: Extract<Value, { kind: "dict" }> = { kind: "dict", entries: [] };
      for (let index = 0; index < instruction.count; index++) {
        const key = raw[index * 2], value = raw[index * 2 + 1];
        if (instruction.spreads?.[index]) { if (!isDict(value)) this.fail(instruction, "type", "** 뒤에는 딕셔너리가 필요합니다."); for (const entry of value.entries) this.setSubscript(instruction, dictionary, entry.key, entry.value); }
        else this.setSubscript(instruction, dictionary, key, value);
        if (dictionary.entries.length > MAX_COLLECTION_SIZE) this.systemFail(instruction, "컬렉션 크기 제한을 초과했습니다.");
      }
      this.stack.push(dictionary); return;
    }
    if (instruction.op === "build_slice") { const values=this.stack.splice(this.stack.length+0-(Number(instruction.hasStart)+Number(instruction.hasStop)+Number(instruction.hasStep)));const num=(v:Value|undefined)=>v===undefined?undefined:typeof v==="number"&&Number.isInteger(v)?v:this.fail(instruction,"type","슬라이스 위치는 정수여야 합니다.");this.stack.push({kind:"slice",start:num(instruction.hasStart?values.shift():undefined),stop:num(instruction.hasStop?values.shift():undefined),step:num(instruction.hasStep?values.shift():undefined)});return; }
    if (instruction.op === "load_subscript") { const index=this.pop(instruction),object=this.pop(instruction);this.stack.push(this.subscript(instruction,object,index));return; }
    if (instruction.op === "store_subscript") { const value=this.pop(instruction),index=this.pop(instruction),object=this.pop(instruction);this.setSubscript(instruction,object,index,value);return; }
    if (instruction.op === "store_subscript_keep") { const index=this.pop(instruction),object=this.pop(instruction),value=this.stack.at(-1); if(value===undefined)this.fail(instruction,"runtime","계산 중 오류가 발생했습니다."); this.setSubscript(instruction,object,index,value);return; }
    if (instruction.op === "store_attr") { const value=this.pop(instruction),object=this.pop(instruction);this.setAttribute(instruction,object,instruction.name,value);return; }
    if (instruction.op === "store_attr_keep") { const object=this.pop(instruction),value=this.stack.at(-1);if(value===undefined)this.fail(instruction,"runtime","계산 중 오류가 발생했습니다.");this.setAttribute(instruction,object,instruction.name,value);return; }
    if (instruction.op === "load_attr") { this.stack.push(this.attribute(instruction,this.pop(instruction),instruction.name));return; }
    if (instruction.op === "enter_with") { const file = this.pop(instruction); if (!isFile(file)) this.fail(instruction, "type", "with에는 파일 객체가 필요합니다."); this.storeName(instruction.name, file); this.withFiles.push({ file, depth: this.frames.length }); this.regions.push({ kind: "with", depth: this.frames.length, start: this.pc, end: instruction.end, stackHeight: this.stack.length, file }); return; }
    if (instruction.op === "exit_with") { const region = this.regions.pop(); if (region?.kind !== "with") this.systemFail(instruction, "파일 블록을 종료할 수 없습니다."); this.releaseRegion(region); return; }
    if (instruction.op === "call_method") {
      const { args, keywords } = this.callArguments(instruction), object = this.pop(instruction);
      if (isList(object) && instruction.name === "sort") { if (args.length) this.fail(instruction, "type", "sort()는 위치 인수를 받지 않습니다."); this.startSort(instruction, object, keywords, true); return; }
      if (isDict(object) || (isBuiltin(object) && object.name === "dict" && instruction.name === "fromkeys")) { this.stack.push(this.library(instruction, () => dictMethod(isDict(object) ? object : { kind: "dict", entries: [] }, instruction.name, args, keywords, value => this.items(instruction, value)))); return; }
      if ((typeof object === "string" && STRING_METHODS.has(instruction.name)) || (isList(object) && LIST_METHODS.has(instruction.name))) { if (Object.keys(keywords).length) this.fail(instruction, "type", "이 메서드는 키워드 인수를 지원하지 않습니다."); this.stack.push(this.library(instruction, () => typeof object === "string" ? stringMethod(object, instruction.name, args, value => this.items(instruction, value)) : listMethod(object as Extract<Value, { kind: "list" }>, instruction.name, args, value => this.items(instruction, value)))); return; }
      if (isSuper(object) || isInstance(object) || isClass(object) || isModule(object) || isBuiltin(object) || isDate(object) || isTurtle(object)) this.invoke(instruction, this.attribute(instruction, object, instruction.name), args, keywords);
      else { if (Object.keys(keywords).length) this.fail(instruction, "type", "이 메서드는 키워드 인수를 지원하지 않습니다."); if (isSet(object)) this.stack.push(this.library(instruction, () => setMethod(object, instruction.name, args, value => this.items(instruction, value)))); else this.method(instruction, object, instruction.name, args); }
      return;
    }
    if (instruction.op === "make_class") {
      const parent = instruction.hasParent ? this.pop(instruction) : undefined; if (parent !== undefined && !isClass(parent)) this.fail(instruction, "type", "부모는 클래스여야 합니다.");
      const seen = new Set<ClassValue>(); for (let current = parent; current; current = current.parent) { if (seen.has(current)) this.fail(instruction, "type", "순환 상속은 사용할 수 없습니다."); seen.add(current); }
      const classValue: ClassValue = { kind: "class", name: instruction.name, attributes: new Map(), parent }; this.frames.push(this.saveFrame({ classValue })); this.currentFunction = undefined; this.bytecode = instruction.bytecode; this.pc = 0; this.stack = []; this.outerEnvs = [{ env: this.env, names: this.localNames }, ...this.outerEnvs]; this.env = classValue.attributes; this.localNames = new Set(); this.globalNames = new Set(); this.nonlocalNames = new Set(); return;
    }
    if (instruction.op === "make_function") {
      const defaults = this.stack.splice(this.stack.length - instruction.params.filter(parameter => parameter.hasDefault).length);
      const closure = this.frames.at(-1)?.classValue ? [...this.outerEnvs] : [{ env: this.env, names: this.localNames }, ...this.outerEnvs];
      for (const name of instruction.nonlocals ?? []) if (!closure.some(scope => scope.names.has(name))) throw new VMFailure({ line: instruction.line, column: instruction.column, category: "syntax", message: `'${name}' 이름의 바깥 함수 변수가 없습니다.` }, "SyntaxError");
      this.stack.push({ kind: "function", name: instruction.name, params: instruction.params, defaults, localNames: instruction.localNames, globals: instruction.globals, nonlocals: instruction.nonlocals, closure, globalEnv: this.globals, ownerClass: this.frames.at(-1)?.classValue, fileName: this.currentFile, bytecode: instruction.bytecode }); return;
    }
    if (instruction.op === "run_comprehension") { const iterable = this.pop(instruction); this.frames.push(this.saveFrame()); this.bytecode = instruction.bytecode; this.pc = 0; this.stack = []; this.outerEnvs = [{ env: this.env, names: this.localNames }, ...this.outerEnvs]; this.env = new Map([[instruction.iterableName, iterable]]); this.localNames = new Set(instruction.localNames); this.globalNames = new Set(); this.nonlocalNames = new Set(); return; }
    if (instruction.op === "format_value") { const original = this.pop(instruction), value = isFloat(original) ? original.value : original, raw = this.stringValue(instruction, original); if (instruction.format.kind === "align") { this.stack.push(instruction.format.align === "<" ? raw.padEnd(instruction.format.width) : instruction.format.align === ">" ? raw.padStart(instruction.format.width) : raw.length >= instruction.format.width ? raw : `${" ".repeat(Math.floor((instruction.format.width - raw.length) / 2))}${raw}${" ".repeat(Math.ceil((instruction.format.width - raw.length) / 2))}`); return; } if (instruction.format.kind === "zero") { if (isFloat(original) || typeof value !== "number" || !Number.isInteger(value)) this.fail(instruction, "type", "0 채움 형식에는 정수가 필요합니다."); const sign = value < 0 ? "-" : "", digits = String(Math.abs(value)); this.stack.push(`${sign}${digits.padStart(Math.max(0, instruction.format.width - sign.length), "0")}`); return; } if (typeof value !== "number") this.fail(instruction, "type", "소수점 형식에는 숫자가 필요합니다."); this.stack.push(value.toFixed(instruction.format.precision)); return; }
    if (instruction.op === "return_value") { this.transfer({ kind: "return", value: this.pop(instruction) }); return; }
    if (instruction.op === "build_string") { const values = this.stack.splice(this.stack.length - instruction.count); this.stack.push(values.map(value => this.stringValue(instruction,value)).join("")); return; }
    if (instruction.op === "unpack") { const value = this.pop(instruction), items = instruction.pattern ? this.unpack(instruction, value, instruction.pattern) : this.items(instruction, value); if (items.length !== instruction.names.length) this.fail(instruction, "value", `${items.length}개의 값을 ${instruction.names.length}개의 변수에 저장할 수 없습니다.`); instruction.names.forEach((name, index) => this.storeName(name, items[index])); return; }
    if (instruction.op === "iter_prepare") { this.stack.push(this.iterator(instruction, this.pop(instruction))); return; }
    if (instruction.op === "iter_next") { const iterator = this.stack.at(-1); if (!iterator || (!isIterator(iterator) && !isMap(iterator))) this.fail(instruction, "runtime", "반복자를 준비할 수 없습니다."); const value = this.next(instruction, iterator); if (value === undefined) this.pc = instruction.target; else { const parts = instruction.pattern ? this.unpack(instruction, value, instruction.pattern) : instruction.names.length === 1 ? [value] : this.items(instruction, value); if (parts.length !== instruction.names.length) this.fail(instruction, "value", `${parts.length}개의 값을 ${instruction.names.length}개의 변수에 저장할 수 없습니다.`); instruction.names.forEach((name, index) => this.storeName(name, parts[index])); } return; }
    if (instruction.op === "unary") { const value = this.pop(instruction); if (instruction.operator === "not") { this.stack.push(!truthy(value)); return; } if (!numeric(value)) this.fail(instruction, "type", "숫자에만 단항 연산을 사용할 수 있습니다."); const result = instruction.operator === "-" ? -numberValue(value) : numberValue(value); this.stack.push(isFloat(value) ? float(result) : result); return; }
    if (instruction.op === "binary") { const right = this.pop(instruction), left = this.pop(instruction); if(instruction.operator==="in"||instruction.operator==="not in"){const found=typeof right==="string"&&typeof left==="string"?right.includes(left):isList(right)||isTuple(right)?right.items.some(x=>equal(x,left)):isDict(right)?right.entries.some(e=>equal(e.key,left)):this.fail(instruction,"type","이 값은 검사할 수 없습니다.");this.stack.push(instruction.operator==="in"?found:!found);}else this.stack.push(this.binary(instruction, left, right)); return; }
    if (instruction.op === "compare") { const values = this.stack.splice(this.stack.length - instruction.count); let matched = true; for (let index = 0; index < instruction.operators.length; index++) { if (!this.compare(instruction, instruction.operators[index], values[index], values[index + 1])) { matched = false; break; } } this.stack.push(matched); return; }
    if (instruction.op === "call") { const { args, keywords } = this.callArguments(instruction); this.invoke(instruction, { kind: "builtin", name: instruction.name }, args, keywords); return; }
    if (instruction.op === "call_value") { const { args, keywords } = this.callArguments(instruction), callable = this.pop(instruction); this.invoke(instruction, callable, args, keywords); return; }
  }
  private expand(i: Instruction, values: Value[], spreads?: boolean[]): Value[] {
    const result: Value[] = [];
    values.forEach((value, index) => { const items = spreads?.[index] ? this.items(i, value) : [value]; if (result.length + items.length > MAX_COLLECTION_SIZE) this.systemFail(i, "컬렉션 크기 제한을 초과했습니다."); result.push(...items); }); return result;
  }
  private iterableBuiltin(i: Instruction, name: string, args: Value[], keywords: Record<string, Value>): void {
    if (Object.keys(keywords).some(key => name !== "enumerate" || key !== "start")) this.fail(i, "type", "지원하지 않는 키워드 인수입니다.");
    if (name === "enumerate") {
      if (args.length < 1 || args.length > 2 || (args.length === 2 && Object.hasOwn(keywords, "start"))) this.fail(i, "type", "enumerate() 인수가 올바르지 않습니다.");
      const start = args.length === 2 ? args[1] : Object.hasOwn(keywords, "start") ? keywords.start : 0; if (typeof start !== "boolean" && !(typeof start === "number" && Number.isSafeInteger(start))) this.fail(i, "type", "시작 번호는 정수여야 합니다.");
      const source = this.iterator(i, args[0]); let index = Number(start);
      this.stack.push({ kind: "iterator", values: [], index: 0, pull: () => { const value = this.next(i, source); return value === undefined ? undefined : { kind: "tuple", items: [index++, value] }; } }); return;
    }
    if (name === "zip") {
      const sources = args.map(value => this.iterator(i, value));
      this.stack.push({ kind: "iterator", values: [], index: 0, pull: () => { if (!sources.length) return undefined; const values: Value[] = []; for (const source of sources) { const value = this.next(i, source); if (value === undefined) return undefined; values.push(value); } return { kind: "tuple", items: values }; } }); return;
    }
    if (args.length !== 1) this.fail(i, "type", `${name}()에는 인수 하나가 필요합니다.`);
    if (name === "reversed") {
      if (!isList(args[0]) && !isTuple(args[0]) && !isRange(args[0]) && typeof args[0] !== "string") this.fail(i, "type", "이 값은 역순으로 순회할 수 없습니다.");
      const values = this.items(i, args[0]); let index = values.length - 1;
      this.stack.push({ kind: "iterator", values: [], index: 0, pull: () => index < 0 ? undefined : values[index--] }); return;
    }
    const source = this.iterator(i, args[0]); let value: Value | undefined, count = 0;
    while ((value = this.next(i, source)) !== undefined) { if (++count > MAX_COLLECTION_SIZE) this.systemFail(i, "컬렉션 크기 제한을 초과했습니다."); if (truthy(value) === (name === "any")) { this.stack.push(name === "any"); return; } }
    this.stack.push(name === "all");
  }
  private startSort(i: Instruction, list: Extract<Value, { kind: "list" }>, keywords: Record<string, Value>, inplace: boolean): void {
    if (Object.keys(keywords).some(name => name !== "key" && name !== "reverse")) this.fail(i, "type", "정렬에 지원하지 않는 키워드 인수가 있습니다.");
    const key = keywords.key ?? null, reverse = keywords.reverse ?? false;
    if (typeof reverse !== "boolean" && !(typeof reverse === "number" && Number.isInteger(reverse))) this.fail(i, "type", "reverse에는 정수 또는 bool이 필요합니다.");
    if (key !== null && !isBuiltin(key) && !isFunction(key) && !isBoundMethod(key) && !isClass(key)) this.fail(i, "type", "key는 호출 가능한 값이어야 합니다.");
    if (list.items.length > MAX_COLLECTION_SIZE) this.systemFail(i, "컬렉션 크기 제한을 초과했습니다.");
    if (this.frames.length >= MAX_CALL_DEPTH) throw new VMFailure({ line: i.line, column: i.column, category: "runtime", message: "함수 호출 깊이 제한을 초과했습니다." }, "RecursionError");
    const point = { line: i.line, column: i.column }, instructions: Instruction[] = [{ op: "constant", value: list, ...point }, { op: "constant", value: { kind: "list", items: [...list.items] }, ...point }];
    // Key calls are ordinary bytecode calls: input, exceptions, limits and stop use the VM loop.
    for (const value of [...list.items]) { if (key !== null) instructions.push({ op: "constant", value: key, ...point }); instructions.push({ op: "constant", value, ...point }); if (key !== null) instructions.push({ op: "call_value", argc: 1, keywords: [], ...point }); }
    instructions.push({ op: "sort_values", count: list.items.length, reverse: truthy(reverse), inplace, ...point }, { op: "return_value", ...point });
    this.frames.push(this.saveFrame({})); this.bytecode = { instructions }; this.pc = 0; this.stack = [];
  }
  private order(i: Instruction, a: Value, b: Value): number {
    if (equal(a, b)) return 0;
    if (numeric(a) && numeric(b)) return numberValue(a) < numberValue(b) ? -1 : numberValue(a) > numberValue(b) ? 1 : 0;
    if (typeof a === "string" && typeof b === "string") { const left = [...a], right = [...b]; for (let n = 0; n < Math.min(left.length, right.length); n++) if (left[n] !== right[n]) return left[n].codePointAt(0)! < right[n].codePointAt(0)! ? -1 : 1; return left.length < right.length ? -1 : 1; }
    if ((isTuple(a) && isTuple(b)) || (isList(a) && isList(b))) { for (let n = 0; n < Math.min(a.items.length, b.items.length); n++) { const comparison = this.order(i, a.items[n], b.items[n]); if (comparison) return comparison; } return a.items.length < b.items.length ? -1 : 1; }
    return this.fail(i, "type", "서로 비교할 수 없는 값입니다.");
  }
  private callArguments(i: Extract<Instruction, { op: "call" | "call_value" | "call_method" }>): { args: Value[]; keywords: Record<string, Value> } {
    const raw = this.stack.splice(this.stack.length - i.argc - i.keywords.length), args = this.expand(i, raw.slice(0, i.argc), i.spreads), keywords: Record<string, Value> = Object.create(null);
    const put = (name: string, value: Value): void => { if (Object.hasOwn(keywords, name)) this.fail(i, "type", `인수 '${name}'이(가) 중복 전달되었습니다.`); keywords[name] = value; };
    i.keywords.forEach((name, index) => { const value = raw[i.argc + index]; if (name) put(name, value); else { if (!isDict(value)) this.fail(i, "type", "** 뒤에는 딕셔너리가 필요합니다."); value.entries.forEach(entry => { if (typeof entry.key !== "string") this.fail(i, "type", "키워드 인수 이름은 문자열이어야 합니다."); put(entry.key, entry.value); }); } }); return { args, keywords };
  }
  private unpack(i: Instruction, value: Value, pattern: UnpackPattern): Value[] {
    if (pattern.kind === "leaf") return [value];
    if (pattern.kind === "star") return this.unpack(i, value, pattern.target);
    const items = [...this.items(i, value)], star = pattern.children.findIndex(child => child.kind === "star"), required = pattern.children.length - (star < 0 ? 0 : 1);
    if (star < 0 ? items.length !== required : items.length < required) this.fail(i, "value", "언패킹할 값의 개수가 맞지 않습니다.");
    const result: Value[] = [];
    pattern.children.forEach((child, index) => {
      const part: Value = index === star ? { kind: "list", items: items.slice(index, items.length - (pattern.children.length - index - 1)) } : items[index > star && star >= 0 ? items.length - (pattern.children.length - index) : index];
      result.push(...this.unpack(i, part, child));
    }); return result;
  }
  private iterator(i: Instruction, value: Value): IteratorValue | Extract<Value, { kind: "map" }> { if (isIterator(value) || isMap(value)) return value; if (isFile(value)) { if (value.closed) return this.fail(i, "value", "닫힌 파일은 사용할 수 없습니다."); if (value.mode !== "r") return this.fail(i, "type", "쓰기 모드로 연 파일에서는 읽을 수 없습니다."); return { kind: "iterator", values: this.fileLines(value), index: 0 }; } if (typeof value === "string") return { kind: "iterator", values: [...value], index: 0 }; if (isList(value) || isTuple(value) || isSet(value)) return { kind: "iterator", values: value.items, index: 0 }; if (isDict(value)) return { kind: "iterator", values: value.entries.map(entry => entry.key), index: 0 }; if (isRange(value)) return { kind: "iterator", values: this.rangeItems(i, value), index: 0 }; return this.fail(i, "type", "이 값은 반복할 수 없습니다."); }
  private rangeItems(i: Instruction, value: Extract<Value, { kind: "range" }>): Value[] { const values: Value[] = []; for (let number = value.start; value.step > 0 ? number < value.stop : number > value.stop; number += value.step) { if (values.length > MAX_ITERATIONS) this.fail(i, "runtime", "반복 횟수 제한을 초과했습니다."); values.push(number); } return values; }
  private next(i: Instruction, value: IteratorValue | Extract<Value, { kind: "map" }>): Value | undefined { if (isIterator(value)) { if (value.exhausted) return undefined; const item = value.pull ? value.pull() : value.values[value.index++]; if (item === undefined) value.exhausted = true; return item; } const args: Value[] = []; for (const source of value.sources) { const item = this.next(i, source); if (item === undefined) return undefined; args.push(item); } return this.callValueSync(i, value.fn, args); }
  private callFunction(i: Instruction, fn: FunctionValue, args: Value[], keywords: Record<string, Value>): void {
    if (this.frames.length >= MAX_CALL_DEPTH) throw new VMFailure({ line: i.line, column: i.column, category: "runtime", message: `함수 호출 깊이는 ${MAX_CALL_DEPTH}단계를 넘을 수 없습니다.` }, "RecursionError");
    const positional = fn.params.filter(p => !p.kind || p.kind === "positional"), varargs = fn.params.find(p => p.kind === "varargs"), varkw = fn.params.find(p => p.kind === "varkw");
    if (!varargs && args.length > positional.length) this.fail(i, "type", "위치 인수가 너무 많습니다.");
    const locals = new Map<string, Value>(), assigned = new Set<string>(), extras: { key: Value; value: Value }[] = [];
    args.slice(0, positional.length).forEach((value, index) => { locals.set(positional[index].name, value); assigned.add(positional[index].name); });
    if (varargs) locals.set(varargs.name, { kind: "tuple", items: args.slice(positional.length) });
    for (const [name, value] of Object.entries(keywords)) {
      const parameter = fn.params.find(p => p.name === name && p.kind !== "varargs" && p.kind !== "varkw");
      if (!parameter) { if (!varkw) this.fail(i, "type", `알 수 없는 키워드 인수 '${name}'입니다.`); extras.push({ key: name, value }); continue; }
      if (assigned.has(name)) this.fail(i, "type", `인수 '${name}'이(가) 중복 전달되었습니다.`); locals.set(name, value); assigned.add(name);
    }
    if (varkw) locals.set(varkw.name, { kind: "dict", entries: extras });
    let defaultIndex = 0;
    for (const parameter of fn.params) {
      if (parameter.kind === "varargs" || parameter.kind === "varkw") continue;
      if (parameter.hasDefault) { const value = fn.defaults[defaultIndex++]; if (!assigned.has(parameter.name)) locals.set(parameter.name, value); }
      else if (!assigned.has(parameter.name)) this.fail(i, "type", `필수 인수 '${parameter.name}'이(가) 없습니다.`);
    }
    this.frames.push(this.saveFrame({ functionName: fn.name })); this.activeFunctions.push(fn.name); this.bytecode = fn.bytecode; this.pc = 0; this.stack = []; this.env = locals;
    this.outerEnvs = fn.closure ?? []; this.globals = fn.globalEnv ?? this.globals; this.localNames = new Set(fn.localNames); this.globalNames = new Set(fn.globals); this.nonlocalNames = new Set(fn.nonlocals); this.currentFunction = fn; this.currentFile = fn.fileName;
  }
  private returnFromFunction(value: Value): void { const frame = this.frames.pop(); if (!frame) { this.stack.push(value); return; } this.clearBindings(this.frames.length + 1); this.restoreFrame(frame); if (frame.functionName !== undefined) this.activeFunctions.pop(); const pending = this.pendingInstances.at(-1); if (pending && this.frames.length === pending.depth) { this.pendingInstances.pop(); if (value !== null) this.fail(pending.instruction, "type", "__init__()은 값을 반환할 수 없습니다."); this.stack.push(pending.instance); return; } this.stack.push(value); }
  private callFunctionSync(i: Instruction, fn: FunctionValue, args: Value[]): Value { return this.callValueSync(i, fn, args); }
  private callValueSync(i: Instruction, callable: Value, args: Value[]): Value {
    const depth = this.frames.length; this.invoke(i, callable, args, {});
    while (this.frames.length > depth && !this.waiting && !this.stopped) {
      try {
        const instruction = this.bytecode.instructions[this.pc++];
        if (!instruction) { this.pc--; if (this.frames.at(-1)?.classValue) { this.finishClass(); continue; } if (this.frames.at(-1)?.moduleLoad) { this.finishModule(); continue; } this.systemFail(i, "함수 실행 상태를 복원할 수 없습니다."); }
        this.step(instruction);
      } catch (reason) {
        if (reason instanceof VMFailure && !reason.error.fileName && this.currentFile) reason.error.fileName = this.currentFile;
        if (reason instanceof VMFailure && reason.catchable && this.handle(reason)) { if (this.frames.length > depth) continue; throw new ResumeExecution(); }
        throw reason;
      }
    }
    if (this.stopped) throw new ResumeExecution();
    if (this.waiting) { this.waiting = false; this.fail(i, "runtime", "동기 콜백 안의 input()은 지원하지 않습니다."); }
    return this.pop(i);
  }
  private stringValue(i: Instruction, value: Value): string { if (typeof value === "string") return value; if (isException(value)) return value.message; if (isInstance(value)) { const method = classAttribute(value.classValue, "__str__"); if (method !== undefined) { if (!isFunction(method)) this.fail(i, "type", "__str__은 메서드여야 합니다."); const result = this.callFunctionSync(i, method, [value]); if (typeof result !== "string") this.fail(i, "type", "__str__()은 문자열을 반환해야 합니다."); return result; } } return printable(value); }
  private items(i:Instruction,v:Value):Value[]{if(isMap(v)||isIterator(v)){const values:Value[]=[];let value:Value|undefined;while((value=this.next(i,v))!==undefined){if(values.length>=MAX_COLLECTION_SIZE)this.systemFail(i,"컬렉션 크기 제한을 초과했습니다.");values.push(value);}return values;}if(typeof v==="string")return[...v];if(isList(v)||isTuple(v)||isSet(v))return v.items;if(isDict(v))return v.entries.map(e=>e.key);if(isRange(v))return this.rangeItems(i,v);this.fail(i,"type","이 값은 여러 개로 나눌 수 없습니다.");}
  private subscript(i: Instruction, object: Value, key: Value): Value {
    if (isSlice(key)) {
      if (typeof object !== "string" && !isList(object) && !isTuple(object)) this.fail(i, "type", "문자열·리스트·튜플만 슬라이스할 수 있습니다.");
      const values = this.items(i, object), indices = this.library(i, () => sliceIndices(values.length, key)), result = indices.map(index => values[index]);
      return typeof object === "string" ? result.join("") : { kind: isTuple(object) ? "tuple" : "list", items: result };
    }
    if (isDict(object)) { this.library(i, () => hashable(key)); const found = object.entries.find(entry => equal(entry.key, key)); if (!found) this.fail(i, "value", `딕셔너리에 ${repr(key)} 키가 없습니다.`); return found.value; }
    if (isSet(object)) this.fail(i, "type", "집합에는 인덱스를 사용할 수 없습니다.");
    if (typeof key !== "number" || !Number.isInteger(key)) this.fail(i, "type", "인덱스는 정수여야 합니다.");
    const values = this.items(i, object), index = key < 0 ? values.length + key : key;
    if (index < 0 || index >= values.length) this.fail(i, "value", `값에 ${key}번 위치의 값이 없습니다.`);
    return values[index];
  }
  private setSubscript(i:Instruction,o:Value,k:Value,v:Value):void{if(isList(o)){if(typeof k!=="number"||!Number.isInteger(k))this.fail(i,"type","인덱스는 정수여야 합니다.");const x=k<0?o.items.length+k:k;if(x<0||x>=o.items.length)this.fail(i,"value",`리스트에 ${k}번 위치의 값이 없습니다.`);o.items[x]=v;return;}if(isDict(o)){if(!keyOK(k))this.fail(i,"type","변경 가능한 값은 딕셔너리 키가 될 수 없습니다.");const found=o.entries.find(e=>equal(e.key,k));if(found)found.value=v;else o.entries.push({key:k,value:v});return;}this.fail(i,"type","이 값의 요소는 수정할 수 없습니다.");}
  private method(i:Extract<Instruction,{op:"call_method"}>,o:Value,n:string,a:Value[]):void{if(isFile(o)){if(n==="read"&&(a.length===0||a.length===1)){this.stack.push(this.fileRead(i,o,a[0]));return;}if(n==="readline"&&a.length===0){if(o.closed)this.fail(i,"value","닫힌 파일은 사용할 수 없습니다.");if(o.mode!=="r")this.fail(i,"type","쓰기 모드로 연 파일에서는 읽을 수 없습니다.");this.stack.push(this.fileLine(o));return;}if(n==="readlines"&&a.length===0){if(o.closed)this.fail(i,"value","닫힌 파일은 사용할 수 없습니다.");if(o.mode!=="r")this.fail(i,"type","쓰기 모드로 연 파일에서는 읽을 수 없습니다.");this.stack.push({kind:"list",items:this.fileLines(o)});return;}if(n==="write"&&a.length===1){this.stack.push(this.fileWrite(i,o,a[0]));return;}if(n==="close"&&a.length===0){this.close(o);this.stack.push(null);return;}this.fail(i,"name",`파일에서 '${n}' 메서드를 사용할 수 없습니다.`);}if(isList(o)){if(n==="append"&&a.length===1){o.items.push(a[0]);this.stack.push(null);return;}if(n==="pop"&&a.length<=1){if(!o.items.length)this.fail(i,"value","빈 리스트에서 pop할 수 없습니다.");const p=a.length?(typeof a[0]==="number"?a[0]:this.fail(i,"type","pop 인덱스는 정수여야 합니다.")):-1;this.stack.push(o.items.splice(p<0?o.items.length+p:p,1)[0]);return;}if(n==="remove"&&a.length===1){const x=o.items.findIndex(v=>equal(v,a[0]));if(x<0)this.fail(i,"value","리스트에 해당 값이 없습니다.");o.items.splice(x,1);this.stack.push(null);return;}}if(isDict(o)){if(n==="keys"&&a.length===0){this.stack.push({kind:"list",items:o.entries.map(e=>e.key)});return;}if(n==="values"&&a.length===0){this.stack.push({kind:"list",items:o.entries.map(e=>e.value)});return;}if(n==="items"&&a.length===0){this.stack.push({kind:"list",items:o.entries.map(e=>({kind:"tuple",items:[e.key,e.value]}))});return;}if(n==="get"&&(a.length===1||a.length===2)){this.stack.push(o.entries.find(e=>equal(e.key,a[0]))?.value??(a[1]??null));return;}}if(typeof o==="string"){if(n==="split"&&a.length<=1){const s=a[0];if(s!==undefined&&typeof s!=="string")this.fail(i,"type","split 구분자는 문자열이어야 합니다.");this.stack.push({kind:"list",items:s===undefined?o.trim().split(/\s+/).filter(Boolean):o.split(s)});return;}if(n==="strip"&&a.length===0){this.stack.push(o.trim());return;}if(n==="replace"&&a.length===2&&typeof a[0]==="string"&&typeof a[1]==="string"){this.stack.push(o.split(a[0]).join(a[1]));return;}}this.fail(i,"name",`'${n}' 메서드를 사용할 수 없습니다.`);}
  private binary(i: Extract<Instruction, { op: "binary" }>, left: Value, right: Value): Value {
    if (i.operator === "+" && typeof left === "string" && typeof right === "string") { if (left.length + right.length > MAX_OUTPUT) this.systemFail(i, "문자열 크기 제한을 초과했습니다."); return left + right; }
    if (i.operator === "+" && ((isList(left) && isList(right)) || (isTuple(left) && isTuple(right)))) { if (left.items.length + right.items.length > MAX_COLLECTION_SIZE) this.systemFail(i, "컬렉션 크기 제한을 초과했습니다."); return { kind: left.kind, items: [...left.items, ...right.items] }; }
    if (i.operator === "*") {
      let sequence = left, times = right; if (typeof left === "number" || typeof left === "boolean") { sequence = right; times = left; }
      if ((typeof sequence === "string" || isList(sequence) || isTuple(sequence)) && (typeof times === "number" || typeof times === "boolean") && Number.isInteger(Number(times))) {
        const amount = Math.max(0, Number(times)), length = typeof sequence === "string" ? sequence.length : sequence.items.length;
        if (length * amount > (typeof sequence === "string" ? MAX_OUTPUT : MAX_COLLECTION_SIZE)) this.systemFail(i, "값의 크기 제한을 초과했습니다.");
        return typeof sequence === "string" ? sequence.repeat(amount) : { kind: sequence.kind, items: Array.from({ length: amount }, () => sequence.items).flat() };
      }
    }
    if (!numeric(left) || !numeric(right)) return this.fail(i, "type", "이 연산에는 같은 종류의 값을 사용해야 합니다.");
    const a = numberValue(left), b = numberValue(right);
    if (["/", "//", "%"].includes(i.operator) && b === 0) this.fail(i, "value", "0으로 나눌 수 없습니다.");
    let result: number;
    switch (i.operator) { case "+": result = a + b; break; case "-": result = a - b; break; case "*": result = a * b; break; case "/": result = a / b; break; case "//": result = Math.floor(a / b); break; case "%": result = a - Math.floor(a / b) * b; break; case "**": if (a === 0 && b < 0) this.fail(i, "value", "0으로 나눌 수 없습니다."); if (a < 0 && !Number.isInteger(b)) this.fail(i, "value", "복소수는 지원하지 않습니다."); result = a ** b; break; default: return this.fail(i, "runtime", "지원하지 않는 연산입니다."); }
    return isFloat(left) || isFloat(right) || i.operator === "/" || (i.operator === "**" && b < 0) ? float(result) : result;
  }
  private compare(i: Extract<Instruction, { op: "compare" }>, operator: string, left: Value, right: Value): boolean { if (operator === "is" || operator === "is not") return operator === "is" ? left === right : left !== right; if (operator === "==") return equal(left, right); if (operator === "!=") return !equal(left, right); if (numeric(left) && numeric(right)) { left = numberValue(left); right = numberValue(right); } if (isDate(left) && isDate(right)) { left = left.year * 10000 + left.month * 100 + left.day; right = right.year * 10000 + right.month * 100 + right.day; } if ((typeof left !== "number" && typeof left !== "string") || (typeof right !== "number" && typeof right !== "string") || typeof left !== typeof right) this.fail(i, "type", "비교할 수 없는 값입니다."); const a = left as number | string, b = right as number | string; switch (operator) { case "<": return a < b; case "<=": return a <= b; case ">": return a > b; case ">=": return a >= b; default: return false; } }
  private invoke(i: Instruction, callable: Value, args: Value[], keywords: Record<string, Value>): void {
    if (typeof callable === "object" && callable?.kind === "error-type") {
      if (args.length > 1 || Object.keys(keywords).length) this.fail(i, "type", "오류 생성자에는 설명 하나만 전달할 수 있습니다.");
      this.stack.push({ kind: "exception", name: callable.name, message: args.length ? this.stringValue(i, args[0]) : "", line: i.line, column: i.column }); return;
    }
    if (isTurtleMethod(callable)) { this.stack.push(this.library(i, () => this.modules.turtleMethod(callable, args, keywords))); return; }
    if (isBoundMethod(callable)) { this.callFunction(i, callable.functionValue, [callable.instance, ...args], keywords); return; }
    if (isClass(callable)) { const instance: Extract<Value,{kind:"instance"}> = {kind:"instance",classValue:callable,attributes:new Map()}; const init=classAttribute(callable, "__init__"); if(init===undefined){if(args.length||Object.keys(keywords).length)this.fail(i,"type",`${callable.name}()은 인수를 받을 수 없습니다.`);this.stack.push(instance);return;} if(!isFunction(init))this.fail(i,"type","__init__은 메서드여야 합니다.");const depth=this.frames.length;this.pendingInstances.push({depth,instance,instruction:i});this.callFunction(i,init,[instance,...args],keywords);return; }
    if (isFunction(callable)) { this.callFunction(i, callable, args, keywords); return; }
    if (!isBuiltin(callable)) this.fail(i, "type", "이 값은 함수처럼 호출할 수 없습니다.");
    const name = callable.name;
    if (name === "dict") { if (args.length > 1) this.fail(i, "type", "dict()에는 반복 대상 하나만 전달할 수 있습니다."); const result: Extract<Value, { kind: "dict" }> = { kind: "dict", entries: [] }; this.library(i, () => dictMethod(result, "update", args, keywords, value => this.items(i, value))); this.stack.push(result); return; }
    if (name === "len" && args.length === 1 && (isIterator(args[0]) || isMap(args[0]) || isFile(args[0]))) this.fail(i, "type", "반복자에는 len()을 사용할 수 없습니다.");
    if (name === "float") {
      if (args.length > 1 || Object.keys(keywords).length) this.fail(i, "type", "float() 인수가 올바르지 않습니다."); const value = args.length ? args[0] : 0;
      if (numeric(value)) { this.stack.push(float(numberValue(value))); return; }
      if (typeof value !== "string") this.fail(i, "type", "실수로 변환할 수 없습니다."); const text = value.trim();
      if (/^[+-]?(inf(inity)?|nan)$/i.test(text)) { this.stack.push(float(/nan/i.test(text) ? NaN : text.startsWith("-") ? -Infinity : Infinity)); return; }
      if (!/^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(text)) this.fail(i, "value", "실수로 변환할 수 없습니다."); this.stack.push(float(Number(text))); return;
    }
    if (name === "int" && args.length === 1 && isFloat(args[0]) && !Object.keys(keywords).length) { if (!Number.isFinite(args[0].value)) this.fail(i, "value", "무한대 또는 NaN은 정수로 변환할 수 없습니다."); this.stack.push(Math.trunc(args[0].value)); return; }
    if (name === "sum") {
      if (args.length < 1 || args.length > 2 || Object.keys(keywords).length) this.fail(i, "type", "sum()에는 반복 대상과 선택적 시작값이 필요합니다."); let total: Value = args.length === 2 ? args[1] : 0;
      if (!numeric(total)) this.fail(i, "type", "시작값은 숫자여야 합니다."); for (const value of this.items(i, args[0])) { if (!numeric(value)) this.fail(i, "type", "sum()에는 숫자만 사용할 수 있습니다."); total = this.binary({ op: "binary", operator: "+", line: i.line, column: i.column }, total, value); } this.stack.push(total); return;
    }
    if (name === "min" || name === "max") { if (Object.keys(keywords).length) this.fail(i, "type", "이 함수는 키워드 인수를 지원하지 않습니다."); const values = args.length === 1 ? this.items(i, args[0]) : args; if (!values.length) this.fail(i, "value", "빈 값에서는 최솟값이나 최댓값을 구할 수 없습니다."); let best = values[0]; for (const value of values.slice(1)) { const cmp = this.order(i, value, best); if (name === "min" ? cmp < 0 : cmp > 0) best = value; } this.stack.push(best); return; }
    if (name === "super") { if (args.length || Object.keys(keywords).length) this.fail(i, "type", "현재 super()는 인수 없이 사용합니다."); const owner = this.currentFunction?.ownerClass, first = this.currentFunction?.params[0], instance = first ? this.env.get(first.name) : undefined; if (!owner || instance === undefined || !isInstance(instance) || !subclass(instance.classValue, owner)) this.fail(i, "runtime", "super()는 인스턴스 메서드 안에서 사용해야 합니다."); this.stack.push({ kind: "super", parent: owner.parent, instance }); return; }
    if (name === "isinstance" || name === "issubclass") { if (args.length !== 2 || Object.keys(keywords).length) this.fail(i, "type", `${name}()에는 두 인수가 필요합니다.`); if (!isClass(args[1])) this.fail(i, "type", "두 번째 인수는 클래스여야 합니다."); if (name === "issubclass" && !isClass(args[0])) this.fail(i, "type", "첫 번째 인수는 클래스여야 합니다."); this.stack.push(isInstance(args[0]) && name === "isinstance" ? subclass(args[0].classValue, args[1]) : isClass(args[0]) && name === "issubclass" ? subclass(args[0], args[1]) : false); return; }
    if (["enumerate", "zip", "reversed", "any", "all"].includes(name)) { this.iterableBuiltin(i, name, args, keywords); return; }
    if (SCALAR_BUILTINS.has(name)) { this.stack.push(this.library(i, () => scalarBuiltin(name, args, keywords))); return; }
    if (name === "sorted") { if (args.length !== 1) this.fail(i, "type", "sorted()에는 반복 대상 하나가 필요합니다."); this.startSort(i, { kind: "list", items: [...this.items(i, args[0])] }, keywords, false); return; }
    if (name === "set") { if (args.length > 1 || Object.keys(keywords).length) this.fail(i, "type", "set()에는 반복 대상 하나만 전달할 수 있습니다."); this.stack.push(this.library(i, () => makeSet(args.length ? this.items(i, args[0]) : []))); return; }
    if (name === "len" && args.length === 1 && isSet(args[0]) && !Object.keys(keywords).length) { this.stack.push(args[0].items.length); return; }
    if (name.startsWith("math.") || name.startsWith("random.") || name.startsWith("datetime.") || name.startsWith("turtle.")) { this.stack.push(this.library(i, () => this.modules.invoke(name, args, keywords))); return; }
    if (name === "open") { this.openFile(i, args, keywords); return; }
    const onlyNoKeywords = () => { if (Object.keys(keywords).length) this.fail(i, "type", "이 함수는 키워드 인수를 지원하지 않습니다."); };
    if (name === "input") { onlyNoKeywords(); if (args.length > 1) this.fail(i, "type", "input() 인수가 너무 많습니다."); if (args[0] !== undefined && typeof args[0] !== "string") this.fail(i, "type", "input()의 프롬프트는 문자열이어야 합니다."); this.waiting = true; this.notify({ type: "input", prompt: (args[0] as string | undefined) ?? "" }); return; }
    if (name === "print") { const allowed = new Set(["sep", "end"]); if (Object.keys(keywords).some(key => !allowed.has(key))) this.fail(i, "type", "print()에 지원하지 않는 키워드 인수가 있습니다."); const sep = keywords.sep === undefined ? " " : keywords.sep, end = keywords.end === undefined ? "\n" : keywords.end; if (typeof sep !== "string" || typeof end !== "string") this.fail(i, "type", "sep와 end는 문자열이어야 합니다."); const text = args.map(value=>this.stringValue(i,value)).join(sep) + end; if (this.outputSize + text.length > MAX_OUTPUT) this.systemFail(i, "출력량 제한을 초과했습니다."); this.outputSize += text.length; this.notify({ type: "output", text }); this.stack.push(null); return; }
    if (name === "range") { onlyNoKeywords(); if (args.length < 1 || args.length > 3 || args.some(value => typeof value !== "number" || !Number.isInteger(value))) this.fail(i, "type", "range()에는 정수 인수 1~3개가 필요합니다."); const [first, second, third] = args as number[]; const start = args.length === 1 ? 0 : first, stop = args.length === 1 ? first : second, step = args.length === 3 ? third : 1; if (step === 0) this.fail(i, "value", "range()의 간격은 0이 될 수 없습니다."); this.stack.push({ kind: "range", start, stop, step }); return; }
    if (name === "map") { onlyNoKeywords(); if (args.length < 2) this.fail(i, "type", "map()은 함수와 반복 가능한 값이 필요합니다."); if (!isBuiltin(args[0]) && !isFunction(args[0])) this.fail(i, "type", "map()의 첫 번째 인수는 호출할 수 있어야 합니다."); this.stack.push({ kind: "map", fn: args[0], sources: args.slice(1).map(value => this.iterator(i, value)) }); return; }
    if (["len","list","tuple","dict","sum","min","max"].includes(name)) { onlyNoKeywords(); if(name==="list"&&args.length===0){this.stack.push({kind:"list",items:[]});return;}if(name==="tuple"&&args.length===0){this.stack.push({kind:"tuple",items:[]});return;}if(name==="dict"&&args.length===0){this.stack.push({kind:"dict",entries:[]});return;}if(name==="min"||name==="max"){const values=args.length===1?this.items(i,args[0]):args;if(!values.length)this.fail(i,"value",`빈 값에서는 ${name==="min"?"최솟값":"최댓값"}을 구할 수 없습니다.`);if(!values.every(v=>typeof v==="number"||typeof v==="string"))this.fail(i,"type","서로 비교할 수 없는 값입니다.");this.stack.push(values.reduce((a,b)=>name==="min"?(a as string|number)<(b as string|number)?a:b:(a as string|number)>(b as string|number)?a:b));return;}if(name==="sum"){if(args.length<1||args.length>2)this.fail(i,"type","sum()은 인수 1~2개가 필요합니다.");const values=this.items(i,args[0]);if(!values.every(v=>typeof v==="number"||typeof v==="boolean"))this.fail(i,"type","sum()에는 숫자만 사용할 수 있습니다."); const start = args[1] === undefined ? 0 : typeof args[1] === "number" || typeof args[1] === "boolean" ? Number(args[1]) : this.fail(i,"type","시작값은 숫자여야 합니다."); this.stack.push(values.reduce<number>((a,b)=>a+Number(b),start));return;}if(args.length!==1)this.fail(i,"type",`${name}()은 인수 1개가 필요합니다.`);const v=args[0];if(name==="len"){this.stack.push(this.items(i,v).length);return;}if(name==="list"){this.stack.push({kind:"list",items:this.items(i,v).slice()});return;}if(name==="tuple"){this.stack.push({kind:"tuple",items:this.items(i,v).slice()});return;}if(name==="dict"){if(isDict(v)){this.stack.push({kind:"dict",entries:v.entries.slice()});return;}const entries:{key:Value;value:Value}[]=[];for(const pair of this.items(i,v)){const p=this.items(i,pair);if(p.length!==2||!keyOK(p[0]))this.fail(i,"type","dict() 항목은 키와 값 두 개여야 합니다.");entries.push({key:p[0],value:p[1]});}this.stack.push({kind:"dict",entries});return;}}
    onlyNoKeywords(); if (name === "bool" && args.length === 0) { this.stack.push(false); return; } if (args.length !== 1) this.fail(i, "type", `${name}()은(는) 인수 하나가 필요합니다.`); const value = args[0];
    if (name === "int") { if (typeof value === "number") { this.stack.push(Math.trunc(value)); return; } if (typeof value === "boolean") { this.stack.push(value ? 1 : 0); return; } if (typeof value !== "string") this.fail(i, "type", "정수로 변환할 수 없습니다."); const number = Number(value.trim()); if (!Number.isFinite(number) || !Number.isInteger(number)) this.fail(i, "value", "정수로 변환할 수 없습니다."); this.stack.push(number); return; }
    if (name === "float") { if (typeof value === "boolean") { this.stack.push(value ? 1 : 0); return; } if (typeof value !== "number" && typeof value !== "string") this.fail(i, "type", "실수로 변환할 수 없습니다."); const number = Number(value); if (!Number.isFinite(number)) this.fail(i, "value", "실수로 변환할 수 없습니다."); this.stack.push(number); return; }
    if (name === "str") { this.stack.push(this.stringValue(i,value)); return; } if (name === "bool") { this.stack.push(truthy(value)); return; } if (name === "type") { this.stack.push(`<class '${typeName(value)}'>`); return; } this.fail(i, "name", `'${name}' 함수가 정의되지 않았습니다.`);
  }
}
class ResumeExecution {}
class VMFailure { constructor(readonly error: StudentError, readonly type: string, readonly catchable = true) { error.pythonType = type; } }
import { float, isFloat, numeric, numberValue } from "./numbers-v2";
