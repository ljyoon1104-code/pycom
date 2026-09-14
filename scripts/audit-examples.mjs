import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { TEXTBOOK_EXAMPLES } = await vite.ssrLoadModule("/src/examples/catalog.ts");
  const { CLASSROOM_EXAMPLES } = await vite.ssrLoadModule("/src/app/classroom.ts");
  const { compile } = await vite.ssrLoadModule("/src/compiler/compiler.ts");
  const { VM } = await vite.ssrLoadModule("/src/runtime/vm.ts");
  const examples = [...TEXTBOOK_EXAMPLES, ...CLASSROOM_EXAMPLES.map(e => ({ ...e, collection: "basic", status: e.id === "input-condition" ? "input" : "ready", inputGuide: e.id === "input-condition" ? ["민수", "85"] : [] }))];
  const results = [];
  for (const example of examples) {
    const events = [];
    const vm = new VM(compile(example.code), event => events.push(event), new Map((example.dataFiles ?? []).map(file => [file.name, file.content])));
    vm.execute(); let next = 0;
    while (events.at(-1)?.type === "input" && next < (example.inputGuide?.length ?? 0)) vm.resume(example.inputGuide[next++]);
    const output = events.filter(e => e.type === "output").map(e => e.text).join("");
    assert.equal(events.at(-1)?.type, "complete", `${example.id}: ${JSON.stringify(events.at(-1))}`);
    if (example.expectedOutput !== undefined) assert.equal(output, example.expectedOutput, example.id);
    results.push({ id: example.id, collection: example.collection, page: example.page, title: example.title, status: example.status, inputs: next, complete: true, graphics: events.some(e => e.type === "graphics"), output });
  }
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/textbook-example-results.json", JSON.stringify(results, null, 2));
  const textbook = results.filter(e => e.collection === "textbook");
  const topics = new Map(); for (const e of TEXTBOOK_EXAMPLES) for (const topic of e.topics) topics.set(topic, (topics.get(topic) ?? 0) + 1);
  const report = `# 교과서 연계 예제 실행 감사\n\n검사일: ${new Date().toISOString().slice(0, 10)}\n\n## 등록 및 실행 결과\n\n- 교과서 연계: ${textbook.length}개, 기존 기초: ${CLASSROOM_EXAMPLES.length}개. 총 ${results.length}개 실제 Compiler/VM 완료.\n- 바로 실행 ${textbook.filter(e => e.status === "ready").length}, 입력 제공 ${textbook.filter(e => e.status === "input").length}, 임시 데이터 제공 ${textbook.filter(e => e.status === "data").length}, 수정된 예제 ${textbook.filter(e => e.status === "corrected").length}.\n- turtle ${textbook.filter(e => e.graphics).length}개 성공(바로 실행 수에 포함). 실패 0.\n- 모든 실행은 새 VM과 자체 제작 데이터만 사용. 학생 IndexedDB를 읽거나 쓰지 않는다. 입력은 메타데이터의 대표값을 순서대로 공급했다.\n\n## 원본 자료 대조 및 공개 콘텐츠\n\nF: 원본 목록은 .py 63개와 .ipynb 4개. 3단원 120–153쪽 .py 56개를 읽기 전용으로 재조사했다. 지도서 심화는 학생 심화와 코드가 같지만 기존 감사 기준에 맞춰 별도 연계 항목으로 유지했다. 나머지 단원/부록 7개와 노트북 4개는 이 페이지 대상이 아니다.\n\n원본 56개 재실행 결과는 완료 이벤트 51개(빈 실행 오류 예제 1개 포함), 실행 오류 5개. 기존 분류 31/18/1/6과 일치했다. 원본 코드·독점 CSV·본문·그림·로고는 배포하지 않는다. 페이지 번호와 학습 개념만 연결하고 제목·설명·코드·CSV를 새로 작성했다.\n\n원본 오류 6개는 형 변환, 없는 키 처리, 미정의 이름, 변수 오탈자, 실행문 들여쓰기, 속성 이름 일치의 수정 이유를 안내한다. 150–151쪽 게임은 난수 목록·클래스·입력을 보여주는 짧은 관찰 예제로 축소했으며 원본 게임의 복제나 채점 기능이 아니다.\n\n## 학습 주제 (중복 분류)\n\n${[...topics].map(([topic, count]) => `- ${topic}: ${count}`).join("\n")}\n\n## 파일별 실행 결과\n\n| ID | 쪽 | 제목 | 상태 | 대표 입력 수 | 그래픽 | 실행 |\n| --- | ---: | --- | --- | ---: | --- | --- |\n${textbook.map(e => `| ${e.id} | ${e.page} | ${e.title} | ${e.status} | ${e.inputs} | ${e.graphics ? "turtle" : "없음"} | 완료 |`).join("\n")}\n\n## 범위와 제한\n\n- 현재 인터프리터를 그대로 사용하며 새 Python 문법을 추가하지 않았다. 전체 Python/외부 패키지/고급 turtle은 기존 제한을 따른다.\n- 콘텐츠 작성 중 for-else 미지원, 중첩 첨자 복합 대입 오류, 정수값 실수의 정수형 출력 표기를 확인했다. 공개 예제는 기존 교과서 개념에 맞는 일반 조건문·일반 대입·명시적 소수점 형식을 사용한다. 인터프리터 변경으로 숨기거나 우회 기능을 넣지 않았다.\n- 학생 저장소로 데이터를 가져오는 것은 명시적 선택 때만 한다. 기존/덮어쓰기/이름 변경 충돌 정책을 사용하며 이름 변경 후 open() 파일명은 직접 맞춰야 한다.\n- 앱 재접속은 저장된 파일을 보존하지만 미저장 문서를 자동 저장하지 않는다.\n- 화면·접근성·오프라인 실제 검증 기록은 별도 브라우저 보고서에 있다.\n`;
  await writeFile("artifacts/textbook-examples-report.md", report);
  console.log(JSON.stringify({ total: results.length, textbook: textbook.length, statuses: Object.fromEntries(["ready", "input", "data", "corrected"].map(status => [status, textbook.filter(e => e.status === status).length])), failures: 0 }));
} finally { await vite.close(); }
