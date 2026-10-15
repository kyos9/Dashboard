# 0.42.0 계획 검토 — 개발자 (HEAD 9135edb, 읽기만)

## A. 시그널 기준 내 설정
**찬성**: 읽을 때 계산은 지금 구조로 된다. 평가 함수는 이미 한 벌이고(`signal_rules.py:285-305`), 여러 종목을 한 번에 보는 길(`signals.py:56-81`)과 알림에 판정을 넣는 자리(`alerts.py:150-162` `signals=`)도 있다. 비교 기간 1~20 은 **지표를 다시 계산하지 않아도 된다**. `_ago` 는 행 기준 `shift(N)` 이고(`signal_rules.py:91`) stddev20·adx 가 날마다 저장돼 있다. 화면 칩 색도 이미 규칙의 기준값을 받는다(`display.ts:198-222`).

**걱정**
1. **막음 — 바꾼 사람의 "마지막 매수일"은 +100 ms 를 못 지킨다.** 가짜 DB(15종목 × 약 1250행 = 18,720행)에서 재 보니 ORM 으로 읽으면 375~450 ms, 열만 골라 읽고 평가해도 210~290 ms 다(읽기만 80~160 ms). 20종목 × 10년(약 5만 행)이면 0.6 s 를 넘는다. AI 진단도 종목마다 `last_buy_date`·1년 횟수(`ai_analysis.py:262-273`)를 다시 센다. 메모리에 잠깐 두는 것을 "넘으면 할 일"로 미루지 말고 처음부터 설계에 넣는다.
2. **고쳐야 함 — 매도 판정에 필요한 열이 `indicator_daily` 에 없다.** `above_ma50` 은 `close` 를 쓰는데(`signal_rules.py:239`) 지표 표에는 close 가 없다(`models.py:159-179`, `signals.py:20-24`). 비교 기간을 바꾼 사람의 매도(차트 ▼·리밸런싱 어깨매도 `rebalance.py:148-181`·카드)는 `price_daily` 와 날짜로 붙여야 한다. 나머지 셋(ADX·거래량비·이격도)만 바꾼 사람은 매도가 그대로이니 저장된 값을 써도 된다.
3. **고쳐야 함 — 초안 표가 틀렸다. `VOL_RATIO_EXPAND` 는 매도에 쓰이지 않는다.** 매도 "거래량 받침"은 `vol_ma5 > vol_ma20` 이다(`signal_rules.py:259-269`). 이 값을 매도에 걸면 공용 정의를 바꾸는 셈이 된다.
4. **고쳐야 함 — 리팩터 범위가 "상수 넷 묶기"보다 크다.** 조건의 글귀(label·detail·header·formula·ai_*)와 람다가 **모듈을 읽을 때 한 번** 만들어진다(`signal_rules.py:155-271`). 그래서 `build_rules(t) -> (BUY, SELL)` 공장 함수와 기준별 캐시가 필요하고, 기본 `BUY/SELL/RULES` 는 그대로 남겨야 한다. 손댈 곳: `signals.py:51,65,99`, `dashboard.py:38,42`(행 수 = 그 사람의 N+1), `ai_analysis.py:195`(`SIGNAL_RULES` 모듈 상수가 `:476,:556`, `ai_portfolio.py:299` 에서 쓰인다), `:236,:438-441`, `queries.last_buy_signal_dates`, `history.py:57-71`, `rebalance._shoulder_flags`, `alerts.current_values`. 원본 글자를 바꿔 끼우는 테스트(`test_signal_rules.py:208-238`)와 "숫자가 흩어지지 않았나" 검사(`:250-275`)도 같이 고친다. 이격도 풀이 "종가가 MA20 아래"(`:160`)는 기준이 +3 이면 틀린 말이 되니 기준값으로 만든다.
5. **고쳐야 함 — 판(지문)과 화면 저장소.** 카드의 `signal_rules_version` 과 `/api/signal-rules` 의 `version` 은 **같은 함수**로 만들어야 한다. 기본인 사람에게는 `fingerprint()` 그대로여야 하고(응답 사진), 둘이 어긋나면 `ensureSignalRules` 가 화면을 그릴 때마다 다시 받는다(`signalRules.ts:32-35`). 판은 카드 첫 장에서만 읽는다(`Dashboard.tsx:367`). 종목이 0개인 사람은 기준을 바꿔도 다시 받지 않으므로, 저장하면 PUT 응답의 새 판으로 바로 다시 받는다. 공용 `fingerprint()`(다시 계산·`signal_diff`·`admin.py:135`)에는 사람의 기준을 섞지 않는다.
6. **고쳐야 함 — 격리 표.** `/api/signal-rules` 는 지금 `(SHARED, USER)` 다(`test_isolation.py:101`). 사람마다 다른 값을 주면 `MINE` 으로 옮기고 확인(CHECKS)을 붙여야 한다(`:863`). 초안의 "(USER, USER)"는 `(MINE, USER)` 로 고친다.
7. **고쳐야 함 — "공용 AI 정리"의 전제가 틀렸다.** 종목·전체 정리는 저장해서 나눠 쓰는 글이 아니다. 각자 자기 키로 그때 만든다(`routers/ai.py:85,149,252`). 전체 정리는 그 사람 종목을 쓰고, 진단·분석과 같은 `_indicator_section/_signal_section` 을 쓴다(`ai_portfolio.py:187-189`). 정리만 공용 기준으로 두면 같은 사람의 카드와 정리가 다른 판정을 말한다. A-결정 2 의 범위를 AI 넷 전부로 넓혀 묻는다.
8. **참고** — 알림: 기준을 바꾼 다음 판정 때 "새로 켜진" 매수가 알림으로 간다(`alerts.py:192-200`). 기대하는 동작인지 계획에 적는다. `knee_buy_v2` 필드에 그 사람 기준의 값을 넣으면 옛 화면도 같은 값을 그리니 맞다. 다만 필드 뜻이 "공용"에서 "내 기준"으로 바뀐다는 점은 명세에 적는다. 기본 길 쿼리 수: 설정은 `db.get(UserSettings)` 로 읽으면 리밸런싱 계산이 이미 불러 둔 것을 다시 쓴다(identity map). 범위 검사는 0.5·0.05 단위를 실수 오차 안에서 보고, N 은 정수만 받는다.

**제안**: (a) `GET /api/signal-thresholds` 는 빼고 `/api/signal-rules` 에 `custom`·`defaults`·`thresholds` 를 실어 보낸다. 옛 서버는 0.40 이면 404, 0.41 이면 `custom` 필드가 없다 — 이것으로 버튼을 숨긴다. 엔드포인트는 PUT·DELETE 둘만 남는다. (b) 마지막 매수일은 최근 1년부터 거꾸로 찾고, 없을 때만 전체를 본다. 결과는 (기준 지문, 종목, 마지막 지표 날짜) 키로 캐시한다. 사람이 아니라 기준이 키라서 같은 기준을 쓰는 사람끼리 나눠 쓴다. (c) 다시 계산하는 값은 바꾼 키가 닿는 것만 고른다. 비교 기간이 그대로면 매도·어깨매도는 저장값을 쓴다. 마이그레이션 0013(nullable JSON)은 되돌릴 수 있고 옛 이미지에서도 무해하다. 크기는 **큼**이 맞다.

## B1 조건 이름
**찬성** 작음. AI 글은 `ai_short/ai_long` 에 따로 있어 그대로 둘 수 있다. **걱정(고쳐야 함)**: 이름표만 바꿔도 지문은 그대로인데, `test_screen_fallback_is_what_this_server_sends`(`test_signal_rules.py:163-173`)가 `signalRulesLegacy.json` 과 글자까지 같은지 본다. 그래서 그 JSON 도 같이 고친다(0.40 서버는 글귀를 보내지 않으니 해는 없다). 화면에 박힌 머리글 `Dashboard.tsx:1011,1363` "+DI / -DI" 도 바꿀 대상이다. **제안**: A 의 공장 함수 안에서 한 번에 바꾼다.

## B2 차트 오늘 ▲
**찬성 · 원인 찾음(화면만 고치면 된다)**. `collapseStreaks` 가 이어진 구간의 **첫날**에만 점을 찍는다(`PriceChart.tsx:30-45,140-146`). 게다가 `STREAK_GAP_DAYS = 4` 는 **달력 날짜**라서(`:24`) 이틀 끊긴 신호도 한 구간으로 묶는다. 가짜 서버에서 005930.KS 는 10-01·02·05 ▲, 06·07 없음, 08~14 ▲ 인데 한 구간이 되어 ▲는 10-01 하나뿐이다(카드는 "오늘 매수"). NVDA 도 10-07~14 가 이어져 오늘 자리에 점이 없다. 서버와 응답 사진은 그대로다. **제안**: 맨 마지막 가격 날짜에 걸친 구간이면 끝날에도 ▲ 를 찍는다. 묶는 간격은 거래일로 센다. 범례의 구간 수가 바뀌는지도 테스트한다.

## B3 세로축·날짜 형식
**찬성** 작음. `createChart` 에 `localization` 이 없다(`PriceChart.tsx:99-112`). `priceFormatter`(통화별)·`timeFormatter`·`tickMarkFormatter` 로 고친다. 통화는 `history` 에 없으니 부모에서 넘겨야 한다. **참고**: 매크로 차트(`MacroChart.tsx:76`)도 같다.

## B4 0종목 안내
**찬성** 작음. 문구는 `Dashboard.tsx:652` 에 있다.

## B5 칩 색
**찬성** 작음. **걱정(참고)**: `display.ts:188-235` 의 green/red 는 부호 색과 "강세·약세" 뜻 색이 섞여 있다. `.tone-*` 는 "상승 색과 무관"하게 정해 둔 것이다(`index.css:1258`). 부호 칩만 `.up/.down` 으로 옮기고, 매수 ▲ 초록 같은 신호 색은 건드리지 않는다.

## B6 새로 넣을 돈
**찬성**: 계산이 모두 화면의 순수 함수 `buildOrderPlan`(`orderPlan.ts:111-157`)에 있다. **걱정(고쳐야 함)**: 초안의 "요청에 선택 필드 하나"는 틀렸다. ㉡ 은 서버를 고칠 것이 없는 **화면만의 일**이다. 크기는 **작음~중간**이다: 선택값 하나, 모자란 만큼 비례 배분, 모자란 합이 새 돈보다 작을 때 남는 돈(현금 줄로), 현금 목표 % 처리, 0.5% 잡음 기준, `orderTitle`, 기기 저장 키 하나, 테스트 6~8개. **제안**: 기존 현금은 섞지 않고 "새 돈만"으로 정의를 명세 6.4 에 못 박는다.

## B7 소수 주
**찬성** 작음. `orderTitle` 의 `toFixed(2)`(`orderPlan.ts:160-166`)와 표의 주수 칸만 고치면 된다. 금액은 그대로 둔다.

## B8 en-US@posix
**찬성 · 원인 찾음**. lightweight-charts 5.2.1 은 `localization.locale` 이 없으면 `navigator.language` 를 그대로 쓴다(`node_modules/lightweight-charts/dist/lightweight-charts.development.mjs:12469`). 그 값이 `Intl`·`toLocaleString` 으로 가서 RangeError 가 난다. 앱 코드는 이미 'ko-KR' 을 직접 넘긴다. **제안**: B3 과 같은 자리에서 `locale: 'ko-KR'` 을 준다. `PriceChart`·`MacroChart` 둘 다다. 테스트는 `navigator.language` 를 그 값으로 바꿔서 본다.

## B9 7203.T 이름 없음
**찬성 · 원인 찾음(앱 탓 + 가짜 데이터가 드러낸 것)**. 카드 이름은 `UserStock.name` 만 쓰고 공용 이름으로 넘어가지 않는다(`dashboard.py:102`, `rebalance.py:412`, `fundamentals.py:26`). 알림은 넘어간다(`alerts.py:146`). 실제로도 추가할 때 이름 해석이 실패하면 생긴다(`stocks.py:187-189`). 공용 이름은 나중에 채워질 수 있다(`symbols.py:624-630`). `instrument` 는 이미 joined 로드라(`models.py:124`) 쿼리는 늘지 않는다. **걱정(참고)**: 응답 `name` 에 공용 이름을 채우면 friend 응답 사진이 바뀐다(원인과 함께 적는다). 편집 화면(`/api/stocks`)은 그대로 둬야 사용자 이름 칸에 공용 이름이 저장되지 않는다.

## 요약
막음 1(A-1) · 고쳐야 함 8(A-2~7, B1, B6) · 원인을 짚은 것: B2·B8·B9.
