# 디자인 4차 묶음 3 (종목) 두 번째 재검토 판정 — 9fb6b75 (보완 범위 8f57144..9fb6b75, 지난 판정 3-review-2.md)

# 조건부 합격

지난 판정의 조건 셋은 화면에서 모두 풀렸다. 폰 390 · PC 1400 의 실제 앱 라우트와 네트워크로 쟀다.

- 조건 1 · 2 는 뮤테이션 검사에서도 테스트가 지킨다.
- 조건 3 은 테스트가 지키지 못한다. 고친 줄을 되돌려도 새 테스트가 통과한다. 남은 조건은 이것 하나다.

그 밖의 결과:

- 기능 불변 경로(backend · api · types · AppState)의 diff 는 비어 있다.
- vitest 1100 통과 · lint 경고 20 · tsc 통과 · build 통과.
- audit 을 지정한 6 화면 × 10 조건 = 60 칸에 돌렸다. 새 문제는 0 이다.

검토자가 한 일:

- 작업 트리는 `/home/user/Dashboard`(브랜치 `claude/design-4-zerobase`, HEAD 9fb6b75)다.
- 프런트는 `npm ci` → `tsc -b` → lint → vitest → `npm run build` 순서로 돌렸다.
- 가짜 서버는 8184 에 띄웠다(`--reset`, 데이터는 저장소 밖 `scratchpad/r3c/data`).
  - 중간에 컨테이너가 다시 떠서 서버가 죽었다. 같은 명령으로 다시 띄우고, build 도 다시 했다.
  - audit 전에는 `--reset` 으로 한 번 더 띄웠다. 탐침 q2 에서 SCHD 를 비활성으로 바꿨기 때문이다.
  - 서버는 모두 PID 로 껐다.
- 뮤테이션 검사를 세 번 했다. 한 번 할 때마다 `git checkout` 으로 바로 되돌렸다.

산출물은 모두 `/tmp/claude-0/-home-user-Dashboard/c9553d42-71a5-5379-90e1-1c42ba786c3a/scratchpad/r3c/` 아래에 있다.

| 무엇 | 경로 |
|---|---|
| 명령 출력 | `ci.log` · `tsc.log` · `lint.log` · `vitest.log` · `build.log` · `audit.log` · `server.log` |
| 팝업 · 시트 Tab | `q1.mjs` · `q1.log` |
| 차트 팝업 AI 칸 Tab | `q1b.mjs` · `q1b.log` |
| 주소별 history 요청 수 | `q2.mjs` · `q2.log` |
| AI + ‹ · 뒤로가기 | `q3.mjs` · `q3.log` |
| 옮긴 줄 표시 · "은(는)" | `q4.mjs` · `q4.log` |
| audit | `audit/summary.md` · `audit/results.json`. 견준 기준은 `../r3b/audit/results.json`(8f57144) |
| 사진 | `shots/` |

## 합격으로 올릴 조건

1. **조건 3(AI 를 연 채로 ‹)을 지키는 테스트가 고친 줄을 잡지 못한다 (6장 "고친 깨짐마다 테스트")**
   - 뮤테이션으로 확인했다.
     - `StockDetailPage.tsx:64` 의 `if (!aiOpen) return back()` 를 `return back()` 으로 바꿨다. 지난 판정 때의 동작, 곧 AI 칸을 빼지 않고 바로 `navigate(-1)` 하는 것과 같다.
     - 그래도 `npx vitest run src/pages/StockDetailPage.test.tsx` 는 `Tests 17 passed (17)` 이다.
     - `StockDetailPage.test.tsx:179` "AI 를 연 채로 ‹ 를 누르면 한 번에 종목 목록으로" 가 떨어지지 않는다.
   - 까닭:
     - 테스트는 `MemoryRouter` 로 그린다. 그래서 `window.history.state?.idx` 가 비어 있다.
     - 그러면 `back()`(`StockDetailPage.tsx:61`)은 AI 와 상관없이 늘 `navigate('/stocks')` 를 탄다.
     - 결국 테스트는 "바로 연 주소에서 ‹" 만 보고, 고친 "앱 안에서 와서 AI 칸이 쌓인 채 ‹" 는 지나가지 않는다.
   - 고칠 길(하나만 고른다):
     - `window.history` 를 쓰는 라우터(`createBrowserRouter`/`BrowserRouter`)로 `/stocks` → `/stocks/VOO` 를 앱 안에서 이동한다. 그 뒤 AI → ‹ 한 번에 `/stocks` 이고, 브라우저 기록이 한 칸만 남는지를 본다.
     - 위 뮤테이션으로 떨어지는지 확인한다.
   - 화면 동작은 맞다(아래 "조건 3 상세"). 테스트 하나만 고치면 된다.

## 지난 조건별

| # | 지난 조건 | 판정 | 증거 |
| --- | --- | --- | --- |
| 1 | 겹친 팝업에서 Tab 이 뒤 화면으로 샘 | **통과** | 아래 "조건 1 상세" |
| 2 | 소문자 · 이름 주소에서 시세 두 번 | **통과** | 아래 "조건 2 상세" |
| 3 | AI 를 연 채로 ‹ 가 AI 만 닫음 | **화면은 통과 · 테스트 실패(위 조건 1)** | 아래 "조건 3 상세" |

### 조건 1 상세

`q1.log` 를 봤다. 390 · 1400 결과가 같다. 표시는 이렇게 읽는다.

- `TOP` 은 맨 위 dialog 안이다.
- `UNDER` 는 그 밑 dialog 안이다.
- `OUT` 은 뒤 화면이다.

| 경우 | 결과 |
|---|---|
| A. 차트 팝업 → 보유 → 고치기 (`["VOO 차트","VOO 수정"]`) | 처음 포커스는 `TOP:VOO 보유수량` 이다. Tab 14 번은 `TOP 14/14 UNDER 0 OUT 0` 이다(`… 산 환율 \| 취소 \| 닫기 \| 구분 \| 목표 비중 \| 밴드 임계값 \| 보유수량 …` 이 돈다). Shift+Tab 14 번도 `TOP 14/14` 다 |
| B. 차트 팝업 → 보유 → 삭제 (`["VOO 차트","VOO 삭제"]`) | 처음 포커스는 `TOP:취소` 다. Tab 8 번과 Shift+Tab 8 번 모두 `TOP 8/8`(`네, 지웁니다 \| 취소` 가 돈다) |
| 안쪽 팝업을 Esc 로 닫은 뒤 | Tab 10 번이 `TOP 10/10` 이다(`AI 분석 \| 닫기 \| 차트 …`). 차트 팝업 가두기는 그대로 산다. Esc 를 한 번 더 누르면 `[]` 이고 포커스는 연 단추(`VOO`)로 간다 |
| C. 차트 팝업만 | Tab 40 번 · Shift+Tab 40 번 모두 `TOP 40/40` 이다. AI 칸을 연 채로는 `TOP 29/30 OUT 1` 이다 → 참고 1(묶음 3 이전부터 있던 것) |
| D. 뒤로가기 하나씩(회귀) | `["VOO 차트"] -> []`, 주소는 `/?view=signal` 그대로다 |
| E. 추가 시트 | 처음 포커스는 `TOP:new-weight` 다. Tab 16 번 · Shift+Tab 16 번 모두 `TOP 16/16` 이다. Esc 를 누르면 포커스가 찾기 칸(`INPUT`)으로 돌아간다 |

- 콘솔 오류는 0 이다(`390 errs 0` · `1400 errs 0`).
- 코드는 `lib/focusTrap.ts:20-21` 이다. 안쪽 `[role=dialog]`·`[role=alertdialog]` 가 있으면 그 마지막 것을 기준(root)으로 가둔다. 그래서 C 에서 차트 팝업만 떠 있을 때의 동작은 전과 같다.
- 뮤테이션: `:21` 을 `const root = ref.current` 로 바꾸면 `ChartModal.test.tsx:568` "팝업 위 팝업 — Tab 은 맨 안쪽(수정) 팝업 안에서만 …" 이 `1 failed | 58 passed` 다. 되돌려 놓았다.
- 남은 것(막지 않음): 안쪽 팝업을 Esc 로 닫으면 포커스가 차트 팝업이 아니라 뒤 화면 머리(`OUT:₩자산관리…`)에 남는다. 다음 Tab 은 팝업 안으로 들어가니 새지는 않는다. 지난 판정 "고칠 길" 의 "연 단추로 돌린다" 는 아직 하지 않았다 → 참고 2.

### 조건 2 상세

`q2.log`, 폰 390 이다. 주소마다 새로 불러 열고(`goto`), 요청을 셌다.

| 주소 | 간 곳 | `GET /api/history` | API 전체 | 오류 |
|---|---|---|---|---|
| `/stocks/VOO` | `/stocks/VOO` | 1 | 6 | 0 |
| `/stocks/voo` | `/stocks/VOO` | **1** (지난 2) | 8 (지난 10) | 0 |
| `/stocks/005930.ks` | `/stocks/005930.KS` | **1** | 8 | 0 |
| `/stocks/삼성전자` | `/stocks/005930.KS` | **1** | 8 | 0 |
| `/history?ticker=voo` | `/stocks/VOO` | **1** | 8 | 0 |
| `/history?ticker=삼성전자` | `/stocks/005930.KS` | **1** | 8 | 0 |
| `/history?ticker=VOO` · `/chart?ticker=AAPL` | `/stocks/VOO` · `/stocks/AAPL` | 1 · 1 | 6 · 6 | 0 |
| `/stocks/voo?tab=fundamentals` | `/stocks/VOO?tab=fundamentals` | 1 | 8 | 0 |
| `/stocks/NOPE` | 그대로, h3 "‘NOPE’은(는) 담은 종목에 없습니다" | 0 | 3 | 0 |
| 비활성 `/stocks/SCHD` · `/stocks/schd` · `/history?ticker=schd` | `/stocks/SCHD` | 1 · **1** · **1** | 6 · 8 · 8 | 0 |
| 앱 안(목록 줄을 누름) | `/stocks/VOO` | 1 | — | — |

- 비활성 종목은 검토자 데이터에서 만들었다(`DELETE /api/stocks/SCHD` → 200, `inactive ["SCHD"]`).
- `/stocks/voo` 뒤에서 뒤로가기를 누르면 `/stocks` 다. 옛 주소가 기록에 남지 않는다.
- 남은 2 번의 차이(6 → 8)는 `dashboard` · `stocks` 를 한 번 더 부르는 것이다(`q2.log` "detail /stocks/voo" 목록). 주소를 바꾸면 화면이 새로 만들어지기 때문이다. 시세 · 재무는 한 번이다 → 참고 3.
- 코드는 `StockDetailPage.tsx:75` 다. `match.ticker !== ticker` 인 동안은 "불러오는 중…" 만 그린다.
- 뮤테이션: 이 조건을 빼고 `if (!listed) return` 으로 바꾸면 `StockDetailPage.test.tsx:255` "소문자·이름 주소는 … 시세도 그 티커로 한 번만 …" 이 `1 failed | 16 passed` 다. 테스트는 `Keyed`(`:57`, 앱의 `PageBoundary key={pathname}` 를 흉내 냄)를 거친다. 되돌려 놓았다.

### 조건 3 상세

`q3.log` 를 봤다. 390 · 1400 결과가 같다.

| 경우 | 결과 |
|---|---|
| 1. 목록 → VOO → AI → ‹ 한 번 | `/stocks`(idx 0). AI 칸과 상세 칸이 둘 다 빠지고 목록으로 간다 |
| 2. 목록 → VOO(AI 안 엶) → ‹ | `/stocks`(idx 0). 전과 같다 |
| 3. 목록 → VOO → AI → 브라우저 뒤로 | `/stocks/VOO`, AI 0, 탭은 "차트". 한 번 더 누르면 `/stocks`. 전과 같다 |
| 4. AI 를 열었다가 차트 탭으로 바꾼 뒤 ‹ | `/stocks` 한 번 |
| 5. 바로 연 `/stocks/VOO` → AI → ‹ | `/stocks`(idx 1). 이어서 브라우저 뒤로를 누르면 `/stocks/VOO`, AI 0 · "차트" |
| 6. 바로 연 주소, AI 안 엶 → ‹ | `/stocks` |
| 7. 바로 연 주소 → AI → 브라우저 뒤로 | `/stocks/VOO`, AI 0 · "차트". AI 만 닫힌다 |
| 8. `/stocks/voo`(바뀌는 주소) → AI → ‹ | `/stocks` |
| 9. `/stocks/VOO?tab=ai` 로 바로 열고 ‹ | `/stocks`(AI 가 처음부터 열려도 칸을 쌓으니 맞게 빠진다) |
| 10. AI 를 연 채 ‹ 두 번 누름 | `/stocks`. 더 나가지 않는다 |

- 콘솔 오류 1 은 `about:blank` 에서 난 `localStorage SecurityError` 다. 1 번 뒤에 브라우저 뒤로를 눌러 탐침 시작 전 빈 쪽으로 나갔기 때문이다. 앱 오류가 아니다.
- 화면 동작은 지난 판정의 요구와 맞는다. 다만 테스트가 지키지 못한다(위 조건 1).

## 항목별 (3-1 · 6장)

| 항목 | 판정 | 증거 |
| --- | --- | --- |
| npm ci · tsc -b · build | 통과 | `ci 0` · `tsc 0` · `✓ built in 414ms`. 서버를 다시 띄운 뒤 다시 build 해서 `✓ built in 1.15s` |
| lint | 통과 | 경고 20 (`grep -c` warning, `lint.log`). 기준 22 · 실행자 20 과 같다 |
| vitest | 통과 | `Test Files 67 passed (67)` · `Tests 1100 passed (1100)`. 지난 1098 에 새 테스트 2 가 더해졌다 |
| 백엔드 테스트 | 해당 없음 | backend diff 가 비어 있다 |
| 기능 불변 — backend · api · types · AppState | 통과 | `git diff --stat 8f57144 9fb6b75 -- backend frontend/src/api frontend/src/types.ts frontend/src/AppState.tsx` 와 `895eec3 9fb6b75` 둘 다 비어 있다 |
| 기능 불변 — lib | 통과(이유 적힘) | `focusTrap.ts` 하나뿐이다(+9 −7). 3-보완.md lib 표 · "재검토 조건 3" 표 |
| 그 밖의 `.tsx` | 통과 | `StockDetail.tsx` 의 `lead` 가 함수도 받는다(AI 를 열었는지 넘김). 팝업(ChartModal)은 lead 를 쓰지 않는다. `StockDetailPage.tsx` 는 `leave` · 그리지 않는 동안 · 조사뿐이다. 새 API 호출은 없다 |
| 글자 자르기 · 색표 밖 색 | 통과 | 범위 diff 의 `+` 줄에 `#hex` · `rgb(` · ellipsis · `overflow: hidden` 이 0 이다. 새 CSS 는 `var(--accent-soft)` → `transparent` 다 |
| 움직임 | 통과 | 아래 "움직임 상세" |
| 키보드 | 통과(참고 1 · 2) | 위 조건 1 상세 |
| 회귀(audit, 지정 화면) | 통과 | 아래 |
| 문구 변경 | 통과 | "‘X’ 은" 이 "‘X’은(는)" 으로 바뀌었다. 화면에서 `‘NOPE’은(는) 담은 종목에 없습니다` 를 확인했다. 테스트도 같이 고쳤다(`StockDetailPage.test.tsx` NOPE). 문구 변경 표에 들어가는 줄로 보면 3-보완.md "재검토 조건 3" 참고 행에 적혀 있다 |
| 고친 깨짐마다 테스트 | **실패(조건 1)** | 뮤테이션 셋 가운데 focusTrap · 그리지 않는 동안은 떨어지고, `leave` 는 떨어지지 않는다 |
| 계획 검토 걱정(plan-*.md) | 통과 | 이번 범위에 새로 걸리는 항목이 없다 |

### 움직임 상세

`q4.log` 를 봤다. 순서 바꾸기에서 ▲ 를 누른 뒤의 `.just-moved` 를 쟀다.

| 움직임 줄이기 | 0.1초 | 1.9초 |
|---|---|---|
| 끔 | `rgba(146,177,219,0.125)`, `anim=stock-moved` | `rgba(0,0,0,0)`. 지난 참고 5 가 풀렸다 |
| 켬(reduce) | `animation:none`, 배경 투명 | 같음 |

- 움직임 줄이기를 켜면 옮긴 줄 표시가 아예 없다. 3-보완.md 에 그렇게 적혀 있고, "✓ 순서를 저장했습니다" 문구는 남는다 → 참고 4.

## 자동 검사 (dash-signal · modal-chart · stock-detail · stocks · stocks-card · stocks-sheet, 6 화면 × 10 조건 = 60 칸)

`node docs/design/audit.mjs --base http://127.0.0.1:8184 --only dash-signal,modal-chart,stock-detail,stocks-card,stocks-sheet,stocks` 를 돌렸다. `--only` 에 넣은 이름은 audit.mjs 의 화면 이름 가운데 `stocks*` · `stock-detail*` · `modal-chart*` · `dash-signal` 에 맞는 전부다. 결과는 8f57144(`r3b/audit/results.json`)의 같은 60 칸과 견줬다.

| 검사 | 8f57144 | 9fb6b75 | 판단 |
|---|---|---|---|
| 열지 못한 것 | 0 | 0 | 통과 |
| page-overflow · clipped · num-split · folded3 · touch · contrast · console · cond-missing · nowrap-split · sticky-left · fake-button · quiet-target · color-unread · tnum-width · text-overlap · focus-ring | 0 | 0 | 통과 |
| orphan (dash-signal) | 10 | 8 | 줄었다 |
| folded2-360 (dash-signal) | 12 | 10 | 줄었다 |
| modal-chart · stock-detail · stocks · stocks-card · stocks-sheet | 모두 0 | 모두 0 | 통과 |

- 다른 칸은 7 이고 모두 dash-signal 의 신호 줄 글자다.
  - 예: `이격도 +1.1%` → `+0.5%`, `시그널 11종목` → `9종목`.
  - 가짜 서버의 시세가 날짜를 따라 만들어지는데, 지난 검토(11-06) 와 오늘 날짜가 다르다. 이번 diff 는 dash-signal 화면 코드를 건드리지 않는다.
- 새 문제는 0 이다.

## 참고 (막지 않음)

1. **차트 팝업에서 AI 칸을 연 채로 Tab 이 한 번 샌다.**
   - `q1b.log`: `… 표 없이 짧게 | SUMMARY:AI 에게 보내는 내용 보기 | OUT:A:개인정보처리방침 · 이용약관 | TOP:AI 분석 …`.
   - 까닭: `focusTrap.ts` 의 고를 것 목록에 `summary` 가 없다. 그래서 `AiPanel.tsx:394` 의 `<summary>` 가 마지막 칸으로 잡히지 않는다.
   - 차수 시작 79b8850 의 `ChartModal.tsx` 가두기 고를 것과 AiPanel `<summary>` 가 이미 같았다. 이번 범위의 회귀가 아니다.
   - 고칠 길: 고를 것에 `summary` 를 더한다(한 줄).
2. **안쪽 팝업을 닫은 뒤 포커스가 뒤 화면 머리에 남는다.**
   - 수정 · 삭제 확인을 Esc 로 닫으면 포커스가 연 단추(보유 고치기 · 삭제)로 돌아가지 않는다.
   - 다음 Tab 은 팝업 안으로 들어가서 새지는 않는다.
   - 화면 읽기 기기에서는 aria-modal 바깥에 포커스가 있게 된다.
3. 소문자 · 이름 주소를 열면 `dashboard` · `stocks` 를 한 번 더 부른다(API 8 번 대 6 번). 시세 · 재무는 한 번이다.
4. 움직임 줄이기를 켜면 옮긴 줄 표시가 아예 없다. 저장 문구는 남는다. 필요하면 움직임 없이 잠깐 칠해 두는 방법도 있다.
5. **팝업이 아닌 종목 안 화면에서는 수정 팝업의 Tab 이 뒤로 샌다.**
   - `/stocks/VOO?tab=holding` → 고치기(`["VOO 수정"]`)에서 Tab 14 번이 `TOP 3/14 OUT 11` 이다(`… 취소 | OUT:개인정보처리방침 · 이용약관 | OUT:홈 …`).
   - 까닭: `StockEditModal` · `ConfirmDialog` 에는 가두기가 따로 없다. 차트 팝업 안에서만 바깥 가두기가 대신한다.
   - 이번 diff 는 이 경로를 건드리지 않아서 회귀는 아니다. 그래도 조건 1 과 같은 종류다.
   - 두 팝업이 스스로 `useFocusTrap` 을 쓰면 참고 1 · 2 · 5 가 한 번에 풀린다. 다음 묶음이나 ② 보고의 "남은 문제" 에 올릴 만하다.
6. 지난 판정의 참고 1 · 2 · 3 · 4 · 7 은 그대로다. 이번 범위가 아니다. 참고 5(표시가 남음)와 참고 6(조사)은 풀렸다.

## 검토자 작업 트리

```
$ git status   (/home/user/Dashboard, HEAD 9fb6b75 — 판정문 쓰기 직전)
On branch claude/design-4-zerobase
Your branch is up to date with 'origin/claude/design-4-zerobase'.

nothing to commit, working tree clean
```

- 판정문을 쓴 뒤에는 이 파일(`docs/design/4차-제로베이스/3-review-3.md`) 하나만 추적되지 않은 파일로 남는다. 커밋하지 않았다.
- 저장소 파일은 고치지 않았다. `frontend/node_modules` · `dist` 는 git 이 무시한다.
- 뮤테이션 셋(`focusTrap.ts:21` · `StockDetailPage.tsx:75` · `StockDetailPage.tsx:64`)은 하나마다 `git checkout` 으로 되돌렸다. 되돌린 뒤 `git status --short` 가 빈 것을 확인했다.
- 가짜 서버(8184)는 세 번 띄웠고 모두 PID 로 껐다. 껐는지는 `curl` 이 `000` 을 내는 것으로 확인했다.
