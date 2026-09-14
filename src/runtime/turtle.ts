import { type TurtleMethodValue, type TurtleValue, type TupleValue, type Value } from "./value";
import { numeric, numberValue } from "./numbers-v2";

export type TurtleGraphicsCommand =
  | { type: "reset" }
  | { type: "line"; turtleId: number; fromX: number; fromY: number; toX: number; toY: number; color: string; width: number }
  | { type: "move"; turtleId: number; x: number; y: number; heading: number; visible: boolean }
  | { type: "clear"; turtleId: number }
  | { type: "background"; color: string }
  | { type: "finish" };

export class TurtleError extends Error {
  constructor(readonly pythonType: "AttributeError" | "TypeError" | "ValueError", message: string) { super(message); }
}
export class GraphicsLimitError extends Error {
  constructor() { super("그래픽 명령 제한을 초과했습니다."); }
}

const COLORS = new Set(["black", "white", "red", "green", "blue", "yellow", "orange", "purple", "pink", "gray", "brown"]);
const aliases: Record<string, string> = {
  fd: "forward", back: "backward", bk: "backward", rt: "right", lt: "left", up: "penup", pu: "penup", down: "pendown", pd: "pendown", setpos: "goto", setposition: "goto", seth: "setheading", pos: "position", width: "pensize",
};

const typeError = (message: string): never => { throw new TurtleError("TypeError", message); };
const valueError = (message: string): never => { throw new TurtleError("ValueError", message); };
const number = (value: Value, label: string): number => {
  if (!numeric(value) || !Number.isFinite(numberValue(value))) throw new TurtleError("TypeError", `${label}에는 숫자가 필요합니다.`);
  return numberValue(value);
};
const normalizeHeading = (heading: number) => ((heading % 360) + 360) % 360;
const cleanCoordinate = (value: number) => { const rounded = Math.round(value); return Math.abs(value - rounded) < 1e-12 ? rounded : value; };
const color = (value: Value): string => {
  if (typeof value !== "string") throw new TurtleError("TypeError", "색상에는 문자열이 필요합니다.");
  const normalized = value.trim().toLowerCase();
  if (COLORS.has(normalized) || /^#[0-9a-f]{6}$/i.test(normalized)) return normalized;
  throw new TurtleError("ValueError", `'${value}' 색상은 현재 지원하지 않습니다.`);
};
const tuple = (items: Value[]): TupleValue => ({ kind: "tuple", items });

/**
 * Pure turtle state machine. It has no Worker, DOM, or Canvas dependency;
 * callers only receive JSON-safe drawing commands.
 */
export class TurtleRuntime {
  private nextId = 1;
  private commands = 0;
  constructor(private readonly emit: (command: TurtleGraphicsCommand) => void, private readonly maxCommands = 5_000) {}

  private command(command: TurtleGraphicsCommand): void {
    if (++this.commands > this.maxCommands) throw new GraphicsLimitError();
    this.emit(command);
  }
  private moved(turtle: TurtleValue): void {
    this.command({ type: "move", turtleId: turtle.id, x: turtle.x, y: turtle.y, heading: turtle.heading, visible: turtle.visible });
  }
  private movedTo(turtle: TurtleValue, x: number, y: number): void {
    const fromX = turtle.x, fromY = turtle.y;
    turtle.x = cleanCoordinate(x); turtle.y = cleanCoordinate(y);
    if (turtle.penDown) this.command({ type: "line", turtleId: turtle.id, fromX, fromY, toX: x, toY: y, color: turtle.color, width: turtle.width });
    this.moved(turtle);
  }
  create(args: Value[], keywords: Record<string, Value>): TurtleValue {
    if (args.length || Object.keys(keywords).length) typeError("Turtle()은 인수를 받지 않습니다.");
    const turtle: TurtleValue = { kind: "turtle", id: this.nextId++, x: 0, y: 0, heading: 0, penDown: true, color: "black", fillColor: "black", width: 1, visible: true, speed: 3 };
    this.moved(turtle);
    return turtle;
  }
  methodValue(turtle: TurtleValue, name: string): TurtleMethodValue {
    const canonical = aliases[name] ?? name;
    if (!new Set(["forward", "backward", "right", "left", "penup", "pendown", "goto", "home", "setheading", "position", "xcor", "ycor", "heading", "pensize", "pencolor", "color", "clear", "reset", "hideturtle", "showturtle", "speed"]).has(canonical)) throw new TurtleError("AttributeError", `거북이에 '${name}' 메서드가 없습니다.`);
    return { kind: "turtle-method", turtle, name: canonical };
  }
  invokeMethod(method: TurtleMethodValue, args: Value[], keywords: Record<string, Value>): Value {
    if (Object.keys(keywords).length) typeError("거북이 메서드는 키워드 인수를 지원하지 않습니다.");
    const turtle = method.turtle, name = method.name;
    const exactly = (count: number) => { if (args.length !== count) typeError(`${name}()은 인수 ${count}개가 필요합니다.`); };
    const distance = () => number(args[0], "이동 거리");
    if (name === "forward" || name === "backward") {
      exactly(1); const amount = name === "forward" ? distance() : -distance(); const radians = turtle.heading * Math.PI / 180;
      this.movedTo(turtle, turtle.x + Math.cos(radians) * amount, turtle.y + Math.sin(radians) * amount); return null;
    }
    if (name === "right" || name === "left") { exactly(1); turtle.heading = normalizeHeading(turtle.heading + (name === "left" ? 1 : -1) * number(args[0], "회전 각도")); this.moved(turtle); return null; }
    if (name === "penup" || name === "pendown") { exactly(0); turtle.penDown = name === "pendown"; return null; }
    if (name === "goto") { exactly(2); this.movedTo(turtle, number(args[0], "x 좌표"), number(args[1], "y 좌표")); return null; }
    if (name === "home") { exactly(0); turtle.heading = 0; this.movedTo(turtle, 0, 0); return null; }
    if (name === "setheading") { exactly(1); turtle.heading = normalizeHeading(number(args[0], "방향")); this.moved(turtle); return null; }
    if (name === "position") { exactly(0); return tuple([turtle.x, turtle.y]); }
    if (name === "xcor" || name === "ycor" || name === "heading") { exactly(0); return name === "xcor" ? turtle.x : name === "ycor" ? turtle.y : turtle.heading; }
    if (name === "pensize") { if (args.length === 0) return turtle.width; exactly(1); const width = number(args[0], "펜 굵기"); if (width <= 0) valueError("펜 굵기는 0보다 커야 합니다."); turtle.width = width; return null; }
    if (name === "pencolor") { if (args.length === 0) return turtle.color; exactly(1); turtle.color = color(args[0]); return null; }
    if (name === "color") { if (args.length < 1 || args.length > 2) typeError("color()에는 색상 1개 또는 2개가 필요합니다."); turtle.color = color(args[0]); turtle.fillColor = color(args[1] ?? args[0]); return null; }
    if (name === "clear") { exactly(0); this.command({ type: "clear", turtleId: turtle.id }); return null; }
    if (name === "reset") { exactly(0); this.command({ type: "clear", turtleId: turtle.id }); turtle.x = 0; turtle.y = 0; turtle.heading = 0; turtle.penDown = true; turtle.color = "black"; turtle.fillColor = "black"; turtle.width = 1; turtle.visible = true; turtle.speed = 3; this.moved(turtle); return null; }
    if (name === "hideturtle" || name === "showturtle") { exactly(0); turtle.visible = name === "showturtle"; this.moved(turtle); return null; }
    if (name === "speed") { if (args.length === 0) return turtle.speed; exactly(1); const speed = number(args[0], "속도"); if (!Number.isInteger(speed) || speed < 0 || speed > 10) valueError("속도는 0부터 10 사이의 정수여야 합니다."); turtle.speed = speed; return null; }
    throw new TurtleError("AttributeError", `거북이에 '${name}' 메서드가 없습니다.`);
  }
  finish(args: Value[], keywords: Record<string, Value>): null {
    if (args.length || Object.keys(keywords).length) typeError("done()은 인수를 받지 않습니다.");
    this.command({ type: "finish" }); return null;
  }
  background(args: Value[], keywords: Record<string, Value>): null {
    if (Object.keys(keywords).length || args.length !== 1) typeError("bgcolor()에는 색상 인수 1개가 필요합니다.");
    this.command({ type: "background", color: color(args[0]) }); return null;
  }
}
