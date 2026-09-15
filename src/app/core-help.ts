export const CORE_HELP = `<h3>교육용 Python Core v2.0</h3>
<p>Python 전체가 아닌 초·중급 학습용 범위입니다. 코드는 기기 안의 자체 인터프리터에서 실행합니다.</p>
<ul><li>제어: for/while else, 조건 표현식, break/continue, 재귀, raise, try/except/else/finally, assert, del</li>
<li>자료: 리스트·튜플·딕셔너리·집합, 리스트/딕셔너리/집합 내포, step 슬라이싱, 별표 언패킹</li>
<li>함수: 기본값·키워드·*args·**kwargs, 람다, 중첩 함수·클로저·nonlocal</li>
<li>내장: abs, round, pow, divmod, enumerate, zip, sorted, reversed, any, all, chr, ord, bin, oct, hex</li>
<li>메서드: 리스트 sort/key/reverse와 편집·복사, 문자열 검색·분리·정렬·대소문자·판별, 딕셔너리 update/setdefault/pop/fromkeys</li>
<li>클래스: 단일 상속, 상속된 생성자·메서드, 사용자 클래스의 isinstance/issubclass, 인수 없는 super()</li>
<li>모듈: 명시적으로 저장한 같은 저장소의 .py 파일, random, datetime.date, math, 교육용 turtle</li></ul>
<p><strong>모듈 파일을 먼저 저장하세요.</strong> 실행 시작 시 저장된 파일만 가져옵니다. 다른 탭의 미저장 초안은 사용하지 않습니다. 모듈은 실행당 한 번 초기화되고, 오류에는 실제 파일 이름이 표시됩니다.</p>
<p>값 비교는 <code>==</code>, None 같은 단일 객체 확인이나 공유 객체 확인은 <code>is</code>를 사용하세요. 숫자·문자열의 CPython 객체 캐싱은 복제하지 않습니다.</p>
<p>실수는 1.0, -0.0, inf, nan 표기를 유지합니다. 정수 정밀도는 ±(2⁵³−1) 범위이며 임의 정밀도 정수는 지원하지 않습니다. math.factorial은 정확한 정수 범위를 위해 18까지 지원합니다. 문자열 Unicode 대소문자/판별 및 극단적인 실수의 마지막 자릿수는 CPython과 차이가 있을 수 있습니다.</p>
<p>안전 제한: 함수 호출 128단계, 명령 1,000,000개, 반복/컬렉션 10,000개, 출력/문자열 약 100,000자. 중지와 제한은 except로 잡을 수 없습니다. map 안의 input은 지원하지 않으며, 정렬 key 안의 input과 중지는 지원합니다.</p>
<p>문자열 이스케이프는 줄바꿈(\\n), 탭(\\t), 역슬래시와 따옴표를 지원합니다. \\r·\\u·\\U 표기는 지원하지 않는 이스케이프 오류입니다. 한글·emoji·결합 문자는 직접 입력할 수 있습니다. 파일 읽기는 CRLF/CR을 LF로 반환하며 Unicode 코드 포인트로 글자 수를 셉니다. 읽기만으로 저장 원문을 바꾸지 않습니다.</p>
<p>step 슬라이싱은 읽기·삭제만 지원하며 슬라이스 대입은 제외합니다. 중첩 언패킹 실패 시 모든 대상의 부분 변경을 막는 정책과 딕셔너리 keys/values/items의 목록 반환은 CPython과 다릅니다.</p>
<p>계속 제외: yield·제너레이터 표현식, async/await, 데코레이터, 다중 상속, property·descriptor·메타클래스, 패턴 매칭, 패키지/폴더/상대/동적 import, 외부 패키지, 전체 표준 라이브러리와 전체 turtle, EUC-KR 쓰기.</p>`;
