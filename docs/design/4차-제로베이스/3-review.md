# 디자인 4차 묶음 3 (종목) 검토 판정 — bb04e7d (범위 895eec3..bb04e7d, 차수 시작 79b8850)

# 조건부 합격

주인 답(목업 11: 목록은 줄/카드를 사용자가 고름, 종목 안은 가 · 위 탭 넷)은 앱에 맞게 들어왔다.
기능 불변 경로(backend · api · types · AppState)의 diff 는 비어 있다. 자동 검사 0 항목도 모두 0 이다(열지 못한 것 0, 터치 0, 대비 0, 색표 밖 0).
가짜 단추는 9 에서 0 으로 줄었다. 검증 명령 넷도 실행자가 보고한 수치와 같다.

다만 아래 다섯 가지는 고쳐야 한다.

- **HistoryChart 를 지우면서 0.45.1 B2·BCD 의 동작이 같이 사라졌다.** 없는 종목과 이름 주소를 처리하던 동작이다. 그 동작을 지키던 테스트도 함께 지워졌다.
- **겹친 팝업이 Esc 한 번에 모두 닫힌다.**
- **추가 시트에서 Tab 이 시트 밖으로 샌다.**
- **360 두 줄 단추가 45 에서 49 로 늘었다.**
- **문구변경.md 와 목업 차이표가 다시 비어 있다.** 묶음 2 재검토 조건 4·5 와 같은 종류다.

검토자가 직접 한 것은 다음과 같다.

- 자기 worktree(`scratchpad/r3/wt`, HEAD detached at bb04e7d)에서 `npm ci` → `tsc -b` → lint → vitest → build 를 돌렸다.
- 가짜 서버는 8181(`--reset`, 데이터는 저장소 밖 `scratchpad/r3/data`)에 띄웠다.
- 기준선을 다시 재려고 895eec3 을 따로 빌드해 같은 포트에 띄워 audit 일부를 다시 돌렸다. 그 worktree 는 지웠다.
- 서버는 모두 PID 로 껐다.

산출물 위치(모두 `/tmp/claude-0/-home-user-Dashboard/c9553d42-71a5-5379-90e1-1c42ba786c3a/scratchpad/r3/`):

| 무엇 | 경로 |
|---|---|
| audit 결과 | `audit/summary.md` · `audit/results.json` |
| 기준선 다시 잰 것 | `audit0/` |
| 사진 | `shots/` |
| 탐침 스크립트 | `p1.mjs` ~ `p4.mjs` · `m.mjs`(목업 사진) |
| 명령 출력 | `vitest.log` · `lint.log` · `build.log` |

## 합격으로 올릴 조건

1. **옛 주소·없는 종목 회귀 — 0.45.1 B2·BCD 가 되돌아갔고, 지킨 테스트도 지워졌다**
   - 재현(`p2.mjs` 1절, 폰 390):
     - `/stocks/NOPE` 를 열면 `⚠ stock not found` · `매수 0일 (0번) 매도 0일 (0번)` · `저장된 시세 없음` 이 나온다. 콘솔 오류는 2 이고, `/api/history/NOPE?range=1y` 를 부른다.
     - `/history?ticker=삼성전자`(이름 주소)는 `/stocks/삼성전자` 로 넘어간 뒤 같은 영어 오류를 보인다(`shots/addr-*`).
     - `/history?ticker=voo` 는 열린다. 하지만 `/api/history/voo` 와 `/api/history/VOO` 를 두 번 부른다. `StockDetailPage` 의 `key={card?.ticker ?? ticker}` 가 카드를 받은 뒤 바뀌어 다시 그리기 때문이다.
   - 예전 HistoryChart 는 이 셋을 일부러 막았다. 그 까닭은 지워진 코드 주석에 적혀 있었다(`git show 895eec3:frontend/src/pages/HistoryChart.tsx` 27~32·46~50줄).
     - "서버의 영어 404와 빈 범례 대신 한 줄로"
     - "없는 티커의 시세는 부르지 않는다"
     - "소문자·이름 주소는 담은 종목의 티커로"
   - 지워진 테스트 9개 가운데 4개가 바로 이것이었다. 대신한 테스트는 없다.
     - 지워진 것: HistoryChart.test.tsx :130 :144 :171 :183
     - StockDetailPage.test.tsx · App.routes.test.tsx 는 정상 티커만 본다. HoldingTab.test.tsx:147 은 보유 탭만 본다.
     - 테스트 수는 1076 에서 1084 로 늘었지만, "삭제된 테스트가 대신됐다"는 실행자 말은 이 넷에서 맞지 않는다.
   - 고칠 길:
     - `StockDetailPage` 가 담은 종목 목록(`listStocks`, 같은 캐시 칸)으로 주소의 티커를 맞춘다. 대소문자와 이름을 맞추고, 비활성 종목도 연다.
     - 없으면 한 줄 안내만 보이고 `getHistory` 는 부르지 않는다.
     - 지워진 네 테스트를 `/stocks/:ticker` 기준으로 되살린다.

2. **겹친 팝업이 Esc 한 번에 모두 닫힌다 (팝업 위 팝업은 이번에 새로 생겼다)**
   - 차트 팝업 안에 보유 탭이 생기면서 그 안에서 "종목 한 번에 수정"이나 삭제 확인창이 차트 팝업 위에 뜬다.
   - 재현(`p2.mjs` 2절·`p3.mjs`, 폰 390·PC 1400 둘 다):
     - 시그널 목록에서 이름 → 보유 → 고치기를 누르면 dialog 가 둘이 된다. 수정 칸에서 Esc 를 누르면 `[]`, 곧 둘 다 닫힌다.
     - 삭제 → 확인창을 띄운 뒤 Esc 를 누르면 셋 모두 0 이 된다.
   - **뒤로가기는 맞게 하나씩 닫는다.** 두 번 눌러 2 → 1 → 0 이 된다.
   - Tab 은 수정 팝업 안에서만 돈다. 수정 팝업이 차트 팝업의 DOM 안에 그려지기 때문이다.
   - 까닭: `ChartModal.tsx:65-73` 의 document `keydown` Escape 가 안쪽 팝업이 열려 있어도 `onClose` 를 부른다.
   - 고칠 길:
     - 안쪽 팝업이 열려 있으면(맨 위 dialog 가 자기가 아니면) 차트 팝업은 Esc 를 무시한다.
     - 또는 안쪽에서 `stopPropagation` 한다.
     - "수정 팝업에서 Esc → 차트 팝업은 남는다" 테스트를 하나 둔다.

3. **추가 바텀 시트에서 Tab 이 밖으로 샌다 (3-1 키보드 "팝업 안에서만 돈다")**
   - 시트는 `role=dialog aria-modal=true aria-label="삼성생명 추가"` 이다. 열면 포커스가 `#new-weight` 에 간다. 여기까지는 좋다.
   - 그런데 Tab 을 네 번 누르면 시트 밖으로 나간다(`p1.mjs`): `IN:new-quantity | IN:new-cost | IN:종목 추가 | OUT:개인정보처리방침 · 이 | OUT:… 홈 | 종목 | …`.
   - 뒤로가기로 닫히는 것은 맞다(`sheet after back 0`).
   - 고칠 길: ChartModal 과 같은 Tab 가두기를 `AddStockSheet` 에 둔다. 닫으면 찾기 칸으로 포커스를 돌린다. 테스트도 하나 둔다.

4. **360 두 줄 단추 45 → 49 (1장 합격선 "늘지 않음") · 고친 것을 지키는 검사가 없다 (합격 8)**
   - 같은 서버 · 같은 audit 으로 895eec3 과 bb04e7d 를 잰 결과다.
     - 895eec3: dash-signal 넷이 각 11, fundamentals 1 → 45
     - bb04e7d: 각 12, fundamentals 1 → 49
   - 늘어난 넷은 모두 `ph390-text130-dark` 에서 나온다. `div.ticker-cell > div.stock-line > button.stock-name` 의 "TIGER 미국필라델피아반도체나스닥" 이 두 줄이 된다. 배지를 이름 줄로 올리면서 이름 자리가 좁아졌기 때문이다.
   - 접힌 카드 높이는 폰 390·360 에서 `[118,118,155,118,…,178,118]` 이다. 보통 118 이라는 실행자 측정과 같다. 배지가 둘이면 155, 이유가 두 줄이면 178 이다.
   - 접힌 카드의 배지를 이름 줄로 올린 것(묶음 2 에서 넘어온 깨짐)에는 다시 안 생기는지 보는 테스트도, audit 항목도 없다. `signal-card-badges` 를 grep 하면 Dashboard.tsx · shell.css 에만 나온다.
   - 고칠 길:
     - 긴 이름이면 배지를 다음 줄로 보내거나 이름만 줄바꿈을 허용한다. 또는 왜 받아들이는지 적는다.
     - "접힌 카드 배지는 토글 밖 이름 줄" 을 단위 테스트나 audit 카드 높이 상한으로 남긴다.

5. **문구변경.md · 목업 차이표 · lib 변경 이유가 없다 (묶음 2 재검토 조건 4·5 와 같은 종류가 다시 생겼다)**
   - `git log 895eec3..bb04e7d -- docs/design/4차-제로베이스/문구변경.md` 가 비어 있다. 바뀐 문구는 이렇다.
     - 찾기 칸 글이 "삼성전자, 005930, VOO…" 에서 "종목 찾아 추가 — 삼성전자, 005930, VOO…" 로
     - PageIntro 가 "종목을 추가하면 전체 히스토리를…" 에서 "찾아서 담으면 지난 시세를…" 로
     - "아래 \"시세 갱신\"" 이 "종목 안 \"보유\"의 \"시세 갱신\"" 으로
     - 목표 0% 경고의 고칠 곳
     - 빈 목록 안내
     - 후보 없음 안내("아래" 뺌)
     - 머리 "종목 15종목"
     - 새 글: 신호 탭 · 보유 탭 · 재무 못 받음 · AI 한 줄 안내
   - 목업 11 과 다른 곳의 이유가 어디에도 적혀 있지 않다(폰 390 다크·라이트, `shots/mock-*` 와 `stocks-390-*` · `detail-390-*` 를 나란히 봤다).
     - 보유 탭: 목업은 수량 · 평단가 · **평가금액 · 수익률(+수익금)** 이다. 앱은 수량 · 평단가 · 구분 · 목표 · 밴드 + 시세 갱신 · 비활성화 · 삭제다. 수익률이 빠진 것은 사용자에게 보이는 차이다.
     - 신호 탭: 목업은 무릎매수 카드("조건 4 중 4", 기준 보기) · **어깨매도 카드 늘** · 비중조절 막대("지금 17.2% · 목표 18% (±3%p 안)")다. 앱은 차트 탭의 조건 줄과 같은 것 + 비중 배지만 있다. 매도는 신호가 뜬 날만 나온다.
     - 머리: 목업의 "목표 18% · 지금 17.2%" 칩과 ⋯ 가 없다. 신호 탭의 점은 목업에서 신호 색이고, 앱은 강조색이다(CSS 주석에만 이유가 있다).
     - 순서 바꾸기: 목업은 ≡ 끌기, 앱은 ▲▼ 다. 커밋 메시지에만 적혀 있다.
     - 종목 탭: "거래소 목록 갱신" 줄과 "목표 비중 합계" 배지가 칩 줄에 더해졌다. 머리는 "종목 15종목" 이다.
     - 접힌 시그널 카드: 목업은 79px, 앱은 118px 이다. 커밋 메시지에만 "44px 바닥" 이라고 적혀 있다.
   - `frontend/src/lib` diff(3-1 은 비어야 함)에 이유가 적혀 있지 않다. 되돌림은 아니다(아래 기능 불변 표 참고). 묶음 2 처럼 status 나 차이표에 한 줄씩 적는다.
     - 옮김: `chartRange.ts`, `stockForm.ts`
     - 새로 둠: `stockView.ts`, `sparkHistory.ts`, `cardSignals`, `ChartTab` 두 값, `tabs.ts`, `pageChunks.ts`
   - `docs/design/mockups/README.md` 의 새 줄은 칸이 여섯이다. 표 머리는 다섯이라 표가 깨진다.

## 항목별

| 항목 | 판정 | 증거 |
| --- | --- | --- |
| npm ci · tsc -b · build | 통과 | `ci 0` · `tsc 0` · `✓ built in 568ms` |
| lint | 통과 | 경고 21(기준 22), `lint.log` |
| vitest | 통과 | `Test Files 67 passed (67)` · `Tests 1084 passed (1084)` (기준 1076) |
| 테스트 대신됨 | **실패** | 조건 1. HistoryChart 9개 중 화면 고유 3(칩·늦게 불러옴·0개)은 화면이 없어져 해당 없음. 목록 실패 2는 해당 없음. **B2·BCD 4개는 대신 없음**. StockManager 줄 버튼 3개(삭제·취소·새로고침)는 HoldingTab.test.tsx 로 옮겨졌다(맞음) |
| 기능 불변 — backend · api · types · AppState | 통과 | `git diff --stat 895eec3 bb04e7d -- backend frontend/src/api frontend/src/types.ts frontend/src/AppState.tsx` 비어 있음(79b8850 부터는 types.ts 주석 2줄, 묶음 2) |
| 기능 불변 — lib | 이유 필요(되돌림 아님) | chartRange(ChartModal 에서 옮김, 같은 코드) · stockForm(옮김) · stockView(줄/카드 기억 = 주인 답 1) · sparkHistory(카드 스파크라인, 기존 `getHistory 6mo` 를 15종목에 셋씩 — 서버 history 는 읽기 전용이지만 종목마다 신호 표시를 계산한다) · `cardSignals`(`signalsOf` 와 같은 규칙, 테스트 StockDetailPage.test.tsx:122) |
| 새 상태 · 이동 경로 ↔ 주인 답 | 통과 | 줄/카드(localStorage `dashboard.stock-view`, 새로고침 뒤 카드 15장 유지) = 답 1. `/stocks/:ticker` 위 탭 넷 = 답 2. 거르기 칩 · 찾기=시트 · 순서는 목업 11 공통 칸(고른 두 안에 다 있음). 옛 `/history` · `/chart?ticker=` → 종목 안(`/chart?ticker=AAPL` → `/stocks/AAPL` 확인). 줄의 시세 갱신·비활성화·삭제 → 보유 탭(사라진 기능 없음, 비활성 종목도 줄 → 보유 탭에서 활성화) |
| ETF 재무 탭 | 통과(바뀐 동작, 이유 있음) | 예전에는 탭을 숨겼다. 지금은 탭을 늘 두고 이유 한 줄을 보인다. ChartModal.test.tsx:385 "탭 넷은 종목마다 같은 자리" |
| 글자 자르기 | 통과 | 새 CSS 에 ellipsis·`overflow:hidden` 없음(diff grep). audit clipped 0 · page-overflow 0 |
| 44px | 통과 | audit touch 0. 위 탭 4개 높이 44 · 기간 칩 44 · ⋯ 44 · 시트 ✕ 44 |
| 두 테마 대비(상승 빨강 포함) | 통과 | audit contrast 0 · color-unread 0 (ph390-dark/light-risered 포함). `shots/stocks-360-light-red.png`, `detail-360-light-red.png` |
| 색표 밖 색 | 통과 | 1장 명령 결과는 예외 넷(index.html 2 · manifest 2)뿐. diff 의 `+` 줄에 `#hex`·`rgb(` 0. 목업 11 의 `#6b7280`·`#fff`·`rgba` 는 목업 틀(회색 바탕·캡션)이라 앱이 아니다 |
| 조건 칸 수(xcond) | 통과 | audit 의 xcond 4 화면 cond-missing 0. audit 는 종목 안에 xcond 를 걸지 않아 직접 쟀다(`p2.mjs` 4절, 360): 차트 탭과 신호 탭 모두 "매수 조건 3/5 … ✓ 변동성 축소(20일) 길게 쓴 조건" 이 나오고, `scrollWidth 360 = innerWidth` 다 |
| 회귀 — 홈·시그널 목록 차트 팝업 | 통과(조건 2 빼고) | dialog "VOO 차트" 에 탭 넷이 있고 aria-selected 가 맞다. 뒤로가기로 닫힌다(390·1400). audit modal-chart / modal-chart-fund / modal-chart-ai 열지 못함 0 |
| 회귀 — 뒤로가기로 시트 닫힘 | 통과 | `sheet after back 0`, 주소 `/stocks` 그대로 |
| 접근성 트리 | 통과(참고 1) | `tablist "TIGER … 보기"` > tab 4, `aria-selected` true 하나. 신호 탭 이름 "신호 (신호 있음)". 시트 `dialog "삼성생명 추가"` aria-modal. 손님이 `/stocks/AAPL` 을 열면 로그인 안내 |
| 키보드 | **실패** | 조건 2·3 |
| 목업과 같음 | **실패(이유 없음)** | 조건 5 |
| 문구 변경 표 | **실패** | 조건 5 |

## 자동 검사 (전체, 397조합 — 묶음 2 끝 347 + 새 화면)

| 검사 | 기준(묶음 2 끝) | 이번 | 판단 |
| --- | --- | --- | --- |
| 열지 못한 것 | 0 | 0 | 통과 |
| page-overflow · clipped · folded3 · touch · contrast · console · cond-missing · nowrap-split · sticky-left · quiet-target · color-unread · tnum-width · text-overlap · focus-ring | 0 | 0 | 통과 |
| fake-button | 9 | **0** | 좋아짐 |
| orphan | 61 | 62 | +1 은 menu-diagnostics. 검토자 데이터 폴더 경로가 길어서 생긴 것(아래)이고, 다른 화면은 실행자 실행(audit3full)과 화면별로 같다 |
| num-split | 14 | 22 | +8 은 모두 menu-diagnostics 에서 나왔다. 서버 상태 팝업이 검토자의 `--data-dir`(`/tmp/claude-0/…/c9553d42-…` 숫자가 긴 경로)을 보여서 생긴 측정 잡음이다. 그것을 빼면 fundamentals 10 · macro 3 · guest-macro 1 = 14 로 기준과 같다 |
| folded2-360 | 45 | **49** | 조건 4 |
| 새 화면(stock-detail ×4 탭 · stocks-card · stocks-sheet) | — | 모든 검사 0 | 통과 |

## 계획 검토 걱정 (plan-*.md)

- 이번 묶음에 걸리는 "반영" 항목을 확인했다.
  - 색은 hex · 토큰에서만: 통과
  - 비중 배지와 링크 가르기: 통과. 비중 배지는 ◆ + 옅은 바탕, AI 한 줄·⋯ 는 단추
  - 터치 · 대비: 통과
  - "목업과 같음은 차이마다 이유"(R10, 합격 6): 조건 5
  - "고친 깨짐마다 검사"(합격 8): 조건 4
- "막음" 으로 남은 것은 없다.

## 참고 (막지 않음)

1. 위 탭에 `aria-controls`/`role=tabpanel` 과 ←→ 키 이동이 없다. ArrowRight 를 눌러도 포커스가 "차트" 에 그대로 있다. 예전 차트 팝업도 같았으니 회귀는 아니다.
2. 카드 보기의 스파크라인(석 달)과 그 아래 등락 %(하루)의 색이 다를 수 있다. 예: QQQ 는 선이 빨강이고 −2.02%, SCHD 는 선이 빨강인데 +3.93% 다. 목업은 둘이 맞았다. 사용자 확인에서 헷갈리는지 보면 좋다.
3. 신호 탭 끝의 "시그널은 참고용이며 투자 권유가 아닙니다." 가 바로 아래 바닥글과 겹쳐 두 번 보인다.
4. 접힌 시그널 카드의 토글 이름은 이제 이유 줄뿐이다(예: "이격도 +1.8% · 비중 1.0% · 목표 18%"). 배지가 토글 밖으로 나갔기 때문이다. 바로 앞에서 배지를 읽어 주니 쓸 수는 있다.
5. PC 1400 에서는 기간 칩 넷이 각 270px 로 늘어난다(`shots/pc-detail.png`). 라이트 머리의 신호 배지는 바탕이 거의 안 보인다.
6. audit 의 xcond 를 종목 안(차트·신호 탭)에도 걸어 두면 다음 묶음부터 사람이 따로 재지 않아도 된다.
7. 카드 보기를 처음 열면 `/api/history/<t>?range=6mo` 를 활성 종목 수만큼 부른다(셋씩). 종목이 많은 사용자의 서버 부담은 ③ 보고에 한 줄 적을 만하다.

## 검토자 작업 트리

```
$ git status   (scratchpad/r3/wt)
HEAD detached at bb04e7d
Untracked files:
  docs/design/4차-제로베이스/3-review.md
```

이 판정문 말고는 깨끗하다. frontend/node_modules·dist 는 git 이 무시한다.
저장소 파일은 고치지 않았고 커밋하지 않았다. 뮤테이션 검사는 하지 않았다(테스트 빠짐은 grep 과 지워진 테스트 대조로 판단).
기준선 비교용 worktree(895eec3)는 `git worktree remove` 로 지웠다. 가짜 서버 둘(bb04e7d · 895eec3, 둘 다 8181)은 PID 로 껐다.
