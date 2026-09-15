import { describe, expect, it } from "vitest";
import { compile } from "../compiler/compiler";
import { VM, type VMEvent, type VMOptions } from "../runtime/vm";
import { decodeImportedBytes, FileDecodingError, normalizeEncoding } from "./encoding";
import { appFile, MemoryFileStore, migrateFile } from "./storage";

// Directly authored fixture encoded with Windows code page 949/EUC-KR.
// It is deliberately bytes, not a UTF-8 string with a misleading file name.
const EUC_KR_CSV = new Uint8Array([
  0xc0, 0xcc, 0xb8, 0xa7, 0x2c, 0xc1, 0xa1, 0xbc, 0xf6, 0x0d, 0x0a,
  0xb9, 0xce, 0xbc, 0xf6, 0x2c, 0x39, 0x30, 0x0d, 0x0a,
  0xc1, 0xf6, 0xbc, 0xf6, 0x2c, 0x39, 0x35, 0x0d, 0x0a,
]);
const CSV_TEXT = "이름,점수\r\n민수,90\r\n지수,95\r\n";
const utf8 = (value: string) => new TextEncoder().encode(value);
const run = (code: string, files: Record<string, string> = {}, options: VMOptions = {}) => {
  const events: VMEvent[] = [];
  new VM(compile(code), event => events.push(event), new Map(Object.entries(files)), options).execute();
  return { events, output: events.filter((event): event is Extract<VMEvent, { type: "output" }> => event.type === "output").map(event => event.text).join(""), last: events.at(-1) };
};

describe("12단계 가져오기 디코딩", () => {
  it("UTF-8 BOM을 먼저 감지하고 BOM은 내용에서 제거한다", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("한글")]);
    expect(decodeImportedBytes(bytes, "auto")).toEqual({ content: "한글", encoding: "utf-8", byteSize: bytes.length });
  });
  it("BOM 없는 올바른 UTF-8을 엄격하게 자동 감지한다", () => {
    expect(decodeImportedBytes(utf8("민수,90"), "auto")).toMatchObject({ content: "민수,90", encoding: "utf-8" });
  });
  it("엄격한 UTF-8 실패 후 EUC-KR을 자동 감지한다", () => {
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(EUC_KR_CSV)).toThrow();
    expect(decodeImportedBytes(EUC_KR_CSV, "auto")).toEqual({ content: CSV_TEXT, encoding: "euc-kr", byteSize: EUC_KR_CSV.length });
  });
  it("실제 EUC-KR 한글 바이트를 명시적으로 디코딩한다", () => {
    expect(decodeImportedBytes(EUC_KR_CSV, "euc-kr").content).toBe(CSV_TEXT);
  });
  it.each(["euc-kr", "euc_kr", "EUC-KR", "cp949", "CP949"])("%s 별칭을 EUC-KR로 정규화한다", label => {
    expect(normalizeEncoding(label)).toBe("euc-kr");
  });
  it.each(["utf-8", "UTF-8", "utf8"])("%s 별칭을 UTF-8로 정규화한다", label => {
    expect(normalizeEncoding(label)).toBe("utf-8");
  });
  it("지원하지 않는 인코딩 이름을 거부한다", () => {
    expect(() => normalizeEncoding("utf-16")).toThrow("'utf-16' 인코딩은 현재 지원하지 않습니다.");
  });
  it("선택한 UTF-8로 해석할 수 없는 파일을 거부한다", () => {
    expect(() => decodeImportedBytes(EUC_KR_CSV, "utf-8")).toThrow("이 파일을 UTF-8로 읽을 수 없습니다.");
  });
  it("손상된 단일 EUC-KR 선행 바이트를 거부한다", () => {
    expect(() => decodeImportedBytes(new Uint8Array([0xff]), "euc-kr")).toThrow("이 파일을 EUC-KR로 읽을 수 없습니다.");
    expect(() => decodeImportedBytes(new Uint8Array([0xff]), "auto")).toThrow("직접 선택");
  });
  it("디코딩 전에 원본 바이트 크기 제한을 적용한다", () => {
    expect(() => decodeImportedBytes(new Uint8Array(11), "auto", 10)).toThrow("1MB");
  });
});

describe("EUC-KR CSV와 Python open", () => {
  const files = { "students-euckr.csv": decodeImportedBytes(EUC_KR_CSV, "auto").content };
  it("readline과 readlines로 CRLF CSV를 읽는다", () => {
    const result = run('with open("students-euckr.csv", "r", encoding="euc-kr") as file:\n    print(file.readline(), end="")\n    print(file.readlines())', files);
    expect(result.output).toBe("이름,점수\n['민수,90\\n', '지수,95\\n']\n");
  });
  it("strip과 split으로 한글 CSV 열을 처리한다", () => {
    const result = run('with open("students-euckr.csv", "r", encoding="cp949") as file:\n    file.readline()\n    for line in file.readlines():\n        values = line.strip().split(",")\n        print(values[0], values[1])', files);
    expect(result.output).toBe("민수 90\n지수 95\n");
  });
  it.each(["euc-kr", "euc_kr", "cp949", "EUC-KR"])("%s 별칭과 LF 줄바꿈을 open에서 처리한다", encoding => {
    expect(run(`with open("a.csv", encoding="${encoding}") as file:\n    print(file.readlines())`, { "a.csv": "이름,점수\n민수,90\n" }).output).toBe("['이름,점수\\n', '민수,90\\n']\n");
  });
  it("저장된 원본 인코딩과 다른 인코딩 선택은 정확한 줄의 ValueError가 된다", () => {
    const direct = run('\nopen("a.csv", encoding="utf-8")', { "a.csv": CSV_TEXT }, { fileEncodings: new Map([["a.csv", "euc-kr"]]) });
    expect(direct.last).toMatchObject({ type: "error", error: { line: 2, message: "이 파일을 UTF-8로 읽을 수 없습니다." } });
    const result = run('try:\n    open("a.csv", encoding="utf-8")\nexcept ValueError as error:\n    print(str(error))', { "a.csv": CSV_TEXT }, { fileEncodings: new Map([["a.csv", "euc-kr"]]) });
    expect(result.output).toBe("이 파일을 UTF-8로 읽을 수 없습니다.\n");
    expect(result.last?.type).toBe("complete");
  });
  it("지원하지 않는 인코딩은 정확한 줄의 ValueError로 잡힌다", () => {
    const result = run('try:\n    open("a.csv", encoding="utf-16")\nexcept ValueError as error:\n    print(str(error))', { "a.csv": "x" });
    expect(result.output).toBe("'utf-16' 인코딩은 현재 지원하지 않습니다.\n");
    expect(result.last?.type).toBe("complete");
  });
  it.each(["w", "a"])("EUC-KR %s 쓰기를 명확히 거부한다", mode => {
    const result = run(`try:\n    open("a.csv", "${mode}", encoding="euc-kr")\nexcept ValueError as error:\n    print(str(error))`);
    expect(result.output).toBe("EUC-KR은 현재 읽기만 지원합니다. 쓰기는 UTF-8을 사용해 주세요.\n");
  });
});

describe("파일 메타데이터 마이그레이션", () => {
  it("기존 IndexedDB 형식의 이름·내용·시각을 보존하고 UTF-8 정보를 보충한다", () => {
    expect(migrateFile({ name: "기존.py", content: "print('한글')", updatedAt: 123 })).toEqual(appFile("기존.py", "print('한글')", 123));
  });
  it("EUC-KR 인코딩과 원본 바이트 크기를 저장소 왕복 후 유지한다", async () => {
    const store = new MemoryFileStore(), file = appFile("학생.csv", CSV_TEXT, 456, "euc-kr", EUC_KR_CSV.length);
    await store.put(file);
    expect(await store.get(file.name)).toEqual(file);
  });
});
