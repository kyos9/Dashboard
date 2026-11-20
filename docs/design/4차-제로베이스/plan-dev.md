# 4차 계획 검토 — 개발자 (plan-draft 6장 "이번 묶음" 기준)

읽은 것: plan-draft · DESIGN_PROMPT 0장(v6)·2-2 · PROMPT 주인 답 · mockups/README · 01c 가 · 02e ② · `index.css` · `Dashboard.tsx` · `PortfolioView.tsx` · `AppHeader.tsx` · `TabBar.tsx` · `sw.js` · `vite.config.ts` · Dashboard·Rebalance·prefs 테스트. 코드 기준 `79b8850`.
심각도: **막음**(이대로면 규칙 위반·되돌림) · **고쳐야 함**(계획에 적어야 함) · **참고**.

## 1. CSS 쪼개기 (겉모습 그대로)
- 찬성: 2-2 "CSS만". 테스트는 `css: false`(vite.config.ts:18)라 깨지지 않는다.
- 걱정 **고쳐야 함** — 순서가 곧 규칙이다. 끝의 "덮어쓰기" 절(index.css:5678~ `.badge.badge` 등 클래스 두 번 쓰기, 5765 `.chip.weight-chip`)과 화면을 섞어 묶은 `@media` 23개(712·1556·2135·3950·5622…)가 앞 규칙을 뒤에서 덮는다. 부품별로 "모아" 옮기면 순서가 바뀌어 겉모습이 달라진다.
- 걱정 **고쳐야 함** — 화면 CSS를 lazy 화면 파일(pageChunks.ts:17-23의 `RebalancePanel` 등)에서 import 하면 Vite가 CSS를 조각으로 나눠 **나중에, 뒤에** 붙인다 → 순서 역전 + 탭 열 때 깜빡임.
- 걱정 참고 — 300줄 목표: 대시보드 절 하나가 4456~5524(1,068줄). 20개 넘는 파일이 된다.
- 제안: ① 첫 커밋은 **원래 줄 순서 그대로 연속 구간으로만 자르고**, `index.css`(또는 main.tsx:3) 한 곳에서 같은 순서로 `@import`. 증명은 `cat styles/*(import 순서) | diff - 옛 index.css` = 0 + `vite build` 결과 CSS 압축본 diff 0 + audit 수치 동일. ② "모으기"(순서가 바뀌는 이동)는 그다음 커밋에서, audit + 스크린샷 픽셀 비교로. ③ 끝의 덮어쓰기 절은 `overrides.css`로 맨 마지막에 두고, 모양을 바꾸는 커밋에서 하나씩 원래 부품으로 녹인다.

## 2. 색표 tokens.css
- 찬성: `.tsx`에 `var(--` 0건, 색은 거의 CSS에 모여 있다.
- 걱정 **막음** — 청람 #0051a8 을 다크에서 글자·링크(`--accent` 20곳)에 그대로 쓰면 #0a0e14 위 대비 약 **2.5:1**(4.5 미달). 다크는 밝은 단계(300~400대)를 따로 정해야 한다(2-2 3).
- 걱정 **고쳐야 함** — 색표 밖 색이 CSS 밖에도 있다: `PriceChart.tsx:22-23`(MARKER `#22c55e`·`#f05252`, 이미 `--red` #f26a6a 와 다름)·`:29-30`, `MacroChart.tsx:26-27`(차트는 CSS 변수를 못 읽는다고 hex 직접), `index.html:20,41`·`manifest.webmanifest:11-12`(theme-color), `index.css` `:root` 밖 rgba 38곳(827~1690 색별 테두리, 2167 막 배경 — 라이트 테마에서도 다크 값).
- 걱정 **고쳐야 함** — 토큰을 `oklch()`/`color-mix()`로 쓰면 차트가 `getComputedStyle`로 읽어도 lightweight-charts(^5.2.1)가 그 문자열을 받는지 확인 전이다. 토큰 **값**은 hex(OKLCH는 만들 때 계산해 주석으로)로 두는 편이 안전.
- 걱정 참고 — 보라 제거: `--purple` 14곳(비중조절). 비중=청람이면 링크·고른 탭·머리줄과 같은 색 → 비중 배지는 모양(◆)·글자를 꼭 같이. 상승 빨강 모드의 `--down`=파랑(index.css:136-141)과 청람이 겹친다(㉢과 같이 본다).
- 제안: 차트 색은 lib가 아니라 **차트 파일 안에서** `getComputedStyle(root).getPropertyValue('--chart-*')`로 읽기(prefs.ts:111 과 같은 방식, lib diff 없음). `PriceChart.markers.test.tsx:83-84`는 상수끼리 비교라 상수 이름을 남기면 통과.

## 3. 글꼴 — Pretendard + 요약만 Spoqa
- 찬성: 바이트는 거의 그대로. 지금 Wanted Sans 296,808B, 목업의 Pretendard 부분집합 299,952B(2,543글리프, `tnum` 기능 있음 — font-subset.py:25 와 같은 방법이면 유지).
- 걱정 **고쳐야 함** — 용량 상한 "총 300KB 이하"(PROMPT 5장 글꼴 조건). Pretendard 하나로 이미 경계. Spoqa는 작다: 내가 잰 부분집합(굵기 하나당) **숫자·기호만 2.1KB / 요약 이름표 포함 3.8KB**. 둘 다 Vite 인라인 한도(4KB) 아래라 CSS에 data URI로 들어가 sw.js와 무관(sw.js:88 `/assets/` 캐시 먼저 — 해시 이름이라 손댈 것 없음). 굵기 3개면 +6~12KB → 총 ~306~312KB로 상한을 조금 넘는다 → 숫자는 700 하나만 쓰거나 Pretendard 축을 좁혀 맞춘다. **㉣의 용량 차이는 굵기당 ~2KB로 사실상 없다** — 고르는 기준은 용량이 아니라 아래 규칙.
- 걱정 **고쳐야 함** — 규칙 충돌: v6 4 "글꼴 한 가지(+숫자용 고정폭 하나)". Spoqa 숫자는 원래 모두 596단위 같은 폭이라 **㉣ "숫자만"이면 '숫자용' 자리로 설명이 된다**. 이름표까지면 두 번째 글꼴이라 주인 예외로 결정 기록에 적어야 한다. 이름표 부분집합은 고정 글자만 넣으므로 "다음 리뷰"의 날짜·"55일 뒤" 같은 동적 글자는 글자마다 Pretendard로 섞인다 → `unicode-range`로 일부러 넘기고 화면으로 확인.
- 걱정 **고쳐야 함** — 고정폭 제거의 퍼짐: `.mono` 클래스 tsx 71곳, `font-family: var(--font-mono)` CSS 22곳(187·813·1253·1909 `.num-input`·2600 진단 로그 …). `.mono` 정의(index.css:186-189) 하나만 바꾸면 전 화면 표 폭이 줄어(Pretendard 숫자가 더 좁음) audit 수치(갈라짐·외톨이)가 움직인다. 2-2 4 "숫자는 고정폭 유지"는 `tabular-nums`로 지킨다고 계획에 해석을 적을 것. 진단 로그(2552~)·버전 문자열은 고정폭이 낫다 → `--font-mono`는 로그용으로 남김.
- 걱정 참고 — lightweight-charts는 `fontFamily`를 주지 않아(두 차트 파일 grep 0) 축 글씨가 라이브러리 기본 글꼴. "재료 하나"면 `layout.fontFamily` 한 줄.
- 제안: 글꼴 교체는 **자기 커밋 하나**(쪼개기·색과 분리) + audit 다시. 파일은 `frontend/src/assets/fonts/`로 옮기고 목업은 그 파일을 가리키게(01c:17 처럼) — 300KB 두 벌이 저장소에 남지 않게. `size-adjust` 확인, OFL 라이선스 파일 같이.

## 4. 표시 부품 components/ui/
- 찬성: 주인이 "표시 부품 만들기" 허용(PROMPT 첫머리 답) → 데이터·상태를 안 옮기면 묻지 않아도 된다.
- 걱정 **고쳐야 함** — `Tabs`: 대시보드 전환은 `role=group` + `aria-pressed` 단추(Dashboard.tsx:772-778). `role=tab`으로 바꾸면 `getByRole('button', {name:'포트폴리오'|'시그널'})` 7곳(Dashboard.portfolio.test.tsx:728~809)이 깨지고, role 바꾸기는 2-2 "role 삭제 금지"에 걸린다 → **역할은 그대로, 밑줄은 CSS만**.
- 걱정 **고쳐야 함** — `SummaryGrid`가 `MoneyLine`을 대신하면 리밸런싱도 바뀐다: `RebalancePanel.tsx:11,1304`가 같은 부품을 쓰고 `RebalancePanel.test.tsx:486-489`가 `aria-label="내 자산"` 순서를 본다. "다른 화면 안 바꿈"과 부딪친다 → 리밸런싱도 같이 바뀐다고 범위에 적거나(추천: 같은 데이터·같은 부품), 주인에게.
- 걱정 참고 — `Button` 부품으로 기존 `<button className="ghost|primary|sm">` 수십 곳을 갈아 끼우면 tsx diff가 커지고 검토자가 한 줄씩 읽어야 한다(2-2 검토). 단추는 **CSS 클래스 체계 먼저**, React 부품은 마크업이 반복되는 것(SummaryGrid·SignalCounts·SignalMark)만.

## 5. 포트폴리오 보기를 B로 (01c 가)
- 걱정 **막음** — 목업 숫자 모양은 지금 포맷터와 다르다: "525,114,227 **원**"(₩ 없음, 단위 분리)·"+12.**50**%"(지금 `signed(pnlPct,1)`, PortfolioView.tsx:330)·"D-55"(지금 `reviewCountdown` "55일 뒤", :382). `lib/` 포맷터를 고치면 합격 기준 5(lib diff 0) 위반이고 기준 통화가 USD일 수도 있다(`CURRENCY_META[base]`). → 지금 포맷 그대로 두고 차이를 합격 6에 이유로 적거나, 바꾸려면 주인에게.
- 걱정 **고쳐야 함** — 목업에 없는 정보가 빠진다: 현금(:350-353, 테스트 :274 `₩17,400,000`), 빠진 것 안내 `money-note`(:361-371), "현금 포함 · 원화 기준". 지우면 정보 손실 → 요약 칸 아래 한 줄로 남김.
- 걱정 **고쳐야 함** — 신호 칸 넷: 지금 `signalKinds`는 매수·매도·비중 셋만 센다(:107-115). **관망 수는 새 계산**(Dashboard 쪽 `summary.watch`엔 있음). 0인 종류는 지금 숨긴다(:258) → 넷 고정이면 바뀐다. 관망만 누를 수 없는 칸이면 "가짜 단추" 검사에 걸린다(눌림 칸과 모양을 다르게). 테스트 :279-285가 region "확인할 신호"와 단추 이름 4개를 정확히 본다.
- 걱정 **고쳐야 함** — 문구 "최근 거래일 대비"→"전일 대비": 테스트 :265·:272 수정. 평가손익과 수익률을 칸으로 나누면 :271 `'+₩1,250,000 +25.0%'`(한 덩어리 textContent)도 깨진다. 설명 툴팁(:337 title)은 유지.
- 걱정 **고쳐야 함** — 폰 표: 지금 `narrow ? HoldingList : HoldingTable`(:205). 폰에 `HoldingTable`을 쓰고 펼침을 넣으면 **새 상태**(2-2 먼저 묻기). → `HoldingList`(펼침 상태 :584 그대로)의 마크업을 머리줄 + 그리드 줄로 바꾸는 쪽이 안전. `aria-label="… 자세히"`·`id="holding-…"` 유지(테스트 :379·678·822-864). 360·확대 150%에서 긴 이름("TIGER 미국필라델피아반도체나스닥")+nowrap 숫자 셋이 가로 넘침을 내는지 먼저 잴 것.
- 걱정 참고 — 매크로 줄·리뷰 줄(PortfolioView.tsx:148-151)은 ㉡ 답 전엔 자리만 비워 둔다.

## 6. 머리줄(AppBar)·시그널 보기 색
- 걱정 **고쳐야 함** — 색 머리줄이면 상태바·주소창 색이 머리줄과 달라진다: theme-color를 `--bg`에서 읽는 곳이 `lib/prefs.ts:111`(+ `prefs.test.ts:125`), `index.html:20,41`, manifest. 맞추려면 lib를 건드린다 → 합격 5의 예외로 적거나 `--bg` 그대로 두고 어긋남을 받아들일지 결정. iOS `black-translucent`(index.html:48)라 머리줄이 노치 밑까지 칠해진다 → `safearea.mjs` 다시.
- 찬성: 시그널 보기 "머리줄·탭·색만"은 CSS로 된다. 왼쪽 색 띠 제거(index.css:4356·4512·5416)도 CSS만.

## 7. 순서 제안 (커밋 단위)
쪼개기(diff 0 증명) → 토큰 도입(값 그대로, 이름만) → 색 값 교체 + 차트·theme-color → 글꼴 → 부품 → 대시보드 B. 단계마다 audit 수치를 남겨 어느 커밋이 수치를 움직였는지 갈린다.
