# 묶음 4 여덟 번째 검토 (4-review-8) — c4ee766 이후 504c84d

## 판정: 조건부 합격 — 조건 둘

- 검토 7 조건 1(저장 줄이 화면 밖)은 **처음 저장할 때만 풀렸다.** 마지막 줄(도쿄해상홀딩스)을 고쳐 저장하면 320 · 390 · 1280 모두 "✓ 1줄을 저장했습니다"가 화면 안에 들어온다.
  - 그런데 **같은 시트에서 다시 저장하고, 그때도 같은 줄 수를 저장하면** 끌어오지 않는다. 그러면 화면 밖에 그대로 남는다(조건 1).
- 참고 넷은 모두 들어갔다. 그런데 PC 주문 표 단추가 **"거래 칸 / 닫기" 두 줄**로 꺾이고, 둘째 줄이 2자 외톨이가 됐다(조건 2). 이번 커밋에서 새로 생겼다.
- 계산 · 저장 로직은 바뀌지 않았다. 테스트 1139 는 모두 통과다. 린트 경고 20 · tsc · build 도 통과다. CSS 는 바뀌지 않았고 색표 밖 색은 0 이다.
- audit 397 조합 결과: 열지 못함 0 · touch 0 · orphan 26(앞 판정과 항목까지 같음). console 1 이 나왔지만 다시 돌리면 나오지 않는 흔들림이다(아래).

검토한 자리:
- 저장소 밖 worktree `scratchpad/r4h/wt`(504c84d, detached)에서 했다. `node_modules` 는 주 작업 트리 것을 심볼릭 링크로 걸었다.
- `frontend` 에서 먼저 `npm run build` 를 했다(index-4rKkcV0u.js). 서버가 내주는 번들 해시가 이것과 같았다.
- 가짜 서버 18811(`--data-dir r4h/fdata`)은 손으로 재는 데 썼다. 18812(`--data-dir r4h/fdata2`)는 audit 에 썼다. 둘 다 `--reset` 으로 띄웠다.
- 8765 · `backend/.devdata` · 주 작업 트리는 건드리지 않았다.
- 재는 데 쓴 스크립트는 `r4h/js/m1~m3.mjs` 이고, 스크린샷은 `r4h/shots/` 에 있다.

## 조건

### 조건 1 (고쳐야 함). 같은 시트에서 두 번째로 저장하면 저장 줄을 끌어오지 않는다
- `components/rebalance/TargetSheet.tsx:51-54` 의 effect 는 `[note]` 가 바뀔 때만 돈다.
  - 글은 `RebalancePanel.tsx:996` `` `${saved}줄을 저장했습니다 — …` `` 이다. 그래서 두 번째 저장도 1줄이면 글이 똑같고, effect 가 다시 돌지 않는다.
  - 고치는 동안에도 note 를 지우지 않는다. 지우는 곳은 닫을 때뿐이다(`:1661`).
- 실브라우저에서 잰 것(`js/m1.mjs`). 하나의 시트에서 차례로 했다.

| 차례 | 390×844 | 320×640 | 1280×900 |
| --- | --- | --- | --- |
| A. 마지막 줄 밴드를 고치고 저장(스크롤 354/354 → 117) | y=1~19 **보임** | y=1~38 **보임** | y=21~40 **보임** |
| A2. 다시 맨 아래로 내려 같은 줄을 또 고치고 저장(1줄) | y=**−266** 안 보임, 스크롤 384/384 그대로 | y=**−831** | y=**−3**(잘림, 위 가장자리) |
| A3. 이번엔 두 줄을 고치고 저장("2줄" — 글이 바뀜) | y=1 보임 | y=1 보임 | y=21 보임 |
| B. 새로 연 시트에서 첫 줄(VOO)을 고치고 저장 | y=118 보임 | y=118 보임 | y=119 보임 |
| C. B 다음, 가운데 줄(TSLA)로 내려 고치고 저장(1줄) | 스크롤 0이라 보임 | y=**−306** 안 보임 | 스크롤 0이라 보임 |

- A2 · C 에서 화면에 보이는 것은 "바뀐 것 없음"(옅은 단추)뿐이다. 사용자 확인 2 에서 본 모습 그대로다(`shots/A2-again-390.png`).
- "하나 고쳐 저장하고, 내려가서 또 고쳐 저장"은 흔한 흐름이다. 테스트는 저장을 한 번만 한다(`RebalancePanel.test.tsx:1242-1261`). 그래서 이 경우를 잡지 못한다.
- 고칠 방향(예):
  - 저장할 때마다 바뀌는 값(저장 횟수 번호 등)으로 effect 를 돌린다.
  - 아니면 저장을 시작할 때 note 를 지웠다가 다시 넣는다.
  - 테스트는 같은 줄 수로 두 번 저장하고 `scrollIntoView` 가 두 번 불렸는지 본다.

### 조건 2 (고쳐야 함). PC 주문 표 "거래 칸 닫기" 단추가 두 줄로 꺾여 외톨이가 된다
- `RebalancePanel.tsx:733` 에서 글을 "닫기"에서 "거래 칸 닫기"로 바꿨다(검토 7 참고 3). 그런데 칸 폭이 그대로라 꺾인다.
- 실브라우저(`js/m3.mjs`) 1400 · 1280 에서 잰 것:
  - TIGER · 삼성전자우 · AAPL · NVDA 네 줄 모두 `74x38`(1280 은 `72x38`)이고 lines=**2**, `white-space: normal` 이다.
  - "거래 입력"(닫힌 때)은 62px 한 줄이다.
  - 스크린샷 `shots/pc-close-1280.png`: "거래 칸 / 닫기".
- 3-2 표의 외톨이 줄 합격선은 "버튼 0"이다. 마지막 줄 "닫기"는 2자다.
- audit 은 PC 주문 표에서 거래 칸을 열지 않는다. 그래서 잡지 못했다.
- 1100 · 933(150%) · 800 에서는 표가 없다(주문 카드). 폰 시트 단추는 앞 판정에서 한 줄로 쟀다.
- 고칠 방향: 그 단추에 `nowrap` 을 주거나 칸의 최소 폭을 넓힌다. 실브라우저 1280/1400 에서 한 줄인지 다시 잰다.

## 항목별

| 항목 | 결과 | 증거 |
| --- | --- | --- |
| 검토 7 조건 1: 마지막 줄(도쿄해상홀딩스) 저장 뒤 status 가 보이나 | 처음 저장은 통과, 다시 저장은 **실패(조건 1)** | 위 표. 첫 저장 뒤 `elementFromPoint` 는 `P.hint saved-note` 를 가리킨다(가려지지 않음). 붙박이 저장 줄 top 은 763(390) · 559(320) · 798(1280)이고, 그보다 위다 |
| 위쪽 줄을 고친 경우 | 통과 | B: 스크롤 0 그대로이고 y=118/118/119 다. 시트 제목도 함께 보인다(`shots/B-first-390.png`) |
| 참고: PC 표 "거래 칸 닫기" | 글은 통과, 모양은 **실패(조건 2)** | 1280: 보이는 글 "거래 칸 닫기", 읽는 이름 "TIGER 미국필라델피아반도체나스닥 거래 칸 닫기", 2줄 |
| 참고: 목표 시트 풀이 | 통과 | 320/390/1280: "…종목 탭의 ⋯ "한 번에 수정"이나 종목 화면의 "보유" 탭에서 고칩니다." |
| 참고: 순서 바꾸는 중 aria-pressed | 통과 | 1280/390/320 에서 줄 보기 · 카드 보기 각각 → 순서 바꾸기: `줄:pressed=false class=- \| 카드:pressed=false class=-`. 끝내면 원래대로(`줄:true,카드:false` / `줄:false,카드:true`) |
| 참고: 금리차 nowrap 테스트 | 통과 | `MacroPanel.test.tsx:399` 이 `toHaveClass('nowrap')` 을 본다. 실브라우저 320/390/1280 에서 `class=hint nowrap ws=nowrap lines=1` |
| 계산 · 저장 불변 | 통과 | `git diff --stat c4ee766 504c84d -- backend frontend/src/api frontend/src/lib frontend/src/types.ts frontend/src/AppState.tsx` 는 비어 있다. tsx 의 변경은 effect · ref 추가, 단추 글, 풀이 글, aria-pressed 조건뿐이다. api · set* 쪽으로 바뀐 줄은 없다 |
| 문구 변경 표 1:1 | 통과 | `문구변경.md` 에 +2 행(PC 거래 단추 · 목표 시트 풀이)을 넣었고, 바뀐 테스트 기대값 2 와 맞는다 |
| 테스트 수 | 통과 | `npx vitest run` → Test Files 68 passed, **Tests 1139 passed**(줄지 않음 — 이번 커밋은 기존 테스트에 assert 를 더했다) |
| 새 테스트가 돌연변이를 잡나 | 대체로 통과(참고 2) | 바꾸고 매번 `git checkout -- <파일>` 로 되돌렸다. **잡음**: effect 끄기(1 실패), `ref` 빼기(1), PC 단추 "닫기"로(1), 풀이 "종목 안"으로(1), 줄 보기 aria-pressed 옛꼴(1), 금리차 `nowrap` 빼기(1 — 검토 7 참고 2 풀림). **못 잡음**: 카드 보기 aria-pressed 옛꼴(`view === 'card'`) → 60 통과. 두 번째 저장(조건 1)도 못 잡는다 |
| 린트 | 통과 | `npm run lint` warning 20(새 경고 없음) |
| tsc · build | 통과 | `npx tsc -b --noEmit` exit 0 · `npm run build` ✓ built in 428ms |
| CSS 300줄 | 통과(해당 변경 없음) | `git diff --stat c4ee766 504c84d -- frontend/src/styles` 는 비어 있다. 300 넘는 파일(dashboard 1111 · shell 600 · fundamentals 421 · ai 377)은 전부터 있었다 |
| tokens.css 밖 색 | 통과 | `styles/` 의 tokens.css 밖에서 #hex · rgb · hsl 0, `.tsx`(테스트 빼고)에서 0 |
| audit 397 조합 | 통과 | `r4h/audit/summary.md`: 열지 못함 **0** · page-overflow 0 · clipped 0 · folded3 0 · touch **0** · contrast 0 · fake-button 0 · text-overlap 0 · focus-ring 0 · orphan 26 · num-split 19 · folded2-360 33 · console 1 |
| audit 앞 판정 대비 | 회귀 없음 | orphan 26 은 r4g 와 화면 · 종류 · 글까지 똑같다(dash-signal 계열 · menu-users 2 · modal-chart 2 · rebalance "리밸런싱 설정" 1). rebalance · guest-rebalance 20 조합은 r4g 와 같다(ph360 folded2 1, text130 orphan 1 · folded2 1) |
| audit console 1 | 흔들림(회귀 아님) | `stock-detail ph360-light "Object is disposed"`(차트 해제 경합). 이번 커밋은 종목 안 · 차트를 건드리지 않았다. `--only stock-detail` 로 세 번 다시 돌리니 3번 모두 console **0**(`r4h/audit-sd1~3`) |
| 리밸런싱 · 목표 시트 audit 조합 | 깨지지 않음(참고 3) | audit.mjs 에 목표 시트 · PC 거래 칸 조합은 없다(`rebalance` · `guest-rebalance` 뿐). 그래서 그쪽은 위 손 측정으로 대신했다 |

## 참고 (조건 아님)
1. 첫 저장 뒤 status 줄이 시트 맨 위 가장자리에 딱 붙는다(390 · 320 y=1, `shots/A-last-390.png` 에서 ✓ 위쪽이 살짝 잘림). 시트 제목 · 닫기 단추는 화면 밖으로 밀려 있다(head.bottom=−11).
   - `viewport-fit=cover` 인데, 폰 시트(`stocks.css:310`, padding 0)는 safe-area-inset-top 을 주지 않는다. 그래서 노치 있는 아이폰에서는 이 줄이 상태 표시줄 아래에 가릴 수 있다. 여기서는 잴 수 없었다.
   - `scroll-margin-top` 을 주거나, 시트 스크롤을 맨 위(0)로 올리면 제목까지 함께 보인다.
2. aria-pressed 테스트(`StockManager.test.tsx:787-790`)는 줄 보기에서만 순서 바꾸기를 연다. 카드 보기 쪽 조건을 되돌려도 통과한다. 카드 보기 → 순서 바꾸기 한 번을 더하면 잡는다.
3. 목표 시트(저장 뒤)와 PC 거래 칸 열린 상태를 audit 조합에 넣으면, 조건 2 같은 것을 다음엔 자동으로 잡는다.
4. `behavior: 'smooth'` 는 줄임 움직임(prefers-reduced-motion) 설정을 따지지 않는다. 앞서 있던 거래 칸 끌어오기와 같은 꼴이라 일관은 된다.

## git status
- 내 worktree(`scratchpad/r4h/wt`, 504c84d)에서 `git status --short` 를 하면 출력이 없다(깨끗).
  `--ignored` 로 보면 `backend/**/__pycache__/` · `frontend/dist/` · `frontend/node_modules`(심볼릭 링크)만 있다.
- 돌연변이 7개는 매번 `git checkout -- <파일>` 로 되돌렸다. 저장소에 쓴 것도, 커밋한 것도 없다.
- 끝낼 때 서버는 pid 파일로 껐고, worktree 는 `git worktree remove --force` 로 지웠다(무시 파일 때문에 force).
  - 18811 과 처음 띄운 18812 는 이어받았을 때 이미 꺼져 있었다.
  - 다시 띄운 18812 는 pid 파일로 껐다.
