# 묶음 4 리밸런싱 네 번째 검토 판정 (22be4b0, 앞 판정 4-review-3.md · 8f715ff)

## 판정: **합격**

앞 판정의 조건 하나(현금 칸 안내 글 잘림)가 풀렸다. 앞 판정과 같은 탐침으로 다시 재현해 확인했다.
보완이 앞 판정에서 통과한 것을 깨지 않았다. 긴 이름 세 줄 · folded3 · clipped · fake-button · 주문 줄 넘침 · 갈라짐 · 좁은 PC 줄 묶음 모두 앞과 같다.
`git diff d4f67cd 22be4b0 -- frontend/src/styles/` 를 보면 container query 밖은 d4f67cd 와 글자 하나 다르지 않다. 남은 변경은 `.order-card { container-type }` 와 `@container (max-width: 320px)` 안의 `button.order-row` 규칙뿐이다. 그래서 현금 줄(`div.order-row.static`)과 321px 넘는 카드는 8f715ff 이전과 같게 그려진다.

## 앞 조건 1 — 다시 재현

| 조건 | 결과 | 재현과 증거 |
| --- | --- | --- |
| 1 현금 칸 안내 글 잘림(새 돈 + 팔지 않고 나누기) | **통과** | 탐침은 `r4c/js/q5.mjs` 에서 포트만 8807 로 바꾼 `r4d/js/q5.mjs` 다. 결과(`r4d/q5.log`): 300 dark · 320 light · 360 dark · 390 light × 금액 500000 · 1234567890 의 8가지 모두 over [] · split [] · lab3 [] · pageOver 0 이다. 현금 줄은 "현금 \| 목표 0% \| ₩500,000 → ₩0 남음 \| 1주 미만 7종목을 못 사면 그만큼 더 남음" 이고, 높이는 300/320/360/390 모두 **63px** 다(앞 판정에서는 360/390 이 113px). 아주 큰 금액은 300/320 에서 82px · 360/390 에서 63px 다. 스크린샷 `r4d/shots/cash-300-6.png` 에서 "…그만큼 더 남음" 이 끝까지 보인다. `r4c/shots/old-cash-300-6.png`(d4f67cd)와 같은 모양이다. |

## 보완이 앞 통과를 깨지 않았나

| 항목 | 결과 | 증거 |
| --- | --- | --- |
| 긴 이름 세 줄(TIGER 미국필라델피아반도체나스닥) | 통과 | `q2.mjs`(`r4d/q2.log`) 결과다. 300 · 320 · 340 · 350 → label **1줄**(카드 272~322, 주수 · 금액이 아랫줄, 82px)이다. 360 · 375 · 390 → 2줄(69px)이고, 412 · 430 → 1줄(60px)이다. 앞 판정과 같다. |
| 주문 줄 배치 · 넘침 · 갈라짐(폰 300 · 320 · 360 · 390 · 글자 130% · 다크/라이트) | 통과 | `q1.mjs`(`r4d/q1.log`)로 20가지 폭을 쟀다. over 0 · split 0 · pageOver 0 · console 0 이다. 300/320(글자 130% 포함)은 stacked **15** · same 1 이다. 앞 판정은 16 이었는데, 차이는 현금 줄이 이제 한 줄 배치인 것이다(의도한 것). hmax 는 93 → **82** 다. 360/390 은 same 16 · hmax 69 로 앞과 같다. q1 의 lab3 1(360/390, `.order-row-title` = 이름 2줄 + 배지)은 8f715ff · d4f67cd 를 같은 탐침으로 다시 돌려도 똑같이 1이다(audit 의 folded2-360 과 같은 것이고, 새로 생긴 것이 아니다). |
| 좁은 PC 줄 묶음 600 · 720 · 721 · 800 · 900 · 1000 · 1100 | 통과 | 모두 table False(줄 묶음)이고 same 16(한 줄 배치) · hmax 63 · over 0 · split 0 이다. 앞과 같다. |
| audit 397 | 통과 | 열지 못함 0 · page-overflow 0 · clipped 0 · folded3 0 · fake-button 0 · touch 0 · contrast 0 · orphan 20 · num-split 23 · folded2-360 40 이다. rebalance 10줄은 `r4c/audit` 과 diff 가 **같다**. 요약에서 달라진 것은 console 0 → 2 하나다. 둘 다 stock-detail ph390-dark(·risered)의 "Object is disposed" 다. `--only stock-detail` 로 다시 돌리면 console **0** 이다(`r4d/audit-sd`). 같은 글이 이전 라운드 `r4/audit` 에도 한 번 있었다. 이번 변경은 CSS 뿐이고 stock-detail 과 관계없으니, 흔들리는 것으로 본다. |
| 테스트 · 린트 · tsc · 빌드 | 통과 | `npx vitest run` → **1122 passed (1122)**, 68 files. oxlint 경고 **20**. `tsc -b` 종료 0. `npm run build` 성공. 8f715ff..22be4b0 은 css 1개와 문서뿐이다. |
| CSS 300줄 · 색표 밖 색 | 통과 | rebalance-sheets.css 는 **294줄**(앞 296)이고 orders 는 249줄이다. 더한 줄에 `#hex`/`rgb(`/`hsl(` 는 0 이다. |
| 기록 | 통과 | `4-보완.md` 에 재검토(4-review-2) 보완 표와 세 번째 검토 보완 표가 둘 다 생겼다. 앞 판정 참고 3 도 풀렸다. |

## 참고(조건 아님)

1. 폰 300 · 320 에서 새 돈을 아주 크게(1,234,567,890) 넣으면, 현금 줄 왼쪽의 "목표 0%" 가 "목표 / 0%" 로 접힌다(82px, `r4d/shots/cash-300-10.png`). d4f67cd(`r4c/shots/old-cash-300-10.png`)에서도 똑같으니 이번 보완 때문이 아니다. 이 금액(12억)이 실제로 쓰일 일은 드물다. 고친다면 현금 줄 `.order-row-meta` 에 `white-space: nowrap` 정도면 된다.
2. 앞 판정 참고 1(카드 ≤ 320px 에서는 짧은 이름도 두 단, 60 → 82px)은 그대로다. `4-보완.md` 가 ② 에 알릴 것으로 적어 두었다.
3. 앞 판정 참고 2(`RebalancePanel.tsx:1389` `narrow` → `compact` 돌연변이가 살아남음)는 이번 커밋 범위 밖이라 다시 재지 않았다.
4. CSS 주석의 "카드가 320px 아래(폰 320 · 글자 130%)" 는 정확하지 않다. 글자 130% 라도 폰 390 에서는 카드가 362px 라 걸리지 않는다. 걸리는 것은 폰 320 · 300 · 350 이다. 주석만의 문제다.
5. 이번 변경은 CSS 의 배치라 jsdom 테스트로는 잡을 수 없다. 현금 줄 회귀는 audit 상태에 "새 돈 + 나누기" 가 없어서 앞으로도 audit 이 잡지 못한다. 넣어 둘 만하다.

## 재현 환경

- `<sp>` = /tmp/claude-0/-home-user-Dashboard/c9553d42-71a5-5379-90e1-1c42ba786c3a/scratchpad
- 작업 트리: 저장소 밖 detached worktree 셋을 썼다. `<sp>/r4d/wt`(22be4b0)와 비교용 `<sp>/r4d/wtp`(8f715ff) · `<sp>/r4d/wt0`(d4f67cd)다. node_modules 는 링크했고, 끝난 뒤 unlink 하고 셋 다 `git worktree remove` 했다.
- 순서:
  - 각 worktree 의 `frontend` 에서 `npm run build`.
  - `backend` 에서 `nohup python -m devtools.fake_server --port 8807 --data-dir <sp>/r4d/data --reset` 로 띄웠다(비교용은 8808 · 8809). pid 파일로 띄우고 `kill $(cat pid)` 로 껐다.
  - owner@example.com 로 로그인했다.
- 탐침: `<sp>/r4d/js/q1.mjs` · `q2.mjs` · `q5.mjs`. r4c 것에서 포트와 스크린샷 경로만 바꿨다. `q1_8808.mjs` · `q1_8809.mjs` 는 비교용이다. 로그는 `<sp>/r4d/q1.log` · `q2.log` · `q5.log` 이고, 스크린샷은 `<sp>/r4d/shots/` 에 있다.
- 재현(조건 1): 가짜 서버 → /rebalance, 폰 300 또는 320. "새로 넣을 돈"을 펼쳐 500000 을 넣고 "팔지 않고 새 돈만 나누기"를 켠다. 현금 카드의 안내 글이 끝까지 보이고, 줄은 63px 다.
- audit: `node <wt>/docs/design/audit.mjs --base http://127.0.0.1:8807 --out <sp>/r4d/audit`. 다시 돌린 것은 `--only stock-detail --out <sp>/r4d/audit-sd` 다.
- 로그: `<sp>/r4d/vitest.log` · `lint.log` · `tsc.log` · `build.log` · `audit.log`.

## git status

- 검토 worktree 셋을 지우기 전 `git status --short`: 셋 다 빈 출력(node_modules 링크를 걷어 낸 뒤에도 빈 출력).
- 저장소 /home/user/Dashboard `git status`: "On branch claude/design-4-zerobase / Your branch is up to date with 'origin/claude/design-4-zerobase'. / nothing to commit, working tree clean". HEAD 는 22be4b0 다.
- `git worktree list` 에는 내가 만들지 않은 옛 검토 worktree 둘(`<sp>/r3/wt` bb04e7d, `<sp>/r3b/wt` 8f57144)이 남아 있다. 손대지 않았다.
