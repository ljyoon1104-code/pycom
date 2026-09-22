# Python Core v2.0 감사 도구

## 재현 가능한 감사 (코드 정리 1단계)

제품 Lexer/Parser/Compiler/VM은 수정하지 않고 실행 환경과 비교 정책만 고정한다.

```powershell
$env:AUDIT_PYTHON = '설치한 CPython 3.12.14 실행 파일 경로'
npm run test:audit
$env:AUDIT_RUNS = '3'
$env:AUDIT_OUTPUT_DIR = 'artifacts/새로운-감사-디렉터리'
# 선택: 기준 커밋의 src가 보존된 별도 디렉터리. 현재 변경을 stash/reset하지 않는다.
$env:AUDIT_VM_BASELINE = '기준 소스 디렉터리'
node audit/python-compatibility/compare.mjs
```

기존 `npm test` 999개와 개발 전용 `npm run test:audit` 36개는 별도로 실행한다. 후자는 실제 CPython 3.12.14가 필요하며 없거나 버전이 다르면 실패한다. 패키지나 브라우저 번들에는 Python 실행기가 포함되지 않는다. 새 의존성은 없다.

- `comparison.mjs`: 메타데이터가 없는 사례는 정확한 출력 비교. `collection-set-order`에만 문자열 따옴표/이스케이프/쉼표를 구분하는 flat scalar set 비교를 적용한다. 리스트·튜플·dict·중첩 set에는 적용하지 않는다. 원소가 같으면 우연히 원문 순서가 같은 경우에도 **교육 호환**으로 일관되게 분류한다.
- `class-default-repr`: 독립적인 기본 객체 repr 줄의 주소만 `<ADDRESS:n>`으로 바꾼다. 번호의 재사용으로 같은 주소/다른 주소 관계를 유지하고 클래스명/종류는 보존한다. 실제 객체 동일성은 기존 `is` 사례에서도 검사한다. VM의 교육용 `<A 객체>`는 CPython 문자열로 변환하지 않고 클래스 이름이 일치할 때만 기존 교육 호환 정책을 인정한다.
- `module-missing-member`: ImportError 메시지의 경로 슬롯에 있는 **실행기가 생성한 정확한 루트**만 `<TEMP_ROOT>`로 바꾼다. 파일명·하위 경로·구분자·경로 탈출 표현은 유지하며 stdout이나 일반 경로 문자열에는 적용하지 않는다. 다른 예외 메시지를 무시하지 않는다.
- `standard-date-today`와 `standard-date-fixed`: 감사의 명시적 날짜를 2026-09-15로 고정한다. date-today는 양쪽 같은 날짜, date-fixed는 기존 VMOptions의 2024-02-29를 그대로 유지하여 의도적 차이를 보존한다. 사례 코드·입력·fixture는 바꾸지 않는다.
- `oracle-process.mjs`: 기존 `-I`가 해시 시드를 무시하던 문제를 해소했다. `-B -S -P -X utf8`, 정리된 환경의 `PYTHONHASHSEED=0`, `PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8`을 사용한다. 외부 PYTHONPATH/HOME/시작 설정과 site 패키지는 차단한다. 버전과 실제 interpreter flags를 warm-up에서 검사한다.
- locale은 C, TZ 요청값은 UTC. Windows는 `tzset`이 없으므로 실제 시간대도 별도 기록하며 날짜 사례는 위 명시적 시계로 고정한다. 입력·프로토콜 UTF-8, 캡처된 CRLF/LF는 그대로 보존한다.
- 각 사례는 새 프로세스/새 작업 디렉터리를 사용하고 낮은 동시성 **1**로 실행한다. 준비/코드/파일 수집은 각각 5초, 프로세스 종료는 2초의 분리된 상한이다. 이전 전체 프로세스 5초를 무작정 늘리지 않았으며 파일 코드 실행 한도도 5초 그대로다. 고유 작업 디렉터리가 이전 파일 재사용/충돌을 방지한다.
- Node는 stdout/stderr를 동시에 끝까지 소비한다. Python 캡처 출력은 합계 UTF-8 2MB, 파일 결과는 2MB, JSON 프로토콜 pipe는 6MB로 제한한다. timeout이면 소유한 프로세스 트리를 종료하고, 종료 후 `finally`에서 검증한 고유 디렉터리만 정리한다. 사용자 파일이나 기존 감사 작업 폴더를 지우지 않는다.
- 단계별 startup/setup/execution/file open·write·close/collection/process exit/cleanup/total 시간을 원시 결과에 남긴다. 학생 예외는 `completion:error`; 실행/파싱/시간 초과/수집/정리 오류만 `harness-error` 및 `audit-error`다. 실패 자동 제외나 자동 성공 재시도는 없다.
- `stable-audit.mjs`: 원래 714개 ID/code/input/files를 검증하고, 매회 새 CPython+VM 실행. 안전상 CPython을 실행하지 않는 기존 3개 GUI/무한 반복 사례는 그대로 VM-only로 명시한다(양쪽 실행 711개). `--reuse`는 허용하지 않는다.
- 결과는 새 디렉터리의 `run-N.json`, `run-N-normalized.json`, `summary.json`, 선택적으로 `baseline-vm.json`에 저장한다. 원시 CPython/VM 결과는 보존하며 원래 역사적 보고서를 덮어쓰지 않는다. 기존 run 파일이 있으면 덮어쓰지 않고 실패한다.
- SHA-256에는 사례 ID/code/input/files/정책, 정규화 CPython, VM 결과, 분류/분야 집계가 포함된다. 생성 시각·PID·측정 시간·실제 임시 루트·환경 메타데이터만 제외한다. 세 hash가 다르거나 `audit-error`/새 결함이 있으면 종료 코드가 실패다.

아래는 v2.0.0/v2.0.1 역사적 보고서용 설명이다. `report.mjs`, `report-fixes.mjs`는 그 원시 JSON 형식 전용이며 안정화 감사 결과를 그 파일에 덮어써 넣지 않는다.

현재 VM과 CPython을 측정하는 개발 전용 도구다. 이 폴더는 제품 번들에 들어가지 않는다. 결과는 Python 전체 호환률이 아니라 작성한 사례 중 일치율이다. v2.0.1 수정은 일반 테스트에 원래 결함46개와 경계71개를 포함한다.

## 실행

```powershell
$env:AUDIT_PYTHON = '설치한 CPython 3.12.14 실행 파일 경로'
node audit/python-compatibility/compare.mjs
$env:VITE_BASE = '/pycom/'
npm run build
npm run preview -- --host 127.0.0.1 --port 4174 --strictPort
# 별도 터미널
node audit/python-compatibility/browser-fixes.mjs
node audit/python-compatibility/report-fixes.mjs
```

CPython 실행기는 `AUDIT_PYTHON` 환경 변수로 명시해야 하며 3.12.14가 아니면 실행을 거절한다. 제품에서 사용하지 않는다. `APP_URL`로 수정 검증 브라우저 주소, `FIXES_ARTIFACTS`로 결과 폴더를 지정할 수 있다. Edge가 설치된 Windows에서 기존 playwright-core 개발 의존성으로 실행한다.

재감사에는 이전 감사의 `artifacts/python-compatibility-audit-v2-before-fixes.json`이 필요하다. 없으면 기존 `python-compatibility-audit-v2.json`을 덮어쓰지 않고 복사해 기준으로 고정한다. 714개 ID·코드·입력·파일이 원본과 다르면 중단한다. 기준 감사 데이터는 로컬에 보존하며 공개 저장소에는 포함하지 않는다. 새 clone에서는 `npm test`의117개 CPython 예상값 기반 회귀를 별도 기준 파일 없이 실행할 수 있다.

- `cases/index.mjs`: 자체 작성 독립 사례와 기존 비교 스크립트의 52개 정적 사례 재사용.
- `run-cpython.py/mjs`: 현재는 위의 단계별 제한/고유 폴더/원시 측정값을 제공하는 실행기다. 실제 EUC-KR 인코딩 fixture 유지.
- `run-learning-vm.mjs`: 현재 소스를 읽는 Vite SSR 로더와 격리된 VM/VFS. 제품에 테스트 우회 코드 없음.
- `compare.mjs`: 현재는 `stable-audit.mjs` 진입점이며 재사용 없이 실행한다. 새 결과 디렉터리를 지정한다.
- `browser.mjs`: 새 Edge 컨텍스트에서 실제 CodeMirror로 37개를 PC·모바일 각각 실행. 출력 echo는 비교할 때만 정규화. CPython과 일치하는지와 UI가 VM을 그대로 보여주는지는 별개다.
- `report.mjs`: 원래 v2.0.0 감사용 기록 생성기. 수정 후에는 실행하지 않는다.
- `browser-fixes.mjs`: P1 24개 전부와 P2 원인별10개 대표를 PC/모바일에서 실행하고 Unicode 저장/재열기·오프라인 기능을 검증한다.
- `report-fixes.mjs`: 원래46개 전후·21원인·추가3개 결함·714개 분류 변화를 Markdown/JSON/CSV로 기록한다. 기존 local 브라우저 결과가 필요하다.

안전 검사 3개(CPython 무한 루프, Tk turtle 두 사례)는 CPython에 실행하지 않으며 분모와 표에서 별도로 밝힌다. 유한 명령 제한 사례는 양쪽에서 실행한다. 기본 객체/따옴표 표시, 미지원 문법, 문서화된 제한은 근거를 적어 별도 분류한다.

감사 결과·학생 데이터·브라우저 상태를 저장소에 push하지 않는다. 자체 작성 재현 코드와 CPython 예상값 fixture만 일반 회귀 테스트로 공개한다. 모든 실행기는 제품 코드와 분리되어 있다.
