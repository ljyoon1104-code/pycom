import { afterEach, expect, it, vi } from "vitest";
import { createWorkerRuntime } from "./worker";
import type { FromWorker } from "./protocol";
afterEach(() => vi.useRealTimers());
const setup = () => { vi.useFakeTimers(); const events: FromWorker[] = []; const receive = createWorkerRuntime(event => events.push(event)); return { events, receive }; };
it("flushes buffered stdout before each paused execution message", () => {
  const {events,receive} = setup(); receive({type:'run',runId:'a',code:'print(1)\nprint(2)',files:[],mode:'step'});
  receive({type:'next',runId:'a',pauseId:1});
  const index = events.findIndex(e => e.type === 'output');
  expect(events[index]).toMatchObject({type:'output',text:'1\n',runId:'a'}); expect(events[index+1]).toMatchObject({type:'execution',state:'paused',pauseId:2});
});
it("rejects commands from an older run, including input and stop", () => {
  const {events,receive} = setup(); receive({type:'run',runId:'a',code:'input("old")',files:[]});
  receive({type:'run',runId:'b',code:'x = input("new")\nprint(x)',files:[]});
  const length=events.length; receive({type:'input',runId:'a',value:'wrong'}); receive({type:'stop',runId:'a'}); expect(events).toHaveLength(length);
  receive({type:'input',runId:'b',value:'right'}); expect(events.at(-2)).toMatchObject({type:'output',runId:'b',text:'right\n'}); expect(events.at(-1)).toMatchObject({type:'complete',runId:'b'});
});
it("deduplicates rapid next requests for one stop", () => {
  const {events,receive}=setup(); receive({type:'run',runId:'a',code:'print(1)\nprint(2)',files:[],mode:'step'});
  for(let n=0;n<10;n++)receive({type:'next',runId:'a',pauseId:1});
  expect(events.filter(e=>e.type==='output')).toEqual([{type:'output',runId:'a',text:'1\n'}]); expect(events.at(-1)).toMatchObject({type:'execution',pauseId:2});
});
it("keeps normal output batching without per-line trace notifications", () => {
  const {events,receive}=setup(); receive({type:'run',runId:'a',code:'for n in range(100):\n    print(n)',files:[]}); vi.runAllTimers();
  expect(events.filter(e=>e.type==='output')).toHaveLength(1); expect(events.filter(e=>e.type==='execution'||e.type==='source')).toEqual([]); expect(events.at(-1)?.type).toBe('complete');
});
it("stop cancels follow timers and a fresh run can execute", () => {
  const {events,receive}=setup(); receive({type:'run',runId:'a',code:'print("old")',files:[],mode:'follow'}); receive({type:'stop',runId:'a'});
  receive({type:'run',runId:'b',code:'print("new")',files:[]}); vi.runAllTimers();
  expect(events.filter(e=>e.type==='output')).toEqual([{type:'output',runId:'b',text:'new\n'}]);
});
it("normal input announces the source and starting statement line only at the input wait", () => {
  const {events,receive}=setup(); receive({type:'run',runId:'a',code:'x = (\n    input("값:")\n)\nprint(x)',fileName:'수업.py',files:[]});
  expect(events.filter(e=>e.type==='execution')).toEqual([expect.objectContaining({state:'input',location:expect.objectContaining({fileName:'수업.py',line:1,sourceId:'entry'})})]);
});
it("input while evaluating a multiline for iterable points to the for statement", () => {
  const {events,receive}=setup(); receive({type:'run',runId:'a',code:'print("before")\nfor x in (\n    input("값:")\n):\n    print(x)',files:[]});
  expect(events.filter(e=>e.type==='execution')).toEqual([expect.objectContaining({state:'input',location:expect.objectContaining({line:2,column:1})})]);
});
it("normal input in a comprehension identifies its enclosing statement", () => {
  const {events,receive}=setup(); receive({type:'run',runId:'a',code:'print("before")\nvalues = [input("값:") for x in range(1)]\nprint(values)',files:[]});
  expect(events.filter(e=>e.type==='execution')).toEqual([expect.objectContaining({state:'input',location:expect.objectContaining({line:2})})]);
  receive({type:'input',runId:'a',value:'ok'}); expect(events.at(-1)?.type).toBe('complete');
  expect(events.filter(e=>e.type==='execution').at(-1)).toEqual({type:'execution',state:'running',runId:'a'});
});
