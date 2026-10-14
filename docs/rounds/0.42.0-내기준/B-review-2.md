조건부 합격

# 0.42.0 B. 작은 화면 고치기 묶음 — 2차 검토자 판정

- 본 커밋: `2d3cdb8` (origin/claude/new-session-fftcg1, detached). B 범위 676051d · ba27e49 · 7718967 · 2d3cdb8, 라운드 시작 289b097.
- 검토자 worktree: `/home/user/Dashboard/.claude/worktrees/agent-a5c50da4de7d42365`. `frontend/node_modules` 는 본 저장소 것을 가리키는 심볼릭 링크로 두었다(gitignore 대상이고, 끝날 때 지웠다).
- 가짜 서버: 포트 8363 (`--data-dir .../scratchpad/revB4/data --reset`, PID 28273). PID 로 껐고, 끈 뒤 `/api/health` 는 응답이 없었다(000). 응답 사진은 `tools/snapshot.py` 가 같은 포트로 자기 서버를 띄우고 끈다.
- 내 자료: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/revB4/` (pytest.txt, vitest.txt, snap/, openapi.json, ai.json, muts.json, mut.py, mut-result.md, browser.json, shots/). 브라우저 스크립트는 `.../scratchpad/pw/revB4.js`, `revB4b.js`, `revB4c.js`.

## 요약

1차 불합격 조건 가운데 동작 결함(D1·D3·D4, 참고 D2)은 모두 풀렸다. 브라우저와 단위 시험으로 직접 확인했다. 1차 검토자의 뮤테이션 15줄은 지금 **모두 잡힌다**.
새로 더한 것에서 회귀는 없다. 응답 사진 차이는 B9 의 friend 이름 3곳뿐이고, API 는 `StockOut.shown_name` 하나만 더했다. AI 지시문 상수도 그대로다.
남은 것은 **테스트 빈 곳** 하나다. 내가 새로 넣은 뮤테이션 12줄 중 4줄이 살아남았다(§3 합격 기준은 0).
특히 **N1** 은 1차 판정의 조건 "D1 … 그것을 지키는 화면 테스트"를 아직 채우지 못했다는 뜻이다. 서버 쪽 `shown_name` 은 시험되지만, 화면이 그것을 먼저 쓰는 줄(`display.ts:43`)은 되돌려도 아무 테스트도 깨지지 않는다.
동작은 맞으니 고칠 것은 테스트를 더하는 일뿐이다. 그래서 불합격이 아니라 조건부로 둔다.

## 동작 결함

막음·고쳐야 함: 없음.

| # | 심각도 | 무엇 | 증거 |
| --- | --- | --- | --- |
| d1 | 참고 | '새 돈만 나누기'에서 1주 미만이라고 세는 기준(날 주수 `< 1`)과 카드 글자(소수 둘째에서 반올림)가 다르다. 0.995~0.9999주는 카드에 "1주 사기"로 나오는데, 맨 위 한 줄은 그 종목을 "1주 미만"으로 센다. 드물고 해가 작다. | `frontend/src/pages/RebalancePanel.tsx:1045` `Math.abs(o.shares) < 1`, 글자는 `orderPlan.ts` `sharesText` 의 `Math.floor(Number(abs.toFixed(2)))` |
| d2 | 참고 (전부터 있던 것) | 몫이 0.005주 미만이면 "1주 미만 (0주) 사기"가 된다. 잡음 기준이 새 돈의 0.5% 라서, 새 돈이 작고 비싼 종목이면 생긴다. 예: 새 돈 10만 원이면 기준이 500원이고, 13만 원짜리 1주에 대해 0.0038주. 2d3cdb8 전에도 같았다(`whole=0, exact=0`). | `orderPlan.ts` `sharesText` 첫 분기 |

## 테스트 빈 곳 (살아남은 뮤테이션)

`revB4/mut.py`: 1차 검토자의 `revB3/mut.py` 를 이 worktree 경로로 바꾸고, 화면 쪽은 **vitest 전체**를 돌렸다. 서버 쪽은 1차와 같은 7개 파일을 돌렸다. 줄마다 파일을 되돌렸고, 끝난 뒤 `git status` 는 깨끗했다. 결과는 `revB4/mut-result.md`.

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| R1~R15 (1차 목록. R14 는 2d3cdb8 에서 `abs` 줄이 없어져 `whole` 줄 뒤에 넣었다) | 1차와 같음 | **15/15 잡힘** — 1차 때 살아남았던 R1~R7·R13·R15 도 모두 잡힌다 |
| N1 `stockLabel` 이 `shown_name` 을 안 봄 (`(stock.name ?? '').trim()`) | `frontend/src/lib/display.ts:43` | **살아남음** — D1 을 고친 핵심 줄인데 화면 테스트가 없다. `grep -rl shown_name frontend/src` 에 테스트 파일이 하나도 없다. `display.test.ts:71-75` 는 `name` 만 쓴다 |
| N2 정수 주를 따로 자름 (옛 D3) | `orderPlan.ts` | 잡힘 (`orderPlan.test.ts` 0.999·61.996 경우) |
| N3 폰 현금 카드가 새 돈만에서도 목표를 보임 | `RebalancePanel.tsx` | 잡힘 |
| N4 1주 미만 세기를 끔 | `RebalancePanel.tsx:1045` | 잡힘 |
| N5 종목 설정 이름 칸 placeholder 를 티커로 | `StockEditModal.tsx:280` | **살아남음** (참고 — 1차 D2 를 고친 줄) |
| N6 차트 `rightOffset: 3` 지움 | `PriceChart.tsx:91` | 잡힘 |
| N7 시그널 카드 DI 값 부호 색 지움 | `Dashboard.tsx:1430` | **살아남음** — 사용자 확인 반영분 |
| N8 시그널 카드 200일선 값 부호 색 지움 | `Dashboard.tsx:1444` | **살아남음** — 사용자 확인 반영분 |
| N9 폰 "새로 넣을 돈 넣기 ↓" 없앰 | `RebalancePanel.tsx` | 잡힘 |
| N10 맨 위 한 줄을 옛 문구 "목표 비중대로"로 | `RebalancePanel.tsx` | 잡힘 |
| N11 `StockOut.shown_name` 지움 | `backend/app/schemas.py:55` | 잡힘 (`test_the_stock_list_also_carries_the_shown_name`) |
| N12 현금 카드 " 남음" 꼬리 지움 | `RebalancePanel.tsx:1185` | 잡힘 |

실행자 `B-mutation.md` 4차(1차 검토자 목록 그대로, 모두 잡힘)는 내 재실행과 맞는다.

## 1차 판정 조건이 풀렸는지

| 1차 조건 | 지금 | 증거 |
| --- | --- | --- |
| D1 폰 리밸런싱 이름 7203.T | **풀림 (동작)** / 테스트는 빈 곳(N1) | 브라우저 friend 360 (`browser.json`): `titles0: ["SCHD 67주 (67.77) 팔기", …, "トヨタ自動車 34주 (34.43) 팔기", "현금"]`, 켠 뒤 `"トヨタ自動車 유지"`. `/api/stocks` → `["7203.T", null, "トヨタ自動車"]` (`name` 은 null 그대로, `shown_name` 만 더해짐). 차트 종목 단추와 종목 관리도 `トヨタ自動車`(`mgrNames`, `histText`, `shots/friend-360-chart-samsung-6m.png`). B-user 의 "차트 종목 단추 7203.T"도 같이 풀렸다 |
| D2 수정 창 placeholder (참고) | 풀림 / 테스트 없음(N5) | `revB4b.js`: `["トヨタ自動車 표시 이름", "", "トヨタ自動車"]`(값은 빈칸, placeholder 는 공용 이름). 수량만 바꿔 "1종목 저장" 한 뒤에도 `/api/stocks` 는 `[null, "トヨタ自動車"]` 다. 공용 이름이 내 이름 칸에 저장되지 않는다 |
| D3 정수·괄호 반올림 어긋남 | 풀림 | `orderPlan.ts` `sharesText`: `exact=toFixed(2)`, `whole=floor(exact)`. 테스트 `orderPlan.test.ts` 0.999→"1주", 61.996→"62주", 61.994→"61주 (61.99)". N2 잡힘 |
| D4 폰 현금 카드 목표 대신 남는 현금 (참고) | 풀림 | `RebalancePanel.tsx:1182-1185` `current + adjust` + " 남음". 브라우저 `cashOn: "₩1,000,000 → ₩0 남음"`, 테스트 `'₩900,000 → ₩500,000 남음'`. 계획의 `cash.targetValue` 는 목표 그대로다(`orderPlan.test.ts` +2줄, R15 잡힘) |
| 살아남은 뮤테이션 R1~R7·R13·R15 | 풀림 | 위 표, 15/15 |
| 문서 참고(`_about`·docstring) | 풀림 | `signalRulesLegacy.json:2` `_about` 이 주인 결정(이름은 지금 화면과 같게)을 말한다. `test_signal_rules.py:164-168` docstring 도 같다 |

## B-user 반영 (status.md 판정 표 B-user 줄)

| 반영했다는 것 | 확인 |
| --- | --- |
| 오늘 ▲ 끝에서 잘림 → 차트 오른쪽 여백 | `PriceChart.tsx:91` `rightOffset: 3`. `shots/friend-360-chart-samsung-6m.png` 에서 마지막 ▲ 가 잘리지 않고 축 이름표 왼쪽에 선다. N6 잡힘 |
| 폰 새 돈 칸이 카드 아래 → "새로 넣을 돈 넣기 ↓" | 브라우저 friend·owner 360: `jumpCount 1`, 누르면 `focused: "new-money"`, `inView: true`. N9 잡힘 |
| 나누는 방식 두 말 → 하나로 | 맨 위 한 줄 "목표에 모자란 만큼에 비례해 나눴습니다"와 아래 안내 "…목표에 모자란 만큼에 비례해 나눕니다"가 같은 말이다. 코드 주석(`orderPlan.ts` buyOnlyPlan)·명세 6.4 의 비례와도 맞는다. N10 잡힘 |
| 1주 미만 몫 안내 | owner 360 `lineOn: "… · 5종목은 1주 미만이라 소수 주를 못 사면 그 몫이 현금에 남습니다"` (QQQ·MSFT·GOOG·KODEX 200·SK하이닉스 5개와 맞다). d1 참고 |
| 카드 DI·200일선 부호 색 | 상승 빨강·다크 390: `["DI 방향 (+DI / -DI)", "v up", "rgb(242, 106, 106)", "35.2 / 17.1"]`, `["200일선 대비", "v down", "rgb(93, 152, 248)", "-5.2%"]`. 동작은 맞다. 테스트 없음(N7·N8) |
| 무관한 것은 다음 라운드 후보 | status.md:73 에 적혀 있다. B 범위 밖이라 보지 않았다 |

## §3 검사표

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 완료 조건 | 통과 (테스트 하나 빠짐) | B1~B9 동작은 1차가 통과로 본 것에 D1·D3 이 더해져 모두 맞다. "고치기 전 실패하는 테스트"가 D1 의 화면 쪽에만 없다(N1) |
| 계획 때 걱정 | 통과 | plan-dev B9 "`/api/stocks` 는 그대로": `name` 의 뜻은 바뀌지 않았고 필드만 더했다(`schemas.py:54-55` 주석). 수정 창 초안은 날 `name` 을 쓰고, 저장해도 null 이 유지된다(위 D2). plan-user B9 "리밸런싱도 코드로만" 은 폰까지 풀렸다 |
| 회귀 | 통과 | `pytest` → `1350 passed, 3 skipped` (시작 1309, 1차 1349). `vitest run` → `Test Files 58 passed (58) / Tests 860 passed (860)` (시작 807, 1차 852). `tsc -b` 종료 0. `npm run lint` 경고 22 (시작 23). 응답 사진: `snapdiff.py baseline/snap revB4/snap` → `차이 3` 이고, 셋 다 `friend-…name: None → 'トヨタ自動車'`(dashboard[3], fundamentals[3], rebalance rows[3]). B9 의 의도된 3곳 말고는 차이가 없다. `/api/stocks` 는 기준 경로에 없어 브라우저 fetch 로 따로 봤다(위 D1) |
| 격리 | 해당 없음 | B 는 새 엔드포인트가 없다. `shown_name` 은 그 사람의 `user_stock` 행에서 나온다(`models.py:131-135`) |
| 마이그레이션 | 해당 없음 | 새 리비전이 없다. `shown_name` 은 읽기 속성이다 |
| 호환 | 통과 | `apidiff.py baseline/openapi.json revB4/openapi.json` → `빠짐 0`, `타입 바뀜 0`, 더해짐 9. 그중 B 는 `StockOut.shown_name` 하나이고 나머지 8은 A 다. 옛 화면 + 새 서버: 모르는 필드라 무시한다. 새 화면 + 옛 서버: `shown_name` 이 없으면 `name ?? ''` 로 떨어진다(`display.ts:43`, `types.ts` `shown_name?:`). 기본값은 지금과 같다. 새 돈만 나누기의 처음 상태는 꺼짐이다(`startChecked: false`, R3 잡힘) |
| 입력 한도 | 해당 없음 | 새로 받는 입력이 없다(단추 하나, 표시만) |
| 뮤테이션 | **실패** | 1차 목록 15/15 잡힘. 내 새 12줄 중 **4줄 살아남음**(N1·N5·N7·N8) |
| 비밀 | 통과 | `ai_consts.py` 결과: 18 = 18, 다른 키는 `__file__`/`__cached__` 뿐이다. B 커밋은 `ai_analysis.py`/`ai_portfolio.py` 를 건드리지 않았다(`git log 289b097..2d3cdb8 -- …ai_*` → A 커밋 d12fd41 하나) |
| 규제 | 통과 | `git diff 7718967 2d3cdb8 -U0 -- frontend/src backend/app` 의 더한 줄에서 "추천·사세요·팔라·저평가·예측·수익률·매수하·매도하"는 0건이다. 새 안내 "소수 주를 못 사면 그 몫이 현금에 남습니다"는 사실을 설명하는 글이다. 카드 색은 부호 색(up/down)만 쓰고 시그널 색 `.tone-*` 은 건드리지 않았다(`Dashboard.tsx:1430,1444`) |
| 데이터 경계 | 해당 없음 | 새 테이블·컬럼이 없다 |
| 외부 호출 | 통과 | `instrument` 는 `lazy="joined", innerjoin=True` 라(`models.py:126`) `/api/stocks` 에 쿼리가 늘지 않는다 |
| 화면 | 통과 (부분 재검) | 폰 360 friend·owner × 금액 가리기 켬/끔: 가로 넘침 `overflow: 0`, 콘솔 오류 0. 금액 가리기(9-3): 새 돈 `•••••`, 현금 카드 `••••• → ••••• 남음`, 주문 카드의 주수("VOO 3주 (3.22) 사기")는 보인다. 보유 카드 평가액은 `•••••` 다. B 는 보유 수량을 가리는 방식(`qty`)을 바꾸지 않았다(`git diff 289b097 2d3cdb8 -- RebalancePanel.tsx` 에서 qty/hide 줄 변경 0). PC 1400·390 × 두 테마 전 화면 자동 검사는 다시 돌리지 않았다(1차·사용자 확인이 봤고, 2d3cdb8 의 화면 변경은 위에서 하나씩 봤다) |
| 성능 | 통과 | 첫 화면 JS gzip `index-*.js 110.31 kB` (시작 109.79, 1차 110.28) |
| 가짜 서버 | 통과 | `pytest tests/test_devtools.py` → `12 passed`. 지인 7203.T(이름 없음)가 B9 를 그대로 드러낸다 |
| 문서 | 통과 (참고) | 명세 6.4 와 README 는 1차 때 봤다. `shown_name` 은 응답에 더한 필드라 README·ROADMAP 에 API 필드 목록이 없어 적을 곳이 없다(`grep -rn shown_name --include=*.md` 는 라운드 폴더 밖에서 0). 참고: `version.py`·ROADMAP 의 0.42.0 줄은 라운드 끝에 쓴다(1차와 같음) |

## 합격(조건 비움)으로 가려면

1. **N1** — 화면 테스트 하나. `/api/stocks` 가 `{ticker:'7203.T', name:null, shown_name:'トヨタ自動車', market:'JP'}` 를 줄 때 폰 리밸런싱 카드(또는 적어도 `stockLabel`)가 `トヨタ自動車` 를 보이고, `shown_name` 이 없는 옛 서버면 `name`→티커로 떨어지는지. 1차 판정의 D1 조건이다.
2. **N7·N8** — 시그널 카드의 DI·200일선 값에 `up`/`down` 이 붙는지(회색이면 안 붙는지) 보는 테스트.
3. (참고) **N5** — 수정 창 이름 칸 placeholder 가 `shown_name` 인지.
4. 위를 더한 뒤 `revB4/muts.json` 의 N1·N5·N7·N8 을 다시 돌려 모두 잡히는지 본다.

## git status (검토자 worktree, 끝날 때)

```
$ git status
HEAD detached at 2d3cdb8
nothing to commit, working tree clean
$ git rev-parse --short HEAD
2d3cdb8
```
(`frontend/node_modules` 심볼릭 링크는 지운 뒤에 다시 확인했다. 아래 보고 참고)
