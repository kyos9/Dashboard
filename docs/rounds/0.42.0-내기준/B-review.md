불합격

# 0.42.0 B. 작은 화면 고치기 묶음 — 검토자 판정

- 본 커밋: `7718967` (origin/claude/new-session-fftcg1, detached). B 범위 676051d · ba27e49 · 7718967, 라운드 시작 289b097. 8d35ee1(A) 은 B 에 걸리는 곳만 봤다.
- 검토자 worktree: `/home/user/Dashboard/.claude/worktrees/agent-a1fae9bafdb17d4d1`. 가짜 서버 8362 (PID 18747 로 끔, 포트 비었음 확인).
- 내 자료: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/revB3/` (snap/, openapi.json, ai.json, probe.mjs, mut.py, muts.json, mut-result.md, shots/, shots2/), 브라우저 스크립트 `.../scratchpad/pw/revB3.js`.

## 불합격 이유 (요약)

1. **동작 결함 — B9 가 폰 리밸런싱에서는 안 고쳐졌다.** 지인(갤럭시만 씀) 360px 리밸런싱의 주문 가이드 카드 제목과 보유 카드 이름이 여전히 `7203.T` 다. plan-user.md 가 근거로 든 바로 그 화면(`P/40-friend-360-rebal-newmoney.png`)이다.
2. **뮤테이션 — 내가 만든 15줄 중 8줄이 살아남았다**(§3 합격 기준은 0). 특히 B6 화면 쪽(체크 상자, 기기 기억, 안내 글, 맨 위 한 줄)을 지키는 화면 테스트가 하나도 없다.
3. 작은 동작 결함: 주수 글자에서 정수 부분과 괄호 안 소수 부분의 반올림이 따로 놀아 서로 어긋난다 ("61주 (62)", "1주 미만 (1주)").

나머지(B1·B2·B3·B4·B5·B8, B6 계산, B7 대부분, 회귀·호환)는 통과다. 고칠 양은 작다.

## 동작 결함

| # | 심각도 | 무엇 | 증거 |
| --- | --- | --- | --- |
| D1 | 고쳐야 함 (B9 완료 조건) | 지인 폰 리밸런싱에서 토요타가 `7203.T` 로 보인다. 서버는 `rows[].name = "トヨタ自動車"` 를 보내는데, 화면의 `shortLabel` 이 `/api/stocks` 의 날 이름(`row.stock.name = null`)으로 `stockLabel` 을 부르기 때문이다. PC 표는 `labelOf`(`row.stock?.name ?? rowLabel(row.current)`)라서 공용 이름이 나온다. | `frontend/src/pages/RebalancePanel.tsx:61-63`(shortLabel), `:371`(폰 보유 카드), `:1134`(폰 주문 카드 `orderTitle(shortLabel(row), …)`), `:1336`(저장 줄). 브라우저(friend, 360): `before: ["SCHD 67주 (67.77) 팔기", …, "7203.T 34주 (34.43) 팔기", "현금"]`, `after: [… "7203.T 유지" …]`. 스크린샷 `revB3/shots/friend-360-rebal-hide0.png` ("7203.T 유지", 보유 카드 "7203.T ¥3,870") |
| D2 | 참고 (B9 에 붙는 것) | 종목 관리(`/stocks`)와 ✎ 수정 창에서는 여전히 `7203.T` 다. 수정 창의 이름 칸 placeholder 도 티커여서 "비우면 티커"라고 읽힌다. 실제로 비우면 대시보드에는 공용 이름이 나온다. 저장 쪽은 안전하다. 수정 창은 `/api/stocks` 의 날 `name` 으로 초안을 만들므로 공용 이름이 사용자 이름 칸에 저장되지 않는다(plan-dev 걱정은 지켜짐). | 브라우저 friend 1400 `/stocks`: `mgrToyota 0, mgrCode 1`, 대시보드 `dash 1`. `frontend/src/components/StockEditModal.tsx:279` `placeholder={stock.ticker}`, 저장 `:111`, 초안 출처 `components/PortfolioView.tsx:107-110` |
| D3 | 고쳐야 함 (작음) | `sharesText` 는 정수 부분을 소수 넷째 자리에서 버리고(`trunc(abs.toFixed(4))`) 괄호 안은 둘째 자리에서 반올림한다(`toFixed(2)`). 그래서 소수 부분이 .995~.9999 이면 둘이 어긋난다. | `frontend/src/lib/orderPlan.ts` `sharesText`. probe(`revB3/probe.mjs`): `0.999 → "1주 미만 (1주)"`, `0.996 → "1주 미만 (1주)"`, `61.996 → "61주 (62)"`, `61.9951 → "61주 (62)"` |
| D4 | 참고 | '새 돈만 나누기'에서 폰 현금 카드는 "지금 → **목표**"를 보인다. 남는 돈이 있으면 실제로 남는 현금(`current − spent`)과 다르다. 예: 현금 목표 0% 에 남는 돈 ₩5,000 이면 카드는 "₩1,000,000 → ₩0". 맨 위 한 줄이 "(남는 ₩…은 현금)"으로 알려 주기는 한다. | `RebalancePanel.tsx:1158-1160`, `orderPlan.ts` buyOnlyPlan `cash.targetValue: cashTarget`. probe 7: `leftover 5000, cash {cur 1000000, tgt 0}` |

## 테스트 빈 곳 (살아남은 뮤테이션)

`revB3/mut.py`(이 worktree 만 바꾸고 줄마다 되돌림), 결과 `revB3/mut-result.md`. 화면 쪽은 orderPlan·PriceChart(둘)·MacroChart·display·signalRules·Dashboard·RebalancePanel 테스트, 서버 쪽은 test_my_signals·signal_rules·fundamentals·rebalance·api·portfolio·portfolio_view 를 돌렸다.

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| R1 매크로 차트 `locale: 'ko-KR'` 지움 | MacroChart.tsx | **살아남음** — B8 이 매크로 차트에서는 시험되지 않는다 |
| R2 매크로 차트 `tickMarkFormatter` 지움 | MacroChart.tsx | **살아남음** |
| R3 기기 기억 기본을 켜짐으로(`!== '0'`) | RebalancePanel.tsx | **살아남음** — "기본 꺼짐"을 지키는 화면 테스트가 없다(운영 규칙 "기본값은 지금과 같게") |
| R4 체크 상자를 계획에 안 넘김(`false`) | RebalancePanel.tsx | **살아남음** — 체크 상자 동작 테스트가 없다 |
| R5 꺼짐 안내 글을 옛 틀린 글로 | RebalancePanel.tsx | **살아남음** — B6 ㉠(안내 글 바로잡기)이 지켜지지 않는다 |
| R6 가이드 맨 위 "새로 넣을 돈 반영" 한 줄 지움 | RebalancePanel.tsx | **살아남음** |
| R7 비례 축소를 늘 함(모자란 합 < 새 돈이어도 새 돈 전부 씀) | orderPlan.ts | **살아남음** — 이름이 "모자란 합이 새 돈보다 작으면"인 테스트(`orderPlan.test.ts:273-286`)가 실제로는 모자란 합 = 새 돈(80+120=200, 480+520=1000)인 경우만 만든다. 목표 합이 100% 이면 모자란 합 ≥ 새 돈이라 이 줄은 목표 합 < 100% 일 때만 일한다. 그 경우가 없다 |
| R8 200일선 칩 초록 고정 | display.ts | 잡힘 |
| R9 DI 칩 초록 고정 | display.ts | 잡힘 |
| R10 엔 종목 통화 못 알아봄 | chartFormat.ts | 잡힘 |
| R11 리밸런싱 이름 공용 안 씀 | services/rebalance.py | 잡힘 |
| R12 재무 한 종목 이름 공용 안 씀 | routers/fundamentals.py | 잡힘 |
| R13 `shown_name` 의 내 이름 strip 지움 | models.py | **살아남음** (참고 — 수정 경로는 `stocks.py:302` 에서 잘라 넣으므로 공백만 든 이름은 드물다) |
| R14 주수에 금액 가리기 씌움 | orderPlan.ts | 잡힘 |
| R15 새 돈만에서 현금 칸 목표 대신 남는 돈 | orderPlan.ts | **살아남음** — 현금 칸이 무엇을 보여야 하는지(D4)가 정해져 있지 않다 |

실행자의 뮤테이션(`B-mutation.md`, 16줄, 2·3차 뒤 모두 잡힘)은 문서로 확인했다. 내 줄은 그것과 겹치지 않게 골랐다(B-M6 은 이격도, R8·R9 는 200일선·DI).

## §3 검사표

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 완료 조건 | **실패** | B1 통과: 설명 줄이 칩 이름으로 시작하고 칸 순서다. 브라우저(상승 빨강, owner 1400): "매수 시그널 = 이격도 < 0 · ADX > 20 · DI 약세(-DI > +DI) · 변동성·거래량(StdDev20 축소 또는 거래량비 > 1.1)". 칸 순서 `Dashboard.tsx:1070-1079` = `METRIC_ORDER`(`signalRules.ts:105`). 카드 머리 "DI 방향 (+DI / -DI)"(`Dashboard.tsx:1428`). B2 통과(아래 probe). B3·B8 통과. B4 통과(`Dashboard.tsx:676-679`, B-M15). B5 통과(아래). B6 계산 통과, 화면 테스트 없음. B7 통과지만 D3. **B9 폰 리밸런싱 실패(D1).** "고치기 전 실패하는 테스트": B6 화면 쪽과 MacroChart 에는 없다(R1~R6) |
| 계획 때 걱정 | 통과 (하나는 일부) | plan-dev B1: 옛 서버용 JSON 을 같이 고쳤고, `test_screen_fallback_is_what_this_server_sends` 는 version 이 같아 건너뛰지 않고 돈다(`signalRulesLegacy.json` version `faa56cf123c6edfa` = 지금 지문). 머리 "+DI / -DI" 도 고쳤다. plan-dev B6: 서버 필드 없음, `orderPlan.ts` 만 고쳤다. plan-review B5(✓ 는 칠하지 않음)·B6(비례만) 반영. plan-dev B8: 두 차트 다 고쳤지만 테스트는 PriceChart 에만 있다. plan-dev B9: `/api/stocks` 는 그대로. plan-user B9 "리밸런싱도 코드로만 보인다": **폰에서 남아 있음(D1).** 막음은 없다. 참고: `signalRulesLegacy.json` 의 `_about`("0.40.0 … 고치지 않는다")과 테스트 docstring(`test_signal_rules.py:163-167`)은 주인 결정(새 이름으로 바꾼다) 뒤로 맞지 않는 글이 됐다 |
| 회귀 | 통과 | pytest `1349 passed, 3 skipped` (시작 1309), vitest `57 files / 852 passed` (시작 807). `tsc -b` OK. lint 경고 22줄(`grep -c warning`, 시작 23). 응답 사진(`snapshot.py revB3/snap 8362` → `snapdiff.py baseline/snap revB3/snap`): `차이 3`, 셋 다 `friend-…[3].name: None → 'トヨタ自動車'`(dashboard·fundamentals·rebalance rows). B9 의 의도된 차이 말고는 없다. 옵션 기본값: probe 1·2에서 `buildOrderPlan(…, '1000000')` 과 `(…, false)` 가 JSON 으로 같다. 켜 둬도 새 돈이 없으면 꺼짐과 같다 |
| 격리 | 해당 없음 | B 는 새 엔드포인트가 없다(apidiff 에서 더해진 8개는 모두 A) |
| 마이그레이션 | 해당 없음 | B 는 새 리비전이 없다 |
| 호환 | 통과 | `apidiff.py baseline/openapi.json revB3/openapi.json`: 빠짐 0, 타입 바뀜 0. B 는 응답 필드를 더하지도 빼지도 않았다. 뜻이 바뀐 것은 `name`(null → 공용 이름) 하나이고, 옛 화면은 `name ?? ticker` 라 깨지지 않는다. 옛 서버(규칙 API 없음)에서 새 화면은 바뀐 `signalRulesLegacy.json` 을 쓴다(주인 결정대로) |
| 입력 한도 | 해당 없음 (서버) / 통과 (화면) | 새로 받는 값은 화면 안의 체크 상자 하나. 새 돈 입력 `-1000`·`abc`·`1e309`·`0` 이면 buyOnly=false, newMoney=0 (probe 8) |
| 뮤테이션 | **실패** | 위 표. 내 15줄 중 살아남음 8 |
| 비밀 | 해당 없음 | 키·AI 경로를 건드리지 않았다. AI 지시문 상수(`ai_consts.py`): 18 = 18, 바뀐 값은 `__file__`/`__cached__` 경로뿐. AI 데이터의 이름은 그대로 `stock.name or stock.ticker`(`ai_analysis.py:317,521`, `ai_portfolio.py:161,327`)라 보내는 범위가 바뀌지 않았다 |
| 규제 | 통과 | B diff 의 더한 줄에서 "추천·사세요·팔라·저평가·예측"은 0이다. "수익률"이 1줄 있지만 기존 안내 글이다(`Dashboard.tsx:677`). B5: 상승 빨강에서 부호 칩만 `metric-chip up` 은 rgb(196,29,29), `down` 은 rgb(29,78,216)으로 바뀌었다. 조건 ✓ `cond-mark met` 는 rgb(19,117,56) 초록 그대로, 시그널·매도 색 `.tone-*` 도 그대로다(`index.css:1273-1281`). B6: 비례만 쓰고 시그널은 읽지 않는다(`buyOnlyPlan` 이 받는 것은 rows·목표·현금뿐). "추천 배분" 같은 말도 없다. 명세 6.4 에 "시그널이 뜬 종목을 먼저 채우지 않는다"가 적혀 있다(`SIGNAL_APP_SPEC.md:248-252`) |
| 데이터 경계 | 해당 없음 | 새 테이블·컬럼이 없다. `shown_name` 은 읽기 속성이다. `signal_daily` 는 손대지 않았다 |
| 외부 호출 | 통과 | `instrument` 는 이미 함께 읽어 온다(joined). 바깥 조회를 더하지 않았다 |
| 화면 | 일부 통과 | en-US@posix: `navigator.language`/`languages` 를 `en-US@posix` 로 덮어써도 종목 차트·매크로 화면에 오류 0, canvas 가 그려진다. 세로축 "68,000", 눈금 "11월·2026·3월", 오늘 ▲ 도 찍힌다(`revB3/shots2/posix-nav-krw-chart.png`). 폰 360 리밸런싱 가로 넘침 0. 금액 가리기: 새 돈 줄 "•••••", 현금 "••••• → •••••", 주수는 보인다(PC 9-3 테스트 `RebalancePanel.test.tsx:498` 와 같은 약속). 참고: 폰 주문 카드 주수는 예전에 `qty()` 라 가려졌는데 이제는 보인다. 원래 테스트로 정해진 PC 쪽에 맞춘 것이다. 금액 가리기 상태의 폰 카드 테스트는 없다. 폰 이름은 D1. PC 1400·390 × 두 테마 전 화면 자동 검사는 실행자 스크립트(`pw/auditB.js`)가 있어 다시 돌리지 않았다. 사용자 판정에서 본다 |
| 성능 | 통과 | 첫 화면 JS gzip 109.79 → 110.28 kB(A 110.10 → B +0.18). 쿼리 수는 그대로(joined 이미 있음) |
| 가짜 서버 | 통과 | `pytest tests/test_devtools.py` 12 passed. B 가 새로 만든 화면 상태(새 돈만 나누기)는 화면만의 것이라 데모 데이터에 넣을 것이 없다. 지인 7203.T(이름 없음)이 B9 를 드러낸다 |
| 문서 | 통과 (참고 둘) | 명세 6.4 에 '새 돈만 나누기'·정수 주 단락(`SIGNAL_APP_SPEC.md:248-255`), README "작은 고치기 (v0.42.0)". 참고: `backend/app/version.py`·ROADMAP 에 0.42.0 줄이 아직 없다(라운드 끝에 쓸 것으로 본다). `signalRulesLegacy.json` `_about` 이 맞지 않는 글이 됐다 |

## 항목별로 직접 확인한 것

- **B1 지문·AI 글자**: `fingerprint()` 289b097 · 5edbf2d · 7718967 셋 다 `faa56cf123c6edfa`(`git archive` 로 꺼내 각각 계산). 화면이 바꾼 것은 `formula` 뿐이고 `ai_short/ai_long` 은 그대로다(`signal_rules.py:241-272`). 서버 조건 순서(지문·AI 가 쓰는 것)는 두고, 설명 줄만 화면에서 칸 순서로 정렬한다(`signalRules.ts:108-117`).
- **B2** (probe 10): 10-01·02·05 ▲, 06·07 꺼짐, 08~14 ▲ 이면 구간 둘이 되고 ▲ 는 `['2026-10-01','2026-10-08','2026-10-14']`. 오늘 하루짜리는 하나만 찍힌다. 금→월(10-09→10-12)은 한 구간이다. 서버는 바뀌지 않았다.
- **B3** (probe 11): `68,000` · `123.46` · `2,890`(엔) · `1,234,567.89`. 십자선 `2026-10-09`(문자열·BusinessDay·유닉스초 모두). 눈금 `10.09`/`10월`/`2026`.
- **B6** (probe 3~7): 켜면 합 = 새 돈. 4.8억 + 100만이면 B 에 100만(전체 0.5% 기준의 결함은 고쳐짐). 현금 목표가 모자라면 그 몫은 현금에 남는다. 잡음 경계(새 돈의 0.5% = 5,000)에서는 `hold` 가 되고 5,000 이 남는다. 기기 기억 키 `rebalance.buy-only` 는 다른 키(`dashboard.*`, `signalboard.theme`)와 겹치지 않는다. 브라우저에서 켜면 `"1"` 로 저장되고 다시 읽어도 켜져 있다. 처음 상태는 꺼짐이다. 명세 6.4 와 맞는다.
- **B7**: "62주 (62.17)", "1주 미만 (0.45주)", PC 표 "−1주 (1.35)". D3 말고는 괜찮다.
- **B9 근거**: 알림은 전부터 `stock.name or stock.instrument.name`(`alerts.py:146`)이었다. `Instrument.name` 주석(`models.py:76` "이름을 안 적었을 때의 출발점")과도 맞는다. 이름을 고치는 길(`/api/stocks`, 수정 창 저장)은 날 이름을 쓴다. 사용자가 일부러 이름을 비워 "티커로 보이게" 하던 길은 이제 없다. 주석에 바꾼 뜻이 적혀 있다(`models.py:107-108`). 다만 수정 창 placeholder(D2)와 폰 리밸런싱(D1)이 아직 옛 규칙을 따른다.

## 합격으로 가려면

- D1: 폰 리밸런싱 이름이 공용 이름을 따르게 하고(서버 `rows[].name` 쪽으로), 그것을 지키는 화면 테스트.
- D3: 주수의 정수·괄호를 같은 반올림에서 만든다. `.995` 경계 테스트.
- 테스트: B6 체크 상자(기본 꺼짐·기억·계획에 반영·꺼짐/켜짐 안내 글·맨 위 한 줄), MacroChart 언어 고정과 눈금, 목표 합 < 100% 에서 남는 돈. (D2·D4·R13·문서 글은 참고)

## git status (검토자 worktree, 끝날 때)

```
$ git status
HEAD detached at origin/claude/new-session-fftcg1
nothing to commit, working tree clean
$ git rev-parse --short HEAD
7718967
```
