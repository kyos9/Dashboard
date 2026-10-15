# 디자인 2차 — 묶음 A + B + 어포던스 검토 (검토자, worktree, `968cb87`)

# 판정: 조건부 합격

G1 글꼴 preload(`074d19e`)는 **되돌림**이다. 계획의 합격 기준 "느린 연결 첫 그림이 전보다 늦지 않다"를 실제로 재 보니 첫 글자 그림(FCP)이 Fast 3G에서 +2.1초, Slow 3G에서 +7.8초 늦어졌다.
나머지 A·B·어포던스는 기준을 넘었다. 기능 불변, 검증, 자동 검사 285조합에서 회귀 0, cond-missing 270→0, 카드 596→487, fake-button 222→9, quiet-target 276→0을 확인했다.
보완은 아래 표의 "보완" 줄들이다. 차트 팝업 포커스 가두기는 시작 화면부터 없던 것이라 회귀는 아니다.

본 범위: 시작 `4109146` → `968cb87`. 화면 커밋은 074d19e, 3eb7a40, 03ae579, a5879b1이다.
잰 자리: 내 worktree에서 `npm ci && npm run build`를 하고, 가짜 서버 8170(`--data-dir /tmp/claude-0/work/review-ab-data --reset`)에서 쟀다. 서버는 끝에 PID 12922로 껐다.
같은 날 기준선은 시작 화면 서버 8151(base-wt)에 지금 audit.mjs를 그대로 돌려 떴다.

## 판정 표

| 항목 | 판정 | 증거 |
| --- | --- | --- |
| 기능 불변 (경로 diff) | 통과 | `git diff 4109146 968cb87 -- backend frontend/src/api frontend/src/lib frontend/src/types.ts frontend/src/AppState.tsx \| wc -l` → `0` |
| 그 밖 .tsx 한 줄씩 | 통과 | Dashboard·ChartModal·PriceChart·RebalancePanel·StockManager·BuyConditions(새)를 모두 읽었다. 새 상태(`quick:'sell'`, `viewToolsOpen`), 컴포넌트 나누기(BuyConditions), ChartModal `card` prop, `<Link to="/stocks">`는 모두 주인 ①이 승인한 넷 안에 있다. 거르기는 기존 `trafficLight(...).state === 'hot'`(lib/display.ts:280)을 쓰고 summary.hot과 같은 식이다. aria-label·role을 지운 곳은 없고 오히려 더했다. API·계산·저장 변경 없음 |
| 테스트 1:1 · 지우기 없음 | 통과 | 지운 테스트 0, 새로 쓴 테스트 13(ChartLegend 1·ChartModal 2·Dashboard 3·Rebalance 3·StockManager 4), 고친 단언 3(`매도 (SELL)`·`유지 (HOLD)` → 문구 표 B 첫 줄, 폰 순서 편집 → 문구 표 A "보기·설정"). 빈 리밸런싱 링크 단언과 MemoryRouter는 문구 표 그대로. 863 + 13 = 876 |
| 검증 | 통과 | `npm ci` 0 · `npm run lint` 경고 **22**(≤22) · `npx tsc -b` 통과 · `npm test` → `Test Files 58 passed (58) / Tests 876 passed (876)` · `pytest -q` → `1 failed, 1363 passed, 3 skipped`이고 실패는 `test_devtools.py::test_demo_custom_thresholds_shows_my_thresholds` 한 건. 같은 날 `4109146`(base-wt)에서 같은 테스트 → `1 failed` (R8 그대로) |
| 계획 검토 "반영" 실제 반영 | 통과(문서 보완 둘) | R3·R12 cond-missing, `.signal-card` 선택자 / R5 `.signal-card` 만(index.css 1491~, `@media 640`) / R6 sticky는 `table.signal-table` 만, 불투명 `--panel`, z-index 1·3, box-shadow 경계 / R7 `.metric-chip.blue` 만 토큰으로(두 테마), 빨강+라이트 조건 추가(audit.mjs:50) / R9 nowrap-split / D1 `METRIC_ORDER` 정렬(BuyConditions.tsx:16) / D2·D10 "그 밖의 조건" 열이 200일선 뒤, 그 열이 있을 때만 minWidth 늘림 / D3 `stat-name`·`stat-note` 클래스 / D4 표 `.signal-cell-row` 그대로 / D11 "비중" 줄은 사유가 있을 때만 / D12 이름표 줄이 폰 분기 밖 / D13 `orderCount` 가 유지를 뺀다 / U6 MA 가격 `.nowrap` / U7 표 칩만. **어긋남 둘(보완·문서)**: ① plan B5 "칸마다 짧은 도움말"은 들어가지 않았고, 문구.md 는 "세 줄"인데 코드 주석은 "둘로"(StockManager.tsx 448) — 빠뜨린 것인지 뺀 것인지 문구 표에 적을 것. 줄인 도움말에서 "비중에는 영향이 없습니다"가 빠졌다(정보 손실 — 되살리기 권함). ② D13 답은 "대시보드 '비중 모두 밴드 이내'도 같은 말로"였으나 그대로 두었다 — 문구.md 에 이유가 적혀 있어 받아들일 만하나 plan.md 답 칸과 어긋난다 |
| 3-2 자동 검사 회귀 (전체 33화면 × 9조건 = 285) | 통과 | 열지 못한 것 0. 같은 날 기준선(8151) 대비 지금이 더 많은 (화면,조건,검사) **0건** (`compare.txt` 첫 절 비어 있음). 넘침·잘림·3줄·터치·대비·콘솔·nowrap-split·sticky-left 모두 0 (빨강+라이트 포함) |
| 숫자·날짜 갈라짐 | 통과 | A·B 화면 24 → **0**. 그 밖 12 = 재무 9 · 매크로 2 · 포트폴리오 150% 1 (기준 이하, 기준선 v2와 같음) |
| 외톨이 | 통과 | A·B 화면 0. 그 밖 19 = 재무 버튼 5 · 매크로 2 · 사용자 목록 10 · 진단 경로 2(데이터 폴더 이름 길이에 따름 — 기준선 날 8151도 6건). 같은 날 기준선 23 이하 |
| cond-missing | 통과 | `-xcond` 두 화면 270 → **0** |
| 카드 높이 (중앙값, 범위) | 통과 | 폰 390 다크 `dash-signal-cards` 596(574~686) → **487**(487~571) ≤ 500. 폰 360 487. `-xcond` 폰 514(514~598). PC 1400 614 → 618, 150% 464 → 497(PC 에도 이름표·조건 줄이 붙어서. 기준 없음, 기록만) |
| 시그널 표 밖 가로 sticky | 통과 | 검사 sticky-left 0 (285조합). 700px에서 표를 400px 밀어도 종목 칸이 45px 자리에 남고 바탕이 불투명하다(eye/w700-table.png) |
| audit.mjs 2차 변경이 잣대를 느슨하게 했나 | 통과 | 지운 검사 없음. CHECKS는 옛 9개의 상위집합. 바뀐 것은 화면 7, 조건 1(빨강+라이트), `kind()`에 `cond`, 숫자 식 넓힘, nowrap-split·sticky-left·cond-missing·fake-button·quiet-target — 모두 더 엄하게 하는 쪽. 3eb7a40의 `clickViewTool`은 접힌 "보기·설정 ⋯"을 펴고 누를 뿐이다. 못 찾으면 그 조합이 "실패"로 남으므로 소리 없이 넘어가지 않는다(지금 실패 0). 참고: quiet-target 은 글자색이 본문색과 같은 것만 잡는다. 흐린 회색 글만 있는 단추는 빠진다. `-xcond` 는 새 조건을 모두 "충족"으로만 넣는다(미충족·없음 표시는 재지 않는다) |
| **G1 글꼴 preload** | **되돌림** | 같은 빌드에서 preload 줄만 뺀 HTML 과 비교, 폰 390, 캐시 끔, 3회씩(`font.log`, `font-fast3g.log`). Slow 3G: FCP **13.0s → 20.8s**, first-paint 5.1 → 8.5s. Fast 3G: FCP **3.75s → 5.83s**, first-paint 1.45 → 2.37s. 글꼴 도착은 Fast 3G 6.4 → 4.8s로 당겨졌고 글꼴이 바뀌는 깜빡임은 사라졌다. 하지만 290KB 글꼴이 JS·CSS 와 대역을 다퉈 **첫 글자가 늦어진다** — plan 3장 "첫 그림 시간이 전보다 늦지 않다"에 어긋남. 한 번만 받기: 두 경우 모두 woff2 요청 1(crossorigin 맞음) — 통과. 오프라인: SW 에서 `fromServiceWorker: true`, Wanted Sans `loaded` — 통과. 실행자 기록에 이 측정이 없다 |
| 키보드 | 통과(A·B 경로) / 보완(팝업 가두기, 기존부터) | PC 1400(`kbd-now.log`). Tab 20에서 요약 "3 매도"(aria-pressed=false)에 닿고, Enter 를 누르면 pressed=true, 표 3줄. 이어서 Tab 1~9 → 비중조절·구분·신호 거르기, 10~13 → 보기 단추, 15 → 첫 종목 이름. 포커스 테두리는 늘 보였다(2px accent, 링크는 브라우저 기본). Enter 로 차트 팝업이 열린다. **팝업 안에서 돌지 않는다**: 열어도 포커스가 뒤 화면 단추에 남는다. Tab 30번 중 23번이 팝업 밖에 있었다(뒤 표의 AI 분석 단추 → 팝업 → 바닥글 → 헤더). 시작 화면(8151)도 30/30 밖이다(`kbd-base.log`). 회귀는 아니지만 3-1 기준 "팝업 안에서만 돈다"는 지금도 실패다. 열 때 포커스를 팝업으로 옮기고, Tab 을 가두고, 닫으면 연 단추로 돌려주는 일은 ChartModal(·ModalLoading) 안에서 끝난다 — 보완 또는 3차로 이름 붙여 넘길 것 |
| 용어 사전 | 통과(사전 손질 둘) | 사기·팔기·유지, "종목 추가", "비중조절 신호 없음", 이름표 "비중"·"참고"가 사전대로 들어갔다. 고칠 것: ① glossary.md:29 "구간" 줄이 옛 범례("매수 13구간 · 43일")를 적고 있다. 지금 범례는 "매수 43일 (13번)"(PriceChart.tsx:183) ② glossary.md:39 는 `⋯` = 폰 메뉴, 어포던스 표는 "▾/▸ = 펼친다"인데 펼치기 단추가 "보기·설정 ⋯"(Dashboard.tsx:879)다. 기호를 ▾ 로 바꾸거나 사전에 적을 것(참고) |
| primary 하나 | 통과 | 새로 생긴 primary는 빈 리밸런싱의 "종목 추가하러 가기" 하나(eye/ph390-rebalance-empty.png). 요약 칸 단추는 primary 꼴이 아니다 |
| 배지 색 뜻 | 통과 | 초록=매수/사기, 빨강=매도/팔기, 보라 ◆=비중조절, 회색=유지·미충족. 리밸런싱의 "참고 ▼ 기간 내 매도"는 빨강 배지 앞에 이름표가 붙는다. `.metric-chip.blue` 는 이제 테두리만이라 오르내림 색과 겹치지 않는다 |
| 상승 빨강 | 통과 | 빨강+라이트·빨강+다크 카드(eye/ph390-cards-risered-*.png): 오른 값은 빨강, 내린 값은 파랑. 시그널 줄은 왼쪽 이름표 "시그널/비중/매수 조건"으로 갈린다. 대비 0건 |
| 매크로 카드 그대로 | 통과 | 폰 390 매크로 카드 12장의 크기가 기준선과 같다(`macro.log`). 첫 카드 픽셀 차이는 "확인 시각" 글자뿐(eye/mc-both.png) |
| 641~720px | 통과 | 650·700: 폰 접기("보기·설정 ⋯")는 있고 카드는 2열 상자형(지표 칸 2열, 높이 606~639)이다. 이름표 줄이 섞여 깨지지 않는다(eye/w700-cards-top.png). 리밸런싱 주문 카드·종목 관리도 정상 |
| 어포던스 수치 | 통과 | 전체 285조합, 같은 날 기준선 → 지금. fake-button **222 → 9**(남은 9 = 차트 팝업 재무 탭의 "배당수익률 — 공시에 없음" 데이터 칸, 조건마다 1, 계획이 말한 알려진 헛것과 같은 자리). quiet-target **276 → 0** |
| 어포던스 눈으로 | 통과(참고 하나) | 요약: 누르는 매수·매도·비중조절은 상자 + "›", 관망은 상자 없는 숫자라 꼴로 갈린다(eye/ph390-top.png). 헤더 "방금 받음"은 점 + 글자. 폰 보유 줄 ▾ 와 재무 PER 이름 밑줄도 보인다. 리밸런싱 표 이름처럼 누르지 않는 것에는 밑줄이 없다. 참고: 요약 칸 바로 밑의 "◆ 매도 검토 2 · ◆ 매수 검토 1" 배지는 누르지 않는데 바로 위 보라 "비중조절 ›" 단추와 색·테두리가 같다. 28px 라 검사 기준(34px~) 밖이다. 사용자 확인 때 볼 것 |
| 과업 누른 횟수 | 참고 | 폰에서 표·카드 바꾸기, 순서 편집, 종목 설정, 시그널 기준은 이제 한 번 더 눌러야 한다("보기·설정 ⋯", 접힘 상태는 저장되지 않음). 주인 ①이 승인한 A4의 값이다. 매도 종목 찾기는 요약 칸 한 번으로 줄었다 |
| 코드 손질 | 참고 | RebalancePanel.tsx:1065 `underOne` 의 JSDoc 이 `orderCount` 의 JSDoc 위로 밀려 두 주석이 붙어 있다(1065·1066 → 1067 orderCount, 1069 underOne) |

## 보완 목록 (실행자에게)

1. **G1 되돌림**: `074d19e`의 preload 줄을 뺀다. 깜빡임을 줄이고 싶으면 첫 그림을 늦추지 않는 방법(예: 글꼴 크기 줄이기·subset)을 3차 후보로 둔다.
2. 차트 팝업 포커스 가두기(시작 화면부터 없던 것): 열 때 포커스를 팝업으로 옮기고, 안에서만 돌게 하고, 닫으면 연 단추로 돌려준다. 이번에 하든지, 3차로 넘긴다고 끝 보고에 적든지 정한다.
3. 종목 추가 도움말: plan B5 "칸마다 짧은 도움말"을 하든지, 뺐다고 문구.md·plan 에 적는다. "비중에는 영향이 없습니다"를 되살린다. 주석의 "둘로"와 문구 표의 "세 줄"을 맞춘다.
4. glossary.md: "구간" 줄을 지금 범례로 고친다. "보기·설정 ⋯"의 기호(⋯ 와 ▾)를 하나로 맞춘다.
5. (참고) RebalancePanel.tsx:1065 주석 자리. plan.md D13 답 칸을 문구.md 와 맞춘다.

## 파일 (저장소 밖)

- 자동 검사: 지금 `/tmp/claude-0/work/review-ab/audit-now/`(summary.md, results.json, shots/), 같은 날 기준선 `/tmp/claude-0/work/review-ab/audit-base-aff/`, 비교 `/tmp/claude-0/work/review-ab/compare.txt`
- 글꼴: `/tmp/claude-0/work/review-ab/font.log`(Slow 3G + 오프라인), `font-fast3g.log`, `offline.png`
- 키보드: `kbd-now.log`, `kbd-base.log` · 매크로: `macro.log` · 눈으로: `/tmp/claude-0/work/review-ab/eye/`
- 측정 스크립트: `/tmp/claude-0/-home-user-Dashboard/6b2e1d84-bdc3-51a1-af31-e6cb9385b4d7/scratchpad/` (font.mjs, font-fast.mjs, kbd.mjs, kbd-base.mjs, eye.mjs, macro.mjs, cmp.py)

## git status (내 worktree)

```
$ git -C /home/user/Dashboard/.claude/worktrees/agent-a3a7e961a6b47ccba status
HEAD detached at 968cb87
nothing to commit, working tree clean
```
