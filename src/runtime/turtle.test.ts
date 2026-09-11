import { describe, expect, it } from "vitest";
import { compile } from "../compiler/compiler";
import { VM, type VMEvent, type VMOptions } from "./vm";
import type { TurtleGraphicsCommand } from "./turtle";

function run(code: string, options: VMOptions = {}) {
  const events: VMEvent[] = [];
  const vm = new VM(compile(code), event => events.push(event), new Map(), options);
  vm.execute();
  return { events, vm, output: events.filter((event): event is Extract<VMEvent, { type: "output" }> => event.type === "output").map(event => event.text).join(""), commands: events.filter((event): event is Extract<VMEvent, { type: "graphics" }> => event.type === "graphics").flatMap(event => event.commands) };
}
const lines = (commands: TurtleGraphicsCommand[]) => commands.filter((command): command is Extract<TurtleGraphicsCommand, { type: "line" }> => command.type === "line");
const moves = (commands: TurtleGraphicsCommand[]) => commands.filter((command): command is Extract<TurtleGraphicsCommand, { type: "move" }> => command.type === "move");
const failure = (code: string) => run(code).events.at(-1);

describe("교육용 turtle", () => {
  it("turtle 모듈과 Turtle 객체를 가져온다", () => {
    const result = run("import turtle\nt = turtle.Turtle()\nprint(type(t))");
    expect(result.output).toBe("<class 'Turtle'>\n"); expect(moves(result.commands)).toHaveLength(1);
  });
  it("교과서 정사각형의 네 선분과 원점·방향 복귀를 기록한다", () => {
    const result = run("import turtle\nt = turtle.Turtle()\nfor i in range(4):\n    t.forward(100)\n    t.right(90)\nturtle.done()\nprint('정사각형 완성')");
    const segments = lines(result.commands), last = moves(result.commands).at(-1)!;
    expect(segments).toHaveLength(4); expect(last.x).toBeCloseTo(0); expect(last.y).toBeCloseTo(0); expect(last.heading).toBe(0); expect(result.commands.at(-1)).toMatchObject({ type: "finish" }); expect(result.output).toBe("정사각형 완성\n");
  });
  it("right와 left를 수학 좌표 방향으로 계산한다", () => {
    const result = run("import turtle\nt=turtle.Turtle()\nt.left(90)\nt.forward(10)\nt.right(180)\nt.forward(5)");
    const segment = lines(result.commands).at(-1)!; expect(segment.toX).toBeCloseTo(0); expect(segment.toY).toBeCloseTo(5);
  });
  it("forward와 backward가 같은 상태를 갱신한다", () => {
    const result = run("import turtle\nt=turtle.Turtle()\nt.forward(30)\nt.backward(10)\nprint(t.xcor(), t.ycor())");
    expect(result.output).toBe("20 0\n"); expect(lines(result.commands)).toHaveLength(2);
  });
  it("펜을 내린 이동만 선분을 만든다", () => {
    const result = run("import turtle\nt=turtle.Turtle()\nt.forward(10)\nt.penup()\nt.goto(50, 50)\nt.pendown()\nt.forward(10)");
    expect(lines(result.commands)).toHaveLength(2); expect(lines(result.commands)[1]).toMatchObject({ fromX: 50, fromY: 50 });
  });
  it("goto와 setposition 별칭이 좌표를 바꾼다", () => expect(run("import turtle\nt=turtle.Turtle()\nt.goto(10, 20)\nt.setposition(-3, 4)\nprint(t.pos())").output).toBe("(-3, 4)\n"));
  it("home은 방향을 0도로 돌리고 원점으로 이동한다", () => expect(run("import turtle\nt=turtle.Turtle()\nt.forward(10)\nt.left(30)\nt.home()\nprint(t.position(), t.heading())").output).toBe("(0, 0) 0\n"));
  it("setheading과 위치·방향 조회를 지원한다", () => expect(run("import turtle\nt=turtle.Turtle()\nt.setheading(450)\nt.forward(8)\nprint(t.xcor(), t.ycor(), t.heading())").output).toBe("0 8 90\n"));
  it("pensize와 width 별칭은 선분 굵기를 보존한다", () => {
    const result = run("import turtle\nt=turtle.Turtle()\nt.width(3)\nt.forward(10)\nprint(t.pensize())");
    expect(result.output).toBe("3\n"); expect(lines(result.commands)[0].width).toBe(3);
  });
  it("pencolor와 color는 안전한 색상을 적용한다", () => {
    const result = run("import turtle\nt=turtle.Turtle()\nt.pencolor('red')\nt.forward(4)\nt.color('#0000ff')\nt.forward(4)\nprint(t.pencolor())");
    expect(lines(result.commands).map(line => line.color)).toEqual(["red", "#0000ff"]); expect(result.output).toBe("#0000ff\n");
  });
  it("각 거북이는 독립된 펜 상태를 가진다", () => {
    const result = run("import turtle\na=turtle.Turtle()\nb=turtle.Turtle()\na.pencolor('red')\nb.pencolor('blue')\na.forward(10)\nb.left(90)\nb.forward(10)");
    expect(lines(result.commands).map(line => line.color)).toEqual(["red", "blue"]);
  });
  it("변수 복사는 같은 거북이 객체를 참조한다", () => {
    const result = run("import turtle\na=turtle.Turtle()\nb=a\nb.forward(50)\na.right(90)\na.forward(50)\nprint(a.position(), b.heading())");
    expect(result.output).toBe("(50, -50) 270\n"); expect(new Set(lines(result.commands).map(line => line.turtleId)).size).toBe(1);
  });
  it("clear는 그림만, reset은 그림과 상태를 초기화한다", () => {
    const result = run("import turtle\nt=turtle.Turtle()\nt.forward(10)\nt.clear()\nt.forward(5)\nt.reset()\nprint(t.position(), t.heading(), t.pencolor(), t.pensize())");
    expect(result.commands.filter(command => command.type === "clear")).toHaveLength(2); expect(result.output).toBe("(0, 0) 0 black 1\n");
  });
  it("hideturtle와 showturtle은 move 명령에 표시 상태를 담는다", () => {
    const result = run("import turtle\nt=turtle.Turtle()\nt.hideturtle()\nt.showturtle()");
    expect(moves(result.commands).slice(-2).map(move => move.visible)).toEqual([false, true]);
  });
  it("speed는 검증해 저장하고 지연시키지 않는다", () => expect(run("import turtle\nt=turtle.Turtle()\nt.speed(10)\nprint(t.speed())").output).toBe("10\n"));
  it("done과 mainloop는 finish를 보내고 실행을 막지 않는다", () => {
    const result = run("import turtle\nt=turtle.Turtle()\nturtle.done()\nturtle.mainloop()\nprint('계속')");
    expect(result.commands.filter(command => command.type === "finish")).toHaveLength(2); expect(result.output).toBe("계속\n");
  });
  it("bgcolor는 캔버스 배경 명령을 보낸다", () => expect(run("import turtle\nturtle.bgcolor('yellow')").commands).toContainEqual({ type: "background", color: "yellow" }));
  it("메서드를 변수에 저장해 호출해도 같은 거북이를 사용한다", () => expect(run("import turtle\nt=turtle.Turtle()\nmove=t.forward\nmove(12)\nprint(t.xcor())").output).toBe("12\n"));
  it("print와 input 대기·재개 중에도 그래픽 명령을 유지한다", () => {
    const events: VMEvent[] = [], vm = new VM(compile("import turtle\nt=turtle.Turtle()\nt.forward(10)\nname=input('이름: ')\nprint(name)"), event => events.push(event));
    vm.execute(); expect(events.at(-1)).toMatchObject({ type: "input", prompt: "이름: " }); vm.resume("민수");
    expect(events.filter(event => event.type === "graphics").flatMap(event => event.type === "graphics" ? event.commands : [])).toContainEqual(expect.objectContaining({ type: "line" })); expect(events.filter(event => event.type === "output").map(event => event.type === "output" ? event.text : "").join("")).toBe("민수\n");
  });
  it.each([
    ["t.forward('백')", "TypeError"], ["t.goto(10)", "TypeError"], ["t.pensize(0)", "ValueError"], ["t.pencolor('지원하지 않는 색상')", "ValueError"],
  ])("%s는 호출 줄의 한국어 오류가 된다", (statement, type) => {
    const result = failure(`import turtle\nt=turtle.Turtle()\n${statement}`);
    expect(result).toMatchObject({ type: "error", error: { line: 3 } }); expect((result as Extract<VMEvent, { type: "error" }>).error.message).toMatch(/[가-힣]/);
    expect(run(`import turtle\nt=turtle.Turtle()\ntry:\n    ${statement}\nexcept ${type}:\n    print('처리됨')`).output).toBe("처리됨\n");
  });
  it("그래픽 명령 제한은 bare except로 잡을 수 없다", () => {
    const result = run("import turtle\nt=turtle.Turtle()\ntry:\n    for i in range(20):\n        t.forward(1)\nexcept:\n    print('잡힘')", { maxGraphicsCommands: 10 });
    expect(result.output).not.toContain("잡힘"); expect(result.events.at(-1)).toMatchObject({ type: "error", error: { message: "그래픽 명령 제한을 초과했습니다." } });
  });
  it("중지 뒤에는 새 VM을 정상 실행할 수 있다", () => {
    const stopped: VMEvent[] = [], vm = new VM(compile("import turtle\nt=turtle.Turtle()\nwhile True:\n    t.forward(1)"), event => stopped.push(event));
    vm.executeAsync(); vm.stop(); expect(stopped.at(-1)).toMatchObject({ type: "stopped" }); expect(run("print('다시 실행')").output).toBe("다시 실행\n");
  });
});
