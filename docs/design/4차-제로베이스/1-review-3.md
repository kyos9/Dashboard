# 디자인 4차 묶음 1 — 세 번째 검토 (재검토 조건 셋 확인)

**판정: 조건부 합격**

- 검토한 커밋: `70124e4`(origin/claude/design-4-zerobase, detach)
- 앞 판정: `1-review-2.md` 7장 "합격으로 올릴 조건" 셋
- 서버: fake_server 전용 포트 8165, 데이터 폴더는 저장소 밖. `npm ci && npm run build` 를 먼저 했다. 끝난 뒤 PID 로 껐고, curl 을 보내니 000 이 나왔다.
- 내가 쓴 재기 스크립트는 저장소 밖에 있다.
  - `scratchpad/r3/probe1.mjs`: 보유 표
  - `scratchpad/r3/probe2.mjs`: 머리줄

## 요약

| 조건 | 판정 | 한 줄 |
| --- | --- | --- |
| 1. PC 150% 신호 칸 | **아직(부분)** | 신호는 늘 보인다. 대신 처음 화면에서 **비중 칸 오른쪽 23px 을 신호 칸이 덮는다**. "34.9%" 가 "34.9" 로, "비중" 이 "비" 로 보인다 |
| 2. text130 머리줄 상태 글 | **통과**(걱정 1) | folded3 1→0, 상태 배지 외톨이 12→0, 화면 읽기에는 남는다. 다만 340px 아래에서는 "갱신 실패" 가 점 색으로만 남는다 |
| 3. focus-ring 검사 | **통과**(보완 1) | 규칙을 지우면 라이트 조건에서 잡히고, 원래대로면 가짜가 0 이다. 다만 검사가 끝난 뒤 포커스가 머리줄 ⋯ 에 남아 audit 사진에 흰 테두리가 찍힌다 |
| 회귀 | **없음** | 늘어난 것은 시각 값과 데이터 폴더 경로 차이뿐이다. lint 22 · tsc 0 · 테스트 1067 |

## 1. PC 확대 150% 보유 표 신호 칸 — 아직(부분)

바뀐 곳: `frontend/src/styles/pages/dashboard.css:374-390`. `.signal-head/.signal-cell` 에 `position: sticky; right: 0`, 바탕색, 왼쪽 그림자를 줬다.

`probe1.mjs` 로 잰 결과(대시보드 포트폴리오, owner):

```
z150-dark 0   {"max":23,"boxR":905,"sigL":852,"sigR":904,"inside":true,"firstPos":"static","sigHit":8,"total":8,"covered":[7]}
z150-dark max {"max":23,"scrollLeft":23,"inside":true,"firstL":6,"sigHit":8,"total":8,"covered":[]}
z150-light 0  {... "inside":true, "covered":[7], "bg":"rgb(255, 255, 255)"}
pc1400-dark 0 {"max":0,"inside":true,"sigHit":12,"total":13,"covered":[]}   ← 13번째 줄(トヨタ)은 신호가 없는 빈칸
z150-dark hover bg (other, signal) [ 'rgb(18, 32, 54)', 'rgb(18, 32, 54)' ]
```

- **통과한 것**
  - 933px·배율 1.5 에서 신호 칸 머리와 모든 줄이 상자 안에 있다(`inside:true`). 옆으로 밀지 않아도 보이고, 가운데를 찍으면 신호 칸이 나온다(8/8).
  - 맨 끝까지 밀면 가리는 칸이 없다(`covered:[]`).
  - 줄에 마우스를 올리면 신호 칸 바탕도 같이 바뀐다. 탁한 바탕이라 아래 글이 비치지 않는다.
  - PC 1400 은 표가 넘치지 않아(`max:0`) 모양이 그대로다(사진 `probe/pc1400-light-0.png`). 폰은 표가 아니라 목록이라 이 규칙과 상관없다.
- **아직인 것(고쳐야 함)**
  - 표가 넘치는 폭은 **23px 뿐**이다. 처음 화면(scrollLeft 0)에서 sticky 신호 칸이 바로 왼쪽 **비중 칸(cellIndex 7)을 23px 덮는다**.
  - 사진 `probe/z150-dark-0.png` 에서 머리 "비중"은 "비", "(목표)"는 "(목ㅍ" 처럼 잘린다. 값 "34.9%" 는 **"34.9"**, "(6%)" 는 **"(6"** 으로 보인다.
  - 오른쪽 끝은 멀쩡해 보인다. 그래서 더 볼 것이 있다는 단서가 사라졌고, % 가 빠진 숫자가 다 보인 숫자처럼 읽힌다.
  - 앞에서는 신호가 잘렸는데, 이제는 비중이 잘린다.
  - audit 의 clipped/text-overlap 은 sticky 를 비교하지 않아서 0 으로 나온다(`1-review-2.md` 8장 참고와 같은 빈틈).
  - 고치는 길: 23px 은 작다. 좁은 PC(예: `max-width: 1000px`)에서 칸 안쪽 여백을 줄이거나 비중 칸의 "(목표)" 줄을 정리해 **933 에서 표가 아예 넘치지 않게** 하면 sticky 도 덮지 않는다. 아니면 넘칠 때만 덮는 것을 막는다.
- **참고**: 지휘 글과 CSS 주석(`dashboard.css:375` "종목 칸(왼쪽)이 붙어 있는 것과 짝")은 사실과 다르다.
  - 보유 표의 종목 칸은 sticky 가 아니다. `firstPos:"static"` 이고, 끝까지 밀면 `firstL:6` 으로 왼쪽으로 빠져 "TIGER" 가 "IGER" 로 보인다(사진 `probe/z150-light-max.png`).
  - `table.sticky-first` 를 쓰는 표는 종목 관리 쪽이다. 지금은 신호와 종목 칸이 서로 덮일 일은 없다. 주석만 바로잡으면 된다.

## 2. 폰 글자 130% 머리줄 상태 글 — 통과 (걱정 1)

바뀐 곳:
- `AppHeader.tsx:214`: 상태 글을 `<span class="status-text">` 로 감쌌다.
- `phone-header.css:88-103`: `nowrap` 을 줬고, 340px 아래에서는 visually-hidden(`position:absolute; 1px; clip-path: inset(50%)`)으로 숨긴다.

- **전체 audit**(앞 재검토 `rv2/audit-head` 와 하나씩 비교)
  - `history | ph390-text130 | folded3 | 연결 확인 중` 이 **없어졌다**.
  - "방금 받음/연결 확인 중" 외톨이 배지 12건도 **없어졌다**.
  - text130 배지 외톨이 42→30 이다. 남은 30 은 모두 `dash-signal(-cards)-xcond` 의 일부러 길게 쓴 조건이다.
- **폭별 재기**(`probe2.mjs`). 네 가지 글("방금 받음/연결 확인 중/시세 갱신 중…/갱신 실패")을 넣어 쟀다.
  - 300@3.9 · 320 · 339: `hidden:true`, 점만 보이고 알약 폭은 24px 이다.
  - 341@3.4 · 360 · 390: `lines:1`, 가장 긴 "시세 갱신 중…" 도 99px 한 줄이다.
  - 모든 폭에서 `docOverflow:0`, 다른 머리줄 단추와 겹침이 0 이다.
- **화면 읽기(접근성 트리)**: 300px 에서도 `- banner: | heading "자산관리" | text: 방금 받음 | button "전체 새로고침" | ...` 로 글이 남는다. 통과.
- **걱정(고쳐야 함)**: "점 색·title 이 같은 뜻"이라는 커밋 설명은 반만 맞다.
  - title 은 상태와 상관없는 늘 같은 설명이다("이 화면이 서버에서 마지막으로 값을 받은 때입니다…", `AppHeader.tsx:211`). 폰에서는 마우스를 올릴 수 없어 title 이 보이지도 않는다.
  - 그래서 340px 아래(글자를 키운 저시력 사용자 바로 그 조건)에서는 **"갱신 실패"가 빨간 점, "시세 갱신 중…"이 노란 점, 색 하나로만** 전해진다.
  - 평소 "방금 받음"은 숨겨도 되지만, 나쁜 상태(`dot` 이 `bad`/`warn`)일 때는 글을 남기거나 짧은 글("실패")을 보여 주길 권한다. 그러면 지금 folded3 0 을 깨지 않는다. 300px 에서도 제목과 점 사이에 50px 쯤 비어 있다(사진 `probe/head-300-3.9.png`).
  - 이 조건은 audit 에 "갱신 실패" 상태가 없어 자동 검사로는 안 잡힌다.

## 3. audit focus-ring 검사 — 통과 (보완 1)

뮤테이션: `frontend/src/styles/components/app-header.css:183-187` 의 `.app-header :focus-visible { … }` 네 줄을 지우고 빌드한 뒤, 6화면 × 9조건을 쟀다(`--only guest-home,dash-portfolio,modal-chart,modal-stock-edit,menu-display,menu-diagnostics`).

```
dash-portfolio   pc1400-light   7  전체 새로고침:1, 🔔:1, AI:1, owner ▾:1, 나가기:1, 화면:1, 1:1   (ratio 1)
modal-chart      pc1400-light   7  (같음)        menu-display pc1400-light 7 (같음)
guest-home       pc1400-light   2  로그인, 화면
ph390/ph360/risered light       2  (새로고침 아이콘, ⋯)
모든 dark 조건 · zoom150 · text130   0
```

- **진짜를 잡는다.** 라이트에서는 대비 1(테두리 색 = 청람 바탕)로 모든 라이트 조건에서 잡았다. 팝업이 열린 화면에서도 잡는다.
- 다크에서 0 인 것은 놓친 것이 아니다. 전역 규칙 `symbol-search.css:155-159 button:focus-visible { outline: 2px solid var(--accent) }` 이 다크 청람 위에서 대비 3 이상이라 실제로 보인다.
- 되돌림: `git checkout -- frontend/src/styles/components/app-header.css` 을 하고 다시 빌드했다. 그 뒤 `--only dash-portfolio,modal-chart` 를 다시 재니 focus-ring 0 이었다.
- **가짜**: 원래 코드로 돌린 전체 317조합에서 focus-ring **0** 이다(다른 화면·팝업·메뉴 화면 포함). 메뉴·팝업 화면 사진은 팝업이 연 채로 찍혀 있다(예: `menu-display--ph390-light.png`). 검사가 팝업을 닫지 않는다.
- **보완(고쳐야 함, 도구)**: `audit.mjs:503-504` 는 처음 포커스가 `body` 이면 `body.focus()` 를 부른다. 이 호출은 아무 일도 하지 않아서 **마지막 머리줄 단추(⋯)에 포커스가 남는다**.
  - 그 상태로 사진을 찍는다. 그래서 `audit-now/shots/dash-portfolio--pc1400-light.png` 의 ⋯ 단추에 사용자는 보지 않는 흰 포커스 테두리가 찍힌다.
  - 목업과 사진을 비교할 때 헷갈린다. 뒤의 검사가 `:focus-within` 모양을 재게 될 수도 있다.
  - `before === document.body` 이면 `document.activeElement.blur()` 를 부르면 된다.

## 4. 회귀 — 없음

전체 audit 결과: 317조합, 열지 못한 것 0. 앞 재검토 "지금"(721a2cb) 표와 견준 것이다.

| 검사 | 앞 "지금" (기존 / text130) | 이번 70124e4 | |
| --- | --- | --- | --- |
| page-overflow · clipped · touch · contrast · console · cond-missing · nowrap-split · sticky-left · quiet-target · color-unread · tnum-width · text-overlap | 0 / 0 | 0 / 0 | 같음 |
| focus-ring (새) | — | 0 / 0 | |
| folded3 | 0 / 1 | **0 / 0** | 줄었다 |
| folded2-360 | 0 / 1 | 0 / 1 | 같음(재무 東京海上) |
| 외톨이 단추 / 문단 / 배지 | 3 / 17 / 0 · 1 / 21 / 42 | 3 / 13 / 0 · 1 / 22 / 30 | 배지 −12. 문단 차이는 아래 |
| 숫자 갈라짐 | 13 / 3 | 13 / 3 | 같음 |
| 가짜 단추 | 8 / 1 | 8 / 1 | 같음 |

- 하나씩 비교해 늘어난 것은 두 가지뿐이다. 둘 다 앞 판정이 이미 "데이터 값 차이"라고 적은 것이다.
  - `menu-users` 의 "가입 2026.10.7 01:46 · 마지막 접속 …": 시각 값만 바뀌었고 같은 수가 빠졌다.
  - `menu-diagnostics` 데이터 폴더 경로 외톨이: 내 데이터 폴더 경로 길이 때문에 조건이 ph390→text130 으로 옮겨 갔다.
- `npm run lint`: 경고 **22**, 오류 0
- `npx tsc -b`: exit **0**
- `npm test`: **64 files, 1067 passed**
- 기능 쪽 diff 는 `AppHeader.tsx` 한 줄(span 감싸기)뿐이다. api/lib/types/backend 는 바뀌지 않았다.

## 5. 합격으로 올릴 조건

1. **PC 150% 처음 화면에서 비중 칸이 신호 칸 밑에 23px 묻히지 않게** 한다. 933 에서 표가 넘치지 않게 줄이는 쪽이 가장 간단하다.
2. **340px 아래에서 나쁜 상태(갱신 실패·갱신 중)는 글이 보이게** 한다. 아니면 그것을 미루는 이유를 문구변경·status 에 적는다.
3. **audit focus-ring 검사 뒤 포커스를 풀어** 사진에 테두리가 남지 않게 한다(`audit.mjs:503-504`).

세 가지 모두 작은 CSS·스크립트 수정이다. 고친 뒤에는 그 부분만 다시 재면 된다.

## 6. 참고

- `dashboard.css:375` 주석의 "종목 칸(왼쪽)이 붙어 있는 것과 짝"은 사실이 아니다. 보유 표 종목 칸은 sticky 가 아니다.
- 신호 칸의 `box-shadow: -1px 0 0 var(--border)` 경계선이 사진에서는 거의 보이지 않는다(border-collapse 표). 덮을 때 경계 단서가 약하다.

## 7. 작업 트리

- 뮤테이션으로 바꾼 파일(`app-header.css`)은 `git checkout --` 으로 되돌리고 다시 빌드했다.
- 서버(8165)는 PID 로 껐다. 끈 뒤 curl → 000.
- 이 파일을 쓰기 전 상태:

```
$ git status --short
(빈 출력)
$ git rev-parse --short HEAD
70124e4
```
