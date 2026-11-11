import { describe, expect, it, vi } from "vitest";
import { decodePickedFile } from "./import-picked";
import { MAX_FILE_BYTES } from "./storage";

describe("device import allocation guard", () => {
  it.each([MAX_FILE_BYTES + 1, Infinity, NaN, -1])("rejects size %s before reading", async size => {
    const arrayBuffer = vi.fn();
    await expect(decodePickedFile({ size, arrayBuffer }, "auto")).rejects.toThrow("1MB");
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
  it("imports UTF-8 BOM without changing the decoded source", async () => {
    const bytes = new TextEncoder().encode('\uFEFFprint("한글")');
    const arrayBuffer = vi.fn(async () => bytes.buffer);
    expect(await decodePickedFile({ size: bytes.byteLength, arrayBuffer }, "auto")).toMatchObject({content:'print("한글")',encoding:'utf-8'});
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
  });
  it("decodes real EUC-KR bytes", async () => {
    const bytes = new Uint8Array([0xb9,0xce,0xbc,0xf6,0x2c,0x39,0x30]);
    expect(await decodePickedFile({size:bytes.length,arrayBuffer:async()=>bytes.buffer},"auto")).toMatchObject({content:'민수,90',encoding:'euc-kr'});
  });
  it("still checks bytes returned by an inconsistent file object", async () => {
    await expect(decodePickedFile({size:1,arrayBuffer:async()=>new ArrayBuffer(MAX_FILE_BYTES+1)},'utf-8')).rejects.toThrow('1MB');
  });
  it("rejects EUC-KR whose decoded UTF-8 content exceeds the limit", async () => {
    const bytes = new Uint8Array(800_000); for(let index=0;index<bytes.length;index+=2){bytes[index]=0xb9;bytes[index+1]=0xce;}
    await expect(decodePickedFile({size:bytes.length,arrayBuffer:async()=>bytes.buffer},'euc-kr')).rejects.toThrow('UTF-8');
  });
});
