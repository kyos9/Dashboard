# 디자인 4차 묶음 1 — 다섯 번째 검토 (네 번째 검토 조건 하나 확인)

**판정: 조건부 합격**

- 검토한 커밋: `0eb1fc1`(origin/claude/design-4-zerobase, detach)
- 앞 판정: `1-review-4.md` 5장의 조건 하나 — 340px 아래에서 "시세 갱신 중…" 이 새로고침 단추를 덮지 않게
- 바뀐 곳: `frontend/src/styles/components/phone-header.css:95-102`
  - 340px 아래에서 `.status-pill.compact { flex: 0 1 auto }` 를 준다.
  - `.status-text { white-space: normal; line-height: 1.2 }` 를 준다.
  - 다른 frontend 파일은 바뀌지 않았다(`git show 0eb1fc1 --stat`: css 1 파일 +9, 판정문 1 파일).
- 서버: `npm ci && npm run build` 를 먼저 했다. 그 뒤 fake_server 를 전용 포트 8167 에 띄웠다. 데이터 폴더는 저장소 밖 `scratchpad/r5/data` 다. 끝난 뒤 PID 로 껐고 curl 은 000 이었다.
- 재기 스크립트는 저장소 밖에 있다. `scratchpad/r3/pe5.mjs`(pd4·pc4 를 합쳐 넓힌 것), `scratchpad/r3/pf5.mjs`(머리줄 폭 나눔). 결과와 사진은 `scratchpad/r3/r5probe/`, audit 결과는 `scratchpad/r5/audit/` 에 있다.
- 상태는 앞 검토처럼 실제로 만들었다. `POST /stocks/refresh-all` 을 붙잡고 머리줄 새로고침을 눌렀다. 갱신 중은 응답을 보내지 않았고, 갱신 실패는 500 을 돌려줬다.

## 요약

| 항목 | 판정 | 한 줄 |
| --- | --- | --- |
| 조건: 340 아래 갱신 중 글이 단추를 덮지 않음 | **통과** | 폭 300~340 · 배율 3/3.9 · 세 상태 모두 글이 알약 안에 있다. 단추와 겹침 0, 단추까지 틈 16px 이상, 가로 넘침 0 |
| 세 줄 이상 접히지 않음 | **실패**(새 걱정) | **폭 300·305 에서 "시세 갱신 중…" 이 세 줄로 접힌다**(시세 / 갱신 / 중…). 이때 머리줄 높이가 61 에서 68 로 7px 커진다. 커밋 메시지와 주석의 "두 줄까지" 와 다르다 |
| 341~390 | **전과 같음** | 세 상태 모두 한 줄, 겹침 0, 넘침 0, 머리줄 61 |
| 회귀(audit·lint·tsc·테스트) | **없음** | 검사별 합계가 앞 "지금" 과 같다. orphan 만 +2 인데, 진단 창에 찍히는 서버 데이터 폴더 경로 탓이다(코드와 무관, 4장). lint 22 · tsc 0 · 테스트 1067 |

## 1. 폭 300~340 — 겹침 조건은 통과, 줄 수는 실패

`pe5.mjs` 로 쟀다. 폭은 300, 305, 310, 315, 320, 325, 330, 335, 339, 340 이다. 배율은 3 과 3.9, 상태는 방금 받음 · 갱신 중 · 갱신 실패다. 발췌:

```
300@3.9 ok         {"hidden":true,"lines":1,"overlap":[],"docOverflow":0,"headerH":61,"pillH":16}
300@3.9 refreshing {"text":"시세 갱신 중…","lines":3,"textInPill":true,"gapR":28.6,"overlap":[],"docOverflow":0,"headerH":68,"pillH":51}
300@3.9 fail       {"text":"갱신 실패","lines":2,"textInPill":true,"gapR":28.6,"overlap":[],"docOverflow":0,"headerH":61,"pillH":37}
305@3   refreshing {"lines":3,"gapR":33.6,"overlap":[],"headerH":68,"pillH":51}
310@3   refreshing {"lines":2,"gapR":16,"overlap":[],"headerH":61}   fail {"lines":2,"gapR":38.6}
315~330 refreshing lines 2 · fail lines 1 · gapR ≥ 16 · headerH 61
335~340 refreshing/fail lines 1 · gapR 16 · headerH 61
배율 3 과 3.9 의 값은 모든 폭에서 같다.
```

`gapR` 은 글의 오른쪽 끝부터 그 오른쪽 첫 단추의 왼쪽 끝까지 잰 거리다. `overlap` 은 글 줄 상자와 머리줄 단추·제목이 겹친 목록이다.

- **조건 통과**
  - 모든 폭·배율·상태에서 `overlap:[]` 이다. 글은 알약 안에 있다(`textInPill:true`).
  - 단추까지 틈이 가장 작은 곳도 16px 이다. 앞에서는 300 에서 −17.7px, 310 에서 −7.7px 이었다.
  - 가로 넘침(`docOverflow`)은 모든 곳에서 0 이다.
  - 방금 받음은 앞처럼 점만 남고 글은 화면 읽기용으로 숨는다(`hidden:true`).
- **새 걱정(고쳐야 함): 폭 300·305 에서 세 줄로 접힌다**
  - 사진 `scratchpad/r3/r5probe/head-300-3.9-refreshing.png` 에서 "시세 / 갱신 / 중…" 이 세로로 쌓인다. 알약 높이는 51px 로, 단추(44px)보다 크다.
  - 머리줄 높이가 61 에서 68 로 커진다. 새로고침을 누르면 머리줄과 그 아래 화면 전체가 7px 밀리고, 갱신이 끝나면 다시 올라온다.
  - 폭 300 · 배율 3.9 는 audit 의 `ph390-text130`(폰 글자 130%) 조건과 같다. 고친 사람이 가장 신경 써야 할 폭이다.
  - 커밋 메시지와 `phone-header.css:95` 주석은 "알약 안에서 두 줄까지" 라고 한다. 그런데 줄 수를 막는 장치(`line-clamp`·`max-height` 등)는 없다. 그래서 세 줄도 그대로 나온다.
- **새 걱정(참고): "갱신 실패" 도 300~310 에서 두 줄이 되었다**
  - 앞(da1dd8b) `pc4` 결과는 `300@3.9 fail lines:1` 이었다. 지금은 "갱신 / 실패" 로 접힌다(`head-300-3.9-fail.png`).
  - 덮이지는 않고, 머리줄 높이도 61 그대로다. 그래도 넉 자짜리 말이 한 덩어리로 읽히지 않는다.
- **까닭**(`pf5.mjs`, 폭 300 · 배율 3.9)
  - 브랜드가 14~109, 알약이 117~182(65px), 새로고침이 190~234, ⋯ 이 242~286 이다. 머리줄은 남는 자리 없이 꽉 차 있다.
  - 알약 65px 에서 안쪽 여백 8+8, 점, 점과 글 사이를 빼면 글 칸은 30px 남짓이다. 그래서 "시세"·"갱신" 한 낱말마다 줄이 바뀐다.
  - `flex: 0 1 auto` 와 `white-space: normal` 은 알약을 더 넓히지 않는다. 글을 접게만 할 뿐이다.
- **고치는 길(하나면 된다)**
  - 340 아래에서 갱신 중 글을 "갱신 중" 으로 짧게 한다. 그러면 "갱신 실패" 와 길이가 같아진다.
  - 340 아래에서 알약의 안쪽 여백과 점 간격을 줄인다.
  - `-webkit-line-clamp: 2` 와 `overflow: hidden` 으로 두 줄에서 자르고, 남는 것은 "…" 으로 둔다.
  - 확인은 `pe5.mjs` 를 폭 300·305 에서만 다시 돌리면 된다. 갱신 중일 때 `lines ≤ 2` 이고 `headerH` 가 61 이면 된다.

## 2. 341~390 — 전과 같음

```
341 · 345 · 350 · 360 · 375 · 390 (배율 3 · 3.9), ok/refreshing/fail 모두:
{"hidden":false,"lines":1,"textInPill":true,"gapR":16,"overlap":[],"docOverflow":0,"headerH":61,"pillH":27}
```

새 규칙이 `@media (max-width: 340px)` 안에만 있어서 341 위는 그대로다. 사진 `head-341-3-*.png` 도 앞과 같은 한 줄이다.

## 3. lint · tsc · 테스트

- `npm run lint`: 경고 **22**, 오류 0(≤ 22 지킴)
- `npx tsc -b`: exit **0**
- `npm test`: **Test Files 64 passed, Tests 1067 passed**

## 4. 전체 audit — 늘어난 것 없음(환경 탓 +2 설명)

`node docs/design/audit.mjs --base http://127.0.0.1:8167 --out scratchpad/r5/audit` 을 돌렸다. 317조합이고 열지 못한 것은 0 이다. 앞 판정의 `scratchpad/r4/audit/results.json`(da1dd8b)과 `r4/cmp.py` 로 문제 하나하나를 견줬다.

| 검사 | 앞 "지금" | 이번 0eb1fc1 |
| --- | --- | --- |
| page-overflow · clipped · folded3 · touch · contrast · console · cond-missing · nowrap-split · sticky-left · quiet-target · color-unread · tnum-width · text-overlap · focus-ring | 0 | 0 |
| orphan | 69 | 71 |
| num-split | 16 | 16 |
| folded2-360 | 1 | 1 |
| fake-button | 9 | 9 |

- **orphan +2 는 코드 탓이 아니다**
  - 새로 잡힌 둘은 `menu-diagnostics` 의 `ph360-dark` · `ph360-light` 다. 자리는 `div.diag-foot > span.hint.mono` 이고, 그 글은 서버 데이터 폴더 경로(`/tmp/claude-0/…`)다.
  - 이번 데이터 폴더는 `scratchpad/r5/data` 이고, 앞은 `scratchpad/r4/fdata` 였다. 경로 길이가 달라서 마지막 줄에 4자만 남았다(`'last': 4`).
  - 같은 자리의 num-split 은 앞에도 있었다. 이번 커밋은 진단 창을 건드리지 않았다(css 한 파일만).
- 나머지 차이는 `menu-users` 의 가입·접속 시각(02:07→02:27)뿐이다. 같은 10건이 빠지고 들어왔다.
- audit 은 갱신 중 상태를 만들지 않는다. 그래서 1장의 세 줄 접힘은 이 표에 나타나지 않는다.

## 5. 합격으로 올릴 조건

1. **폭 300·305(배율 3·3.9)에서 "시세 갱신 중…" 이 세 줄로 접히지 않게** 한다. 두 줄 이하이고, 갱신 중에도 머리줄 높이가 61 그대로면 된다. 1장의 고치는 길 가운데 하나면 충분하다. "갱신 중" 으로 줄이면 "갱신 실패" 와 길이가 같아진다. 그러면 '참고' 걱정(실패 두 줄)도 같이 손볼 수 있다.

네 번째 검토의 조건(단추를 덮지 않음)은 풀렸다. 남은 것은 이번 수정이 만든 작은 CSS 문제 하나다.

## 6. 작업 트리

- 저장소 파일은 고치지 않았다. 뮤테이션도 하지 않았다. 커밋하지 않았다.
- 서버(8167, PID 4628)는 PID 로 껐다. 끈 뒤 curl → 000.
- 이 파일을 쓰기 전 상태:

```
$ git status --short
(빈 출력)
$ git rev-parse --short HEAD
0eb1fc1
```
