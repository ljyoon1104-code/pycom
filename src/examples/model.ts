export type LearningExample = {
  id: string; collection: "basic" | "textbook"; page?: number; order: number;
  title: string; summary: string; topics: string[];
  status: "ready" | "input" | "data" | "corrected";
  code: string; suggestedFileName: string; inputGuide?: string[];
  expectedOutput?: string; expectedGraphic?: string; correctionNote?: string;
  dataFiles?: { name: string; content: string; encoding: "utf-8" }[];
};
export const TOPICS = ["변수·자료형", "입력·출력", "조건문", "반복문", "리스트·컬렉션", "함수", "클래스", "파일 입출력", "예외 처리", "random", "datetime", "turtle"];
export const STATUS = { ready: "바로 실행", input: "입력 필요", data: "데이터 필요", corrected: "수정된 예제" };
export type Filters = { query: string; topic: string; status: string };
export const emptyFilters = (): Filters => ({ query: "", topic: "", status: "" });
export function filterExamples(examples: readonly LearningExample[], filters: Filters): LearningExample[] {
  const words = filters.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return examples.filter(e => (!filters.topic || e.topics.includes(filters.topic)) && (!filters.status || e.status === filters.status) && words.every(word => `${e.page ?? ""} ${e.title} ${e.summary} ${e.topics.join(" ")} ${e.code}`.toLocaleLowerCase().includes(word)))
    .sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || a.order - b.order || a.id.localeCompare(b.id));
}
export function exampleRoute(hash: string): { active: boolean; id?: string } {
  if (hash === "#/examples" || hash === "#/examples/") return { active: true };
  if (!hash.startsWith("#/examples/")) return { active: false };
  try { return { active: true, id: decodeURIComponent(hash.slice(11)) }; } catch { return { active: true, id: "invalid" }; }
}
export const exampleHash = (id: string): string => `#/examples/${encodeURIComponent(id)}`;
