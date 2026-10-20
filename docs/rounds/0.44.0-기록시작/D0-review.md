# 0.44.0 D0 "진단에 백업 상태" — 검토 판정

## 조건부 합격

잘 된 것: 비밀은 새지 않는다(가짜 비밀 0건). 주인만 볼 수 있다(사용자 403, 손님 401). 시각은 보는 사람의 시간대로 나온다. 옛 서버에서도 창이 깨지지 않는다. 회귀 0, API 에서 빠진 것 0, 화면 6벌에 넘침·잘림·콘솔 오류 0.
남은 것: 계획 때 "반영"이라고 답한 걱정 가운데 **두 개가 구현되지 않았다**. 직접 해 본 뮤테이션 **3줄이 모두 살아남았다**. 둘 다 고치기 작다.

### 조건 (끝 전에)
1. **업그레이드 전 백업(`premigrate`)을 정기 백업과 나눠 보인다** — `plan.md:86` 에 "반영 — 정기 백업과 나눠 보인다"고 적혀 있다. 지금은 섞여 있다(`backup.py:201` 은 `existing_backups` 를 그대로 쓴다).
   재현: 정기 백업이 3일 전 것 하나뿐이면 진단에 "하루 넘게 새 백업이 없습니다"가 뜬다. 여기에 방금 만든 `…-premigrate.sql` 하나를 더하면
   "백업: 마지막 10월 19일 09:30 · 5KB · 2벌 보관(최대 7)"로 바뀌고 **경고가 사라진다**
   (`d0rev/dlg-stale.txt:14-16` → `d0rev/dlg-premig.txt:14`). 업그레이드 바로 뒤에 매일 백업이 멈춘 경우를 가린다. 이 라운드가 바로 0014 업그레이드다.
2. **마지막 실패를 어디에 남길지 계획과 맞춘다** — `plan.md:81` 은 "백업 폴더의 작은 상태 파일(`backup-status.json`), 어느 워커든 읽는다"로 반영을 약속했다.
   그런데 구현은 프로세스 메모리(`backup.py:42` `_last_failure`)다. 그래서 다시 켜면 실패 기록이 사라지고, 스케줄러를 맡지 않은 워커가 요청을 받으면 비어 보인다(`leader.py`).
   기본 설정(워커 하나, 켤 때 `run_backup_if_stale`)에서는 그 피해가 작다. 그래도 계획과 다르고 status·커밋 어디에도 그 사실이 없다. 둘 중 하나를 한다.
   - 상태 파일로 바꾼다.
   - "뒤집기"로 적고 주인 확인을 받는다.
3. **살아남은 뮤테이션 3줄을 잡는 테스트** (아래 뮤테이션 칸)
   - 시간대를 UTC 가 아닌 값으로 고정한 테스트 두 개(서버·화면).
   - 멈춤과 실패가 함께인 경우 두 줄이 다 보이는지 확인하는 테스트.

---

| 검사 | 결과 | 증거 |
| --- | --- | --- |
| 완료 조건 | 통과 | 아래 다섯 가지를 확인했다. |
| | | **(1) 응답** — 주인으로 `GET /api/admin/records`(8186):<br>`"backup": {"count": 1, "keep": 7, "last_at": "2026-10-19T00:27:10+00:00", "last_size": 9195520, "last_failure": null}` |
| | | **(2) 화면** — 진단 화면 "평가금액 기록 · 백업" 칸에 "백업: 마지막 10월 19일 09:27 · 8.8MB · 1벌 보관(최대 7)". 파일 이름(`signalboard-`)·백업 경로는 응답과 창 어디에도 없다(probe 출력 `records SENTINEL False False False False`). |
| | | **(3) 기존 함수** — `existing_backups` 를 쓴다(`backup.py:201`). `latest_age` 와 같은 파싱이다. |
| | | **(4) 실패 줄** — "마지막 실패: 10월 19일 09:30 — pg_dump 가 실패했습니다"(`dlg-fail.txt:16`). |
| | | **(5) 36시간 경고** — 3일 묵은 백업이면 "하루 넘게 새 백업이 없습니다 — 서버 로그를 보세요."(`dlg-stale.txt:16`). |
| 계획 때 걱정 | **실패** | `plan-recheck.md` D0 항목을 하나씩 보았다.<br>- 경로 표: 반영. `test_isolation.py:144` `("GET", "/api/admin/records"): (SHARED, OWNER)`.<br>- 고정 분류만 응답에: 반영. `backup.py:45-61`.<br>- 응답에 경로 문자열이 없는지 테스트: 반영. `test_backup.py` `str(tmp_path) not in text`, `"아무도모르는경로" not in`.<br>- **상태 파일: 미반영**(조건 2).<br>- **premigrate 나눠 보이기: 미반영**(조건 1).<br>막음은 0. |
| 회귀 | 통과 | **백엔드** — `pytest -q`: 1406 passed, 3 skipped, **1 failed**. 시작 수치는 1364 passed.<br>실패한 것은 `test_demo_custom_thresholds_shows_my_thresholds`(`assert 4 != 4`)다. **라운드 시작 `4844bf0` 에서도 오늘 똑같이 실패한다.** 날짜에 따라 달라지는 데모 데이터라 D0 와는 상관이 없다. 다만 주인에게 알릴 것.<br>**프런트** — `vitest --maxWorkers=2`: 906 passed. 시작 수치는 884.<br>**lint·tsc** — lint 경고 22, 시작과 같다. `tsc -b` 0.<br>**응답 사진** — 저장된 baseline 은 가짜 시세가 오늘 날짜를 따라 움직여 695건이 달랐다. 그래서 **오늘 `4844bf0` 에서 새로 뜬 사진**과 머리(`1824fc1`)를 `snapdiff` 로 비교했다: "같음 / 차이 0". |
| 격리 | 통과 | 실제 서버에서 `/api/admin/records`: 주인 200, friend 403, newcomer 403, 손님 401. 경로 표는 `test_isolation.py:144`, `:1022`. |
| 마이그레이션 | 해당 없음 | 새 표·칸이 없다. |
| 호환 | 통과 | **API 모양** — `apidiff baseline/openapi.json → D0-openapi.json`: 빠짐 0, 타입 바뀜 0. 더해진 것은 A 의 3개. `backup` 은 dict 응답이라 스키마에 나타나지 않는다.<br>**옛 서버 → 새 화면** — 테스트 `'옛 서버(백업 칸 없음)면 평가금액 줄만'`, 타입 `backup?: BackupStatus`(`types.ts`). `status.backup &&` 을 지우는 뮤테이션은 테스트 4개가 실패해 잡혔다.<br>**새 서버 → 옛 화면** — 옛 화면은 더해진 칸을 무시한다. |
| 입력 한도 | 해당 없음 | 새로 받는 입력이 없다(GET 하나). |
| 뮤테이션 | **실패** | **실행자의 11줄을 내 worktree 에서 다시 돌렸다.**<br>- 오늘은 위의 날짜 실패 때문에 `tests/test_devtools.py` 전체를 명령에 넣으면 모든 백엔드 뮤테이션이 "잡힘"으로 나온다. 그래서 `test_backup.py` 와 `test_demo_has_daily_value_records` 로 좁혀 돌렸다. 10/10 잡혔다.<br>- "옛 서버에서 넘어짐"은 `D0-muts.json` 의 `old` 가 지금 코드(`now={now}` 가 더해짐)와 맞지 않아 손으로 돌렸다. 4 failed 로 잡혔다.<br>**직접 3줄 — 모두 살아남았다.**<br>J `backup.py:208` `stamp.astimezone(utc)` → `stamp.replace(tzinfo=utc)`(서버 시각을 UTC 로 잘못 읽음): `test_backup.py` 23 passed. **살아남음.** `TZ=Asia/Seoul` 로 돌리면 1 failed. 테스트 환경이 UTC 라서 못 잡는다. 집 PC(한국 시간)에서는 9시간이 어긋난다.<br>I `DiagnosticsModal.tsx` `when()` 에 `timeZone: 'UTC'` 를 넣음(보는 사람의 시간대를 무시): 24 passed. **살아남음.** `TZ=Asia/Seoul` 이면 1 failed.<br>K `{backup.last_failure && (` → `{backup.last_failure && !stale && (`(멈춤과 실패가 함께이면 실패 사유를 숨김): 24 passed. **살아남음.**<br>모두 `git checkout --` 로 되돌렸다. |
| 비밀 | 통과 | **(a) 실제 pg_dump** — `postgres:SENTINEL-d0-pw-7731@127.0.0.1:55441/d0rev_missing_db` 주소로 가짜 서버를 띄워 시드 백업이 실패하게 했다(`d0rev/fail_server.py`).<br>- 응답: `"last_failure": {"at": "2026-10-19T00:30:08+00:00", "reason": "pg_dump 가 실패했습니다"}`.<br>- 응답·`/api/logs`·진단 창 글(6벌)·서버 출력·데이터 폴더 어디에서도 `grep SENTINEL` 0건.<br>- 서버 출력에는 원문 `pg_dump: error: connection to server at "127.0.0.1", port 55441 failed: Connection refused` 이 있다. 비밀번호는 없다. `PGPASSWORD` 환경변수로 넘기기 때문이다.<br>**(b) 최악의 pg_dump** — `PGPASSWORD`·주소·파일 경로를 stderr 에 그대로 흘리는 가짜 pg_dump 를 PATH 에 넣었다(`d0rev/shim/pg_dump`). 사용자·호스트·DB 이름·비밀번호에 모두 SENTINEL 을 넣었다. 로그에는 원문이 다 찍힌다(주인 전용 로그, 계획대로). 그런데 `status()` 에는 `"reason": "pg_dump 가 실패했습니다"` 뿐이다. SENTINEL 0.<br>**(c) 다른 갈래** — SQLite 파일이 없는 경우(경로에 SENTINEL)는 "DB 파일을 찾지 못했습니다", 폴더를 만들 수 없는 경우는 "파일을 쓰지 못했습니다". 둘 다 SENTINEL 0.<br>참고: 넘겨받은 55441 Postgres 클러스터는 떠 있지 않았다(`pg_isready` no response, 프로세스 없음). 비밀번호 인증 실패 길은 (b) 로 대신했다. 내가 띄운 클러스터는 없다. |
| 규제 | 통과 | 새 문구는 백업 시각·크기·벌 수·실패 갈래뿐이다. 추천·매수·매도·예측 말이 없다. |
| 데이터 경계 | 해당 없음 | 새 표가 없다. 백업 메타데이터만 주인에게 보인다. |
| 외부 호출 | 통과 | 바깥 호출이 없다. `status()` 는 폴더 목록과 `stat` 하나만 한다. |
| 화면 | 통과 | 빌드 뒤 8186 에서 크롬으로 PC 1400 · 폰 390/360 × 밝음/어두움을 정상·실패 두 상태로 열었다. 넘침 0, 잘림 0, 콘솔 오류 0(`d0rev/shots/*.png`).<br>**시간대** — 백업 시각 00:27 UTC 는 서울 창에서 "10월 19일 09:27", LA 창에서 "10월 18일 17:27" 로 나온다. 서버 쪽도 확인했다: `TZ=Asia/Seoul` 에서 이름이 `…20261019-093000` 이면 `last_at` 이 `2026-10-19T00:30:00+00:00` 이고, `TZ=America/New_York` 이면 `13:30Z` 다.<br>**키보드** — Tab 으로 ⋯ 메뉴, Enter 로 진단이 열리고, Esc 로 닫힌다.<br>**색** — 경고 줄 앰버는 두 테마 모두 읽힌다(`fail-360-dark.png`, `fail-390-light.png`). |
| 성능 | 해당 없음 | 폴더 목록 하나라 비용이 무시할 만하다. 첫 화면 JS 는 gzip 111.19 kB(C 는 111.20). |
| 가짜 서버 | 통과 | 데모가 백업 한 벌을 뜬다(`fake_server.py:705-708`, `revD-data/backups/signalboard-20261019-002710.db`). `test_demo_has_daily_value_records` 가 통과한다. 이 파일의 다른 하나 실패는 위의 날짜 실패다. |
| 문서 | 통과 (참고 1) | DEPLOY 9-3 줄(칸 이름 "평가금액 기록 · 백업"), DEPLOY 10 새 문단(시각·크기·벌 수, 실패 갈래, 파일 이름·경로는 안 보임, 서버 밖으로 꺼냈는지는 모름), README:89, ROADMAP:2420 이 코드와 맞다.<br>참고: 문서와 화면은 "하루 넘게"라고 하지만 기준은 36시간이다(README·DEPLOY·`DiagnosticsModal.tsx` 문구 vs `BACKUP_STALE_HOURS = 36`). ROADMAP 은 36시간으로 맞다. |

### 참고 (조건 아님)
- 가짜 서버에서는 시드 때 난 백업 실패가 로그 파일에 들어가지 않는다. 그래서 진단 머리에 "최근 기록에 경고·오류가 없습니다"가 나오고, 바로 아래에 실패 줄이 함께 보인다. 운영에서는 스케줄러의 `logger.error` 가 로그 파일로 가므로 이 문제는 데모에서만 생긴다.
- `python -m app.services.backup`·`backup.bat` 처럼 손으로 띄운 백업과 업그레이드 전 백업(`snapshot_before_migration`)이 실패해도 `_last_failure` 에 남지 않는다. 조건 2 를 상태 파일로 고치면 함께 다룰 수 있다.
- 실행자 `D0-muts.json` 의 "옛 서버에서 넘어짐" 줄은 `old` 텍스트가 지금 코드와 맞지 않는다. 다시 돌리면 assert 로 멈춘다.

## worktree `git status`
```
HEAD detached at 1824fc1
nothing to commit, working tree clean
```
(쓴 가짜 서버는 모두 PID 로 껐다. 8186 응답 000. 만든 DB 는 없다. 스냅샷 임시 폴더 `/tmp/snap-*` 둘은 지웠다.)
