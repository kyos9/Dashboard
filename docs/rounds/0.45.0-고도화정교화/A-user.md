# 0.45.0 항목 A(백업을 서버 밖으로) — 사용자 확인

가짜 서버 8171. 첫 데이터 폴더는 A-user-data였는데 작업자가 다시 시작돼 서버가 사라졌고, 회귀 2~4번과 확대·다크·빨강 확인은 새 폴더 A-user-data2에서 했다. 코드는 읽지 않았다.
"오래됨" 상태를 보려고 데모 데이터 파일 backups/backup-status.json 의 pulled_at 값만 바꿔 보았다(21일 전, 41일 전, 없음). 본 뒤에는 원래 값으로 되돌렸다.
스크린샷: /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/

## 막힌 곳
| 사람 | 과업 | 내용 | 스크린샷 | 심각도 |
| --- | --- | --- | --- | --- |
| 주인 | 2 (PC로 가져오기, 처음 한 번) | DEPLOY.md 10-0의 1단계와 bat 설정 파일은 KEY와 SERVER를 "3번에서 쓴 것"이라고 한다. 그런데 DEPLOY.md 3번은 방화벽 절이라 키 이야기가 없다. 키는 0·1번에 "공개키를 넣습니다/붙여넣기"로만 나온다. 개인키 파일이 PC 어디에 있는지, 파일 이름이 무엇인지는 어디에도 없다. 개발자가 아닌 주인은 KEY= 줄을 채우지 못한다 | (문서) DEPLOY.md 10-0, 3, 0, 1 / server-backup-pull.bat | 못 끝냄 |
| 주인 | 2 (무엇이 남는지 → 되돌릴 때) | 10-0은 PC의 %USERPROFILE%\dashboard-backups 에 받는다고 하고, 서버의 옛 ~/dashboard-backups 는 지우라고 한다(rm -rf). 바로 밑 10-1(되돌리기)은 여전히 서버의 ~/dashboard-backups/backups/ 에서 파일을 고르라고 한다. PC에 받은 사본으로 어떻게 되돌리는지(서버로 다시 올리는 법)는 없다 | (문서) DEPLOY.md 10-0 · 10-1 | 헤맴 |

## 헷갈린 말
| 사람 | 과업 | 내용 | 스크린샷 | 심각도 |
| --- | --- | --- | --- | --- |
| 주인 | 1 | 꺼낸 지 오래됐거나 한 번도 안 꺼내 백업 칸에 주황 경고 줄이 떠 있어도, 진단 맨 위는 그대로 "최근 기록에 경고·오류가 없습니다"이다. 같은 칸 안에서 서로 다르게 말한다 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/19-stale41d-owner-390-diag.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/11-never-diag.png | 헤맴 |
| 주인 | 1 | 한 번도 꺼내지 않았을 때 나오는 "내 PC 로 가져오는 법은 DEPLOY.md 10."은 누를 수 있는 링크가 아니다. 주인이 어디서 그 파일을 여는지 화면에 없다. 이 줄은 회색 보통 글씨라 경고로 보이지 않는다(41일 경고는 주황) | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/11-never-diag.png | 헤맴 |
| 주인 | 1 | 사흘 전이나 21일 전에 꺼낸 상태에서는 "밖에 꺼낸 것: 마지막 9월 30일"만 있고, 이게 괜찮은지 오래된 건지 말이 없다. 문서는 "일주일에 한 번"을 권하고 경고는 30일부터라, 21일이면 문서 기준으로는 늦었는데 화면은 아무 말이 없다 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/10-stale21d-diag.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/04-owner-pc-diag-view.png | 거슬림 |
| 주인 | 3 | "지금까지 10줄(사람마다 하루 한 줄)" — "줄"은 표의 행을 말하는 개발자 말이다. 10줄이 며칠어치인지(2명×5일인지) 주인이 바로 셈하지 못한다. 이 기록을 어디에 쓰는지, 왜 중요한지(다시 만들 수 없다는 것)도 화면에 없다 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/04-owner-pc-diag-view.png | 헤맴 |
| 주인 | 3 | "그날 2명(보유·현금이 있는 사람만)"은 이해된다. 다만 승인된 사용자가 3명(주인·지인·처음 온 사람)인데 2명이라, 괄호를 읽어야 처음 온 사람이 빠진 이유를 안다 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/04-owner-pc-diag-view.png | 거슬림 |
| 주인 | 1·3 | 한 칸 안에서 날짜 모양이 세 가지다: "2026-10-21"(평가금액 기록), "10월 21일 08:01"(백업·꺼낸 것), "10-21 08:01"(시그널·느린 요청) | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/04-owner-pc-diag-view.png | 거슬림 |
| 주인 | 1 | "1벌 보관(최대 7)" — "벌"이 백업 개수라는 건 문서를 읽어야 안다 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/04-owner-pc-diag-view.png | 거슬림 |
| 주인 | 2 | 문서와 bat에 "방침 5절", "매일 백업만(…-premigrate 따로)", "7벌 순환", 손 명령 블록(export/clean/mark) 같은 말이 있다. 주인이 따라 할 몫(설정 파일 두 줄, 다시 실행, 작업 스케줄러)과 몰라도 되는 몫이 한데 섞여 있다 | (문서) DEPLOY.md 10, 10-0 | 거슬림 |
| 주인 | 1·2 | 문서는 "v0.45.0부터"라고 하는데 화면 머리·메뉴 아래 판은 v0.44.0이다. 주인은 "아직 안 올라온 건가" 하고 멈칫한다 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/05-owner-ip390-light-menu.png | 거슬림 |

## 찾지 못한 것
| 사람 | 과업 | 내용 | 스크린샷 | 심각도 |
| --- | --- | --- | --- | --- |
| 주인 | 1 | 머리 ⋯ 단추의 표시는 가입 신청이 있으면 그냥 "1"이다. 41일 동안 안 꺼냈을 때도 똑같이 "1"이라 백업 경고가 겹쳐 있는지 겉으로는 모른다. 메뉴를 열어야 진단 옆 "!"가 보인다. 화면 읽기 프로그램 이름표에는 "백업을 확인하세요"가 붙는다 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/18-stale41d-owner-pc-menu.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/19-stale41d-owner-390-menu.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/02-owner-pc-menu.png | 헤맴 |
| 주인 | 1 | 한 번도 꺼낸 적이 없으면 ⋯ 메뉴에도 진단 옆에도 표시가 없다. 진단을 일부러 열어야만 안다. 문서대로("한 번이라도 꺼낸 뒤 30일")이긴 하지만, 아직 bat을 안 써 본 주인은 상기를 받지 못한다 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/11-never-menu.png | 헤맴 |
| 주인 | 2 | 작업 스케줄러: 몇 시에 걸면 좋은지(11시 반만 피하라고 함)와, 매주 잘 돌았는지 어디서 보는지가 따로 안 적혀 있다(진단 "밖에 꺼낸 것"이 그 자리라는 건 3단계에 있음) | (문서) DEPLOY.md 10-0 | 거슬림 |

## 좋았던 것
| 사람 | 과업 | 내용 | 스크린샷 | 심각도 |
| --- | --- | --- | --- | --- |
| 주인 | 1 | ⋯ → 진단 → "평가금액 기록 · 백업" 칸을 PC·아이폰 390·360 다크·확대 150% 어디서나 바로 찾았다. 줄이 넘치지 않고 겹치지 않는다. "밖에 꺼낸 것: 마지막 10월 18일 08:01 (관리자 PC)"는 한 번에 뜻이 통한다 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/04-owner-pc-diag-view.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/05-owner-ip390-light-diag.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/08-owner-360-dark-diag.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/07-owner-zoom150-diag.png | - |
| 주인 | 1 | 41일 경고 "41일 동안 밖에 꺼내지 않았습니다 — PC 에서 server-backup-pull.bat 을 실행하세요."는 주황으로 눈에 띄고, 무엇을 할지까지 말한다. 진단 메뉴의 "!"도 이때만 뜬다 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/19-stale41d-owner-390-diag.png | - |
| 주인 | 1 | 한 번도 안 꺼냈을 때 "서버가 사라지면 이 백업도 같이 사라집니다"라는 말이 왜 해야 하는지를 바로 알려 준다 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/11-never-diag.png | - |
| 주인 | 2 | bat 맨 위 설명이 backup.bat(이 PC 앱)과 server-backup-pull.bat(서버)의 차이를 첫 줄에서 가른다. 처음 실행하면 설정 파일을 만들어 메모장으로 열어 주고, 끝나면 받은 파일 경로와 "최근 4벌만 남깁니다"를 말한다. 무엇이 남는지(PC 폴더, 4벌)가 분명하다 | (문서) server-backup-pull.bat | - |
| 지인·처음 온 사람·승인 대기·손님 | 4 | 지인 PC·360, 처음 온 사람 390 다크, 승인 대기 390, 손님 PC·390 어디에도 진단 메뉴나 백업·꺼낸 이야기가 없다. 41일 경고 상태에서도 이들의 ⋯ 단추에는 점이나 숫자가 없다(이름표도 "메뉴"뿐) | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/12-friend-360-menu.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/13-friend-pc-home.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/14-new-390-menu.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/15-pending-390-menu.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/16-guest-pc-home.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/17-guest-390-menu.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/20-stale41d-friend-360-menu.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/21-stale41d-pending-390-menu.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/22-stale41d-guest-390-menu.png | - |
| 주인 | 회귀 1 | 시그널 → NVDA → 차트 팝업에서 매수 4/4와 시그널 날을 확인함(390) | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/30-R1-390-signal.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/31-R1-390-popup.png | - |
| 주인 | 회귀 2 | 리밸런싱 → "이번에 새로 넣을 돈" 1,000,000 → "새로 넣을 돈 ₩1,000,000 반영" 주문 가이드가 나옴(390) | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/34-R2-390-newmoney.png | - |
| 주인 | 회귀 3 | 보유 종목 ✎ 수정 → 삼성전자 1,501, KODEX 200 901 → "2종목 저장" → 바로 반영(PC) | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/35-R3-pc-edit.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/36-R3-pc-edited.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/37-R3-pc-saved.png | - |
| 주인 | 회귀 4 | 금액 가리기 → 금액은 •••••, +13.7% · +0.49% 같은 %는 그대로 보임(PC) | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/38-R4-pc-hidden.png | - |
| 주인 | 회귀 5 | 폰 뒤로가기로 차트 팝업이 닫히고 대시보드에 그대로 있다(390). 확대 150%에서 진단 팝업도 뒤로가기로 닫힌다 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/32-R5-390-afterback.png | - |
| 주인 | 조건 | 확대 150% 다크에서 상승 색을 빨강으로 바꾸면 평가손익이 빨강으로 바뀐다. 아주 긴 종목명(TIGER 미국필라델피아반도체나스닥)과 억 단위 금액(₩483,948,604)이 겹치지 않는다. 진단 칸도 깨지지 않는다 | /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/40-zoom-dark-redup-home.png , /tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/A-user-shots/41-zoom-dark-redup-diag.png | - |

## 서버
8171 가짜 서버는 PID 파일 A-user.pid 로 kill 해서 껐다. 껐는지 확인함: 프로세스가 없고, curl 이 연결하지 못함. 첫 서버(A-user-data)는 작업자가 다시 시작될 때 이미 사라져 있었다.
