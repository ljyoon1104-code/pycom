# Python Core v2.0 감사 도구

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
- `run-cpython.py/mjs`: 사례마다 새 CPython 프로세스, 5초 timeout, 2MB 출력 버퍼. 파일은 ignored artifacts의 사례별 작업 공간에만 생성. 실제 EUC-KR 인코딩 fixture 사용.
- `run-learning-vm.mjs`: 현재 소스를 읽는 Vite SSR 로더와 격리된 VM/VFS. 제품에 테스트 우회 코드 없음.
- `compare.mjs`: stdout/예외 종류/파일·줄/파일 변경/완료 비교. 선택적인 `--reuse`는 동일 커밋과 동일 입력의 CPython 결과만 재사용하며 VM은 반드시 현재 소스에서 다시 실행한다. 완전 재검사는 기본 명령을 사용한다.
- `browser.mjs`: 새 Edge 컨텍스트에서 실제 CodeMirror로 37개를 PC·모바일 각각 실행. 출력 echo는 비교할 때만 정규화. CPython과 일치하는지와 UI가 VM을 그대로 보여주는지는 별개다.
- `report.mjs`: 원래 v2.0.0 감사용 기록 생성기. 수정 후에는 실행하지 않는다.
- `browser-fixes.mjs`: P1 24개 전부와 P2 원인별10개 대표를 PC/모바일에서 실행하고 Unicode 저장/재열기·오프라인 기능을 검증한다.
- `report-fixes.mjs`: 원래46개 전후·21원인·추가3개 결함·714개 분류 변화를 Markdown/JSON/CSV로 기록한다. 기존 local 브라우저 결과가 필요하다.

안전 검사 3개(CPython 무한 루프, Tk turtle 두 사례)는 CPython에 실행하지 않으며 분모와 표에서 별도로 밝힌다. 유한 명령 제한 사례는 양쪽에서 실행한다. 기본 객체/따옴표 표시, 미지원 문법, 문서화된 제한은 근거를 적어 별도 분류한다.

감사 결과·학생 데이터·브라우저 상태를 저장소에 push하지 않는다. 자체 작성 재현 코드와 CPython 예상값 fixture만 일반 회귀 테스트로 공개한다. 모든 실행기는 제품 코드와 분리되어 있다.
