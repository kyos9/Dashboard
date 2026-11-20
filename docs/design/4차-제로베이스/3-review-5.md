# 디자인 4차 묶음 3 (종목) 네 번째 재검토 판정 — 135c2ef (보완 범위 74b9066..135c2ef, 지난 판정 3-review-4.md)

# 합격

지난 판정의 조건 1과 참고 1이 모두 풀렸다.

- **조건 1**: 고친 것이 있을 때 뜨는 "저장하지 않고 닫을까요?"에서 Tab 과 Shift+Tab 이 이제 `버리고 닫기` 와 `계속 고치기` 사이를 번갈아 돈다. 네 군데(차트 팝업 → 보유 → 고치기 · 종목 안 화면 `?tab=holding` · 종목 목록의 한 번에 수정 · 홈의 한 번에 수정)를 폰 390 과 PC 1400 에서 다 봤다.
- **참고 1**: 차트 팝업에서 AI 칸을 연 채 Tab 30 번을 눌러도 밖으로 새는 것이 0 이다. Shift+Tab 도 0 이다.
- 지난 판정에서 통과한 것(A · B · C · D · F · F3 · G · H, 처음 포커스, 닫으면 연 단추)은 결과가 그대로다.
- 고친 두 줄을 하나씩 되돌리면 새 테스트가 떨어진다.
- 그 밖의 결과:
  - vitest 1105 통과 · lint 경고 20 · tsc 통과 · build 통과.
  - 기능 불변 경로(backend · api · types · AppState)의 이 범위 diff 는 비어 있다.

검토자가 한 일:

- 작업 트리는 `/home/user/Dashboard`(브랜치 `claude/design-4-zerobase`, HEAD 135c2ef)다.
- 프런트는 `npm ci` → `tsc -b` → lint → vitest → `npm run build` 순서로 돌렸다. 화면은 build 한 뒤에 봤다.
- 가짜 서버는 8186 에 띄웠다(`--reset`). 데이터는 저장소 밖, 미리 만들지 않은 `scratchpad/r3e/data` 에 뒀다. PID 로 껐고, 끈 뒤 `curl` 이 `000` 을 냈다.
- 탐침 스크립트는 `../r3d/` 것을 고쳐 썼다. 포트와 경로를 바꿨고, G · H 에 "닫을까요" Shift+Tab, q1b 에 1400 · Shift+Tab 을 더했다. q1c(details 를 연 채)는 새로 만들었다.

산출물은 모두 `/tmp/claude-0/-home-user-Dashboard/c9553d42-71a5-5379-90e1-1c42ba786c3a/scratchpad/r3e/` 아래에 있다.

| 무엇 | 경로 |
|---|---|
| 명령 출력 | `ci.log` · `tsc.log` · `lint.log` · `vitest.log` · `build.log` · `server.log` |
| 뮤테이션 | `mutA.log`(다른 팝업이면 return) · `mutB.log`(닫힌 details 거르기) |
| 팝업 Tab · Esc(A–F3) | `q1.mjs` · `q1.log` |
| 종목 목록 · 홈의 한 번에 수정(G · H, "닫을까요" 포함) | `q1g.mjs` · `q1g.log` |
| 차트 팝업 AI 칸 Tab(details 닫힘 · 열림) | `q1b.mjs` · `q1b.log` · `q1c.mjs` · `q1c.log` |

## 지난 조건별

| # | 지난 조건 · 참고 | 판정 | 증거 |
| --- | --- | --- | --- |
| 조건 1 | "닫을까요?"에서 Tab 이 한 단추에 묶임 | **통과** | 아래 표 |
| 참고 1 | 차트 팝업 AI 칸에서 Tab 이 한 번 샘 | **통과** | 아래 |

조건 1 — "닫을까요" 확인창(`q1.log` · `q1g.log`). 390 과 1400 의 결과가 같다.

| 경우 | 처음 포커스 | Tab 6 번 | Shift+Tab 6 번 | 지난(74b9066) |
|---|---|---|---|---|
| A2 차트 팝업 → 보유 → 고치기 | `TOP:계속 고치기` | `TOP 6/6 uniq 2` — `버리고 닫기 \| 계속 고치기 \| …` 가 번갈아 | `TOP 6/6 uniq 2` | `계속 고치기` 만 6 번 |
| F2 종목 안 화면 `/stocks/VOO?tab=holding` | `TOP:계속 고치기` | `TOP 6/6 uniq 2` · 번갈아 | `TOP 6/6 uniq 2` | 같음(묶임) |
| G 종목 목록 → 한 번에 수정 | `TOP:계속 고치기` | `TOP 6/6 uniq 2` · 번갈아 | `TOP 6/6 uniq 2` | 묶임 |
| H 홈 → 종목 한 번에 수정 | `TOP:계속 고치기` | `TOP 6/6 uniq 2` · 번갈아 | `TOP 6/6 uniq 2` | (지난번엔 재지 않음) |

- 확인창의 나머지 동작도 같다.
  - Esc 는 확인창만 닫는다(`["VOO 차트","VOO 수정"]`). 다시 Esc 를 누르면 다시 묻는다.
  - `버리고 닫기` 를 누르면 포커스가 연 단추(`VOO 보유 고치기` / `종목 한 번에 수정`)로 간다.
  - `계속 고치기` 를 누르면 수정창으로 돌아간다.
- 코드: `focusTrap.ts:39` 다. 포커스가 내 밖의 `[role=dialog]` 나 `[role=alertdialog]` 안에 있으면 손대지 않는다.
  - 수정창 가두기는 이 줄에서 빠진다. 그래서 확인창의 가두기만 돈다.
  - 차트 팝업 안에서는 확인창이 차트 팝업 안에 있으므로(`ref.current.contains`) 이 줄에 걸리지 않는다. 맨 안쪽 창 고르기(`:26-33`)가 확인창을 고른다.

참고 1 — 차트 팝업 AI 칸:

- `q1b.log`(details 닫힘):
  - 390 · 1400 모두 Tab `OUT 0 /30` · Shift+Tab `OUT 0 /30` 이다.
  - `SUMMARY:AI 에게 보내는 내용 보기` 를 거친 다음 칸이 첫 칸(`닫기` 쪽)으로 돈다. 지난 `TOP 29/30 OUT 1` 에서 풀렸다.
- `q1c.log`(summary 를 눌러 연 뒤, `details open true`):
  - 390 · 1400 모두 Tab · Shift+Tab `OUT 0 /30` 이다.
  - 열면 `loadContext` 가 돌아 안의 `지금 요청을 넣어 다시 보기` 단추가 사라진다(`AiPanel.tsx:393-403`). 그래서 열린 details 안의 단추가 고를 것에 드는 경우는 이 화면에서 재지 못했다. 거르기 조건(`:open` 이면 거르지 않음)으로는 맞다.
- 코드: `focusTrap.ts:20-25` 다. 닫힌 `<details>` 안은 summary 만 고를 것에 넣는다.
- 3-보완.md 의 "두 번째 재검토 참고 1" 행은 "이것만으로는 풀리지 않았다"로 바로잡혔다. 맨 끝 절에 새 처리가 적혀 있다. 지난 판정 참고 1 의 "처리 기록이 사실과 다르다"도 풀렸다.

## 뮤테이션

| 되돌린 줄 | 결과 | 되돌린 뒤 |
|---|---|---|
| `focusTrap.ts:39` (다른 팝업이면 `return`) 줄 삭제(`sed`) | `Tests 3 failed \| 45 passed (48)` (focusTrap · HoldingTab · ChartModal 세 파일, `mutA.log`) | `git checkout` 뒤 `git status --short` 빔 |
| `focusTrap.ts:24` 닫힌 details 조건을 `true` 로 | `Tests 1 failed \| 47 passed (48)` (`mutB.log`) | `git checkout` 뒤 `git status --short` 빔 |

- mutA 로 떨어진 것은 셋이다.
  - focusTrap.test "포커스가 내 밖의 다른 창 안이면 손대지 않는다"
  - HoldingTab.test "고친 것이 있을 때의 "닫을까요?" — Tab 이 두 단추 사이를 돈다"
  - ChartModal.test "팝업 위 팝업 위 "닫을까요?" — 차트 팝업 안에서도"
  - 차트 팝업 안과 밖이 둘 다 잡힌다. 지난 판정이 달라고 한 테스트 그대로다.
- mutB 로 떨어진 것은 focusTrap.test "닫힌 <details> 안의 단추는 건너뛴다" 하나다.

## 지난 통과 항목 — 그대로인지 (`q1.log` · `q1g.log`, 390 · 1400 같음)

| 경우 | 지금 | 판정 |
|---|---|---|
| A. 차트 팝업 → 보유 → 고치기 | 처음 포커스는 `TOP:VOO 보유수량` 이다. Tab 14 · Shift+Tab 14 모두 `TOP 14/14 uniq 8` 이다. Esc 를 누르면 `["VOO 차트"]` 이고 포커스는 `TOP:VOO 보유 고치기` 다. 이어서 Tab 10 번이 `TOP 10/10` 이다 | 통과(같음) |
| B. 차트 팝업 → 보유 → 삭제 | 처음 포커스는 `TOP:취소` 다. Tab 8 · Shift+Tab 8 모두 `TOP 8/8 uniq 2` 다. Esc → `TOP:VOO 삭제`, 한 번 더 → `[]` · `OUT:VOO` | 통과(같음) |
| C. 차트 팝업만 | Tab 40 번이 `TOP 40/40` 이다 | 통과(같음) |
| C. 차트 팝업 + AI | Tab 30 · Shift+Tab 30 모두 `TOP 30/30` 이다(지난 29/30) | 통과(나아짐) |
| D. 뒤로가기 하나씩 | `["VOO 차트"] -> []`, 주소는 `/?view=signal` 이다 | 통과(같음) |
| F. 종목 안 화면 → 고치기 | 처음 포커스는 `TOP:VOO 보유수량` 이다. Tab 14 · Shift+Tab 14 모두 `TOP 14/14` 다. Esc → `OUT:VOO 보유 고치기`(연 단추) | 통과(같음) |
| F3. 종목 안 화면 → 삭제 | 처음 포커스는 `TOP:취소` 다. Tab 6 번이 `TOP 6/6 uniq 2` 다. Esc → `OUT:VOO 삭제` | 통과(같음) |
| G. 종목 목록 → 한 번에 수정 | 처음 포커스는 `TOP:VOO 보유수량` 이다. Tab 30 · Shift+Tab 30 모두 `TOP 30/30 uniq 30` 이다. 버리고 닫으면 `OUT:종목 한 번에 수정` | 통과(같음) |
| H. 홈 → 종목 한 번에 수정 | 처음 포커스는 `TOP:VOO 보유수량` 이다. Tab 30 번이 `TOP 30/30` 이다. Esc → `OUT:종목 한 번에 수정` | 통과(같음) |
| 추가 시트 Tab | 이 범위에서 바뀐 것은 `focusTrap.ts` 하나다. 추가 시트도 같은 훅을 쓰고, 새 return 줄은 포커스가 시트 밖 다른 창에 있을 때만 걸린다. 시트 안에는 details 가 없다. 브라우저 탐침은 지난번 것을 다시 돌리지 않았다. vitest 의 추가 시트 테스트는 모두 통과한다(`vitest.log` 1105/1105) | 통과(코드 · 테스트) |
| 콘솔 오류 | `390 errs 0` · `1400 errs 0` (q1 · q1g · q1c) | 통과 |

- "닫을까요"에서 Esc 나 `계속 고치기` 로 돌아가면 포커스는 수량 칸이 아니라 `VOO 구분` 에 간다. 지난 `r3d/q1.log` 와 같은 값이라 이 범위의 변화가 아니다. 참고 2 에 적는다.

## 항목별 (3-1 · 6장)

| 항목 | 판정 | 증거 |
| --- | --- | --- |
| npm ci · tsc -b · build | 통과 | `ci 0` · `tsc 0` · `build 0`, `✓ built in 427ms` |
| lint | 통과 | 경고 20 (`grep -c warning lint.log`). 기준 22 · 실행자 20 과 같다 |
| vitest | 통과 | `Test Files 68 passed (68)` · `Tests 1105 passed (1105)`. 실행자 1105 와 같다. 지난 1101 에 4 개가 더해졌다(focusTrap.test 2 · HoldingTab 1 · ChartModal 1). 줄어든 테스트는 없다 |
| 백엔드 테스트 | 해당 없음 | backend diff 가 비어 있다 |
| 기능 불변 — backend · api · types · AppState | 통과 | `git diff --stat 74b9066 135c2ef -- backend frontend/src/api frontend/src/types.ts frontend/src/AppState.tsx` 가 비어 있다 |
| 기능 불변 — lib | 통과(이유 적힘) | `focusTrap.ts` 하나다(+9 −1). 3-보완.md 의 "lib 변경 이유" 표와 맨 끝 절에 적혀 있다 |
| 그 밖의 `.tsx` | 해당 없음 | 범위의 `.tsx` 변경은 테스트 셋뿐이다(ChartModal.test · HoldingTab.test · focusTrap.test). 화면 코드와 새 API 호출은 없다 |
| 글자 자르기 · 색표 밖 색 · 움직임 · 자동 검사(audit) | 해당 없음 | 범위 diff 에 CSS 와 모양 변화가 없다. 키보드 탐침으로 대신했다 |
| 키보드 | 통과 | 위 |
| 고친 깨짐마다 테스트 | 통과 | 뮤테이션 둘 다 떨어진다 |
| 문구 변경 | 해당 없음 | 문구는 바뀌지 않았다 |
| 계획 검토 걱정(plan-*.md) | 해당 없음 | 이번 범위(`focusTrap.ts`)에 새로 걸리는 항목이 없다 |

## 참고 (막지 않음)

1. `focusTrap.ts:39` 의 return 은 "포커스가 내 밖의 어느 창이든" 안이면 손을 뗀다. 그 창이 나보다 **아래**에 있어도 마찬가지다.
   - 예: 형제로 그려진 위 창이 떠 있는데, 포커스가 어떤 길로 아래 창에 가 있는 경우다. 그때는 위 창 가두기만 끌어온다. 아래 창 가두기는 끌어오지 않는다.
   - 위 창 가두기가 `!inside` 일 때 끌어오므로(`:40-`) 결과는 맞다. 다만 위 창에 가두기가 없는 팝업이면 갇히지 않는다.
   - 지금 앱에서 겹쳐 뜨는 창(수정창 + 닫을까요, 차트 + 수정/삭제)은 모두 가두기가 있어 문제가 되지 않았다. 새 팝업을 더할 때 가두기를 꼭 다는 것을 규칙으로 남기면 좋다.
2. "닫을까요"에서 Esc 나 `계속 고치기` 로 돌아오면 포커스가 고치던 칸이 아니라 `VOO 구분` 에 간다(A2 · F2, 390 · 1400). 74b9066 때도 같았다. 회귀가 아니므로 ③ 보고 목록감이다.
3. 지난 판정 참고 2(ConfirmDialog 가 `busy` 이면 고를 것이 0 이라 Tab 을 막지 않음)는 그대로다. 짧은 동안이고 회귀는 아니다.
4. 열린 details 안에 단추가 남는 경우(맥락을 못 불러와 `지금 요청을 넣어 다시 보기` 가 보이는 상태)는 화면에서 만들지 못했다. 코드상으로는 `details[open]` 이면 거르지 않으므로 고를 것에 든다.

## 검토자 작업 트리

```
$ git status   (/home/user/Dashboard, HEAD 135c2ef — 판정문 쓰기 직전)
On branch claude/design-4-zerobase
Your branch is up to date with 'origin/claude/design-4-zerobase'.

nothing to commit, working tree clean
```

- 판정문을 쓴 뒤에는 이 파일(`docs/design/4차-제로베이스/3-review-5.md`) 하나만 추적되지 않은 파일로 남는다. 커밋하지 않았다.
- 저장소 파일은 고치지 않았다. `frontend/node_modules` · `dist` 는 git 이 무시한다.
- 뮤테이션 둘은 하나마다 `git checkout src/lib/focusTrap.ts` 로 되돌렸다. 되돌린 뒤 `git status --short` 가 빈 것을 확인했다.
- 가짜 서버(8186)는 PID(`r3e/server.pid`)로 껐다.
