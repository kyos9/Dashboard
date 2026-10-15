# 디자인 2차 계획 검토 — 검토자 (읽기만, ad9ba7f / 시작 4109146)

결론: 방향(A 시그널 → B 리밸런싱·종목 관리, CSS 위주)에는 **찬성**한다. 다만 합격 기준 세 줄은 이대로 두면 잴 수 없거나 처음부터 통과할 수 없다(막음 1, 고쳐야 함 6).

## 1. 2-2·6장 위반
- 찬성: 말줄임·칸 수 고정·이중 축을 쓰는 제안이 없다. A3가 칩을 흐르게 하는 것은 0장에 맞다. A4·A5·B4를 "주인에게"로 둔 것도 맞다.
- 걱정(고쳐야 함): 시안 CSS가 `.stock-card` 전체를 바꾼다(`flex-direction:row; flex-wrap`, `.stock-card > * {flex:1 1 100%}`). 그런데 매크로 카드도 `stock-card`다(MacroPanel.tsx:254). 그대로 옮기면 폰 매크로 화면이 회귀한다. 선택자를 `article.stock-card[data-ticker]`이나 새 클래스로 좁혀야 한다.
- 걱정(고쳐야 함): A7 "추세 형성"·"거래량 증가"의 파랑은 lib/display.ts:209,230 의 `tone:'blue'`에서 온다. lib은 diff 0이어야 하니 CSS로만 바꿔야 한다. 이때 `.blue`는 `callout.blue`(매크로)와 같이 쓰이므로 시그널 칩 안으로 좁혀야 한다. 빨강 모드의 `--down`은 `--blue`다(index.css:138). 새 중립 강조색은 두 테마 값을 다 정하고, 대비를 빨강+라이트에서도 재야 한다. 지금 조건에는 `ph390-dark-risered`만 있다.
- 참고: A10(팝업에 오늘 조건)은 ChartModal에 새 prop이 필요하다(지금 Props는 ticker·name뿐, ChartModal.tsx:103). A2 칩 줄을 "재사용"하면 컴포넌트 나누기도 된다. 둘 다 "먼저 물어야 하는 것"이다. 재무 화면에서 여는 팝업에는 카드가 없다(FundamentalsPage.tsx:157). 주인에게 물을 때 이 점을 같이 적는다. A9 "이름 = 티커면 한 번"은 `stockLabel`(lib/display.ts:35)을 고치지 말고 컴포넌트에서 처리한다.

## 2. 기준선 없이 쓴 합격 기준
- 걱정(고쳐야 함): **카드 높이 480**의 기준 596은 시안을 찍으며(addStyleTag) 눈으로 잰 값이다. results.json에는 숫자가 없다. 480 자체도 "예상 ~430"이라는 추정에서 나왔다. audit.mjs에 `dash-signal-cards` / ph390-dark에서 `article.stock-card` 높이의 중앙값·최대를 적는 칸을 넣고 지금 코드로 기준선을 다시 떠야 한다. 데모 시세는 날짜에 따라 바뀌므로 잰 날짜도 함께 적는다.
- 걱정(고쳐야 함): **"조건 하나 더"** 화면은 기준선에 없다. 지금 코드로 먼저 재 둬야 A3가 실제로 고쳐졌는지 보인다.
- 걱정(막음): **외톨이 문단 "전체 기준선의 20% 이하"** — 2차 기준선의 문단 10개는 사용자 목록 8, 매크로 금리차 2다. 모두 C1이고, 계획은 이를 3차로 미뤘다. 20%를 2개로 읽으면 처음부터 통과할 수 없다. 1차 기준선(120의 20% = 24)으로 읽으면 이미 통과다. 어느 기준선인지 숫자로 박아야 한다. 아니면 C1의 `.user-meta`·callout 문단을 B에 넣는다.
- 걱정(고쳐야 함): 숫자가 틀렸다. 재무 날짜 갈라짐은 **8**이다(fundamentals 8조건 모두 `-15`). 7이 아니다. 7+3+2=12라 "13"과도 맞지 않는다. 계획대로 "재무 7 이하"면 기준선부터 불합격이다. "30화면 × 8조건"도 실제로는 237조합이다(PC 29 × 3, dash-holding-open 은 5).
- 참고: 재무의 일본 종목명 버튼 외톨이 5와 폰 360 2줄 2는 1차에 "2차 범위"로 넘긴 것이다(02-실행검토.md:71). 이번에 또 3차로 미루려면 주인 보고에 따로 적는다. 3-2의 "버튼 0"에 대한 예외이기 때문이다.

## 3. 잴 수 있게 — "조건 하나 더" 재는 법 (제안)
- 걱정(고쳐야 함): 계획은 "DOM에 끼워 넣는다"고 했다. 그렇게 하면 CSS만 잰다. A3의 진짜 문제는 "칸이 없는 조건은 그려지지 않는다"이다(Dashboard.tsx:86–89 `if (!condition) return null`, 지표 칸 네 개가 하드코딩). DOM에 끼우면 이 문제가 있어도 통과한다.
- 제안: audit.mjs에서 `page.route('**/api/signal-rules')`로 buy 규칙의 `conditions`에 `{key:'squeeze', metric:'squeeze', label:'변동성 축소(20일)', header, formula, detail}`를 하나 더한다. `page.route('**/api/dashboard')`로는 각 카드의 `buy_conditions.squeeze`를 true·false·null로 돌려 넣는다. `version`은 두 응답에서 맞춘다(signalRules.ts:51 다시 받기 방지). 이렇게 `dash-signal+cond`, `dash-signal-cards+cond`, `modal-chart+cond`(A10을 고르면) 화면을 8조건에서 잰다. 검사도 하나 더한다. **`cond-missing`** = 카드(또는 표 줄)마다 그려진 조건 칩 수 ≠ `conditions.length`. 기준선에서는 카드마다 1이 나와야 맞다.
- 걱정(고쳐야 함): `kind()`(audit.mjs의 `/badge|chip|pill|tag/`)는 조건 칩 클래스 `cond`를 badge로 보지 않고 para로 센다. 그래서 칩은 folded3·"배지 외톨이 0"에서 빠진다. `cond`를 kind에 넣거나 새 칩에 `chip` 클래스를 붙여야 "3줄 접힘 0"을 잴 수 있다.
- 걱정(고쳐야 함): "묶음 A·B 화면"을 audit 화면 이름으로 적는다. 예: `dash-signal, dash-signal-cards, dash-signal-edit, modal-thresholds, modal-chart*, rebalance, guest-rebalance, stocks, new-stocks, modal-stock-edit` + `+cond` 화면. 종목 관리의 날짜 갈라짐 3(`176종목(2026-09 기준)`)은 B5 제안에 없다. 하지만 0 기준에 걸리므로 B5에 넣는다.
- 참고: A4를 고르면 `dash-signal-cards`의 act(`카드 보기` 단추)가 열리지 않는다. 그때 잣대를 고친 것은 기록에 남긴다.

## 4. 넓힌 숫자 식의 헛것
- 찬성: 29건을 하나씩 보았다. 리밸런싱 15(`+₩…`), 날짜 13(`-15`·`-09`), 포트폴리오 150% 1(`+₩20,145,600`)로, 모두 실제로 갈라진 것이다. "1~3", "-DI > +DI", "DGS10 − DGS2"는 맞지 않는다(셋째 갈래는 부호 바로 뒤에 숫자가 있어야 한다). 헛것은 없다.
- 참고: 날짜는 `2026` 쪽이 아니라 `-10`·`-15` 조각으로 잡힌다. "2026-" / "10-15" 같은 갈라짐은 잡지만, 보고에 나오는 match 이름이 헷갈린다. 텍스트 노드 하나 안에서만 재므로 `<span>+</span><span>₩…</span>`처럼 요소를 나눈 갈라짐은 못 잡는다. B1에서 금액을 span으로 나누면 거짓 0이 될 수 있다. 묶음 클래스를 단 요소 단위로 한 번 더 재기를 권한다.

## 5. 회귀 자리
- `.stat-box`: 재무 패널도 쓴다(FundamentalsPanel.tsx:52, index.css:3124). 시안은 `.stock-card` 안으로 좁혀서 괜찮다. 그러나 `nth-child(1–4)` 자리 선택자라 A2로 칩을 빼면 칸 배치가 달라진다. 자식 클래스로 바꾼다(참고).
- sticky(A8): `table.data-table th`는 이미 `sticky; top:0`이다(index.css:1106). data-table은 5개 화면 9곳에서 쓴다. `.data-table td:first-child`처럼 넓게 걸면 포트폴리오·리밸런싱·재무·종목 관리 표로 번진다. 시그널 표 클래스로 좁히고, 머리 첫 칸은 top+left·z-index를 함께 준다. 바탕은 불투명 토큰을 쓴다. `tr.dirty td`는 반투명(index.css:4800 근처)이라 종목 설정 표에서 비친다. 자동 검사는 겹친 글을 못 잡으니 눈으로 본다(고쳐야 함: 합격 기준에 "시그널 표 외 sticky 0" 한 줄).
- 폰 분기: 시안은 640px만 쓴다. 641–720 구간(분기점이 둘이다)에서 상자형과 목록형이 섞이지 않는지 본다. 조건에 700px 하나를 더하거나 눈으로 본다(참고).

## 6. 시작 때 실패한 백엔드 테스트
- 걱정(고쳐야 함): CI(tests.yml:75)가 `pytest -q`를 돌린다. 그러면 이 날짜 의존 실패가 있는 날에는 "CI 초록"을 맞출 수 없다. backend 테스트는 diff 0이라 디자인 차수에서 고칠 수도 없다. 그런데 날이 바뀌면 통과할 수도 있다. 기준을 이렇게 바꾼다. 백엔드는 "실패 목록 ⊆ {test_demo_custom_thresholds_shows_my_thresholds}, passed ≥ 1363". 같은 날 4109146에서 같은 명령으로 실패하는 것을 보이고 출력을 파일로 남긴다. CI는 "프런트 잡 초록, 백엔드는 그 한 건만 실패". 고치는 일은 키우기 라운드로 넘긴다고 끝 보고에 적는다.

## 문서 손질 (참고)
- 문제 표 B1의 "왜 문제인가" 칸이 치환 오류로 깨졌다("…포트폴리오 표 확대 150% 1)_REB)").

## git status
```
$ git -C /home/user/Dashboard status --short
(출력 없음 — 작업 트리 깨끗)
```
