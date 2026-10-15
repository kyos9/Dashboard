# 디자인 2차 — 묶음 A + B + 어포던스 재검토 (검토자, worktree, `49a6ff3`)

# 판정: 합격

앞 판정(`AB-review.md`, 조건부 합격)에서 되돌리라고 한 것과 보완하라고 한 것이 모두 풀렸다.
- G1 preload 를 뺐고, `index.html` 이 시작 커밋 `4109146` 과 같다.
- 차트 팝업에서 Tab 이 팝업 밖으로 나가지 않는다. 실제 브라우저로 쟀다.
- 문서(B5 · 용어 사전 구간 · ⋯)를 고쳤다.

새 변경 둘(리밸런싱 '비중·참고' 풀이 한 줄, 매크로 칩 ›)은 회귀를 내지 않았다. 퀵 63조합과 전체 조건 114조합에서 앞 검토(`968cb87`) 대비 늘어난 항목이 0건이다.
아래 "참고" 줄은 합격을 막지 않는다. 다음 차수나 끝 보고에 적을 것들이다.

본 범위: `968cb87` → `7d7cc3f`(검토 반영) → `49a6ff3`(사용자 반영). 기능 불변 비교는 시작 `4109146` 기준이다.
잰 자리: 내 worktree(`agent-ac83a198b429c6864`, HEAD `49a6ff3`)에서 `npm ci && npm run build` 를 했다. 가짜 서버는 8172(`--data-dir /tmp/claude-0/work/rereview-data --reset`)에 띄웠고, 끝에 PID 2575 로 껐다. 다시 부르면 `000` 이 돌아온다.

## 판정 표

| 항목 | 판정 | 증거 |
| --- | --- | --- |
| G1 되돌림이 풀렸나 | 통과 | `git diff 4109146 -- frontend/index.html \| wc -l` → `0`. plan.md:83 G1 줄은 취소선 + "되돌림"이고, 측정값과 3차 후보(부분집합)를 적었다 |
| 기능 불변 (경로 diff) | 통과 | `git diff 4109146 HEAD -- backend frontend/src/api frontend/src/lib frontend/src/types.ts frontend/src/AppState.tsx \| wc -l` → `0` |
| 그 밖 .tsx 한 줄씩 | 통과 | 아래 둘 다 2-2 "해도 되는 것" 안이다. API·계산·저장·aria/role 삭제는 없다. **7d7cc3f**: ChartModal 에 `dialogRef` + document keydown(Tab) 리스너 하나. Dashboard 단추 글자 `보기·설정 ⋯` → `▾/▴`. StockManager 도움말 문구. **49a6ff3**: RebalancePanel 에 조건부 `<p className="hint">` 한 줄(같은 컴포넌트 안 문구·마크업. 조건은 이미 있는 `rowByTicker`·`rebalance_signal.active`·`shoulder_signal_fired_in_period` 만 읽음). index.css 에 `.macro-chip::after { content:'›' }` |
| 테스트 1:1 · 지우기 없음 | 통과 | 새로 쓴 테스트 1(ChartModal "Tab 은 팝업 안에서만 돈다"). 고친 단언 1(Dashboard 순서 편집 `보기·설정 ⋯` → `▾`/`▴`)은 문구.md "시그널 보기(폰)" 줄과 맞는다. 지운 테스트 0. 876 + 1 = **877** |
| 검증 | 통과 | `npm ci` 0 · `npm run lint` 경고 **22**(≤22) · `npx tsc -b` 0 · `npm test` → `Test Files 58 passed (58) / Tests 877 passed (877)` · `npm run build` 0. backend 는 diff 0 이라 pytest 는 다시 돌리지 않았다(앞 판정: 1 failed 는 시작 커밋부터 있던 R8) |
| 차트 팝업 Tab (실제 브라우저, PC 1400) | 통과 | `kbd.log`. Tab 35번째에 표 첫 종목 "VOO" 에 닿고, Enter 를 누르면 팝업이 열린다. **Tab 30번 중 팝업 밖 0번**, 안에서 7개 단추(차트·AI 분석·6개월·1년·5년·전체·닫기)를 돈다. Shift+Tab 30번도 밖 0번이다. 포커스 테두리는 60번 모두 보였다(2px rgb(3,105,161)). blur 로 포커스를 body 로 보낸 뒤 Tab 을 누르면 팝업 첫 단추 "차트" 로 간다. 닫은 뒤에는 Tab 이 다시 평소대로 움직인다(리스너가 남지 않음). 콘솔 오류 0. 앞 판정 때는 30번 중 23번이 밖이었다 |
| 새 테스트가 가두기를 빼면 깨지나 | 통과(참고 하나) | `document.addEventListener('keydown', onTab)` 줄을 주석으로 막고 돌렸다 → `FAIL … ChartModal.test.tsx:402 expected false to be true`. 원래대로 돌리니 `git status` 가 깨끗했다. **참고**: Tab 을 무조건 `preventDefault` 해서 포커스가 꼼짝 않게 하는 변이에도 이 테스트는 **통과**한다. jsdom 에서는 `offsetParent` 가 늘 null 이라 `focusables()` 가 지금 포커스 하나만 돌려준다. 그래서 테스트는 "밖으로 새지 않는다"만 보고 "안에서 돈다"는 보지 못한다. 실제 브라우저에서는 위처럼 돈다 |
| 문서 (B5 · 용어 사전 · ⋯) | 통과(참고 둘) | plan.md B5 줄: "칸마다 짧은 도움말은 하지 않았다 — 이유", "비중에는 영향이 없습니다 되살림". StockManager.tsx:451 에 그 말이 실제로 있다. 문구.md 종목 관리 도움말 줄도 맞다. glossary.md:29 "구간" 은 지금 범례 "매수 43일 (13번)" 으로 고쳤다. glossary.md:39 는 `⋯` = 폰 메뉴만, 펼치기는 ▾/▴ 로 정했고 코드(Dashboard.tsx:879~880)와 화면도 같다(`보기·설정 ▾` aria-expanded=false → 누르면 `▴` true). **참고**: ① StockManager.tsx:448 주석은 아직 "다섯 줄이던 도움말을 **둘로**"이고 문구.md·plan 은 "세 줄"이다(앞 판정 보완 3의 끝부분). ② 앞 판정 보완 5(참고)의 RebalancePanel.tsx:1065 주석 자리와 plan.md:50 D13 답 칸("대시보드 … 같은 말로")은 그대로다 |
| 차트 팝업: 열 때 포커스 옮기기 · 닫으면 돌려주기 | 참고 | 앞 판정 보완 2가 함께 적은 둘이다. 열어도 포커스는 뒤 화면 "VOO" 에 남는다(첫 Tab 에 팝업으로 들어감). Esc 로 닫으면 포커스가 body 로 가고, 다음 Tab 은 바닥글 "개인정보처리방침" 으로 간다. 3-1 기준("팝업 안에서만 돈다")은 넘었다. 다만 둘을 3차로 넘긴다는 말이 plan·status·문구 어디에도 없다 — 끝 보고에 적을 것 |
| 3-2 자동 검사 회귀 — 퀵 전체 화면 | 통과 | `--quick`(폰 390 다크 + PC 1400 다크) 63조합, 열지 못한 것 0. 앞 검토 `968cb87` 대비 늘어난 (화면,조건,검사) **0건**, 같은 날 시작 기준선 대비도 **0건**(`compare-quick.txt`). 넘침·잘림·3줄·360 2줄·터치·대비·콘솔·cond-missing·nowrap-split·sticky-left·quiet-target 모두 0. 남은 것은 앞 검토와 같은 자리다: 외톨이 3 · 숫자 갈라짐 2 · fake-button 2 |
| 3-2 자동 검사 — 리밸런싱·대시보드 전체 조건 | 통과 | 13화면 × 9조건 = 114조합(rebalance, guest-rebalance, dash-portfolio, dash-signal, dash-signal-cards, dash-signal-edit, 두 xcond, dash-holding-open, friend/new-dashboard, guest-home, modal-chart), 열지 못한 것 0. 앞 검토 대비 늘어난 것 **0건**(`compare-full.txt`). 합계: 외톨이 0 · fake-button 0 · quiet-target 0 · cond-missing 0. 숫자 갈라짐 1은 `dash-portfolio pc-zoom150-dark` 의 보유 표 `+₩20,145,600` 으로, 기준선부터 있던 "포트폴리오 150% 1" 이다 |
| 카드 높이 | 통과 | `dash-signal-cards` 폰 390 다크 중앙값 **487**(487~571), 앞 검토와 같다. 폰 360·라이트·빨강 둘도 487. PC 1400 618, 150% 497, xcond 폰 514. 모두 앞 검토와 같다 |
| 새 변경 ① 리밸런싱 '비중·참고' 풀이 | 통과(참고 하나) | `eye.log`, `eye/*-rebalance-orders.png`. 주인 계정은 폰 360·390 두 테마에서 2줄(37px), PC 1400 에서 1줄로 머리말 밑에 보인다. 외톨이·숫자 갈라짐 0. 종목 0 인 새 사용자에게는 나오지 않고(0), 지인 계정은 이름표 비중 3·참고 2 와 함께 나온다. 조건(`rebalance_signal.active \|\| shoulder_signal_fired_in_period`)과 이름표 조건(`reasons.length>0` · 같은 shoulder)이 사실상 같다. **참고**: 끝말 "주문 수는 바꾸지 않습니다"는 "주문 개수"로도 읽힌다. 뜻이 "주문 수량"이면 "주문 수량에는 영향이 없습니다" 쪽이 덜 헷갈린다. 새 문구에 단언 테스트가 없다(문구.md 에 "—" 로 적혀 있다) |
| 새 변경 ② 매크로 칩 › | 통과 | 폰 360·390·PC 1400 × 두 테마에서 칩 3개가 모두 ::after `›` 를 갖는다. 높이 44 그대로, 색은 `--text-faint`(다크 rgb(123,139,158), 라이트 rgb(97,113,134)). guest-home·dash-portfolio 전체 조건에서 넘침·잘림·대비·터치 0. `<Link to="/macro">` 는 그대로다(이동 경로 변경 없음) |
| 용어 사전 · primary 하나 · 배지 색 · 상승 빨강 | 통과 | 이번 두 커밋은 배지·버튼 꼴을 바꾸지 않았다. 새 풀이 줄은 hint(본문 흐린 글)이고 primary 가 아니다. 빨강+라이트·빨강+다크 조합의 대비 0 |
| 글꼴(5-1) | 해당 없음 | preload 를 되돌려 시작 화면과 같은 `index.html` 이다. 앞 판정이 잰 시작 화면 값이 그대로다 |

## 남은 참고 (막지 않음 — 끝 보고·3차에 적을 것)

1. 차트 팝업: 열 때 포커스를 팝업으로 옮기고, 닫으면 연 단추로 돌려준다 — 하지 않았고 넘긴다는 기록도 없다.
2. ChartModal Tab 테스트: jsdom 에서는 "새지 않음"만 보고 "돈다"는 보지 못한다. 꼼짝 않는 변이도 통과한다. 고치려면 jsdom 에서 `offsetParent` 를 흉내 내거나, 필터 대신 `hidden`/`display` 로 거른다.
3. StockManager.tsx:448 주석 "둘로" ↔ 문서 "세 줄". RebalancePanel.tsx:1065 주석 자리. plan.md:50 D13 답 칸.
4. 리밸런싱 풀이 끝말 "주문 수는" → "주문 수량에는" 쪽이 덜 헷갈린다.

## 파일 (저장소 밖)

- 자동 검사: `/tmp/claude-0/work/review-ab2/audit-quick/`, `audit-full/`(summary.md, results.json, shots/). 비교는 `compare-quick.txt`, `compare-full.txt`(앞 검토 `/tmp/claude-0/work/review-ab/audit-now` 와 같은 날 기준선 `audit-base-aff` 를 견줌)
- 키보드: `/tmp/claude-0/work/review-ab2/kbd.log` · 눈으로: `eye.log`, `eye/`
- 검증 로그: `lint.log`, `tsc.log`, `test.log`, `build.log`
- 스크립트: `/tmp/claude-0/-home-user-Dashboard/6b2e1d84-bdc3-51a1-af31-e6cb9385b4d7/scratchpad/` (kbd3.mjs, eye2.mjs, cmp2.py)

## git status (내 worktree)

```
$ git status   (/home/user/Dashboard/.claude/worktrees/agent-ac83a198b429c6864, HEAD 49a6ff3)
On branch worktree-agent-ac83a198b429c6864
nothing to commit, working tree clean
```
변이 검사로 ChartModal.tsx·ChartModal.test.tsx 를 잠시 바꿨다. 매번 `git checkout --` 로 되돌렸고, 그 뒤 `git status --short` 가 비어 있음을 확인했다.
