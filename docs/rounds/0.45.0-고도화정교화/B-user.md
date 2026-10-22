# 0.45.0 항목 B (알림 — 받을 때 고르기 · 종목별 알림) 사용자 확인

가짜 서버 포트 8173, 이미 빌드된 화면을 씀. 코드는 읽지 않았음. 스크린샷 폴더: /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/
이 환경에서는 브라우저 알림이 "차단"으로 나옴. 그래도 아래 칸은 모두 보였고 저장도 됐음(PUT /api/push/settings 200).

과업 결과 요약: 이번 과업 1~4와 회귀 과업 1~5 가운데 "못 끝냄"은 없음.

## 막힌 곳
| 사람 | 과업 | 내용 | 스크린샷 | 심각도 |
| --- | --- | --- | --- | --- |
| 지인 (360 다크) | 3 둘 다 끄기 | 아침을 끄자 오후 칸이 회색으로 바뀌고 눌러도 안 바뀜. 왜 못 끄는지("하나는 남겨야 함" 같은 말)가 화면 어디에도 없음. 고장으로 보임 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t3-04-friend360-afternoon-locked.png | 헤맴 |
| 주인 (아이폰 390) | 1 처음 상태 확인 | 처음 열었을 때 오후 칸이 이미 회색(눌리지 않음). 왜 그런지 말이 없음 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t1-03-owner390-notif.png | 거슬림 |

## 헷갈린 말
| 사람 | 과업 | 내용 | 스크린샷 | 심각도 |
| --- | --- | --- | --- | --- |
| 지인 | 3 | "받지 않는 때 생긴 신호는 다음에 받는 때 알려 드립니다 — 그때도 켜져 있는 것만." "받지 않는 때", "그때도 켜져 있는 것만"이 무엇을 가리키는지(종류? 종목? 신호 자체?) 한 번에 읽히지 않음. 뜻(사라지지 않고 다음 때 온다)은 겨우 읽어 냄 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t3-03b-friend360-slots.png | 헤맴 |
| 지인 | 3 | 아침 칸 설명이 "미국 종목", 오후 칸 설명이 "일본·한국 종목"이라 "아침을 끄면 미국 종목 알림은 아예 끊긴다"로 먼저 읽힘. 바로 아래 문장을 읽어야 고쳐짐 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t3-03-friend360-notif.png | 거슬림 |
| 주인·지인 | 2·3 | "TIGER 미국필라델피아반도체나스닥"처럼 한국에 상장된 미국 ETF는 "미국 종목(아침)"인지 "한국 종목(오후)"인지 알 수 없음. 종목별 목록에 그 종목이 아침에 오는지 오후에 오는지 표시가 없음 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t6-03-owner360light-stocks.png | 거슬림 |
| 지인 | 3 | 아래쪽 안내 "장 마감 뒤 … 미국 종목은 한국 아침, 한국 종목은 오후"가 "받을 때" 칸 설명과 거의 같은 말을 되풀이함. 그런데 일본 종목은 빠져 있어 두 곳의 말이 조금 다름 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t3-03-friend360-notif.png | 거슬림 |
| 지인 | 3 | "비중조절 — 목표 비중에서 밴드만큼 벗어났을 때"의 "밴드"에 풀이가 없음(이번 기능 전부터 있던 말) | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t3-03-friend360-notif.png | 거슬림 |
| 지인 | 3 | 대시보드에는 "매도 3"이 보이는데 받을 알림 목록에는 매도가 없음. 매도는 알림이 안 오는 건지 말이 없음(이번 기능 전부터 있던 것) | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t3-03-friend360-notif.png | 거슬림 |

## 찾지 못한 것
| 사람 | 과업 | 내용 | 스크린샷 | 심각도 |
| --- | --- | --- | --- | --- |
| 주인·지인 (PC·폰 모두) | 2·3 | "종목별 알림 — 1종목 끔" 줄에 펼침 표시(삼각형·화살표)가 없음. 그냥 제목처럼 보여서 눌러야 목록이 나온다는 걸 알기 어려움. 누르면 펼쳐지긴 함 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t2-02-owner1400-notif.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t1-03-owner390-notif.png | 헤맴 |
| 주인 | 2 | 접힌 상태에서는 "1종목 끔"까지만 보이고 어느 종목인지는 펼쳐야 알 수 있음. 창을 다시 열면 또 접혀 있음 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t2-02-owner1400-notif.png | 거슬림 |
| 주인 | 1·2 되돌리기 | "기본값으로 되돌리기"나 "모두 켜기"가 없음. 받을 때는 칸이 둘뿐이라 괜찮았지만, 종목 4개를 끈 뒤 다시 켤 때는 하나씩 다시 눌러야 했음 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t2-04-owner1400-VOO-off.png | 거슬림 |
| 주인 | 2 | 대시보드·시그널 화면에서는 어느 종목의 알림을 껐는지 알 수 없음. 알림 창을 열어야만 보임 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t2-01-owner1400-home.png | 거슬림 |
| 처음 온 사람 | 4 | 종목이 0개면 "종목별 알림" 칸이 아예 없음. 빈 칸이 없어 깔끔하지만, 종목을 담으면 여기서 종목별로 끌 수 있다는 것은 알 수 없음 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t4-02-new390-notif.png | 거슬림 |
| 주인 (933px·배율 1.5) | 2 | 종목 목록을 끝까지 내리면 창 위쪽의 닫기(✕)가 같이 올라가 보이지 않음. Esc와 바깥 누르기로는 닫힘 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t6-02-owner933z-stocks-bottom.png | 거슬림 |
| 주인 (PC) | 2 | 머리줄 알림 단추가 글자 없이 🔔 아이콘만 있음. 받은 알림 목록인지 설정인지 눌러 봐야 앎(마우스를 올리면 "알림 설정"이 뜸) | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t2-01-owner1400-home.png | 거슬림 |

## 좋았던 것
| 사람 | 과업 | 내용 | 스크린샷 |
| --- | --- | --- | --- |
| 주인 (390) | 1 | 메뉴(⋯) → "알림 설정"을 바로 찾음. 아침이 꺼져 있는 것이 한눈에 보였고, 아침 칸 한 번 누르니 둘 다 켜짐. 새로고침한 뒤 다시 열어도 둘 다 켜져 있어 처음(기본) 상태와 같았음 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t1-03-owner390-notif.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t1-05-owner390-after-reload.png |
| 주인 (1400) | 2 | SCHD 켜기와 VOO 끄기가 각각 한 번 누르기로 끝남. 요약이 "모두 받음"에서 "1종목 끔", 4개를 끄면 "4종목 끔"으로 바로 바뀌어 몇 개가 꺼졌는지 한눈에 보임. 새로고침 뒤에도 그대로 남음 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t2-04-owner1400-VOO-off.png |
| 지인 | 3 | 둘 다 끌 수 없게 막혀 있어 알림을 통째로 잃는 일은 없음. 종목별 목록 아래 "끈 종목은 매수 시그널·비중 알림이 오지 않습니다. 리뷰 알림은 종목과 상관없이 옵니다."가 분명함 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t3-05-friend360-stocks.png |
| 모두 | 조건 | 아주 긴 종목명(TIGER 미국필라델피아반도체나스닥, 東京海上ホールディングス)도 한 줄에 다 들어감. 가로로 넘치는 것 없음. 폰에서 누르는 칸 높이 44px. 다크·라이트 모두 체크 상태 구분이 잘 됨 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t6-03-owner360light-stocks.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t3-04-friend360-afternoon-locked.png |
| 승인 대기·손님 | 새어 보임 | 머리줄 🔔도, 메뉴의 "알림 설정"도 보이지 않음. 설정 주소도 401로 막힘 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t5-01-pending1400.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t5-02-pending390-menu.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t5-03-guest390.png |
| 주인 | 회귀 5 | 폰 뒤로가기를 누르면 알림 창이 닫히고 앱 첫 화면(/)에 그대로 머묾 | (t1c·t6 실행 기록) |
| 지인 | 3 | 관리자가 아니면 "가입 신청" 칸이 없음 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/t3-03-friend360-notif.png |

## 회귀 과업
| # | 과업 | 결과 | 스크린샷 |
| --- | --- | --- | --- |
| 1 | 매수 시그널 종목을 찾아 차트에서 그 날 확인 | 끝냄. 시그널 → 매수 3 → NVDA 이름 → 차트에 "2026-10-21 · 마지막 날"이 보임. 표의 "마지막 매수 시그널" 날짜는 눌러도 아무 반응이 없어서 이름을 눌러야 했음(헤맴 정도는 아님) | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/r1-01-buy-list.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/r1-02-chart.png |
| 2 | 새로 넣을 돈 100만 원으로 주문 가이드 | 끝냄(폰 390). "새로 넣을 돈 넣기 ↓"를 누르면 입력 칸으로 바로 감. "새로 넣을 돈 ₩1,000,000 반영"이라고 뜸 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/r2-01-inflow.png |
| 3 | 여러 종목 수량·평단가 한 번에 고치기 | 끝냄. ✎ 수정 → VOO 수량, QQQ 평단가 → 저장 → 다시 열어도 그 값. 원래 값으로 되돌렸고, 알림 설정(1종목 끔)은 그대로였음 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/r3-01-bulk-edit.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/r3-02-saved.png |
| 4 | 금액 가리고 손익 %만 보기 | 끝냄. 금액은 •••••, %는 보임(한 주 가격은 그대로 보임) | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user-shots/r4-01-hidden-pc.png |
| 5 | 폰 뒤로가기로 팝업 닫기 | 끝냄. 알림 창이 닫히고 페이지를 벗어나지 않음 | - |

확인한 조건: PC 1400 · 폰 390(라이트) · 360(다크·라이트) · 933px 배율 1.5 · 상승 색 빨강(화면 설정에서 고름, 알림 창에는 색이 쓰이는 곳 없음) · 긴 종목명 · 억 단위 금액(대시보드 ₩483,877,945, 알림 창과는 상관없음).

서버: 끝에 kill $(cat /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/B-user.pid)로 껐고, 8173에 다시 접속해 응답 없음(000)을 확인함.
