# 디자인 4차 묶음 3 (종목) 재검토 판정 — 8f57144 (보완 범위 46c1b79..8f57144, 묶음 시작 895eec3, 차수 시작 79b8850)

# 조건부 합격

지난 판정(`3-review.md`, bb04e7d)의 조건 다섯 가운데 넷(2·3·4·5)은 풀렸다. 조건 1은 큰 줄기가 풀렸다.

- 풀린 것
  - 없는 종목 주소는 이제 한 줄 안내 + "종목 탭으로" 를 보이고, 시세를 부르지 않는다. 영어 오류와 콘솔 오류도 0 이다.
  - 겹친 팝업은 Esc 를 한 번 누르면 하나씩 닫힌다.
  - 추가 시트의 Tab 은 시트 안에서만 돈다.
  - 접힌 카드의 배지 자리는 테스트가 지킨다.
  - 문구변경 · 차이표 · lib 이유 · README 표가 채워졌다.
- 기능 불변 경로(backend · api · types · AppState)의 diff 는 비어 있다.
- 전체 audit 397 조합을 bb04e7d 와 화면 × 조건마다 견줬다. 다른 곳은 menu-diagnostics 두 칸뿐이고, 둘 다 데이터 폴더 경로 때문에 생긴 측정 잡음이다. 회귀는 0 이다.
- 실행자가 보고한 수치(vitest 1098 · lint 20 · tsc 통과)도 직접 돌려 같은 값을 얻었다.

다만 보완 커밋이 새로 만든 것 둘과 조건 1 에서 남은 하나를 고쳐야 한다. 셋 다 작다.

- **겹친 팝업에서 Tab 이 뒤 화면으로 샌다(새 회귀).** 조건 2 를 고치면서 생겼다. bb04e7d 에서는 차트 팝업 안에 머물렀다.
- **소문자 · 이름 주소는 여전히 시세를 두 번 부른다.** 이번에는 화면 전체를 다시 만든다(조건 1 의 남은 것). 단위 테스트는 실제 앱의 라우트 감싸개를 거치지 않아서 이것을 잡지 못한다.
- **AI 분석을 연 채로 ‹ "종목 목록으로" 를 누르면 AI 만 닫힌다.** 목록으로 가려면 한 번 더 눌러야 한다(새로 들어온 AI 머리 단추와 뒤로가기가 부딪침).

검토자가 직접 한 것은 다음과 같다.

- 자기 worktree(`scratchpad/r3b/wt`, HEAD detached at 8f57144)에서 `npm ci` → `tsc -b` → lint → vitest → build 를 돌렸다.
- 가짜 서버는 8183 에 띄웠다(`--reset`, 데이터는 저장소 밖 `scratchpad/r3b/data`).
- 회귀를 견주려고 지난 검토의 bb04e7d 빌드(`scratchpad/r3/wt`)를 같은 포트에 잠깐 띄워 Tab 동작만 다시 쟀다. 데이터는 `r3b/data-old` 다.
- 뮤테이션 검사를 네 번 했다. 고친 줄을 되돌려 테스트가 떨어지는지 보고, 곧바로 원래대로 돌려놓았다.
- 서버는 모두 PID 로 껐다.

산출물 위치(모두 `/tmp/claude-0/-home-user-Dashboard/c9553d42-71a5-5379-90e1-1c42ba786c3a/scratchpad/r3b/`):

| 무엇 | 경로 |
|---|---|
| audit 결과 | `audit/summary.md` · `audit/results.json` (기준은 `../r3/audit/`, bb04e7d) |
| 사진 | `shots/` |
| 탐침 스크립트와 출력 | `p1.mjs`(주소) · `p1b.mjs`(요청 수 · 비활성) · `p2.mjs`(팝업 · 시트 키보드) · `p2old.mjs`(bb04e7d 견줌) · `p3.mjs`(보유 · AI · 재무) · `p4.mjs`(AI + ‹) · `p5.mjs`(순서 · 시트 포커스 · 360 머리 · 처음 온 사람 · 흐린 줄표), 각 `.log` |
| 명령 출력 | `vitest.log` · `lint.log` · `tsc.log` · `build.log` · `audit.log` |

## 합격으로 올릴 조건

1. **겹친 팝업에서 Tab 이 뒤 화면으로 샌다 — 조건 2 를 고치면서 생긴 회귀 (3-1 키보드 "팝업 안에서만 돈다")**
   - 재현(`p2.mjs` A·B, 폰 390 · PC 1400 같음): 시그널 목록에서 이름을 눌러 차트 팝업을 열고, 보유 → 고치기 를 눌러 `["VOO 차트","VOO 수정"]` 을 띄운다. 거기서 Tab 을 누르면 이렇게 간다.
     ```
     TOP:VOO 평단가 | TOP:VOO 산 환율 | TOP:취소 | OUT:개인정보처리방침 · 이용약관 | OUT:… | OUT:전체 새로고침 | OUT:홈 | OUT:종목 | …
     ```
     삭제 확인창(`["VOO 차트","VOO 삭제"]`)도 같다: `TOP:네, 지웁니다 | OUT:개인정보처리방침 · 이용약관 | OUT:…`.
     Esc 를 누른 뒤에는 포커스가 뒤 화면(`OUT:홈으로` · `OUT:owner관리자`)에 남는다.
   - bb04e7d 에서 같은 스크립트를 돌리면(`p2old.mjs`) 포커스가 팝업 안(`TOP:` · `UNDER:`)에서만 돈다. 예: `TOP:네, 지웁니다 | UNDER:닫기 | UNDER:차트 | …`.
   - 까닭:
     - `lib/focusTrap.ts:19` 의 `if (isCovered(ref.current)) return` 때문에, 안쪽 팝업이 떠 있으면 차트 팝업이 Tab 가두기를 그만둔다.
     - 그런데 안쪽 팝업(`StockEditModal` · `ConfirmDialog`)에는 가두기가 따로 없다. 그래서 아무도 가두지 않는다.
     - `ChartModal.test` 의 새 테스트는 Esc 만 본다.
   - 고칠 길:
     - 안쪽 팝업이 떠 있으면, 차트 팝업의 가두기가 맨 위 dialog 를 기준으로 가둔다. 또는 `StockEditModal` · `ConfirmDialog` 도 `useFocusTrap` 을 쓴다.
     - 안쪽 팝업을 닫으면 그 팝업을 연 단추로 포커스를 돌린다.
     - "수정 · 삭제 확인 위에서 Tab 은 그 팝업 안에서만" 테스트를 하나 둔다.

2. **소문자 · 이름 주소는 아직도 시세를 두 번 부른다 (조건 1 의 남은 것)**
   - 재현(`p1.mjs` · `p1b.mjs`, 폰 390):
     - `/stocks/005930.ks` · `/stocks/삼성전자` · `/history?ticker=voo` · `/history?ticker=삼성전자` · `/stocks/voo` · 비활성 `/stocks/schd` 모두 `GET /api/history/<티커>?range=1y` 를 **두 번** 부른다.
     - `/stocks/voo` 를 열면 API 를 10 번 부른다. `/stocks/VOO` 를 바로 열면 6 번이다.
       ```
       dashboard · stocks · signal-rules · history/VOO · fundamentals/VOO · dashboard · stocks · history/VOO · fundamentals/VOO
       ```
     - 정확한 주소(`/stocks/VOO`, `/chart?ticker=AAPL` → `/stocks/AAPL`)와 앱 안에서 줄을 눌러 들어가는 경우는 한 번이다.
   - 까닭:
     - `App.tsx:28` 의 `Tab` 은 `<PageBoundary key={pathname}>` 로 감싼다. 그래서 주소를 `/stocks/voo` → `/stocks/VOO` 로 바꾸면(`StockDetailPage.tsx` 의 `navigate(…, { replace: true })`) 화면 전체가 새로 만들어진다.
     - 3-보완.md 의 "시세를 한 번만" 은 단위 테스트에서만 맞다. `StockDetailPage.test.tsx` "소문자·이름 주소…" 는 `Tab` 없이 그린다.
   - 사용자에게 보이는 오류는 없다. 주소도 맞게 바뀌고, 뒤로가기에 옛 주소가 남지 않는다(`back from /stocks/voo -> /stocks`). 그래서 지난 조건 1 의 큰 줄기(영어 오류 · 빈 범례 · 없는 종목 시세)는 풀렸다. 남은 것은 두 번 부르기 하나다.
   - 고칠 길(하나만 고른다):
     - `match.ticker !== ticker` 이면 `StockDetail` 을 그리지 않고 바꾸기만 한다(`return null` 또는 `<Navigate replace>`).
     - 또는 `ToStock` · 라우트 단계에서 맞춘다.
     - 테스트는 실제 라우트(`App` 이나 `Tab` 감싸개)로 "시세 한 번" 을 본다.

3. **AI 분석을 연 채로 ‹ "종목 목록으로" 를 누르면 목록으로 가지 않는다 (새로 들어온 AI 머리 단추)**
   - 재현(`p4.mjs`, 390 · 1400 같음): 종목 탭에서 VOO 줄을 누른 뒤 머리의 "AI 분석" 을 누르고, ‹ 를 누른다.
     - 결과는 `after ‹ once: /stocks/VOO ai region 0 tab 차트` 다.
     - 한 번 더 눌러야 `/stocks` 로 간다.
   - 까닭: ‹ 는 `navigate(-1)` 이다. 그런데 `AiView` 의 `useBackToClose` 가 기록을 한 칸 쌓아 두어서, 그 칸이 먼저 빠지며 AI 만 닫힌다.
   - 이름이 "종목 목록으로" 인 단추가 목록으로 가지 않는다. 사용자 확인의 "뒤로가기는 AI 만 닫고 차트로" 는 **브라우저 뒤로가기** 에 맞는 말이고, ‹ 에는 맞지 않는다.
   - 고칠 길:
     - AI 를 연 상태에서 ‹ 를 누르면, AI 칸을 먼저 빼고 목록으로 간다.
     - 또는 AI 가 열려 있는 동안 ‹ 를 "차트로" 로 바꾸고 이름을 맞춘다.
     - 둘 중 하나를 테스트로 남긴다.

## 지난 조건별

| # | 지난 조건 | 판정 | 증거 |
| --- | --- | --- | --- |
| 1 | 옛 주소 · 없는 종목 | **대부분 통과 — 두 번 부르기만 남음(위 2)** | 아래 "조건 1 상세" |
| 2 | 팝업 위 팝업 Esc | 통과 (Tab 은 새 회귀 — 위 1) | `p2.mjs` A: `after Esc 1 ["VOO 차트"]` → `after Esc 2 []`. B(삭제 확인): `["VOO 차트"]` → `[]`. 390 · 1400 같음. 뒤로가기도 하나씩: `["VOO 차트"] -> []`. 뮤테이션: `ChartModal.tsx` 의 `isCovered` 줄을 지우면 `ChartModal.test` "팝업 위 팝업 …" 1 failed |
| 3 | 추가 시트 Tab | 통과 | 아래 "조건 3 상세" |
| 4 | folded2-360 49 | 통과(이유 적힘 · 테스트 있음 — 아래 "조건 4 상세") | 아래 "조건 4 상세" |
| 5 | 문구변경 · 차이표 · lib 이유 · README | 통과 | 아래 "조건 5 상세" |

### 조건 1 상세

- 없는 종목(`p1.mjs`):
  - `/stocks/NOPE` · `/history?ticker=NOPE` 를 열면 다음이 나온다.
    ```
    ‘NOPE’ 은 담은 종목에 없습니다 · 종목 탭의 찾기 칸에서 … · 종목 탭으로
    history 0 · errs 0 · AI btn 0
    ```
    `stock not found` 와 `매수 0일` 이 없다(`shots/addr-_stocks_NOPE.png`).
  - 지인 `/stocks/NVDA` · `/history?ticker=NVDA` 도 같다(`shots/friend-*`).
- 대소문자 · 이름:
  - `/stocks/005930.ks` · `/stocks/삼성전자` · `/history?ticker=삼성전자` 는 `/stocks/005930.KS` 로 간다.
  - `/history?ticker=voo` 는 `/stocks/VOO` 로 간다.
  - 콘솔 오류 0, 영어 0 이다. 시세를 두 번 부르는 것만 남았다(위 2).
- 비활성(`p1b.mjs`):
  - 가짜 서버에 비활성 종목이 없어서, 검토자 데이터에서 SCHD 를 비활성으로 바꿨다(`DELETE /api/stocks/SCHD` → `active:false`).
  - `/stocks/SCHD` 는 열리고 차트도 나온다. 오류 0 이다.
- 목록 실패(`/api/stocks` 500 을 가로챔):
  - `/stocks/005930.KS` 는 `⚠ boom` 줄과 차트를 보인다. 시세는 한 번 부른다. 콘솔 오류 1 은 일부러 낸 500 이다.
  - `/stocks/NOPE` 는 목록을 모르니 주소 그대로 연다. 그래서 `⚠ stock not found` 와 `매수 0일` 이 보인다. 옛 HistoryChart 도 같은 동작이었고, 0.45.1 테스트 "목록을 못 받아도 주소의 종목 차트는 전처럼 연다" 와 같다. 회귀가 아니다(참고 1).
- 지워진 테스트 넷이 대신됐다(`StockDetailPage.test.tsx` "주소의 종목 — …" 4개):

  | 지워진 것(895eec3 `HistoryChart.test.tsx`) | 대신한 것 |
  | --- | --- |
  | :130 | "담은 종목에 없는 티커면 …" |
  | :144 | "없는 티커의 시세는 부르지 않는다 …" |
  | :171 | "목록을 못 받아도 …" |
  | :183 | "소문자·이름 주소는 …" |

- 뮤테이션: `const unknown = false` 로 바꾸면 2 failed(`…한 줄로 말하고…` · `…시세는 부르지 않는다…`). 되돌려 놓았다.

### 조건 3 상세

- `p2.mjs` E, 390 · 1400 같음. 시트를 열면 포커스가 `new-weight` 에 간다. 거기서 Tab 을 14 번 눌러도 모두 `TOP:` 이다(`… 종목 추가 | 추가 닫기 | new-category | new-weight …`). Shift+Tab 도 시트 안에서 돈다.
- 키보드로 열고(찾기 → ↓ → Enter) Esc 를 누르면 포커스가 찾기 칸(`INPUT`)으로 돌아간다(`p5.mjs`).
- 뮤테이션: `AddStockSheet` 의 `useFocusTrap` 을 빼면 `StockManager.test` "Tab 은 시트 안에서만" 1 failed.

### 조건 4 상세

- audit 은 49 로 bb04e7d 와 같다. 늘어난 넷은 여전히 `ph390-text130-dark` 의 dash-signal 이다.
- 받아들인 까닭은 3-보완.md 4행에 있다: 값 칸을 오른쪽에 둔 채로 17자 이름은 한 줄에 못 들어가고, 값을 아래로 보내면 주인이 요청한 카드 높이가 다시 늘어난다.
- 규칙과 맞춰 보면:
  - PROMPT 3-2 "폰 360에서 2줄인 버튼은 목록으로 남긴다" 와 맞는다. status.md 도 묶음 2 부터 이 항목을 "목록만" 으로 다뤘다.
  - 다만 plan.md 1장 합격선의 글자는 "늘지 않음" 이다. 지난 판정이 "또는 왜 받아들이는지 적는다" 를 고칠 길로 주었으니 통과로 본다. 그래도 ② 보고의 "남은 문제" 에 "360 두 줄 45 → 49, 까닭" 한 줄을 넣어 주인이 알게 한다(참고 2).
- 지키는 테스트는 `Dashboard.test.tsx:403-406` 이다. 배지가 `.stock-line` 안에 있고, 토글 안에는 없음을 본다.
  - 뮤테이션: 배지 묶음을 토글 안으로 옮기면 "폰 카드는 접혀 있고 …" 1 failed. 되돌려 놓았다.

### 조건 5 상세

- 문구변경.md 에 "묶음 3" 절 29행이 생겼다. 지난 판정이 든 문구는 모두 있다.
  - 찾기 칸 · PageIntro · 시세 갱신 · 목표 0% · 빈 목록 · 후보 없음 · 머리 "종목 N개"
  - 신호 · 보유 · 재무 · AI 새 글
- 고친 테스트는 문구 표와 1:1 로 맞는다.
  - `Dashboard.test` 흐린 줄표 2곳 ↔ "시그널 목록 풀이"
  - `FundamentalsPage.test` · `RebalancePanel.test` ↔ "빈 화면"
  - `HoldingTab.test` 다이얼로그 이름 ↔ "종목 안 · 고치기"
  - `FundamentalsPage.test` 의 나머지 바뀐 줄은 `MemoryRouter` 감싸기뿐이다(‹ 링크 때문).
- 목업 차이표(3-보완.md "목업 11 과 다른 곳" 11행)가 지난 판정의 여섯 곳을 모두 다루고, 까닭이 있다.
  - 보유 탭의 수익률 차이는 이번에 평가금액 · 수익률(+수익금)을 넣어 줄였다.
- lib 이유 표 9행에 새 `focusTrap.ts` 도 있다. 이번 범위의 lib diff 는 `focusTrap.ts` 하나다(새 파일, 차트 팝업에 있던 Tab 가두기를 옮김 + `isCovered`).
- `mockups/README.md` 의 묶음 3 줄은 이제 다섯 칸이다(표 머리와 같음).

## 항목별 (3-1 · 6장)

| 항목 | 판정 | 증거 |
| --- | --- | --- |
| npm ci · tsc -b · build | 통과 | `ci 0` · `tsc 0` · `✓ built in 403ms` |
| lint | 통과 | 경고 20 (`grep -c ': warning' lint.log`), 기준 22 · 지난 21 |
| vitest | 통과 | `Test Files 67 passed (67)` · `Tests 1098 passed (1098)` (지난 1084, 기준 1076) |
| 백엔드 테스트 | 해당 없음(돌리지 않음) | `git diff --stat 895eec3 8f57144 -- backend` 가 비어 있다 |
| 기능 불변 — backend · api · types · AppState | 통과 | `git diff --stat 46c1b79 8f57144 -- backend frontend/src/api frontend/src/types.ts frontend/src/AppState.tsx` 와 `895eec3 8f57144` 둘 다 비어 있음 |
| 기능 불변 — lib | 통과(이유 적힘) | 이번 범위는 `focusTrap.ts` 하나(+53). 3-보완.md lib 표 |
| 그 밖의 `.tsx` 한 줄씩 | 통과(참고 있음) | 아래 "새로 들어온 것" 표. 새 상태(`only` · `moved` · `current` · AI 뒤로가기)는 모두 사용자 확인 헤맴을 풀려는 표시 · 이동 쪽이다. API 는 이미 있는 것만 쓴다(`getRebalanceCurrent` 는 홈 · 리밸런싱이 쓰는 같은 응답, 새 계산 없음). 이동 경로는 "재무 한눈에 ›" · "‹ 종목 탭으로" 두 곳이고 3-보완.md 에 까닭이 있다 |
| 글자 자르기 | 통과 | 이번 diff 의 `+` 줄에 ellipsis · `overflow: hidden` · `text-overflow` 0. audit clipped 0 · page-overflow 0 |
| 44px | 통과 | audit touch 0. 머리 "AI 분석" 66×44(390 · 360), 재무 ‹ 44×44 |
| 두 테마 대비 | 통과 | audit contrast 0 · color-unread 0. 순서 표시 줄 `--accent-soft` 위 글자는 audit 밖이라 눈으로 봤다(`shots/order-*`), 읽힘 |
| 색표 밖 색 | 통과 | 1장 명령 결과 14줄 = index.html 2 · manifest 2 + 토스페이스 원본 SVG 10(묶음 2 부터 있던 손대지 않는 원본, 이번 범위 diff 없음). diff `+` 줄에 `#hex` · `rgb(` 0 |
| 키보드 | **실패** | 조건 1(새 회귀). 시트 · 단독 차트 팝업은 통과 |
| 회귀(audit) | 통과 | 아래 |
| 목업과 같음 · 문구 변경 표 | 통과 | 조건 5 |
| 고친 깨짐마다 테스트 | 통과(위 조건 1 · 2 · 3 빼고) | 뮤테이션 넷 모두 떨어짐. 겹친 팝업 Tab(조건 1) · 실제 라우트에서 시세 한 번(조건 2) · AI 연 채 ‹(조건 3)은 지키는 테스트가 없다 |
| 계획 검토 걱정(plan-*.md) | 통과 | 이번 범위에 새로 걸리는 "반영" 항목 없음. 색 · 터치 · 대비 · 목업 차이(R10) · 고친 깨짐 검사(합격 8) 확인. "막음" 남은 것 없음 |

## 새로 들어온 것(사용자 확인 반영분)의 회귀

| 곳 | 판정 | 증거 |
| --- | --- | --- |
| 보유 탭 · `StockEditModal only` | 통과 | 아래 "보유 탭 · `StockEditModal only` 상세" |
| 보유 탭 · `getRebalanceCurrent` 줄 | 통과 | 아래 "보유 탭 · `getRebalanceCurrent` 줄 상세" |
| AI 머리 단추 · 뒤로가기 | **조건 3** · 나머지 통과 | 아래 "AI 머리 단추 · 뒤로가기 상세" |
| 신호 없는 날 한 줄 | 통과 | 아래 "신호 없는 날 한 줄 상세" |
| 재무 한눈에 › · ‹ | 통과 | `/stocks/AAPL?tab=fundamentals` 의 "여러 종목 재무 한눈에 ›" → `/fundamentals`, h2 "재무 한눈에", ‹ `종목 탭으로` 44×44 |
| NoStocksYet · 처음 온 사람 안내 | 통과 | new@ 로 `/rebalance` · `/fundamentals` 를 열면 "종목 탭에서 종목을 담으면 …" 이 나온다. `/` 의 세 단계는 "종목 탭의 찾기 칸에서" · "종목 안의 '보유'에서" 다(`shots/new_*.png`). "종목 관리" 는 남아 있지 않다 |
| Dashboard "흐린 줄표" | 통과 | 화면: "흐린 줄표 —는 관망(…)" · 읽기 기기: "흐린 줄표는 …"(— 는 `aria-hidden`) |
| 순서 바꾸기 | 통과(참고 3) | `p5.mjs`. ▲ 를 누르면 그 종목의 같은 단추로 포커스가 간다(`focus SCHD 위로`). "✓ 순서를 저장했습니다 — …" 가 나오고 `.just-moved` 는 1 이다. 키보드로 같은 단추를 다시 누르면 같은 종목이 한 칸 더 오른다 |
| 시트 "비워 두면 0%" 한 줄 | 통과 | `StockManager.test` "담는 시트 — …" 와 audit stocks-sheet 0 |
| 카드 "3개월" | 통과 | audit stocks-card 0 |
| 360 머리(긴 이름 + AI) | 통과 | TIGER · 7203.T, 다크 · 라이트. 머리 높이 48, `scrollWidth 360`, 이름은 두 줄이고 AI 단추는 오른쪽 한 줄(`shots/detail-360-*`) |

### 보유 탭 · `StockEditModal only` 상세

- `p3.mjs` 기준이다. 고치기 → dialog `"VOO 수정"`. 수량 칸은 1개(VOO 만)이고, 포커스는 `VOO 보유수량` 에 간다. 머리는 "목표 비중 합계 84.0%" 로 전체를 센다.
- 45 를 넣고 저장했다. `PUT /api/rebalance/holdings/VOO` 한 번이고, 그 뒤 "✓ VOO 1종목을 저장했습니다" 와 `45주` 가 나온다.
- 일괄 수정(⋯ "한 번에 수정")의 `"종목 한 번에 수정"` 은 audit modal-stock-edit 0 이다.

### 보유 탭 · `getRebalanceCurrent` 줄 상세

- 보유 탭을 열면 부르는 것은 `GET /api/rebalance/current` 하나가 더해진 것뿐이다. 바뀌는 요청은 없다.
- 화면 값이 응답 값과 같다.

  | 칸 | 화면 | 응답 |
  | --- | --- | --- |
  | 평가금액 | ₩5,449,377 | `current_value_base 5449376.8` |
  | 수익률 | +21.9% +$708.00 | `return_pct 21.95` · `pnl 708` · `shown_currency USD` |
  | 비중 지금 / 목표 | 1.1% / 18.0% | `actual 1.06` · `target 18` |

- 신호 탭에는 "지금 1.1% · 목표 18.0% (허용 ±5.0%p)" 가 나온다(`band_pct 5`).
- 차트 탭만 보는 팝업은 이 응답을 부르지 않는다(`CurrentLoader` 는 신호 · 보유 탭일 때만).

### AI 머리 단추 · 뒤로가기 상세

- 종목 안:
  - AI 를 열고 뒤로가기를 누르면 `/stocks/VOO` 에 그대로 있고, AI 는 0 이 되며 "차트" 가 선택된다. 한 번 더 누르면 `/stocks` 다.
  - AI → 재무 탭 → 뒤로가기 → `/stocks` (기록이 남지 않음).
- 차트 팝업 안(390 · 1400): AI 를 열고 뒤로가기를 누르면 `["VOO 차트"]` 가 남고 차트 탭이 선택된다. 한 번 더 누르면 `[]` 이고 주소는 `/?view=signal` 그대로다.
- 차트 팝업만 띄웠을 때는 Esc 한 번에 `[]`.

### 신호 없는 날 한 줄 상세

- VOO(비중 미달만)·TIGER(비중 초과만)에서는 "오늘은 매수·매도 신호가 없습니다. …" 가 나온다.
- 삼성전자(매수)·AAPL(매도)에서는 없다(`p1.mjs` 본문).
- 단위 테스트 둘이 이것을 본다.

## 자동 검사 (전체 397 조합)

bb04e7d 와 화면 × 조건마다 견줬다(`results.json` 끼리).

| 검사 | 묶음 2 끝 | bb04e7d | 8f57144 | 판단 |
| --- | --- | --- | --- | --- |
| 열지 못한 것 | 0 | 0 | 0 | 통과 |
| page-overflow · clipped · folded3 · touch · contrast · console · cond-missing · nowrap-split · sticky-left · fake-button · quiet-target · color-unread · tnum-width · text-overlap · focus-ring | 0(가짜 단추 9) | 0 | 0 | 통과 |
| orphan | 61 | 62 | 61 | 같음. 차이 −1 은 menu-diagnostics `ph390-text130-dark` 한 칸이다. 서버 상태 팝업이 검토자의 `--data-dir` 경로를 보여서 생긴 잡음이고, 경로 길이가 r3 → r3b 로 달라졌다 |
| num-split | 14 | 22 | 23 | 같음. 차이 +1 은 menu-diagnostics `ph390-dark` 의 `/tmp/claude-0/…-90e1-1` 이다(같은 잡음). 이것을 빼면 fundamentals 10 · macro 3 · guest-macro 1 = 14 다 |
| folded2-360 | 45 | 49 | 49 | 조건 4(이유 적힘) |
| 그 밖의 화면 × 조건 | — | — | — | **다른 칸 0** (menu-diagnostics 두 칸 말고는 397 조합이 bb04e7d 와 같다) |

## 참고 (막지 않음)

1. 목록을 못 받은 채 없는 티커 주소를 열면 옛날처럼 영어 404 와 "매수 0일" 이 보인다. 0.45.1 과 같은 동작이다. 목록이 실패했을 때도 "목록을 못 받아 이 종목이 담겨 있는지 모릅니다" 같은 한 줄로 바꿀지는 다음에 정해도 된다.
2. folded2-360 49 를 받아들인 것은 plan.md 1장 글자("늘지 않음")와 다르다. ② 보고의 "남은 문제" 표에 한 줄 넣는다.
3. 순서 바꾸기에서 ▲ 로 맨 위(또는 ▼ 로 맨 아래)에 닿으면, 그 단추가 꺼지면서 포커스가 `BODY` 로 빠진다(`p5.mjs` 1400: `press again … focus BODY`). 다음 Tab 이 페이지 처음부터 시작한다. 반대쪽 단추로 포커스를 옮기면 키보드로 이어 쓸 수 있다.
4. 찾기 후보를 **손가락이나 마우스로** 눌러 연 시트를 Esc 로 닫으면, 포커스가 찾기 칸이 아니라 `BODY` 로 간다(`p2.mjs` E: `after Esc [] focus BODY#`). 연 자리(후보)가 사라졌기 때문이다. 키보드로 열면 찾기 칸으로 돌아간다. 3-보완.md 의 "닫으면 연 자리로" 는 키보드 경우에만 맞다.
5. `.just-moved` 표시는 주석의 "잠깐" 과 달리 "순서 바꾸기 끝" 을 누를 때까지 남는다.
6. "‘{티커}’ 은 담은 종목에 없습니다" 는 받침이 없는 이름(`‘카카오’ 은`)에서 어색하다. 옛 문구와 같아서 회귀는 아니다. "은(는)" 이나 "‘…’ — 담은 종목에 없습니다" 로 바꿀 수 있다.
7. 지난 참고 1(위 탭 ←→ · tabpanel), 3(투자 권유 문구 두 번), 5(PC 기간 칩 270px), 6(audit xcond 를 종목 안에), 7(카드 보기 history 요청 수)은 그대로다. 이번 보완 범위가 아니다.

## 검토자 작업 트리

```
$ git status   (scratchpad/r3b/wt, git rev-parse HEAD = 8f57144)
Not currently on any branch.
Untracked files:
  (use "git add <file>..." to include in what will be committed)
	"docs/design/4\354\260\250-\354\240\234\353\241\234\353\262\240\354\235\264\354\212\244/3-review-2.md"

nothing added to commit but untracked files present (use "git add" to track)
```

이 판정문 말고는 깨끗하다. frontend/node_modules · dist 는 git 이 무시한다.

- 저장소 파일은 고치지 않았고 커밋하지 않았다.
- 뮤테이션 네 번(`Dashboard.tsx` · `ChartModal.tsx` · `AddStockSheet.tsx` · `StockDetailPage.tsx`)은 하나씩 바로 되돌렸다. 되돌린 뒤 `git status --short` 가 빈 것을 확인했다.
- 가짜 서버 셋(8f57144 두 번 · bb04e7d 한 번, 모두 8183)은 PID 로 껐다.
- 지난 검토의 worktree(`scratchpad/r3/wt`, bb04e7d)는 건드리지 않았다. 빌드만 빌려 띄웠다.
