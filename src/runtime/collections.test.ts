import { describe, expect, it } from "vitest";
import { compile } from "../compiler/compiler";
import { VM, type VMEvent } from "./vm";
const run=(code:string)=>{const events:VMEvent[]=[];const vm=new VM(compile(code),e=>events.push(e));vm.execute();return events.filter((e):e is Extract<VMEvent,{type:"output"}>=>(e.type==="output")).map(e=>e.text).join("");};
describe("3단계 컬렉션",()=>{
 it("리스트·튜플·딕셔너리와 Python 출력 형식을 처리한다",()=>expect(run('print([1, "A", True, None])\nprint(("A",))\nprint({"name": "민수", "active": True})')).toBe("[1, 'A', True, None]\n('A',)\n{'name': '민수', 'active': True}\n"));
 it("인덱싱·수정·중첩 순회를 처리한다",()=>expect(run('maps = [[0, 0], [0, 0]]\nmaps[1][0] = 1\nfor row in maps:\n    for value in row:\n        print(value, end="")')).toBe("0010"));
 it("슬라이스, 포함 검사, 메서드를 처리한다",()=>expect(run('a = [1, 2, 3]\na.append(4)\nprint(a[1:4:2])\nprint(2 in a)\nprint(" 1,2 ".strip().split(","))')).toBe("[2, 4]\nTrue\n['1', '2']\n"));
});
