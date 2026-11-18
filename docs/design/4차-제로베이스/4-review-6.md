# 묶음 4 여섯 번째 검토 (4-review-6) — 4cba0ad(다섯 번째 검토 보완) · e89e7eb(목업 13 AI 티 빼기)

## 판정: 조건부 합격 — 조건 넷 (모두 표시만 고치면 되고, 되돌릴 것은 없다)

- 4cba0ad: 조건 1(시트 안 확인창에서 Esc 를 누르면 시트째 닫힘)은 **고쳐졌다**. 참고 셋 가운데 테스트 둘(줄일 묶음 제한, 기록 시트 닫기)은 돌연변이를 잡는다. 낡은 말은 글만 고쳤고 테스트는 없다(참고).
- e89e7eb: 주인 답 ①~④는 목업대로 들어갔다. 계산·저장 로직은 그대로다. 그런데 **한 줄 고르기(.seg)가 폰 터치 44px 규칙을 깨고(자동 검사 touch 0 → 98)**, **매크로 차트 창 제목이 좁은 폰에서 눌려 겹친다**. 그리고 **audit.mjs 가 바뀐 글과 클래스를 따라가지 않아 두 화면을 열지 못한다.**

검토 자리: 저장소 밖 worktree `scratchpad/wt6`(e89e7eb, detached). 가짜 서버는 8796(손으로 잼)과 18797(audit)을 썼다. 비교용으로 4cba0ad 빌드를 18798 에 잠깐 띄웠다. 데이터는 `scratchpad/r4f/fdata*` 에 두었다. 처음 audit 을 8797 에 띄웠을 때는 그 포트를 남이 쓰고 있어서 내 서버가 뜨지 못했고, audit 이 남의 서버를 쟀다. 그 결과(`audit-invalid.log`)는 버리고 18797 에서 다시 쟀다.

## 조건

### 조건 1 (고쳐야 함). 폰에서 한 줄 고르기 단추가 38px — 44px 규칙이 깨졌다 (회귀)
- 까닭: `frontend/src/styles/pages/flat.css:69` 의 `.seg > button { min-height: 38px }` 가 문제다. 이 선택자는 폰 전역 규칙 `@media (pointer: coarse), (max-width: 720px) { button { min-height: 44px } }`(`styles/pages/signal-thresholds.css:71`)보다 우선순위가 높아서 그 규칙을 이긴다. `:116 .stock-tools .seg > button`, `:128 .stock-ranges.seg > button` 도 38px 로 못 박혀 있다.
- 잰 값(폰, 4cba0ad → e89e7eb):
  - 종목 안 차트 기간은 `6개월:77x44` → `80x38`(360)이다. 앞에서는 `.stock-ranges .chip { min-height: 44px }` 가 있었다.
  - 매크로 차트 창 기간은 `1년:44x44` → `49x38` 이다.
  - 종목 도구의 줄/카드는 `47x38` 이다. 앞에서는 `.stock-tools .chip { min-height: 44px }` 였다.
- audit(397 조합): touch 가 0 → 70 이다. 내역은 `modal-chart` 28, `stock-detail` 28, `stocks-card` 14 다. 고친 사본으로 잰 `modal-macro-chart` 28 을 더하면 98 이다.
- 목업 13 의 `.seg span{height:34px}` 를 따른 것으로 보이지만, 2-2 의 3(터치 44px)이 앞선다.
- 고칠 방향: 폰(같은 미디어 조건)에서 `.seg > button` 을 `min-height: 44px` 로 한다. PC 는 38 이어도 된다. 다시 생기지 않게 막는 장치도 하나 둔다. 예를 들면 audit 의 touch 0 확인, 또는 CSS 에서 `.seg` 폰 규칙이 있는지 보는 단위 테스트.

### 조건 2 (고쳐야 함). 매크로 차트 창 머리: 좁은 폰에서 제목이 눌려 세로로 서고, 320 에서는 고르기 칸이 제목을 덮는다 (회귀)
- 재현: 가짜 서버에서 `/macro` 를 열고 "공포·탐욕 지수" 줄을 눌러 차트 창을 띄운다.
  - 320 에서는 h3 가 `28x86` 이다. "공포 / · / 탐욕 / 지수" 네 줄로 서고, 기간 고르기 칸이 "탐욕 · 지수" 위를 덮는다(스크린샷 `r4f/shots/mchart-head-320-3.png`).
  - 360 에서는 `42x65` 로 세 줄이다. "S&P 500" 도 360 에서 "S&P / 500" 두 줄로 갈리고, audit 은 이것을 제목 외톨이로 잡았다(`modal-macro-chart` ph360 두 조건 + text130, 제목 외톨이 0 → 3).
  - 4cba0ad 에서는 같은 자리가 `공포·탐욕 지수:91x22` 한 줄이었다(320 · 360).
- 까닭: 앞의 `.chip-row` 는 `flex-wrap: wrap; min-width: 0` 이어서 칩이 아래로 내려갔다. 지금 `.seg` 는 `inline-flex` 에 줄바꿈이 없고 최소 폭이 210px 라서 제목 칸을 짓누른다(`components/MacroChartModal.tsx:80`).
- 고칠 방향: 폰에서는 고르기를 제목 아래 한 줄(`.seg.full`)로 내리거나, 머리가 줄을 바꾸게 한다. 320 · 360 에서 긴 지표 이름으로 다시 잰다.

### 조건 3 (고쳐야 함, 작음). audit.mjs 가 이번 글 · 클래스 변경을 따라가지 않아 두 화면을 열지 못한다
- `docs/design/audit.mjs:151` `getByPlaceholder(/삼성전자, 005930/)` 은 찾기 칸 안내가 "종목 이름이나 코드 (삼성전자, VOO)" 로 바뀌어서 `stocks-sheet` 열 조건 10개가 모두 FAILED 다.
- `:218` `button.macro-title` 은 매크로가 목록으로 바뀌면서 클래스가 없어져 `modal-macro-chart` 10개가 FAILED 다.
- 그래서 지금 저장소의 audit 은 "열지 못한 것 20개"를 낸다(앞 판정은 0). 문구를 바꾸면 그 문구로 요소를 찾는 검사도 같이 고친다는 규칙(2-1 의 3)은 audit 에도 똑같이 적용된다.
- 이 검토에서는 저장소 밖 사본(`r4f/audit-patched.mjs`, 두 줄만 `/종목 이름이나 코드/` · `button.macro-row-open` 으로 바꿈)으로 두 화면을 따로 쟀다. 열지 못함 0, touch 28, 제목 외톨이 3 이었다(위 조건 1 · 2).

### 조건 4 (고쳐야 함, 작음). 장단기 금리차 날짜가 줄 끝에서 갈라진다
- 390 에서는 `"장단기 금리차 +0.28%p, 정상(장기 > 단기) (2026-" / "11-18 기준)"` 으로 갈린다(`r4f/shots/crop-owner_macro-390-light.png`). audit 의 숫자 갈라짐은 macro 3 → 4, guest-macro 1 → 6 으로 늘었다.
- 이번에 고친 줄이다(`pages/MacroPanel.tsx:74`, `({spread.as_of} 기준)`). 날짜는 떨어지면 안 되는 묶음이다(5-1). `nowrap` 으로 감싸거나, 목업처럼 날짜를 차트 쪽으로 보낸다(목업 13 표: "코드 이름 · 날짜는 누르면 나오는 차트에").

## 항목별

| 항목 | 결과 | 증거 |
| --- | --- | --- |
| 4cba0ad 조건 1: 시트 안 확인창 Esc | 통과 | 폰 390 실브라우저. 리뷰 · 기록 → 기록 → 기록 삭제를 누르면 팝업 `['리뷰 · 기록','리밸런싱 기록 삭제']`. Esc 를 누르면 `['리뷰 · 기록']` 이 남고 포커스는 "기록 삭제". Esc 를 한 번 더 누르면 `[]` 이고 포커스는 "리뷰 · 기록D-42 · 1건" 줄로 간다. `Sheet.tsx:35` 의 `isCovered` |
| 4cba0ad 테스트 셋 | 통과(하나는 참고) | 돌연변이(바꿨다가 `git checkout` 으로 되돌림): isCovered 줄을 지우면 1 실패, 줄일 묶음 `limit={99}` 면 1 실패, 기록 시트 `onClose={() => {}}` 면 2 실패. 셋 다 잡는다. 낡은 말을 "아래 설정의"로 되돌리면 73 통과다(잡지 않음 → 참고 4) |
| ① 색 "나 청람 먹" | 통과 | `tokens.css` 라이트 값 8개가 목업 `SETS.ink` 와 한 글자도 다르지 않다(#0e1b2e · #334459 · #5a6a7f · #18694a · #b02a2a · #8a4a0b · #1f50c2 · #0b6a6f). 다크 블록과 `[data-rise='red']` 블록은 바뀌지 않았다(--up/--down/--signal-* 는 var() 로 따라간다) |
| 대비 4.5 | 통과 | 직접 계산: text-faint 4.91/5.52/5.19(bg/panel/panel-soft), green 5.91, red 5.81, amber 6.09, rise-down 6.25, teal 5.65. 자기 옅은 바탕 위 최저는 teal 5.04. 흰 글자 위 호박은 6.85다(주석의 "6.6"은 작은 오차). audit 대비는 0, 라이트 빨강 두 조건 포함 |
| 색표 밖 색 | 통과 | `styles/` 의 tokens.css 밖과 `.tsx` 에서 #hex · rgb · hsl 을 grep 하면 0 |
| ② 카드 위계(홈) | 통과 | 폰 300/320/360/390 에서 `.holding-list` · `.ai-row` 가 [0, 화면 폭], 글자는 [14, 폭-14]. scrollWidth = 화면 폭. 요약만 카드다. 목업 13 "홈 · 바꾼 것"과 나란히 놓고 봤을 때 배치 · 색 · 위계가 같다 |
| ② 카드 위계(매크로) | 통과 | 폰 390: `.macro-list` [0, 390], 12줄, 별 12개. PC 1100 이상은 두 칸이다(1280 스크린샷). 화면에 띄어 쓴 " · " 는 1개로, VIX 풀이("변동성 지수 · 시장의 공포", 서버 데이터)다 |
| 매크로: 별(홈에 올리기) | 통과 | 미 10년물 금리 ☆ 을 누르면 aria-pressed false → true, 다시 누르면 false |
| 매크로: 예상치 입력/저장/지우기 | 통과 | CPI "예상치 입력" → 2.7 저장 → 줄에 "2026-11 예상 2.70% 직접 입력". 지우기는 단위 테스트 "지우면 그 달 예상치를 지운다" 등 예상치 묶음이 통과하고, `ForecastBox` 를 부르는 인자도 그대로다 |
| 매크로: 국면 구간 · 못 받은 까닭 | 통과 | "공포 구간 25~44"가 공포·탐욕 줄 아래에 있다. 구간 줄을 지우는 돌연변이는 3 실패. 못 받은 까닭은 `details.error-detail` 그대로이고 테스트 "못 받은 지표는 사유를 접어서" 가 통과한다 |
| 매크로: 차트 열기 · 손님 | 통과 | 줄을 누르면 "S&P 500 차트". Esc 를 누르면 닫히고 포커스는 그 줄로 돌아간다. 손님은 별 0, 자리 맞춤 12, AI 단추 0이고 VIX 줄을 누르면 차트가 열린다. 손님에게 별을 주는 돌연변이는 1 실패 |
| ③ 단추 나누기 | 통과(조건 1 · 2 빼고) | 종목 도구 줄은 `.seg` 줄/카드 + 네모 단추 셋 + 안내 글 안의 목표 합계, 거르기는 알약이다. 종목 안 · 매크로 차트 기간은 한 줄 고르기다. 300 에서 두 줄로 접히고 넘침은 없다 |
| ④ 글 "표대로 다" | 통과(참고 1) | `문구변경.md` 끝 표 26줄을 실제 화면과 맞춰 봤다: 홈 "현금 ₩0 포함, 원 기준" · "다음 리뷰 (분기마다)", 매크로 안내 · 머리 "11/18 05:42에 받음 (출처 dev)", "월간 10월", AI 점검의 "보내지 않습니다" 1번 · ✦ 0, 손님 면책 1번(바닥 줄), 바닥 "개인정보처리방침과 이용약관" 등 표와 같다 |
| 계산 · 저장 불변 | 통과 | `git diff 0df2bb8 e89e7eb -- backend frontend/src/api frontend/src/lib frontend/src/types.ts frontend/src/AppState.tsx` 는 비어 있다. tsx 의 `api.` · 상태 · 저장 함수에서 바뀐 줄은 ForecastBox 한 줄 정리와 setView 단추의 className · aria-label 뿐이다 |
| 넘침 · 잘림 | 통과(조건 2 빼고) | 폰 300/320/360/390 × PC 900/1000/1100/1200/1280/1400 × 다크 · 라이트 × 9화면(홈 · 종목 · 매크로 · 종목 안 · 리밸런싱 · AI · 설정 · 손님 홈 · 손님 매크로): scrollWidth = innerWidth 가 180/180. 화면 밖 요소는 `sr-only` 뿐이다. audit page-overflow 0, clipped 0 |
| 상승 빨강 · 다크 | 통과 | 라이트 빨강 홈은 매수 ▲빨강 · 매도 ▼파랑 · 비중 ◆청록, 다크 빨강 매크로는 정상(스크린샷 `shots/home-red-light.png`, `macro-dark-red.png`). audit 의 risered 조건들은 대비 0 |
| 키보드 | 통과 | PC 종목 안: 기간 칸에서 Tab 을 누르면 다음 기간으로 가고 outline 2px #0051a8 이 보인다. Enter 로 고른다. audit focus-ring 0 |
| 테스트 수 | 통과 | `npx vitest run` → Test Files 68 passed, **Tests 1137 passed**(1124 → 4cba0ad +3 → e89e7eb +10) |
| 바뀐 테스트가 같은 뜻 | 통과(참고 3) | 문구 테스트는 표의 항목과 1:1 이다. "목표 비중 합계 100% 면 초록"은 "경고 색 없이"로 바뀌었는데, 목업 13 ③(알약 → 안내 글) 때문이라 뜻이 바뀐 것이 맞다. AI 점검 테스트는 "보내지 않습니다"를 AI 칸 쪽에서 확인한다 |
| 새 테스트가 돌연변이를 잡나 | 통과(참고 3) | 잡음: tokens 를 Tailwind 값으로 되돌리기, text-faint 을 #7a8a9f 로, amber 를 #c0701b 로(각 1 실패) · 공통 확인 시각 조건 빼기 · 일간 주기 빼기 · 공통 출처 조건 빼기 · AI 반짝이 되살리기 · 로그인 안 면책 되살리기(2) · 종목 안 기간을 chip-row 로. **못 잡음**: 매크로 차트 창 `aria-pressed` 지우기 → 44 통과 |
| 린트 | 통과 | `npm run lint` warning 20 |
| tsc · build | 통과 | `npx tsc -b --noEmit` exit 0 · `npm run build` ✓ built |
| CSS 300줄 | 통과 | 새 파일 flat 173 · macro-list 148 · tokens 263. macro-cards.css 는 지웠다. 300을 넘는 dashboard 1128 · shell 600 · fundamentals 421 은 이번에 손대지 않았다 |
| audit | **실패 → 조건 1 · 2 · 3 · 4** | 397 조합(저장소 audit): 열지 못함 **20** · page-overflow 0 · clipped 0 · folded3 0 · **touch 70** · contrast 0 · **console 1** · fake-button 0 · text-overlap 0 · focus-ring 0 · 외톨이 26 · 숫자 갈라짐 29 · folded2-360 33. 고친 사본으로 두 화면을 따로 재면 touch +28 · 외톨이 +3(제목). 앞 판정(4-review-5): 열지 못함 0 · touch 0 · console 0 · 외톨이 25 · 숫자 갈라짐 23 · folded2-360 31 |
| 회귀 목록(앞 판정 → 지금) | — | touch: modal-chart 0→28 · stock-detail 0→28 · stocks-card 0→14 · modal-macro-chart 0→28. 제목 외톨이: modal-macro-chart 0→3. 숫자 갈라짐: guest-macro 1→6 · macro 3→4. folded2-360: macro 0→2("뉴스에 나오는 물가, 월간 10월" 같은 풀이 줄 — 목록이라 받아들일 만함). 외톨이 label: dash-signal PC 머리 "구분 / 종목 · 매수 조건" 4→6("→"를 빼서 "매수 조건"이 4자가 됨 — 표 머리 label 이라 기준 밖, 참고). console: stock-detail "Object is disposed" 1(status.md 의 "③ 로" 넘긴 묶음 3 자리, 환경 따라 나옴) |

## 참고 (조건 아님)
1. **목업 13 과 다른 글에 이유가 없다**(3-2 "목업과 같음: 차이마다 이유"). 문구변경 표는 실제 글을 적었지만, 목업과 다른 까닭은 적지 않았다.
   - 홈은 목업 "현금 ₩0 포함, 원화로 환산", 앱 "…, 원 기준"이다.
   - 리밸런싱 요약은 목업 "(현금 포함, 원화)", 앱 "(현금 포함, 원 기준)"이다.
   - 금리차 날짜는 목업이 뺐고 앱은 남겼다(조건 4).
   - 매크로 머리는 목업 "11/18 기준", 앱 "…에 받음 (출처 dev)"이다.
   - VIX 풀이에 " · "가 남았다(서버 데이터. status 에는 적었다).
   - 손님 화면에 방침 링크가 두 번 나온다(동의 줄 + 바닥 줄). 목업은 바닥 한 줄에 합쳤다.
   - 종목 도구 "재무 한눈에"는 목업에서 "재무"다.
   - 한 줄씩 이유를 달거나 목업 쪽으로 맞추면 된다.
2. 매크로 줄 단추의 `aria-label`("S&P 500 5,786.7 +41.2 — 차트")이 단추 안의 풀이 · "월간 10월" · "받아본 적 없음" · "… 확인, 출처 yahoo" 를 덮는다. 읽기 프로그램은 이 상태 글을 듣지 못한다. `aria-describedby` 로 풀이 줄을 잇거나, aria-label 을 빼고 글자를 그대로 읽히는 쪽을 권한다(`MacroPanel.tsx:309`).
3. 매크로 차트 창의 한 줄 고르기(`aria-pressed`, `.seg`)에는 테스트가 없다. 지워도 통과한다. 종목 안 쪽만 테스트가 있다.
4. 낡은 말("아래 설정의" → "리밸런싱 설정"의)은 글만 고쳤고 테스트가 없다. `RebalancePanel.test.tsx:109` 주석의 "아래 설정 표"도 옛말이다.
5. 순서 바꾸기 중에도 "줄" 칸이 고른 것처럼 흰 바탕으로 보인다. `.seg > button[aria-pressed='true']` 선택자가 `!ordering` 으로 뺀 `active` 를 대신하기 때문이다(PC 1280 에서 잼). 앞의 칩은 순서 바꾸기 중에 강조를 껐다.
6. 주기 표시에서 연도 · 날짜가 빠진다. 월간 · 분기 · 주간은 `as_of` 의 달만 보여 준다(`MacroPanel.tsx:279`). 주간이면 "주간 11월"로 날짜가 빠지고, 오래된 월간 값은 연도가 빠진다(상태 배지는 따로 뜬다). 지금 데이터에는 일간 · 월간만 있다.
7. 쓰지 않는 CSS 가 남았다: `styles/pages/dashboard.css:673-691` `.holding-head`(마크업을 지움).

## git status
- 내 worktree(`scratchpad/wt6`, e89e7eb)를 지우기 직전 `git status --short` 의 출력은 없다(깨끗). 돌연변이 15개는 매번 `git checkout -- <파일>` 로 되돌렸다. 무시 목록에 있는 `frontend/node_modules`(심볼릭 링크) · `frontend/dist` · `__pycache__` 만 생겼다.
- 비교용 worktree(`scratchpad/wt6old`, 4cba0ad)도 깨끗한 상태로 지웠다.
- `/home/user/Dashboard` 주 작업 트리는 검토 중에 HEAD 가 d30c953 → 76a9ca3 로 바뀌었다. 내가 한 것이 아니다(총괄 쪽 작업). 내가 저장소에 쓴 것은 없다.
