# 0.46.0 데이터 안전 — 개발 뒤 검토 (A·B·C·D 묶음, 라운드 전체 회귀·호환)

# 판정: 조건부 합격

대상: `claude/new-session-fftcg1` HEAD **d74d5c5**(worktree 에서 detached 로 봄). 라운드 변경은 `git diff origin/main...HEAD`(57 파일).
환경: fastapi 0.162.0·SQLAlchemy 2.1.6(requirements 그대로, 스크래치 venv `r050/rv/venv` — 시스템 파이썬은 0.120.4 라 따로 깔았다).
로컬 Postgres 는 띄우지 못했다(이 에이전트에서는 `su`·`runuser` 가 막힘) → Postgres 쪽은 **CI 기록**으로 확인(d74d5c5 의 run 41379244704).

## 조건 (합격으로 바꾸려면)

1. **계획에서 "반영"이라 한 것 하나가 빠졌다** — `plan.md:75` "새 화면 `KIND_TEXT[kind] ?? 기본 풀이`"(plan-dev.md:50 의 개발자 걱정).
   코드는 그대로다: `frontend/src/components/PushModal.tsx:228-229` `KIND_TEXT[kind].label` / `.hint`, `lib/pushText.ts:5`.
   이번 라운드는 (가)를 골라 새 알림 종류를 만들지 않았다. 그래서 지금 당장 넘어지는 것은 없다. 다만 계획이 "다음부터 새 종류가 옛 화면을
   넘어뜨리지 않게" 넣기로 한 방어선이다. 넣거나(작다, 화면 시험 하나), plan.md 의 답을 "반영 안 함 — 이유"로 고친다.
2. **뮤테이션 살아남음 1(실질)** — `services/alerts.py:153` 의 끄는 값 `("off","0","false","no")` 를 `("off",)` 로 줄여도 시험이 다 통과한다.
   문서(.env.example·DEPLOY 9-6)에 적힌 `off` 는 실행자 뮤테이션 "C 스위치 무시"가 잡는다. 하지만 별칭 셋은 시험이 없다.
   시험을 하나 더하거나 별칭을 뺀다. (같은 묶음에서 나머지 살아남은 셋은 동작이 같은 뮤테이션이다 — 아래 "뮤테이션" 칸.)
3. **입력 한도(작음)** — `DELETE /api/admin/users/99999999999999999999999` 가 **500** 이다(SQLite `OverflowError`, 가짜 서버 로그).
   음수→404, 글자→422 는 괜찮다. 기존 `PUT /api/admin/users/{id}/status` 도 같은 500 이라 이번에 생긴 성질은 아니다. 관리자 전용이고 새는 것도 없다.
   규칙("이상한 값에 400")에 맞추려면 path 에 범위(`Path(ge=1, le=2**31-1)` 등)를 걸거나, "기존과 같음 — 다음 후보"로 ROADMAP 0-1 에 적는다.

참고(조건 아님)
- ROADMAP 11-9 "개발 뒤 검토자·사용자 확인은 주인이 멈췄다(판정문 없음)", status.md "다음 할 일" — 이 판정 뒤 고쳐야 할 문장이다.
- DEPLOY.md:489·514·516 의 "서버 안 7벌" — 이제 매일 7 + 직전 최대 3 이다. 뜻은 크게 틀리지 않지만 옛 말이 남았다.
- `frontend/src/types.ts:489` — "진단 — 기록이 살아 있나" 주석이 새 `RefreshStatus` 위로 밀려 `RecordsStatus` 와 떨어졌다.
- `server-backup-pull.bat:76` — powershell 이 없으면(9009) `errorlevel 1` 이 참이 되어 OneDrive 경고가 잘못 붙는다. 윈도에는 늘 있으니 실제로는 일어나지 않는다.
- `refresh_attention`·`backup_attention` 은 구글 모드 관리자에게만 간다(`routers/auth.py:186-201`). 혼자 쓰는 PC 모드에는 ⋯ 점이 없고 진단 칸만 있다(0.45.0 과 같은 선).

---

## §3 표

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 완료 조건 | **통과** | 아래 "완료 조건" 절 — A1~A4·B·C·D 의 조건마다 코드·시험·화면을 확인했다 |
| 계획 때 걱정 | **실패(1건)** | "막음" 1(A3 달력 7일)은 풀렸다: `backup.py:323-350` 벌 수로 세고, 시험 `test_backup_safety.py`(8일 실패 뒤 7개). recheck 의 "고쳐야 함" 둘도 풀렸다: C 따라잡기 묵음은 `refresh_status.py:113-118`·`test_catch_up_with_stale_prices_does_not_clear_and_ring_twice`, A4 경고는 진단으로 `DiagnosticsModal.tsx:222-241`. **빠진 것 1: plan.md:75 KIND_TEXT 기본 풀이(조건 1)** |
| 회귀 | **통과** | pytest(SQLite) **1591 통과·5 건너뜀**(시작 1532·3 — 건너뜀 +2 는 PG 전용 되돌리기 시험, SQLite 에서 정상 건너뜀). vitest **1064**(63 파일). lint 경고 **22**(`npx oxlint` 의 warning 22줄). tsc 0. CI(d74d5c5): SQLite·Postgres·프런트 셋 다 success, Postgres 갈래 `1595 passed, 1 skipped`. **응답 사진**: 10-30 기준과 바로 견주면 717 차이가 나지만 모두 가짜 시세가 날짜에 따라 움직인 것이다(지표 값). 그래서 시작 커밋 65001de 의 backend 를 `git archive` 로 꺼내 **같은 날·같은 venv**로 사진을 다시 떴다 → `snapdiff base65snap now/snap` = **"같음, 차이 0"**(owner·friend × 5 경로, 날짜·시각·새 필드 제외) |
| 격리 | **통과** | `test_isolation.py:139-140` 에 `("DELETE","/api/admin/users/{user_id}"): (SHARED, OWNER)`, 주인 전용 15→16(`:236`), `OWNER_CALLS`(`:1104`) → 사용자 403. 가짜 서버: friend DELETE→403, pending·손님→401. 새 사용자별 표 없음. 관리자 지우기는 user_id 칸이 있는 모든 표를 비우는지 `test_signup_approval.py:280-300`(대기·거절·차단 셋) |
| 마이그레이션 | **해당 없음** | `git diff origin/main...HEAD -- backend/migrations backend/app/models.py` 비어 있음, 머리 0015 그대로 |
| 호환 | **통과** | `apidiff baseline/openapi.json now/openapi.json` → `빠짐 0 · 타입 바뀜 0 · 더해짐 3`(DELETE 경로 1 + `ValidationError.input/ctx` 는 fastapi 0.162 가 더한 것). 응답은 더하기만: health `db`, backup `daily`·`premigrate.keep`·`offsite.warnings`, records `refresh`, status `refresh_attention`, 새로고침 실패 줄 `providers`·`not_found`. `keep` 은 7→10(합친 최대)이다. 옛 화면 문구 "N개 보관(최대 M개)" "(위 개수에 들어 있습니다)"가 참으로 남는다 — 계획대로이고 옛 화면은 `keep` 을 다른 데 쓰지 않는다(origin/main DiagnosticsModal.tsx:185 만). 옛 응답 화면 시험: `DiagnosticsModal.test.tsx:389`(daily·warnings 없음), `:513`, `AppHeader.phone.test.tsx:159`, `UsersModal.test.tsx:245`(옛 서버 404/405 → 한국어). `mark` 는 옛 bat 이 인자 없이 불러도 됨(`backup_pulled.py:22-24`) |
| 입력 한도 | **실패(작음)** | 새 입력: DELETE path id(int), `backup_pulled --warn`(아는 값만 `backup.py:148`·읽을 때도 거름 `:153-157`), env 셋(`_env_int` 빈·글자·작은 값 → 기본값, `backup.py:37-47`). 가짜 서버로 DELETE: 없는 id 404 · 음수 404 · `abc` 422 · **아주 큰 id 500**(조건 3, 기존 PUT 도 500) |
| 뮤테이션 | **실패(실질 1)** | 실행자 표(A 18, B·C·D 24) 확인. 직접 **12줄**(`rv/mut.sh`·`mut2.sh`, 바꾼 뒤 `git checkout` 으로 되돌림). **잡힘 8**: B 손님 갈래 `user_id=None` 빼기(`test_google_mode_with_a_cookie_still_reaches_503`) · B 503→200 · C 점 풀이 둘 다→백업만 · C 진단 요약 시세 꼬리 빼기 · D 지우기 실패 뒤 창 안 닫음 · A3 직전 백업 7일→70일 · D 없는 사용자 404 빼기 · A2 PGCONNECT_TIMEOUT 10→100. **살아남음 4**: ①`alerts.py:153` 끄는 별칭 0/false/no 무시(**실질**, 조건 2) ②`users.py:150` PortfolioValueDaily 를 지우는 목록에서 빼기 — 동작이 같다(`models.py:325` `ondelete="CASCADE"`, 탈퇴 검사가 모든 user_id 표를 보는데도 통과) ③`backup.py:148` 모르는 경고도 저장 — 동작이 같다(읽을 때 `_read_pulled_warnings` 가 거른다) ④`refresh_status.py:85` 시세 0줄을 막힘 아님으로 — 닿지 않는 갈래(실패 0 인데 시세 0줄은 `providers/base.py:72,99` EmptyData 로 실패가 된다) |
| 비밀 | **통과** | `rv/secret_check.py`: `DATABASE_URL` 비밀번호 `SENTINEL-pw-7f3a`, 죽은 포트. health 503 응답, 구글 모드+쿠키 503 응답, pg_dump 실패 갈래, 시간 초과 갈래(잠드는 가짜 pg_dump, TIMEOUT=1), backup-status.json, 시세 오류 글에 키를 넣은 `record_run` 저장값·푸시 글, 루트 로그 전체 → **"합계: 찾음 0 / 9"**. 진단 갈래 글: `'백업이 1초 안에 끝나지 않아 멈췄습니다 — 저장된 기록은 그대로입니다…'` |
| 규제 | **통과** | `git diff origin/main...HEAD -- frontend/src backend/app backend/devtools DEPLOY.md README.md glossary .env.example` 의 더한 줄에서 `추천|사세요|팔라|팔아|저평가|예측|수익률` → 0건. 규제 영향 없음(plan.md 맨 위, 계획 검토 셋 찬성) |
| 데이터 경계 | **통과** | 새 표 없음. 시세 받기 상태는 공용 `app_setting` 의 글자 값 `refresh_status:US|KR|JP`(`refresh_status.py:47-48`)이다. 다시 만들 수 있고 관리자만 읽는다(`admin.py:185-186`, `auth.py:197-201`). 사용자 설정으로 공용 표를 바꾸는 것 없음 |
| 외부 호출 | **통과** | 새 바깥 호출 0. 시세 받기 기록은 기존 스케줄러 결과를 다시 쓴다(`scheduler.py:51,145-147`). 푸시는 관리자에게만, 막힘으로 **바뀐** 때 한 번(`refresh_status.py:134`, `alerts.py:173-180`). 사람 수만큼 늘지 않는다 |
| 화면 | **통과** | `npm run build` 뒤 가짜 서버(8180, `--demo-backup-warning`), `rv/look.js`: 1400·390·360 × light·dark 여섯 판 모두 콘솔 오류 0 · 가로 넘침 0 · 모달 넘침 0. **Tab 으로 "지우기"에 닿고 Enter → 확인 창, 초점이 창 안, Esc 는 확인 창만 닫음**(여섯 판). 메뉴 읽기 이름 "메뉴 — 가입 신청 1건 — 진단을 확인하세요 — 백업 · 시세 받기". 지인·승인 대기 화면에 "진단을 확인하세요·시세 받기·지우기" 없음. 스크린샷 `rv/shots/`. (1400 확인 창 단추 높이 44 미만은 0.45 전부터 — ROADMAP 0-1 에 적혀 있음) |
| 말 | **통과** | 용어집 4줄(`glossary.md` 시세 받기·진단을 확인하세요·매일 백업/업데이트 직전·지우기)과 화면·README·시험 문자열이 같다. 새 화면에 "백업을 확인하세요" 남은 것 0(`grep -rn` 결과 없음). "업그레이드 직전 백업"은 옛 서버 갈래(`DiagnosticsModal.tsx:194`)에만 남는다 — 일부러 그런 것. 옛 말 "7벌"이 DEPLOY 세 줄에 남음(참고) |
| 성능 | **통과** | 같은 기계·같은 venv: 지금 중앙 **38.9 / 39.3 ms**, 시작 커밋 65001de **42.2 ms**, 쿼리 둘 다 **12**(시작 기록 31.9 ms 는 다른 때의 기계라 직접 견주지 않음). 첫 화면 JS gzip **115.23 kB**(+0.76, 진단 시세 칸·지우기 창 — 실행자 보고와 같음). health 는 `SELECT 1` 한 번 더 |
| 가짜 서버 | **통과** | 데모: 일본 막힘 + 이틀 전 성공(`fake_server.py:722-738`), `--demo-backup-warning` 에 OneDrive 경고(`:856-857`). 화면에서 "일본: … 2종목 중 2개 실패 (시세 출처 Stooq·Yahoo) — 마지막으로 받은 때 10월 31일" 확인. `test_devtools.py` 는 전체 실행에서 통과 |
| 문서 | **통과(참고 둘)** | README(v0.46.0 단락·백업 보관 수), DEPLOY(health 503 `:212-213`, 9-6 `:405-415`, 10 멈춘 동안 7일 `:426`, OneDrive `:461-462`, `compose pull db` `:524`, 허용목록 `:669`), 방침 5절 새 문장 `Policy.tsx:151-154` + `POLICY_EFFECTIVE` 2026-10-31, `.env.example` 넷, version 0.46.0, 용어집, ROADMAP 11-9·0-1. 참고: ROADMAP 11-9 의 "판정문 없음" 문장, DEPLOY "7벌" |

## 완료 조건 (plan.md 항목별)

- **A1** — 새 DB 둘, 모든 표 채우기, 앱의 길로 덤프, 컨테이너 psql 로 붓기, 줄 수·md5·시퀀스·init_db: `test_backup_restore_pg.py:1-16,188-255`. 끝 표지를 꼬리 4KB 에서 찾음: `backup.py:59-60,273-287`. CI: `tests.yml:72-97`, run 41379244704 의 로그 `pg_dump (PostgreSQL) 17.11` 그리고 REQUIRE=1 인데 `1595 passed, 1 skipped`(되돌리기 시험은 건너뛰면 실패하므로 돌았다). Dockerfile `ARG PG_MAJOR=17`+판 확인(`Dockerfile:45-50`). Docker 이미지 job success — 그 RUN 층은 캐시였지만 앞서 통과한 층이다. **로컬 PG 로 되돌리기는 못 돌렸다 — CI 에서 확인함**
- **A2** — `timeout=TIMEOUT_SECONDS`, 반쯤 쓴 파일 지움, 갈래 글(쉬운 말+할 일), `PGCONNECT_TIMEOUT=10`, compose 넘기기·안전 파서: `backup.py:191-194,240-266`, `docker-compose.yml:76-82`. 시간 초과는 직접 돌려 봄(비밀 검사 — 진단 글, .sql 남지 않음)
- **A3** — 매일 7 / 직전 3·7일 / 모르는 꼬리표 남김, `keep`=10·`daily`·`premigrate.keep`: `backup.py:323-350,425-435`. 화면 "매일 백업 1개 보관(최대 7개)"
- **A4** — icacls·OneDrive 경고만, `--warn` 넘기기, 진단 경고 줄: `server-backup-pull.bat:66-80,102`, `backup-export.sh:61-64`, 화면에서 OneDrive 줄 확인. (윈도에서 직접 돌려 보지는 못함 — bat 은 읽기만)
- **B** — get_db·`SET LOCAL statement_timeout`·`connect_timeout 5`·503 본문·health 에서만 손님: `main.py:100-132`, `db.py:69-72`, `auth.py:437-447`. 직접: 죽은 PG 로 503 `{"status":"error","db":"down","locked":false}`, 구글+쿠키도 503
- **C** — 시장별 키, 0 실행 안 적음, 오타 제외, 절반·3거래일, 모든 실행에 묵음, 바뀐 날 한 번 푸시, `.env` off, ⋯ 점·진단 줄·요약: `refresh_status.py`, `scheduler.py:51-70,145-147`, `alerts.py:141-180`, 시험 `test_refresh_status.py` 20개
- **D** — 204/409/403/404, 같은 함수, 확인 창(이름·이메일·종목 수·차이·되돌릴 수 없음·허용목록), 방침, 목록 위 풀이: `admin.py:103-130`, `users.py:133-154`, `UsersModal.tsx:85-101,209-258`. 가짜 서버: 대기 지우기 204 → 다시 404 → 대기 숫자 0 → 같은 계정으로 다시 들어오면 `status: pending`

## git status (끝)

검토는 detached d74d5c5 에서 했다. 끝난 뒤 worktree 를 원래 가지(worktree-agent-aa6b7aec0bed09b02)로 되돌렸다. 뮤테이션 12줄은 모두 `git checkout -- <파일>` 으로 되돌렸다(mut.sh·mut2.sh 끝의 `git status --short` 출력 빈 줄). 가짜 서버(PID 10152)는 PID 파일로만 껐다.
frontend/node_modules·dist·__pycache__ 는 .gitignore 대상이다.

```
$ git status
On branch worktree-agent-aa6b7aec0bed09b02
nothing to commit, working tree clean
```
