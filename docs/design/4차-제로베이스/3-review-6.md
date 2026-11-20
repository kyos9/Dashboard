# 디자인 4차 묶음 3 (종목) ② 주인 답 반영 검토 — 6fa6d4a (범위 19ba5f0..6fa6d4a, 지난 판정 3-review-5.md 합격)

# 조건부 합격

이번 범위는 ② 주인 답 네 가지다. 그중 셋은 답대로 들어갔다.

- 비중 "현재"로 바뀌었다.
- 합계 배지가 ⋯ 안 "한 번에 수정" 옆으로 갔다.
- 폰 홈 차트 길은 그대로다.
- 회귀 · 자동 검사 · 기능 불변도 깨끗하다.

**끌기는 반만 된다.**

- 위로 끌기는 폰 390 · 360(진짜 터치) · PC 1400(마우스) · 확대 150% 모두 된다.
  - 미리 벌어진다.
  - 놓으면 PUT 한 번에 "저장했습니다"가 뜬다.
  - 새로고침해도 남는다.
- **아래로 끌 때 손가락이나 마우스를 손잡이(44×44) 밖에서 떼면 끌기가 끝나지 않는다.**
  - 화면에는 새 순서가 보인다.
  - 하지만 저장되지 않고 "저장했습니다"도 없다.
  - "순서 바꾸기 끝"을 누르면 아무 말 없이 원래 순서로 돌아간다.
- 손잡이 밖에서 떼는 경우는 흔하다.
  - 손가락이 옆으로 25px만 흘러도 그렇다.
  - 줄(64px)의 위·아래 10px 띠에서 떼도 그렇다.
- 거르기 상태에서 끌어 놓는 길(가려진 종목 제자리)은 화면에서는 맞다. 하지만 이것을 지키는 테스트가 없다. 뮤테이션이 살아남았다.

## 조건(고친 뒤 다시 잰다)

| # | 무엇 | 심각도 | 근거 |
|---|---|---|---|
| 1 | **아래로 끌면 포인터 잡기(capture)를 잃는다.** 손잡이 밖에서 떼면 `end()` 가 돌지 않는다. 끄는 상태가 남고, 저장도 말도 없다 | 막음 | `stuck.log`, `drag2.log` "아래로 1→3 놓는 곳 name", `shots/stuck-390.png` |
| 2 | 거르기가 걸린 채 끌어 놓는 길(`StockManager.tsx:327-332` `drop`)을 지키는 테스트가 없다 | 고쳐야 함 | `mut2.log` — `drop` 을 `saveOrder(shown, …)` 로 바꿔 보이는 종목만 보내게 해도 `Tests 55 passed (55)` |

조건 1 — 실제 브라우저에서 잰 것(`stuck.log`). 경우마다 처음은 `AAPL,SCHD,QQQ` 이고, 첫 줄을 둘째 줄 아래로 끌었다.

| 경우 | 화면 | 서버 | PUT | 끄는 상태 남음 | "저장했습니다" | 이벤트 |
|---|---|---|---|---|---|---|
| 390 터치 · 손잡이 줄 그대로, 목표 줄 아래 끝 4px 에서 뗌 | SCHD,AAPL,QQQ | AAPL,SCHD,QQQ | 0 | 1 | 없음 | `lostpointercapture@grip pointerup@stock-row` |
| 390 터치 · 옆으로 60px 흐름 | SCHD,AAPL,QQQ | AAPL,SCHD,QQQ | 0 | 1 | 없음 | `lostpointercapture@grip pointerup@nowrap` |
| 390 터치 · 옆으로 25px 흐름 | SCHD,AAPL,QQQ | AAPL,SCHD,QQQ | 0 | 1 | 없음 | 같음 |
| 1400 마우스 · 옆으로 80px | SCHD,AAPL,QQQ | AAPL,SCHD,QQQ | 0 | 1 | 없음 | `lostpointercapture@grip pointerup@nowrap` |
| (대조) 390 터치 · 손잡이 안에서 뗌 | SCHD,AAPL,QQQ | SCHD,AAPL,QQQ | 1 | 0 | 있음 | `lostpointercapture@grip pointerup@grip` |

- 60px 흐름 뒤 "순서 바꾸기 끝"을 누르면 목록이 `AAPL,SCHD,QQQ` 다. 사용자가 본 새 순서가 말 없이 사라진다.
- 네 조건(390 · 360 · 1400 · 150%) 모두 같다(`drag2.log`).
  - "아래로 1→3 놓는 곳 name"은 모두 `미리 벌림 false · PUT 0 · 끄는 중 남음 1` 이다.
  - 위로는 이름 위에서 떼도 모두 된다.
- 까닭(코드 읽기)은 이렇다.
  1. `DragOrderList.tsx:37` 이 손잡이에 `setPointerCapture` 를 건다.
  2. 아래로 끌면 미리 보기가 순서를 바꾼다. React 는 이때 **끄는 줄의 `<li>` 자체를 DOM 에서 옮긴다**(앞 줄들의 원래 자리가 더 뒤라서).
  3. 그 순간 Chrome 이 잡기를 푼다(`lostpointercapture`).
  4. 그 뒤의 `pointermove`/`pointerup` 은 손가락 아래 요소로 간다. 처리기는 손잡이에만 있다(`:87-90`). 그래서 손잡이 밖에서는 미리 보기가 멈추고, 떼어도 `end()` 가 돌지 않는다.
  5. 위로 끌 때는 다른 줄들이 옮겨지고 끄는 줄은 그대로라서 잡기가 남는다.
- 테스트가 이것을 놓친 까닭은 이렇다. `StockManager.test.tsx` 끌기 테스트는 `pointerUp` 을 손잡이에 바로 쏜다. jsdom 에는 잡기가 없다.
- 고칠 길(제안, 정하는 것은 실행자)은 셋이다.
  - 끄는 동안의 move/up/cancel 을 `window`(또는 document)에서 듣는다.
  - 또는 `onLostPointerCapture` 를 끝으로 다룬다.
  - 또는 끄는 줄을 DOM 에서 옮기지 않는 그리기(transform)로 바꾼다.
  - 어느 길이든 테스트는 **손잡이가 아닌 곳에서 놓기**를 넣어야 한다. 아래로 끌어 줄 이름 위나 window 에 `pointerup` 을 쏘는 식이다.

조건 2:

- 화면에서는 맞다.
  - `drag3.log` "거르기 신호 보이는 9 / 15": 가려진 종목 자리가 그대로이고, 서버의 보이는 순서가 기대와 같고, PUT 은 1 이다.
- 하지만 `drop` 이 가려진 종목을 빼고 보이는 것만 보내게 바꿔도 테스트가 다 통과한다.
  - 이렇게 되면 6 종목이 빠진 순서를 저장하러 가는 길이다.
- 3-보완.md 의 "거르기가 걸려 있으면 보이는 종목 자리만"을 지키는 테스트가 하나 있어야 한다. 키보드 `step` 쪽은 옛 ▲▼ 와 같은 `moveOne` 이고 lib 테스트가 있다.

## 참고(조건 아님)

- **참고 1**: 카드 보기 폰 360 에서 페이지가 7px 가로로 넘친다. audit `stocks-card ph360-dark/light page-overflow 1`(px 7).
  - 원인은 `東京海上ホールディングス`(8766.T) 카드 제목이다. 띄어쓰기 없는 일본어가 `keep-all` 이라 칸(136px)보다 넓다(scrollWidth 170).
  - 이번 커밋이 만든 것은 아니다. 제 검토 중 끌기로 순서를 바꿔 이 카드가 오른쪽 칸으로 갔고, 그래서 화면 밖으로 나왔다. 데모 처음 순서(왼쪽 칸)에서는 앞 audit(r3 · r3b · r3c)이 0 이었다.
  - 순서 바꾸기가 쉬워져 닿기 쉬워졌으니, 카드 제목에 `overflow-wrap:anywhere` 같은 것을 묶음 4 전에 보면 좋다.
- **참고 2**: 손잡이의 포커스 테두리는 브라우저 기본(`outline auto`)이다.
  - 보이기는 한다(`shots/focus-*.png`).
  - 앱의 다른 단추는 `button:focus-visible` 2px 강조색인데, 손잡이는 `<span role=button>` 이라 그 규칙에서 빠진다. 같게 하려면 `.drag-grip:focus-visible`.
- **참고 3**: 100% 일 때 풀이 줄이 없는 것을 지키는 테스트가 없다.
  - `mut3.log` — `!sumOk &&` → `true &&` 로 바꿔도 `55 passed`.
  - 화면에서는 맞다(아래 2 번).
- 참고 4(③ 에 이미 적힘): 15 종목은 한 화면에 다 들지 않는다. 끄는 동안 저절로 내려가지 않으므로 "맨 끝 → 맨 위"는 한 번에 못 한다(`drag2.log` 마지막 칸은 시작 손잡이가 화면 밖). 3-보완.md "남김(③)"과 같다.

## 볼 것별 판정

| # | 볼 것 | 판정 | 증거 |
|---|---|---|---|
| 1a | 위로 끌기(4→1), 390 · 360 터치 · 1400 · 150% 마우스 | 통과 | `drag2.log`: 넷 다 `미리 벌림 true · 놓기 전 PUT 0 · 화면=기대 · 서버=기대 · PUT 1 · 말 O`. 이름 위에서 떼도 같다 |
| 1b | 아래로 끌기(1→3) | **실패(조건 1)** | 손잡이 안에서 떼면 넷 다 통과. 이름 위에서 떼면 넷 다 `PUT 0 · 끄는 중 남음 1` |
| 1c | 맨 끝으로(13→15) | 통과(손잡이 안에서 뗄 때) · 조건 1 의 영향 받음 | `drag2.log` "맨 끝으로 grip" 넷 다 PUT 1 · 말 O |
| 1d | 놓기 전 미리 벌림 · 놓기 전 저장 없음 | 통과(위로) | 끄는 중 순서 = 기대, `놓기 전 PUT 0` |
| 1e | 놓으면 PUT 한 번 · "저장했습니다" | 통과 | PUT 1 · `✓ 순서를 저장했습니다 — 홈 표와 시그널 목록도 이 순서입니다.` |
| 1f | 새로고침 뒤 남음 | 통과 | `drag2.log` 넷 다 `새로고침 뒤 화면=서버 true` |
| 1g | 끄는 동안 화면이 밀리지 않음 | 통과 | 손잡이에서 시작한 끌기는 scrollY 가 끝까지 같다(예: `159 → 159`, `815 → 815`). 이름 위에서 손가락을 올리면 화면은 내려가고 순서는 그대로(`scroll.mjs`: `0 → 432 · 순서 그대로 · PUT 0`) |
| 1h | 거르기 걸린 채 — 가려진 종목 자리 그대로 | 화면 통과 · 테스트 없음(조건 2) | `drag3.log` "신호 9/15 · 가려진 종목 자리 그대로 true · 서버의 보이는 순서 true · PUT 1" |
| 1i | 저장 실패 시 되돌림 | 통과 | PUT 을 500 으로 막음: `끄는 중 바뀜 true · 되돌림 true · 서버 그대로 true · 저장 말 0`. 오류 글 "⚠ boom 닫기"가 화면 위(top 168)에 뜬다. 콘솔 오류는 그 500 하나뿐 |
| 1j | 손잡이 44px | 통과 | 일곱 조건 모두 `44x44`, 줄 64(`ordm.log`) |
| 1k | 키보드 | 통과 | `drag3kb.log`: 맨 위에서 ↑ 는 PUT 0, 맨 아래에서 ↓ 는 PUT 0. 둘째에서 ↑ 는 PUT 1 → `SCHD,AAPL,QQQ`, 포커스는 `SCHD 순서 — …`. 이어서 ↓ 는 PUT 2 → `AAPL,SCHD,QQQ`, 포커스는 그대로 SCHD 손잡이 |
| 1k | Tab 순서 | 통과 | `… 재무 한눈에 \| 전체 15 \| 신호 9 \| 보유 15 \| AAPL 순서 … \| SCHD 순서 …` |
| 1l | 읽어 주는 이름 | 통과 | `role=button`, `aria-label="AAPL 순서 — 끌거나 위·아래 화살표"`, tabIndex 0. 켜는 칩은 `순서 바꾸기` / `순서 바꾸기 끝` |
| 2a | 비중 "현재" | 통과 | 390 · 360 · 1400 신호 탭은 `"현재 1.0% · 목표 18.0% (허용 ±5.0%p)"`(한 줄, h22). 보유 탭은 `dt "비중 현재 / 목표"`. "지금" 남음 0(`word.mjs`). 문구변경.md 83-84 행과 맞다 |
| 2b | 합계 배지 자리 | 통과 | 부모 `aria-label="보기·설정"`, 바로 앞 형제 "재무 한눈에"(한 번에 수정 · 재무 한눈에 다음). 거르기 줄에서는 빠졌다 |
| 2c | 100% 면 풀이 없음 · 초록 | 통과 | 응답을 바꿔 100.0%: `badge-green`, 풀이 null(390 · 360 · 1400 × 두 테마). 90.0% 면 `badge-amber` 와 풀이 한 줄(폰 37px 두 줄, PC 19px 한 줄) |
| 2d | 폰에서 ⋯ 접으면 배지도 숨음 | 통과(주인 답 그대로) | 접힌 때 도구 0 · 배지 0. 펼치면 보인다. 주인 답이 "⋯ 안 '한 번에 수정' 옆으로"라 맞다. PC 는 늘 보인다 |
| 3a | 종목 탭 줄 · 카드 · 추가 시트 · 종목 안 audit | 통과(참고 1 빼고) | 아래 자동 검사 |
| 3b | 홈 시그널 목록 순서 편집 ▲▼ | 통과 | 390 홈 `?view=signal`: "↕ 순서 편집" → `▲ 15 개 · 첫 ▲ disabled 44x44` · 둘째 ▲ 누르면 PUT 1 · `.drag-grip` 0. `Dashboard.tsx` 이 범위 diff 0 |
| 3c | 순서 바꾸기 화면 직접 잼 | 통과 | `ordm.log` 일곱 조건(390 · 360 × 두 테마, 1400 × 두 테마, 150%): 넘침 false · 잘림 0 · 4.5 미만 글 0 · 폰 44 미만 0. 손잡이 그림 대비 6.37(어두움) · 5.98(밝음), 3:1 넘음 |
| 3d | 색표 밖 색 | 통과 | `stocks.css` · `DragOrderList.tsx` · `StockManager.tsx` 에서 `#hex/rgb(/hsl(` grep 0. 새 CSS 는 `var(--text-faint)` · `--panel-soft` · `--shadow-pop` · `--radius-sm` 만 쓴다 |
| 4 | 뮤테이션 | 조건 2 · 참고 3 | 아래 |
| 5 | vitest · lint · tsc · build · 기능 불변 | 통과 | 아래 |

## 자동 검사(audit `--only stocks,stocks-card,stocks-sheet,stock-detail,stock-detail-signal,stock-detail-holding`)

- 60 조합을 쟀고, 열지 못한 것은 0 이다(`audit/summary.md`).
- page-overflow 는 2 이고, 그 밖은 모두 0 이다.
  - 0 인 것: clipped · orphan · num-split · folded3 · folded2-360 · touch · contrast · console · fake-button · focus-ring 등.
- page-overflow 2 는 `stocks-card ph360-dark/light` 7px 이다. 참고 1 과 같고, 데이터 순서 탓이며 이 커밋의 회귀가 아니다.
  - 같은 여섯 화면의 앞 audit(r3c, 60 조합)은 모두 0 이었다.

## 뮤테이션

| 되돌린 줄 | 결과 | 되돌린 뒤 |
|---|---|---|
| `DragOrderList.tsx:62` 놓을 때 `onDrop` 부르기 → `void after` | `Tests 1 failed \| 54 passed (55)`. 끌기 테스트가 떨어진다(`mut1.log`) | `git checkout`, `git diff --stat` 빔 |
| `StockManager.tsx:331` 가려진 종목 끼우기 → `saveOrder(shown, ticker)` | `Tests 55 passed (55)` — **살아남음**(조건 2, `mut2.log`) | `git checkout` |
| `StockManager.tsx:460` `!sumOk &&` → `true &&` | `Tests 55 passed (55)` — 살아남음(참고 3, `mut3.log`) | `git checkout` |

- 문구("현재")는 `StockDetailPage.test`(`/^현재 17\.2% · 목표 18\.0%/`)와 `HoldingTab.test`(`'비중 현재 / 목표'`)가 직접 본다.
- 세 뮤테이션 뒤 `git status --short` 는 비었다.

## 빌드 · 테스트 · 기능 불변

| 무엇 | 결과 |
|---|---|
| `npm ci` | 0 (`ci.log`) |
| `npx tsc -b` | 0 (`tsc.log`) |
| `npm run lint` | 경고 20(기준 22, 실행자 20), 오류 0. 새 파일 · StockManager 경고 없음(`lint.log`) |
| `npx vitest run` | `Test Files 68 passed (68)` · `Tests 1107 passed (1107)`(`vitest.log`). 1105 − 1(▲▼ 테스트) + 3(끌기 · 키보드 · 합계 배지) = 1107. "현재" 단언 둘은 문구변경.md 83-84 행과 1:1 |
| `npm run build` | 0 (`build.log`). 화면은 이 build 뒤에 봤다 |
| `git diff --stat 19ba5f0..6fa6d4a -- backend frontend/src/api frontend/src/lib frontend/src/types.ts frontend/src/AppState.tsx` | 빔 |
| 그 밖의 .tsx 변경 | 한 줄씩 읽었다 |

그 밖의 .tsx 변경:

- `DragOrderList.tsx`(새), `StockManager.tsx`(▲▼ → 끌기 · 배지 옮김), `StockDetail.tsx:238` · `HoldingTab.tsx:160`(문구 한 낱말).
- 2-2 의 "먼저 물을 것 · 하면 안 되는 것"에 닿는 것은 없다. 저장은 옛 `api.updateStockOrder` 그대로이고, 실패하면 되돌린다.

## 검토자가 한 일

- 작업 트리는 `/home/user/Dashboard`(브랜치 `claude/design-4-zerobase`, HEAD 6fa6d4a)다.
- 프런트는 `npm ci` → `tsc -b` → lint → vitest → `npm run build` 순서로 돌렸다.
- 가짜 서버는 8187 에 띄웠다(`--reset`). 데이터는 저장소 밖, 미리 만들지 않은 `scratchpad/r3f/data` 에 뒀다. PID 13561 로 껐고, 끈 뒤 `curl` 이 `000` 을 냈다.
- 진짜 터치는 CDP `Input.dispatchTouchEvent` 로 냈다(`isMobile`·`hasTouch`). 마우스는 playwright mouse 로 냈다. 실행자의 `../drag.mjs` 를 참고해 놓는 자리와 방향을 넓혔다.
- 데모 데이터는 드래그로 순서가 바뀐 채 audit 을 돌렸다(참고 1 이 여기서 나왔다).

산출물은 모두 `/tmp/claude-0/-home-user-Dashboard/c9553d42-71a5-5379-90e1-1c42ba786c3a/scratchpad/r3f/` 아래에 있다.

| 무엇 | 경로 |
|---|---|
| 명령 출력 | `ci.log` · `tsc.log` · `lint.log` · `vitest.log` · `build.log` · `server.log` · `audit.log` · `audit/summary.md` · `audit/results.json` |
| 끌기 네 조건 × 방향 · 놓는 곳 | `drag2.mjs` · `drag2.log` (첫 시도 `drag.mjs` · `drag.log` 는 막힌 상태가 다음 칸으로 번져 읽지 않음) |
| 막힘 재현 · 이벤트 | `stuck.mjs` · `stuck.log` · `dbg.mjs` · `shots/stuck-390.png` |
| 거르기 · 실패 되돌림 · 키보드 | `drag3.mjs` · `drag3.log` · `drag3kb.log` · `fail.mjs` · `shots/fail-390.png` |
| 순서 화면 직접 잼 · 포커스 | `ordm.mjs` · `ordm.log` · `shots/focus-*.png` |
| 배지 · 풀이 · 문구 · 홈 ▲▼ · 화면 밀림 | `badge.mjs` · `badge.log` · `shots/badge-*.png` · `word.mjs` · `home.mjs` · `scroll.mjs` |
| 카드 360 넘침 | `ov.mjs` · `ov2.mjs` |
| 뮤테이션 | `mut1.log` · `mut2.log` · `mut3.log` |

## git status

판정문을 쓰기 전 `git status --short` 출력은 비어 있었다. 판정문을 쓴 뒤에는 아래와 같다(판정문 하나뿐, 커밋하지 않음).

```
?? "docs/design/4\354\260\250-\354\240\234\353\241\234\353\262\240\354\235\264\354\212\244/3-review-6.md"
```
