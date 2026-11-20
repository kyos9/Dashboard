# 디자인 4차 묶음 5 매크로 — 다섯 번째 검토 (96ab372)

## 판정: 합격

- 검토 범위: `bc059d5..96ab372`, 한 커밋.
  - 바뀐 코드: `frontend/src/pages/MacroPanel.tsx` +14/−12 뿐이다(나머지는 5-review-4.md · status.md).
  - 테스트 파일 변경 0.
- 따로 만든 worktree(`git worktree add --detach scratchpad/r5e/wt 96ab372`)에서 띄우고 쟀다.
- `frontend` 에서 `npm run build` 를 먼저 했다.
  - 결과: `✓ built in 582ms`, `index-Cphh1gEY.js`
  - 서버가 내준 첫 화면도 `index-Cphh1gEY.js` 를 가리킨다.
- 가짜 서버
  - 포트 18891, `--data-dir scratchpad/r5e/data --reset`(저장소 밖 새 폴더)
  - audit 전에는 같은 명령으로 `--reset` 해서 데이터를 처음 상태로 돌렸다.
- 주 작업 트리, 8765, backend/.devdata 는 건드리지 않았다.

네 번째 검토의 조건 1(★ 저장이 실패한 뒤 포커스가 경쟁 상태로 `body` 에 떨어짐)은 풀렸다. 앞 판정과 같은 방법(폰 320, CPU 4~10배 느림, 실패 응답을 늦게/빨리, 여러 번)으로 다시 쟀다. 앱 쪽 실패는 0이다.

새로 생긴 막힘이나 회귀는 없다. 아래 참고 셋은 조건이 아니다.

## 1. 네 번째 검토 조건 1 — ★ 저장 실패 뒤 포커스 · 화면

- 바뀐 방식은 `MacroPanel.tsx:209~219` 다.
  - 포커스할 별을 `follow` 상태(`{code, n}`)로 두고, `useLayoutEffect(…, [follow])` 에서 포커스와 `scrollIntoView` 를 한다.
  - `togglePin` 은 낙관적으로 그릴 때(`:268`)와 `catch` 의 되돌림(`:279`) 때 `setFollow` 를 부른다.
  - 되돌림 `setData` 와 `setFollow` 는 같은 일괄 처리에 들어간다. 그래서 효과는 되돌림이 DOM 에 반영된 바로 그 커밋 뒤에 돈다.
  - 앞 판정이 말한 원인(rAF 가 스케줄러 작업보다 먼저 돎)은 구조적으로 없어졌다.
- 측정 방법(`scratchpad/r5e/work/pin.mjs`, `pin-sw.mjs`)
  - 실제 Chromium 에서 `HTMLElement.prototype.focus` 를 가로채 `[data-pin]` 별에 준 포커스를 모두 적었다. `{그때 aria-pressed / 지금 DOM 에 있나}` 형태다.
  - `scrollIntoView` 도 가로채 `behavior` 를 적었다.
  - CPU 느리게 하기는 CDP `Emulation.setCPUThrottlingRate` 를 썼다.
  - 실패는 `page.route` 로 PUT `/api/macro/pinned` 에 500 을 돌려줬다. 늦추는 시간은 0 · 30 · 200 · 600 · 1500ms 로 바꿔 가며 했다.

### 실패 경로

| 조건 | 결과 | 증거 |
|---|---|---|
| 폰 320×568 라이트, 움직임 줄이기, CPU 1배, 600ms, 켜기→실패 | 통과 6/6 | `fail.txt`: `focus":"CPI 내 지표로 pin=CPIAUCSL pressed=false list=macro-all","inView":true … "f":"true/GONE,false/conn"` |
| 같은 조건, CPU 4배 · 6배 · 10배, 600ms | 통과 5/5 · 5/5 · 5/5 | 같은 형태. 두 번째(실패 뒤) 포커스는 늘 **pressed=false, conn**(되돌아간 새 별)에 갔다. 앞 판정의 `false/GONE`(사라질 옛 별) 패턴은 0번이다 |
| CPU 6배 · 10배, 0ms(곧바로 실패) | 통과 5/5 · 8/8 + 6배 5/5 | `fail-sw-block2.txt`: 13/13 `routeHits=1 put=500`, `f":"true/GONE,false/conn"`, inView true |
| CPU 6배, 30ms, 끄기→실패 | 통과 4/4 | `pressed=true list=macro-mine`(되돌아간 "내 지표" 쪽 별) |
| 폰 320 다크, 움직임 보통, CPU 6배, 1500ms | 통과 4/4 | `"s":"smooth,smooth"` |
| 폰 320×640 다크, 움직임 줄이기, CPU 10배, 200ms, 미 실업률 | 통과 4/4 | |
| PC 1280 다크, 키보드 Enter, CPU 6배, 600ms | 통과 3/3 | |
| CPU 10배, 0ms · 600ms, 끄기→실패(SW 막음) | 통과 8/8 · 4/4 | `fail-sw-block.txt`: `put=500`, `false/GONE,true/conn` |

- 합계: 실패 경로 **75회 중 앱 쪽 실패 0회**(`fail.txt` 42 + `fail-sw-allow.txt` 5 + `fail-sw-block.txt` 12 + `fail-sw-block2.txt` 13 = 72 통과).
  - 남은 3회는 측정 도구 문제로 판단했다. 아래 "덧붙임"에 적었다.
- 덧붙임 — 첫 묶음(`fail.txt`)에서 "BAD" 3회가 나왔다(CPU 10배, 0ms). 측정 도구 문제로 판단한다.
  - 세 회 모두 상태 글이 `"옮겼습니다"/"뺐습니다"` 다. 포커스 호출은 1번뿐이고, 다음 회 시작 때 서버의 별 상태가 실제로 바뀌어 있었다. 즉 500 이 앱에 가지 않고 PUT 이 서버로 통과했다.
  - 그 회의 앱 동작은 오히려 **성공 경로로서 맞았다**. 포커스가 옮긴 자리의 별로 갔고(`pressed=true list=macro-mine`), inView true 였다.
  - 그 시간에 성공 측정(`ok.txt`)을 다른 브라우저로 함께 돌리고 있었고, 서비스 워커도 켜 두었다.
  - 그래서 측정을 다시 했다. 서비스 워커를 막고(`serviceWorkers:'block'`) 라우트 적중 수와 PUT 응답 코드를 같이 적었다. 서비스 워커를 켠 채 다시 돌리기도 했다. 모두 통과했다(`routeHits=1 put=500`): 25/25, 서비스 워커 켠 채 5/5.

### 성공 경로(켜기 · 끄기)

| 조건 | 결과 | 증거(`ok.txt`) |
|---|---|---|
| 폰 320 라이트, 움직임 줄이기, CPU 1 · 6배, 300ms, 켜기(미 기준금리) | 통과 3/3 · 3/3 | `focus":"미 기준금리 내 지표로 pin=DFF pressed=true list=macro-mine","inView":true … "f":"true/conn","s":"auto"` |
| 폰 320, CPU 6 · 10배, 끄기(VIX) | 통과 3/3 · 2/2 | `pressed=false list=macro-all`, inView true |
| 폰 320 다크, 움직임 보통, CPU 4배, 켜기 | 통과 2/2 | `"s":"smooth"` |
| PC 1280 키보드 Enter, 켜기 · 끄기(움직임 보통 · 줄이기) | 통과 2/2 · 2/2 | |

- 합계: 17/17 통과. 성공 때 포커스 호출은 정확히 1번이다.

### 움직임 줄이기

- 통과.
- 실패 · 성공 측정 전부에서 `reducedMotion:'reduce'` 이면 `scrollIntoView` 의 behavior 가 `auto` 였다(실패 35회 `"auto,auto"`, 성공 `"auto"`).
- `no-preference` 이면 `smooth` 였다(실패 7회 `"smooth,smooth"`, 성공 4회).

## 2. useLayoutEffect 가 다른 렌더에서 포커스를 빼앗지 않나

- 코드 읽기
  - 의존성이 `[follow]` 뿐이다. `follow` 는 `togglePin` 안의 `setFollow` 로만 바뀐다(`:268 · :279`).
  - 다시 읽기(`useCachedLoad` → `setData`), `load()`, 오류 · 알림 상태 변화는 `follow` 를 바꾸지 않는다. 그래서 효과가 다시 돌지 않는다.
  - 탭을 옮기면 컴포넌트가 다시 마운트되고 `follow` 는 `null` 이 된다. 이때 효과는 `if (!follow) return` 에서 끝난다.
- 실측(`scratchpad/r5e/work/steal.mjs`)
  - 세 조건에서 쟀다: PC 1280 다크 CPU 1배, 폰 320×568 라이트 CPU 6배, 폰 320×640 다크 CPU 1배. 셋 모두 움직임 줄이기다.
  - 각 상황마다 별에 간 포커스 호출 수(f), 포커스 자리, scrollY 를 다시 읽기 앞뒤로 비교했다.
  - 다시 읽기가 실제로 일어났는지는 GET `/api/macro` 응답 수로 확인했다.

| # | 상황 | PC 1280 | 폰 320 (CPU 6배) | 폰 320×640 |
|---|---|---|---|---|
| 1 | ★ 켜기 성공 → 다른 칸(첫 줄 차트 단추)으로 옮기고 맨 위로 → 저장 뒤 다시 읽기(GET 2.5초 늦춤)가 옴 | 통과 | 통과 | 통과 |
| 2 | 관리자 "지금 받아오기" → `load()` (그 사이 다른 칸) | 통과 | 통과 | 통과 |
| 3 | 머리줄 "전체 새로고침"(refreshKey) | 통과 | 통과 | 통과 |
| 4 | 앱으로 돌아옴(오래됨 → visibilitychange → refreshKey) | 통과 | 통과 | 통과 |
| 5 | ★ 실패 → 되돌아간 별로 간 뒤 다른 칸 → 전체 새로고침 | 통과 | 통과 | 통과 |
| 6 | 차트 창에서 예상치 저장 → `load()` | 통과(포커스 창 안 "예상치 입력") | 통과 | 통과 |
| 7 | 홈 탭 → 매크로 탭 다시 | 통과(포커스 "매크로" 탭, 별 호출 증가 0) | 통과 | 통과 |
| 8 | 새로고침(F5) | 통과(BODY, 별 호출 0) | 통과 | 통과 |

- 1~5의 출력은 모두 같은 형태다.
  - 예: `before {"y":0,"a":"VIX, 변동성 지수 …— 차트","f":1} after {"y":0,"a":"VIX, 변동성 지수 …— 차트","f":1} GET+1`
  - 포커스 자리, scrollY, 별 포커스 호출 수가 모두 그대로다. 그러면서 GET 은 1 이상 늘었다.
- 콘솔 오류는 일부러 만든 500 의 "Failed to load resource" 한 줄뿐이다. pageerror 는 0 이다.

## 3. 기능 불변 · 품질

| 항목 | 판정 | 증거 |
|---|---|---|
| backend · api · lib · types · AppState diff 0 | 통과 | `git diff --stat 0a46c15 96ab372 -- backend frontend/src/api frontend/src/lib frontend/src/types.ts frontend/src/AppState.tsx docs/design/audit.mjs` 빈 출력 |
| 그 밖의 .tsx 한 줄씩 | 통과 | `MacroPanel.tsx` 만 바뀌었다. `useLayoutEffect` import · `follow` 상태 · 효과(`:209~219`). `followStar()` rAF 두 곳은 `setFollow(...)` 로 바꿨다(`:268 · :279`). 서버 요청 · 권한 · 계산 · 낙관 갱신 · 되돌림 순서는 같다 |
| 테스트 | 통과 | `npx vitest run` → `Test Files 68 passed (68)`, `Tests 1161 passed (1161)`. 테스트 파일 변경 0 |
| 린트 | 통과 | `npm run lint` 경고 줄 20(`grep -c warning` → 20). MacroPanel 경고 0 |
| tsc · build | 통과 | `npx tsc -b` exit 0, 출력 없음. build `✓ built in 582ms` |
| CSS · 색 | 해당 없음 | CSS 변경 없음. 바뀐 .tsx 에 색 글자 없음 |

### 돌연변이 (`MacroPanel.test.tsx` + `src/components/Macro*` + `src/components/macro`, 82개. 각각 `mp.bak` 로 되돌림, `cmp` 같음 확인)

| 돌연변이 | 결과 |
|---|---|
| Ma `catch` 의 `setFollow` 지움 | 잡힘("★ 저장이 실패하면 되돌아간 자리의 별로 포커스…") |
| Mb 처음 `setFollow` 지움 | 잡힘(2개) |
| Mc 효과 의존성 `[follow]` 지움(렌더마다 별로 포커스를 빼앗음) | **살아남음 — 참고 1** |
| Md 효과 안에서 다시 rAF 로(옛 경쟁) | 살아남음 — jsdom 이 프레임 순서를 못 본다(앞 판정과 같은 한계). 실브라우저 측정으로 대신 확인했다 |

## 4. audit 매크로 조합

- 실행: 서버를 `--reset` 한 뒤 `node docs/design/audit.mjs --out scratchpad/r5e/audit-macro --base http://127.0.0.1:18891 --only macro`
  - 결과: `화면×조건 10개, 열지 못한 것 0개`
- 합계
  - page-overflow 0 · clipped 0 · orphan 0 · num-split 0
  - folded3 0 · folded2-360 9 · touch 0 · contrast 0 · console 0
- 비교 기준선 둘과 macro 10줄이 **글자 하나까지 같다**(`diff` 빈 출력, `SAME-r5c`, `SAME-r5d2`).
  - `r5c/audit/summary.md` 의 macro 줄
  - `r5d/audit-macro2/summary.md`
- 회귀(0 → 1 이상): 없음.

## 참고 (조건 아님)

1. **효과 의존성을 지키는 테스트가 없다.**
   - 돌연변이 Mc(`}, [follow])` → `})`)가 82개 테스트를 모두 통과한다. 이 돌연변이는 다시 읽기 · 알림 변화마다 별로 포커스와 화면을 빼앗는다.
   - 지금 코드는 맞다(위 2번 실측). 그래도 "★ 누른 뒤 다른 칸에 포커스 → 데이터 다시 읽기(`refreshKey` 올림 또는 `load`) → 포커스가 그 칸에 남는다" 같은 jsdom 테스트 하나가 있으면 지킬 수 있다.
2. **실패가 늦게 오면, 그 사이 다른 칸으로 옮긴 포커스를 별로 되가져온다.**
   - 폰 320, 실패를 2초 늦췄다. 탭 뒤 첫 줄 단추로 옮기고 맨 위로 올렸다. 실패가 오자 `{"y":0,"a":"VIX…"}` → `{"y":1536,"a":"CPI 내 지표로"}` 로 바뀌었다(`away.mjs`).
   - 앞 커밋(rAF)도 똑같이 했다. 이번 변경으로 생긴 것은 아니다.
   - "되돌아간 줄을 보여준다"는 의도와도 맞는다. 다만 아주 느린 망에서는 이것이 끌려가는 느낌을 줄 수 있다. `document.activeElement` 가 아직 그 별(또는 body)일 때만 옮기는 방법이 있다. 주인 확인 거리로 남긴다.
3. **앞 판정의 참고 둘은 그대로다.** status ③ 에 이미 적혀 있다.
   - 폰에서 ★ 실패 오류 글(`.error-text`)이 화면 위 밖에 있다. 이번 측정 화면에서도 별만 꺼져 있고 알림은 `sr-only` 다.
   - "입력 닫기" busy 가드 테스트가 없다.

## 정리

- 띄운 서버는 `kill $(cat scratchpad/r5e/server.pid)` 로 껐다. 그 뒤 `curl` 응답 코드는 `000` 이다.
- worktree 는 `git worktree remove --force scratchpad/r5e/wt` 로 지웠다(node_modules 복사본 때문에 --force).
- 돌연변이 넷은 각각 원래 파일로 되돌렸다(`cmp` 같음).
- 지우기 직전 worktree 의 `git status`:

```
Not currently on any branch.
nothing to commit, working tree clean
```

- 주 작업 트리 `git status --short` 는 출력이 없고, HEAD 는 96ab372 다.
- 측정 기록은 `scratchpad/r5e/` 에 있다.
  - `fail.txt` · `fail-sw-allow.txt` · `fail-sw-block.txt` · `fail-sw-block2.txt` · `ok.txt` · `steal-phone.txt`
  - `audit-macro/` · `shots/` · `work/*.mjs`
