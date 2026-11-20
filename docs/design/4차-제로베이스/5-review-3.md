# 디자인 4차 묶음 5 매크로 — 세 번째 검토 (c5a264f)

## 판정: 조건부 합격

- 검토 범위: `389e254..c5a264f`, 한 커밋.
  - 바뀐 코드: ForecastBox.tsx +6/−3 · period.ts +2/−1 · MacroPanel.tsx +4/−1 · macro-list.css +4
  - 테스트: MacroPanel.test.tsx +79, 지운 줄 0
- 따로 만든 worktree(`git worktree add --detach scratchpad/r5c/wt c5a264f`)에서 띄우고 다시 쟀다.
- `frontend` 에서 `npm run build` 를 먼저 했다.
  - 결과: `✓ built in 459ms`, `index-rJvPPwUf.js`
  - 서버가 내준 첫 화면도 `index-rJvPPwUf.js` 를 가리킨다.
- 가짜 서버
  - 포트 18871, `--data-dir scratchpad/r5c/data --reset`
  - 저장소 밖 새 폴더를 썼다.
- 주 작업 트리, 8765, backend/.devdata 는 건드리지 않았다.

재검토 조건 셋은 처음 재현한 경로로는 모두 풀렸다. 참고 셋도 화면에서 확인했다.

남은 조건은 둘이다.
- 하나는 조건 1 과 같은 결함이다. 폼이 열린 상태에서 "지우기"를 누르는 경로에 남아 있다.
- 다른 하나는 테스트다. 이번 커밋이 `disabled` 를 `aria-disabled` 로 바꾸면서 "두 번 저장 막기"는 이제 JS 가드 한 줄만 맡는다. 그런데 그 가드를 지켜 주는 테스트가 없다.

### 조건 (둘 — 고친 뒤 다시 잰다)

1. **[고쳐야 함] 입력 폼이 열린 채 위 줄의 "지우기"를 누르면 포커스가 `body` 로 떨어진다. 이어서 Esc 를 누르면 창째 닫혀 친 값이 사라진다.**
   - 재현: 근원 PCE 창에서 2026-10 예상을 넣는다. "예상치 입력"을 다시 눌러 폼을 열고 예상 칸에 2.8 을 친다. 그 상태에서 `2026-10 예상 지우기` 를 누른다.
     - 키보드 Enter: `after 지우기 (form open): focus OUT BODY | form 1 | typed 2.8` → Esc → `dialogs 0`
     - 마우스 클릭: 같다. `OUT BODY` → Esc → `dialogs 0`
     - 폰 320 탭: 같다. `OUT BODY` → Esc → `dialogs 0`
   - 까닭: `ForecastBox.tsx:82` `openRef.current?.focus()`
     - 폼이 열려 있으면 "예상치 입력" 단추가 그려지지 않는다(`:115` `open ? <form> : <button ref={openRef}>`). 그래서 `openRef.current` 가 null 이다.
     - 지운 줄의 단추가 사라지면서 포커스가 body 로 간다.
     - 그 상태의 Esc 는 폼의 `onFormKey` 가 아니라 창 닫기가 받는다. 5-review-2 조건 1 과 같은 결과다.
   - 이 경로는 흔하다. 폼을 열면 달 칸이 그 달 예상으로 미리 채워진다. 이때 "이건 넣지 말고 지난달 걸 지우자"로 넘어가기 쉽다.
   - 고칠 방향(하나): `(openRef.current ?? monthRef.current)?.focus()`. 폼이 열려 있으면 달 칸으로 보낸다. 이 경로의 테스트도 하나 넣는다. 지금은 폼을 연 채 지우는 테스트가 없다.
2. **[고쳐야 함 — 테스트] busy 동안 두 번 눌러도 한 번만 저장 · 지우기 되는 것을 지키는 테스트가 없다.**
   - 이번 커밋 전에는 `disabled={!canSave || busy}` 가 브라우저 단에서 두 번째 누름을 막았다. 지금은 `aria-disabled` 라 눌린다. 막는 것은 `submit` 의 `if (!canSave || busy) return`(`:65`)과 `remove` 의 `if (busy) return`(`:77`)뿐이다.
   - 돌연변이로 이 가드를 지워도 79개(매크로 묶음) 테스트가 모두 통과한다.
     - R1d(`|| busy` 지움): 실제 브라우저에서는 두 번 저장된다.
     - R1e(`if (busy) return` 지움): 같다.
   - 실제 화면은 지금 맞다(아래 C1 busy). 다만 지켜 주는 것이 없다.
   - 고칠 것
     - 기존 "저장하는 동안 단추는 잠긴 것으로 읽히되…" 테스트에서 `finish()` 앞에 저장을 한 번 더 누른다. 그리고 `expect(api.setMacroForecast).toHaveBeenCalledTimes(1)` 을 본다.
     - 지우기에도 같은 것 하나를 넣는다.

## 재검토(5-review-2) 조건 셋 — 실제 브라우저

| # | 조건 | 판정 | 증거 (scratchpad/r5c/flow.txt) |
|---|---|---|---|
| 1-a | 키보드로 저장 실패 → 포커스가 body 아님 | 통과 | PC 1280 다크, 키보드만. 줄에서 Enter → "예상치 입력" Enter(`IN 근원 PCE 예상치가 가리키는 달`) → 달 2035-01 · 예상 2.5 → Tab(`IN 저장`) → Enter → `after keyboard 저장 fail, focus: IN 저장 err in dialog 1 focus-visible true` |
| 1-b | 실패 뒤 Esc 는 폼만 | 통과 | `after Esc: dialogs 1 form 0 focus IN 예상치 입력` → 다시 Esc → `dialogs 0 focus … 근원 PCE … — 차트`(연 줄). 마우스 "저장" 실패도 `IN 저장` → Esc `dialogs 1 form 0`. 숫자 칸 Enter 실패는 `IN 근원 PCE 예상치`. 실패 뒤 "입력 닫기" → `form 0 focus IN 예상치 입력` |
| 1-c | "지우기" 뒤 포커스 → "예상치 입력" | 통과(폼이 닫혀 있을 때) / **폼이 열려 있으면 조건 1** | 키보드 `2026-10 예상 지우기` Enter → `focus after 지우기 IN 예상치 입력` → Tab `IN 1년` → Shift+Tab `IN 예상치 입력`. 마지막 하나를 마우스로 지워도 `IN 예상치 입력` |
| 1-d | busy 동안 aria-disabled, 두 번 눌러도 한 번 | 통과(화면) / **테스트는 조건 2** | PUT/DELETE 를 1.5초 늦춤(`page.route`). 저장 중 `{"aria":"true","disabled":false}`, 포커스 `IN 저장`. 이어서 강제 클릭 2번 + Enter + Space + 숫자 칸 Enter + "입력 닫기" 클릭 → 폼 그대로(`form still open? 1`), `POSTs during busy: 1 [PUT /api/macro/PCEPILFE/forecast]`. 진짜 dblclick 도 `1`. 지우기: 누른 단추 `aria-disabled true`, 옆 줄 지우기도 `true`. Enter 2번 + 옆 줄 클릭 → `DELETEs: 1` |
| 2 | 화면 값 그대로 넣으면 "예상과 같음" (반올림 경계) | 통과 | CPI 실제 `2.6498840675720503`(2026-10). 아래 표 |
| 3 | 지인 · 손님 창에 "지우기" 없음(+ 테스트) | 통과 | CPI 2026-10(발표 뒤) · 2026-11 2.8(발표 전)을 넣은 뒤 폰 320 라이트. friend · pending · guest 모두 `지우기 0 · 입력 0 · errs 0`. 창: `2026-10 예상 2.65%예상과 같음 (관리자가 넣음) | 2026-11 예상 2.80% (아직 발표 전, 관리자가 넣음)`. 돌연변이 N7 이 이제 잡힌다 |

### 조건 2 경계 (CPI, 관리자, PC 1280 라이트 — 창과 줄 둘 다)

| 넣은 값 | 서버 surprise | 창 / 줄 |
|---|---|---|
| 2.65 (화면 값) | −0.000116 | `예상 2.65%예상과 같음` / 줄 `예상 2.65%, 예상과 같음` |
| 실제+0.004 | −0.004 | 예상과 같음 |
| 실제−0.004 | 0.004 | 예상과 같음 |
| 실제+0.0049 | −0.0049 | 예상과 같음 |
| 실제(정확히) | 0 | 예상과 같음 |
| 실제+0.006 | −0.006 | `예상 2.66%예상보다 0.01%p 낮음`(예상 값도 2.66 으로 달라 보임 — 맞음) |
| 실제−0.006 | 0.006 | `예상 2.64%예상보다 0.01%p 높음` — 맞음 |

- "0.00%p" 는 어느 경우에도 나오지 않았다.
- 남는 틈: 실제 값이 정확히 반올림 반점(예: 2.645)일 때다.
  - `(0.005).toFixed(2)` 가 `"0.01"` 이다. 그래서 화면 값을 그대로 넣어도 "0.01%p"가 나올 수 있다.
  - 서버 값은 소수 여러 자리라 실제로는 거의 생기지 않는다. 참고로만 둔다.

## 참고 셋 (5-review-2 참고 → 이번 보완)

| 항목 | 판정 | 증거 (scratchpad/r5c/refs.txt) |
|---|---|---|
| "(관리자가 넣음) 지우기" 띄움 | 통과 | PC 1280: 두 줄 모두 `gap 8, marginLeft 8px, 34x20`(`shots/remove-gap-1280.png`, "(관리자가 넣음)  지우기"). 폰 320 은 44×44 그대로. 다만 340 다크 근원 PCE 발표 전 줄이 2 → 3줄이 됐다(8px 때문에 "지우기"가 다음 줄로). 넘침 · 잘림은 없다 |
| ★ 저장 실패 알림 | 통과(참고 하나) | PUT `/api/macro/pinned` 를 500 으로 만듦. `role=status` 가 `"CPI 을(를) 옮기지 못했습니다"`. 별은 되돌아감(`aria-pressed false`). **다만** 폰 320×568 에서 `.error-text` 는 `top −117`(화면 위 밖), 포커스는 `BODY`. 눈으로 보는 사람에게는 별이 말없이 돌아간다. 이 포커스 잃음은 5-review-2 참고 셋째 줄 뒷부분으로 그대로 남아 있다 |
| 움직임 줄이기 → 부드러운 스크롤 끔 | 통과 | `scrollIntoView` 인자를 가로챔. `reducedMotion: 'reduce'` → `{"block":"center","behavior":"auto"}`, `no-preference` → `"smooth"` |

## 기능 불변 · 품질

| 항목 | 판정 | 증거 |
|---|---|---|
| backend · api · lib · types · AppState diff 0 | 통과 | `git diff --stat 0a46c15 c5a264f -- backend frontend/src/api frontend/src/lib frontend/src/types.ts frontend/src/AppState.tsx docs/design/audit.mjs` 빈 출력. `389e254..c5a264f` 도 빈 출력 |
| 그 밖의 .tsx 한 줄씩 | 통과 | ForecastBox: 저장 `disabled={!canSave} aria-disabled={busy}` · 입력 닫기 `!busy &&` + aria-disabled · 지우기 aria-disabled · 지운 뒤 `openRef` 포커스. period.ts: 같음 판정만(글, 계산은 `macroChange` 그대로). MacroPanel: reduced-motion 분기 · 실패 알림 한 줄. 서버 요청 · 권한 변화 없음 |
| 테스트 수 | 통과 | `npx vitest run` → `Test Files 68 passed (68)`, `Tests 1158 passed (1158)`(1152 → 1158, +6). 지운 줄 0(`79 0 MacroPanel.test.tsx`). 고친 테스트는 없다 |
| 새 테스트가 돌연변이를 잡나 | 조건 2 빼고 통과 | 아래 표 |
| 린트 | 통과 | `npm run lint` 경고 줄 20 |
| tsc · build | 통과 | `npx tsc -b` exit 0, 출력 없음. build `✓ built in 459ms` |
| CSS 300줄 이하 | 통과 | 바뀐 CSS `macro-list.css` 176줄 |
| tokens.css 밖 색 | 통과 | `src/styles`(tokens.css 빼고) `#hex · rgb( · hsl(` 0, `.tsx`(테스트 빼고) 0 |
| 콘솔 오류 | 통과 | 폭 측정 36 화면 `errs 0`. 흐름의 400 셋은 일부러 낸 "너무 먼 미래" 저장 실패다 |

### 돌연변이 (각각 `MacroPanel.test.tsx` + `src/components/Macro*` + `src/components/macro`, 79개. 끝나면 원래 글로 되돌림)

| 돌연변이 | 결과 |
|---|---|
| R1a 저장을 `disabled={!canSave \|\| busy}` 로 되돌림 | 잡힘("저장하는 동안 … disabled 는 아니다") |
| R1b disabled + aria 둘 다 | 잡힘 |
| R1c 지운 뒤 `openRef` 포커스 지움 | 잡힘("지우면 포커스가 예상치 입력으로") |
| **R1d 저장 busy 가드 지움(두 번 저장)** | **살아남음 — 조건 2** |
| **R1e 지우기 busy 가드 지움** | **살아남음 — 조건 2** |
| R1f "입력 닫기" `!busy &&` 지움 | 살아남음 — 참고 |
| R1g 지우기 aria-disabled 지움 · R1h 지우기 `disabled={busy}` 로 되돌림 | 살아남음 — 참고(지운 뒤 포커스를 옮기므로 보이는 차이가 작다) |
| R2a 같음 판정을 `surprise === 0` 으로 되돌림 · R2b "예상과 같음" 글 바꿈(옛 N4) · R2c 같음 판정 지움 | 모두 잡힘 |
| N7 지우기 `editable &&` 지움 | 잡힘(이번 커밋으로 풀림) |
| N9 예상 없음 글을 관리자에게도 | 잡힘(이번 커밋으로 풀림) |
| N12 폼 Esc 전파 막기 지움 | 잡힘(2개) |
| N3 높음/낮음 뒤바꿈 | 잡힘(3개) |
| P1 ★ 실패 알림 지움 · P2 reduced-motion 무시 | 살아남음 — 참고(참고 항목이라 테스트를 요구하지 않았다) |

## 화면 — 폰 300~414 · PC 900~1400 × 다크 · 라이트

- 데이터: 관리자로 근원 PCE 2026-10 3.1 · 2026-11 2.9 를 넣었다. CPI 는 2026-10(예상과 같음) · 2026-11 2.8 이다.
- 근원 PCE · CPI 창을 쟀다. 예상 줄 둘에 모두 "지우기"가 붙은, 가장 긴 상태다(`scratchpad/r5c/lay.txt`).

| 폭 | 판정 | 측정 |
|---|---|---|
| 300 · 320 · 340 · 360 · 375 · 390 · 414 (두 테마) | 통과 | 페이지 넘침 0, 창 넘침 0, 잘림 0, 숫자 갈라짐 0. 줄 오른쪽 끝 = 창 −16px(284/300 … 398/414). "지우기" 44×44. 5-review-2 와 다른 곳은 340 근원 PCE 발표 전 줄 하나뿐이다(2 → 3줄, 8px 띄움). 넘침은 없다 |
| 900 · 950 · 1000 · 1050 · 1099 · 1100 · 1150 · 1200 · 1280 · 1350 · 1400 (두 테마) | 통과 | 넘침 0, 잘림 0, 예상 줄 모두 1줄, "지우기" 34×20, 앞 띄움 8px |

## audit 397 조합

- 실행: `node docs/design/audit.mjs --out scratchpad/r5c/audit --base http://127.0.0.1:18871`
  - 결과: `화면×조건 397개, 열지 못한 것 0개`
- 합계
  - page-overflow 0 · clipped 0 · orphan 25 · num-split 19
  - folded3 0 · folded2-360 47 · touch 0 · contrast 0 · console 0
  - fake-button 0 · text-overlap 0 · focus-ring 0 · 나머지 0
- `diff r5b/audit/summary.md r5c/audit/summary.md` → 출력 없음. r5a(첫 검토)와도 같다.
- **회귀(기준선 0 → 1 이상): 이번 커밋에서 새로 생긴 것 없음.** folded2-360 47 은 status ② 에 알릴 목록에 이미 있다.

## 참고 (조건 아님)

- **저장 중임이 눈에 보이지 않는다.**
  - `disabled` 를 뺀 탓에 저장 · 입력 닫기 · 지우기는 busy 동안 `opacity 1`, `cursor pointer` 그대로다.
  - 전에는 `button:disabled { opacity: .5 }`(`symbol-search.css:214`)로 흐려졌다.
  - 느린 폰 망에서는 눌렀는지 알 수 없다. 같은 저장소의 `.chart-step[aria-disabled='true']`(`overrides.css:36`)처럼 규칙 하나면 된다.
- ★ 저장 실패: 폰에서는 까닭(`.error-text`)이 화면 위 밖에 있고 포커스가 body 로 떨어진다. 읽기 알림은 맞게 나온다.
- 반올림 반점(실제가 정확히 x.xx5)에서는 화면 값 그대로 넣어도 "0.01%p"가 나올 수 있다. 실제로는 거의 생기지 않는다.
- "입력 닫기" busy 가드(R1f)와 지우기 aria-disabled(R1g/h)는 테스트로 지키지 않는다.

## 정리

- 띄운 서버는 `kill $(cat scratchpad/r5c/server.pid)` 로 껐다. 18871 응답 `000`, 프로세스 없음. 8765(pid 3402)는 그대로다.
- worktree 는 `git worktree remove --force scratchpad/r5c/wt` 로 지웠다(node_modules 복사본 때문에 --force).
- 돌연변이 17개는 각각 원래 파일 글로 되돌렸다.
- 지우기 직전 worktree 의 `git status`:

```
Not currently on any branch.
nothing to commit, working tree clean
```

- 주 작업 트리 `git status --short` 출력 없음, HEAD c5a264f.
