# 디자인 4차 — 묶음 3(종목 탭 · 종목 안 · 차트 창) 사용자 확인

- 기준: `claude/design-4-zerobase`. `frontend`에서 `npm run build`를 한 뒤 가짜 서버를 `--reset --port 8182 --data-dir …/u3/data`로 띄웠다(이 서버에는 `--data`가 없고 `--data-dir`이 있다). 서버는 PID로 껐고, 저장소는 고치지 않았다(git status 깨끗).
- 코드는 보지 않았다. 화면과 화면의 글만 봤다. Chromium(Playwright)을 썼고, 누를 때는 역할과 보이는 글로 골랐다.
- 기기: 폰 390(다크·라이트) · 폰 360(다크, 상승 빨강) · PC 1400(다크) · 확대 150%(창 933, 배율 1.5).
- 스크린샷(저장소 밖): `/tmp/claude-0/-home-user-Dashboard/c9553d42-71a5-5379-90e1-1c42ba786c3a/scratchpad/u3/shots/` (아래 파일 이름은 이 폴더 기준). 묶어 본 그림 세 장은 한 단계 위 폴더에 있다: `/tmp/claude-0/-home-user-Dashboard/c9553d42-71a5-5379-90e1-1c42ba786c3a/scratchpad/u3/light-montage.png`, `…/u3/m360.png`, `…/u3/mz.png`
- 심각도: **못 끝냄** / **헤맴** / **거슬림**.
- 데이터에 대한 주의: 과업 1에서 삼성SDI를, 360 확인 때 IVV(1,200주)를 담았다. 그래서 그 뒤 화면은 총액이 33억대이고 비중 배지가 처음과 다르다.

## 0. 첫인상 (폰 390, 5초)

| 화면 | 기획자 정답 | 5초 뒤 내 답 | 판정 |
| --- | --- | --- | --- |
| 종목 탭 (주인) | 맨 위 찾기 칸에 써서 담는다. 아래는 담은 종목과 현재가·등락·신호, 누르면 그 종목의 차트·신호·재무·보유 | "위 칸에서 찾아 담고, 아래는 내 종목들 값·등락·매수/매도 배지. 줄 끝 › 를 누르면 들어간다." 다만 노란 "목표 비중 합계 94.0%"가 경고처럼 눈에 먼저 들어오고 왜 노란지는 모르겠음 | **맞음** `owner-phone-stocks.png` |
| 종목 안 (주인, NVDA) | 이 종목 지금 값과 오늘 신호, 차트. 위 탭으로 신호 이유·재무·내 보유를 본다 | "지금 $696.62, ▲매수, 아래 차트. 탭 차트·신호·재무·보유." 맞게 읽힘 | **맞음** `owner-phone-d-t3-popup.png` `owner-phone-l-nvda.png` |
| 종목 안 (지인, SCHD) | 같음 | "◆비중 초과인데 바로 밑에 '매수 조건 3/4' — 사라는 건가?" 신호가 무엇인지 둘이 다른 말을 함 | **반쯤** `friend-phone-d-detail.png` |
| 종목 탭 (처음 온 사람) | 찾기 칸에 써서 담는다 | 펼쳐진 설명 7줄 아래에 찾기 칸, 그 아래 "담은 종목이 없습니다 — 위 찾기 칸에…". 어디에 쓰는지는 분명함 | **맞음** `new-phone-d-stocks.png` |

## 1. 과업 걷기 — 몇 번 만에

| # | 누구 | 하려던 것 | 기기 | 지나간 곳 | 누른 횟수 | 결과 · 스크린샷 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 주인 | 삼성SDI 담기 + 목표 4% · 10주 · 평단 380000 | 폰 390 다크 | 종목 탭 → 찾기 칸 "삼성SDI" → 제안 → 시트(구분/목표 비중/보유 수량/평단가) → 종목 추가 | 탭 1 + 칸 1 + 제안 1 + 칸 3 + 추가 1 = 7 | 됨. "✓ 삼성SDI 시세를 다 받았습니다"가 뜨고 목록 맨 위에 ▲매수로 붙음. `owner-phone-d-t1-search.png` `owner-phone-d-t1-added.png` `owner-phone-d-t1-filled.png` `owner-phone-d-t1-done.png` |
| 1 | 주인 | 긴 이름 종목 담기(iShares Core → IVV, 1,200주) | 폰 360 빨강 | 같음 | 7 | 됨. 목록에는 "IVV"로만 나오고 종목 안 제목은 "iShares Core S&P 500 ETF". 시트에 '산 환율' 칸이 없어 보유 탭에 "산 환율 —"로 남음 `owner-360-search-long.png` `owner-360-sheet-long.png` `owner-360-red-added.png` `owner-360-red-ivv-보유.png` |
| 2 | 주인 | VOO 수량 40 → 45 | 폰 390 다크 | 종목 탭 → VOO → "보유" 탭 → 고치기 → **"종목 한 번에 수정 16종목"** 창(VOO 칸에 커서) → 45 → 저장 | 6 | 됨("✓ VOO 1종목을 저장했습니다"). VOO 하나를 고치려 했는데 16종목 전체 수정 창이 떠서 잠깐 멈칫함(막힌 곳 2) `owner-phone-d-voo-보유.png` `owner-phone-d-t2-edit.png` `owner-phone-d-t2-saved.png` |
| 3a | 주인 | 오늘 신호 종목(NVDA) 근거 보기 — 홈에서 | 폰 390 | 홈 보유 줄 "NVDA" → 펼침 → "차트" → 차트 창 → 신호 탭 → "매수 조건 4/4 ▾" → 근거 4줄 → 뒤로가기(또는 ✕) | 5 + 닫기 1 | 됨. 뒤로가기 한 번이면 창만 닫히고 홈에 남음. 시그널 목록(?view=signal)에서 이름 "TSLA"를 누르면 창이 바로 뜨고, ✕로 닫으면 목록에 남음 `owner-phone-d-t3-home-expand.png` `owner-phone-d-t3-popup.png` `owner-phone-d-t3-popup-조건.png` `owner-phone-d-t3-afterback.png` `owner-phone-d-t3-sig-popup.png` |
| 3a | 주인 | 같은 일 | PC 1400 | 홈 표의 이름 "NVDA" → 창 → 신호 → 매수 조건 → Esc | 3 + Esc | 됨. PC는 이름을 누르면 창이 바로 열림 `owner-pc-t3-home-popup.png` `owner-pc-t3-home-popup-신호.png` |
| 3b | 주인 | 같은 일 — 종목 탭에서 | 폰 390 | 종목 탭 → NVDA 줄 → 종목 안 → 신호 탭 → 매수 조건 → ‹ | 5 | 됨. ‹ 로 돌아오면 목록 스크롤 위치가 그대로 `owner-phone-l-nvda-신호.png` |
| 4a | 주인 | 카드로 바꾸고, 다시 열어도 카드인지 | 폰 390 | 종목 탭 → ⋯ → 카드 보기 → 홈 → 종목 탭 / 새 탭 | 2 | 됨. 다른 탭에 갔다 와도, 새 탭에서 열어도 카드 그대로. 다만 ⋯ 를 눌러야 보이므로 처음엔 어디서 바꾸는지 한 번 찾아야 함 `owner-phone-d-t4-menu.png` `owner-phone-d-t4-card.png` `owner-phone-d-t4-card-newtab.png` |
| 4b | 주인 | 종목 순서 하나 바꾸기 | 폰 390 | ⋯ → ↕ 순서 바꾸기 → NVDA ▲ → 순서 바꾸기 끝 | 4 | 한 칸 올리기는 됨. 새로고침해도 남음. **두 칸 올리려고 같은 자리 ▲를 다시 누르면 제자리로 돌아감**(막힌 곳 3) `owner-phone-d-t4-order-moved.png` `owner-phone-d-t4-order-tap3.png` |
| 5a | 주인 | AAPL PER | 폰 390 | 종목 탭 → AAPL → 재무 탭 | 3 | 됨. 첫 카드가 "PER 17.5배" `owner-phone-d-t5-aapl-재무.png` |
| 5b | 주인 | 여러 종목 PER 한눈에 | 폰 390 | 종목 탭 → ⋯ → "PER 한눈에" → '재무' 화면 | 3 | 찾음. AAPL 재무 탭에서는 이리로 가는 길이 없어서, 목록으로 돌아가 ⋯ 를 열어 봐야 알았음(찾지 못한 것 2) `owner-phone-d-t5-per.png` `owner-phone-d-t5-per-table.png` |
| 6 | 지인 | 아무 종목 AI 분석 열기 | 폰 390 | 종목 탭 → SCHD → (탭 넷에 AI 없음) → 차트 아래로 내림 → "AI 분석 ›" → 키 넣기 안내 | 3 + 내림 1 | 키 안내까지 나옴. 첫 화면에 AI 자리가 없어 내려 봐야 찾음(찾지 못한 것 1). 열고 나서 뒤로가기를 누르면 차트가 아니라 종목 목록으로 감 `friend-phone-d-detail.png` `friend-phone-d-t6-ai.png` |
| 7 | 처음 온 사람 | 첫 종목 담기 | 폰 390 | 홈 "종목 추가하러 가기" → 종목 탭(칸에 커서 없음) → 칸 → "VOO" → 제안 → 수량 3 → 추가 | 6 | 됨. 그런데 바로 노란 경고 "목표 비중을 비워 0%로 넣었습니다 — 리밸런싱에서 전부 파는 계산이 됩니다"와 배지 "비중 초과"가 뜸(헷갈린 말 4) `new-phone-d-home.png` `new-phone-d-t7-search.png` `new-phone-d-t7-done.png` `new-phone-d-t7-home-after.png` |
| 8 | 주인 | 안 쓰는 종목 지우기(東京海上…) | 폰 390 | 종목 탭 → 종목 → "보유" 탭 → 맨 아래 '이 종목' 칸 "삭제" → 확인 창 → "네, 지웁니다" | 5 | 됨. **지우기 전에 묻는다.** 확인 창이 '비활성화'라는 다른 길도 알려줌. 지운 뒤 목록으로 돌아오는데 '지웠습니다' 같은 말이 없이 줄만 사라짐 `owner-phone-d-t8-보유.png` `owner-phone-d-t8-confirm.png` `owner-phone-d-t8-deleted.png` |
| 9 | 주인 · 손님 · 승인 대기 | 옛 북마크 `/history?ticker=QQQ` | 폰 390 | 주소 직접 | 0 | 주인은 `/stocks/QQQ` 종목 안 차트 탭으로 감. 손님은 "로그인하면 담은 종목의 차트를 볼 수 있습니다", 승인 대기는 "가입 신청을 받았습니다". 새는 것 없음 `owner-phone-d-t9-history.png` `guest-phone-d-hist.png` `pending-phone-d-hist.png` |
| 9' | 지인 | 내 목록에 없는 종목 주소(`/stocks/NVDA`, `/history?ticker=NVDA`) | 폰 390 | 주소 직접 | 0 | 영어 "stock not found" 상자, 빈 차트, "매수 0일 (0번)"이 나오고, 담는 길은 없는데 AI 분석 단추는 있음(막힌 곳 1) `friend-phone-d-other_stocks_NVDA.png` |
| — | 손님 · 승인 대기 | /stocks · /stocks/VOO · /fundamentals | 폰 390 | 주소 직접 | — | 손님은 "로그인하면 종목을 담을 / 차트를 볼 / 재무를 볼 수 있습니다" + 로그인 단추. 승인 대기는 어디서나 가입 신청 안내 하나. 새지 않음 `guest-phone-d-stocks.png` `guest-phone-d-voo.png` `guest-phone-d-fund.png` `pending-phone-d-*.png` |

## 2. 막힌 곳

| # | 누구 · 과업 | 어디서 | 무엇이 보였나 | 스크린샷 | 심각도 |
| --- | --- | --- | --- | --- | --- |
| 1 | 지인 · 남이 보내 준 종목 주소 / 옛 북마크 | 내 목록에 없는 종목의 종목 안 | 영어 "stock not found"가 뜨고, 차트는 빈 틀이고 "매수 0일 (0번) · 저장된 시세 없음". 담기 단추는 없는데 AI 분석 단추는 살아 있음. 무엇을 하면 되는지 모름 | `friend-phone-d-other_stocks_NVDA.png` `friend-phone-d-other_stocks_ZZZZ.png` | 헤맴 |
| 2 | 주인 · VOO 수량 고치기 | 종목 안 보유 탭 "고치기" | VOO 하나 고치려는데 "종목 한 번에 수정 16종목" 창이 열림. 커서는 VOO 수량 칸에 있지만 위아래로 다른 종목 칸이 가득해서 "다른 걸 잘못 건드리면?" 하고 멈칫함 | `owner-phone-d-t2-edit.png` | 헤맴 |
| 3 | 주인 · 순서 바꾸기 | ↕ 순서 바꾸기 목록 | ▲를 누르면 종목이 한 칸 올라가고 그 자리에 아래 종목의 ▲가 옴. 같은 자리를 다시 누르면 아래 종목이 올라가서 처음 순서로 돌아감(TSLA ▲를 세 번 눌러 확인). 저장했다는 말도 없음 | `owner-phone-d-t4-order-moved.png` `owner-phone-d-t4-order-tap3.png` | 헤맴 |
| 4 | 주인 · 확대 150% · 목록에서 종목 열기 | 내려 둔 종목 목록 → AAPL | 종목 안이 목록을 내린 위치 그대로 열려서 이름·값·탭은 화면 밖이고 차트 가운데부터 보임. 폰 390·PC 1400에서는 맨 위부터 열림 | `owner-z150-detail-from-scrolled.png` `owner-z150-aapl.png` | 헤맴 |
| 5 | 주인 · 폰 홈에서 차트 열기 | 홈 보유 줄 | 폰에서는 이름을 누르면 줄이 펼쳐지고, 펼친 곳의 "차트"를 한 번 더 눌러야 창이 열림. PC는 이름을 누르면 바로 열림. 기기마다 누르는 횟수가 다름 | `owner-phone-d-t3-home-expand.png` | 거슬림 |

## 3. 헷갈린 말

| # | 누구 | 어디서 | 무엇이 보였나 | 스크린샷 | 심각도 |
| --- | --- | --- | --- | --- | --- |
| 1 | 지인 | 종목 안 차트·신호 탭 "매수 조건 3/4" · "1/4" | 신호가 없거나 ◆비중 초과인 종목에도 "매수 조건 n/4" 상자가 맨 위에 나와서, 사라는 뜻인지 아닌지 모름. 신호 탭에는 "오늘은 매수·매도 신호 없음" 같은 한 줄이 없음 | `friend-phone-d-detail.png` `owner-phone-d-voo-신호.png` | 헤맴 |
| 2 | 지인 · 주인 | 근거 줄 "✓ DI 약세: -DI > +DI, 하락 방향이 우위", "StdDev20 축소 또는 거래량비 > 1.1", "종가가 MA20 아래" | 매수 이유에 '약세·하락 우위'가 ✓로 붙어 있어 거꾸로 읽힘. 약어(MA20·StdDev20·DI)는 초보가 못 읽음 | `owner-phone-d-t3-popup-조건.png` | 거슬림 |
| 3 | 주인 | 재무 탭 "PER — 지난 5년 중 어디쯤", PER 한눈에 "5년 위치" | 바로 아래 문장은 "지난 2024.08부터"(약 2년). 5년이라는 말과 실제 기간이 다름 | `owner-phone-d-t5-aapl-재무.png` `owner-phone-d-t5-per.png` | 거슬림 |
| 4 | 처음 온 사람 | 첫 종목을 담은 직후 | "⚠ 목표 비중을 비워 0%로 넣었습니다 — 리밸런싱에서 전부 파는 계산이 됩니다 … ⋯ 의 '한 번에 수정'(리밸런싱에서는 '보유 · 목표 비중')"과 배지 "◆비중 초과". 담는 시트에서는 비워도 되는 것처럼 보였는데 담자마자 '전부 판다'는 말이 나와 놀람. 고치는 곳 이름도 셋 | `new-phone-d-t7-done.png` | 헤맴 |
| 5 | 처음 온 사람 | 빈 홈의 세 단계 안내 | "종목 담기 — **종목 관리**에서", "보유수량 적기 — 추가할 때나 **리밸런싱**에서". 탭 이름은 "종목"이고 담는 시트에는 "종목 안의 '보유'에서 고칠 수 있습니다"라고 씀. 같은 곳을 세 이름으로 부름 | `new-phone-d-home.png` `owner-phone-d-t1-added.png` | 거슬림 |
| 6 | 지인 | AI 분석 카드 ↔ 연 뒤 | 카드는 "신호 근거와 소식을 글로 정리합니다", 열면 "이 종목의 재무(PER·PBR·ROE…)… 회사 자료를 한 장으로". ETF(SCHD)에도 '회사 자료'라고 씀 | `friend-phone-d-detail.png` `friend-phone-d-t6-ai.png` | 거슬림 |
| 7 | 주인 | "PER 한눈에" 단추 → 화면 제목 "재무" | 누른 단추와 도착한 화면의 이름이 다름. 폰에는 ‹ 도 없음 | `owner-phone-d-t5-per.png` | 거슬림 |
| 8 | 모두 | 종목 탭 머리 "종목 15종목" · "종목 0종목" | '종목'이 두 번 겹침 | `owner-phone-stocks.png` `new-phone-d-stocks.png` | 거슬림 |
| 9 | 주인 | 거르기 "신호 12" / 탭의 "신호 ●" | ◆비중 미달만 있는 VOO·QQQ도 '신호'로 셈하고 신호 탭에 점이 붙음. 홈의 "매수/매도/비중조절" 셋과 세는 방식이 다름 | `owner-phone-stocks.png` `owner-phone-d-voo-신호.png` | 거슬림 |
| 10 | 주인 | 보유 탭 "밴드 기본값", 한 번에 수정 "밴드 %p", 종목 안 "미국 · 알파" | '밴드', '알파'(내가 정한 구분)에 설명이 없음 | `owner-phone-d-voo-보유.png` | 거슬림 |
| 11 | 주인 | 시그널 목록 맨 아래 설명 | "흐린 는 관망(…)" — 글자 하나가 빠진 듯 읽힘 | `owner-phone-d-sig-all.png` | 거슬림 |
| 12 | 주인 | 종목 줄 "006400.KS · 한국 · ₩KRW" | ₩와 KRW가 겹침. 미국 종목은 티커 없이 "미국 · $USD" | `owner-phone-stocks.png` | 거슬림 |

## 4. 찾지 못한 것 · 눈에 걸린 것

| # | 누구 | 찾던 것 / 본 것 | 무엇이 보였나 | 스크린샷 | 심각도 |
| --- | --- | --- | --- | --- | --- |
| 1 | 지인 | AI 분석 | 위 탭(차트·신호·재무·보유)에 없고, 폰에서는 차트 아래로 한 화면 내려야 카드가 나옴. 연 뒤에는 위 탭 어느 것도 선택 표시가 없고, 뒤로가기를 누르면 차트가 아니라 종목 목록으로 감 | `friend-phone-d-detail.png` `friend-phone-d-t6-ai.png` `friend-phone-d-t6-afterback.png` | 헤맴 |
| 2 | 주인 | AAPL 재무 → 여러 종목 비교 | 재무 탭에서 'PER 한눈에'로 가는 길이 없음. 목록 ⋯ 안에만 있음 | `owner-phone-d-t5-aapl-재무.png` `owner-phone-d-t4-menu.png` | 헤맴 |
| 3 | 주인 | 카드/줄 바꾸기·순서·한 번에 수정 | 모두 머리의 ⋯ 하나 아래에 있음. 처음엔 ⋯ 가 무엇인지 모름(PC에서는 단추가 펼쳐져 보임) | `owner-phone-stocks.png` `owner-pc-stocks.png` | 거슬림 |
| 4 | 주인 | 종목 지우기 | '보유' 탭 맨 아래 '이 종목' 칸에 있음. 목록에서는 지울 수 없음. 지운 뒤 '지웠습니다'라는 말이 없음 | `owner-phone-d-t8-보유.png` `owner-phone-d-t8-deleted.png` | 거슬림 |
| 5 | 주인 | 보유 탭의 평가금액·손익 | 수량·평단가·환율·목표 비중만 있고 지금 평가액·손익·현재 비중은 없음(홈 줄에는 있음) | `owner-phone-d-voo-보유.png` | 거슬림 |
| 6 | 주인 | PER 한눈에에 ETF가 없음 | 16종목 중 11개만 나오는데, VOO·QQQ·SCHD·KODEX·TIGER가 왜 빠졌는지 말이 없음. 아래 표는 폰에서 카드가 길게 이어져 전체 높이가 약 5,500px | `owner-phone-d-t5-per-full.png` | 거슬림 |
| 7 | 모두 | 차트 그림 | 지금 가격 꼬리표가 바로 위 눈금(720.00, 1,800)을 덮음. ◀ ▶ 단추가 차트 안 오른쪽 위에 떠 있음. 폰 360 창에서는 x축 "11월"이 잘리고, 150%에서는 왼쪽 끝 ".06"만 보임. PC 1년 축에 "03.03"이 섞임. 폰 아래 설명이 "262거래일 표시 · 세로축 로그 스케일" / "· 길게 누른 채 밀면…" 두 칸으로 어긋나게 꺾임 | `owner-phone-d-t3-popup.png` `owner-phone-d-t8-longname.png` `owner-360-red-popup.png` `owner-pc-aapl.png` `owner-z150-detail-from-scrolled.png` | 거슬림 |
| 8 | 주인 | 카드 보기 · 360 | 긴 이름 "TIGER 미국필라델피아반도체나스닥"이 카드 오른쪽 테두리에 닿음. 카드의 작은 선 그래프 색(기간 흐름)과 오늘 등락 % 색이 반대일 때가 있음(삼성SDI: 선은 빨강, +2.31%는 초록) | `owner-360-red-card2.png` `owner-phone-d-t4-card.png` | 거슬림 |
| 9 | 주인 | 새로 담은 종목이 붙는 자리 | 삼성SDI는 목록 맨 위, 나중에 담은 IVV는 두 번째에 붙음 | `owner-phone-d-t1-done.png` `owner-360-red-added.png` | 거슬림 |
| 10 | 주인 | 담는 시트 '구분' 칸 | "비워 둬도 됩니다"만 있고 무엇을 고르는 칸인지 모름(설명은 '자세히'를 펼쳐야 나옴). 달러 종목인데 '산 환율' 칸이 없어 보유 탭에 "—"로 남음 | `owner-phone-d-t1-구분.png` `owner-360-red-ivv-보유.png` | 거슬림 |
| 11 | 주인 | 노란 "목표 비중 합계 94.0%" | 거르기 칩 줄 끝에 경고색으로 있는데 눌러도 아무 일이 없고 이유 설명도 없음. 360에서는 다음 줄로 떨어짐 | `owner-phone-stocks.png` `owner-360-red-added.png` | 거슬림 |
| 12 | 처음 온 사람 | "종목 추가하러 가기" 뒤 | 종목 탭으로 가지만 찾기 칸에 커서가 없어 한 번 더 눌러야 함. '자세히' 설명 7줄이 펼쳐진 채라 찾기 칸이 화면 가운데까지 밀림 | `new-phone-d-t7-go.png` | 거슬림 |

## 5. 좋았던 것

| # | 누구 | 무엇 | 스크린샷 |
| --- | --- | --- | --- |
| 1 | 주인 · 지인 | 지난번 막혔던 "종목 탭에 차트·재무가 없다"가 풀림. 종목 줄을 누르면 차트·신호·재무·보유가 있는 종목 안으로 감. 첫인상 정답과 같게 읽힘 | `owner-phone-d-voo.png` `owner-phone-l-nvda.png` |
| 2 | 주인 | 찾기 → 제안 → 시트 한 장(목표·수량·평단)으로 담기가 7번 안에 끝남. "✓ … 시세를 다 받았습니다"와 새 종목의 ▲매수 배지가 바로 보임. 이미 담은 종목은 제안에 "담음"으로 표시 | `owner-phone-d-t1-filled.png` `owner-phone-d-t1-done.png` |
| 3 | 주인 | 홈 줄 · 시그널 목록 · 종목 탭 어디서 열어도 같은 네 탭 화면. 폰 창은 뒤로가기 한 번에 닫히고 자리가 그대로. PC는 이름을 누르면 바로 열리고 Esc로 닫힘 | `owner-phone-d-t3-afterback.png` `owner-pc-t3-home-popup.png` |
| 4 | 주인 | 신호 이유가 "매수 조건 4/4 ▾"를 펴면 문장 4줄로 나옴. "11-06 기준 · 차트에서 다른 날을 골라도 이 날의 조건입니다"가 친절함 | `owner-phone-d-t3-popup-조건.png` |
| 5 | 주인 | 카드 보기를 다른 탭에 갔다 와도, 새 탭에서 열어도 기억함. 순서 바꾸기도 새로고침 뒤 남음 | `owner-phone-d-t4-card-newtab.png` |
| 6 | 주인 | PER 한눈에: 지금 ● · 중앙값 \| · 범위 막대 한 줄씩이라 비싼지 싼지 위치가 바로 보임. "적자"도 따로 표시 | `owner-phone-d-t5-per.png` |
| 7 | 주인 | 삭제 전에 확인 창을 띄우고, 무엇이 지워지고 무엇이 남는지와 '비활성화'라는 다른 길까지 알려 줌 | `owner-phone-d-t8-confirm.png` |
| 8 | 주인 | 옛 주소 `/history?ticker=QQQ`가 새 종목 안으로 바로 이어짐(뒤로가기에 옛 주소가 남지 않음) | `owner-phone-d-t9-history.png` |
| 9 | 손님 · 승인 대기 | 종목·종목 안·재무·옛 주소 어디로 가도 포트폴리오가 새지 않고, 화면마다 맞는 안내("…차트를 / 재무를 볼 수 있습니다") | `guest-phone-d-voo.png` `pending-phone-d-voo.png` |
| 10 | 모두 | 라이트·상승 빨강에서도 배지에 ▲▼◆ 모양이 같이 붙어 색만으로 읽지 않아도 됨. 억 단위 총액 ₩3,318,448,217도 360에서 한 줄에 들어옴. 긴 일본어·한국어 종목명도 종목 안 제목에서 한 줄에 들어옴 | `light-montage.png`(한 단계 위 폴더) `owner-360-red-home.png` `owner-360-red-tiger.png` |
| 11 | 처음 온 사람 | 빈 종목 탭에 "담은 종목이 없습니다 — 위 찾기 칸에…"가 있어 어디에 쓸지 망설이지 않음 | `new-phone-d-stocks.png` |
