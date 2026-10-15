# 0.42.0 라운드 끝 검토 — 2차 (7ead933)

## 판정: 합격

1차의 막는 결함 D1이 풀렸다. 0012 DB에 알림 구독이 있어도 `signal_diff` 는 종료 0으로 끝난다. DB는 바뀌지 않는다.
같은 DB를 0013으로 올린 사본과 답이 같다. 저장된 판정과 새 정의가 서로 다른 경우로 강제해서 돌려도 같다.
새 테스트는 고치기 전 코드에서 실패한다. 고친 두 부분(기준을 기본으로 두는 것, 칸을 읽지 않게 미루는 것)도 하나씩 빼면 각각 실패한다.
백엔드 전체 테스트는 1364 passed, 3 skipped 다.
1차의 참고 R1(DEPLOY 절 번호)도 고쳐졌다.

검토 범위: 3aabeec..7ead933. 바뀐 파일은 `backend/app/tools/signal_diff.py`, `backend/tests/test_signal_recompute.py`,
`backend/app/migrate.py` 와 `0013_signal_thresholds.py`(주석 한 줄씩), 라운드 문서 둘이다. 프론트는 바뀐 것이 없어서 vitest·빌드는 돌리지 않았다.
작업 폴더: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r042/rv2end/`.

## 항목별

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| D1 재현 DB에서 종료 0 | 통과 | 원본 `end/mig/diff.db` 는 sha256 `f344b2c2…4458` 이다. 원본은 `cp` 로 사본만 떴고 그 뒤로 손대지 않았다. 사본 `rv2end/a.db` 는 리비전 0012이고 user_settings 에 `signal_thresholds` 칸이 없다. 구독은 active 사용자 1·2·3에게 있다. 사용자 3은 설정 줄이 없다. `DATABASE_URL=sqlite:///…/a.db python -m app.tools.signal_diff` 는 **exit=0** 이고 `--json` 도 exit=0, stderr 는 비었다 |
| 읽기만 하는지 | 통과 | 실행 전후 `a.db` 의 sha256 이 `f344b2c2…4458` 로 같다(두 번 실행한 뒤와 강제 실행 뒤 모두). 강제 실행(아래)에서 SQL 을 모두 잡았는데 INSERT·UPDATE·DELETE·DDL 은 **0** 건이다 |
| 알림 켠 사람 수 | 통과 | 출력: "매수 알림이 새로 갈 사람: 0명 (알림 켠 사람 3명 중)". DB 에서 직접 보면 push_subscription 의 active 사용자도 {1,2,3}, 3명이다. pending 인 사용자 4는 빠졌다 |
| 0013 사본과 같은 답 | 통과 | `b13.db`(같은 원본의 사본)를 `migrate.upgrade_to_head()` 로 올리면 → `0013` 이다. signal_diff 의 글자 출력과 `--json` 이 a.db 쪽과 `diff` 로 **같다**(SAME_TEXT·SAME_JSON). 이 DB 는 두 쪽 모두 바뀐 것이 0이라 비교가 약하다. 그래서 `rv2end/forced.py` 로 `signal_rules.evaluate_rule` 을 "오늘 모두 매수"로 바꿔 두고 다시 돌렸다. 0012와 0013 모두 `users 2 / 3명`, 종목 11개, today_changed 11개로 **같다**. 0012 쪽은 user_settings SELECT 10건 중 `signal_thresholds` 를 담은 것이 **0** 건, 0013 쪽은 13건 중 12건이다 |
| 새 테스트가 고치기 전 코드에서 실패하는지 | 통과 | `git archive 3aabeec backend` 를 저장소 밖에 풀고 새 테스트 파일만 덮었다. `test_signal_diff_runs_on_a_db_before_0013` → **FAILED** `sqlite3.OperationalError: no such column: user_settings.signal_thresholds`(나머지 17은 통과). 같은 옛 코드로 a.db 에 CLI 를 돌리면 exit=1 이다. 뮤테이션(저장소 밖 사본에서): (A) 기본 기준을 미리 넣는 3줄을 빼면 FAILED, (B) defer 줄을 `pass` 로 바꾸면 FAILED. 두 부분 모두 테스트가 지킨다 |
| 회귀(백엔드 전체) | 통과 | `python -m pytest -q`(SQLite): **1364 passed, 3 skipped**. 1차는 1363/3 이었고 새 테스트 1개가 더해졌다. `rv2end/pytest.txt` |
| 프론트 | 해당 없음 | `git diff --stat 3aabeec..7ead933 -- frontend` 에 바뀐 것이 없다 |
| 문서 R1 | 통과 | `backend/app/migrate.py:139` 와 `0013_signal_thresholds.py:7` 이 "DEPLOY.md 9-2" 를 가리킨다 |

## 고친 방법에 빈틈이 있는지 (코드로 따짐)

`backend/app/tools/signal_diff.py:87-104`, 호출은 `:122-123`.
- **Session.get 도 가로채지는지.** 그렇다. SQLAlchemy 2.0.53 에서 `db.get` 의 PK 로딩은 `session.execute` 를 거치므로
  `do_orm_execute` 가 불린다. 위 SQL 수집이 이를 보여 준다. 0012 쪽 user_settings SELECT 10건(설정 줄이 없는 사용자 3도 매번 SELECT 한다)
  모두 칸이 빠졌다.
- **relationship 의 joined/selectin 로딩.** 해당 없다. `models.py` 에 relationship 은 `UserStock.instrument`(lazy joined, `:125`)
  하나뿐이다. UserSettings 를 끌고 오는 eager 로딩이 없다.
- **alerts 등 안의 다른 UserSettings 읽기.** 앱 전체에서 UserSettings 를 읽는 곳은 모두 `db.get(UserSettings, uid)` 다(`grep`).
  - 이 경로에서 거치는 곳: `alerts.py:111,298`, `rebalance.py:51,129,327`, `my_signals.py:49`. 이 경로에서 `signal_thresholds` 속성을 직접 만지는 곳은 `my_signals.thresholds_for` 뿐이다.
  - `thresholds_for` 는 `db.info["signal_thresholds"]` 를 먼저 보는데, `_read_without_thresholds` 가 대상 사용자 전부에 대해 `DEFAULT` 를 미리 넣는다. 그래서 미룬 칸을 늦게 읽다가 넘어지는 일이 생기지 않는다.
  - 알림 판정(`current_values`)은 이 `users` 목록의 사람에게만 돈다.
- **서버(앱 본체)에는 이 길이 쓰이지 않는지.** 쓰이지 않는다.
  - `app/` 에서 `signal_diff` 를 import 하는 곳이 없다. 주석에서 이름만 나온다(`signal_recompute.py:17`, `alerts.py:156`, `version.py:126`).
  - 리스너는 이 도구가 만든 **세션 인스턴스**에만 붙는다(`event.listens_for(db, …)`). 그 세션은 `main` 에서 rollback·close 된다.
  - 칸이 있는 DB(0013)에서는 `_has_thresholds_column` 이 참이라 이 길에 들어가지 않는다. 0013 사본에서 칸을 읽은 SELECT 12건이 이를 뒷받침한다.
- **Postgres.** 문제없다고 본다.
  - `inspect(db.connection()).get_columns("user_settings")` 는 PG 에서 기본 schema(search_path)의 칸을 돌려준다. 앱은 schema 를 따로 쓰지 않는다.
  - `defer` 는 방언과 상관없는 ORM 옵션이고, 만들어지는 SQL 은 칸 목록에서 그 칸만 빠진다.
  - 실패한 쿼리가 하나도 없다. 그래서 PG 의 "트랜잭션 중단" 문제도 생기지 않는다.
  - 다만 PG 에서 직접 돌려 보지는 못했다(1차 R3 와 같은 사정). CI 의 Postgres 갈래에 맡긴다.

## 참고 (막지 않음)
- N1. 리스너는 `column_descriptions` 의 entity 가 UserSettings 인 SELECT 에 무조건 `defer` 를 붙인다.
  - 나중에 이 경로에 `select(UserSettings.push_kinds)` 처럼 칸만 고르는 SELECT 가 생기면 defer 가 맞는 엔티티를 찾지 못해 오류가 날 수 있다. 지금 코드에는 그런 읽기가 없다.
  - 또 이 경로의 누군가가 `settings.signal_thresholds` 를 `thresholds_for` 를 거치지 않고 직접 읽으면, 미룬 칸을 늦게 읽다가 0012 에서 넘어진다.
  - 둘 다 새 테스트가 그 경로를 지나면 잡힌다. 지금은 문제 아님.
- N2. 새 테스트는 SQLite 의 `ALTER TABLE … DROP COLUMN` 을 쓴다(SQLite 3.35 이상). CI 의 Postgres 갈래에서도 같은 문법이 통한다.

## 정리
- 서버는 띄우지 않았다(이번 확인에 화면이 필요 없음).
- 내가 돌린 일로 worktree 의 `backend/` 에 무시 대상 파일이 생겼다. `migrate.upgrade_to_head` 가 만든 `backups/…-premigrate.db`, pytest 가 만든 `logs/`·`signal_dashboard.db`·`__pycache__/` 다.
  모두 `.gitignore` 대상이고, 생성 시각으로 내가 만든 것임을 확인했다. 지우지 않고 `rv2end/moved/` 로 옮겼다.
- 소스 파일 하나를 worktree 안에서 옛 버전으로 바꿔 보려던 시도는 권한에서 막혀 실행되지 않았다. 바로 `git checkout --` 로 확인했고 깨끗했다.
  뮤테이션은 모두 저장소 밖 사본(`rv2end/old/`)에서 했다.
- 끝에 원본 diff.db 의 해시를 다시 재려던 명령은 권한 분류기가 막았다. 원본은 처음에 해시를 잰 뒤 `cp` 의 원본으로만 썼다.

## 끝날 때 worktree `git status`
```
HEAD detached at 7ead933
nothing to commit, working tree clean
```
