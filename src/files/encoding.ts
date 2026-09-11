export type ImportEncodingChoice = "auto" | "utf-8" | "euc-kr";
export type StoredEncoding = "utf-8" | "euc-kr";

export class FileDecodingError extends Error {
  constructor(readonly code: "unsupported-encoding" | "decode-failed" | "file-limit", message: string) { super(message); }
}

export const normalizeEncoding = (label: string): StoredEncoding => {
  const value = label.trim().toLowerCase().replaceAll("_", "-");
  if (value === "utf8" || value === "utf-8") return "utf-8";
  if (value === "euc-kr" || value === "euckr" || value === "cp949") return "euc-kr";
  throw new FileDecodingError("unsupported-encoding", `'${label}' 인코딩은 현재 지원하지 않습니다.`);
};

const decodeStrict = (bytes: Uint8Array, encoding: StoredEncoding): string => {
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw new FileDecodingError("decode-failed", `이 파일을 ${encoding === "euc-kr" ? "EUC-KR" : "UTF-8"}로 읽을 수 없습니다.`); }
};

export function decodeImportedBytes(bytes: Uint8Array, choice: ImportEncodingChoice, maxBytes = 1_000_000): { content: string; encoding: StoredEncoding; byteSize: number } {
  if (bytes.byteLength > maxBytes) throw new FileDecodingError("file-limit", "파일 하나는 1MB를 넘을 수 없습니다.");
  if (choice !== "auto") {
    const encoding = normalizeEncoding(choice);
    return { content: decodeStrict(bytes, encoding), encoding, byteSize: bytes.byteLength };
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { content: decodeStrict(bytes, "utf-8"), encoding: "utf-8", byteSize: bytes.byteLength };
  }
  try { return { content: decodeStrict(bytes, "utf-8"), encoding: "utf-8", byteSize: bytes.byteLength }; }
  catch (error) { if (!(error instanceof FileDecodingError)) throw error; }
  try { return { content: decodeStrict(bytes, "euc-kr"), encoding: "euc-kr", byteSize: bytes.byteLength }; }
  catch { throw new FileDecodingError("decode-failed", "인코딩을 자동으로 감지할 수 없습니다. UTF-8 또는 EUC-KR을 직접 선택해 주세요."); }
}
