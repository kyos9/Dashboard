# 디자인 2차 묶음 C 검토 — 조건부 합격

검토자 · 2026-10-15 · worktree `agent-a15351c3d23d9366e`, 1ff0fc5("디자인 2차 묶음 C (주인 결정 ②)") detached 체크아웃 · 차수 시작 4109146 · 앞 판정 AB-review-2.md(합격) 다음의 7f95712·74121f8·1ff0fc5 를 봄.

## 조건 (고친 다음 다시 볼 것)

1. **고쳐야 함: 정기 리뷰 때 "◆ 비중조절" 수가 모든 종목 수가 된다.** `PortfolioView.tsx` signalKinds 가 이제 `card.rebalance_signal.active` 로 센다. 서버는 리뷰 날(`review.due`)이 되면 모든 종목에 active=true 를 싣는다(`backend/app/services/rebalance.py:391` `compute_rebalance_signal(excess, band, review["due"])`, REASON_REVIEW). 예전 규칙은 이 경우를 일부러 뺐다(`lib/portfolio.ts:24` "정기 리뷰 도래는 … 점으로 찍지 않는다 — 맨 위 리뷰 줄이 알린다"). 응답을 리뷰 날로 바꿔서 띄워 봄(eye3.mjs): 단추가 `비중조절 15종목` 이 되는데 줄 끝 ◆ 는 3개뿐이다. 바로 아래 "리뷰할 때" 줄도 같은 일을 또 알린다. 그림은 `eye/portfolio-review-due.png`. 시그널 보기 신호 요약의 수와 같으니 "누른 화면의 수 = 단추의 수" 기준은 지킨다. 다만 문구.md 묶음 C 절에는 바뀐 결과로 "매수·매도 겹침"만 적었다. 이 일은 빠져 있어서 주인이 모르고 승인했다. 문구.md·끝 보고에 적고 주인에게 물을 것. 고치는 길은 둘이다. (a) 그대로 두고 알린다. (b) 단추 수와 'rebalance' 거르기를 함께 밴드(과중·미달)로만 맞춘다. 단 (b)는 시그널 보기의 기능을 바꾸므로 주인 결정이 있어야 한다.
2. **고쳐야 함: "추세 형성" 값 칩(`.metric-chip.blue`)에 밑줄이 생겨 링크처럼 보인다.** `index.css:1278-1283` `text-decoration: underline`. 이 칩은 누를 수 없는 `<span title>` 이다(`Dashboard.tsx:241`). 그런데 바로 같은 줄의 종목 이름(차트 열기)이 밑줄 링크이고, 이번 커밋은 밑줄을 "누르는 것" 표시로 쓰기 시작했다(`index.css` `button.signal-line-count … text-decoration: underline`). 이번 차수의 어포던스 규칙("누를 수 없는데 누를 것처럼")에 어긋난다. audit.mjs 의 fake-button 은 테두리·바탕만 보고 밑줄은 보지 않아서 0 으로 나온다. 밑줄 대신 굵기나 진한 바탕만 쓰면 된다. 지금 바탕(text 16%)만으로도 옆의 중립 칩 "1.09x" 와 구별된다(`eye/signal-row-blue-*.png`).

## 참고 (막지 않음)

- 고친 줄 위에 마우스를 올리면 고정 칸만 노랑이 빠진다. `table.sticky-first tbody tr:hover td:first-child`(index.css:1509, 명시도 0,3,4)가 `tr.dirty td:first-child`(1513, 0,3,3)를 이긴다. 잰 값: 다크는 첫 칸 `rgb(23,34,49)`(panel-soft), 나머지 칸 `rgba(240,180,41,.14)`. 라이트는 첫 칸 `rgb(246,248,252)`, 나머지 `rgba(180,83,9,.1)`. `tr.dirty:hover td:first-child` 규칙 하나를 더하면 된다. 라이트에서는 마우스가 없어도 고정 칸 빛깔이 조금 다르다. `--amber`(#a64d09) 14% 를 섞은 값(0.951,0.902,0.865)이고, 나머지 칸은 `--amber-soft`(180,83,9 / .1)라 고정 칸이 조금 더 진하다(`eye/rb-hold-dirty-scrolled-light.png`). 다크는 같다. 비침(밑으로 밀린 글이 보이는 것)은 두 테마·150%·폰에서 다 없다.
- 주문 → 거래 입력에서 아래 경우를 실제로 열어 봤다(eye4·eye5).
  - 정수 주는 15건 모두 제목과 같다(606.23→606, 팔기 1,655.79→1,655, 엔화 226 / 환율 931).
  - 시세가 없으면(shares null) 수량과 가격이 빈칸이다.
  - 1주 미만이면 소수가 그대로 들어간다(0.01). 원화 종목에서는 0.5주처럼 살 수 없는 값이 처음 값이 된다(테스트 RebalancePanel.test 삼성전자 0.5). 처음 값일 뿐이라 막지는 않는다.
  - |shares|<0.005 이면 처음 값이 "0" 이 된다. 이때 applyTrade 가 "수량을 0보다 크게"로 막는다(`lib/trade.ts:37`).
  - 열어 둔 칸의 처음 값은 새로 넣을 돈을 바꿔도 따라가지 않는다(useState 처음 값).
  - PC 표에서 주문이 '유지'로 바뀌면 단추는 사라지는데 열린 칸은 남는다(OrderTableRow 의 `open` 이 hold 와 무관하다). 폰 OrderTrade 는 닫힌다.
  - Esc 로 닫히지 않는다. 보유 표의 거래 칸과 같다.
- "확인할 신호" 단추를 Enter 로 누르면 시그널 보기로 넘어가는데, 그 뒤 포커스가 BODY 에 있다(예전 한 줄 단추와 같다). 'knee' 거르기는 시세가 오래된 매수(knee_buy_v2·stale)도 보이고, 수는 그것을 뺀다. 둘 다 이번 전부터 있던 것이다. 가짜 데이터에서는 차이 0.
- 폰 종목 관리 표의 고정 칸이 202px 로 390 화면의 절반을 넘게 차지한다(`eye/stocks-ph-scrolled-*.png`). 승인된 동작이고 사용자 확인 때 볼 만하다.

## 항목

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 기능 불변 (backend·api·lib·types·AppState) | 통과 | `git diff --stat 4109146 HEAD -- backend frontend/src/api frontend/src/lib frontend/src/types.ts frontend/src/AppState.tsx` → `backend/app/version.py | 4 +++-` 한 파일(0.43.0 줄, 7f95712) |
| 저장 로직 그대로 | 통과 | TradeForm 에서 바뀐 것은 `initialSide`·`initialQty` 를 받는 것과 `useState(initialSide/initialQty)` 두 줄뿐이다. `apply()`(applyTrade→api.updateHolding)는 diff 0. 브라우저에서 AAPL "거래 입력"→반영 → `PUT /api/rebalance/holdings/AAPL {"quantity":16,"avg_cost":937.35,"avg_fx":1343.64}`, 30→16, 평단·환율 그대로, 칸 닫힘 |
| 승인 범위 | 통과(조건 1·2 별도) | 배지 테두리 빼기 `index.css` 끝 `.badge.badge … border-color: transparent`(잰 값: 테두리 1px rgba(0,0,0,0)). sticky-first 는 StockManager·RebalancePanel 표 둘. 확인할 신호는 종류마다 단추. 주문 → TradeForm 재사용 |
| .tsx 한 줄씩 | 통과(참고 위) | OrderTableRow 는 columns=9 와 머리글 9 가 맞는다. 현금 줄 5칸+colSpan4, tfoot 4칸+colSpan5 = 9. PC fxNowOf(order.currency) 와 폰 fxNowOf(row.current.currency)는 같은 값. tradeQtyOf 는 sharesText(`lib/orderPlan.ts:241-245`)와 같은 셈. askedQuick 효과는 location.key 로 한 번 돌고, 뒤로·앞으로에서 같은 거르기로 다시 선다(확인함) |
| 린트 | 통과 | `npx oxlint` 경고 22 (≤22), 오류 0 |
| tsc -b | 통과 | 종료 0 |
| npm test | 통과 | `Test Files 58 passed (58)` / `Tests 883 passed (883)` |
| pytest | 통과 | `1 failed, 1363 passed, 3 skipped`. 실패는 `test_devtools.py::test_demo_custom_thresholds_shows_my_thresholds` 한 건(날짜 의존, R8) |
| 테스트가 약해지지 않았나 | 통과 | 포트폴리오 첫 테스트는 단추 넷의 이름을 그대로 비교한다. 카드에 rebalance_signal 을 더한 것은 새 규칙 때문이다. 새 테스트: 매도 누름→요약 '매도' pressed·1, 주문 PC·폰 처음 값과 저장 호출, sticky-first 클래스 |
| 자동 검사 audit.mjs 전체 | 통과 | 전용 8173(`--data-dir /tmp/claude-0/work/review-c-data --reset`), worktree build. 285개, 열지 못한 것 0. 합계 page-overflow 0 · clipped 0 · orphan 17 · num-split 12 · folded2-360 2 · touch 0 · contrast 0 · console 0 · cond-missing 0 · nowrap-split 0 · sticky-left 0 · fake-button 9 · quiet-target 0. `diff` 로 audit-c 표 전체와 **같다**. audit-base-v2 와 화면×조건×검사마다 비교해 늘어난 칸 0 |
| sticky 비침 (dirty·hover·라이트) | 통과(참고) | 933×600@1.5 두 테마·390 폰 종목 관리에서 scrollLeft=300·400 으로 밀어 봤다. 고정 칸 left=1, 불투명이고 비침 없음. dirty+hover 첫 칸 색은 참고 1 |
| 키보드: 확인할 신호 → 시그널 보기 | 통과 | 매수·매도·비중조절 각각 Tab 으로 도달했다(포커스 링 solid 2px rgb(56,189,248)). Enter → `?view=signal`, 요약의 그 칸 pressed. 보이는 수와 단추 수가 같다(4/4, 3/3, 3/3). 뒤로→포트폴리오, 앞으로→같은 거르기. "시그널 보기 →"는 거르기 없이 15. 폰 단추 높이 44 |
| 키보드: 주문 거래 입력 열고 닫기 | 통과 | 포커스→Enter→`aria-expanded=true`, 이름이 "VOO 거래 칸 닫기"로 바뀐다. Tab→"샀다", Shift+Tab→Enter→닫힘(칸 0), 포커스는 단추에 남는다. Esc 는 닫지 않음(기존과 같음) |
| 배지 대비·추세 형성 | 통과(조건 2) | contrast 0(285조합, risered 다크·라이트 포함). 잰 값: 라이트·빨강 traffic `rgb(196,29,29)` on `rgba(200,30,30,.1)`, 다크·빨강 `rgb(242,106,106)` on .14. "추세 형성" 칩은 두 테마에서 옆 중립 칩보다 진한 바탕이라 눈에 띈다. 밑줄 문제는 조건 2 |
| 문구 | 통과 | 문구.md 묶음 C 절 5줄과 화면이 같다(조건 1 의 빠진 한 줄은 별개) |
| 해당 없음 | — | API 모양·응답 사진 기준: backend 바뀐 것이 version 뿐이라 해당 없음 |

자료: `/tmp/claude-0/work/review-c/audit/`(results.json·summary.md·shots), `/tmp/claude-0/work/review-c/eye/`(사진과 eye1~5.mjs). 서버 둘(8173 PID 23068, 눈 확인용 8174 PID 23568, data `/tmp/claude-0/work/review-c-eye-data`)은 PID 로 껐고 `ps` 로 없음을 확인했다. 잠깐 걸었던 `frontend/node_modules` 링크(무시 목록)는 지웠다.

## git status

```
HEAD detached at 1ff0fc5
nothing to commit, working tree clean
```
