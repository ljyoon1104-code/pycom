import { appFile, checkedPut, MAX_FILE_BYTES, type AppFile, type FileStore } from "../files/storage";
import { storageFailureMessage } from "../files/storage-message";
import { fileNameLabel } from "../files/file-name";

type Write = { runId: string; writeId?: number; name: string; content: string };
type Receipt = { type: "file-ack"; writeId: number; ok: boolean; message?: string };

/** Worker grants a single file event credit. Never accumulate Promise chains in the UI. */
export class FileWrites {
  private active?: Promise<void>;
  private last?: {runId:string;writeId:number;receipt:Receipt};
  constructor(private readonly store: FileStore, private readonly saved: (file: AppFile) => void, private readonly failed: (message: string) => void) {}
  idle(): Promise<void> { return this.active ?? Promise.resolve(); }
  accept(write: Write, acknowledge: (receipt: Receipt) => void): void {
    const id=write.writeId;
    const reject = (message:string) => { if(id!==undefined) acknowledge({type:'file-ack',writeId:id,ok:false,message}); this.failed(message); };
    if(!Number.isSafeInteger(id) || id! < 1) { reject("파일 저장 요청이 올바르지 않습니다."); return; }
    if(this.last?.runId===write.runId && id!<=this.last.writeId) { if(id===this.last.writeId) acknowledge(this.last.receipt); return; }
    if(this.active) { reject("파일 저장 대기 한도를 넘었습니다. 실행을 중지했습니다."); return; }
    if(write.content.length>MAX_FILE_BYTES || new TextEncoder().encode(write.content).length>MAX_FILE_BYTES) { reject("파일 하나는 1MB를 넘을 수 없습니다."); return; }
    this.active=(async()=>{
      let receipt:Receipt;
      const file=appFile(write.name,write.content);
      try { await checkedPut(this.store,file); receipt={type:'file-ack',writeId:id!,ok:true}; }
      catch (reason) { const message=`${fileNameLabel(write.name)}: ${storageFailureMessage(reason)}`; receipt={type:'file-ack',writeId:id!,ok:false,message}; this.failed(message); }
      if(receipt.ok) { try { this.saved(file); } catch { this.failed(`${fileNameLabel(write.name)} 파일은 저장됐지만 화면을 갱신하지 못했습니다. 파일을 다시 열어 확인해 주세요.`); } }
      this.last={runId:write.runId,writeId:id!,receipt};
      this.active=undefined;
      acknowledge(receipt);
    })();
  }
}
