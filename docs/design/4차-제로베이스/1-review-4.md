# 디자인 4차 묶음 1 — 네 번째 검토 (세 번째 검토 조건 셋 확인)

**판정: 조건부 합격**

- 검토한 커밋: `da1dd8b`(origin/claude/design-4-zerobase, detach)
- 앞 판정: `1-review-3.md` 5장 "합격으로 올릴 조건" 셋
- 서버: fake_server 를 전용 포트 8166 에 띄웠다. 데이터 폴더는 저장소 밖에 두었다. 띄우기 전에 `npm ci && npm run build` 를 했다. 끝난 뒤 PID 로 껐고, curl 을 보내니 000 이 나왔다.
- 내가 쓴 재기 스크립트는 저장소 밖 `scratchpad/r3/` 에 있다.
  - `pa4.mjs`: 표 넘침과 칸 여백
  - `pb4.mjs`: 933 신호 칸
  - `pc4.mjs`, `pd4.mjs`: 폰 머리줄의 실제 상태 세 가지
- 전체 audit 결과: `scratchpad/r4/audit/`

## 요약

| 조건 | 판정 | 한 줄 |
| --- | --- | --- |
| 1. PC 150% 보유 표 | **통과** | 933·1.5 에서 scrollWidth 875 = clientWidth 875, 신호 칸 8/8 이 보이고 덮인 칸이 0 이다. 여백 8px 은 보유 표에만 들어갔다(리밸런싱·종목 관리는 12px 그대로) |
| 2. 340px 아래 폰 나쁜 상태 글 | **통과**(새 걱정 1) | 방금 받음일 때만 숨는다. 갱신 중·갱신 실패는 보이고 접근성 트리에도 남는다. 다만 **폭 300~315 에서 "시세 갱신 중…" 이 알약 밖으로 나가 새로고침 단추를 덮는다** |
| 3. audit 포커스 풀기 | **통과** | `dash-portfolio--pc1400-light` 사진에서 ⋯ 의 흰 테두리가 사라졌다. focus-ring 은 0 그대로다 |
| 4. 회귀(audit·lint·tsc·테스트) | **없음** | audit 검사별 합계가 앞 "지금" 과 같다. 다른 것은 시각 값뿐이다. lint 경고 22 · tsc 0 · 테스트 1067 |

## 1. PC 확대 150% 보유 표 — 통과

바뀐 곳은 `frontend/src/styles/pages/dashboard.css:353-365` 이다.
- sticky 신호 칸을 뺐다.
- `.holdings-table` 최소 폭을 860 에서 780 으로 줄였다.
- `table.data-table.holdings-table th/td` 양옆 여백을 8px 로 줄였다.

`pb4.mjs` 결과(owner, 포트폴리오, 표를 화면 위로 올린 뒤):

```
z150 dark  {"sw":875,"cw":875,"hit":8,"tot":8,"covered":0,"rowsInside":15,"rows":15,"weightText":"34.9% (6%)","weightTextR":836,"weightCellR":844,"sigL":844}
z150 light {"sw":875,"cw":875,"hit":8,"tot":8,"covered":0,"rowsInside":15,"rows":15, ...}
```

- **넘치지 않는다.** scrollWidth 와 clientWidth 가 같다(875 = 875). 앞에서는 23px 넘쳤다.
- **신호 칸이 처음 화면에 다 보인다.** 15줄 모두 신호 칸이 상자 안에 있다. 화면에 보이는 8줄 모두 가운데를 찍으면 신호 칸이 나온다.
- **덮는 칸이 없다**(`covered:0`). 비중 글자의 오른쪽 끝(836)이 신호 칸 시작(844)보다 왼쪽이다.
  - 사진 `r4/probe/z150-dark-tableview.png` 에서 "비중 (목표)", "34.9% / (6%)" 가 온전히 보인다.
  - 933 에서는 비중 칸이 두 줄("34.9%" 아래 "(6%)")로 접힌다. 글자가 잘리지는 않는다.
- **번지지 않았다**(`pa4.mjs`, 칸 여백 왼/오른 분포):

```
pc1400-*-        holdings-table           {"8px/8px":18}   sw 1342 = cw 1342
pc1400-*-rebalance  sticky-first ×2       {"12px/12px":18}, {"12px/12px":16}
pc1400-*-stocks     fixed sticky-first    {"12px/12px":12}
z150-*-rebalance / -stocks                12px 그대로 (원래 min-width 1120/1070 이라 표 안에서 옆으로 민다)
pc1024-dark-     holdings-table           sw 966 = cw 966, 신호 3/3
```

  - 줄인 여백은 보유 표에만 있다. PC 1400 보유 표 사진(`r4/probe/pc1400-light--table.png`)도 모양이 그대로다.
  - 보유 표 안의 칸이 넘친 것(`cellOver`)은 모든 조건에서 0 이다.
- **참고(고칠 것 아님)**
  - 새 규칙 `table.data-table.holdings-table td` 의 우선순위는 (0,2,2) 이다. 바로 아래 `.holdings-table .signal-cell { padding-left/right: 4px }`(`dashboard.css:375-381`, (0,2,0))보다 높아서 신호 칸 여백도 8px 이 된다. 잰 값은 `"pad":"8px"`, 신호 칸 폭은 52 에서 60 으로 늘었다.
  - 그래서 4px 두 줄은 지금 아무 일도 하지 않는다. 933 에서도 넘침이 0 이라 해는 없다. 4px 이 뜻한 것이면 선택자를 올리고, 아니면 두 줄을 지우면 된다.
  - 앞 판정 6장에서 지적한 잘못된 주석("종목 칸이 붙어 있는 것과 짝")은 sticky 블록과 함께 지워졌다.

## 2. 340px 아래 폰 상태 글 — 통과 (새 걱정 1)

바뀐 곳은 `frontend/src/styles/components/phone-header.css:94-104` 이다. 숨기는 선택자가 `.status-pill.compact:has(.status-dot.ok) .status-text` 로 바뀌었다.
- 상태와 점 색의 짝은 `AppHeader.tsx:110-116` 에 있다. 갱신 중은 `warn`, 갱신 실패는 `bad`, 시세 연동 정상과 방금 받음·연결 확인 중은 `ok` 다.
- 그래서 규칙대로라면 좋은 상태일 때만 숨는다.

상태를 실제로 바꿔 쟀다(DOM 을 고친 것이 아니다). Playwright 로 `POST /stocks/refresh-all` 요청을 붙잡았다.
- 갱신 중: 응답을 끝내 보내지 않았다.
- 갱신 실패: 500 을 돌려줬다.
- 두 경우 모두 머리줄 새로고침 단추를 눌러 앱이 스스로 상태를 바꾸게 했다.

`pc4.mjs` 결과(발췌):

```
300@3.9 ok          {"text":"방금 받음","dot":"status-dot ok","hidden":true,"pillW":24}   aria: text: 방금 받음
300@3.9 refreshing  {"text":"시세 갱신 중…","dot":"status-dot warn","lines":1,"hidden":false,"txW":67,"pillW":65}  aria: text: 시세 갱신 중…
300@3.9 fail        {"text":"갱신 실패","dot":"status-dot bad","lines":1,"hidden":false,"txW":45,"pillW":65}     aria: text: 갱신 실패
320@3 / 339@3       ok → hidden:true · refreshing/fail → hidden:false, lines:1
341@3.4 · 360 · 390 세 상태 모두 hidden:false, lines:1, docOverflow 0
```

- **통과**: 340px 아래에서는 방금 받음일 때만 숨는다. 갱신 중·갱신 실패는 글이 보이고 한 줄이다. 사진 `r4/probe/head-300-3.9-fail.png` 에 "갱신 실패" 가 빨간 점 옆에 보인다.
- **접근성 트리**: 숨긴 경우(300·320·339, ok)에도 `banner > text: 방금 받음` 으로 남는다. 통과.
- **새 걱정(고쳐야 함)**: 알약 밖으로 넘친다.
  - 340px 아래에서도 글을 보이게 하면서, 글은 `nowrap` 인데 알약은 줄어든다(`pillW 65 < txW 67`).
  - 그래서 가장 긴 "시세 갱신 중…" 이 알약 밖으로 나가 옆 새로고침 단추 위에 겹친다. `pd4.mjs` 결과:

```
300 refreshing {"textR":207.7,"pillR":182,"btnL":190,"iconL":202,"gapToBtn":-17.7,"gapToIcon":-5.7}
310 refreshing {"textR":207.7,"pillR":192,"btnL":200,"iconL":212,"gapToBtn":-7.7,"gapToIcon":4.3}
320 refreshing {"gapToBtn":2.3}    330 · 339 → 12.3 · 16
300 fail       {"gapToBtn":4.8}    (갱신 실패는 짧아서 모든 폭에서 겹치지 않음)
```

  - 폭 300 은 audit 의 `ph390-text130`(폰 글자 130% 흉내) 조건과 같은 폭이다. 이 폭에서 "…" 가 새로고침 아이콘 위에 5.7px 겹친다. 사진 `r4/probe/head-300-3.9-refreshing.png` 에서 "중…" 이 아이콘에 닿아 있다.
  - 갱신 중에는 새로고침 단추가 비활성이고 바탕이 투명하다. 그래서 글과 아이콘이 그대로 포개진다.
  - 앞 커밋(70124e4)에서는 340 아래에서 늘 숨겨서 이 겹침이 없었다. 이번 수정이 만든 것이다.
  - audit 은 갱신 중 상태를 만들지 않아서 text-overlap 이 0 으로 나온다.
  - 고치는 길(하나면 된다):
    - 340 아래에서 갱신 중 글을 짧게("갱신 중") 한다.
    - 알약에 `flex-shrink: 0` 을 주거나 최소 폭을 글에 맞춘다. 제목 오른쪽에 30px 쯤 비어 있다(h1 오른쪽 109, 글 시작 141).
    - `.status-text` 에 `overflow:hidden; text-overflow:ellipsis` 를 준다.

## 3. audit 포커스 검사 뒤 포커스 풀기 — 통과

바뀐 곳은 `docs/design/audit.mjs:503-505` 이다. 처음 포커스가 `body` 이면 `before.focus()` 대신 `document.activeElement.blur()` 를 부른다.

- 전체 audit 의 `dash-portfolio--pc1400-light.png` 오른쪽 위를 잘라 앞 판정 사진과 견줬다(`r4/probe/crop-prev.png` / `crop-now.png`).
  - 앞 사진: ⋯ 단추에 흰 두꺼운 포커스 테두리가 있다.
  - 이번 사진: 다른 단추와 같은 얇은 테두리다.
- `ph390-light`, `ph360-dark`, `ph390-text130-dark`, `rebalance pc1400-light`, `modal-chart pc1400-light` 의 머리줄에도 포커스 테두리가 없다(`r4/probe/heads.png`).
- 검사 결과 focus-ring 은 317조합 모두 0 이다. 검사가 잡는 힘은 앞 판정에서 뮤테이션으로 확인했고, 이번 수정은 검사 뒤 정리만 바꿨다.
- 참고: 처음 포커스가 body 가 아닐 때(팝업 안 요소)는 `before.focus()` 로 되돌린다. 이것은 앞 코드와 같은 동작이다.

## 4. 회귀 — 없음

전체 audit(`--base http://127.0.0.1:8166 --shots`)을 돌렸다. 317조합이고 열지 못한 것은 0 이다. 앞 판정의 "지금"(`r3/audit-now`, 70124e4)과 문제 하나하나를 견줬다.

| 검사 | 앞 "지금" | 이번 da1dd8b |
| --- | --- | --- |
| page-overflow · clipped · folded3 · touch · contrast · console · cond-missing · nowrap-split · sticky-left · quiet-target · color-unread · tnum-width · text-overlap · focus-ring | 0 | 0 |
| orphan(단추 / 문단 / 배지) | 69 (4 / 35 / 30) | 69 (4 / 35 / 30) |
| num-split | 16 | 16 |
| folded2-360 | 1 | 1 |
| fake-button | 9 | 9 |

- 문제 하나하나의 차이는 `menu-users` 의 "가입 2026.10.7 01:46 · 마지막 접속 …" 이 "02:07 · … 02:11" 로 바뀐 10건뿐이다. 데이터 시각만 다르고, 같은 수가 빠지고 들어왔다. 그 밖에는 늘어난 것이 없다.
- `npm run lint`: 경고 **22**, 오류 0(≤ 22 지킴)
- `npx tsc -b`: exit **0**
- `npm test`: **64 files, 1067 passed**
- 기능 쪽 diff 는 없다. CSS 두 파일과 audit.mjs 만 바뀌었고, api/lib/types/backend 는 손대지 않았다.
- 2장의 300~315px 갱신 중 겹침은 audit 밖에서 찾은 새 문제다. 그래서 이 표에는 나타나지 않는다.

## 5. 합격으로 올릴 조건

1. **폭 340 아래에서 "시세 갱신 중…" 이 알약 밖으로 넘쳐 새로고침 단추를 덮지 않게** 한다. 폭 300(= audit `ph390-text130`)에서 `textR ≤ btnL` 이면 된다. 2장 끝의 고치는 길 가운데 하나면 충분하다.

세 번째 검토의 조건 셋은 모두 풀렸다. 남은 것은 이번 수정이 만든 작은 CSS 문제 하나다. 고친 뒤에는 `pd4.mjs` 처럼 갱신 중 상태를 300·310 에서만 다시 재면 된다.

## 6. 참고

- `dashboard.css:375-381` 의 신호 칸 4px 여백은 새 규칙에 밀려 쓰이지 않는다(1장 참고).

## 7. 작업 트리

- 저장소 파일은 고치지 않았다. 뮤테이션도 하지 않았다.
- 서버(8166)는 PID 로 껐다. 끈 뒤 curl → 000.
- 이 파일을 쓰기 전 상태:

```
$ git status --short
(빈 출력)
$ git rev-parse --short HEAD
da1dd8b
```
