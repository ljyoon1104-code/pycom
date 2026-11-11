import { describe, expect, it, vi } from "vitest";
import { FileWrites } from "./file-writes";
import { MemoryFileStore } from "../files/storage";

describe('bounded UI file persistence',()=>{
  it('acknowledges a durable save even if refreshing the UI fails',async()=>{const store=new MemoryFileStore(),ack=vi.fn(),failed=vi.fn(),writes=new FileWrites(store,()=>{throw Error('view');},failed);writes.accept({runId:'r',writeId:1,name:'a.txt',content:'durable'},ack);await writes.idle();expect((await store.get('a.txt'))?.content).toBe('durable');expect(ack).toHaveBeenLastCalledWith({type:'file-ack',writeId:1,ok:true});expect(failed).toHaveBeenCalledWith(expect.stringContaining('저장됐지만'));});
  it('acknowledges only committed content and keeps duplicate requests idempotent',async()=>{
    const store=new MemoryFileStore(), saved=vi.fn(), failed=vi.fn(), ack=vi.fn(); const writes=new FileWrites(store,saved,failed);
    const event={runId:'run1',writeId:1,name:'a.txt',content:'first'};
    writes.accept(event,ack); expect(ack).not.toHaveBeenCalled(); await writes.idle();
    expect((await store.get('a.txt'))?.content).toBe('first'); expect(ack).toHaveBeenLastCalledWith({type:'file-ack',writeId:1,ok:true});
    writes.accept(event,ack); expect(saved).toHaveBeenCalledTimes(1); expect(failed).not.toHaveBeenCalled();
  });
  it('bounds a slow store without retaining extra file payloads',async()=>{
    const store=new MemoryFileStore(); let release!:()=>void; const put=store.put.bind(store);store.put=async file=>{await new Promise<void>(r=>release=r);await put(file);};
    const ack=vi.fn(), writes=new FileWrites(store,vi.fn(),vi.fn());
    writes.accept({runId:'r',writeId:1,name:'a.txt',content:'a'},ack);
    writes.accept({runId:'r',writeId:2,name:'b.txt',content:'b'},ack);
    expect(ack).toHaveBeenLastCalledWith(expect.objectContaining({writeId:2,ok:false})); release(); await writes.idle();expect(await store.get('b.txt')).toBeUndefined();
  });
  it('reports transaction failure without claiming successful persistence',async()=>{
    const store=new MemoryFileStore();store.put=async()=>{throw Error('quota');};const ack=vi.fn(), failed=vi.fn(),writes=new FileWrites(store,vi.fn(),failed);
    writes.accept({runId:'r',writeId:1,name:'a.txt',content:'a'},ack);await writes.idle();expect(ack).toHaveBeenCalledWith(expect.objectContaining({ok:false}));expect(failed).toHaveBeenCalledOnce();expect(await store.get('a.txt')).toBeUndefined();
  });
  it('allows sequence restart only for a new run',async()=>{const store=new MemoryFileStore(),writes=new FileWrites(store,vi.fn(),vi.fn()),ack=vi.fn();for(const runId of ['old','new']){writes.accept({runId,writeId:1,name:'a.txt',content:runId},ack);await writes.idle();}expect((await store.get('a.txt'))?.content).toBe('new');});
  it('retains accepted writes when their Worker has already terminated',async()=>{const store=new MemoryFileStore(),writes=new FileWrites(store,vi.fn(),vi.fn());writes.accept({runId:'stopped',writeId:1,name:'a.txt',content:'committed'},()=>{});await writes.idle();expect((await store.get('a.txt'))?.content).toBe('committed');});
});
