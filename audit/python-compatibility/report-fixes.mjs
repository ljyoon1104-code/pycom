import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const root = 'artifacts/python-compatibility-audit-v2';
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const before = await read(root + '-before-fixes.json'), after = await read(root + '.json');
const browser = await read('artifacts/compatibility-fixes-browser/results.json');
const boundaries = await read('tests/fixtures/compatibility-boundaries-v2.json');
const fixtures = await read('tests/fixtures/compatibility-defects-v2.json');
const defects = before.results.filter(r => r.classification === 'interpreter-defect');
assert.equal(defects.length, 46); assert.equal(after.total, 714);
assert.equal(after.counts['interpreter-defect'] ?? 0, 0);
assert.equal(browser.executions, 68); assert.deepEqual(browser.errors, []);
for (const r of before.results) {
  const n = after.results.find(n => n.id === r.id);
  for (const key of ['code', 'input', 'files']) assert.deepEqual(n[key], r[key], `${r.id}: ${key}`);
}
for (const r of defects) {
  const n = after.results.find(n => n.id === r.id);
  assert.ok(['exact', 'educational-compatible'].includes(n.classification));
  assert.equal(fixtures.find(f => f.id === r.id)?.code, r.code);
}
const changes = {
  'int 문자열 검증': ['src/runtime/vm.ts · invoke(int)', '정수 문자열 전체를 검사한 뒤 변환; 빈 문자열·소수·진법 접두사를 성공으로 오인하지 않음'],
  '숫자·math 예외 클래스': ['src/compiler/python-errors.ts; src/runtime/{vm,builtins-v2,math-v2}.ts', 'OverflowError/ZeroDivisionError/ValueError와 부모 예외 매칭을 공통 계층으로 분리'],
  '실수 floor/mod/divmod': ['src/runtime/numbers-v2.ts · floatDivmod; vm.ts; builtins-v2.ts', '나머지에서 몫을 계산하고 부호·오차·signed zero를 보정하는 공통 연산'],
  '함수 호출 결과를 포함한 대입 대상': ['src/compiler/parser.ts · assignmentTargetAtom/postfix', '호출 뒤 첨자·속성을 일반 postfix 경로로 구문 분석; 기존 RHS 단일 평가/좌측 저장 순서 유지'],
  '비교 연쇄 단락 평가': ['src/compiler/{compiler,opcode}.ts; src/runtime/vm.ts · compare_step', '중간 비교 실패 시 뒤 피연산자를 실행하지 않고 중간 값을 한 번만 평가'],
  '컬렉션 순서·부분집합 비교': ['src/runtime/vm.ts · compare', '리스트·튜플 사전식 순서와 집합 포함 관계를 타입별로 비교'],
  '빈 range의 참·거짓': ['src/runtime/value.ts · truthy', 'start/stop/step 방향을 반영하여 빈 range를 거짓으로 판단'],
  'NaN 키 동일 객체 조회': ['src/runtime/value.ts · elementEqual; vm.ts; collections-v2.ts; methods-v2.ts', '컨테이너 조회는 동일 객체 우선, 일반 NaN == NaN은 계속 거짓'],
  '반복 중 크기 변경 감지': ['src/runtime/{value,vm}.ts · iterator/next', 'dict/set 크기를 다음 요소 요청 시 검사; 값 교체·기존 set 원소 재추가는 허용'],
  '리스트 += 참조 유지': ['src/compiler/compiler.ts · augassign; src/runtime/vm.ts · binary', 'inplace 바이트코드로 기존 리스트를 변경; 문자열·튜플은 기존 불변 의미 유지'],
  'bool 인덱스': ['src/runtime/vm.ts · index/store_subscript/deleteTarget', '정수 인덱스 검사 전 bool을 0/1로 변환; float 인덱스는 거절'],
  '지역 변수 예외 클래스': ['src/runtime/vm.ts · loadName; src/compiler/python-errors.ts', '미초기화 지역 변수는 UnboundLocalError이며 NameError로도 처리 가능'],
  'nonlocal 오류 위치': ['src/compiler/compiler.ts · makeFunction/validateNonlocals', '함수 어휘 스코프에서 바인딩 존재를 컴파일 시 검사하고 선언 위치 보고'],
  'global 선언 순서 검사': ['src/compiler/parser.ts · functionStmt', '현재 함수의 앞선 읽기·쓰기·선언을 수집; 내포/중첩 함수의 별도 스코프는 분리'],
  '빈 sum의 시작값': ['src/runtime/vm.ts · invoke(sum)', '빈 반복자는 문자열 이외 시작값을 그대로 반환; 실제 덧셈 시 숫자 검증'],
  'map 결합 메서드 콜백': ['src/runtime/vm.ts · invoke/map', '일반 호출 가능 값 경로를 재사용하여 self를 정확히 한 번 바인딩'],
  '파일 universal newline': ['src/runtime/vm.ts · openFile', '읽기 핸들에서 CRLF/CR을 LF로 정규화; 저장된 원본 문자열은 보존'],
  '문자열 컬렉션 repr 이스케이프': ['src/runtime/value.ts · quoteString/repr', '개행·탭·역슬래시·제어 문자를 출력 표현에서 이스케이프; 실제 파일 내용은 변경하지 않음'],
  '파일 Unicode 코드 포인트 위치': ['src/runtime/vm.ts · fileRead/fileWrite', 'read 크기와 write 반환값은 코드 포인트, 내부 위치는 실제 읽은 UTF-16 길이, 크기 제한은 UTF-8 바이트'],
  'print sep=None': ['src/runtime/vm.ts · invoke(print)', 'sep/end의 None을 기본 공백/개행으로 처리'],
  '파일 모드 예외 클래스': ['src/runtime/vm.ts · 파일 메서드; src/compiler/python-errors.ts', '읽기/쓰기 모드 위반은 UnsupportedOperation; OSError/ValueError 부모로 처리 가능'],
};
const groups = [...new Set(defects.map(r => r.review.group))]; assert.equal(groups.length, 21);
const fields = ['exact', 'educational-compatible', 'intentional-difference', 'interpreter-defect', 'unsupported'];
const labels = ['정확히 일치', '교육 목적상 호환', '의도적 차이', '인터프리터 결함', '미지원'];
const cell = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\r', '\\r').replaceAll('\n', '<br>');
const outcome = r => `stdout=${JSON.stringify(r.stdout)}; ${r.errorType ?? '정상'}; ${r.file ?? '-'}:${r.line ?? '-'}:${r.column ?? '-'}`;
const table = ['| 분류 | 수정 전 | 수정 후 | 작성한 호환성 검사 사례 중 비율 |', '|---|---:|---:|---:|'];
fields.forEach((f, i) => table.push(`| ${labels[i]} | ${before.counts[f] ?? 0} | ${after.counts[f] ?? 0} | ${((after.counts[f] ?? 0) / after.total * 100).toFixed(2)}% |`));
const limits = [
  '- 정수 ±(2⁵³−1), factorial 최대 18 유지. 2⁵³+1은 9007199254740992로 표현되어 CPython 임의 정밀도와 다름.',
  '- 실수 //·%·divmod의 일반 소수·음수·0·-0.0·inf·nan·0 나눗셈 경계 수정. 극단적인 모든 실수 연산/출력 자릿수의 완전 동일성을 보장하지 않음.',
  '- 함수 프레임 128: 감사 wrapper의 f(127)은 완료, f(128)은 제한. 같은 CPython wrapper는 f(997) 완료/f(998) 실패. 제한을 확대하지 않음.',
  '- 컬렉션 10,000 기준(기존 range 물질화 경로 10,001 허용/10,002 제한), 반복 guard 10,000, 명령 1,000,000, 출력 100,000; 학생 except로 제한 우회 불가.',
  '- 난수 알고리즘·숫자/문자열 객체 캐싱·일부 드문 Unicode 판별·dict view 대신 목록·중첩 언패킹 원자성·모듈 저장본 스냅샷/순환 import·VFS 경로·map 안 input은 기존 교육용 정책 유지.',
  '- 미지원: 슬라이스 대입, 제너레이터/iter·next, 복소수, bare * 키워드 전용 인수, 다중 상속·데코레이터·property·descriptor·메타클래스·연산자 오버로딩, 상대/동적/와일드카드 import, 일부 f-string 형식, 전체 표준 라이브러리/전체 turtle/EUC-KR 쓰기.',
  '- 문자열 리터럴 \\r·\\u·\\U는 기존 미지원이며 명확한 한국어 오류. \\n·\\t·역슬래시·따옴표와 실제 Unicode 리터럴은 검증. 미지원 descriptor 코드는 결과만 다르게 실행될 수도 있어 전체 미지원 구문이 항상 거절된다는 보장은 없음.',
];
const verification = [
  '- npm test: 기존 882개 유지 + 원래 결함 46개 + 추가 경계 71개 = **999/999**, 33개 테스트 파일 통과. 기존 예제 76개(기초 11 + 교과서 56 + Core 9) 모두 실행 통과.',
  '- 추가 경계 71개는 CPython 예상값 기반 지원 경계 69개와 명시적인 미지원 이스케이프 오류 2개로 구분. fixtures의 원래 코드/CPython 예상값은 보존.',
  '- npm run build: TypeScript/Vite 프로덕션 성공. 새 의존성·저장 형식 변경 없음.',
  `- 실제 Edge ${browser.browser}: P1 24개 전부 + P2 10개 원인 대표 = 34개 × PC 1440×900/모바일 360×800 = **68회**. 한국어 오류/줄 강조/파일 탭/다음 실행/학생 출력 보존 검사. 내부 pageerror 0.`,
  '- Unicode 파일 실제 저장·재열기·새로고침, 오프라인 Worker/모듈/리스트 참조/결합 map/실수/재귀/input/turtle 모두 통과.',
  '- 문서 탭·예제 임시 실행·저장본만 백업·복원/취소·오프라인 복원·자동 저장 금지·기존 v1.3.2 합성 백업과 IndexedDB/탭 보존 통과. 사용자 실제 브라우저 프로필은 접근하지 않음.',
  '- 세부 증거: compatibility-fixes-browser/results.json, compatibility-core-regression/results.json, compatibility-tabs-regression/results.json, compatibility-examples-regression/results.json, core-v2-upgrade/results.json (모두 artifacts 아래).',
  '- 스크린샷 fixes-1440x900.png / fixes-360x800.png 직접 확인: 가로 넘침·버튼 겹침 없음. 예제 브라우저 검증기의 오래된 56개 필터 기대값만 현행 65개(교과서56+Core9)에 맞춤; 예제 콘텐츠 변경 없음.',
];
const fixes = ['# Python 학습실 v2.0.1 호환성 결함 수정 기록', '', '## 범위와 기준', '',
  `기준 커밋 ${before.environment.commit}, CPython 3.12.14. 기존 714개 코드·입력·파일을 변경하지 않고 양쪽을 새 실행했다. 비교 실행 ${after.comparisonDenominator}개, VM-only 안전/GUI ${after.vmOnly}개는 원래 정책 그대로 별도 집계한다.`,
  '', '**작성한 호환성 검사 사례 중 결과이며 Python 전체 지원률이 아니다.** P1 24/P2 22, 총46개를 수정했고 의도적 차이/미지원으로 돌린 결함은 없다. P0 없음.', '', ...table,
  '', '## 실제 공통 원인 21개', '', '| 원인 묶음 | 원래 사례 수 | 구현 위치 | 수정 |', '|---|---:|---|---|'];
for (const group of groups) fixes.push(`| ${group} | ${defects.filter(r => r.review.group === group).length} | ${changes[group][0]} | ${changes[group][1]} |`);
fixes.push('', '실수 연산은 CPython 3.12.14의 [_float_div_mod](https://github.com/python/cpython/blob/v3.12.14/Objects/floatobject.c) 의미를 기준으로 보정하며 VM 연산과 divmod가 같은 함수를 사용한다.', '', '## 원래 결함 46개 전후와 회귀 테스트', '',
  '아래 코드는 기존 감사의 자체 작성 최소 재현 코드다. 원본 결과는 before-fixes.json, 수정 후는 audit-v2.json에 stdout·종류·파일·줄·열을 보존한다. 모든 ID는 src/runtime/compatibility-defects.test.ts의 독립 테스트 이름이다.', '',
  '| ID | 심각도 | 기능/원인 | 최소 재현 코드 | CPython | 수정 전 VM | 수정 후 VM | 분류/상태 | 회귀 테스트 |', '|---|---|---|---|---|---|---|---|---|');
for (const r of defects) {
  const n = after.results.find(n => n.id === r.id);
  fixes.push([r.id, r.review.severity, `${r.feature} / ${r.review.group}`, r.code, outcome(r.cpython), outcome(r.learningVm), outcome(n.learningVm), `interpreter-defect → ${n.classification} / 수정 완료`, `compatibility-defects.test.ts: ${r.id}`].map(cell).join(' | ').replace(/^/, '| ').concat(' |'));
}
fixes.push('', '## 714개 외 추가 발견 3건', '');
for (const [id, severity, cause] of [
  ['boundary-unicode-iterator-partial', 'P1', '파일 반복자 생성 시 남은 줄을 미리 소비하여 break 뒤 read가 빈 값. 다음 요소 요청마다 한 줄을 읽도록 수정'],
  ['boundary-file-read-negative', 'P2', 'read(-1)을 잘못 거부. 음수 크기는 남은 전체 텍스트 읽기로 수정'],
  ['boundary-file-read-bool', 'P2', 'read(True/False)를 잘못 거부. 정수 크기 1/0으로 처리'],
]) { const b = boundaries.find(b => b.id === id); fixes.push(`### ${severity} · ${id}`, '', cause, '', `CPython 및 수정 후: ${outcome(b.expected)}. 같은 ID의 독립 회귀 테스트 통과.`, '', '```python', b.code, '```', ''); }
fixes.push('새 발견 3건 모두 수정. 미해결 P0/P1 0개, 지원 범위의 확인된 미해결 결함 0개. 이 추가 사례는 원래714 집계에 섞지 않는다.', '', '## 검증', '', ...verification, '', '## 남은 경계·의도적 차이·미지원', '', ...limits);
const report = ['# Python 학습실 CPython 호환성 재감사 (v2.0.1 수정)', '',
  `측정 시각: ${after.environment.time}. CPython ${after.environment.cpython.python}; Node ${after.environment.node}; ${after.environment.os}.`,
  `측정 소스는 기준 커밋 ${after.environment.commit} 위 수정 작업 트리이며 당시 표시 버전 ${after.environment.version}. 최종 배포 커밋과 혼동하지 않는다.`, '',
  `동일714개(양쪽 실행${after.comparisonDenominator}, VM-only${after.vmOnly}). **작성한 호환성 검사 사례 중 결과**이며 전체 Python 호환률이 아니다.`, '', ...table,
  '', '## 측정 원칙', '', '- 원본 ID·코드·입력·파일 불변을 실행기에서 assert. 전체 재검사는 CPython 3.12.14를 새 프로세스로 실행했고 VM도 매번 현재 소스에서 새로 생성했다.',
  '- stdout(입력 prompt 포함), 오류 종류·파일·줄, 완료 여부, VFS 변경을 비교. 한국어 오류 설명 차이는 교육 호환. 오류 열은 양쪽에 보존하되 UTF-8/토큰 기준 차이 때문에 같은 수치를 요구하지 않는다.',
  '- CPython 무한 반복/Tk GUI 안전 사례3개는 원래대로 실행하지 않음. 실제 디스크 fixture는 ignored artifacts 작업 공간, VM은 격리된 VFS만 사용한다.',
  '- 수치의 문자열 일치와 abs/rel 오차를 분리; 안전 정수 밖 결과는 BigInt 문자열로 검증. 집합 표시 순서·교육용 제한은 기존 분류 유지.',
  '- CSV cpythonStdoutJson/vmStdoutJson은 JSON 문자열이다. 개행·따옴표·단독 surrogate까지 손실 없이 보존하며 JSON.parse로 복원한다.',
  '', '## 결함 수정', '', '원래46개(21원인): P1 24/P2 22 전부 수정, exact로30개/교육 호환으로16개 이동. 의도적 차이50/미지원17은 그대로다. 상세 원인·재현·소스·회귀 테스트는 python-compatibility-fixes-v2.0.1.md.', '', ...verification,
  '', '## 경계와 남은 범위', '', ...limits, '', '## 전체714 전후 분류', '', '| ID | 기능 | 이전 | 이후 | 남은 차이 |', '|---|---|---|---|---|'];
for (const n of after.results) report.push(`| ${n.id} | ${cell(n.feature)} | ${before.results.find(r => r.id === n.id).classification} | ${n.classification} | ${cell(n.notes ?? n.differences.join(', '))} |`);
after.counts['interpreter-defect'] = 0;
after.measurementPolicy = before.measurementPolicy;
after.fixReview = { originalDefects: 46, groups: 21, P1: 24, P2: 22, additionalDefectsFixed: 3, unresolved: 0, addedTests: 117, totalTests: 999, fixturesUnchanged: true };
after.browser = browser;
for (const n of after.results) {
  const r = defects.find(r => r.id === n.id);
  if (r) n.fix = { group: r.review.group, severity: r.review.severity, cause: r.review.cause, source: changes[r.review.group][0], solution: changes[r.review.group][1], status: 'fixed', regression: n.id, before: r.learningVm };
  if (n.numeric && /^[+-]?\d+$/.test(n.cpython.stdout.trim()) && /^[+-]?\d+$/.test(n.learningVm.stdout.trim())) {
    const delta = BigInt(n.cpython.stdout.trim()) - BigInt(n.learningVm.stdout.trim());
    n.numeric.integerDelta = String(delta); n.numeric.integerExact = delta === 0n;
  }
}
const csvFields = ['id','category','feature','classification','severity','code','input','files','cpythonStdoutJson','vmStdoutJson','cpythonError','vmError','cpythonFile','cpythonLine','cpythonColumn','vmFile','vmLine','vmColumn','cpythonCompletion','vmCompletion','differences','numeric','notes'];
const quote = x => '"' + String(x ?? '').replaceAll('"', '""') + '"';
const csv = [csvFields.map(quote).join(',')];
for (const r of after.results) csv.push([r.id,r.category,r.feature,r.classification,r.fix?.severity,r.code,JSON.stringify(r.input),JSON.stringify(r.files),JSON.stringify(r.cpython.stdout),JSON.stringify(r.learningVm.stdout),r.cpython.errorType,r.learningVm.errorType,r.cpython.file,r.cpython.line,r.cpython.column,r.learningVm.file,r.learningVm.line,r.learningVm.column,r.cpython.completion,r.learningVm.completion,r.differences.join(';'),JSON.stringify(r.numeric),r.notes].map(quote).join(','));
await writeFile(root + '.json', JSON.stringify(after, null, 2));
await writeFile(root + '.csv', '\ufeff' + csv.join('\r\n'));
await writeFile(root + '.md', report.join('\n') + '\n');
await writeFile('artifacts/python-compatibility-fixes-v2.0.1.md', fixes.join('\n') + '\n');
console.log(JSON.stringify({ total: after.total, counts: after.counts, groups: groups.length, tests: 999, browser: browser.executions }));
