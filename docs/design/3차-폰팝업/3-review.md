# 디자인 3차 — 검토

**판정: 조건부 합격**

되돌려야 할 것은 없습니다. 기능 불변, PC 1400·확대 150% 회귀, 상태바 띠(body::before), 계획 검토 반영 여부는 모두 통과입니다. 다만 이번에 넓힌 폰 팝업 머리줄 때문에 생긴 작은 회귀가 두 가지 있고, 계획서 수치와 문장이 실제 측정과 맞지 않는 곳이 두 군데 있습니다. 아래 "보완 목록"의 1~4를 고친 뒤 다시 재면 합격입니다.

- 대상: `b3a2d5e..7999f26`. worktree 를 `origin/claude/design-3-phone-popups` 에 떼어 붙여 확인했습니다.
- 서버: 이번 묶음(빌드 후 8180)과 main `b3a2d5e`(별도 worktree, 8181)를 같은 스크립트로 직접 쟀습니다. 총괄 수치는 쓰지 않았습니다.
- 측정 결과와 내가 쓴 탐침 스크립트는 저장소 밖에 있습니다: `/tmp/claude-0/rev3-out/`, `/tmp/claude-0/rev3-probe/`.

## 판정 표

| # | 항목 | 판정 | 증거 |
| --- | --- | --- | --- |
| 1 | 2-2 기능 불변 | 통과 | `git diff --stat b3a2d5e -- backend frontend/src/api frontend/src/lib frontend/src/types.ts frontend/src/AppState.tsx` 출력이 비어 있음. `git diff --name-only b3a2d5e \| grep -E '\.(tsx\|ts)$'` 도 비어 있음. 코드 변경은 `frontend/src/index.css` 하나(+88 −6)이고, 나머지는 `docs/design/` 아래뿐. 백엔드 diff 가 없어 pytest 는 생략 |
| 2 | 검증 명령 | 통과 | `npx tsc -b` 통과. `npm run lint` 경고 22개(시작 22). vitest `Test Files 63 passed · Tests 1065 passed (1065)`(시작 1065) |
| 3 | 계획 검토 "반영" 실제 확인 | 통과 (문서 보완 2건) | D2: `.stock-edit-modal .stock-edit-foot` (index.css:4902). D3: 가운데 카드 높이 상한 (2972). D5: `.modal-head > .chip-row` (2992). D6: `padding:20px` 대체값 뒤에 `max()` (2164-2166). U1: `body::before` (502). U2: 고정 머리줄을 폰 전체화면 팝업 전부로 (3005~). U4: ✕ `align-self:flex-start` (2988). 진단 ✕ 와 일괄 수정 ✕ 의 위 끝이 같은 y=63 인 것을 스크린샷으로 확인. R1~R7·R11 은 `safearea.mjs` 의 CONDS·SCREENS·measure 에 있음. **다만** R9 는 반만 됨: plan.md:99 의 "진단 팝업(고친 스크립트로 다시)" 칸이 "끝 보고에"로 비어 있음 → 보완 3. "막음"은 셋 모두 0 |
| 4 | 회귀: PC 1400·확대 150% | 통과 | 탐침으로 팝업 10종 × pc1400 / zoom150 / pc1400(높이 500)의 `.modal` 위치·크기·바깥 상자 padding·머리줄 위치를 main 과 비교. 30줄 중 다른 것은 두 가지뿐: ① maxH 표기 "860px" 대 "100%"(계산 전 값 표기만 다름), ② pc1400 진단 팝업 높이 666 대 280. ②는 두 서버의 진단 데이터 길이 차이로, pc1400(높이 500)에서는 같은 값. 그 밖의 좌표는 소수점까지 같음. safearea 의 `modal-in-view` 도 0 |
| 5 | 고정 머리줄 확대의 부작용(포커스 가림) | **보완** | ph390·ph360(위 47 흉내)에서 Tab 과 Shift+Tab 으로 팝업 10종 안을 돌며, 포커스 받은 칸이 붙은 머리줄 밑에 있는지 셈. 사용자·AI 키·화면 설정·시그널 기준·AI 진단·알림·종목 한 번에 수정(Tab 95칸)은 **0**. **진단 1건**: ph360 Shift+Tab 에서 "시그널 기준 정의 지문" 위 끝이 119 인데 머리줄 아래 끝이 190. 원인은 index.css:3005 의 `scroll-padding-top: 72px + 위 안전영역`(=119)이 진단 머리줄 높이(제목+요약+칩 줄, 아래 끝 190)보다 작은 것. 다른 팝업은 아래 끝 115~119 라 괜찮음. 폰에서 키보드를 쓸 때만 생기는 일이라 등급은 낮음 |
| 6 | body::before 상태바 띠 | 통과 | safearea `status-strip` 은 main 16 → 지금 0(종목 관리·리밸런싱 × 위 47 조건 × 두 테마). 띠 색이 `--bg-elevated` 와 같은지 라이트·다크 모두 확인. 스크린샷 `ph390-light-page-stocks.png` 에서 표가 시계 자리 밑으로 비치지 않음. PC 는 `env()=0` 이라 높이 0이고, audit 285조합의 PC 수치가 main 과 같음. 겹침 순서는 `.num-notice` 70 > `.modal-backdrop` 50 > `.menu-panel` 45 > 띠 40 = `.bottom-tabs` 40. 하단 탭과는 위·아래라 겹치지 않고, 메뉴 패널은 헤더 아래에 붙어 겹칠 일이 없음. 팝업은 50이라 띠를 덮고 자기 안쪽 여백으로 상태바를 피함(확인창 스크린샷). `pointer-events:none` 이라 밑을 막지 않음 |
| 7 | 키보드: 팝업 안에서만 도는가 | 통과(회귀 없음) · 기존 결함 | PC 1400에서 Tab 을 (칸 수 + 3)번 눌러 봄. 차트 말고는 **모든 팝업에서 포커스가 밖으로 샘**(예: 알림 20회, 일괄 수정 9회가 밖). **main 에서도 같은 수로 샘** → `diff` 결과 SAME-ESCAPE. 포커스 가두기는 `ChartModal.tsx:174` 에만 있음. `.tsx` 를 고쳐야 하는 일이라 CSS 차수 범위 밖 → 다음 차수 후보 |
| 8 | 종목 한 번에 수정: 저장 줄 밑에 숨는 칸 | 통과(회귀 없음) · 기존 결함 | Tab 으로 내려가면 칸이 아래 붙은 저장 줄 밑에 가려짐. ph390: main 39 → 지금 42. ph360: 50 → 48. PC: 25 → 25. 원래 있던 문제이고 `scroll-padding-bottom` 이 없어서 생김. 숫자 차이는 머리줄이 붙어 생긴 8px 정도의 이동 때문. 참고 |
| 9 | 0-review 보완 a·b | 통과 | safearea `card-gap`: main 4 → 0(a). `foot-aligned`: main 4 → 0(b). 이번에 넣은 ph640side 조건(옆 47)에서도 0 |
| 10 | safearea 156조합 | 통과(예외 문구 보완) | main: 120(close-first-row 18 · close-in-view 12 · title-in-side 10 · sticky-head 56 · foot-aligned 4 · card-gap 4 · status-strip 16). 지금 1회차: 3(close-first-row 2 · sticky-untested 1). 2회차: 2(close-first-row 2). `ph640side-dark menu-push` 의 sticky-untested("내릴 거리 0")는 두 번 중 한 번만 나와 흔들림 → 보완 4. 예외 `land844 modal-chart-longest close-first-row`: **기준선에는 없음**. main 의 같은 조합은 대신 `title-in-side`(제목 왼쪽 37 < 47)와 `close-in-view`(✕ 가 노치 밑)였음. 바깥 여백 47 때문에 카드가 좁아져 ✕ 가 둘째 줄(89~133)로 내려간 맞바꿈임. plan.md:79 의 "폭 640 초과의 머리줄은 이번에 바꾸지 않았다"는 사실과 다름 → 보완 3 |
| 11 | audit 285조합(고친 스크립트, 같은 스크립트로 main 도) | **보완** | 열지 못함 0 / 0(진단 열림). 합계 main → 지금: 외톨이 20 → 19, 숫자 갈라짐 12 → 12, 가짜 단추 9 → 9, 360 두 줄 2 → 2, 넘침·잘림·터치·대비·콘솔 0 → 0. **화면별 회귀**: `menu-diagnostics` 외톨이 0 → 1, 종류는 **제목**(`span.hint.diag-summary` 의 "…아래 시세 / 받기 칸", 마지막 줄 3자). 나온 곳은 ph390-dark, ph390-dark-risered, ph390-light-risered. main 에서는 ph360 두 곳에만 있었음. 제목 외톨이가 2 → 3이고, 3-2 는 제목 외톨이 0이 합격선. 원인은 폰의 `.modal-title{flex:1 1 0}`(2979)과 ✕ 가 한 줄을 나눠 쓰면서 390 에서 요약 폭이 좁아진 것. 머리줄은 이번 범위 안이라 6장 1의 예외(본문)로 넘길 수 없음. 참고: main 의 진단 외톨이 중 2건(로그 경로)은 데이터 폴더 이름 길이 탓이라 CSS 와 무관 |
| 12 | 누른 횟수 | 통과 | CSS 만 바뀌었고 이동 경로·단추·상태는 그대로라 세 과업 모두 같음 |
| 13 | 첫인상(참고) | 해당 없음(사용자 역할) | 스크린샷으로 본 범위에서는 정답과 맞음: 일괄 수정을 내려도 제목·✕ 가 위에 있고 저장 줄은 아래, 진단 ✕ 는 다른 팝업과 같은 높이, 종목 관리를 내려도 띠가 있음 |
| 14 | 글꼴·일관성 | 해당 없음 | 글꼴·정적 파일·색·문구 변경 없음 |

## 보완 목록(실행자에게)

1. **진단 머리줄 포커스 가림**: index.css:3005 의 `scroll-padding-top` 고정 72가 진단 머리줄(아래 끝 190)보다 작음. 진단에만 값을 늘리면 됨(예: `.diag-modal` 에 약 150 + 안전영역). 고친 뒤 ph360 Shift+Tab 으로 다시 잼.
2. **진단 요약 제목 외톨이(ph390)**: "받기 칸" 만 둘째 줄에 남음. 요약 문구를 감싸는 `span`·`nowrap` 묶음이나 CSS 로 고치되, 0 → 1 회귀를 없앰.
3. **plan.md 문서 바로잡기**: ① 79행 예외 설명을 "기준선에는 없음. main 은 같은 조합에서 제목·✕ 가 노치 밑(title-in-side·close-in-view)이었고, 이번 바깥 여백 때문에 ✕ 가 둘째 줄로 감 — 맞바꿈"으로 고침. ② 99행 진단 기준선 칸을 채움. 내가 잰 값은 main(고친 audit) 외톨이 20(진단 4, 그중 2는 데이터 경로 길이 탓)이고, 지금 19.
4. **safearea `menu-push` 펼치기 흔들림**: 같은 코드에서 두 번 중 한 번 sticky-untested 가 나옴(ph640side-dark). 종목별 알림을 펼친 뒤 `scrollHeight` 가 늘 때까지 기다리게 하면 됨.

## 다음 차수 후보(이번 판정에는 넣지 않음, 모두 기존 결함)

- 차트 말고 모든 팝업에 포커스 가두기가 없음(`.tsx` 를 고쳐야 함).
- 일괄 수정에서 Tab 으로 가면 칸이 저장 줄 밑에 숨음(`scroll-padding-bottom` 으로 고칠 수 있음).
- 라이트 테마에서 iOS black-translucent 상태바 글자(흰색)와 흰 띠·헤더의 대비. 이 환경에서는 실기기로 볼 수 없음. 헤더 맨 위에서도 원래 같은 상황.

## 자동 검사 결과(기준선 → 지금)

- safearea: 120 → 2(같은 코드로 다시 잰 값. 1회차는 3)
- audit: 외톨이 20 → 19 · 숫자 갈라짐 12 → 12 · 가짜 단추 9 → 9 · 360 두 줄 2 → 2 · 나머지 0 → 0 · 열지 못함 0 → 0
- 회귀 목록:
  - audit `menu-diagnostics` 제목 외톨이 0 → 1(ph390-dark, ph390-dark-risered, ph390-light-risered)
  - safearea `land844 modal-chart-longest` close-first-row 0 → 1(두 테마. 대신 title-in-side·close-in-view 가 1 → 0)

## 정리와 작업 트리

- 가짜 서버 8180·8181 은 PID 로만 껐습니다(pkill 안 씀). 끈 뒤 두 포트 모두 응답 000.
- main worktree `/tmp/claude-0/rev3-main` 은 `git worktree remove --force` 로 지웠습니다.
- 저장소 파일은 고치지 않았고 커밋도 하지 않았습니다.
- worktree `git status`:

```
HEAD detached at 7999f26
nothing to commit, working tree clean
```

## 파일

- safearea 결과: `/tmp/claude-0/rev3-out/sa-new/summary.md`, `/tmp/claude-0/rev3-out/sa-new2/summary.md`, `/tmp/claude-0/rev3-out/sa-main/summary.md`
- 스크린샷: `/tmp/claude-0/rev3-out/sa-new/shots/`, `/tmp/claude-0/rev3-probe/shots/`
- audit 결과: `/tmp/claude-0/rev3-out/au-new/summary.md`, `/tmp/claude-0/rev3-out/au-main/summary.md`
- 탐침: `/tmp/claude-0/rev3-probe/probe.mjs`
- 탐침 결과: `rect-*.txt`, `focus-*.txt`, `fb-new.txt`, `head-new.txt`, `pcfocus-*.txt`(모두 `/tmp/claude-0/rev3-probe/` 안)
