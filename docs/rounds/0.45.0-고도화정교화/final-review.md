# 0.45.0 라운드 끝 — 전체 회귀·호환 검토

**판정: 합격**

(조건 없음. 아래 "참고" 셋은 다음 라운드 후보로 남길 것을 권함 — 막거나 고쳐야 하는 것은 아니다.)

- 대상: `origin/claude/new-session-fftcg1` 머리 `2420969` (worktree `/home/user/Dashboard/.claude/worktrees/agent-ae77786a005923a36`, detached)
- 비교 기준: 시작 커밋 `812eb5e`, 시작 때 떠 둔 기준 `scratchpad/r045/baseline/`
- 이번 검토의 출력: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/final/`
- 라운드 diff: `git diff --stat 812eb5e..HEAD` → 99 files, +4337 −190

## 1. 전체 테스트 수 · lint · 빌드

| 검사 | 명령 | 시작 | 지금 | 판정 |
| --- | --- | --- | --- | --- |
| 백엔드 pytest (SQLite) | `cd backend && python -m pytest -q -p no:cacheprovider` | 1425 passed, 3 skipped | **1483 passed, 3 skipped** (170 s) | 통과 — +58, 줄어든 것 0 |
| 프런트 vitest | `npx vitest run --maxWorkers=2` | 58 파일 · 912 | **61 파일 · 944 passed** | 통과 — +32 |
| lint 경고 | `npm run lint` · `grep -c 'warning '` | 22 | **22** | 통과 |
| tsc + 빌드 | `npm run build` (`tsc -b && vite build`) | 통과 | rc=0 | 통과 |
| 첫 화면 JS gzip | 빌드 출력 `index-*.js` | 111.19 kB | **111.71 kB** (+0.52 kB, 358.92→361.01 kB) | 통과 — 스크롤 잠금·메뉴 점·없는 주소 화면·NoStocksYet 몫. 새 팝업 코드(PushModal·ChartModal 등)는 따로 쪼개진 덩어리 |
| Postgres (총괄 실행) | `r045/pytest-pg.txt` | — | 1485 passed, 1 skipped | 확인함(SQLite 1483+3 과 합이 같다) |
| Postgres (이번에 다시) | `PYTHONPATH=…/r044/revA/pylib TEST_DATABASE_URL=postgresql+psycopg://postgres@127.0.0.1:55441/postgres python -m pytest -q tests/test_migration_0015.py tests/test_migration_0014.py tests/test_isolation.py tests/test_push.py tests/test_downgrade_tool.py` | — | **164 passed** (45.6 s; 같은 묶음 SQLite 18.0 s — 실제로 PG 에서 돌았다) | 통과 |

## 2. 호환

| 검사 | 증거 | 판정 |
| --- | --- | --- |
| API 모양 | `python tools/apidiff.py baseline/openapi.json final/openapi.json` → `빠짐 0` · `타입 바뀜 1` (`KindsIn.kinds`: `array` → `anyOf[array, null]`, required 에서 빠짐 — **요청 쪽이 넓어진 것**) · `더해짐 3` (`DashboardCard.sell_conditions`, `KindsIn.slots`, `KindsIn.muted`). 경로 58 → 58, 새 경로 0. 응답 스키마의 required 변화 없음 | 통과 |
| 서버가 옛 요청을 받나 | 가짜 서버(8189)에서 친구로 `PUT /api/push/settings {"kinds":["buy"]}` → 200, `slots`·`muted` 그대로. `KindsIn` 의 `extra="forbid"`(새로 생김)는 옛 화면이 `kinds` 만 보내므로(`812eb5e:frontend/src/api/client.ts:441-442`) 닿지 않는다. 시험: `tests/test_push.py:901` ("옛 화면은 kinds 만 보낸다") | 통과 |
| 새 화면 ← 옛 응답 | A: `DiagnosticsModal.test.tsx:391` (offsite 칸 없음), `AppHeader.phone.test.tsx:140` (backup_attention 없음) · B: `PushModal.test.tsx:311` (slots·muted 없음 → 두 칸 없음) · C: `ChartModal.test.tsx:96-103` (`sell_conditions` 없음·null·판정 불가 → 줄 없음, 높이 380 유지 `:127-129`) · D: API 변화 없음 | 통과 — 항목마다 있다 |
| 새 화면 → 옛 서버 | 옛 서버(0.44)의 `KindsIn` 은 `kinds` 필수 — 새 화면이 `{slots}` 만 보내면 422 가 되지만, 화면은 서버가 `slots` 를 안 보내면 그 칸을 숨긴다(`PushModal.test.tsx:311`) | 통과 |
| 이름 | 설정·쿠키·저장 키 이름 바뀐 것 없음(`git diff 812eb5e..HEAD` 에서 `.env` 이름·localStorage 키 변경 0) | 통과 |

## 3. 회귀 — 응답 사진 (같은 날 다시 찍기)

- `git archive 812eb5e backend | tar -x -C r045/final/base812` 로 시작 코드를 꺼내, 같은 도구로 오늘 둘 다 찍었다:
  - 시작: `cd r045/final/base812/backend && PYTHONPATH=. python tools/snapshot.py r045/final/snap-base 8187` → ok
  - 머리: `cd <worktree>/backend && PYTHONPATH=. python tools/snapshot.py r045/final/snap-head 8188` → ok
- `python tools/snapdiff.py snap-base snap-head` → **`같음` · `차이 0`** (주인·친구 × `/api/dashboard`, `/api/rebalance/current`, `/api/fundamentals`, `/api/macro`, `/api/history/NVDA`).
- 날짜를 빼지 않은 바이트 비교로도 확인: 다른 줄은 `last_checked_at`·`last_ok_at`·`checked_at`·`updated_at`(시각)과 대시보드의 새 칸 `sell_conditions` 의 안쪽(`above_ma50`·`adx_rising`·`volume_strong`)뿐. `history_NVDA` 두 파일은 바이트까지 같다(친구는 404 "stock not found" — 시작과 같다).
- 참고로 어제 사진(`baseline/snap`)과 오늘 시작 코드 사진의 차이는 970 — 가짜 시세가 날짜에 매인다는 것을 다시 확인. 그래서 오늘끼리 비교한 위 결과를 쓴다.
- **데모 데이터 변화**(주인 `push_prefs = {"slots":["afternoon"],"muted":["SCHD"]}`, `mark_pulled(사흘 전)`, `fake_server.py:705-718`)는 다섯 경로 어디에도 닿지 않는다 — 위 차이 0 이 그 증거. 닿는 곳은 `/api/push/settings`·`/api/admin/records`·`/api/auth/status` 뿐이고 `test_devtools.py:241-246` 이 본다.

판정: **통과** — 달라진 값 0.

## 4. AI

- `PYTHONPATH=. python tools/ai_consts.py final/ai_consts.json` 뒤 키별 비교: 키 집합 같음, 다른 값은 `__file__`·`__cached__` 경로(worktree 경로 차이)뿐 — **지시문 상수 변화 0**.
- `git diff 812eb5e..HEAD --name-only` 에 `ai_analysis.py`·`ai_portfolio.py`·`routers/ai*` 없음. 화면 쪽 AI 파일 변경은 `AiKeyModal.tsx`·`AiSummaryModal.tsx` 의 스크롤 잠금 교체(`lockBodyScroll`)뿐. `sell_conditions`·`push_prefs` 는 AI 로 가는 길에 쓰이지 않는다(`grep -rn sell_conditions backend/app frontend/src` — dashboard·signals·BuyConditions·signalRules 만).

판정: **통과**

## 5. 성능

`cd backend && python tools/perf_dashboard.py` 를 번갈아 다섯 번씩(같은 기계·같은 때, 다른 일 없이):

| | 가운데 값들 (ms) | 가운데 | 쿼리 |
| --- | --- | --- | --- |
| 시작 `812eb5e` (오늘) | 48.5 · 44.6 · 49.3 · 41.2 · 40.9 | **44.6** | 12 |
| 머리 `2420969` | 54.7 · 48.9 · 50.9 · 47.7 · 48.8 | **48.9** | 12 |
| 기준 파일(어제) | — | 50.4 | 12 |

쿼리 수 그대로(12). 응답 시간은 같은 날 비교로 약 +4 ms(~10 %) — 대시보드가 매도 조건을 같은 묶음 평가로 한 번 더 돌리는 몫(`routers/dashboard.py:50-59`, `signals.sell_conditions_many`). 어제 기준값(50.4)보다는 낮다. 이유가 있고 작다 → **통과**.

## 6. 격리 · 입력 한도 · 비밀 · 규제 · 데이터 경계

| 검사 | 증거 | 판정 |
| --- | --- | --- |
| 새 경로 | openapi 경로 58 → 58, 새 경로 0. 바뀐 경로는 `GET/PUT /api/push/settings`(사용자 자신), `/api/admin/records`(주인 전용, 그대로), `/api/auth/status`(관리자에게만 `backup_attention`) | 통과 |
| push 의 남의 종목 | 가짜 서버: 친구가 자기 목록에 없는 `NVDA` 를 끄기 → 400 `내 목록에 없는 종목입니다.` (없는 티커와 같은 답이라 남이 담았는지 새지 않는다). 친구가 가진 `SCHD` → 200. GET 은 내 목록 밖 티커를 숨긴다(`push.py:73`). 격리 표 `test_isolation.py:826-829` (B 가 A 의 VOO 끄기 400, A 의 `push_prefs` 그대로) — SQLite·PG 둘 다 통과 | 통과 |
| `backup_attention`·offsite 노출 | 손님: `/api/auth/status` 에 없음, `/api/push/settings` 401, `/api/admin/records` 401 · 친구·처음 온 사람: status 에 없음, records 403 · 승인 대기: 401 · 주인: `backup_attention: false`, records 에 `offsite.last_at` 만(파일 이름·경로 없음) | 통과 |
| 탈퇴 | `push_prefs` 는 기존 `user_settings`(user_id 열) 안의 칸 — `test_isolation.py` 탈퇴 검사가 그 표를 지운다(전체 통과) | 통과 |
| 입력 한도 | 가짜 서버: `slots:["night"]` 400 · `slots:[]` 400 · `muted:["A"*5000]` 400 · `muted` 201개 422 · 모르는 칸 `quiet` 422 · 남의 종목 400 | 통과 (참고 ② 하나) |
| 비밀 (SENTINEL) | ① `scratchpad/r045/final/scripts/sentinel.py`: `RuntimeError("…postgresql://u:SENTINEL-pw@db/signal")` 을 실패로 적고 `mark_pulled` → 상태 파일(`backup-status.json`)·`status()`·로그에서 **SENTINEL 0건**(사유는 갈래 이름 "pg_dump 가 실패했습니다"만). ② 시험 `test_downgrade_tool.py:27,38` (내리기 실패 문구에 SENTINEL·경로·Traceback 없음) 통과. ③ 가짜 서버 로그 `final/fake.log` SENTINEL 0, traceback 0. ④ `deploy/backup-export.sh`·`server-backup-pull.bat` 은 비밀을 출력하지 않는다(키는 경로만, 설정 파일 `backup-pull.local.txt` 는 `.gitignore:41-42`) | 통과 |
| 규제 문자열 | `git diff 812eb5e..HEAD -- frontend/src backend/app backend/devtools server-backup-pull.bat deploy README.md DEPLOY.md docs/design/glossary.md \| grep '^+' \| grep -E '추천\|사세요\|팔라\|팔아\|저평가\|예측\|수익률\|매수하세요\|매도하세요'` → 5줄, 모두 "팔라로 읽히는 색을 쓰지 않는다" 류의 설명·시험(`BuyConditions.tsx` 주석, README·용어집 풀이, 시험의 `not.toMatch(/팔\|매도하세요…/)`). 화면에 나가는 말 0건 | 통과 |
| 매도 조건 문구·색 | `BuyConditions.tsx` `SellConditions` — 칩은 `className="cond"`(충족 `met` 초록 없음), 문구 "매도 조건 (참고) n/3" + 서버 규칙의 조건 이름만, 명령형 없음. 켜진 날만(`showsSellConditions`). C 의 뮤테이션 "충족에 초록"·"(참고) 빼기" 잡힘 | 통과 |
| 데이터 경계 | 새 칸 `user_settings.push_prefs` — 사용자별, 다시 만들 수 있음(설정), NULL = 지금과 같음. 공용 표(`signal_daily`·`indicator_daily`) 변경 없음. `sell_conditions` 는 읽을 때 계산, 저장 안 함 | 통과 |
| 외부 호출 | 사람 수만큼 느는 바깥 호출 없음(알림은 오히려 받지 않는 때 건너뜀) | 통과 |
| 마이그레이션 | SQLite: `test_migration_0015.py` 통과(전체 묶음) · PG: 위 164 passed + 총괄 `pgmig/out.txt`(0013→0015→0014→0013→0015, 행·값 보존, 0015 내리기는 백업 조건 없음) · DEPLOY 9-4 에 "되돌릴 때 내리지 않는다" | 통과 |

## 7. 화면 (빌드한 화면, 가짜 서버 8189)

`npm run build` 뒤 Playwright(`scratchpad/r045/pw/final.js`, `/opt/pw-browsers`) — 주인·친구·처음 온 사람·손님 × 1400 · 390 · 360 × 라이트·다크 = 24장: **가로 넘침 0, 콘솔 오류 0** (`final/shots/`). 주인 화면의 ⋯ 숫자 배지(가입 신청 1)는 그대로, 백업 점은 데모대로 없음. 각 항목 사용자 확인·검토가 팝업 안쪽을 이미 봤으므로 여기서는 첫 화면만 봤다.

## 8. 문서

| 문서 | 확인 | 판정 |
| --- | --- | --- |
| README "화면 구성" | 0.45.0 줄 넷(서버 밖 백업 · 알림 받을 때·종목별 · 차트 매도 조건 · 작은 고치기) + PWA 표의 "저장 안 한 일괄 수정" 줄. 0.44 줄의 "○일째" → "○일치" 풀이, 백업 줄의 "아직 손으로" → `server-backup-pull.bat` 로 고침. 코드와 맞음(아침 7:30·오후 4시 = `alerts.py:50-52`, 4벌 = bat `Select-Object -Skip 4`, 30일 = `backup.OFFSITE_STALE_DAYS`) | 통과 |
| DEPLOY 9-4 · 10-0 · 10-1 | 9-4(0015, 내리지 않음, 새 `.env` 없음) · 10-0(bat 처음 설정·키 파일 찾기·known_hosts·작업 스케줄러·손 명령이 `backup-export.sh export/clean/mark` 와 같음) · 10-0-1 · 10-1(`~/restore` 로 서버 7벌 또는 PC 사본) | 통과 |
| 방침 | 수집 줄에 "받을 때(아침·오후), 알림을 끈 종목" 더함(`Policy.tsx:54-55`) · 보관(탈퇴) 절에 "관리자 PC 사본도 최근 4벌"(`Policy.tsx:115-116`) · 시행일 `POLICY_EFFECTIVE` 2026-10-16 → 2026-10-20(`lib/policy.ts:11`) · `test_policy_page.py` 통과 | 통과 (참고 ③) |
| 용어집 | 0.45.0 여섯 줄(리뷰 기록/평가금액 기록 · 버리고 닫기/계속 고치기 · 밖에 꺼낸 백업 · 매도 조건 (참고) · 받을 때 · 종목별 알림) | 통과 |
| version.py | `APP_VERSION = "0.45.0"` + 한 줄 설명(`version.py:135-138`) | 통과 |
| ROADMAP 11-4 · 0-1 | 11-4 표(A~D) · 0-1 주인 할 일(bat 설정·배포 뒤 알림 확인) · 다음 후보(클라우드 백업·숫자 칸·사용자 확인에서 나온 것). `docs/process/EVOLVE_RULES.md` 있음 | 통과 |
| 계획 때 막음 | `plan.md:22-23` 막음 둘 — 상태 파일 합쳐 쓰기(`backup.py:84-103`, 잠금·pid 임시 파일)·방침 5절 — 둘 다 코드·방침에 들어가 있다 | 통과 |

## 9. 뮤테이션 — 직접 넷 (항목 검토가 안 본 곳)

`MUT_REPO=<worktree> python tools/mutate.py final/scripts/muts.json final/mutation.md` (뒤의 하나는 `muts1.json` 으로 다시 — 처음 명령에 없는 시험 파일 이름이 섞여 있어 그 결과는 버리고, 고친 명령의 원본 통과(45 passed)를 먼저 확인한 뒤 다시 돌렸다):

| 뮤테이션 | 파일 | 명령 | 결과 |
| --- | --- | --- | --- |
| 종가를 묶음의 **첫** 행에 둠(마지막 행 아님) | `backend/app/services/signals.py:90` | `pytest tests/test_signal_rules.py tests/test_signals.py` | 잡힘 |
| 내리기 실패 원인을 감싼 예외로(`__cause__` 무시) | `backend/app/tools/downgrade.py:32` | `pytest tests/test_downgrade_tool.py` | 잡힘 |
| PC 모드에도 "밖에 꺼낸 것" 칸 | `backend/app/routers/admin.py:150` | `pytest tests/test_signup_approval.py tests/test_backup.py tests/test_isolation.py` | 잡힘 |
| 화면: 옛 서버(칸 없음)에도 메뉴 점 (`=== true` → `!== false`) | `frontend/src/components/AuthGate.tsx:176` | `npx vitest run --maxWorkers=2` | 잡힘 |

살아남은 것 0. 각 항목 뮤테이션 표(A 15 · B 14+동등 1 · C 9 · D 13)도 읽었다 — 살아남은 것은 모두 시험을 더해 다시 잡혔다. 뮤테이션 뒤 `git status` 깨끗(원래대로 돌아감).

## 참고 (다음 라운드 후보로 — 이번 합격을 막지 않음)

1. **`/api/auth/status` 가 관리자에게 `backup.attention()` 을 감싸지 않고 부른다** (`routers/auth.py:199`). 이전에는 백업 상태를 진단(`/api/admin/records`)에서만 읽었는데, 이제 첫 화면이 맨 먼저 부르는 길에 백업 폴더 읽기가 들어왔다. `existing_backups()` 의 `iterdir()`(`services/backup.py:245`)가 OSError 를 내면(백업 폴더 권한이 깨진 날 등 — 컨테이너는 uid 10001 로 돈다, `Dockerfile:65-68`) 전역 예외 처리기가 없어 500, 화면(`AuthGate.tsx:180-184`)은 user 없이 열려 **관리자가 로그인 안 된 것처럼** 보인다. 일어날 일은 드물지만, 점 하나 때문에 첫 화면이 넘어지지 않게 `try/except OSError → True`(또는 False) 로 감싸는 것이 싸다.
2. `PUT /api/push/settings` 의 `muted` 항목 문자열 길이에 한도가 없고, 400 답이 받은 문자열 앞 다섯 개를 그대로 돌려준다(`push.py:113-115`, `"not in my list: {strangers[:5]}"`). 목록은 200개로 막히고 저장은 내 티커만 되므로 DB 는 안전 — 답 크기만 커질 수 있다(5000자 → 400 확인). 다른 400 과 같은 모양이라 지금은 참고.
3. 방침의 "관리자 PC 사본도 최근 4벌만 두고 오래된 것부터 지웁니다"는 bat 을 돌릴 때만 지워진다 — bat 을 그만 돌리면 마지막 4벌이 PC 에 남는다. ROADMAP 0-1 후보에 이미 적혀 있다("bat 을 그만 돌리면 PC 의 마지막 4벌이 남는다").

## 끝

- 띄운 서버: snapshot 도구가 띄운 8187·8188 은 도구가 스스로 끝냈다(`terminate`), 직접 띄운 8189 는 `kill $(cat r045/final/fake.pid)` (PID 22193) → `ps -p` 없음. 세 포트 모두 닫힌 것 확인(`/dev/tcp` 접속 실패). `pkill`·`killall` 쓰지 않음.
- 잠깐 링크한 `frontend/node_modules` 는 지움(주 checkout 의 것은 그대로, 98 항목).
- worktree `git status`:

```
HEAD detached at origin/claude/new-session-fftcg1
nothing to commit, working tree clean
```
