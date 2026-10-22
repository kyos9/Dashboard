# 0.45.1 B·C·D 사용자 확인 (화면만, 코드 안 읽음)

- 가짜 서버 8171, `--reset --demo-backup-warning`. 화면은 이미 빌드된 것(직접 빌드하지 않음). 화면 왼쪽 위 v0.45.1.
- 기기: PC 1400 · 폰 390/360(터치, CDP 터치로 끌기까지) · 확대 150%(933px·배율 1.5) × 다크·라이트, 상승 색 빨강으로 바꾼 상태도 걸음.
- 스크린샷: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/`

## 막힌 곳

| 사람 | 과업 | 본 것 | 스크린샷 | 심각도 |
| --- | --- | --- | --- | --- |
| — | — | 끝까지 못 간 과업은 없음 | — | — |

## 헤맴·헷갈린 말

| 사람 | 과업 | 본 것 | 스크린샷 | 심각도 |
| --- | --- | --- | --- | --- |
| 지인 (폰 390) | 2. `/history?ticker=voo` | 차트와 종가(93.95)는 뜨는데 **종목 이름 줄이 없고**(대문자로 열면 보이는 "VOO · VOO"가 없다) 위의 종목 단추도 아무것도 눌린 모양이 아님. 이게 어느 종목 차트인지 화면만으로는 모름. VOO 단추를 다시 누르면 그제야 이름이 붙음 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/35-friend-390-history-voo.png · /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/39-owner-pc-history-voo.png | 헤맴 |
| 주인·지인 (폰 390, 1년) | 1. 한 날 누르고 바로 옆 날 | 두 번째 누름은 곧바로 그 날로 바뀜. 그런데 1년 보기에서 1px이 하루쯤이라 손가락으로 "바로 다음 거래일"을 짚을 수 없음 — 2px 옮기니 10-14 → 10-12(10-13을 건너뜀), 6px 옮기니 04-27 → 05-05. 6개월 보기도 2px쯤이 하루 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/47-owner-390-popup-chart-tap.png · /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/06-owner-390-tap2.png · /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/10-owner-390-6m-tap.png | 헤맴 |
| 주인 (폰 390) | 1. 옆 날로 손가락을 밀어 봄 | 옆으로 끄니 날짜가 따라오지 않고 **차트가 통째로 밀림** — 왼쪽이 비고 오른쪽(오늘 쪽) 끝과 마지막 가격 줄이 화면 밖으로 감. 원래대로 돌리는 단추는 안 보임(기간 단추를 다시 눌러야 하나 싶음) | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/11-owner-390-drag.png | 헤맴 |
| 주인 (PC) | 2. 이름으로 보낸 주소 `/history?ticker=삼성전자` | "‘삼성전자’ 은 담은 종목에 없습니다"라고 나오는데 바로 위 단추에 삼성전자가 있음. 담은 종목인데 없다고 해서 헷갈림 | (글로 확인, 화면 모양은 /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/34-friend-390-history-NOPE.png 와 같음) | 헤맴 |
| 지인 | 2. NOPE | "‘NOPE’ 은 …", "‘NVDA’ 은 …" — 조사가 어색. 빈칸 주소(`?ticker=%20`)는 "‘ ’ 은 담은 종목에 없습니다" | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/34-friend-390-history-NOPE.png · /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/38-friend-390-history-space.png | 거슬림 |
| 주인 (PC·폰) | 3. 맨 위만 보고 백업 | 맨 위 한 줄 "서버 로그: 최근 경고·오류 없음 · 백업 확인 필요" — 앞쪽 "없음"이 먼저 읽히고, 같은 작은 회색 글이라 "확인 필요"가 눈에 덜 띔. 무엇을 확인하라는지는 맨 위만으로 모름. 아래 백업 칸의 주황 경고("40일 동안 밖에 꺼내지 않았습니다")와는 **맞음** | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/13-owner-pc-diag-top.png · /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/16-owner-390-light-diag-top.png · /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/60-owner-933z-diag-top.png | 거슬림 |
| 주인 | 3. 아래 백업 칸 | "백업: 마지막 10월 22일 16:21"(오늘, 괜찮아 보임) 바로 아래 "밖에 꺼낸 것: 9월 12일" + 경고. 백업이 두 가지라는 설명이 없어 "오늘 떴는데 왜 확인 필요?"가 먼저 듦 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/13-owner-pc-diag-top.png | 거슬림 |
| 주인 | 3. 진단 시각 | 한 창 안에 시각이 9시간 어긋나 보임: "서버를 켠 10-22 07:21", 로그 "07:34" vs "백업 10월 22일 16:21". 날짜 적는 법도 셋(10-22 / 2026-10-22 / 10월 22일) | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/60-owner-933z-diag-top.png · /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/61-owner-933z-diag-all.png | 거슬림 |
| 주인 (PC·폰) | 3. 진단 찾기 | ⋯ 위 숫자 배지 "1"은 사용자(가입 신청) 수. 백업 경고("!")는 ⋯를 열어야 보임 — 배지만 보면 가입 신청 하나뿐인 줄 앎 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/12-owner-pc-menu.png · /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/15-owner-390-light-menu.png | 거슬림 |
| 주인·지인 | 1. 누른 날 뒤 | 한 번 누르면 "(마지막 날 — 차트를 누르면 그 날)"이 사라지고, 차트 밖을 눌러도 누른 날이 그대로 남음. 오늘로 돌아가는 길이 안 보임 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/09-friend-390-tapsame.png | 거슬림 |
| 주인 (PC) | 4. 알림 설정 | "받을 때"의 오후 칸이 흐린 체크(못 끔)라 옆의 빈 아침 칸과 둘 다 흐려 보여 어느 쪽이 켜진 건지 한 번 더 봄 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/19-owner-pc-alert.png | 거슬림 |
| 주인 | 4. 종목별 알림 | 접힌 채 "— 1종목 끔"만 보여 어느 종목인지는 펼쳐야 앎 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/19-owner-pc-alert.png | 거슬림 |
| 지인 (933·150%) · 주인 (PC) | 4. 종목별 알림 | 종목 체크 줄이 촘촘함(폰 360에서는 줄마다 넉넉함) | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/32-friend-933z-alert-bottom.png · /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/20-owner-pc-alert-pertk.png | 거슬림 |

## 찾지 못한 것

| 사람 | 과업 | 본 것 | 스크린샷 | 심각도 |
| --- | --- | --- | --- | --- |
| 지인 (폰 360) | 4. "🔔 알림 설정" | 폰 머리에는 🔔가 없음. ⋯ 안의 "알림 설정"으로 찾음(한 번 더 둘러봄) | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/28-friend-360-alert.png | 거슬림 |
| 처음 온 사람 | 4. 종목별로 끄는 곳 | 펼칠 칸은 없고 "종목을 담으면 여기서 종목마다 알림을 끌 수 있습니다" 한 줄 — 어디서 하는지는 알게 됨 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/25-new-390-alert.png | (찾음) |

## 좋았던 것

| 사람 | 과업 | 본 것 | 스크린샷 |
| --- | --- | --- | --- |
| 주인·지인 (폰) | 1 | 한 날 누른 뒤 다른 날을 누르면 기다림 없이 머리 줄 날짜·종가가 바뀜(빠르게 두 번 눌러도 마지막 것). 세로로 밀면 차트 위에서도 화면이 내려감. 차트 팝업 안에서도 같음 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/05-owner-390-tap1.png · /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/46-owner-390-light-red-popup-chart.png |
| 지인 | 2 | NOPE·남의 종목은 빈 차트 대신 "담은 종목에 없습니다 — 위에서 종목을 고르세요"와 내 종목 단추. 소문자 voo·005930.ks도 차트는 열림 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/34-friend-390-history-NOPE.png |
| 주인 | 3 | 40일 경고가 두 테마 모두 주황으로 눈에 띄고 할 일(파일 이름)까지 적힘. 맨 위 "백업 확인 필요"와 어긋나지 않음. ⋯ 메뉴의 진단 옆 "!" | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/16-owner-390-light-diag-top.png · /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/14-owner-pc-diag-full.png |
| 주인 | 4 | "모두 다시 받기" 한 번에 다 켜지고 "— 모두 받음"으로 바뀌며 단추가 사라짐. 새로고침 뒤에도 유지 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/21-owner-pc-alert-allon.png · /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/22-owner-pc-alert-reopen.png |
| 지인 (360·933 150%) | 4 | 끝까지 내려도 ✕가 위에 붙어 있어 바로 닫힘. 폰 뒤로가기로도 닫히고, 끈 것은 다시 열어도 남아 있음 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/29-friend-360-alert-bottom.png · /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/32-friend-933z-alert-bottom.png · /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/55-friend-360-light-alert-voo-off.png |
| 승인 대기·손님 | 새는지 | `/history?ticker=NOPE·voo`는 손님에게 "로그인하면 담은 종목의 차트를…", 승인 대기에게 "가입 신청을 받았습니다"만. 메뉴에 알림·진단 없음. 지인 메뉴에도 진단 없음 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/41-guest-history-NOPE.png · /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/41-pending-history-voo.png · /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/42-pending-menu.png |
| 회귀 1 | 오늘 매수 | 대시보드 "매수 4" → 시그널 카드 "마지막 매수 시그널 오늘" → 종목 이름 눌러 차트 팝업, 오른쪽 끝에 오늘 ▲. 뒤로가기로 팝업 닫힘 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/44-owner-390-signals.png · /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/46-owner-390-light-red-popup-chart.png |
| 회귀 2 | 100만 원 | 1000000 → "1,000,000"으로 바뀌고 "새로 넣을 돈 ₩1,000,000 반영". "팔지 않고 새 돈만 나누기"도 1주 미만 설명까지 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/49-owner-390-rebalance-1m.png · /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/50-owner-390-rebalance-1m-buyonly.png |
| 회귀 3·4·5 | 한 번에 고치기·가리기·뒤로 | ✎ 수정에서 두 종목 수량·평단 고치니 "2종목 저장". 금액 가리기 뒤 금액·주수만 ••••• 이고 %는 남음. 일괄 수정·알림·진단·화면 설정·차트 팝업 모두 뒤로가기로 닫힘 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/52-friend-390-bulkedit-filled.png · /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/53-friend-390-bulkedit-saved.png · /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/54-friend-390-hidden.png |
| 조건 | 긴 이름·억·빨강 | 360에서 "TIGER 미국필라델피아반도체나스닥 · 381180.KS" 넘치지 않음(가로 스크롤 없음). ₩488,916,301 한 줄. 상승 빨강으로 바꿔도 시그널 색은 그대로라는 설명이 화면 설정에 있음 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/62-owner-360-history-tiger.png · /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/userB-shots/43-owner-390-light-red-setting.png |
