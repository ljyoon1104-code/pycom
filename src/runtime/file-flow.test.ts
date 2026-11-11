import { afterEach, expect, it, vi } from "vitest";
import { createWorkerRuntime, FILE_FLOW_LIMITS } from "./worker";
import type { FromWorker } from "./protocol";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
function setup(code: string, files: {name:string;content:string}[] = [], mode: 'normal'|'step'|'follow' = 'normal') {
  vi.useFakeTimers(); const events:FromWorker[]=[];
  const receive=createWorkerRuntime(e=>events.push(e));
  receive({type:'run',runId:'a',code,files,mode,speed:100});
  const changes=()=>events.filter((e):e is Extract<FromWorker,{type:'file-change'}>=>e.type==='file-change');
  const ack=(writeId:number,ok=true,runId='a')=>receive({type:'file-ack',writeId,ok,runId});
  const finish=()=>{
    const persisted=new Map<string,string>(), acknowledged=new Set<number>();
    for(let turns=0;turns<1000;turns++) {
      for(const change of changes()) if(!acknowledged.has(change.writeId!)) { acknowledged.add(change.writeId!); persisted.set(change.name,change.content); ack(change.writeId!); }
      vi.runOnlyPendingTimers();
      if(events.some(e=>['complete','error','stopped'].includes(e.type)))return persisted;
    }
    throw Error('file flow did not settle');
  };
  return {events,receive,changes,ack,finish};
}
it('coalesces repeated full-file changes and bounds transmitted payloads',()=>{
  const t=setup('text = "x" * 100000\nfor i in range(100):\n    with open("probe.txt", "w") as f:\n        f.write(text)\nprint("done")');
  const saved=t.finish(); expect(saved.get('probe.txt')).toBe('x'.repeat(100000));
  expect(t.events.at(-1)?.type).toBe('complete'); expect(t.changes().length).toBeLessThan(20);
  expect(t.changes().reduce((n,e)=>n+e.content.length,0)).toBeLessThan(2000000);
  expect(t.changes().every(e=>new TextEncoder().encode(e.content).length<=FILE_FLOW_LIMITS.contentBytes)).toBe(true);
});
it('accepts a full one-megabyte file plus an ordinary filename',()=>{
  const t=setup('with open("source.txt", "r") as f:\n    text = f.read()\nwith open("copy.txt", "w") as f:\n    f.write(text)',[{name:'source.txt',content:'x'.repeat(1000000)}]);
  expect(t.finish().get('copy.txt')).toBe('x'.repeat(1000000));expect(t.events.at(-1)?.type).toBe('complete');
});
it('counts UTF-8 names in the pending byte budget before sending, without allocating a large payload',()=>{
  const original=TextEncoder.prototype.encode;
  // Simulate large encoded names using tiny actual strings; no oversized arrays are allocated.
  vi.spyOn(TextEncoder.prototype,'encode').mockImplementation(function(this:TextEncoder,text){return text?.startsWith('가') ? {length:100001} as ReturnType<TextEncoder['encode']> : original.call(this,text);});
  const t=setup('names = [f"가{i}.txt" for i in range(100)]\ntry:\n    values = list(map(open, names, ["w"] * 100))\nexcept:\n    print("잡으면 안 됨")');
  t.finish();
  expect(t.changes()).toHaveLength(99);expect(t.events.at(-1)).toMatchObject({type:'error',error:{message:expect.stringContaining('저장 대기')}});
  expect(t.events.filter(e=>e.type==='output').map(e=>e.text).join('')).not.toContain('잡으면 안 됨');
});
it('replaces pending names without charging the same UTF-8 metadata twice',()=>{
  const original=TextEncoder.prototype.encode;
  vi.spyOn(TextEncoder.prototype,'encode').mockImplementation(function(this:TextEncoder,text){return text==='한글.txt' ? {length:9999900} as ReturnType<TextEncoder['encode']> : original.call(this,text);});
  const t=setup('with open("한글.txt", "w") as f:\n    f.write("A")\nwith open("한글.txt", "w") as f:\n    f.write("B")');
  expect(t.finish().get('한글.txt')).toBe('B');expect(t.changes()).toHaveLength(1);expect(t.events.at(-1)?.type).toBe('complete');
});
it('does not send more than one unacknowledged payload or run ahead of a storage wait',()=>{
  const t=setup('for i in range(100):\n    with open("a.txt", "w") as f:\n        f.write(str(i))\nprint("done")');
  vi.runAllTimers(); const count=t.changes().length; expect(count).toBe(1); expect(t.events.some(e=>e.type==='complete')).toBe(false);
  vi.advanceTimersByTime(60000); expect(t.changes()).toHaveLength(count);
  expect(t.finish().get('a.txt')).toBe('99');
});
it('durably acknowledges writes before requesting input',()=>{
  const t=setup('with open("a.txt", "w") as f:\n    f.write("saved")\nx = input("값:")\nprint(x)');
  expect(t.changes()).toHaveLength(1); expect(t.changes()[0].content).toBe('saved'); expect(t.events.some(e=>e.type==='input-request')).toBe(false);
  t.ack(t.changes()[0].writeId!); expect(t.events.at(-1)).toMatchObject({type:'input-request',prompt:'값:'});
  t.receive({type:'input',value:'ok',runId:'a'}); expect(t.events.at(-1)?.type).toBe('complete');
});
it('persists an unclosed handle at ordinary completion',()=>{
  const t=setup('f = open("a.txt", "w")\nf.write("unclosed")');expect(t.finish().get('a.txt')).toBe('unclosed');expect(t.events.at(-1)?.type).toBe('complete');
});
it('persists an unclosed handle before input is shown',()=>{
  const t=setup('f = open("a.txt", "w")\nf.write("before input")\ninput("값:")');
  expect(t.changes()[0].content).toBe('before input');expect(t.events.some(e=>e.type==='input-request')).toBe(false);
  t.ack(t.changes()[0].writeId!);expect(t.events.at(-1)?.type).toBe('input-request');t.receive({type:'input',value:'ok',runId:'a'});expect(t.events.at(-1)?.type).toBe('complete');
});
it('preserves unclosed writes before a Python error',()=>{
  const t=setup('f = open("a.txt", "w")\nf.write("before error")\nprint(1 / 0)');expect(t.finish().get('a.txt')).toBe('before error');expect(t.events.at(-1)).toMatchObject({type:'error',error:{pythonType:'ZeroDivisionError'}});
});
it('persists unclosed writes before a step pause and keeps the pause until ACK',()=>{
  const t=setup('f = open("a.txt", "w")\nf.write("before step")\nprint("done")',[],'step');
  t.receive({type:'next',pauseId:1,runId:'a'});t.ack(t.changes()[0].writeId!);
  t.receive({type:'next',pauseId:2,runId:'a'});expect(t.changes().at(-1)?.content).toBe('before step');
  expect(t.events.some(e=>e.type==='execution'&&e.state==='paused'&&e.location?.line===3)).toBe(false);
  t.ack(t.changes().at(-1)!.writeId!);expect(t.events.at(-1)).toMatchObject({type:'execution',state:'paused',location:{line:3}});
  t.receive({type:'next',pauseId:3,runId:'a'});expect(t.events.at(-1)?.type).toBe('complete');
});
it('persists an unclosed handle before normal stop',()=>{
  const t=setup('f = open("a.txt", "w")\nf.write("before stop")\nwhile True:\n    pass');
  t.receive({type:'stop',runId:'a'});expect(t.finish().get('a.txt')).toBe('before stop');expect(t.events.at(-1)?.type).toBe('stopped');
});
it('reports an ACK failure as an error even while the VM has not finished',()=>{
  const t=setup('f = open("a.txt", "w")\nf.write("before failure")\nwhile True:\n    pass');
  vi.runOnlyPendingTimers();t.ack(t.changes()[0].writeId!,false);expect(t.events.at(-1)).toMatchObject({type:'error',error:{message:expect.stringContaining('a.txt')}});expect(t.events.some(e=>e.type==='stopped')).toBe(false);
});
it('does not recursively retry a failed error checkpoint and preserves accepted pending changes',()=>{
  const original=TextEncoder.prototype.encode;
  vi.spyOn(TextEncoder.prototype,'encode').mockImplementation(function(this:TextEncoder,text){return text==='a.txt'||text==='b.txt'?{length:4999000} as ReturnType<TextEncoder['encode']>:original.call(this,text);});
  const t=setup('a = open("a.txt", "w")\nb = open("b.txt", "w")\na.write("x" * 5000)\nprint(1 / 0)');
  const saved=t.finish();expect(saved.get('a.txt')).toBe('');expect(saved.get('b.txt')).toBe('');expect(t.events.at(-1)).toMatchObject({type:'error',error:{message:expect.stringContaining('저장 대기')}});expect(t.events.filter(e=>e.type==='error')).toHaveLength(1);
});
it('retains an explicit w truncation event even when the existing file was already empty',()=>{
  const t=setup('f = open("a.txt", "w")',[{name:'a.txt',content:''}]);expect(t.finish().get('a.txt')).toBe('');expect(t.changes()).toHaveLength(1);
});
it('keeps w-mode truncation durable when a subsequent Python error occurs',()=>{
  const t=setup('with open("a.txt", "w") as f:\n    print(1 / 0)',[{name:'a.txt',content:'old'}]);
  expect(t.events.some(e=>e.type==='error')).toBe(false); expect(t.finish().get('a.txt')).toBe(''); expect(t.events.at(-1)).toMatchObject({type:'error',error:{pythonType:'ZeroDivisionError'}});
});
it('preserves append and read-your-writes semantics while coalescing persistence',()=>{
  const t=setup('with open("a.txt", "a") as f:\n    f.write("B")\nwith open("a.txt", "r") as f:\n    print(f.read())',[{name:'a.txt',content:'A'}]);
  expect(t.finish().get('a.txt')).toBe('AB'); expect(t.events.filter(e=>e.type==='output').map(e=>e.text).join('')).toBe('AB\n');
});
it('preserves the order of the latest changes across different files',()=>{
  const t=setup('with open("a.txt", "w") as f:\n    f.write("A1")\nwith open("b.txt", "w") as f:\n    f.write("B")\nwith open("a.txt", "w") as f:\n    f.write("A2")');
  const saved=t.finish();expect(t.changes().map(e=>[e.name,e.content])).toEqual([['b.txt','B'],['a.txt','A2']]);expect(saved.get('a.txt')).toBe('A2');expect(saved.get('b.txt')).toBe('B');
});
it('waits for accepted changes before reporting a normal stop',()=>{
  const t=setup('with open("a.txt", "w") as f:\n    f.write("saved")\nwhile True:\n    pass');
  vi.runOnlyPendingTimers(); t.receive({type:'stop',runId:'a'}); expect(t.events.some(e=>e.type==='stopped')).toBe(false); expect(t.finish().get('a.txt')).toBe('saved'); expect(t.events.at(-1)).toMatchObject({type:'stopped'});
});
it('reports storage failure instead of completion and preserves other accepted files',()=>{
  const t=setup('with open("a.txt", "w") as f:\n    f.write("A")\nwith open("b.txt", "w") as f:\n    f.write("B")');
  t.ack(t.changes()[0].writeId!,false); expect(t.finish().get('b.txt')).toBe('B'); expect(t.events.at(-1)).toMatchObject({type:'error',error:{message:expect.stringContaining('a.txt')}}); expect(t.events.some(e=>e.type==='complete')).toBe(false);
});
it('rejects duplicate and stale-run acknowledgements',()=>{
  const t=setup('with open("a.txt", "w") as f:\n    f.write("A")');
  const first=t.changes()[0].writeId!; t.ack(first,true,'old'); expect(t.events.some(e=>e.type==='complete')).toBe(false);
  t.ack(first+1); expect(t.events.some(e=>e.type==='complete')).toBe(false); t.ack(first); expect(t.events.at(-1)?.type).toBe('complete'); const count=t.events.length; t.ack(first); expect(t.events).toHaveLength(count);
});
it('freezes follow intervals during persistence and grants the full interval after ACK',()=>{
  const t=setup('with open("a.txt", "w") as f:\n    f.write("A")\nprint("done")',[],'follow');
  vi.advanceTimersByTime(100); expect(t.changes()).toHaveLength(1); vi.advanceTimersByTime(10000); expect(t.changes()).toHaveLength(1);
  t.ack(t.changes()[0].writeId!); const count=t.events.length; vi.advanceTimersByTime(99); expect(t.events).toHaveLength(count); vi.advanceTimersByTime(1); expect(t.changes()).toHaveLength(2);
  t.ack(t.changes()[1].writeId!); vi.advanceTimersByTime(100); expect(t.events.at(-1)?.type).toBe('complete');
});
