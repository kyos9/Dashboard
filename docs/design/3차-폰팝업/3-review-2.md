# 디자인 3차 — 재검토

**판정: 합격**

앞 검토의 보완 1~4는 모두 풀렸습니다. 내가 직접 다시 잰 값입니다.
- **보완 1**: 진단 팝업 ph360 Shift+Tab 에서 머리줄 밑에 숨는 칸이 1 → 0.
- **보완 2**: ph390 진단 요약 외톨이가 3 → 0.
- **보완 3**: plan.md 문장이 실제 측정과 맞습니다.
- **보완 4**: safearea 를 세 번 돌려 세 번 모두 2로 같았습니다.

새 변경 두 가지도 다른 화면에 영향이 없습니다.
- 팝업 제목 옆 안내의 `text-wrap: balance`: 줄바꿈이 바뀐 곳은 진단 요약 하나뿐입니다.
- 일괄 수정 팝업의 `scroll-padding-bottom`: 폰의 일괄 수정 팝업에만 걸리고, PC 는 그대로입니다.

2-2 기능 불변도 그대로입니다. 되돌릴 것은 없습니다. plan.md 의 기준선 칸에 내가 재현하지 못한 수치가 하나 있는데, 참고로만 적습니다.

- **대상**: `7999f26..41dfa9d`(c7c7786, 41dfa9d). worktree 를 `origin/claude/design-3-phone-popups`(41dfa9d)에 떼어 붙였습니다. 차수 시작은 `b3a2d5e`.
- **서버**: 이번 묶음은 빌드 후 8190(데이터 `/tmp/claude-0/rev4-data`)에 띄웠습니다. main `b3a2d5e` 은 임시 worktree `/tmp/claude-0/rev4-main` 를 빌드해 8191(데이터 `/tmp/claude-0/rev4-mdat`)에 띄웠습니다.
  - 데이터 폴더 이름 길이를 같게 맞춰, 진단의 로그 경로 줄이 두 쪽에서 같은 조건이 되게 했습니다.
  - 두 서버를 같은 스크립트로 쟀고, 총괄 수치는 쓰지 않았습니다.

## 판정 표

| # | 항목 | 판정 | 증거 |
| --- | --- | --- | --- |
| 1 | 2-2 기능 불변 | 통과 | `git diff --stat b3a2d5e -- backend frontend/src/api frontend/src/lib frontend/src/types.ts frontend/src/AppState.tsx` 출력이 비어 있음. `git diff --name-only b3a2d5e \| grep -E '\.(tsx\|ts)$'` 도 비어 있음. 코드 변경은 `frontend/src/index.css` 하나(+99 −5). 이번 두 커밋에서 바뀐 코드는 CSS 규칙 셋(index.css:2207, 3026, 4914)과 `docs/design/safearea.mjs` 뿐. 백엔드 diff 가 없어 pytest 는 생략 |
| 2 | 검증 명령 | 통과 | `npx tsc -b` 통과. `npm run lint` 경고 22개(시작 22). `npx vitest run`: `Test Files 63 passed (63)` · `Tests 1065 passed (1065)` |
| 3 | 보완 1: 진단 포커스가 머리줄 밑에 숨음 | 통과 | index.css:3026 `.modal.diag-modal { scroll-padding-top: calc(160px + 위 안전영역) }` → 실제 계산값 207px, 진단 머리줄 아래 끝 190(ph390·ph360 모두). 앞 검토 탐침을 그대로 다시 돌린 결과: `ph360-dark diag: ... underHead 0`(앞 판정은 `underHead 1 HEAD 시그널 기준 정의 지문 top119<190`). ph390·ph360 × 다크·라이트, Shift+Tab 으로 팝업 10종 전부 underHead 0. Tab 방향(ph390·ph360 다크)도 전부 0 |
| 4 | 보완 2: 진단 요약 제목 외톨이(ph390) | 통과 | audit `menu-diagnostics`: 7999f26 은 ph390-dark·ph390-dark-risered·ph390-light-risered 에 제목 외톨이 1씩 → 지금 9조건 모두 0. 실제 줄바꿈(글자마다 Range): balance 전 `…없음·시세받기막힘—아래시세 / 받기칸` → 지금 `서버 로그: 최근 경고·오류 없음 · / 시세 받기 막힘 — 아래 시세 받기 칸`. 두 덩이로 나뉘고 줄 수(2)와 머리줄 높이(190)는 같음. main 에 있던 ph360 진단 제목 외톨이 2(같은 요약 `…아래 / 시세받기칸`)도 0이 됨. 스크린샷 `/tmp/claude-0/rev4-probe/shots/r4-ph390-dark-diag.png` |
| 5 | 보완 3: plan.md 문장·수치 | 통과(참고 1건) | plan.md:79 의 예외 설명이 "기준선에는 없다 · main 은 title-in-side·close-in-view · 바깥 여백 47 로 ✕ 가 둘째 줄 — 맞바꿈"으로 고쳐짐. 내 측정과 같음(main 에는 `land844 modal-chart-longest close-first-row` 없음, 지금은 그것 2개뿐). plan.md:99~100 기준선 칸: 외톨이 18~20(내 main 측정 **18**, 앞 검토 20), safearea 120~122(내 main 측정 **120**). 모두 범위 안. **참고**: 같은 칸의 "진단 팝업만: 숫자 갈라짐 6"은 재현되지 않음. 내 main 측정의 진단 숫자 갈라짐은 0(9조건)이고 앞 검토도 0. 진단 내용은 서버 로그·시세 상태에 따라 달라지는 데이터라 총괄 환경에서는 나왔을 수 있음. 합격 기준 2("어느 검사도 늘지 않음")의 판정에는 영향 없음 |
| 6 | 보완 4: safearea 알림 펼치기 흔들림 | 통과 | safearea.mjs:97~105 가 펼치기 전 `scrollHeight` 를 재고, 늘 때까지 `waitForFunction`(5초)으로 기다림. 시간이 넘어도 그대로 재므로 `sticky-untested` 가 그대로 드러나 결과를 숨기지 않음. 같은 코드로 **세 번** 돌림: 1·2·3회차 모두 `문제 합계: 2 — close-first-row 2`, sticky-untested 0. `ph640side-dark menu-push` 는 세 번 모두 문제 없음 |
| 7 | 새 변경: `.modal-title .hint { text-wrap: balance }` (index.css:2207, 모든 폭에 걸림) | 통과 | ① audit 285조합을 7999f26(앞 검토 결과)·main 과 화면×조건마다 비교: 바뀐 것은 `menu-diagnostics` 의 외톨이가 줄어든 것뿐이고, 나머지 화면은 문제 하나하나까지 같음. ② 같은 서버에서 balance 를 켠 상태와 `text-wrap:wrap` 으로 덮은 상태를 비교: ph390·ph360·pc1400·zoom150 × 팝업 10종, 40줄 모두 줄 수·높이·머리줄 높이가 같음. ph390·ph360 × 두 테마의 글자 단위 줄바꿈은 진단만 다르고, 다른 제목 옆 안내(AI 키·화면 설정·사용자·일괄 수정 "15종목"·AI 진단·시그널 기준·지표 차트)는 모두 한 줄이라 그대로. balance 는 줄 수를 늘리지 않으므로 PC 배치도 같음(pc1400 진단 머리줄 33 = 33) |
| 8 | 새 변경: `.stock-edit-modal { scroll-padding-bottom }` (index.css:4914, 폭 640 이하에서만) | 통과 | 선택자가 일괄 수정 팝업 하나에만 걸림. 탐침에서 다른 팝업의 계산값은 바뀌지 않았고, PC 1400 의 계산값은 `auto`. 앞 검토 #8 의 기존 결함(Tab 하면 칸이 저장 줄 밑에 숨음): ph390 42 → **0**, ph360 48 → **0**(underFoot). 코드가 직접 부르는 `scrollIntoView({block:'center'})`(StockEditModal.tsx:106, 처음 커서)도 확인: 첫째·가운데·끝에서 둘째·마지막 종목의 수량 칸이 390·360 에서 모두 머리줄과 저장 줄 사이(예: 360 마지막 8766.T 337~381, 머리줄 115, 저장 줄 480). PC 1400 좌표는 main 과 소수점까지 같음 |
| 9 | 회귀(기준선 0 → 1 이상) | 통과 | audit: main → 지금 회귀 0. safearea: main 120 → 지금 2. 남은 2는 plan 의 예외(맞바꿈)로 문서에 적혀 있음 |
| 10 | 키보드: 팝업 안에서만 도는가 | 통과(회귀 없음) · 기존 결함 | 포커스가 팝업 밖으로 새는 수는 앞 검토와 같음(예: 알림 Tab 20, 일괄 수정 9). `.tsx` 를 고쳐야 하는 일이라 이번 범위 밖. 앞 판정과 같이 다음 차수 후보 |
| 11 | 누른 횟수 | 통과 | CSS 만 바뀌었고 이동 경로·단추는 그대로 |
| 12 | 사용자 확인 3-user.md 반영 | 통과 | 남은 거슬림 하나(일괄 수정에서 Tab 하면 칸이 저장 줄 밑에 숨음)는 #8 대로 0. 진단 화면 높이 문제("360에서 내용이 절반 남짓")는 이번에 바뀌지 않음(머리줄 190 그대로) → 참고 |
| 13 | 글꼴·일관성 | 해당 없음 | 글꼴·색·문구 변경 없음 |

## 자동 검사 결과(기준선 → 지금)

| | main `b3a2d5e` | 7999f26 (앞 검토 결과) | 지금 `41dfa9d` |
| --- | --- | --- | --- |
| audit 외톨이 | 18 (단추 5 · 문단 11 · 제목 2) | 19 (제목 3) | **16** (단추 5 · 문단 11 · 제목 0) |
| audit 숫자 갈라짐 · 360 두 줄 · 가짜 단추 | 12 · 2 · 9 | 12 · 2 · 9 | 12 · 2 · 9 |
| audit 넘침·잘림·접힘 3줄·터치·대비·콘솔 · 열지 못함 | 0 · 0 | 0 · 0 | 0 · 0 |
| safearea 156조합 | 120 | 3 / 2(흔들림) | **2 / 2 / 2**(세 번) |

- 회귀 목록: 없음.
- 문단 외톨이 11은 main 과 같음(기준선의 20% 이하 조건은 앞 차수 판정 범위).

## 남은 것(이번 판정에는 넣지 않음)

- 진단 요약이 데이터에 따라 세 줄이 되면 머리줄이 207 을 넘을 수 있음. 지금 값 160 + 안전영역은 두 줄 기준이라 여유가 17px 뿐. 참고.
- 차트 말고 모든 팝업에 포커스 가두기가 없음(`.tsx`). 기존 결함.
- `land844 modal-chart-longest` 의 ✕ 가 둘째 줄로 감(카드 폭 머리줄). plan 이 다음 차수 후보로 적어 둠.

## 정리와 작업 트리

- 가짜 서버 8190(PID 2988)·8191(PID 15106)은 PID 파일로만 껐습니다. 끈 뒤 두 포트 모두 응답 000.
- main worktree `/tmp/claude-0/rev4-main` 은 `git worktree remove --force` 로 지웠습니다.
- 저장소 파일은 고치지 않았고 커밋도 하지 않았습니다. `frontend/node_modules` 링크와 빌드 결과는 무시 목록에 있어 상태에 나오지 않습니다.
- 참고: 주 체크아웃(`/home/user/Dashboard`)은 지금 `6df5f8c` 에 있습니다. 판정 대상은 지시대로 fetch 한 `origin/...` 의 `41dfa9d` 입니다.
- worktree `git status`:

```
HEAD detached at 41dfa9d
nothing to commit, working tree clean
```
