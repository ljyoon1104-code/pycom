import { isList, isRange, isTuple, type DateValue, type ModuleValue, type TurtleMethodValue, type TurtleValue, type Value } from "./value";
import { TurtleRuntime, type TurtleGraphicsCommand } from "./turtle";

export interface ModuleOptions { clock?: () => Date; entropy?: () => number; emitGraphics?: (command: TurtleGraphicsCommand) => void; maxGraphicsCommands?: number; }
export class ModuleError extends Error {
  constructor(readonly pythonType: "ImportError" | "AttributeError" | "TypeError" | "ValueError" | "IndexError", message: string) { super(message); }
}
const invalid = (type: ModuleError["pythonType"], message: string): never => { throw new ModuleError(type, message); };
const integer = (value: Value, label: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return invalid("TypeError", `${label}에는 안전한 범위의 정수가 필요합니다.`);
  return value;
};
const entropy = (): number => {
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  return (Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0;
};

/** An allowlisted, in-memory library registry. Never resolves paths or loads scripts. */
export class BuiltinModules {
  private state: number;
  private readonly modules = new Map<string, ModuleValue>();
  private readonly today = { kind: "builtin", name: "datetime.date.today" } as const;
  private readonly turtle: TurtleRuntime;
  constructor(private readonly options: ModuleOptions = {}) {
    this.state = (options.entropy ?? entropy)() >>> 0;
    this.modules.set("random", { kind: "module", name: "random", attributes: new Map(
      ["seed", "randint", "randrange", "choice", "sample"].map(name => [name, { kind: "builtin", name: `random.${name}` } as Value]),
    ) });
    this.modules.set("datetime", { kind: "module", name: "datetime", attributes: new Map([["date", { kind: "builtin", name: "datetime.date" }]]) });
    this.turtle = new TurtleRuntime(options.emitGraphics ?? (() => {}), options.maxGraphicsCommands);
    const done = { kind: "builtin", name: "turtle.done" } as const;
    this.modules.set("turtle", { kind: "module", name: "turtle", attributes: new Map([
      ["Turtle", { kind: "builtin", name: "turtle.Turtle" }], ["done", done], ["mainloop", done], ["bgcolor", { kind: "builtin", name: "turtle.bgcolor" }],
    ]) });
  }
  load(module: string, member?: string): Value {
    const value = this.modules.get(module);
    if (!value) return invalid("ImportError", `'${module}' 모듈은 현재 버전에서 지원하지 않습니다.`);
    if (member === undefined) return value;
    if (module === "datetime" && member === "date") return value.attributes.get(member)!;
    return invalid("ImportError", `'${module}'에서 '${member}' 가져오기는 지원하지 않습니다.`);
  }
  dateAttribute(name: string): Value {
    if (name === "today") return this.today;
    return invalid("AttributeError", `date에 '${name}' 속성이 없습니다.`);
  }
  turtleAttribute(turtle: TurtleValue, name: string): TurtleMethodValue { return this.turtle.methodValue(turtle, name); }
  turtleMethod(method: TurtleMethodValue, args: Value[], keywords: Record<string, Value>): Value { return this.turtle.invokeMethod(method, args, keywords); }
  // Mulberry32: repeatable within this app, not CPython's seed-to-output sequence.
  private next(): number {
    this.state = (this.state + 0x6D2B79F5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 0x100000000;
  }
  private below(count: number): number {
    if (!Number.isSafeInteger(count) || count <= 0) return invalid("ValueError", "난수 범위가 비어 있거나 너무 큽니다.");
    // Rejection sampling avoids modulo bias, including ranges larger than 2^32.
    const size = count <= 0x100000000 ? 0x100000000 : 0x20000000000000;
    const limit = size - size % count;
    let value: number;
    do { value = size === 0x100000000 ? Math.floor(this.next() * size) : Math.floor(this.next() * 0x200000) * 0x100000000 + Math.floor(this.next() * 0x100000000); } while (value >= limit);
    return value % count;
  }
  private sequence(value: Value): { length: number; at: (index: number) => Value } {
    if (typeof value === "string") { const chars = [...value]; return { length: chars.length, at: index => chars[index] }; }
    if (isList(value) || isTuple(value)) return { length: value.items.length, at: index => value.items[index] };
    if (isRange(value)) {
      const length = Math.max(0, Math.ceil((value.stop - value.start) / value.step));
      if (!Number.isSafeInteger(length)) return invalid("ValueError", "반복 대상의 범위가 너무 큽니다.");
      return { length, at: index => value.start + index * value.step };
    }
    return invalid("TypeError", "문자열, 리스트, 튜플 또는 range가 필요합니다.");
  }
  private date(args: Value[]): DateValue {
    const [year, month, day] = args.map(value => integer(value, "날짜"));
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return invalid("ValueError", "존재하지 않는 날짜입니다.");
    return Object.freeze({ kind: "date", year, month, day });
  }
  invoke(name: string, args: Value[], keywords: Record<string, Value>): Value {
    // Keywords use the same argument binding rules as ordinary calls; unknown or
    // duplicate names are errors, never silently discarded.
    const signatures: Record<string, string[]> = {
      "random.seed": ["a"], "random.randint": ["a", "b"], "random.choice": ["seq"], "random.sample": ["population", "k"],
      "datetime.date": ["year", "month", "day"], "datetime.date.today": [],
    };
    if (name === "turtle.Turtle") return this.turtle.create(args, keywords);
    if (name === "turtle.done") return this.turtle.finish(args, keywords);
    if (name === "turtle.bgcolor") return this.turtle.background(args, keywords);
    if (name === "random.randrange") {
      if (Object.keys(keywords).length) return invalid("TypeError", "randrange()에는 위치 인수를 사용해 주세요.");
    } else {
      const params = signatures[name];
      if (!params) return invalid("AttributeError", "지원하지 않는 내장 함수입니다.");
      args = args.slice();
      for (const [key, value] of Object.entries(keywords)) {
        const index = params.indexOf(key);
        if (index < 0) return invalid("TypeError", `알 수 없는 키워드 인수 '${key}'입니다.`);
        if (index < args.length && args[index] !== undefined) return invalid("TypeError", `인수 '${key}'이(가) 중복 전달되었습니다.`);
        args[index] = value;
      }
      if (args.length > params.length || (name !== "random.seed" && params.some((_, index) => args[index] === undefined))) return invalid("TypeError", `${name}() 인수 개수를 확인해 주세요.`);
    }
    if (name === "random.seed") {
      const value = args[0];
      if (value === undefined || value === null) this.state = (this.options.entropy ?? entropy)() >>> 0;
      else if (typeof value === "number" && Number.isSafeInteger(value)) {
        // Hash every digit so high bits do not disappear when seeding.
        this.state = this.hash(String(value));
      } else if (typeof value === "string") this.state = this.hash(value);
      else return invalid("TypeError", "seed()에는 정수, 문자열 또는 None을 사용해 주세요.");
      return null;
    }
    if (name === "random.randint") {
      const start = integer(args[0], "randint()"), stop = integer(args[1], "randint()");
      return start + this.below(stop - start + 1);
    }
    if (name === "random.randrange") {
      if (args.length < 1 || args.length > 3) return invalid("TypeError", "randrange()에는 정수 인수 1~3개가 필요합니다.");
      const values = args.map(value => integer(value, "randrange()"));
      const start = values.length === 1 ? 0 : values[0], stop = values.length === 1 ? values[0] : values[1], step = values[2] ?? 1;
      if (!step) return invalid("ValueError", "randrange()의 간격은 0이 될 수 없습니다.");
      return start + this.below(Math.ceil((stop - start) / step)) * step;
    }
    if (name === "random.choice" || name === "random.sample") {
      const sequence = this.sequence(args[0]);
      if (name === "random.choice") {
        if (!sequence.length) return invalid("IndexError", "빈 값에서는 선택할 수 없습니다.");
        return sequence.at(this.below(sequence.length));
      }
      const count = integer(args[1], "sample() 개수");
      if (count < 0 || count > sequence.length) return invalid("ValueError", "표본 개수는 0부터 원본 길이까지여야 합니다.");
      if (count > 10000) return invalid("ValueError", "한 번에 선택할 수 있는 표본은 10000개까지입니다.");
      const swaps = new Map<number, number>(), items: Value[] = [];
      for (let index = 0; index < count; index++) {
        const remaining = sequence.length - index, picked = this.below(remaining);
        items.push(sequence.at(swaps.get(picked) ?? picked));
        swaps.set(picked, swaps.get(remaining - 1) ?? remaining - 1);
      }
      return { kind: "list", items };
    }
    if (name === "datetime.date") return this.date(args);
    const now = (this.options.clock ?? (() => new Date()))();
    return this.date([now.getFullYear(), now.getMonth() + 1, now.getDate()]);
  }
  private hash(text: string): number {
    let value = 2166136261;
    for (const char of text) value = Math.imul(value ^ char.codePointAt(0)!, 16777619);
    return value >>> 0;
  }
}
