import { decodeImportedBytes, FileDecodingError, type ImportEncodingChoice } from "./encoding";
import { MAX_FILE_BYTES } from "./storage";

/** Reject oversized device files before asking the browser to allocate their bytes. */
export async function decodePickedFile(picked: Pick<File, "size" | "arrayBuffer">, choice: ImportEncodingChoice) {
  if (!Number.isSafeInteger(picked.size) || picked.size < 0 || picked.size > MAX_FILE_BYTES)
    throw new FileDecodingError("file-limit", "파일 하나는 1MB를 넘을 수 없습니다.");
  const decoded = decodeImportedBytes(new Uint8Array(await picked.arrayBuffer()), choice, MAX_FILE_BYTES);
  if (new TextEncoder().encode(decoded.content).length > MAX_FILE_BYTES)
    throw new FileDecodingError("file-limit", "해석한 파일의 UTF-8 크기가 1MB를 넘습니다.");
  return decoded;
}
