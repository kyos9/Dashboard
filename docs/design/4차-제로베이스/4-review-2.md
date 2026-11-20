# 묶음 4 리밸런싱 재검토 판정 (d4f67cd, 앞 판정 4-review.md · bce7275)

## 판정: **조건부 합격**

앞 판정의 조건 6개는 모두 풀렸다. 하나씩 같은 방법으로 다시 재현해 확인했다.
보완 때문에 생긴 회귀는 두 가지 쪽에서 살폈다. 다시 받아 올 때 고친 목표 · 밴드를 남기는 부분, 그리고 RebalancePanel.tsx 의 꼴 되돌림이다. 두 쪽 모두 회귀가 없다.
남은 조건은 셋이고 모두 작다.
- 조건 1의 말줄임을 고치면서 생긴 새 회귀 하나: 아주 좁은 폭에서 이름이 세 줄로 접힌다.
- 좁은 PC 전환에 테스트가 없다.
- 문구 변경 표가 따라오지 않았다.

## 앞 조건 1~6 — 다시 재현

| 조건 | 결과 | 재현과 증거 |
| --- | --- | --- |
| 1 말줄임 | 통과 | 폰 390 · 360 · 320(라이트 · 다크 · 상승 빨강)에서 `.order-row-label` 의 scrollWidth > clientWidth 는 0이다(`p1.mjs`). audit `clipped` 는 7 → **0** 이다. "TIGER 미국필라델피아반도체나스닥"은 이제 잘리지 않고 접힌다. 390 에서는 2줄, 320 에서는 3줄이다(새 조건 1). |
| 2 숫자 갈라짐 | 통과 | 시트 15개를 하나씩 열어 `.order-sheet-act` 안의 글 노드마다 Range 줄 수를 쟀다(`p3b.mjs`). 390 · 360 · 320 · 300 모두 **갈라짐 0**, 시트 넘침 0이다. 예: "−1,641주 / 계산으로는 1,641.27주 · 1주 단위로 내림 / −₩141,295,447" (b 안의 `small` 은 일부러 다음 줄로 보낸 것이라 뺐다). audit 에서 rebalance 의 num-split 은 0이다. |
| 3 가짜 단추 | 통과 | 요약의 "현금" · "기본 밴드"는 `span.rb-pill.static` 이고 테두리 0px, 바탕 없음이다(`p5.mjs`). 단추는 "다음 리뷰" · "목표 합계" 둘뿐이다. audit `fake-button` 은 18 → **0** 이다. |
| 4 시트 포커스 | 통과 | 폰 390 · 320 에서 주문 줄에 포커스를 두고 Enter 를 누르면 activeElement 가 "IN:자세히 닫기"로 들어간다. 좁은 PC 1000 에서도 같다. Tab 12번 · Shift+Tab 4번은 시트 안에서만 돈다. 거래 칸을 펼쳐도 같다. `Sheet.tsx:30` `useFocusTrap(ref, () => initialFocus?.() ?? closeRef.current)`. 돌연변이(`?? null`)를 넣으면 테스트가 실패한다. |
| 5 뒤로가기 · 잠금 테스트 | 통과 | 돌연변이 둘이 이제 잡힌다. `Sheet.tsx` 의 `useBackToClose(onClose)` 를 지우면 1 failed, `const release = lockBodyScroll()` 을 `() => {}` 로 바꿔도 1 failed 이다. 브라우저에서는 뒤로가기로 닫히고, 열린 동안 body overflow hidden, 뒤 화면 스크롤 0 → 0, 닫으면 '' 로 돌아온다. |
| 6 합계 · 저장 안 한 변경 | 통과 | 합계: 시트에서 첫 칸에 +10 을 치면 머리가 "합계 90.0% … 맞추면" → "합계 100.0% … 100%로 맞습니다"로 바뀐다(390 · 360 · 320). 닫힘: 값을 고친 뒤 Esc · 뒤로가기로 닫으면 페이지에 "목표 · 밴드에 저장하지 않은 변경 1줄 (VOO) 열어서 저장"이 뜬다(390 · 320 · 1000 · 1280). 그사이 거래를 반영해도 이 줄과 값은 남는다(아래 회귀 검사 A). |

## 보완이 새 회귀를 만들었나

| 항목 | 결과 | 증거 |
| --- | --- | --- |
| A. 다시 받아 올 때 고친 목표 · 밴드 남기기(unsavedRef · keepDrafts 머지) | 통과 | 실제 가짜 서버(`p6.mjs`), 폰 390 과 좁은 PC 1000 에서 각각 이 순서로 했다. ① 주문 시트 → "목표 · 밴드 고치기" → VOO 목표를 25로 친다. ② 뒤로가기로 닫으면 "저장하지 않은 변경 1줄 (VOO)"이 뜬다. ③ VOO 를 2주 샀다고 반영한다. 서버 수량은 40 → 42, 평단가 85.89 → 86.79 다. 표시 줄은 남는다. ④ "열어서 저장"을 누르면 값 25 가 그대로 있고 "바뀐 1줄 저장" → "✓ 1줄을 저장했습니다"가 뜬다. 서버는 수량 42 · 목표 25 이고 표시 줄은 0이 된다. ⑤ 새로고침 뒤 표시 줄 0. **나간 쓰기 요청은 두 개뿐이다**: `PUT /holdings/VOO {"quantity":42,…}`(거래) · `PUT /targets/VOO {"target_weight_pct":25,"rebalance_band_pct":null}`. 옛 수량 · 평단가 · 산 환율을 다시 보내지 않았다. 코드: `RebalancePanel.tsx:868-876`(머지가 target · band 만 남기고 나머지는 `draftOf(fresh)`), `:979`(저장 뒤 `unsavedRef = {}`, 실패한 줄만 keepDrafts). |
| A 의 돌연변이 | 통과 | 아래는 모두 `RebalancePanel.test.tsx` 가 잡는다(67 중 1 failed). 머지를 `{ ...k }`(옛 수량을 보냄)로 바꾸기, `unsavedRef` 를 kept 에서 빼기, 저장 뒤 `unsavedRef = {}` 지우기(저장 성공한 줄이 남음), 합계를 `plan.targetSum` 으로 되돌리기, 표시 줄 지우기, 닫아도 "저장했습니다" 남기기. |
| B. bce7275 → 53e8245 의 RebalancePanel.tsx 차이 | 통과 | `git diff bce7275 53e8245 -- RebalancePanel.tsx` 는 +92 −18 이다(`-w` 로도 같다). 세미콜론으로 끝나는 줄 수는 bce7275 · 53e8245 둘 다 1로 같다. 차이를 한 줄씩 읽었고 모두 4-보완.md 의 두 표에 있는 항목이다: useMedia/compact, targetNote, unsavedRef · 머지, 판 돈 안내, badge-sell, 읽기 이름(비중 · 밴드 밖 · 금액), aria-controls · scrollIntoView, draftSum, 표시 줄, 유지 "(팔지 않고 나누기라…)", 1주 미만 안내, 폰만 타일, "구분", 정수 주 + "계산으로는", "목표 · 밴드 고치기", 평단가 안내. 그 밖의 변경은 없다. 3794eaa 의 동작이 되돌림에서 빠졌는지도 보았다. 3794eaa 와 53e8245 를 공백 · 세미콜론 · `{" "}` 를 지워 맞대 보았고, 남은 차이는 조건 4~6 보완뿐이다. 빠진 동작은 없다. |
| C. 좁은 PC(1100 아래) 줄 묶음 | 통과(참고 1) | 1100 · 1000 · 900 · 800: 표 없음, 줄 15, 타일 없음, 머리 단추(목표 · 밴드 · 기록 · 설정) 있음(`p4.mjs`). 페이지 넘침 0, 잘림 0. 줄을 누르면 시트가 열리고 포커스가 닫기로 간다. 1101 이상은 6열 표다. **다만 1101~1230 에서는 여전히 표 안 스크롤이다**(1101: 942 > 811, 1220: 942 > 930, 1240 부터 다 들어감). 아래 참고 1. |
| D. 시트 포커스 · 뒤로가기 | 통과 | 주문 시트에서 "목표 · 밴드 고치기"를 누르면 주문 시트가 닫히고 목표 시트만 남는다(dialogs = ['목표 비중 · 밴드 고치기']). 포커스는 "VOO 목표 비중"이고, history.state 는 `{"__modal":1}` 이다. 칸이 하나만 쌓였다. 이어서 뒤로가기를 한 번 누르면 목표 시트가 닫히고 주소는 /rebalance 그대로다. 주문 시트를 Esc · 뒤로가기 · 바깥으로 닫으면 연 줄 단추로 포커스가 돌아온다. 콘솔 오류 0. |
| 테스트 · 린트 · tsc · 빌드 · 백엔드 | 통과 | `npx vitest run` → **1121 passed (1121)**, 68 files. oxlint 경고 **20**. `tsc -b` 종료 0. `npm run build` 성공(RebalancePanel 청크 50.19 kB). `pytest -q` → **1611 passed, 5 skipped**. |
| 기능 불변 경로 | 통과(참고) | bce7275 → d4f67cd 의 `frontend/src/lib` 변경은 `narrow.ts` 에 `useMedia` 훅을 더한 것 하나다(폭 질의, 계산 아님). api · types · AppState · backend 변경 0. |
| CSS 300줄 · 색표 밖 색 | 통과 | rebalance-orders 249 · sheets 275 · table 78줄. 바뀐 css 의 `#hex`/`rgb(`/`hsl(` grep 0. 새 `.badge-sell` · `.rb-unsaved` 는 토큰만 쓴다. |
| 상승 빨강 · 띠 색 | 통과 | 320 다크 상승 빨강: 팔기 띠 · 글자 rgb(122,167,255), 사기 rgb(244,113,113). 시트 "기간 내 매도" 배지는 `badge-sell`(테스트 있음). |
| audit 397 조합 | 조건 1 | 열지 못함 0 · page-overflow 0 · clipped **0** · fake-button **0** · touch 0 · contrast 0 · console 0 · 외톨이 20 · num-split 23(rebalance 0 — fundamentals · 진단 · macro 날짜 문자열, 앞 r4 와 같은 자리) · 360 두 줄 40 · **folded3 1(0 → 1, rebalance ph390-text130-dark)** · 나머지 0. |

## 조건 (보완)

1. **긴 종목 이름이 줄 단추 안에서 세 줄로 접힌다**(3-2 "접힌 짧은 요소 3줄 이상 0", 기준 0 → 1). 조건 1(말줄임)을 고치면서 생겼다.
   - 위치: `rebalance-sheets.css` `.order-row-label`(`text-wrap: balance; word-break: keep-all; overflow-wrap: anywhere`). 이름 칸이 오른쪽 숫자 칸(90px)과 화살표에 밀려 좁다.
   - 재현: 가짜 서버 → /rebalance, 폰 320(또는 audit 의 ph390-text130 = 폭 300). 첫 줄 "TIGER 미국필라델피아반도체나스닥"의 Range 줄 수가 3이고, 줄 높이는 85px이다(`p7.mjs`: 320 → 이름 칸 123px · 3줄, 360 → 163px · 2줄, 390 글자 130% → 2줄).
   - audit: `folded3` rebalance ph390-text130-dark 1건. 360 에서는 같은 이름이 `folded2-360` 2건이다(목록용, 참고).
   - 고치는 길(하나): 좁은 폭에서는 이름이 줄 전체 폭을 쓰게 하고 숫자를 그 아래로 보낸다. 아니면 숫자 칸 폭을 줄인다. 말줄임으로 돌아가면 안 된다.
2. **좁은 PC 줄 묶음 전환에 테스트가 없다**(6장 8 "고친 깨짐마다 다시 생기지 않는지 보는 테스트").
   - 재현: `RebalancePanel.tsx:795` 의 `useMedia('(max-width: 1100px)') || narrow` 를 `narrow` 로 바꿔도 `npx vitest run src/pages/RebalancePanel.test.tsx` 가 67 passed 그대로다. jsdom 에서 `useMedia` 는 늘 거짓이기 때문이다.
   - 고치는 길: 테스트에서 `window.matchMedia` 를 흉내 낸다(`(max-width: 1100px)` 에 matches true). 그러면 표(`table.order-table`)가 없고 "줄일 종목" · "늘릴 종목" 묶음과 머리 단추가 있으며 타일은 없음을 본다.
3. **문구 변경 표(`문구변경.md`)가 3794eaa · 53e8245 를 따라오지 않았다**(3-1 "고친 테스트는 문구 변경 표의 항목과 1:1").
   - 재현: `git diff bce7275 d4f67cd --stat -- docs/design/4차-제로베이스/문구변경.md` 를 돌리면 빈 출력이 나온다.
   - 그런데 테스트 11곳의 이름은 바뀌었다. 줄 읽기 이름에 " · 비중 …% 에서 목표 …% · 비중이 밴드 밖 · 금액"이 붙었고, "005930.KS 목표 비중"은 "삼성전자 목표 비중"이 되었다.
   - 새 글도 여럿 생겼다: 판 돈 안내 · "✓ n줄을 저장했습니다 — …" · "목표 · 밴드에 저장하지 않은 변경 n줄 (…) 열어서 저장" · "계산으로는 n주 · 1주 단위로 내림" · "구분 …" · "수량 · 평단가는 …" · "유지 n (팔지 않고 나누기라 줄일 종목도 여기)" · "1주 미만 n종목을 못 사면 그만큼 더 남음" · "목표 · 밴드 고치기".
   - 표 94줄의 "읽기 프로그램 이름에만 'VOO 621주 (621.36) 사기 — 자세히'"는 이제 틀린 설명이다.
   - 고치는 길: 4-보완.md 에 적힌 것을 표의 줄로 옮긴다(문서만).

## 참고(조건 아님)

1. **1101~1230px PC 에서는 여전히 표 안 스크롤로 "비중조절 신호" · "거래" 열이 오른쪽에 숨는다.** 넘어가는 경계는 1100 인데, 표가 다 들어가는 폭은 약 1240 부터다.
   - 1440 화면을 125% 로 보면 1152px 이라 여기에 걸린다. 사용자 확인의 150%(1920 → 1280)는 괜찮다.
   - 경계를 1240 근처로 올리면 함께 풀린다. 4-보완.md 가 ③ 으로 넘긴 항목과 같다.
2. 목표 시트가 열려 있는 동안에는 "저장하지 않은 변경" 줄을 숨긴다. 이 조건(`!targetsOpen`)을 빼도 테스트가 통과한다. 겉모습 문제라 참고로만 둔다.
3. 거래 칸 수량 입력의 읽기 이름이 아직 티커다("381180.KS 거래 수량"). 사용자 확인 "005930.KS 밴드 임계값"과 같은 종류다.
4. 주문 시트가 열려 있어도 뒤 화면의 "목표 합계 … 목표 · 밴드 고치기" 단추가 접근성 트리에 남는다(playwright getByRole 이 두 개를 찾음). 가두기는 Tab 기준으로 맞게 돈다. `inert` 가 없다는 뜻이고 앞 묶음부터 같다.
5. status.md 의 audit 수치(53e8245: num-split 14 · console 4 · "나머지 0")는 이번 측정(d4f67cd: num-split 23 · console 0 · folded3 1)과 다르다.
   - num-split 과 console 의 차이는 날짜 문자열과 종목 안 차트 쪽이라 이번 묶음과는 무관해 보인다.
   - folded3 1 은 조건 1 이다.
6. 앞 판정의 참고(거래 칸을 펼친 채 Esc 를 누르면 시트째 닫힘, 반영 뒤 줄이 다른 묶음으로 가면 포커스를 잃음, PC 합계 줄의 목표 금액 합계)는 그대로 남아 있고, 4-보완.md 대로 ③ · ② 로 넘어간다.

## 재현 환경

- `<sp>` = /tmp/claude-0/-home-user-Dashboard/c9553d42-71a5-5379-90e1-1c42ba786c3a/scratchpad
- 작업 트리: 저장소 밖 worktree `<sp>/r4b/wt`(d4f67cd, detached)를 썼다. node_modules 는 저장소 것을 링크했고, 끝난 뒤 링크를 지우고 worktree 를 제거했다.
- 순서:
  - `frontend` 에서 `npm run build`.
  - worktree `backend` 에서 `nohup python -m devtools.fake_server --port 8796 --data-dir <sp>/r4b/data --reset` 로 띄웠다. pid 파일로 띄우고 `kill $(cat pid)` 로 껐다. audit 전에 `--reset` 으로 다시 띄웠다.
  - owner@example.com 로 로그인했다.
- audit: `<sp>` 에서 `node <wt>/docs/design/audit.mjs --base http://127.0.0.1:8796 --out <sp>/r4b/audit`. 결과는 `<sp>/r4b/audit/summary.md` · `results.json` 이다. 앞 판정의 결과는 `<sp>/r4/audit` 에 있다.
- 탐침: `<sp>/r4b/js/`
  - `p1.mjs` 폭 · 색 · 터치 · 잘림
  - `p2.mjs` 시트 Tab · Esc · 뒤로 · 스크롤 · 저장 안 한 표시
  - `p3.mjs` · `p3b.mjs` 시트 숫자 갈라짐 · 합계
  - `p4.mjs` PC 표 · 줄 묶음 경계
  - `p5.mjs` 이름 줄 수 · 알약
  - `p6.mjs` 저장 안 한 목표 + 거래 반영 + 저장의 쓰기 요청
  - `p7.mjs` 이름 칸 폭
- 돌연변이: `<sp>/r4b/mut.sh`(worktree 안에서 sed 로 바꾸고 RebalancePanel.test 를 돌린 뒤 되돌림). 11개 중 9개를 잡았다. 살아남은 둘은 조건 2(compact)와 참고 2다.
- 스크린샷: `<sp>/r4b/shots/`.

## git status

- 검토 worktree 를 지우기 전 `git status --short`: (빈 출력)
- 저장소 /home/user/Dashboard `git status`: "On branch claude/design-4-zerobase / Your branch is up to date with 'origin/claude/design-4-zerobase'. / nothing to commit, working tree clean". HEAD 는 d4f67cd 다.
