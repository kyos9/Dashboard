# 묶음 4 리밸런싱 세 번째 검토 판정 (8f715ff, 앞 판정 4-review-2.md · d4f67cd)

## 판정: **조건부 합격**

앞 판정의 조건 셋은 모두 풀렸다. 앞 판정과 같은 방법으로 다시 재현해 확인했다.
보완 CSS 가 새 회귀를 하나 만들었다. 현금 카드의 안내 글이 폰 320 · 300 에서 잘린다.
새로 넣을 돈을 넣고 "팔지 않고 새 돈만 나누기"를 켰을 때만 보이는 자리다. audit 은 이 상태를 열지 않아 잡지 못했다.
보완 CSS 가운데 `flex-wrap: wrap` · `flex: 1 1 140px` · `margin-left: auto` 는 container query 밖에 있어 모든 폭에 걸린다. 이것이 원인이다.

## 앞 조건 1~3 — 다시 재현

| 조건 | 결과 | 재현과 증거 |
| --- | --- | --- |
| 1 긴 이름 세 줄 | 통과 | audit 397 조합에서 `folded3` 는 1 → **0** 이다. rebalance ph390-text130-dark 칸은 이제 외톨이 "한 번에 고치기" · "주기 · 현금 · 환율"뿐이고, 둘 다 앞 판정과 같다. 탐침 `q2.mjs` 로 "TIGER 미국필라델피아반도체나스닥" `.order-row-label` 의 Range 줄 수를 쟀다. 300 · 320 · 340 · 350 → **1줄**(카드 ≤ 322, 주수 · 금액이 아랫줄), 360 · 375 · 390 → 2줄(앞과 같음), 412 · 430 → 1줄. 줄 높이는 300/320 에서 82px(앞 85px, 3줄)이다. |
| 2 좁은 PC 테스트 | 통과 | `RebalancePanel.test.tsx:1282-1309` 가 matchMedia 를 흉내 낸다. 돌연변이(검토 worktree 에서 sed 로 바꾸고 RebalancePanel.test 를 돌린 뒤 되돌림): `const compact = useMedia(...) \|\| narrow` → `narrow` 은 **1 failed**, 경계 `1100px` → `900px` 도 1 failed, `{compact ? (` → `{narrow ? (` 도 1 failed. 머리 단추 `!narrow` → `!compact`(:1308) 는 1 failed, 타일 `narrow` → `compact`(:1464) 는 1 failed, 새 돈 칸 `!narrow` → `!compact`(:1347) 는 1 failed. 살아남은 것은 하나다. :1389 의 폰 새 돈 펼침을 `narrow` → `compact` 로 바꾸면 68 passed 다(참고 2). |
| 3 문구변경 표 | 통과 | `문구변경.md` 에 "묶음 4 보완 (3794eaa · 53e8245)" 표 10줄이 생겼고, 94줄 주문 줄 설명도 고쳤다. `git diff bce7275 8f715ff -- RebalancePanel.tsx components` 에서 한글이 든 +/- 줄을 모두 뽑아 표와 맞대 보았다. 판 돈 · ✓ 저장 · 저장 안 한 변경 · 읽기 이름 · 구분 · 계산으로는 · 목표 · 밴드 고치기 · 평단가 · 유지 · 1주 미만 · badge-sell 이 모두 표에 있고, 빠진 것은 0이다. 실제 화면(가짜 서버 390, `q4.mjs`)에서도 표와 글이 같다. 줄 이름 "TIGER 미국필라델피아반도체나스닥 1,641주 (1,641.27) 팔기 · 비중 33.5%에서 목표 6% · 비중이 밴드 밖 · −₩141,295,447 — 자세히", 시트 "구분 지수 · 40주 · $104.75 \| +598주 \| 계산으로는 598.51주 · 1주 단위로 내림 … 목표 · 밴드 고치기 \| … 수량 · 평단가는 “종목 안 보기”의 “보유”에서 고칩니다.", 목표 시트 칸 이름 "VOO 목표 비중 / VOO 밴드 임계값", 합계 "— 100%가 되게 맞추면 주문 계산이 맞습니다". |

## 보완이 새 회귀를 만들었나

| 항목 | 결과 | 증거 |
| --- | --- | --- |
| A. 주문 줄 배치 · 갈라짐 · 넘침(300 · 320 · 360 · 390 · 390 글자 130% · 다크/라이트) | 통과 | `q1.mjs` 로 줄 16개(현금 포함)를 쟀다. 300/320 은 모든 줄에서 이름 아래로 주수 · 금액이 내려간다(stacked 16, 최대 높이 93). 360/390 은 모두 한 줄 배치다(sameline 16, 최대 69). 넘침 0 · 숫자 갈라짐 0 · 페이지 넘침 0 · 콘솔 오류 0 이고, 두 테마가 같다. |
| B. 좁은 PC 줄 묶음 600 · 720 · 721 · 800 · 900 · 1000 · 1100(다크/라이트) | 통과 | 모두 표 없이 줄 묶음이고 한 줄 배치다. 줄 높이는 최대 63, 넘침 0, 갈라짐 0 이다. audit pc-zoom150 의 rebalance 는 모든 검사 0 이다. |
| C. **현금 카드(새 돈 + 팔지 않고 나누기)** | **실패 → 조건 1** | `q5.mjs` · `q5old.mjs`. 같은 조작을 d4f67cd 와 8f715ff 에 각각 했다. 300/320 에서 안내 "1주 미만 7종목을 못 사면 그만큼 더 남음" 의 오른쪽 끝이 x=348 이고 줄 오른쪽 끝은 285/305 다. `.order-card { overflow: hidden }` 이 그 뒤를 잘라 "그만큼 더 남음"이 안 보인다. d4f67cd 는 같은 폭에서 넘침 0 · 줄 63px 였다. 360/390 은 잘리지는 않지만, 현금 줄이 63 → **113px** 로 커졌다. 금액과 안내가 이름 아래로 내려가기 때문이다(`shots/cash-cmp.png`: 위에서부터 old360 · new360 · old320 · new320). |
| audit 397 | 통과(C 는 audit 밖) | 열지 못함 0 · page-overflow 0 · clipped 0 · fake-button 0 · folded3 **0** · touch 0 · contrast 0 · console 0 · 외톨이 20 · num-split 23 · folded2-360 40 이다. 앞 판정과 같고 folded3 만 1 → 0 이다. rebalance 의 남은 것은 360 의 TIGER 두 줄(목록용)과 text130 의 외톨이 둘(앞과 같음)이다. |
| 테스트 · 린트 · tsc · 빌드 | 통과 | `npx vitest run` → **1122 passed (1122)**, 68 files. oxlint 경고 **20**. `tsc -b` 종료 0. `npm run build` 성공. 백엔드 · lib · api 변경은 0 이다(d4f67cd..8f715ff 는 css · 테스트 · 문서뿐). 그래서 pytest 는 다시 돌리지 않았다. 앞 판정은 1611 passed 다. |
| CSS 300줄 · 색표 밖 색 | 통과 | rebalance-sheets.css 는 **296줄**(한도 300에 가깝다)이고, orders 249 · table 78 이다. 바뀐 css 에서 `#hex`/`rgb(`/`hsl(` 는 0 이다. |

## 조건 (보완)

1. **현금 카드의 안내 글이 폰 320 · 300 에서 잘린다**(3-2 "잘린 글 0"). 360 · 390 에서는 현금 줄이 까닭 없이 두 단으로 커진다.
   - 재현: 가짜 서버 → /rebalance, 폰 320(또는 300). "새로 넣을 돈"을 펼쳐 500000 을 넣고 "팔지 않고 새 돈만 나누기"를 켠다. 현금 카드의 "1주 미만 7종목을 못 사면 그만큼 더 남음"이 "…그만큼"에서 잘린다. 탐침 `q5.mjs` 에서 hint 의 left-right 는 156-348 이고 row 는 15-305 다.
   - 원인: `rebalance-sheets.css:42-51` 의 `.order-row { flex-wrap: wrap }` · `.order-row-name { flex: 1 1 140px }` · `.order-row-act { margin-left: auto }` 는 container query 밖이다. 그래서 `div.order-row.static`(현금)에도 걸린다. 또 `:288-295` 의 `@container (max-width: 320px) .order-row-act { display: flex }` 는 현금 카드의 블록 안내(`rebalance-orders.css:237` `.cash-card .order-row-act .hint { display: block }`)를 금액 옆 한 줄로 끌어와 넘치게 한다.
   - 고치는 길(하나): 새 규칙을 `button.order-row` 로 좁힌다. 아니면 현금 카드에서 `.order-row-act` 를 `display: block` · `flex-wrap: nowrap` 으로 되돌린다. 이 상태(새 돈 + 나누기, 300 · 320 · 360 · 390)를 탐침이나 audit 상태로 다시 잰다.

## 참고(조건 아님)

1. 카드 ≤ 320px(폰 300 · 320 · 350)에서는 이름이 짧은 줄(TSLA · NVDA 등)도 모두 두 단이 된다. 줄 높이는 60 → 82px 이다. 320 페이지 길이는 2,892px 다(긴 이름 하나 때문에 16줄이 다 커짐). 막힌 것은 아니고 고르게 보이지만, 폰 길이를 줄이던 목표와는 반대 방향이다. 주인 확인 거리다.
2. 돌연변이 하나가 살아남는다. `RebalancePanel.tsx:1389` 의 `{narrow && (` 를 `{compact && (` 로 바꾸면, 좁은 PC 에서 폰 새 돈 펼침 줄과 PC 새 돈 칸이 같이 그려진다. 그래도 테스트는 68 passed 다. 테스트에 `queryByRole('button', { name: /새로 넣을 돈/ })` 없음 한 줄을 더하면 잡힌다.
3. `4-보완.md` 에 재검토(4-review-2) 보완 칸이 없다. 기록은 status.md 한 줄뿐이다(8f715ff 의 변경 파일에 4-보완.md 가 없음). 앞 두 번은 4-보완.md 에 표를 두었다.
4. 커밋 글 · status 는 "카드가 320px 아래면"이라고 적었다. 실제로는 flex-wrap · 140px 기준이 모든 폭에 걸린다(조건 1의 원인).
5. 앞 판정 참고 1(1101~1230 표 안 스크롤)과 3~6 은 status.md 의 ③ 줄로 넘어갔다. 이번에는 다시 재지 않았다.

## 재현 환경

- `<sp>` = /tmp/claude-0/-home-user-Dashboard/c9553d42-71a5-5379-90e1-1c42ba786c3a/scratchpad
- 작업 트리: 저장소 밖 worktree 둘(detached)을 썼다. `<sp>/r4c/wt`(8f715ff)와 비교용 `<sp>/r4c/wt0`(d4f67cd)다. node_modules 는 링크했고, 끝난 뒤 링크를 지우고 둘 다 `git worktree remove` 했다.
- 순서:
  - 각 worktree 의 `frontend` 에서 `npm run build`.
  - `backend` 에서 `nohup python -m devtools.fake_server --port 8797 --data-dir <sp>/r4c/data --reset` 로 띄웠다(비교용은 8798 · data0). pid 파일로 띄우고 `kill $(cat pid)` 로 껐다.
  - owner@example.com 로 로그인했다.
- audit: `node <wt>/docs/design/audit.mjs --base http://127.0.0.1:8797 --out <sp>/r4c/audit`. 결과는 `<sp>/r4c/audit/summary.md` · `results.json` 이다. 앞 판정의 결과는 `<sp>/r4b/audit` 에 있다.
- 탐침: `<sp>/r4c/js/`
  - `q1.mjs` 줄 배치 · 넘침 · 갈라짐(폭 20가지)
  - `q2.mjs` TIGER 이름 줄 수 · 폭
  - `q3.mjs` 제목 Range
  - `q4.mjs` 읽기 이름 · 시트 글
  - `q5.mjs` / `q5old.mjs` 현금 카드 새 돈 + 나누기(8f715ff / d4f67cd)
- 돌연변이: `<sp>/r4c/mut.sh`. 7개 중 6개를 잡았다.
- 스크린샷: `<sp>/r4c/shots/`(`cash-cmp.png`, `rb-*.png`, `tiger-*.png`).
- 로그: `<sp>/r4c/vitest.log` · `lint.log` · `tsc.log` · `build.log` · `audit.log`.

## git status

- 검토 worktree 두 개를 지우기 전 `git status --short`: 둘 다 빈 출력.
- 저장소 /home/user/Dashboard `git status`: "On branch claude/design-4-zerobase / Your branch is up to date with 'origin/claude/design-4-zerobase'. / nothing to commit, working tree clean". HEAD 는 8f715ff 다.
