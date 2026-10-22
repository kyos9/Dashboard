# 0.45.2 B (진단·백업이 눈에 띄게) — 검토 판정

## 조건부 합격

조건(1개):
1. **뮤테이션 1개가 살아남음**: `frontend/src/lib/diagTime.ts` 의 오프셋 분(`Number(digits.slice(2))` → `0`)을 버려도 시험이 모두 통과한다.
   지금 코드는 맞다(`+05:30` → 330분, 직접 확인). 시험만 빈다. `diagTime.test.ts` 에 분이 있는 오프셋(예: `+05:30` 또는 `+09:30`) 한 줄을 더하고 이 뮤테이션이 잡히는지 볼 것.

참고(조건 아님):
- 진단 창을 열어도 초점이 창 안으로 옮겨지지 않고, Esc 로 닫으면 초점이 `BODY` 로 간다. 1400 에서 Tab 을 6번 누르면 뒤 화면의 탭 링크로 간다(창 안 칩은 7번째부터). 열기·초점 코드는 B 가 고치지 않았다(`git diff d5bc80d 8cbcf83 -- DiagnosticsModal.tsx` 에 초점 부분 없음). 원래 있던 문제라 후보로 남긴다.
- 첫 vitest 전체 실행에서 `src/test/backToClose.modals.test.tsx > 화면 설정 팝업은 뒤로가기로 닫힌다` 가 1번 실패했다(그때 pytest 를 같이 돌려 무거웠다). 그 파일만 3번 → 8/8 통과, 전체를 다시 돌림 → 999/999. B 와 관계없는 흔들리는 시험이다.
- 진단의 "평가금액 기록: 마지막 2026-10-23" 은 날짜 꼴로 남아 있다(plan-user 가 넷째 꼴로 짚었으나 계획 B5 범위 밖).

검토한 것: worktree `8cbcf83`(시작 `d5bc80d`), 커밋 d5cde18·a19d422. 가짜 서버 8181 `--demo-backup-warning`, PID 로 껐다.

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 완료 조건 B1 | 통과 | Playwright(빌드한 화면) 6벌 모두: `.diag-summary .diag-warn` = "백업 확인 필요 — 아래 백업 칸", weight 700, 앞 글은 400·회색. 대비 다크 `rgb(240,180,41)`/`rgb(19,27,38)` **9.29**, 라이트 `rgb(166,77,9)`/흰색 **5.70** (≥4.5) |
| B2 | 통과 | `DiagnosticsModal.tsx:210` 문구만 "…PC 의 Dashboard 폴더 DEPLOY.md 10-0." · 노랑 아님(`role=note` 없음 시험 `DiagnosticsModal.test.tsx:422-428`) |
| B3 | 통과 | `backup.py:341` `OFFSITE_STALE_DAYS = 10`, `backupWarnings.ts:6` `= 10`. 서버 9일 경고 없음·11일 경고(`test_backup.py:478-479`), 화면 10.5일 경계(`DiagnosticsModal.test.tsx:437-444`), 같은 값 시험 `test_offsite_threshold_matches_the_screen`(두 상수). 내 뮤테이션 R3(화면 36→48시간)도 이 시험이 잡음 |
| B4 | 통과 | 시험 `AppHeader.phone.test.tsx:123`(점만)·`:133`(숫자+점, `.menu-dot-aside`)·`:140`(숫자만)·`:147`(없음). 화면 6벌: 배지 x=1359/363/333, 점 x=1331/331/301 — 겹치지 않음, 읽기 이름 "메뉴 — 가입 신청 1건 — 백업을 확인하세요". 스크린샷 `scratchpad/r047/rvBpw/shots/menu-*.png` |
| B5 서버 | 통과 | TZ 바꿔 직접 직렬화: UTC 로그 `at` "2026-10-22T00:30:15+00:00", 느린 요청 `since`/`last_at` "…34.751752**Z**"(pydantic 이 Z 로 냄) · Asia/Seoul "+09:00" · America/New_York 10월 "-04:00", 3월 "-05:00"(줄마다 그날 규칙). 시험 `test_logs.py` UTC·Seoul·Berlin 겨울/여름, `test_slow_requests.py::test_times_carry_the_server_zone` |
| B5 화면 | 통과 | `parseInstant` 를 node 로 직접: `…751752Z`·`+09:00`·`-04:00` 마이크로초 꼴 모두 같은 순간; 시간대 없는 값은 `naive` 없으면 null(느린 요청은 옛 숫자 "09-28 10:12" 그대로 — `DiagnosticsModal.tsx:79-85`, 시험 `:149,152`), 다시 계산만 `'utc'`(`:148`). 공백 꼴 "2026-10-22 00:30:15" 도 읽음(사파리). 브라우저 timezoneId Asia/Seoul + UTC 서버: 다시 계산·백업·느린 요청·로그가 모두 "10월 23일 00:19" 로 맞음. vitest 를 TZ=Asia/Seoul·America/New_York 로 돌려도 56/56·39/39 |
| B5 옛 화면↔새 서버 | 통과 | 시작 커밋의 `shortTime` 정규식 `^\d{4}-(\d{2}-\d{2})T(\d{2}:\d{2})` 에 새 값: "…T15:14:34.751752Z" → "10-22 15:14", "…T00:14:35+09:00" → "10-23 00:14" — 서버 현지 숫자로 지금과 같다. 로그 `time` 은 그대로("2026-10-22 00:30:15") |
| B5 새 화면↔옛 서버 | 통과 | `at` 없는 로그 → 글자 그대로(`DiagnosticsModal.test.tsx:453-470`), 시간대 없는 느린 요청 → "09-28 09:00"(`:149`), `types.ts` `at?: string \| null` |
| B6 | 통과 | 진단 화면 글(1400 다크)에 "벌" 0 — "1개 보관(최대 7개)". 코드 남은 "벌"은 주석뿐 |
| 계획 때 걱정 | 통과 | plan.md B1·B2·B3·B5 "반영"과 다시 보기 B5(시간대 없는 느린 요청=숫자 그대로, UTC 는 다시 계산만, 정규식 마이크로초·Z) 모두 코드에 있음(위 증거). 막음 0 |
| 회귀 | 통과 | pytest **1492 passed, 3 skipped**(시작 1487) · vitest **999 passed**(두 번째 전체 실행; 첫 실행은 흔들리는 시험 1개 — 위 참고) · lint 경고 **22**(시작 22) · build 성공. 응답 사진 `snapdiff baseline/snap rvBout/snap` → "같음 / 차이 0" |
| 격리 | 해당 없음 | 새 엔드포인트 없음(apidiff 경로 더함 0) |
| 마이그레이션 | 해당 없음 | 리비전 바뀜 없음 |
| 호환 | 통과 | `apidiff baseline/openapi.json rvBout/openapi.json` → "빠짐 0 / 타입 바뀜 0 / 더해짐 1 ['LogEntry.at']". `since`·`last_at` 은 타입(date-time) 그대로, 값에 시간대만 붙음 — 옛 화면 확인은 위 |
| 입력 한도 | 해당 없음 | 새로 받는 값 없음(`at` 은 응답만) |
| 뮤테이션 | **실패(1)** | 실행자 `mutation.md` B 11줄 모두 잡힘. 직접 4줄(`scratchpad/r047/rvBmuts.json`, `MUT_REPO`=내 worktree): R1 오프셋 분 버림 **살아남음** · R2 마이크로초 못 읽음 잡힘 · R3 화면 백업 시간 서버와 갈림 잡힘 · R4 로그 at 늘 UTC 잡힘 |
| 비밀 | 통과 | 새 필드 `at` 은 줄의 `time` 글자에서만 만든다(`logs.py:51-59`) — 메시지·키를 읽지 않는다. 느린 요청은 시각 꼴만 바뀜. 관리자 전용 엔드포인트 그대로 |
| 규제 | 통과 | 바뀐 화면·서버 글에 "추천·사세요·팔라·저평가·예측" 0건(`git diff … \| grep -cE` → 0) |
| 데이터 경계 | 해당 없음 | 새 표·칸 없음 |
| 외부 호출 | 해당 없음 | 없음 |
| 화면 | 통과 | 빌드한 화면 1400·390·360 × 다크·라이트: 가로 넘침 0, 콘솔 오류 0, 꼬리 대비 위와 같음, ⋯ 숫자+점 같이. Tab 은 고리가 보임(outline auto/solid). 초점이 창 안으로 안 가는 것은 원래 있던 일(참고). 스크린샷 `scratchpad/r047/rvBpw/shots/` |
| 말 | 통과 | 용어집에 "백업 확인 필요 — 아래 백업 칸"·"○개 보관(최대 7개)" 더함, README·DEPLOY 30일→10일, 시험 문구가 같음 |
| 성능 | 통과 | 로그 줄마다 `strptime().astimezone()` 하나 — 무시할 만함. 응답 사진 같음 |
| 가짜 서버 | 통과 | `--demo-backup-warning`(40일) 으로 꼬리·경고 줄·⋯ 점 모두 보임. `test_devtools.py` 는 전체 pytest 안에서 통과 |
| 문서 | 통과 | `DEPLOY.md` 10일(전에는 30일), `README.md` "진단 다듬기 (v0.45.2)", glossary 두 줄 |

## 내 worktree 의 git status (끝날 때)

```
$ git -C .../scratchpad/r047/rvB status
Not currently on any branch.
nothing to commit, working tree clean
```
