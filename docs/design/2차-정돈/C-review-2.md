# 디자인 2차 묶음 C 재검토 — 조건부 합격

검토자 · 2026-10-15 · worktree `agent-a2663cb931ee37e53` 에서 `claude/sharp-lovelace-2gm6pf` 의 끝 커밋 21acb0b 를 detached 로 체크아웃.
1ff0fc5 의 다음 커밋 둘을 봤다. cd11ec2 는 사용자 확인 반영, 21acb0b 는 주인 결정과 hover 를 반영했다.
앞 판정은 `C-review.md`(조건부 합격, 조건 둘)다.

## 조건 (고친 다음 다시 볼 것)

1. **고쳐야 함: 폰 360 종목 관리 표를 끝까지 밀면 세 단추 가운데 "삭제"만 보인다.** "시세 갱신"과 "비활성화"는 고정된 이름 칸 밑에 덮인다. C-user.md:41 이 짚은 증상이 반은 그대로 남았다. 예전에는 "삭제"도 한 글자만 보였는데 이제 "삭제"는 다 보인다.
   - 잰 값(`eye/stocks360b.mjs`, 첫 줄 VOO, 끝까지 민 scrollLeft=740/740):
     - 화면 칸은 14–346, 고정 칸은 15–156(141px, 132 + 테두리·여백)이다.
     - "작업" 칸은 24–345, 너비가 **321px** 이다.
     - 단추는 왼쪽으로 붙는다. `시세 갱신 36–98`, `비활성화 106–166`, `삭제 174–218` 이다.
     - 15개 줄 모두 같고, 다크와 라이트도 같다.
   - 세 단추가 한 번에 다 보이는 자리는 scrollLeft **612–620, 9px** 뿐이다(`eye/stocks360c.mjs` 가 0..max 를 1px 씩 훑음). 390 에서는 582–620, 39px 이다. 사진은 `eye/stocks-360-end-viewport.png` 다. 끝까지 민 화면에서 "삭제" 오른쪽이 넓게 비어 있다.
   - 원인: 표는 `minWidth: 1070`(`StockManager.tsx:479`)이고 `fixed` 다. 폰에서 이름 칸을 202 → 132 로 줄였다(`index.css` 의 `@media (max-width:640px) table.sticky-first … width:132px !important`). 줄어든 70px 는 "작업" 칸으로 갔다. 그 칸 안의 단추 묶음(flex, `justify-content: normal`)은 왼쪽 끝에 붙어 있어서 고정 칸 밑으로 들어간다.
   - 고치기 전에 셈부터 해야 한다. 360 에서 고정 칸 오른쪽에 보이는 폭은 156–346 = 190px 이다. 단추 묶음은 182px(62+60+44, 사이 8px 둘)에 칸 여백 12px 가 양쪽에 붙는다.
     - 오른쪽으로 붙이기만 하면 단추는 151–333 이 된다. 끝까지 밀어도 5px 가 덮인다.
     - 그래서 오른쪽 붙이기와 함께 오른쪽 여백·단추 사이를 줄이거나, 고정 칸을 조금 더 좁혀야 한다. 어느 쪽인지는 만든 사람이 정한다.
     - 합격 기준: 360·390 두 테마에서 끝까지 민 자리에 세 단추가 다 보인다.
   - `cd11ec2` 메시지와 문구.md "C 사용자 확인 반영" 의 이유 칸은 "끝 칸 단추가 다 보이는 자리가 없음"을 풀었다고 읽힌다. 실제로는 9px 자리만 생겼다.
   - audit.mjs 는 이것을 잡지 못한다. `sticky-left 0` 는 고정 칸 자체만 본다. 덮인 단추를 세는 검사를 더하는 것을 권한다(참고).

## 참고 (막지 않음)

- 포트폴리오 "확인할 신호"의 비중조절 수(`PortfolioView.tsx:110` `cardsOnly.filter(hasWeightSignal)`)를 리뷰 날 응답으로 고정하는 테스트가 없다. 새 테스트 `Dashboard.test.tsx:1054-1069` 는 신호 요약과 거르기만 본다. `Dashboard.portfolio.test.tsx:670` 은 줄 점만 본다. 세는 함수를 함께 쓰므로 위험은 작다. 뮤테이션 검사(포트폴리오 줄 되돌리기)는 자동 권한 판정이 막아서 돌리지 못했다. 저장소 파일은 그대로다.
- 확대 150%(933, 640 초과)에서는 폰 규칙이 걸리지 않는다. 폰 360 리밸런싱에는 sticky-first 표가 없다(카드). `eye/rb360.mjs` → `[]`.

## 앞 조건

| 앞 조건 | 판정 | 증거 |
| --- | --- | --- |
| 1 정기 리뷰 날 비중조절 수 | **풀림** | `eye/due.mjs`: 서버처럼 `/api/rebalance/current`(review.due=true)와 `/api/dashboard` 의 모든 종목에 '정기 리뷰 도래'를 실었다. **PC**: 단추 `매수 4 · 매도 3 · 비중조절 3종목`, 줄 끝 ◆ 3(TIGER 미국필라델피아반도체나스닥·삼성전자우·VOO, 나머지 하나는 모양 풀이). 비중조절을 누르면 `?view=signal`, 요약 `3 비중조절 pressed=true`, 배지 `매도 검토 2 · 매수 검토 1 · 정기 리뷰 15`, 걸러진 줄은 VOO·삼성전자우·TIGER 셋이다. **폰 360**: 같은 숫자, 걸러진 카드 셋. 리뷰 아닌 날(`eye/normal.mjs`)에도 3·◆3·3 이고 '정기 리뷰' 배지가 없다. 세 곳이 `components/weightSignal.ts` 하나(`reasons` 에 '매도 검토'·'매수 검토')로 센다. 서버 사유 문자열(`backend/app/services/rebalance.py:336-337`)과 ◆ 점 규칙(`lib/portfolio.ts:50-51`)과 같다. 문구.md "C 검토 반영 (주인 결정 2026-10-16)" 절과 status.md "C 검토 질문" 에 주인 답이 적혀 있다. 콘솔 오류 0 |
| 2 "추세 형성" 칩 밑줄 | **풀림** | `eye/misc.mjs` 로 시그널 보기의 `.metric-chip.blue` 6개를 다크·라이트 × 초록·빨강에서 쟀다. `text-decoration-line: none`, `font-weight: 800`, 바탕 text 18%, 테두리 투명, `SPAN`, cursor auto. 사진 `eye/blue-chip-*.png` |
| (참고였던) 고친 줄 hover 때 고정 칸 | 풀림 | 933@1.5 리밸런싱 보유 표에서 입력을 바꿔 dirty 로 만들고 줄 위에 마우스를 올렸다. 고정 칸은 hover 전후 같다. 다크 `color(srgb .1785 .1779 .1504)`, 라이트 `(.958 .916 .884)`. panel-soft 로 빠지지 않는다(`index.css` `tbody tr.dirty:hover td:first-child`). 사진 `eye/rb-dirty-hover-*.png` |

## 항목

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 기능 불변 (backend·api·lib·types·AppState) | 통과 | `git diff --stat 4109146 HEAD -- backend frontend/src/api frontend/src/lib frontend/src/types.ts frontend/src/AppState.tsx` → `backend/app/version.py | 4 +++-` 한 파일 |
| 시그널 보기 동작 변경(비중조절 거르기) | 통과 — 주인 결정 있음 | `Dashboard.tsx:510,542,629` 세 자리가 `hasWeightSignal` 로 바뀌었다. status.md "C 검토 질문 (2026-10-16) … 과중·미달만 세기(추천)" |
| .tsx 한 줄씩 | 통과 | `orderSaved(row)` 는 PC·폰 두 자리 모두 `handleSaved` 앞에서 안내 문장을 세운다. `TradeForm` 은 `onSaved({side, qty})` 를 `onClose()` 다음에 부른다. 저장 호출 `api.updateHolding` 은 바뀌지 않았다. 안내 줄은 `role="status"`. StockManager 는 "한국 · ₩KRW" 를 `nowrap` 한 덩어리로 묶는다(가짜 데이터 15종목 모두 넘침 0, 이름 최대 2줄, `eye/stocks360.mjs`) |
| 린트 | 통과 | `npx oxlint` 경고 22줄(≤22), 종료 0 |
| tsc -b | 통과 | `npx tsc -b` 종료 0 |
| npm test | 통과 | `Test Files 58 passed (58)` / `Tests 884 passed (884)` (≥884) |
| 테스트가 약해지지 않았나 | 통과(참고 1) | 새 테스트: `Dashboard.test.tsx` "정기 리뷰 날의 비중조절 수"(요약 1·정기 리뷰 3·거르면 SCHD 만). `RebalancePanel.test.tsx:879-880` 안내 문장 단언 더함. 지운 단언 없음 |
| 자동 검사 audit.mjs (6화면 전체 조건) | 통과 | 전용 8175, `--data-dir /tmp/claude-0/work/rereview-c-data --reset`, worktree 에서 `npm run build`. `--only stocks,new-stocks,rebalance,dash-portfolio,dash-signal,dash-signal-cards --shots` → **54개, 열지 못한 것 0**. 합계: page-overflow 0 · clipped 0 · orphan 0 · num-split 1 · folded3 0 · folded2-360 0 · touch 0 · contrast 0 · console 0 · cond-missing 0 · nowrap-split 0 · sticky-left 0 · fake-button 0 · quiet-target 0. 앞 검토(`review-c/audit/summary.md`)의 같은 화면 줄(카드 높이 줄 포함 70줄)과 `diff` 결과 **같다**. num-split 1 은 dash-portfolio pc-zoom150-dark `+₩20,145,600` 으로 전부터 있던 것이다 |
| 폰 360 종목 관리 표 끝까지 | **실패 → 조건 1** | 위 조건 1 |
| 문구 | 통과 | 문구.md 마지막 두 절과 화면이 같다. 안내 문장은 테스트 단언과 글자가 같고, "정기 리뷰 n" 배지는 요약에 따로 있다. 단 "C 사용자 확인 반영" 둘째 줄의 '단추가 다 보이는 자리' 는 조건 1 로 아직 아니다 |
| API 모양·응답 사진 기준 | 해당 없음 | backend 에서 바뀐 것은 version 뿐 |

자료(저장소 밖):
- `/tmp/claude-0/work/review-c2/audit/`(results.json·summary.md·shots), `/tmp/claude-0/work/review-c2/audit.log`
- `/tmp/claude-0/work/review-c2/eye/`(due·normal·stocks360·stocks360b·stocks360c·rb360·misc .mjs 와 사진)
- `/tmp/claude-0/work/review-c2/lint.txt`

뒷정리:
- 서버 8175(PID 4028)는 PID 로 껐다. `ps -p 4028` 은 없음, 8175 는 빔.
- 잠깐 걸었던 `frontend/node_modules` 링크(무시 목록)는 지웠다.

## git status

```
HEAD detached at 21acb0b
nothing to commit, working tree clean
```
