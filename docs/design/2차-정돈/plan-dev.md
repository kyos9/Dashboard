# 디자인 2차 계획 검토 — 개발자 입장

대상: `docs/design/2차-정돈/plan-draft.md` @ ad9ba7f. 읽기만 했다. G1 은 저장소 밖 복사본(`/tmp/claude-0/work/plan-review/vitecheck`)에서 빌드해 확인했다.
심각도: **막음**(이대로면 2-2 위반이거나 못 만든다) · **고쳐야 함**(계획 문장을 고친다) · **참고**.

결론: 막음 없음. 고쳐야 함 6건. A2·A3·A6·B1·B3·B5 는 "같은 컴포넌트 안 배치 + 문구"로 된다. A4·A5·A10·B4 를 "주인에게"로 둔 판단은 맞다. 다만 A10 은 데이터가 팝업에 없고, B4 는 테스트 틀을 같이 고쳐야 한다(아래).
`lib`·`api`·`types.ts`·`AppState.tsx` 는 어느 항목도 건드리지 않아도 된다. `buyRule`·`cardConditions`·`METRIC_ORDER` 는 이미 export 되어 있어 읽어서 쓰기만 하면 된다.

## 항목별

**A1 (카드 → 목록, CSS)**
- 찬성: `.stock-card .stat-box` 로 범위를 묶어서 재무의 `.stat-box`(FundamentalsPanel.tsx:52, index.css:3124)에는 번지지 않는다.
- 걱정 · **고쳐야 함**: 시안의 `.stock-card { flex-direction:row; flex-wrap:wrap }`·`.stock-card > * { flex:1 1 100% }` 가 매크로 카드에도 걸린다 — `MacroPanel.tsx:254` 가 `className="stock-card macro-card"` 를 쓴다. 폰 매크로 화면의 배치·간격이 바뀌어도 자동 검사는 회귀로 못 잡을 수 있다.
- 제안: 시그널 카드에만 클래스를 하나 더 붙인다(`stock-card signal-card`, Dashboard.tsx:1377 — className 은 해도 되는 것). 시안 선택자도 그 클래스로 바꾼다.
- 참고: 시안 안에 `.stat-box { padding }` 이 두 번 있다(8px → 6px). 하나로 합친다.

**A2·A3 (조건 칩을 "매수 조건" 한 줄로)**
- 찬성: 같은 컴포넌트(`SignalCards`, Dashboard.tsx:1349~) 안의 배치 변경이라 2-2 의 "해도 되는 것"이다. 필요한 데이터가 이미 그 안에 다 있다(`rules`·`cardConditions(card)`). `buyRule(rules).conditions.map(...)` 로 칩을 그리면 칸이 없는 조건도 나온다. 그러면 A3 이 카드에서는 풀린다. 이 방식이면 `ConditionTag` 를 metric 대신 condition 을 받게 바꾸거나 그 자리에 바로 쓰게 된다. 파일 사이로 옮기지 않으니 "나누기·합치기"는 아니다. 의견서에 그렇게 밝혀 둔다.
- 걱정 1 · **고쳐야 함**: 초안은 칩 순서를 "규칙에서 받은 순서"로 적었다. 그런데 화면은 칸 순서로 늘어놓는 것이 정해진 규칙이다 — `buyRuleSentence` 가 `METRIC_ORDER` 로 다시 정렬하고, 주석에 "정의의 순서는 AI 지시문이 쓴다, 화면에서만 칸 순서로"라고 적혀 있다(signalRules.ts:111~124). 받은 순서로 그리면 설명 줄·표 열과 칩 순서가 달라진다. → 같은 rank 로 정렬하도록 문장을 고친다.
- 걱정 2 · **고쳐야 함**: A3 이 표에서는 안 풀린다. 표는 지표 열 넷을 박아 두었고(Dashboard.tsx:1068~1080 `MetricHead metric=…`, 1113~1146), 칸이 없는 조건은 표에서 지금처럼 사라진다. 합격 기준 "카드·표에 조건 하나 더"는 넘침만 재므로 "조건이 보이는지"를 못 잡는다. → 범위를 적는다. 예: "표는 3차" 또는 "종합 신호등 칸 title 에 전체 조건".
- 참고: `ConditionTag` 주석(Dashboard.tsx:80~84 "숫자 옆에 두면 바로 읽힌다")은 1차 판단과 반대 방향이다. 주석을 같이 고치고, 문구 변경 표에 이유를 남긴다.

**A4·A5** — 찬성. A4 는 새 접기 상태다. A5 는 `QuickFilter` 에 값이 하나 늘고(Dashboard.tsx:59) 거르는 식도 늘어난다(551, 630). 둘 다 "먼저 물을 것"이 맞다.

**A6 (매도 + 매수 검토를 한 줄로)**
- 찬성: 카드는 CSS 만으로 된다. `.traffic` 과 `.badge-row` 가 형제다(Dashboard.tsx:1400~1409). 표는 이미 한 줄이다(`.signal-cell-row`).
- 걱정 · **고쳐야 함**: "비중" 이름표의 자리를 정하지 않았다. 배지 글자에 넣으면 0장 "배지 이름은 짧게"와 부딪친다. 표의 `.signal-cell-row` 안에 넣으면 Dashboard.test.tsx:320~330 이 깨진다(자식 글자를 그대로 비교한다). → "배지 밖 이름표, 카드에만"으로 적는다.

**A7** — 찬성. `.metric-chip.blue` 하나만 고치면 된다. 쓰는 곳이 Dashboard.tsx:257 하나뿐이라 다른 화면으로 번지지 않는다. 참고: 톤 이름 `'blue'` 는 `lib/display.ts:209,230` 이 정하므로 이름은 그대로 두고 CSS 만 바꾼다. `.badge-blue`(매크로)·`.count-chip.blue` 는 건드리지 않는다.

**A8 (sticky)**
- 걱정 · **고쳐야 함**: `data-table fixed` 를 쓰는 표가 넷이다(Dashboard.tsx:1058·1230, StockManager.tsx:461, RebalancePanel.tsx:1334). → 시그널 표에만 클래스를 붙이고 그 클래스로 범위를 묶는다.
- 참고: sticky 칸은 바탕이 불투명해야 한다. 그런데 줄 hover(index.css:1132)·`.flash td`(4631)·`tr.dragging td`(2083)는 반투명 바탕을 쓰므로 sticky 칸에 따로 맞춘다. `th` 는 이미 `sticky; top:0` 이다(1106). 왼쪽 위 모서리 칸의 z-index 를 더 높인다. `border-collapse: collapse` 에서는 sticky 칸의 테두리가 사라지므로 box-shadow 로 대신한다.

**A9 (제목·범례)**
- 찬성: ChartModal 안에서 끝난다(h3 175, hint 176).
- 참고: 미국 종목은 `stockLabel` 이 늘 티커를 돌려준다(display.ts:42). 그래서 미국 종목은 모두 "이름 = 티커"가 된다. 비교 함수는 `lib` 에 넣을 수 없으니 파일마다 한 줄씩 둔다. `ChartLegend` 는 더보기 안 차트(HistoryChart.tsx:104)도 쓴다 — 바꾸면 두 곳이 같이 바뀌니 둘 다 확인한다. "13번" 툴팁에 숫자를 직접 적지 않는다.

**A10 (팝업에 오늘 조건)**
- 걱정 · **고쳐야 함**(주인에게 물을 때 같이 적을 것): 팝업에는 이 데이터가 **없다**. ChartModal 은 `ticker`·`name` 만 받는다(ChartModal.tsx:89~95). `HistoryResponse` 에는 markers 만 있다(types.ts:326). 그래서 고르면 세 가지가 따라온다.
  1. 새 prop. Dashboard 는 `chart.card` 를 갖고 있어 넘길 수 있다(Dashboard.tsx:347·957).
  2. 칩 줄을 `Dashboard.tsx` 에서 `components/` 로 옮기기 — 컴포넌트 나누기다.
  3. 재무 화면(FundamentalsPage.tsx:157)과 더보기 차트에서 열면 데이터가 없어 줄이 비거나 숨는다.
- 참고: 칩 이름은 규칙에서 받는다. 초안 예시처럼 "이격도·ADX"를 적어 넣지 않는다.

**A11** — 찬성. 그대로 둔다.

**B1 (금액 줄)** — 찬성. 같은 `<li>` 안에서 `<p>` 를 둘로 나누고 `.nowrap` 으로 감싸면 된다(RebalancePanel.tsx:1155~1163). 제안: 원화 금액과 `(외화)` 를 각각 묶는다. 둘을 한 덩어리로 묶으면 큰 금액에서 폰 360 칸을 넘을 수 있다.

**B2** — 찬성. 문구만 바뀐다(`ActionBadge` 766~768, `SignalBadges` 771). "참고" 이름표는 A6 과 같이 배지 밖에 둔다.

**B3** — 찬성. 같은 `<td>` 안에서 `cat-tag`+이름을 기존 `.stock-line` 으로 감싸면 된다(RebalancePanel.tsx:1219~1223). 걱정 · 참고: `.ticker-cell` 의 방향을 CSS 로 바꾸면 대시보드·종목 관리에도 번진다. 마크업으로 푼다.

**B4** — 찬성. "먼저 물을 것"이 맞다. 걱정 · **고쳐야 함**: RebalancePanel 은 지금 Router 를 쓰지 않는다. 테스트도 Router 없이 그린다(RebalancePanel.test.tsx:97~103). 그래서 `<Link>` 를 넣으면 이 파일의 테스트가 **전부** 깨진다. → 고르면 테스트 틀을 `MemoryRouter` 로 감싸는 일까지 계획에 넣는다.

**B5** — 찬성. 제목·도움말·placeholder 글꼴 모두 그 컴포넌트 안에서 된다(StockManager.tsx:354~433). 참고: placeholder 글꼴은 `.form-grid input::placeholder` 로 범위를 묶는다. `NumberInput` 전역에 걸면 리밸런싱·편집 팝업에도 번진다.

**G1 (preload)**
- 찬성: 확인함. `index.html` 에 `<link rel="preload" as="font" type="font/woff2" crossorigin href="/src/assets/fonts/WantedSansVariable-ko.woff2">` 를 넣고 Vite 8 로 빌드했다. 결과는 CSS 와 **같은** `/assets/WantedSansVariable-ko-CpWy4kmq.woff2` 로 바뀌었고 파일은 하나만 나왔다. 서비스 워커는 `/assets/` 를 캐시 먼저로 받으므로(sw.js:88) 따로 손댈 것이 없고 `VERSION` 도 그대로 둔다. `prefs.test.ts:219` 는 `<script>` 만 뽑아 쓰므로 영향이 없다.
- 걱정 · 참고: `crossorigin` 이 없으면 글꼴을 두 번 받는다. 또 글꼴(297 KB)이 첫 화면 JS(gzip 110 KB)와 대역폭을 나눠 쓴다. 느린 연결에서는 첫 그림이 늦어질 수 있다. → 합격 기준에 "느린 연결에서 첫 그림 시간 전후"를 넣는다. "차트 코드 미리 받기"는 이미 idle 뒤라(chartChunk.ts:18~23) 비교 대상이 아니다.

## nth-child (질문 6)
A2 로 4번째 자식(`ConditionTag`)이 빠지면 `:nth-child(4)` 는 그냥 걸리지 않는다. 그 자체로는 깨지지 않는다. 다만 다음 두 경우에는 깨진다.
- "매수 조건" 줄을 `.stat-grid` 안에 `.stat-box` 로 넣으면, 그 안의 칩에 1~4번 규칙이 걸려 첫 칩이 흐리게 칠해진다.
- 값에 `span` 을 감싸는 등 자식이 하나 늘면 순서가 밀린다.
→ 칩 줄은 `.stat-grid` 밖에 자기 클래스로 둔다. 선택자는 순서 대신 클래스로 쓴다(`> .k:first-child`, `> .v`, 풀이에 `k-note` 클래스 추가). `.stat-box .v` 는 Dashboard.test.tsx:966 이 쓰므로 그대로 둔다.

## 고칠·더할 테스트
- 바뀐다: RebalancePanel.test.tsx:724·736(SELL/HOLD → 팔기/유지). B4 를 고르면 97~103(Router)과 237(빈 상태 단추).
- 지켜야 한다: Dashboard.test.tsx:320~330(`.signal-cell-row` 자식 글자), 966(`.stat-box .v`), 304·408(표 `aria-label` "… 충족"). StockManager 의 `/종목 추가/` 는 button 역할로 찾으므로 제목을 바꿔도 된다.
- 지금 없어서 더할 것: "매수 (BUY)"·"관심 종목 추가"·"구간"·차트 제목·placeholder 를 보는 테스트가 없다(grep 0건). 문구 변경 표와 1:1 로 맞추려면 새로 쓴다. A2 는 Dashboard.test.tsx:815~ 의 다섯 조건(rsi_low) 자료로 "카드에 칩 다섯"을 확인하면 된다.

## git status
```
$ git -C /home/user/Dashboard status --short
 M docs/design/audit.mjs
```
이 변경은 내가 만든 것이 아니다. 검토를 시작할 때 `status --short` 는 비어 있었다. 그 파일은 01:44:56 UTC 에 바뀌었다. 내용("조건 하나 더" 화면 `-xcond` 추가)으로 보아 총괄이나 다른 검토자가 동시에 고친 것이다. 나는 저장소 안 파일에 쓰지 않았다. 빌드 확인도 `/tmp` 복사본에서 했다.
