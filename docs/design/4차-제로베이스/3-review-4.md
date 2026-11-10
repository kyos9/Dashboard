# 디자인 4차 묶음 3 (종목) 세 번째 재검토 판정 — 74b9066 (보완 범위 9fb6b75..74b9066, 지난 판정 3-review-3.md)

# 조건부 합격

지난 조건 1("AI 연 채 ‹" 테스트가 고친 줄을 잡지 못함)은 풀렸다. 뮤테이션을 걸면 새 테스트가 떨어진다.

같은 커밋이 더한 Tab 가두기(StockEditModal · ConfirmDialog)에서 새 회귀가 하나 나왔다. 고친 것이 있을 때 뜨는 "저장하지 않고 닫을까요?" 확인창에서 Tab 이 "계속 고치기" 한 칸에 묶인다. "버리고 닫기"로 가지 못한다. 차트 팝업 안에서는 9fb6b75 때 두 단추 사이를 돌았으니 회귀다. 이 범위에서 남은 조건은 이것 하나다.

그 밖의 결과:

- 기능 불변 경로(backend · api · types · AppState)의 이 범위 diff 는 비어 있다.
- vitest 1101 통과 · lint 경고 20 · tsc 통과 · build 통과.
- 팝업 밖(종목 안 화면 · 종목 목록 · 홈)에서 연 수정창도 Tab 이 새지 않는다. 처음 칸은 고른 종목의 수량 그대로다. 닫으면 연 단추로 돌아간다.

검토자가 한 일:

- 작업 트리는 `/home/user/Dashboard`(브랜치 `claude/design-4-zerobase`, HEAD 74b9066)다.
- 프런트는 `npm ci` → `tsc -b` → lint → vitest → `npm run build` 순서로 돌렸다.
- 가짜 서버는 8185 에 띄웠다(`--reset`, 데이터는 저장소 밖 `scratchpad/r3d/data`). PID 로 껐고, 끈 뒤 `curl` 이 `000` 을 냈다.
- 9fb6b75 와 견줄 때는 `git archive 9fb6b75 frontend` 를 저장소 밖 `r3d/old/` 에 풀어 build 했다. 화면 파일은 playwright `route` 로 그 dist 에서 내주고, API 는 같은 8185 로 보냈다. 저장소와 `.git` 은 건드리지 않았다.
- 뮤테이션은 세 번 했다. 한 번 할 때마다 `git checkout` 으로 바로 되돌렸다.

산출물은 모두 `/tmp/claude-0/-home-user-Dashboard/c9553d42-71a5-5379-90e1-1c42ba786c3a/scratchpad/r3d/` 아래에 있다.

| 무엇 | 경로 |
|---|---|
| 명령 출력 | `ci.log` · `tsc.log` · `lint.log` · `vitest.log` · `build.log` · `server.log` · `old-build.log` |
| 뮤테이션 | `mut1.log`(aiOpen) · `mut2.log`(StockEditModal 가두기) · `mut3.log`(ConfirmDialog 가두기) |
| 팝업 Tab · Esc(A–F) | `q1.mjs` · `q1.log`(`q1-part1.log` 는 G 에서 멈춘 첫 실행) |
| 종목 목록 · 홈의 한 번에 수정(G · H) | `q1g.mjs` · `q1g.log` |
| 차트 팝업 AI 칸 Tab | `q1b.mjs` · `q1b.log` |
| "닫을까요" 9fb6b75 대 74b9066 | `q5.mjs` · `q5-old.log` · `q5-new.log` |
| 사진 | `shots/page-ask-390.png` · `shots/page-ask-1400.png` |

## 합격으로 올릴 조건

1. **"저장하지 않고 닫을까요?" 확인창에서 Tab 이 한 칸에 묶인다 (2-2 키보드 · 6장 회귀)**
   - 일어나는 일(`q1.log` · `q1g.log`, 390 · 1400 결과가 같다):
     - 수정창에서 수량을 고친 뒤 Esc 를 누르면 확인창이 뜨고, 포커스는 `계속 고치기` 에 간다. 여기까지는 맞다.
     - Tab 을 6 번 누르면 6 번 다 `계속 고치기` 다. Shift+Tab 을 6 번 누르면 6 번 다 `버리고 닫기` 다.
     - 이렇게 묶이는 곳은 네 군데다. 차트 팝업 → 보유 → 고치기(A2), 종목 안 화면 `?tab=holding`(F2), 종목 목록의 한 번에 수정(G), 홈의 한 번에 수정(같은 수정창).
   - 9fb6b75 와 견줬다(`q5-old.log` 대 `q5-new.log`, 같은 데이터 · 같은 조작):

     | 경우 | 9fb6b75 | 74b9066 |
     |---|---|---|
     | 차트 팝업 안 · Tab | `버리고 닫기 \| 계속 고치기 \| …` 가 돈다 | `계속 고치기` 만 6 번 — **회귀** |
     | 차트 팝업 안 · Shift+Tab | 두 단추가 돈다 | `버리고 닫기` 만 6 번 |
     | 종목 안 화면 · Tab | `버리고 닫기 \| OUT:개인정보처리방침 … \| OUT:홈 …` 로 샌다 | 새지 않지만 `계속 고치기` 에 묶인다 |

   - 까닭:
     - `StockEditModal.tsx:63` 이 `.stock-edit-modal`(`:204-206`)에 가두기를 건다.
     - 그런데 "닫을까요" `ConfirmDialog`(`:279-`)는 그 div **바깥**, backdrop 바로 밑에 그려진다.
     - 확인창이 떠 있으면 수정창의 가두기는 포커스가 자기 밖에 있다고 본다(`focusTrap.ts:32` `inside` 거짓). 그래서 Tab 마다 수정창의 첫 칸으로 끌어온다(`:36-38`).
     - 뒤에 등록된 ConfirmDialog 의 가두기는 다시 자기 첫 단추로 끌어온다. 결과는 늘 첫 단추다. Shift+Tab 은 같은 길로 늘 마지막 단추다.
     - 차트 팝업 안에서는 차트 가두기가 맨 안쪽 창(확인창)을 맞게 고른다. 하지만 그 뒤에 수정창 가두기가 또 돌아서 같은 결과가 된다.
   - 테스트가 못 잡은 까닭: `HoldingTab.test.tsx` 의 새 테스트는 수정창(고친 것 없음)과 삭제 확인만 본다. "닫을까요" 는 열지 않는다.
   - 고칠 길(하나만 고른다):
     - "닫을까요" ConfirmDialog 를 `.stock-edit-modal` div 안으로 옮긴다. 그러면 `focusTrap.ts:26-27` 의 "맨 안쪽 창" 이 그것을 고른다.
     - 또는 가두기가 자기 밖의 더 위 창에 포커스가 있으면 손대지 않게 한다. 예: 포커스가 다른 `[role=dialog]` · `[role=alertdialog]` 안이면 `return`.
     - 어느 쪽이든 테스트를 남긴다. 고친 것이 있는 채 Esc → Tab 이 `버리고 닫기` 로 가고 다시 `계속 고치기` 로 돈다. 차트 팝업 안과 밖 둘 다 본다.

## 지난 조건별

| # | 지난 조건 | 판정 | 증거 |
| --- | --- | --- | --- |
| 1 | "AI 연 채 ‹" 테스트가 고친 줄을 잡지 못함 | **통과** | 아래 |

- 뮤테이션: `StockDetailPage.tsx:64` 의 `if (!aiOpen) return back()` 을 `return back()` 으로 바꿨다(`sed`). 결과는 다음과 같다.
  - `npx vitest run src/pages/StockDetailPage.test.tsx` 가 `Tests 1 failed | 16 passed (17)` 이다.
  - 떨어진 것은 "AI 를 연 채로 ‹ 를 누르면 한 번에 종목 목록으로 — 실제 브라우저 기록으로, 앱 안에서 들어온 경우" 다.
  - 메시지는 `expected '/stocks/VOO' to be '/stocks'`(`StockDetailPage.test.tsx:202`)다.
  - `git checkout` 으로 되돌린 뒤 같은 파일이 `17 passed` 이고, `git status --short` 는 비어 있다.
- 테스트는 `BrowserRouter` 다. `/stocks` 에서 링크로 들어가 `history.state.idx > 0` 을 확인하고, ‹ 뒤 `idx` 가 하나 줄었는지(`idxIn - 1`)를 본다. 고친 길("앱 안에서 와서 AI 칸이 쌓인 채")을 실제로 지나간다.
- 같은 파일의 다른 16 개와 전체 vitest 에서도 통과한다. `window.history` 를 바꾸는 테스트가 다른 테스트를 흔들지 않는다.

## 같은 커밋이 더한 것 — 회귀 점검

`q1.log` · `q1g.log` 를 봤다. 390 · 1400 결과가 같다. `TOP` 은 맨 위 창 안, `UNDER` 는 그 밑 창 안, `OUT` 은 뒤 화면이다.

| 경우 | 결과 | 판정 |
|---|---|---|
| A. 차트 팝업 → 보유 → 고치기 | 처음 포커스는 `TOP:VOO 보유수량` 이다. Tab 14 번 · Shift+Tab 14 번 모두 `TOP 14/14`(8 칸이 돈다). 지난 판정과 같다 | 통과 |
| A. 안쪽 수정창을 Esc | `["VOO 차트"]`, 포커스는 `TOP:VOO 보유 고치기`(연 단추). 지난 판정의 참고 2("뒤 화면 머리에 남음")가 풀렸다. 이어서 Tab 10 번이 `TOP 10/10` | 통과 |
| A2. 고친 것 있을 때 Esc → "닫을까요" | 확인창이 뜨고 포커스는 `계속 고치기` 다. Esc 는 확인창만 닫는다(`["VOO 차트","VOO 수정"]`). 다시 Esc 를 누르면 다시 묻는다. `버리고 닫기` 를 누르면 `["VOO 차트"]` 이고 포커스는 `VOO 보유 고치기` 다. **Tab 은 위 조건 1** | 확인창은 통과 · Tab 은 실패 |
| B. 차트 팝업 → 보유 → 삭제 | 처음 포커스는 `TOP:취소` 다. Tab 8 번 · Shift+Tab 8 번 모두 `TOP 8/8`(`네, 지웁니다 \| 취소` 가 돈다). Esc 를 누르면 포커스가 `TOP:VOO 삭제`(연 단추)로 간다. 한 번 더 누르면 `[]` 이고 포커스는 `VOO` 다 | 통과 |
| C. 차트 팝업만 | Tab 40 번이 `TOP 40/40` 이다 | 통과 |
| C. 차트 팝업 + AI 칸 | Tab 30 번이 `TOP 29/30 OUT 1` 이다. **3-보완.md 참고 1 의 처리(`summary` 추가)로는 풀리지 않았다** → 아래 참고 1 | 회귀 아님 |
| D. 뒤로가기 하나씩 | `["VOO 차트"] -> []`, 주소는 `/?view=signal` 그대로다 | 통과 |
| F. 종목 안 화면 `/stocks/VOO?tab=holding` → 고치기 | 처음 포커스는 `TOP:VOO 보유수량` 이다. Tab 14 번 · Shift+Tab 14 번 모두 `TOP 14/14` 다(지난 `TOP 3/14 OUT 11`). Esc 를 누르면 `OUT:VOO 보유 고치기`(연 단추)로 간다 | 통과(참고 5 풀림) |
| F2. 같은 화면, 고친 것 있을 때 | 확인창이 뜨고, `계속 고치기` 를 누르면 수정창으로 돌아간다. `버리고 닫기` 를 누르면 `[]` 이고 포커스는 연 단추다. **Tab 은 위 조건 1** | 확인창은 통과 · Tab 은 실패 |
| F3. 같은 화면 → 삭제 | 처음 포커스는 `TOP:취소` 다. Tab 6 번이 `TOP 6/6`(두 단추가 돈다)이다. Esc 를 누르면 `OUT:VOO 삭제` 로 간다 | 통과 |
| G. 종목 목록 → 보기·설정 → 한 번에 수정 | 처음 포커스는 `TOP:VOO 보유수량`(첫 종목의 수량)이다. Tab 30 번 · Shift+Tab 30 번 모두 `TOP 30/30`(30 칸이 다 다르다). 버리고 닫으면 포커스가 `종목 한 번에 수정` 으로 간다. "닫을까요" Tab 은 위 조건 1 | 통과 · 조건 1 |
| H. 홈 → 종목 한 번에 수정 | 처음 포커스는 `TOP:VOO 보유수량` 이다. Tab 30 번이 `TOP 30/30` 이다. Esc 를 누르면 `종목 한 번에 수정` 으로 간다 | 통과 |
| 리밸런싱 | 이 화면은 `StockEditModal` 을 쓰지 않는다(`grep '<StockEditModal'` 은 `PortfolioView.tsx:268` · `StockManager.tsx:571` · `HoldingTab.tsx` 뿐이다). 거래 기록 삭제 ConfirmDialog(`RebalancePanel.tsx:791`)는 F3 과 같은 한 겹 구조다 | 해당 없음(구조상 F3 과 같음) |

- 콘솔 오류는 0 이다(`390 errs 0` · `1400 errs 0`, q1 · q1g 모두).
- 뮤테이션 결과:
  - `StockEditModal.tsx:63` 의 `useFocusTrap` 을 빼면 `HoldingTab.test.tsx` "팝업 밖(종목 안 화면)에서 연 수정 · 삭제 확인도 …" 가 `1 failed | 444 passed`(src/components) 다(`mut2.log`).
  - `ConfirmDialog.tsx:40` 을 옛 `useEffect(() => cancelRef.current?.focus(), [])` 로 바꿔도 같은 테스트가 떨어진다(`mut3.log`).
  - 둘 다 되돌려 놓았다.
- `takeFocus=false` 를 쓰므로 수정창의 처음 칸은 `StockEditModal.tsx:105-117` 의 effect 가 고른다. 가두기 effect(`:63`)가 먼저 돌아 연 단추를 기억하고, 그 뒤에 수량 칸으로 간다. 닫으면 연 단추로 가는 것이 A · F · G · H 에서 맞았다.

## 항목별 (3-1 · 6장)

| 항목 | 판정 | 증거 |
| --- | --- | --- |
| npm ci · tsc -b · build | 통과 | `ci 0` · `tsc 0` · `✓ built in 426ms` |
| lint | 통과 | 경고 20 (`grep -c warning lint.log`). 기준 22 · 실행자 20 과 같다 |
| vitest | 통과 | `Test Files 67 passed (67)` · `Tests 1101 passed (1101)`. 실행자 1101 과 같다(지난 1100 + HoldingTab 1) |
| 백엔드 테스트 | 해당 없음 | backend diff 가 비어 있다 |
| 기능 불변 — backend · api · types · AppState | 통과 | `git diff --stat 9fb6b75 74b9066 -- backend frontend/src/api frontend/src/types.ts frontend/src/AppState.tsx` 가 비어 있다. 차수 시작 `79b8850` 부터 보면 `types.ts` 의 주석 두 줄("진단" → "점검")이 바뀌었다. 묶음 2 의 `0318203` 이 바꾼 것으로, 타입은 그대로다 |
| 기능 불변 — lib | 통과(이유 적힘) | `focusTrap.ts` 하나다(+8 −4). `summary` 와 `takeFocus` 를 더했다. 3-보완.md 끝 절에 적혀 있다 |
| 그 밖의 `.tsx` | 조건 1 | `ConfirmDialog` · `StockEditModal` 에 가두기를 더했다. 새 API 호출은 없다 |
| 글자 자르기 · 색표 밖 색 · 움직임 | 해당 없음 | 범위 diff 에 CSS 가 없다 |
| 키보드 | **실패(조건 1)** | 위 |
| 고친 깨짐마다 테스트 | 통과 | 뮤테이션 셋(`StockDetailPage.tsx:64` · `StockEditModal.tsx:63` · `ConfirmDialog.tsx:40`) 모두 테스트가 떨어진다. 참고 1(`summary`)은 테스트가 없다고 적혀 있고, 실제로도 고쳐지지 않았다(아래) |
| 문구 변경 | 해당 없음 | 문구는 바뀌지 않았다 |
| 계획 검토 걱정(plan-*.md) | 통과 | 이번 범위에 새로 걸리는 항목이 없다 |
| 자동 검사(audit) | 해당 없음 | CSS 와 모양 변화가 없다. 키보드 탐침(q1 · q1g · q5)으로 대신했다 |

## 참고 (막지 않음)

1. **차트 팝업에서 AI 칸을 연 채 Tab 이 여전히 한 번 샌다. 3-보완.md 는 고쳤다고 적었다.**
   - `q1b.log`: `… TOP:BUTTON:표 없이 짧게 | TOP:SUMMARY:AI 에게 보내는 내용 보기 | OUT:A:개인정보처리방침 · 이용약관 | TOP:BUTTON:AI 분석 …`. `q1.log` 도 `C chart+AI Tab TOP 29/30 OUT 1` 이다(지난 판정과 같다).
   - 까닭: 닫힌 `<details>`(`AiPanel.tsx:393`) 안의 `지금 요청을 넣어 다시 보기` 단추가 고를 것의 **마지막**으로 잡힌다. 이 단추는 `button:not(:disabled)` 라서 잡히지만, 닫힌 details 안이라 포커스를 받지 못한다. 그래서 `summary` 에 있을 때 `active === last` 가 거짓이 되고, 브라우저 기본 Tab 이 밖으로 나간다.
   - 지난 판정에서 짚은 원인(`summary` 가 빠짐)이 틀렸다. 검토자 잘못이다.
   - 고칠 길: `focusables` 에서 닫힌 details 의 summary 가 아닌 자손을 뺀다. 예: `el.closest('details:not([open])') && el.tagName !== 'SUMMARY'` 이면 뺀다. 또는 `el.checkVisibility?.()` 로 거른다.
   - 차수 시작부터 있던 것이라 회귀는 아니다. 다만 3-보완.md 끝 절 "참고 1" 행의 처리 기록은 사실과 다르다. 고치거나 "남음" 으로 바로잡아야 한다.
2. ConfirmDialog 가 지우는 중(`busy`)이면 두 단추가 다 꺼진다. 그러면 고를 것이 0 이 되고(`focusTrap.ts:28` `return`) Tab 을 막지 않는다. 짧은 동안이고 전에도 가두기가 없던 자리라 회귀는 아니다.
3. 지난 판정의 참고 2(안쪽 팝업을 닫으면 뒤 화면 머리)와 참고 5(종목 안 화면 수정창 Tab 이 샘)는 풀렸다(위 A · F). 참고 3 · 4 는 3-보완.md 에 따라 ③ 보고로 넘긴다.

## 검토자 작업 트리

```
$ git status   (/home/user/Dashboard, HEAD 74b9066 — 판정문 쓰기 직전)
On branch claude/design-4-zerobase
Your branch is up to date with 'origin/claude/design-4-zerobase'.

nothing to commit, working tree clean
```

- 판정문을 쓴 뒤에는 이 파일(`docs/design/4차-제로베이스/3-review-4.md`) 하나만 추적되지 않은 파일로 남는다. 커밋하지 않았다.
- 저장소 파일은 고치지 않았다. `frontend/node_modules` · `dist` 는 git 이 무시한다.
- 뮤테이션 셋은 하나마다 `git checkout` 으로 되돌렸다. 되돌린 뒤 `git status --short` 가 빈 것을 확인했다.
- 9fb6b75 비교용 build 는 저장소 밖(`r3d/old/`)에서 했다.
- 가짜 서버(8185)는 PID 로 껐다. 첫 실행은 `--data-dir` 를 미리 만들어 둔 탓에 바로 끝났다("이 도구가 만든 폴더가 아니라서"). 폴더를 지우고 다시 띄운 것을 썼다.
