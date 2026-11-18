# 묶음 4 일곱 번째 검토 (4-review-7) — e89e7eb 이후 2b1809a · 5d96dd1 · 6f34af1 · c4ee766

## 판정: 조건부 합격 — 조건 하나

- 여섯 번째 검토의 조건 넷은 **모두 풀렸다**: 한 줄 고르기 44px, 매크로 차트 창 제목, audit 열지 못함 0, 금리차 날짜.
- 사용자 확인 2 보완 여덟 가운데 일곱은 화면과 테스트로 확인했다.
- **목표 시트 "저장했습니다" 줄은 절반만 고쳐졌다(조건 1).** 목록을 아래로 내려 고친 뒤 저장하면, 이 줄이 여전히 화면 밖에 있다.
- 계산 · 저장 로직은 바뀌지 않았다. 테스트는 1139 로 모두 통과했다. 린트 20 · tsc · build 모두 통과다. audit 397 조합: 열지 못함 0 · touch 0 · console 0.

검토 자리는 이렇다.
- 저장소 밖 worktree `scratchpad/r4g/wt`(c4ee766, detached)에서 했다. `node_modules` 는 주 작업 트리 것을 심볼릭 링크로 걸었다.
- `frontend` 에서 `npm run build` 를 먼저 했다(index-CQgtqrZE.js). 서버가 내주는 번들의 해시가 같은 것을 확인했다.
- 가짜 서버 둘을 띄웠다. 18801 은 손으로 재는 데 썼다(`--data-dir r4g/fdata`). 18802 는 audit 에 썼다(`--data-dir r4g/fdata2`). 둘 다 `--reset` 으로 띄웠다. 8765 와 `.devdata` 는 건드리지 않았다.
- 재는 데 쓴 스크립트는 `r4g/js/m1~m6.mjs` 이고, 스크린샷은 `r4g/shots/` 에 있다.

## 조건

### 조건 1 (고쳐야 함). 목표 시트: 목록을 내려서 고친 뒤 저장하면 "✓ n줄을 저장했습니다"가 여전히 화면 밖이다
- 사용자 확인 2(`4-user-2.md` "찾지 못한 것" 2행)에서 나온 말이다. "저장한 뒤 '✓ 2줄을 저장했습니다'는 긴 목록 맨 아래에 있어 화면에 안 보인다."
- 5d96dd1 은 이 줄을 목록 위로 옮겼다(`components/rebalance/TargetSheet.tsx:64-69`). 그런데 저장 단추는 시트 아래 붙박이 줄(`.target-actions`)에 있다. 시트(`.sheet.target-sheet`)가 스크롤되어 있으면 맨 위 줄은 보이지 않는다.
- 재현: `/rebalance` → "목표 · 밴드" → 마지막 줄(도쿄해상홀딩스) 밴드를 고친다 → "바뀐 1줄 저장"을 누른다.
  - 390×844: 시트 스크롤 335/335 → 저장 뒤 366. status 줄 y = **−248**(화면 밖).
  - 320×640: status 줄 y = **−830**.
  - PC 1280×900(가운데 시트): status 줄 y = **−157**.
  - 화면에 보이는 것은 "바뀐 것 없음"(옅은 단추)뿐이다. 사용자가 본 모습 그대로다(스크린샷 `r4g/shots/target-saved-scrolled-390.png`).
- 위쪽 줄(VOO, 스크롤하지 않음)을 고쳐 저장하면 보인다: y=118, 390 · 320 · 1280 모두. 30줄(15종목) 목록이라 아래쪽 반을 고치면 거의 늘 보이지 않는다.
- 테스트(`RebalancePanel.test.tsx:1248-1251`)는 DOM 순서(status 가 `.target-list` 앞)만 본다. 그래서 이 경우를 잡지 못한다.
- 고칠 방향(하나 고르면 된다):
  - 저장한 뒤 status 줄을 `scrollIntoView` 하거나, 시트 스크롤을 맨 위로 올린다.
  - 아니면 status 줄을 붙박이 저장 줄(`.target-actions`) 바로 위나 안에 둔다.
  - 테스트는 "scrollIntoView 가 status 에 불렸다"처럼 거래 칸 끌어오기 테스트와 같은 꼴로 둔다.

## 항목별

| 항목 | 결과 | 증거 |
| --- | --- | --- |
| 검토 6 조건 1: 한 줄 고르기 44px | 통과 | `styles/pages/flat.css:69` `.seg > button { min-height: 44px }` 이다(전역 — PC 도 44). 38px 로 못 박던 `.stock-tools .seg > button` · `.stock-ranges.seg > button` 은 지웠다. 폰 300/320/360/390 실브라우저(hasTouch): 종목 안 기간 `6개월:65x44`(300) ~ `87x44`(390), 종목 도구 `줄:47x44 카드:47x44`, 매크로 차트 창 `1년:64x44`(300) ~ `86x44`(390). audit touch **0**(검토 6 은 70, 고친 사본으로는 98) |
| 검토 6 조건 2: 매크로 차트 창 제목 | 통과 | `flat.css:169-173` `.chart-modal .modal-head > .seg { order:100; flex-basis:100%; display:flex }` 로 기간 줄이 제목 아래로 갔다. 300/320/360/390 × 주인 · 손님에서 h3 를 쟀다: `공포·탐욕 지수 91x22`, `S&P 500 66x22`, `미 10년물 금리 97x22`, 모두 한 줄이다. seg 는 y=68(제목 아래)이고 겹침 false, 창 scrollWidth = clientWidth 다. 가장 긴 "근원 CPI CPILFESL (전년비)"도 320 에서 228x22 한 줄이다. 스크린샷 `shots/mchart-320.png`. audit modal-macro-chart orphan 0 |
| 검토 6 조건 3: audit 선택자 | 통과 | `docs/design/audit.mjs:151` `/종목 이름이나 코드/`, `:218` `button.macro-row-open` 으로 바꿨다. 397 조합 "열지 못한 것 **0개**" |
| 검토 6 조건 4: 금리차 날짜 | 통과 | `pages/MacroPanel.tsx:72-75` 공백을 span 밖으로 빼고 `className="hint nowrap"` 을 달았다. 300/320/360/390/1280 에서 Range rect 의 y 값이 하나다(한 줄). 300 · 320 에서는 날짜 덩어리가 통째로 다음 줄로 간다(`shots/spread-320.png`). audit num-split macro 4→**0**, guest-macro 6→**0**. 단 nowrap 을 빼는 돌연변이는 45 통과(아래 참고 2) |
| 주문 시트 거래 칸 끌어오기 (폰 320) | 통과 | `RebalancePanel.tsx:669-673` 은 열면 `.order-trade-form` 에 `scrollIntoView({block:'nearest'})` 를 부른다. 실브라우저에서 TIGER 시트의 "거래 입력"을 눌렀다. 320×640: 칸 y=515~641, 수량 칸 `145,544 136x44`, "반영" y=596~640(화면 끝에 딱 붙음, `shots/trade-320.png`). 360 · 390 은 칸 전체가 화면 안이다. 사용자가 막혔던 "닫기만 보이고 아무 일도 안 일어남"은 풀렸다 |
| "거래 칸 닫기" | 통과(참고 3) | 시트 안 단추 글이 "거래 칸 닫기"다(320/360/390). 읽는 이름 "TIGER… 거래 칸 닫기" |
| "종목 화면 열기" · 아래 풀이 | 통과 | 시트 링크 "종목 화면 열기" 1, "종목 안 보기" 0이다. 풀이 "수량 · 평단가는 종목 화면의 "보유" 탭에서 고칩니다." 종목 안 탭 이름이 실제로 '보유'다(`components/stock/StockDetail.tsx:51`) |
| 목표 시트 저장 줄이 목록 위 | **조건 1** | 위쪽 줄을 고칠 때만 보인다. 위 조건 1 |
| 리뷰 · 기록 매일 기록 줄 | 통과 | 실브라우저(390/320/1280): "…남깁니다. 2026-11-14부터 5일치 쌓였습니다." 줄표와 "(쌓인 기록을 보는 화면은 아직 없습니다)"는 없다 |
| 순서 저장 말 | 통과 | 실브라우저에서 순서 손잡이에 ArrowDown → "✓ 순서를 저장했습니다. 시그널 목록과, 정렬을 "내가 정한 순서"로 둔 홈 표가 이 순서를 따릅니다." 정렬 이름 "내가 정한 순서"는 `lib/portfolio.ts:79` `mine` 의 라벨과 같다 |
| 매크로 줄 읽는 이름 | 통과 | 390 실브라우저: `"S&P 500, 미국 대형주 500개, 5,786.7 +41.2 — 차트"`, `"VIX, 변동성 지수 · 시장의 공포, 21.1 −1.3 — 차트"`. "받아본 적 없음"도 이름에 들어간다(새 테스트) |
| 순서 바꾸는 중 보기 칸 | 통과(참고 4) | 1280 · 390 · 320, 카드 보기 → 순서 바꾸기: `줄:class=- bg=transparent`, `카드:class=- bg=transparent`. 둘 다 고른 모양이 아니다(`shots/ordering-tools-1280.png`). `[aria-pressed='true']` 선택자는 `flat.css` 에서 지웠다 |
| 계산 · 저장 불변 | 통과 | `git diff --stat e89e7eb c4ee766 -- backend frontend/src/api frontend/src/lib frontend/src/types.ts frontend/src/AppState.tsx` 는 비어 있다. tsx 에서 api · set* 쪽으로 바뀐 줄은 `setSavedNote` 글 한 줄과 status `<p>` 의 자리 이동뿐이다 |
| 테스트 수 | 통과 | `npx vitest run` → Test Files 68 passed, **Tests 1139 passed**(1137 → 5d96dd1 +1 → c4ee766 +1) |
| 새 · 바뀐 테스트가 돌연변이를 잡나 | 통과(참고 2) | 바꿨다가 매번 `git checkout -- <파일>` 로 되돌렸다. **잡음**(괄호 안은 실패 수): 끌어오기 effect 끄기(1), "거래 칸 닫기" → "닫기"(1), `order-trade-form` 클래스 빼기(1), 링크 "종목 안 보기"로(1), 매일 기록 줄 옛말 되살리기(1), 순서 바꾸는 중 `!ordering` 빼기(1), 순서 저장 옛말(1), 매크로 차트 창 `aria-pressed` 지우기(1 — 검토 6 참고 3 풀림), 매크로 줄 aria-label 을 옛꼴로(3), 목표 시트 status 를 목록 아래로 되돌리기(1). **못 잡음**: 금리차 `nowrap` 빼기 → 45 통과 |
| 린트 | 통과 | `npm run lint` warning 20 |
| tsc · build | 통과 | `npx tsc -b --noEmit` exit 0 · `npm run build` ✓ built in 396ms |
| CSS 300줄 | 통과 | 바뀐 파일: flat 173 · rebalance-sheets 265. dashboard 는 1128 → 1111 로 줄었다(`.holding-head` 지움 — 검토 6 참고 7 풀림, 이번에 늘린 것 아님) |
| tokens.css 밖 색 | 통과 | `styles/` 의 tokens.css 밖에서 #hex · rgb · hsl 0, `.tsx`(테스트 빼고)에서 0 |
| audit 397 조합 | 통과 | `r4g/audit/summary.md`: 열지 못함 **0** · page-overflow 0 · clipped 0 · folded3 0 · touch **0** · contrast 0 · console **0** · fake-button 0 · text-overlap 0 · focus-ring 0 · orphan 26 · num-split 19 · folded2-360 33 |
| audit 내역(앞 판정 대비) | — | num-split 19 는 fundamentals 10(전부터 있던 "2026-11-…" 풀이)과 menu-diagnostics 9 다. 뒤의 9 는 **내 환경 탓**이다: 진단 창 바닥에 데이터 폴더 경로(`/tmp/claude-0/…`)가 찍히는데, 이 검토의 경로가 길어서 갈라졌다. 앱 문제가 아니다. macro · guest-macro 는 0 이다. orphan 26: dash-signal · xcond 머리 "매수 조건" label 12, "시그널 10종목" title(text130) 9, menu-users 2, modal-chart 2, rebalance 1. modal-macro-chart 의 제목 외톨이는 0 이다. 앞 판정의 회귀(touch 98 · 제목 외톨이 3 · 날짜 갈림)는 모두 없어졌다 |

## 참고 (조건 아님)
1. 거래 칸 끌어오기는 `block:'nearest'` 라서 320×640 에서 "반영" 단추 아래끝이 화면 끝(640)에 딱 붙는다. 그 아래의 풀이 줄은 화면 밖이다. `scroll-margin-bottom` 을 조금 주면 여유가 생긴다.
2. 금리차 날짜 `nowrap` 은 테스트가 없다. 빼도 45 통과다. 앞 판정의 조건이었으니 class 를 확인하는 한 줄이 있으면 좋다. 매일 기록 줄은 이미 그렇게 테스트한다(`RebalancePanel.test.tsx:1064`).
3. PC 주문 표 줄의 단추는 열린 때 보이는 글이 아직 "닫기"다(`RebalancePanel.tsx:733`, 읽는 이름은 "… 거래 칸 닫기"). 시트가 아니라 헷갈림은 덜하다. 그래도 같은 단추 글을 맞추면 좋다. 목표 시트 아래 풀이(`TargetSheet.tsx:106`)도 아직 `종목 안 "보유"` 라서, 새 말 "종목 화면의 '보유' 탭"과 다르다.
4. 순서 바꾸는 중 보기 칸은 그림으로는 둘 다 놓였다. 하지만 `aria-pressed` 는 여전히 `view === 'card'` 를 따른다(`StockManager.tsx:424/427`). 읽기 프로그램은 "카드, 눌림"이라고 읽는데, 화면은 줄 모양 순서 목록이다.
5. `.seg > button` 44px 가 PC 에도 걸린다. PC 종목 도구 줄에서 seg 상자(약 52px)가 옆 네모 단추(44px)보다 조금 높다. 매크로 차트 창은 PC 1280 에서도 기간 줄이 창 폭을 다 쓴다(칸당 248px). 종목 안 기간 줄(칸당 245px)과 같은 꼴이라 일관은 된다(`shots/mchart-1280.png`). 둘 다 눈으로 보기에 이상하지 않았다.
6. 검토 6 의 "다시 생기지 않게 막는 장치"는 audit touch 0 확인으로 갈음했다. CSS 를 보는 단위 테스트는 없다. audit 을 커밋 전에 늘 돌린다면 충분하다.
7. 검토 6 참고 1(목업과 다른 글의 까닭)은 status.md 에 적었다. 참고 4(낡은 말 "아래 설정의" 테스트)는 그대로다.

## git status
- 내 worktree(`scratchpad/r4g/wt`, c4ee766)에서 `git status --short` 를 하면 출력이 없다(깨끗). `--ignored` 로 보면 `frontend/dist/` · `frontend/node_modules`(심볼릭 링크) · `backend/**/__pycache__/` 만 있다.
- 돌연변이 11개는 매번 `git checkout -- <파일>` 로 되돌렸다. 저장소에 쓴 것은 없다. 주 작업 트리 `/home/user/Dashboard` 는 건드리지 않았다.
- 끝낼 때 서버 둘(18801 · 18802)을 pid 파일로 껐고, worktree 를 지웠다(`git worktree remove --force`, 무시 파일 때문에 force).
