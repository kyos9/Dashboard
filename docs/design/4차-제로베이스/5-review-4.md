# 디자인 4차 묶음 5 매크로 — 네 번째 검토 (bc059d5)

## 판정: 조건부 합격

- 검토 범위: `c5a264f..bc059d5`, 한 커밋.
  - 바뀐 코드: ForecastBox.tsx +3/−2 · MacroPanel.tsx +10/−7 · macro-list.css +6
  - 테스트: MacroPanel.test.tsx +56, 지운 줄 0
- 따로 만든 worktree(`git worktree add --detach scratchpad/r5d/wt bc059d5`)에서 띄우고 다시 쟀다.
- `frontend` 에서 `npm run build` 를 먼저 했다.
  - 결과: `✓ built in 414ms`, `index-CGrZ5pnR.js`
  - 서버가 내준 첫 화면도 `index-CGrZ5pnR.js` 를 가리킨다.
- 가짜 서버
  - 포트 18881, `--data-dir scratchpad/r5d/data --reset`(저장소 밖 새 폴더)
- 주 작업 트리, 8765, backend/.devdata 는 건드리지 않았다.

세 번째 검토의 조건 둘은 풀렸다. 실제 브라우저(키보드 · 마우스 · 폰 320 탭, 두 테마)로 쟀고, 돌연변이로 테스트도 확인했다.
참고 하나("저장 중 흐리게")도 풀렸다.

남은 조건은 하나다. ★ 저장이 실패한 뒤 별로 포커스를 데려가는 이번 수정이 경쟁 상태(race)에 걸린다.
느린 폰(CPU 4~10배 느림)에서는 절반쯤, 보통 속도에서도 가끔 예전처럼 포커스가 `body` 로 떨어진다.

### 조건 (하나)

1. **[고쳐야 함 · 작음] ★ 저장 실패 뒤 `followStar()` 가 React 가 되돌림을 그리기 전에 돌 때가 있다. 그러면 곧 사라질 "내 지표" 쪽 별에 포커스를 준다. 포커스는 다시 `body` 로 떨어지고, 화면도 되돌아간 별로 가지 않는다.**
   - 재현: 폰 320×568 라이트, 움직임 줄이기. PUT `/api/macro/pinned` 를 600ms 늦춘 뒤 500 으로 만든다. CPI ★ 을 탭한다.
     - CPU 보통, 14번 중 1번(첫 실행): `after fail {"scrollY":308,"focus":"BODY", …}`. 나머지 13번은 `focus":"CPI 내 지표로 … pressed=false", focusInView true, scrollY 789`
     - CPU 4배 느림(CDP `Emulation.setCPUThrottlingRate`): 3번 중 1번 `BODY`
     - 6배: 3번 중 2번 `BODY`
     - 10배: 2번 중 1번 `BODY`
   - 까닭 확인: `HTMLElement.prototype.focus` 를 가로채 `[data-pin]` 별에 준 포커스를 적었다.
     - 실패한 회: `[{"pressed":"true","connectedNow":false}, {"pressed":"true","connectedNow":false}]`. 두 번째(실패 뒤) 포커스도 아직 켜진(pressed true) 옛 별에 갔고, 그 별은 곧 DOM 에서 빠졌다.
     - 맞은 회: `[{"pressed":"true","connectedNow":false}, {"pressed":"false","connectedNow":true}]`
   - 원인
     - `MacroPanel.tsx:271~275` `catch` 안의 `setData(...)` 는 `await` 뒤라 React 가 바로 그리지 않고 스케줄러 작업으로 미룬다. `followStar()` 의 `requestAnimationFrame` 은 그보다 먼저 돌 수 있다.
     - 처음 누를 때(`:265`)는 클릭 이벤트 안이라 React 가 바로 그려서 문제가 없다.
   - jsdom 테스트("★ 저장이 실패하면 되돌아간 자리의 별로 포커스…")는 `waitFor` 로 기다려서 이 순서를 못 본다. 돌연변이 M5(실패 뒤 `followStar()` 지움)는 잡는다. 다만 이 경쟁은 못 잡는다.
   - 고칠 방향(하나만 고르면 된다)
     - 되돌림을 `flushSync(() => setData(...))` 로 감싼 뒤 `followStar()`
     - 또는 "포커스할 별 코드"를 상태로 두고 `useLayoutEffect` 에서 그린 뒤 포커스
   - 이 항목은 원래 참고였고, 수정 전(늘 `BODY`)보다 나빠진 것은 아니다. 그래도 이번 커밋이 고쳤다고 한 일이 바로 느린 폰에서 안 되므로 조건으로 둔다. 총괄이 참고로 내려도 나머지는 합격이다.

## 세 번째 검토(5-review-3) 조건 둘 — 실제 브라우저

| # | 조건 | 판정 | 증거 |
|---|---|---|---|
| 1 | 폼이 열린 채 위 줄 "지우기" → 포커스가 달 칸, Esc 는 폼만 | 통과 | `scratchpad/r5d/c1.txt` 근원 PCE 에 2026-10 3.1 · 2026-11 2.9 를 넣는다. "예상치 입력"(달 2026-11, 2.9 로 미리 채움) → 예상 칸에 2.8 → `2026-10 예상 지우기` |
| 1-a | 키보드(PC 1280 다크) | 통과 | 달 칸에서 Shift+Tab 으로 `2026-10 예상 지우기 [fv]` → Enter → `focus IN 근원 PCE 예상치가 가리키는 달 [fv] \| form 1 \| typed 2.8` → Esc `dialogs 1 form 0 focus IN 예상치 입력 [fv]` → 다시 Esc `dialogs 0`, 포커스는 연 줄(`근원 PCE, … — 차트 [fv]`) |
| 1-b | 마우스(PC 1280 라이트) | 통과 | 같다. `IN 근원 PCE 예상치가 가리키는 달 \| form 1 \| typed 2.8` → Esc `dialogs 1 form 0` |
| 1-c | 폰 320 탭(라이트 640 · 다크 568) | 통과 | 둘 다 `IN … 가리키는 달 \| form 1 \| typed 2.8`, `focused el in view true` → Esc `dialogs 1 form 0` |
| 1-d | 덧붙여: 폼을 연 채 미리 채운 달(마지막 줄)을 지움 | 통과 | 네 경우 모두 `focus IN … 가리키는 달, lines 0, form 1` → Esc `dialogs 1 form 0 focus IN 예상치 입력` |
| 2 | busy 동안 여러 번 눌러도 요청 한 번(+ 테스트가 돌연변이를 잡나) | 통과 | `scratchpad/r5d/busy.txt`. PUT/DELETE 를 1.5초 늦췄다(`page.route`). PC 1280 · 폰 320 × 다크 · 라이트 넷 모두 같다 |
| 2-a | 저장 | 통과 | 저장 뒤 강제 클릭(폰은 탭 2번) + dblclick + Enter + Space + 숫자 칸 Enter + "입력 닫기" 클릭 + 위 줄 "지우기" 클릭 → `form still open 1`, `requests during save busy: 1 PUT` |
| 2-b | 지우기 | 통과 | 누른 "지우기"를 다시 클릭 + dblclick + Enter + Space + 옆 줄 "지우기" 클릭 → `requests during remove busy: 1 DELETE`. 남은 줄은 옆 줄 하나 |
| 2-c | 테스트가 돌연변이를 잡나 | 통과 | M1(저장 `\|\| busy` 지움) → "저장하는 동안 … disabled 는 아니다" 실패. M2(지우기 `if (busy) return` 지움) → "지우는 동안 두 번 눌러도 한 번만 지운다" 실패. 아래 돌연변이 표 |

## 참고 둘 (5-review-3 참고 → 이번 보완)

| 항목 | 판정 | 증거 |
|---|---|---|
| 저장 · 지우는 동안 흐려 보이나(다크 · 라이트) | 통과 | `busy.txt` 넷 모두. 평소 `op=1 cur=pointer` → busy `aria=true dis=false op=0.5 cur=default`. 저장 · 입력 닫기 · 누른 지우기 · 옆 줄 지우기 모두. 끝나면 `op=1 cur=pointer` 로 돌아온다. 화면: `shots/busy-save-320-light.png`(파란 "저장"과 "입력 닫기"가 흐림), `shots/busy-remove-1280-dark.png`(두 "지우기"가 흐림). 규칙은 `macro-list.css:177~182` |
| ★ 저장 실패(폰 320) 뒤 별로 포커스 · 화면, 오류 글 | **부분 — 위 조건 1** | `scratchpad/r5d/pin.txt`. 대개는 맞다. 폰 320×568 다크 · 640 다크(미 실업률) · PC 1280 키보드에서 `focus … pressed=false, focusInView true`. 알림 `role=status` "CPI 을(를) 옮기지 못했습니다". 다만 경쟁 때문에 가끔(느린 CPU 에서 절반쯤) `BODY`. **오류 글(`.error-text` "저장 실패")은 폰에서 여전히 화면 위 밖**(`top −109 / −590 / −618`, `inView false`). `role=status` 는 `sr-only`(`MacroPanel.tsx:381`)라 눈으로 보는 사람은 별이 꺼진 것만 본다. PC 1280 에서는 `top 144, inView true` |

## 기능 불변 · 품질

| 항목 | 판정 | 증거 |
|---|---|---|
| backend · api · lib · types · AppState diff 0 | 통과 | `git diff --stat 0a46c15 bc059d5 -- backend frontend/src/api frontend/src/lib frontend/src/types.ts frontend/src/AppState.tsx docs/design/audit.mjs` 빈 출력. `c5a264f..bc059d5` 도 빈 출력 |
| 그 밖의 .tsx 한 줄씩 | 통과 | ForecastBox `:82~83` 지운 뒤 `openRef ?? monthRef` 로 포커스. MacroPanel `:257~265 · :275` 별 따라가기를 함수로 빼 실패 때도 부름. 서버 요청 · 권한 · 계산 변화 없음 |
| 테스트 수 | 통과 | `npx vitest run` → `Test Files 68 passed (68)`, `Tests 1161 passed (1161)`(1158 → 1161, +3). 지운 줄 0(`56 0 MacroPanel.test.tsx`). 기존 "저장하는 동안…" 테스트에 세 줄 덧붙였고, 지운 줄은 없다 |
| 린트 | 통과 | `npm run lint` 경고 줄 20 |
| tsc · build | 통과 | `npx tsc -b` exit 0, 출력 없음. build `✓ built in 414ms` |
| CSS 300줄 이하 | 통과 | 바뀐 CSS `macro-list.css` 182줄 |
| tokens.css 밖 색 | 통과 | `src/styles`(tokens.css 빼고) `#hex · rgb( · hsl(` 0, `.tsx`(테스트 빼고) 0 |
| 콘솔 오류 | 통과 | 흐름 · 폭 측정 모두 `errs 0`, `pageerrors 0` |

### 돌연변이 (각각 `MacroPanel.test.tsx` + `src/components/Macro*` + `src/components/macro`, 82개. 끝나면 원래 글로 되돌림, `scratchpad/r5d/mut/out.txt`)

| 돌연변이 | 결과 |
|---|---|
| M1 저장 busy 가드 지움(`if (!canSave) return`) | 잡힘 — 3차 조건 2 풀림 |
| M2 지우기 `if (busy) return` 지움 | 잡힘 — 3차 조건 2 풀림 |
| M3 지운 뒤 `openRef` 만(옛 글) | 잡힘("폼이 열린 채 위 줄의 지우기…") — 3차 조건 1 테스트 |
| M4 지운 뒤 포커스 아예 안 옮김 | 잡힘(3개) |
| M5 ★ 실패 뒤 `followStar()` 지움 | 잡힘(다만 위 경쟁은 jsdom 이 못 본다) |
| M6 ★ 실패 알림 글 지움 | 잡힘 |
| M7 "입력 닫기" `!busy &&` 지움 | 살아남음 — 참고(3차 R1f 와 같음) |
| M8 지우기 aria-disabled 지움 | 잡힘(이번에 새로 잡힘) |
| M9 저장 aria-disabled 지움 | 잡힘 |
| M10 폼 Esc 전파 막기 지움 | 잡힘(3개) |

- 돌린 뒤 worktree `git status --short` 출력 없음.

## 화면 — 폰 300~414 · PC 900~1400 × 다크 · 라이트

- 데이터: 근원 PCE 2026-10 3.1 · 2026-11 2.9, CPI 2026-10(실제와 같은 값) · 2026-11 2.8. 예상 줄 둘에 모두 "지우기"가 붙고 **입력 폼까지 연** 가장 긴 상태에서 근원 PCE · CPI 창을 쟀다(`scratchpad/r5d/lay.txt`, locale ko-KR).

| 폭 | 판정 | 측정 |
|---|---|---|
| 300 · 320 · 340 · 360 · 375 · 390 · 414 (두 테마) | 통과 | 페이지 넘침 0, 창 넘침 0, 잘림 0, 숫자 갈라짐 0. 폼 칸이 창 밖으로 나간 것 0. 터치 44 미만 0("지우기" 44×44). 예상 줄 줄 수: 300~340 은 3/3, 360~390 은 근원 PCE 3/2 · CPI 2/2, 414 는 2/2. 3차와 같다 |
| 900 · 950 · 1000 · 1050 · 1099 · 1100 · 1150 · 1200 · 1280 · 1350 · 1400 (두 테마) | 통과 | 넘침 0, 잘림 0, 예상 줄 모두 1줄, "지우기" 34×20 |

- 집계: `BAD 0`(36 화면 × 2 창).
- 범위 밖 참고: 폰 300~320 에서 달 칸(`type=month`)의 브라우저 기본 글이 "November 20…"으로 칸 안에서 잘려 보인다(`shots/lay-light-300-pce-form.png`).
  - 이 헤드리스 Chromium 은 ko-KR 을 줘도 영어로 그린다. 그래서 실제 폰(한국어 "2026년 11월")에서는 다를 수 있다.
  - 이번 커밋이 바꾼 곳은 아니다.

## audit 397 조합

- 실행: `node docs/design/audit.mjs --out scratchpad/r5d/audit --base http://127.0.0.1:18881`
  - 결과: `화면×조건 397개, 열지 못한 것 0개`
  - 첫 실행은 도구 시간 제한(10분)에 걸려 343번째에서 끊겼다. 제한을 늘려 처음부터 다시 돌렸다.
- 합계
  - page-overflow 0 · clipped 0 · orphan 25 · num-split 19
  - folded3 0 · **folded2-360 48** · touch 0 · contrast 0 · console 0
- `diff r5c/audit/summary.md r5d/audit/summary.md` 의 차이는 한 줄뿐이다: `macro | ph390-text130-dark` folded2-360 5 → 6.
  - 더해진 항목은 근원 PCE 줄의 `small` "예상 3.10%, 예상보다 0.07%p 낮음"이다. 데이터 차이(내가 넣은 근원 PCE 예상) 때문이다.
  - 확인: 근원 PCE 예상 둘을 API 로 지우고 `--only macro` 로 다시 돌렸다(`scratchpad/r5d/audit-macro2`). macro 10 조합의 줄이 r5c 와 똑같다(`MACRO-ROWS-SAME`). 예상 하나(2026-11)만 남겨도 6 이다(`audit-macro`, "2026-11 예상 2.90%(발표 전)").
  - 이 커밋은 줄 글이나 줄 CSS 를 바꾸지 않았다. 예상치가 있는 줄이 text130 · 390 에서 두 줄로 접히는 것은 전부터 그랬던 것이다.
- **회귀(기준선 0 → 1 이상): 없음.** folded2-360 은 status ② 에 알릴 목록에 이미 있다. 예상치가 있는 매크로 줄도 그 목록에 하나 더 적어 두면 좋다.

## 참고 (조건 아님)

- ★ 저장 실패의 까닭(`.error-text`)은 폰에서 여전히 화면 위 밖에 있다. 3차 참고와 같다. 별은 꺼지고 `sr-only` 알림만 나온다.
  - 위 조건을 고칠 때 실패 알림을 눈에 보이게 별 근처에 두면(또는 `sr-only` 를 풀면) 같이 풀린다.
- "입력 닫기" busy 가드(M7)는 여전히 테스트로 지키지 않는다.

## 정리

- 띄운 서버는 `kill $(cat scratchpad/r5d/server.pid)` 로 껐다.
- worktree 는 `git worktree remove --force scratchpad/r5d/wt` 로 지웠다(node_modules 복사본 때문에 --force).
- 돌연변이 10개는 각각 원래 파일 글로 되돌렸다.
- 지우기 직전 worktree 의 `git status`:

```
Not currently on any branch.
nothing to commit, working tree clean
```

- 주 작업 트리 `git status --short` 출력 없음, HEAD bc059d5.
