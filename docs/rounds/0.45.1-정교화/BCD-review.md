# 0.45.1 B·C·D 검토 (검토자)

## 판정: 조건부 합격

이 판정은 1bcb4c0 을 봤다. 범위는 B·C·D 커밋(320ed0c, 0a6b0f6, 22227cb, 86c6985, 502e6f5, 76bdd86)과 1bcb4c0 의 문서 부분이다. 회귀와 호환은 baa6048..1bcb4c0 전체를 봤다.
검사는 내 worktree `scratchpad/revBCD`(detached 1bcb4c0)에서 했다. 순서는 `npm ci` → `npm run build` → 가짜 서버 8181(`--demo-backup-warning`, 데이터 `scratchpad/revBCD-run/data`)이다. 브라우저는 playwright + `/opt/pw-browsers/chromium`. 스크립트와 스크린샷은 `scratchpad/revBCD-run/pw/` 에 있다.

### 조건(고쳐야 함, 셋)

1. **B2: 목록 받기가 실패하면 있는 종목의 차트도 부르지 않는다. 그런데 화면에는 "저장된 시세 없음"이 뜬다.** `/api/stocks` 를 500 으로 막고 `/history?ticker=VOO` 를 열었다. 시세 요청이 0번 나갔다. 화면에는 "⚠ boom" 아래 빈 차트, "매수 0일 (0번) · 매도 0일 (0번)", "저장된 시세 없음"이 보인다.
   baa6048 에서는 두 effect 가 따로 돌아서, 같은 경우에도 오류 줄과 함께 차트가 나왔다.
   원인은 `HistoryChart.tsx:44-46` 이다. `listed` 가 false 인 채로 남아 effect 가 끝까지 부르지 않는다. 그런데 `:114-124` 의 범례와 Coverage 는 그대로 그린다.
   목록을 기다리는 동안(2초 늦춤)에도 같은 말("저장된 시세 없음", "불러오는 중" 없음)이 잠깐 보인다.
   계획의 "목록 받기 실패" 경우는 화면 시험에도 없다.
2. **D2: 비활성 종목만 가진 사람에게 "종목을 담으면 여기서 종목마다 알림을 끌 수 있습니다."가 뜬다.** 이미 담은 사람이라 틀린 말이다. friend 의 목록을 모두 `active:false` 로 바꿔 띄워서 확인했다.
   이 걱정은 plan-review D2("활성 0·숨긴 >0 도 같은 문장이 맞는지 정한다", 고쳐야 함)와 plan-dev D2(참고)가 짚었다. 그런데 plan.md "걱정과 답" 표에 답이 없다.
   원인: `PushModal.tsx:74` 가 활성만 남기고, `:304` 가 `stocks.length === 0` 을 본다.
3. **D3: 붙인 머리(sticky)가 키보드 포커스를 가린다.** 360×740 에서 종목별 알림을 펼치고 끝까지 내린 뒤 Shift+Tab 으로 올라갔다. 포커스를 받은 "이 기기에서 알림 켜기"(top 0.4 · bottom 44.4)가 머리(bottom 68) 밑에 숨는다.
   RULES §3 "화면"은 키보드(Tab) 0건을 요구한다. `.push-modal` 에 `scroll-padding-top` 같은 CSS 한 줄로 풀릴 일이다(`index.css` 의 `.push-modal .modal-head` 규칙 옆).

### 참고(조건 아님)

- **B2 긴 티커**: 300자짜리 티커 주소를 360 폭에서 열면 가로 넘침이 2028px 이다. 문장에 줄바꿈이 없어서다(`HistoryChart.tsx:102-104`). 28자까지는 넘침 0. 손으로 만든 주소에서만 생긴다. plan-review B2 의 참고였고 표에 답이 없다. `<b>` 를 넣어도 글자로만 나온다(XSS 없음).
- **D1 포커스**: "모두 다시 받기"를 Enter 로 누르면 단추가 사라지면서 포커스가 BODY 로 빠진다. plan-dev D1 의 참고("포커스를 summary 로")였고 표에 답이 없다.
- **vitest 흔들림**: 전체를 돌렸을 때 `backToClose.modals.test.tsx > 알림 팝업은 뒤로가기로 닫힌다` 가 1번 실패했다(30ms 대기). 그 파일만 3번 다시 돌리면 3번 모두 8/8 통과한다. 부하에 따른 시간 문제로 보이지만, PushModal 이 이번에 바뀐 곳이라 적어 둔다.
- **이름이 다르다**: plan.md 는 `--backup-warning` 이라고 하고, 구현·README·시험은 `--demo-backup-warning` 이다. 코드와 문서끼리는 맞는다.
- **D4 개수**: 같은 모르는 티커 3개를 보내면 "not in my list: 3" 이다(겹친 것도 센다). 201개일 때의 422 는 여전히 `input` 을 되돌려 준다. 이건 시작 전부터 그랬고 ROADMAP 에 "요청 크기만 남음"으로 적혀 있다.
- **B2 조사**: "‘NOPE’ 은"의 조사(plan-user B2 참고 4)는 그대로다.

## 항목별

| 검사 | 결과 | 증거 |
| --- | --- | --- |
| 완료 조건 B1 | 통과 | 빌드한 화면, 390 터치, 1년 VOO. 천천히 누른 참값은 x1=2026-02-11, x1+20=2026-03-10, x1+60=2026-04-30. **20px 안에서 0.3초 간격으로 두 번째 탭 → 2026-03-10(그 날)**, 28px → 2026-03-19, 세 번 연달아 → 03-10. **60px 빠른 탭 → 바뀌지 않음(02-11 유지).** 이 한계는 README 작은 고치기, ROADMAP 0-1 "30px 넘게…", 11-5 "남는 한계", `PriceChart.tsx:173-175` 주석에 적혀 있다. 콘솔 0 (`pw/b1.js`) |
| 완료 조건 B2 | **조건부**(조건 1) | NOPE·nope → "‘NOPE’ 은 담은 종목에 없습니다 — 위에서 종목을 고르세요.", 캔버스 0, 요청은 `/api/stocks` 만, 404 없음, 콘솔 0. `voo` → `/api/history/voo` 200 이고 차트가 나온다. 비활성 QQQ(응답을 바꿔 확인) → 차트 열림, 칩 없음, 문장 없음. NOPE 에서 칩을 누르면 VOO 로 정상. 목록이 늦으면 NOPE 문장은 목록 뒤에 뜨고 그전에는 부르지 않는다. **목록 받기 실패 → 조건 1** (`pw/b2.js`, `pw/b2b.js`) |
| 완료 조건 C1 | 통과 | `--demo-backup-warning` 으로 띄우면 요약이 "서버 로그: 최근 경고·오류 없음 · 백업 확인 필요"이고 경고 줄은 "40일 동안 밖에 꺼내지 않았습니다…"다. 1400·390·360 × 두 테마 모두 같고 넘침 0. records 응답을 바꿔 경계를 봤다. 29일 → 둘 다 없음. 30일+1분 → 둘 다 있음. 한 번도 안 꺼냄 → 둘 다 없음. last_failure → 둘 다 있음. 37시간 → 둘 다 있음. 35시간 → 둘 다 없음. **모든 경우에 "경고 줄 있음 ⇔ 요약에 붙음"이 성립한다.** 판정은 한 함수 `backupWarnings`(`lib/backupWarnings.ts`)에서 나오고, 요약(`DiagnosticsModal.tsx:282`)과 줄(`:153`)이 같은 `records.at` 을 쓴다 (`pw/c1.js`) |
| 완료 조건 C2 | 통과 | 가짜 docker 로 직접 돌렸다. 앱 꺼짐 → rc 1, stdout 빈칸, stderr 에 "서버 앱이 꺼져 있거나…". 빈 폴더와 폴더 없음 → rc 1, stdout 빈칸, stderr 에 "매일 백업이 아직 없습니다…". 정상 → stdout 이 한 줄 `signalboard-20261020-233000.sql 6` 이고 premigrate 는 고르지 않는다. bat(`server-backup-pull.bat:55-62`)은 stdout 마지막 줄을 "이름 크기"로 읽는데, 실패 갈래에서는 stdout 이 비어 `if "%LINE%"==""` 로 간다. `test_backup_export_script.py` 12 passed |
| 완료 조건 D1 | 통과 | 끈 것이 있을 때만 단추가 보인다(44px). 누르면 PUT `{"muted":[]}` 가 나가고, 서버 muted 는 [], 15/15 체크, 머리 "모두 받음", 단추가 사라진다. **숨긴 종목만 꺼진 경우** → 머리 "모두 받음", 단추 없음(계획대로) (`pw/d.js`) |
| 완료 조건 D2 | **조건부**(조건 2) | new 계정 → 줄이 뜬다. 목록 받기 실패(500) → 줄 없음, 종목별 칸 없음(new·owner 둘 다). 옛 서버(settings 에 muted·slots 없음) → 줄 없음, 칸 없음, 콘솔 0. **비활성만 있는 사람 → 줄이 뜬다(조건 2)** |
| 완료 조건 D3 | 통과(키보드는 조건 3) | 360×740@2, 390×844@2, 933×600@1.5, 1400 × 두 테마 × owner(15종목 펼침)·friend 를 봤다. 끝까지 내려도 ✕ 가 화면 안이고, elementFromPoint 가 "닫기"이고, 눌러서 닫힌다. 16/16 OK, 넘침 0, 콘솔 0 (`pw/d3.js`, 스크린샷 `pw/shots/d3-*`) |
| 완료 조건 D4 | 통과 | 실제 서버에 `SENTINEL-`+5000자와 "TSLA" 를 보냈다 → 400 `{"hint":"내 목록에 없는 종목입니다.","message":"not in my list: 2"}`(67바이트), 받은 글자 없음. `push.py:115`. `test_push.py:913-918`. 요청 스키마는 그대로다(apidiff 바뀜 0) |
| 계획 때 걱정 | **조건부** | 표의 "반영"은 모두 코드에 있다. B1 dblClick 과 30px 문서, B2 null·대문자·비활성 열기·목록 뒤 부르기, C1 `backupWarnings`, 가짜 서버 플래그, C2 `ls … 2>/dev/null \|\| true`·stderr·시험 둘, D1 보이는 끈 수로 띄우고 `[]` 보내기, D2 실패면 null, D3 sticky, D4 개수. 막음 0. **표에 없는 걱정 셋**이 남았다. plan-review D2(고쳐야 함, 조건 2), plan-review B2 긴 티커(참고), plan-dev D1 포커스(참고) |
| 회귀 | 통과 | pytest **1487 passed, 3 skipped**(시작 1484, +3). vitest **964 passed + 1 흔들림**(965개, 시작 944, +21). 흔들린 것은 따로 3번 돌려 모두 통과. lint 경고 **22**(같음). 응답 사진: `snapdiff baseline/snap ↔ revBCD-run/snap` → "같음 / 차이 0" |
| 격리 | 해당 없음 | 새 엔드포인트·표 없음(`git diff --stat baa6048 1bcb4c0 -- backend/alembic backend/app/models* backend/app/routers` → push.py 한 줄뿐) |
| 마이그레이션 | 해당 없음 | 리비전 없음(Alembic 머리 0015 그대로) |
| 호환 | 통과 | `apidiff`: 빠짐 0, 타입 바뀜 0, 더해짐 0. 새 화면에 옛 응답을 넣어 봤다. records 에 backup 없음, backup 에 offsite 없음, records 실패 → 요약에 꼬리 없음, 깨짐 없음. push settings 에 muted·slots 없음 → 깨짐 없음, 콘솔 0. 서버 400 의 `hint` 는 그대로이고 `message` 만 바뀌었다(화면은 hint 를 쓴다) |
| 입력 한도 | 통과 | D4 로 400 답이 줄었다. 201개 → 422(시작 전부터 그대로). 항목 길이 한도는 넣지 않기로 했고 ROADMAP 에 남아 있다 |
| 뮤테이션 | 통과 | 실행자 30/30(`mutation.md`). **직접 6개를 모두 잡았다**(`tools/mutate.py`, `MUT_REPO`=내 worktree, 끝나고 tree clean). R1 `BACKUP_STALE_HOURS` 36→48. R2 "모두 다시 받기" 늘 보임. R3 꺼짐 문장을 stdout 으로. R4 400 에 `strangers[:1]`. R5 로그를 못 받으면 백업 꼬리를 버림. R6 dblClick 을 onMove 로. 결과는 `revBCD-run/mut-result.md` |
| 비밀 | 통과 | `SENTINEL-…` 를 muted 로 보냈다. 응답, `server.log`, `data/logs/app.log`, data 폴더 어디에도 0건(`grep -c` 0, `grep -rl` 빈칸) |
| 규제 | 통과 | 바뀐 `frontend/src`·`backend/app`·`deploy` 의 + 줄에서 추천·사세요·팔라·저평가·예측·수익률 0건. 규제 영향 없음 |
| 데이터 경계 | 해당 없음 | 새 표 없음 |
| 외부 호출 | 통과 | B2 는 없는 티커일 때 시세를 부르지 않아 오히려 준다. 있는 티커는 목록 뒤 한 번(왕복 하나만큼 늦음, 계획에서 받아들임) |
| 화면 | **조건부**(조건 3) | 위 B·C·D 를 360·390·933@1.5·1400 × 두 테마로 봤다. 넘침 0(300자 티커는 참고), 콘솔 0(일부러 낸 500 빼고). 키보드 Shift+Tab 은 조건 3. 덧붙여, 포커스가 팝업 밖(뒤 페이지)으로 나가는 것은 시작 전부터 그랬다 |
| 말 | 통과 | 용어집 `glossary.md` 에 "서버 로그 · 백업 확인 필요", "모두 다시 받기"가 더해졌다. README 작은 고치기와 화면 문장이 글자까지 같다. 시험 `DiagnosticsModal.test.tsx` 는 옛 문장 "최근 기록에 경고·오류가 없습니다"에서 바뀌었다. 계획 플래그 이름이 다른 것은 참고 |
| 성능 | 통과 | 첫 화면 JS gzip 112.23 kB(시작 111.71, +0.5 kB, 주로 A 의 줄). 응답 사진은 같다. 대시보드 경로는 바뀌지 않았다 |
| 가짜 서버 | 통과 | `--demo-backup-warning` 이 있고 화면에서 확인했다. `test_devtools.py` 는 전체 pytest 에 들어 통과 |
| 문서 | 통과 | version 0.45.1, README(작은 고치기와 플래그), ROADMAP 0-1(했던 것은 지우고 B1 한계·muted 크기는 남김)과 11-5, 용어집 |

## 끝 상태

- 가짜 서버(PID 27252)는 `kill $(cat revBCD-run/server.pid)` 로 껐고, 꺼진 것을 확인했다(`ps -p` → 없음).
- worktree `scratchpad/revBCD` 의 `git status`:
  ```
  Not currently on any branch.
  nothing to commit, working tree clean
  ```
  HEAD 1bcb4c074fb25c91954f86dd52edffeca933be22
- 판정문은 저장소 밖(`scratchpad/revBCD-run/BCD-review.md`)에 썼다. 검토자 규칙("저장소 안에 쓰지 않는다")을 따랐다. 총괄이 `docs/rounds/0.45.1-정교화/BCD-review.md` 로 옮긴다.
