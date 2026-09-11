# pycom — 학생용 Python 학습 앱

학생 접속 주소: <https://ljyoon1104-code.github.io/pycom/>

## 학생 사용 방법

1. [학습 앱](https://ljyoon1104-code.github.io/pycom/)을 엽니다.
2. Python 설치 없이 코드를 작성합니다.
3. **실행** 버튼을 눌러 결과를 확인합니다.
4. 필요한 경우 브라우저 메뉴에서 홈 화면에 추가하거나 앱을 설치합니다.
5. 파일은 **저장** 버튼을 눌렀을 때만 저장됩니다.

회원가입이 필요하지 않으며, 작성한 학생 코드가 서버로 전송되지 않습니다. 최초 온라인 접속 후에는 필요한 앱 파일이 저장되어 오프라인에서도 사용할 수 있습니다.

`.py`, `.txt`, `.csv` 파일은 현재 기기의 브라우저 저장소에 보관됩니다. 기기를 바꾸려면 **내보내기**와 **가져오기**를 사용하세요. 자동 저장은 하지 않습니다.

## 간편 실행

1. `앱 실행하기.cmd`를 더블클릭합니다.
2. 브라우저가 자동으로 열릴 때까지 기다립니다.
3. 앱을 종료하려면 실행 중인 검은색 창을 닫습니다.

휴대폰·태블릿에서는 실행 창에 표시된 `Network` 주소를 입력해 접속할 수 있습니다. 휴대폰·태블릿과 PC는 같은 Wi-Fi에 연결되어 있어야 합니다.

## 웹 앱과 오프라인 사용

일반 웹 주소로 접속해도 모든 기능을 사용할 수 있습니다. 처음 온라인으로 접속한 뒤에는 브라우저 메뉴의 **홈 화면에 추가** 또는 **앱 설치**를 선택해 앱처럼 열 수 있습니다. iPhone·iPad에서는 공유 버튼에서 **홈 화면에 추가**를 선택하세요.

## 기본 표준 라이브러리 (11단계)

- 허용된 모듈은 앱에 포함된 `random`, `datetime`뿐입니다. 일반 사용자 모듈·외부 패키지·네트워크 import는 지원하지 않습니다.
- `import random as rnd`, `import datetime`, `from datetime import date as Date`를 사용할 수 있습니다. 지원하지 않는 가져오기는 `ImportError`로 처리합니다.
- `random.seed`, `randint`, `randrange`, `choice`, `sample`을 지원합니다. 실행별 Mulberry32 상태를 사용하며 같은 시드·호출 순서는 재현됩니다. CPython과 시드별 난수열이 같다는 의미는 아니며 보안용 난수가 아닙니다.
- `sample`은 원본 위치를 중복 선택하지 않는 비복원 추출이며 원본을 변경하지 않습니다. Python처럼 원본에 같은 값이 여러 번 들어 있다면 서로 다른 위치의 같은 값이 선택될 수 있습니다. 한 번에 최대 10000개를 선택합니다.
- `date(year, month, day)`, `date.today()`, 연·월·일 속성, 문자열 출력, 날짜 비교를 지원합니다. 오늘은 학생 기기의 현지 날짜입니다. 테스트는 VM의 시계 공급자를 주입하며 시스템 시간을 바꾸지 않습니다.
- 두 모듈은 Worker 번들에 포함되어 오프라인에서도 실행됩니다. 모듈·날짜 속성은 읽기 전용이며 전체 random API, datetime.datetime, 시간대·날짜 간격은 제외합니다.

## EUC-KR 텍스트 가져오기 (12단계)

- TXT·CSV 파일 가져오기에서 **자동 감지 / UTF-8 / EUC-KR**을 선택할 수 있습니다. 자동 감지는 UTF-8 BOM, 엄격한 UTF-8, EUC-KR 순서로 판별합니다.
- `open(..., encoding="euc-kr")`와 `cp949`, `euc_kr`, 대소문자 별칭으로 가져온 한글 텍스트를 읽을 수 있습니다. 앱 안에서는 안전하게 디코딩한 Unicode 텍스트를 사용합니다.
- EUC-KR은 읽기만 지원합니다. `w`·`a` 모드와 내보내기는 UTF-8만 지원하며, EUC-KR로 쓴 것처럼 표시하지 않습니다.
- 파일명·내용·가져오기 인코딩·원본 바이트 크기·수정 시각은 현재 기기의 IndexedDB에 저장됩니다. 기존 파일은 삭제하지 않고 UTF-8 메타데이터를 보충합니다.

## 교육용 turtle 그래픽 (13단계)

- `import turtle`, `turtle.Turtle()`, `turtle.done()`과 `turtle.mainloop()`를 지원합니다. 실행 결과에서 **그래픽** 탭이 자동으로 열리고, 텍스트 출력은 **텍스트** 탭에서 함께 확인할 수 있습니다.
- 이동·회전: `forward`/`fd`, `backward`/`back`/`bk`, `right`/`rt`, `left`/`lt`, `goto`/`setposition`/`setpos`, `home`, `setheading`/`seth`를 지원합니다.
- 펜·상태: `penup`/`up`/`pu`, `pendown`/`down`/`pd`, `pencolor`, `color`, `pensize`/`width`, `clear`, `reset`, `hideturtle`, `showturtle`, `speed`, 좌표·방향 조회를 지원합니다. 색상은 기본 색상 이름과 `#RRGGBB`만 허용합니다.
- 그래픽 명령은 Worker가 Canvas에 직접 접근하지 않고 메인 화면으로 전달합니다. 한 실행은 최대 5000개 명령으로 제한되며, 제한 초과는 `except`로 우회할 수 없습니다.
- `circle`, `dot`, 채우기, 키보드·마우스 이벤트, 애니메이션 콜백, 이미지 도형, 다중 화면과 전체 turtle 표준 라이브러리는 지원하지 않습니다.

API 의미 참고: [Python random](https://docs.python.org/3/library/random.html), [Python date](https://docs.python.org/3/library/datetime.html#date-objects).
