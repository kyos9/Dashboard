# 디자인 4차 묶음 3 (종목) ② 반영 검토 재검토 — 5d5dbb8 (범위 6fa6d4a..5d5dbb8, 지난 판정 3-review-6.md 조건부)

# 조건부 합격

지난 판정의 두 조건은 풀렸다.

- **조건 1(막음)이 풀렸다.**
  - 아래·위·옆으로 흘러 손잡이 밖에서 놓아도, 줄 위아래 10px 띠에서 놓아도 끌기가 끝난다.
  - 목록 밖 오른쪽에서 놓아도 끝난다.
  - 390 · 360(진짜 터치 CDP) · 1400 · 확대 150%(마우스) 모두 `PUT 1 · "저장했습니다" · 끄는 상태 0 · 새로고침 뒤 남음` 이다.
  - 끄는 동안 화면은 밀리지 않는다.
  - 테스트도 이것을 잡는다. 듣는 곳을 손잡이로 되돌리는 뮤테이션을 넣으면 3 개가 떨어진다.
- **조건 2가 풀렸다.**
  - `drop` 을 `saveOrder(shown, ticker)` 로 바꾸면 새 테스트가 떨어진다.
- 참고 2(손잡이 포커스 테두리)와 참고 3(100% 테스트)도 됐다.

새로 생긴 것이 둘이다. 둘 다 이번 보완이 만든 회귀다.

1. **끄는 도중 다른 손가락이 끌기를 가로챈다.**
   - 창(window)에서 듣되 어느 포인터인지 가리지 않는다.
   - 그래서 둘째 손가락이 움직이면 끄는 종목이 그 손가락을 따라간다.
   - 둘째 손가락을 떼면 그 자리로 저장된다.
   - 6fa6d4a 에서는 처리기가 잡기(capture)한 손잡이에만 있어서 이런 일이 없었다.
2. **카드 제목 외톨이 줄이 0 에서 17 이 됐다.**
   - 원인은 참고 1 을 고친 `overflow-wrap: break-word` 다.
   - 카드 보기 9 조건 모두에서 `東京海上ホールディン/グス`, `TIGER /미국필라델피아반도체나스/닥` 로 끊긴다.
   - 360 넘침은 0 이 됐다. 그 대신 제목 끝 1–3 자가 따로 한 줄을 차지한다.

## 조건(고친 뒤 다시 잰다)

| # | 무엇 | 심각도 | 근거 |
|---|---|---|---|
| 1 | 끄는 동안 다른 포인터의 move · up 이 끌기를 움직이고 끝낸다. `DragOrderList.tsx:46-66` 은 `pointerId` 를 보지 않는다 | 고쳐야 함 | `extra2.log` "둘째 손가락" |
| 2 | 카드 제목 외톨이 0 → 17(제목은 0 이어야 한다). `stocks.css:204-206` `.stock-tile .stock-row-title { overflow-wrap: break-word }` | 고쳐야 함 | `audit/summary.md` orphan 17, `tog.log` · `tog2.log` |

조건 1 — 실제 브라우저(진짜 터치 CDP, 390 · 360 같음)에서 잰 것이다.

- 처음 순서는 `VOO,SCHD,AAPL,QQQ,MSFT,NVDA,GOOG` 이다.
- 첫 손가락으로 VOO 손잡이를 잡고 거의 움직이지 않았다(2px). 그 채로 둘째 손가락을 6번 줄 이름 위에 대고 40px 움직였다.
  - 화면이 `SCHD,AAPL,QQQ,MSFT,NVDA,VOO,GOOG` 이 됐다. VOO 가 둘째 손가락을 따라갔다(끄는 중 1).
  - 둘째 손가락만 떼었더니 바로 `끄는 중 0 · PUT 1` 이고, 서버도 그 순서다.
  - 사용자는 첫 손가락으로 아무것도 옮기지 않았는데 저장됐다.
- 폰을 쥔 손의 엄지나 손바닥이 화면에 닿는 경우가 여기에 든다. 저장 말과 새 순서가 보이니 사용자가 알 수는 있다. 그래서 막음이 아니라 고쳐야 함이다.
- 고칠 길(제안)은 이렇다.
  - `start` 에서 `e.pointerId` 를 기억한다.
  - `move` · `finish` 는 같은 `pointerId` 일 때만 처리한다.
  - 테스트에는 "다른 pointerId 의 pointerUp 으로는 끝나지 않는다"를 하나 넣는다.

조건 2 — 이번 규칙을 끈 채와 켠 채를 같은 화면에서 재 봤다(`tog.log`).

| 폭 | 지금(break-word) | 이 규칙만 끔 |
|---|---|---|
| 1400 | 東京 2줄 `…ディン/グス` · TIGER 3줄 `…나스/닥` | 東京 1줄 sw170/cw153 · TIGER 2줄 sw157/cw153 |
| 390 | 같음 | 東京 sw170/cw151 · TIGER sw157/cw151 |
| 360 | 東京 `…ディ/ングス` · TIGER `…나/스닥` | 東京 sw170/cw136 · TIGER sw157/cw136 |

- TIGER 는 전에 칸보다 6px 넓었다. 그래도 칸의 안쪽 여백 안이라 보기에 문제가 없었고 audit 도 0 이었다. 지금은 "닥" 한 자가 셋째 줄에 혼자 남는다.
- `text-wrap: balance` 를 더해 봐도 같다(`tog2.log`). 넘칠 때만 끊는 비상 끊기라 고르게 나누지 못한다.
- 길은 실행자가 정한다. 예를 들면 이런 것들이다.
  - 카드 제목 글씨를 조금 줄인다.
  - 넘침이 실제로 생긴 일본어 이름에만 `word-break: normal` 을 준다. 일본어는 가나 사이에서 끊는 것이 보통이다.
  - 두 줄로 줄이고 말줄임을 쓴다.
- 어느 길이든 360 넘침 0 과 외톨이 0 을 같이 맞춰야 한다.

## 참고(조건 아님)

- **참고 1**: 끄는 중 `pointercancel`(진짜 터치 `touchCancel`)이 오면 미리 보인 순서를 **저장한다**(`PUT 1 · 말 1`, `extra2.log`).
  - 멈추지는 않는다. 끄는 상태 0 이고, 다시 끌어도 된다(`extra.log` 390 "취소 뒤 다시 4→1" PUT 1).
  - 6fa6d4a 의 `onPointerCancel={end}` 와 같은 동작이라 회귀는 아니다.
  - 브라우저나 OS 가 끌기를 빼앗을 때(전화가 오는 경우 등)는 "저장 안 함"이 더 맞을 수 있다. 조건 1 을 고칠 때 같이 정하면 좋다.
- **참고 2**: 맨 끝 → 맨 위(멀리) 한 번에 옮기기는 여전히 안 된다(③ 남김 그대로). `drag2.log` 마지막 칸은 시작 손잡이가 화면 밖이다.

## 볼 것별 판정

| # | 볼 것 | 판정 | 증거 |
|---|---|---|---|
| 1a | 지난 `stuck` 탐침 다섯 경우 | 통과 | `stuck.log` 다섯 줄 모두 `PUT 1 · is-dragging 0 · 말 1`, 서버 = 화면. 지난번 실패한 "60px 흐름"은 "순서 바꾸기 끝" 뒤에도 `QQQ,VOO,SCHD`(새 순서)가 남는다 |
| 1b | `drag2` 네 조건(390 · 360 터치, 1400 · 150% 마우스) × 위로 / 아래로 × 손잡이 / 이름 위에서 놓기, 맨 끝으로 | 통과 | `drag2.log` 20 칸 모두 `미리 벌림 true · 놓기 전 PUT 0 · 화면=기대 · 서버=기대 · PUT 1 · 끄는 중 남음 0 · 말 O`. 새로고침 뒤 화면=서버 넷 다 true. errs 0 |
| 1c | 줄 위·아래 10px 띠(손잡이 밖)에서 놓기 | 통과 | `extra2.log`: 390 · 360 "아래 띠 1→3" · "위 띠 4→1"은 `놓는 점 손잡이 위 false · 화면=기대 · 서버=기대 · PUT 1 · 남음 0 · 말 1`. 마우스 1400 · 150% "아래 띠" · "목록 밖 오른쪽"도 같다(`extra.log`) |
| 1d | 끄는 동안 화면 안 밀림 | 통과 | `drag2.log` scrollY 가 손잡이에서 시작한 칸마다 같다(`127 → 127`, `815 → 815`, `977 → 977` …) |
| 1e | 이름 위에서 손가락 올리면 화면만 내려감 | 통과 | `scroll.log`: `scrollY 0 → 423 · 순서 그대로 true · PUT 0` |
| 1f | 끄는 도중 다른 손가락 | **실패(조건 1)** | 위 표. 멈추지는 않지만 둘째 손가락이 끌기를 가로채 저장한다 |
| 1g | 끄는 도중 pointercancel | 통과(참고 1) | 남음 0, 다시 끌기 됨. 취소인데 저장한다 |
| 2a | 뮤테이션 — `StockManager.tsx:331` → `void saveOrder(shown, ticker)` | 통과 | `mut1.log`: `× 순서 바꾸기 — 거르기가 걸린 채 끌면 …` · `Tests 1 failed \| 57 passed (58)`. `git checkout` 뒤 status 빔 |
| 2b | 뮤테이션 — 창 대신 끄는 손잡이에서만 듣게(`DragOrderList.tsx:64-66` 의 `window` → 그 줄의 `.drag-grip`) | 통과 | `mut2.log`: `Tests 3 failed \| 55 passed (58)`. 끌어 놓기 · "아래로 끌어 손잡이 밖에서 놓아도" · 거르기 끌기가 떨어진다. `git checkout` 뒤 status 빔 |
| 2c | 뮤테이션 — `!sumOk &&` → `true &&`(지난 참고 3) | 통과 | `mut3.log`: `Tests 1 failed \| 57 passed (58)`. `git checkout` 뒤 status 빔 |
| 3a | 지난 참고 1 — 카드 360 넘침(東京海上이 오른쪽 칸) | 넘침 통과 · **외톨이 회귀(조건 2)** | 8766.T 를 2번째(오른쪽 칸)로 두고 쟀다(`card.log`): 360 어두움 · 밝음 · 390 `over 0`, 칸 right 346/360. 그 상태의 audit page-overflow 0 |
| 3b | 지난 참고 2 — 손잡이 포커스 테두리 | 통과 | `focus.log`: 두 테마 × 1400 · 390 모두 손잡이 `solid 2px` 이고 색이 같은 화면의 단추 포커스와 같다(어두움 `rgb(146,177,219)` = `--accent #92b1db`, 밝음 `rgb(0,81,168)` = `#0051a8`). offset −2px 로 칸 안에 그려진다(`shots/focus-dark-390.png`) |
| 4a | 키보드 위·아래 | 통과 | `drag3.log`: 맨 위에서 ↑ · 맨 아래에서 ↓ 는 PUT 0. 둘째에서 ↑ 는 PUT 1, 이어서 ↓ 는 PUT 2. 포커스는 같은 종목 손잡이 그대로. Tab 순서 `… 전체 15 \| 신호 9 \| 보유 15 \| SCHD 순서 … \| AAPL 순서 …` |
| 4b | 저장 실패 되돌림 | 통과 | `drag3.log`: `끄는 중 바뀜 true · 되돌림 true · 서버 그대로 true · 저장 말 0`. `fail.log`: 오류 글 `⚠ boom 닫기` 가 top 168/844 에 뜬다. 콘솔 오류는 막은 500 하나뿐 |
| 4c | 거르기 걸린 끌기(화면) | 통과 | `drag3.log`: `신호 9/15 · 가려진 종목 자리 그대로 true · 서버의 보이는 순서 true · PUT 1` |
| 4d | 홈 시그널 목록 ▲▼ | 통과 | `home.log`: `▲ 15 · 첫 ▲ disabled 44x44 · 두 번째 ▲ 누른 뒤 PUT 1 · 손잡이(≡) 0 · errs 0` |
| 4e | audit stocks · stocks-card · stocks-sheet | 조건 2 빼고 통과 | 아래 |
| 4f | 색표 밖 색 | 통과 | `stocks.css` · `DragOrderList.tsx` 에서 `#hex/rgb(/hsl(` grep 0. 새 규칙은 `var(--accent)` 만 쓴다 |
| 5 | vitest · lint · tsc · build · 기능 불변 | 통과 | 아래 |

## 자동 검사(audit `--only stocks,stocks-card,stocks-sheet`, 8766.T 를 오른쪽 칸에 둔 순서)

- 30 조합을 쟀고, 열지 못한 것은 0 이다(`audit/summary.md`).
- 0 인 것: page-overflow · clipped · num-split · folded3 · folded2-360 · touch · contrast · console · fake-button · focus-ring 등 나머지 모두. 지난번(r3f)의 page-overflow 2 는 0 이 됐다.
- orphan 은 **17** 이다(r3f 0). 모두 `stocks-card` 의 `span.stock-row-title` 이고 kind 는 para 다.
  - 9 조건 × 東京海上 = 9: 마지막 줄 `last 1–3` 자.
  - 8 조건 × TIGER = 8: `last 1–2` 자. 150% 에서는 TIGER 가 잡히지 않았다.
  - `stocks` · `stocks-sheet` 의 orphan 은 0 이다.

회귀 목록(기준 0 → 지금 1 이상): `stocks-card` orphan(모든 조건) — 조건 2.

## 빌드 · 테스트 · 기능 불변

| 무엇 | 결과 |
|---|---|
| `npm ci` | 0 (`ci.log`) |
| `npx tsc -b` | 0 (`tsc.log`) |
| `npm run lint` | 경고 20(기준 22, 실행자 20), 오류 0. `DragOrderList` · `StockManager` 경고 없음(`lint.log`) |
| `npx vitest run` | `Test Files 68 passed (68)` · `Tests 1110 passed (1110)`(`vitest.log`). 1107 + 3(아래로 손잡이 밖 놓기 · 거르기 끌기 · 100% 초록) = 1110. 고친 테스트는 앞 끌기 테스트 하나다. move 를 window 에, up 을 body 에 쏘도록 바꿨다. 단언은 그대로라 약해지지 않았다 |
| `npm run build` | 0 (`build.log`). 화면은 이 build 뒤에 봤다 |
| `git diff --stat 6fa6d4a..5d5dbb8 -- backend frontend/src/api frontend/src/lib frontend/src/types.ts frontend/src/AppState.tsx` | 빔 |
| 그 밖의 .tsx 변경 | `DragOrderList.tsx` 만 바뀌었고 한 줄씩 읽었다. 처리기를 손잡이에서 창으로 옮겼고 `setPointerCapture` 를 뺐다. 저장 · 되돌림은 그대로 부르는 쪽(StockManager)에 있다. 2-2 에 닿는 것은 없다 |

## 검토자가 한 일

- 작업 트리는 `/home/user/Dashboard`(브랜치 `claude/design-4-zerobase`, HEAD 5d5dbb8)다.
- 프런트는 `npm ci` → `npm run build` → `tsc -b` → lint → vitest 순서로 돌렸다.
- 가짜 서버는 8188 에서 `--reset`, 데이터는 저장소 밖 `…/scratchpad/r3g/data` 에 두었다. 다 쓴 뒤 PID 로 껐다.
- 탐침: 지난 r3f 의 `stuck` · `drag2` · `drag3` · `scroll` · `fail` · `home` 은 포트만 바꿔 그대로 돌렸다. 새로 짠 것은 `extra.mjs` · `extra2.mjs`(띠 · 둘째 손가락 · touchCancel) · `put8766.mjs` · `tog.mjs` · `tog2.mjs` · `focus.mjs` 다.
- 산출물은 `/tmp/claude-0/-home-user-Dashboard/c9553d42-71a5-5379-90e1-1c42ba786c3a/scratchpad/r3g/` 에 있다.
- 뮤테이션 셋은 모두 `git checkout` 으로 되돌렸다. 저장소 파일은 고치지 않았고 커밋하지 않았다.
- 끝낸 뒤 `git status --short`:

```
?? "docs/design/4\354\260\250-\354\240\234\353\241\234\353\262\240\354\235\264\354\212\244/3-review-7.md"
```

(이 판정문 하나뿐이다.)
