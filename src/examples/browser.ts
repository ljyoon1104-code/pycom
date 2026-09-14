import "./examples.css";
import { LearningEditor } from "../editor/editor";
import { TurtleCanvasRenderer } from "../graphics/turtle-canvas";
import { TEXTBOOK_EXAMPLES } from "./catalog";
import { emptyFilters, exampleHash, exampleRoute, filterExamples, STATUS, TOPICS, type LearningExample } from "./model";
import { ExampleRunner, type ExampleWorker } from "./runner";

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
};
const button = (text: string, action: () => void, className = "") => {
  const node = element("button", text, className); node.type = "button"; node.onclick = action; return node;
};

export function mountExampleBrowser(parent: HTMLElement, onVisibility: (active: boolean) => void, edit: (example: LearningExample) => Promise<boolean>): void {
  const page = element("section", "", "textbook-page"); page.hidden = true;
  const list = element("aside", "", "textbook-list"), detail = element("section", "", "textbook-detail");
  list.setAttribute("aria-label", "교과서 예제 목록"); detail.setAttribute("aria-label", "선택한 예제");
  const heading = element("h1", "교과서 예제");
  const intro = element("p", "교과서 쪽과 개념에 맞춰 새로 만든 수업용 코드입니다. 원문 복사본이 아닙니다.", "examples-intro");
  const searchLabel = element("label", "쪽 번호·제목·문법 검색"), search = element("input"); search.type = "search"; search.id = "textbook-search"; searchLabel.htmlFor = search.id;
  const filters = emptyFilters();
  const topicLabel = element("label", "학습 주제"), topic = element("select"); topic.id = "textbook-topic"; topicLabel.htmlFor = topic.id;
  for (const text of ["", ...TOPICS]) { const option = element("option", text || "전체 주제"); option.value = text; topic.append(option); }
  const statusLabel = element("label", "실행 상태"), status = element("select"); status.id = "textbook-status"; statusLabel.htmlFor = status.id;
  for (const [value, text] of [["", "전체 상태"], ...Object.entries(STATUS)]) { const option = element("option", text); option.value = value; status.append(option); }
  const count = element("p", "", "examples-count"); count.setAttribute("role", "status");
  const cards = element("div", "", "textbook-cards");
  const reset = button("필터 초기화", () => { Object.assign(filters, emptyFilters()); search.value = topic.value = status.value = ""; renderCards(); search.focus(); });
  list.append(heading, intro, searchLabel, search, topicLabel, topic, statusLabel, status, reset, count, cards);
  page.append(list, detail); parent.append(page);
  let current: LearningExample | undefined, viewer: LearningEditor | undefined, graphics: TurtleCanvasRenderer | undefined, runner: ExampleRunner | undefined;
  let lastId: string | undefined;
  function cleanup() { runner?.dispose(); viewer?.destroy(); graphics?.destroy(); runner = undefined; viewer = undefined; graphics = undefined; }
  function renderCards() {
    const results = filterExamples(TEXTBOOK_EXAMPLES, filters); count.textContent = `${results.length}개 예제`;
    cards.replaceChildren();
    if (!results.length) cards.append(element("p", "검색 결과가 없습니다. 필터를 초기화해 주세요."));
    for (const example of results) {
      const card = element("a", "", "textbook-card"); card.href = exampleHash(example.id); card.dataset.exampleId = example.id;
      if (current?.id === example.id) card.setAttribute("aria-current", "page");
      card.append(element("small", `${example.page}쪽 · ${STATUS[example.status]}`), element("strong", example.title), element("span", example.topics.join(" · ")), element("span", example.summary));
      cards.append(card);
    }
  }
  search.oninput = () => { filters.query = search.value; renderCards(); };
  topic.onchange = () => { filters.topic = topic.value; renderCards(); };
  status.onchange = () => { filters.status = status.value; renderCards(); };
  function renderDetail(example: LearningExample) {
    const title = element("h2", `${example.page}쪽 · ${example.title}`); title.tabIndex = -1;
    const back = button("목록으로", () => { location.hash = "#/examples"; });
    const summary = element("p", example.summary);
    const tags = element("p", `${STATUS[example.status]} · ${example.topics.join(" · ")}`);
    const note = element("p", "실행은 임시 공간에서 진행되며, 현재 문서와 저장된 파일은 바뀌지 않습니다.", "example-notice");
    detail.append(back, title, summary, tags, note);
    if (example.correctionNote) { const correction = element("section", "", "example-correction"); correction.append(element("h3", "수정된 예제"), element("p", "교과서 자료의 오류가 있던 개념을 실행 가능한 자체 제작 코드로 구성했습니다."), element("p", example.correctionNote)); detail.append(correction); }
    const codeHelp = element("p", "읽기 전용 코드입니다. 선택하여 복사할 수 있고 긴 줄은 코드 영역 안에서 스크롤합니다.");
    const code = element("div", "", "example-code"); code.style.height = `${Math.min(360, Math.max(140, example.code.split("\n").length * 24 + 24))}px`; detail.append(codeHelp, code); viewer = new LearningEditor(code, example.code, () => {}, true);
    if (example.inputGuide) detail.append(element("h3", "입력 안내"), element("p", "입력값에 따라 결과가 달라집니다. 순서대로 넣을 예시 입력: " + example.inputGuide.join(" → ")));
    if (example.topics.includes("random")) detail.append(element("p", "난수 결과는 실행할 때마다 달라질 수 있습니다."));
    if (example.topics.includes("datetime")) detail.append(element("p", "오늘 날짜를 사용하는 결과는 실행 날짜에 따라 달라집니다."));
    for (const file of example.dataFiles ?? []) {
      detail.append(element("h3", `임시 데이터: ${file.name} (UTF-8)`), element("pre", file.content, "example-data"));
    }
    if (example.expectedOutput !== undefined || example.expectedGraphic) {
      detail.append(element("h3", "예상 결과"), element("pre", example.expectedOutput ?? example.expectedGraphic!, "example-expected"));
    }
    const controls = element("div", "", "example-controls"), run = button("예제 실행", start, "example-run"), stop = button("예제 중지", () => runner?.stop(), "example-stop"); stop.disabled = true;
    const editButton = button("편집기에서 수정하기", async () => {
      editButton.disabled = true;
      try { await edit(example); } catch { live.textContent = "가져올 수 없습니다. 저장 공간과 파일 이름을 확인해 주세요."; }
      finally { editButton.disabled = false; }
    }, "example-edit");
    const linkField = element("input", "", "example-link"); linkField.readOnly = true; linkField.hidden = true; linkField.setAttribute("aria-label", "선택하여 복사할 예제 주소");
    const copy = button("예제 링크 복사", async () => {
      const url = new URL(exampleHash(example.id), location.href).href;
      try { await navigator.clipboard.writeText(url); live.textContent = "예제 링크를 복사했습니다."; }
      catch { linkField.hidden = false; linkField.value = url; linkField.focus(); linkField.select(); live.textContent = "주소를 선택했습니다. 복사해 주세요."; }
    }, "example-copy");
    controls.append(run, stop, editButton, copy);
    const live = element("p", "실행 준비", "example-live"); live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite");
    const output = element("pre", "", "example-output"); output.setAttribute("aria-label", "실제 실행 결과"); output.tabIndex = 0;
    const inputForm = element("form", "", "example-input-form"), inputLabel = element("label"), input = element("input"), submit = element("button", "입력"); submit.type = "submit";
    input.id = "example-answer"; input.autocomplete = "off"; inputLabel.htmlFor = input.id; inputForm.hidden = true; inputForm.append(inputLabel, input, submit);
    const canvas = element("canvas", "", "example-canvas"); canvas.hidden = true; canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", example.expectedGraphic ?? "예제의 거북이 그래픽 실행 결과");
    detail.append(controls, linkField, element("h3", "실제 실행 결과"), live, output, inputForm, canvas);
    graphics = new TurtleCanvasRenderer(canvas);
    const setRunning = (running: boolean) => { run.disabled = running; stop.disabled = !running; output.setAttribute("aria-busy", String(running)); if (!running) inputForm.hidden = true; };
    runner = new ExampleRunner(() => new Worker(new URL("../runtime/worker.ts", import.meta.url), { type: "module" }) as unknown as ExampleWorker, event => {
      if (event.type === "output") output.textContent += event.text;
      else if (event.type === "graphics") { canvas.hidden = false; graphics?.apply(event.commands); }
      else if (event.type === "input-request") { inputLabel.textContent = event.prompt || "입력값"; input.value = ""; inputForm.hidden = false; live.textContent = "입력을 기다리고 있습니다."; input.focus(); }
      else if (event.type === "error") { viewer?.setError(event.error.line); live.textContent = `${event.error.line}번째 줄: ${event.error.message}`; setRunning(false); }
      else if (event.type === "complete" || event.type === "stopped") { live.textContent = event.type === "complete" ? "실행 완료" : "실행 중지"; setRunning(false); }
    });
    inputForm.onsubmit = event => { event.preventDefault(); const value = input.value; inputForm.hidden = true; live.textContent = "실행 중"; runner?.input(value); };
    function start() {
      output.textContent = ""; canvas.hidden = true; graphics?.reset(); viewer?.setError(null); inputForm.hidden = true; live.textContent = "실행 중"; setRunning(true);
      try { runner?.start(example); } catch { live.textContent = "예제를 준비할 수 없습니다. 파일 크기와 이름을 확인해 주세요."; setRunning(false); }
    }
    requestAnimationFrame(() => { if (title.isConnected) title.focus(); });
  }
  function route() {
    const route = exampleRoute(location.hash); cleanup(); if (current) lastId = current.id;
    current = route.id ? TEXTBOOK_EXAMPLES.find(example => example.id === route.id) : undefined;
    page.hidden = !route.active; onVisibility(route.active); detail.replaceChildren();
    page.classList.toggle("has-detail", !!route.id); renderCards();
    if (!route.active) return;
    if (current) renderDetail(current);
    else if (route.id) { detail.append(element("h2", "예제를 찾을 수 없습니다."), button("목록으로", () => { location.hash = "#/examples"; })); }
    else { detail.append(element("h2", "어떤 개념을 연습할까요?"), element("p", "목록에서 예제를 선택하면 코드를 볼 수 있습니다.")); const card = Array.from(cards.querySelectorAll<HTMLAnchorElement>("a")).find(node => node.dataset.exampleId === lastId); requestAnimationFrame(() => (card ?? search).focus()); }
  }
  window.addEventListener("hashchange", route); route();
}
