import type { TurtleGraphicsCommand } from "../runtime/turtle";

type TurtleMarker = Extract<TurtleGraphicsCommand, { type: "move" }>;

/** Replays Worker commands on the main-thread canvas and preserves them on resize. */
export class TurtleCanvasRenderer {
  private commands: TurtleGraphicsCommand[] = [];
  private resizeObserver: ResizeObserver;
  constructor(private readonly canvas: HTMLCanvasElement) {
    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(canvas);
  }
  reset(): void { this.commands = [{ type: "reset" }]; this.render(); }
  apply(commands: TurtleGraphicsCommand[]): void { this.commands.push(...commands); this.render(); }
  private render(): void {
    const box = this.canvas.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    const ratio = Math.max(1, window.devicePixelRatio || 1), width = Math.round(box.width * ratio), height = Math.round(box.height * ratio);
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    const context = this.canvas.getContext("2d"); if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    let background = "#f4f8ff";
    let lines: Extract<TurtleGraphicsCommand, { type: "line" }>[] = [];
    const turtles = new Map<number, TurtleMarker>();
    for (const command of this.commands) {
      if (command.type === "reset") { background = "#f4f8ff"; lines = []; turtles.clear(); }
      else if (command.type === "background") background = command.color;
      else if (command.type === "line") { lines.push(command); if (lines.length > 2_500) lines.shift(); }
      else if (command.type === "clear") lines = lines.filter(line => line.turtleId !== command.turtleId);
      else if (command.type === "move") turtles.set(command.turtleId, command);
    }
    context.clearRect(0, 0, box.width, box.height);
    context.fillStyle = background; context.fillRect(0, 0, box.width, box.height);
    const project = (x: number, y: number) => ({ x: box.width / 2 + x, y: box.height / 2 - y });
    for (const line of lines) {
      const from = project(line.fromX, line.fromY), to = project(line.toX, line.toY);
      context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y); context.strokeStyle = line.color; context.lineWidth = line.width; context.lineCap = "round"; context.stroke();
    }
    for (const turtle of turtles.values()) {
      if (!turtle.visible) continue;
      const point = project(turtle.x, turtle.y);
      context.save(); context.translate(point.x, point.y); context.rotate(-turtle.heading * Math.PI / 180);
      context.beginPath(); context.moveTo(11, 0); context.lineTo(-8, -7); context.lineTo(-4, 0); context.lineTo(-8, 7); context.closePath(); context.fillStyle = "#1663a7"; context.fill(); context.strokeStyle = "#0d355d"; context.lineWidth = 1; context.stroke(); context.restore();
    }
  }
}
