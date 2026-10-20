# 0.44.0 A "날마다 평가금액 기록" — 두 번째 검토자 판정

# 합격

- 본 머리: `d00e114`(detached, `origin/claude/new-session-fftcg1`). A = `b6f7d06` + `44a2a05`. 라운드 시작 `4844bf0`.
- 이번에 본 것: 앞 판정 `A-review.md` 의 조건 둘이 풀렸는가 + §3 표를 머리에서 다시.
- 작업 폴더(저장소 밖): `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r044/revA2/`
  - 스크립트 `scripts/`, 0.43 코드는 `old043/`(`git archive 4844bf0 backend` 로 새로 풀었다. 앞 검토자의 `revA/old043` 과 `diff -rq` 차이는 logs·session.key 뿐).
- 조건 둘 모두 풀렸다. 직접 넣은 뮤테이션 셋 중 하나가 살아남았다. 다만 실제로는 같은 동작이다(아래 R2). 그래서 막지 않는다.

## 앞 판정 조건 — 풀렸나

### 조건 ① 0.43 으로 이미지만 되돌린 동안의 탈퇴 — 풀림

앞 검토자와 같은 길을 걸었다. 0.44 코드로 DB 를 0014 로 만들고 데모를 넣는다(`step1_new.py`, 가입일은 30일 전으로).
0.43 실제 코드로 그 DB 를 연다(`step2_old.py`). 다시 0.44 를 켠다(`step3_new.py`, 스케줄러 함수 `scheduler._startup_refresh_job()` 를 그대로 부름).

- **Postgres 16** (`reva2_pg`, 끝에 지움)
  - 외래키: `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE` (`pg_get_constraintdef`).
  - 0.43 코드: `rev after start 0014`, `current as 2 200`, **`withdraw 2 on 0.43: 204`**, `pvd rows by user: [(1, 5)]` — 친구의 줄 5개가 같이 지워졌다(앞 판정에서는 500 ForeignKeyViolation).
  - 다시 0.44 를 켬: `before startup [(1, 5)]` → `after startup [(1, 5)]`. 주인 줄은 그대로다(오늘 줄은 고쳐 쓰기).
- **SQLite — 번호 재사용 없음** (`s.db`)
  - 0.43: 3·2 탈퇴 204. 새 가입자는 `id 5` 를 받았다. `pvd rows by user: [(1, 5), (2, 5)]` — 고아 5줄.
  - 0.44 켬: `WARNING … 주인 없는 평가금액 기록 5줄을 지웠습니다(옛 버전에서의 탈퇴)`, `after startup [(1, 5)]`. 새 사람 5 는 `{'days': 0, 'since': None}`.
- **SQLite — 번호 재사용** (`s2.db`; 맨 끝 번호 4 를 활성으로 하고 줄 5개를 줌, `prep_reuse.py`)
  - 0.43: `withdraw 4 on 0.43: 204`, **`new signup id 4`**(번호 재사용 확인), `pvd rows by user: [(1, 5), (2, 5), (4, 5)]`.
  - 0.44 켬: `주인 없는 평가금액 기록 5줄을 지웠습니다`, `after startup [(1, 5), (2, 5)]`.
    - `current as 2 friend … {'days': 5, 'since': '2026-10-12'}` — 남아 있는 친구의 기록은 그대로다.
    - **`current as 4 late@example.com … {'days': 0, 'since': None}`** — 새 사람에게 앞사람의 줄이 붙지 않는다.
- 코드: `value_record.sweep_orphans` (`backend/app/services/value_record.py:167-185`). outerjoin 으로 사람이 없는 줄과 `recorded_at < created_at` 인 줄을 고른다.
  `scheduler._record_values(sweep=True)` (`scheduler.py:72-91`)는 켤 때만 부른다(`scheduler.py:137`). 치우기가 넘어지면 rollback 하고 그날 줄은 그대로 남긴다.
  - 두 시각은 모두 UTC naive 다(`models.py:53` `created_at` default utcnow, `value_record.py:120` `recorded_at = now or utcnow()`, 스케줄러는 `now=None`). 그래서 비교가 맞다.
  - `users.created_at` 을 다시 쓰는 코드는 없다(`grep "created_at *="`: users.py:143·google_login.py:343 생성 때뿐).
- DEPLOY 9-3 (`DEPLOY.md:355-357`)에 되돌린 동안의 탈퇴가 적혔다(PG CASCADE, SQLite 는 켤 때 치우기, 로그 문구). 0014 는 아직 어느 서버에도 오르지 않았다. 확인: `origin/main` = `4844bf0` 에 0014 없음, `b6f7d06` 를 담은 원격은 이 작업 브랜치뿐. 그래서 0014 를 고쳐 쓰는 게 안전하다.

### 조건 ② `_holds_anything` — 풀림

- `value_record.py:83-99`: `UserStock` 에 (user_id, ticker) 로 join 하고, `Holding.quantity > 0`, `UserStock.active.is_(True)` 인 것만 센다.
- 테스트 `test_holding_nothing_that_counts_gets_no_row_and_no_settings_row[zero quantity|hidden stock]` 가 생겼다.
- 앞 검토자의 뮤테이션 `> 0`→`>= 0` 이 이제 잡힌다. 아래 표의 1번(`[zero quantity]` FAILED).

## 참고 (막지 않음)

1. **켠 뒤 치우기 전까지 틈이 있다.** 치우기는 `_startup_refresh_job` 안에서 돈다. 이 일은 켠 뒤 30초(`scheduler.py:310` `_soon(30)`)에 시작하고, 따라잡기 갱신이 끝난 다음에야 치운다.
   - 그 사이 번호를 다시 받은 사람이 리밸런싱을 열면 앞사람의 "날 수·시작일"이 보인다. `s3.db` 에서 일을 돌리기 전에 API 를 불러 확인했다(`step4_before_job.py`): `current as 4 late@example.com 200 {'days': 5, 'since': '2026-10-12'}`.
   - 보이는 것은 날 수와 날짜뿐이고 금액은 아니다. 게다가 SQLite + 되돌림 + 맨 끝 번호 탈퇴 + 되돌린 동안 가입이 모두 겹쳐야 한다. 그래서 지금은 참고다.
   - DEPLOY 의 "다시 v0.44.0 을 켤 때 … 지웁니다"는 대략 맞다. 나중에 성과 화면처럼 금액을 보이는 기능이 생기면, 치우기를 `init_db`(요청을 받기 전)로 옮겨야 한다.
   - `_recompute_if_rules_changed()` 가 넘어져도 그 일 전체가 멈춘다. 이건 0.44 전부터 있던 모양이다.
2. **데모 seed 의 줄은 "가입 전"으로 보인다.** `fake_server.seed()` 는 사람을 `created_at=now` 로 만들고, 기록은 `now - 4..0일` 로 쓴다(`fake_server.py:663-699`).
   - 이 DB 에 스케줄러의 켤 때 길이 돌면 앞 나흘 줄이 지워진다. 가짜 서버는 스케줄러를 끄므로(`fake_server.py:145`) 지금 보이는 곳은 없다.
   - 내 스크립트는 그래서 가입일을 30일 전으로 당겼다. 데모를 고칠 때 seed 의 `created_at` 을 앞당기면 깔끔하다.
3. 명세 13장에는 CASCADE·치우기 이야기가 없다. 그 내용은 DEPLOY 9-3 에만 있다. 운영 이야기라 DEPLOY 로 충분하다고 본다.
4. 앞 판정의 참고 셋(내리기 실패 문구·traceback, "N일째" vs "N일치", 데모 PG seed 순서)은 그대로 남아 있다. 이번 고침 범위가 아니다.

## §3 검토 표

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 완료 조건 | 통과 | 아래 "완료 조건". 앞 판정에서 걸린 두 줄(빈 사람 설정 행·탈퇴)이 이번에 풀렸다 |
| 계획 때 걱정 | 통과 | 앞 판정 표 그대로(막음 0). 이번 고침은 plan.md:24-25(내리기 대신 이미지만·탈퇴)의 빈틈을 메운 것이다 |
| 회귀 | 통과 | SQLite `pytest -q`: **1397 passed, 3 skipped** (`revA2/pytest-sqlite.txt`; 시작 1364/3, 앞 판정 1391/3). Postgres 전체: **1399 passed, 1 skipped** (`revA2/pytest-pg.txt`; skip 은 `test_migration_0005.py:390` PG 해당 없음). vitest **894 passed** (58 파일). lint 경고 22 = 시작 22. `npm run build` 통과, 첫 화면 JS gzip 111.20 kB (시작 111.04 — 차이는 B 의 Dashboard 변경). 응답 사진: `snapdiff.py baseline/snap revA2/snap` → `같음 / 차이 0` |
| 격리 | 통과 | 새 경로 없음(`44a2a05` 는 백엔드 서비스·마이그레이션·테스트만). 가짜 서버 8183: owner `/api/admin/records` 200, friend·new **403**, 손님·pending 401. new 의 `value_record` `days 0` — 남의 것이 섞이지 않는다. `test_isolation.py` PG·SQLite 통과. 번호 재사용 때 남의 기록이 붙지 않는 것은 위 ①에서 확인 |
| 마이그레이션 | 통과 | 0014 외래키 CASCADE: PG 제약 정의 확인, `test_the_owner_link_cascades`(SQLite·PG 통과). 0.43 이미지 + 0014 DB: PG 탈퇴 204·줄 0, SQLite 고아·재사용은 켤 때 치움(위 ①). 올리기·내리기·백업 조건은 `44a2a05` 가 건드리지 않았다. `test_migration_0014.py` 전체가 PG·SQLite 에서 통과(앞 판정의 손 확인 그대로) |
| 호환 | 통과 | `apidiff.py baseline/openapi.json revA2/openapi.json`: `빠짐 0 / 타입 바뀜 0 / 더해짐 3 ['GET /api/admin/records', 'RebalanceCurrentOut.value_record', 'schema ValueRecordOut']`. 새 DB ↔ 옛 서버(0.43)는 위 ①로 해결됐다. 옛 응답 화면 테스트는 vitest 안에 있다 |
| 입력 한도 | 해당 없음 | 새로 받는 값 없음 |
| 뮤테이션 | 통과 (R2 는 같은 동작) | 아래 "뮤테이션" |
| 비밀 | 해당 없음 | 키·토큰 없음. 치우기 로그는 줄 수뿐이다(`value_record.py:184`) |
| 규제 | 통과 | `44a2a05` 에 화면 문자열 없음. 화면 줄 "리뷰 기록과 따로, 평가금액은 매일 아침 자동으로 남깁니다 — 2026-10-12부터 5일째." 그대로 |
| 데이터 경계 | 통과 | 사용자별 표 하나. 치우기는 그 표만 지운다 |
| 외부 호출 | 통과 | 치우기는 DB 쿼리 하나와 delete 하나. 사람 수만큼 늘지 않는다 |
| 화면 | 통과 | A 화면은 `44a2a05` 에서 바뀌지 않았다(`git diff --name-only 44a2a05~1 44a2a05` 에 frontend 없음). 빌드 뒤 가짜 서버 8183 · 폰 360(`revA2/scripts/check.mjs`): owner·friend 안내 줄이 보이고 new 는 줄 없음, `overflow 0`. 콘솔의 403 은 검사 스크립트가 스스로 부른 `/api/admin/records` 다. 스크린샷 `revA2/shots/`. 두 테마·1400·Tab 은 앞 판정 그대로 |
| 성능 | 통과 | 매일 일에는 더해진 것이 없다(`test_the_daily_job_does_not_sweep`). 켤 때 쿼리 한 번. `/api/rebalance/current` 경로는 바뀌지 않았다 |
| 가짜 서버 | 통과 | 8183 seed: owner·friend 5일, new 0, 진단 `rows 10`. `test_devtools.py` 는 전체 실행 안에서 통과 |
| 문서 | 통과 | DEPLOY 9-3 의 새 문단(`DEPLOY.md:355-357`)이 코드와 맞다. 틈은 참고 1. `A-mutation.md` "검토 조건 뒤" 표 9/9 를 직접 다시 돌렸다(아래) |

## 완료 조건 (plan.md A 표 · 6절 ①) — 앞 판정과 달라진 줄만

| 정한 것 | 판정 | 증거 |
| --- | --- | --- |
| 빈 사람에게 설정 행 안 만듦 | 통과 | 활성 종목·수량 > 0 만 센다. 테스트 두 경우. 가짜 서버 new 는 줄 0 |
| 탈퇴하면 기록을 바로 지움(방침 5절) | 통과 | 0.44: `auth.py` 목록과 metadata 테스트(PG·SQLite). 0.43 으로 되돌린 동안: PG 는 CASCADE 로 바로 지운다. SQLite 는 다시 켤 때 지우고, 그 전에는 남는다(참고 1) |
| 나머지 줄 | 통과 | 앞 판정 표 그대로. `44a2a05` 가 건드린 곳은 회귀 테스트로 다시 봤다 |
| 주인 결정 ① 범위 | 통과 | `44a2a05` 파일 8개는 모두 A 다 |

## 뮤테이션

명령: `revA2/scripts/mut.py` — 한 줄을 바꾸고 `pytest -q -x tests/test_value_record.py tests/test_migration_0014.py tests/test_isolation.py` 를 돌린 뒤 원래 바이트로 되돌린다.
R1·R2 는 전체 `tests` 로 다시 돌렸다(`mut_full.py`). 결과는 `revA2/mut-sqlite.txt`, `revA2/mut-full-sqlite.txt`.

| 뮤테이션 | 결과 |
| --- | --- |
| 1 수량 0 도 보유로 (`>= 0`) | 잡힘 — `[zero quantity]` |
| 2 숨긴 종목도 보유로 | 잡힘 — `[hidden stock]` |
| 3 사람 없는 줄은 두기 | 잡힘 — `test_sweep_removes_rows_whose_person_is_gone_or_came_later` |
| 4 가입 전 줄은 두기 | 잡힘 — 같은 테스트 |
| 5 가입 전 판정 `<=` | 잡힘 — 같은 테스트(가입 순간의 줄) |
| 6 치운 뒤 커밋 빼기 | 잡힘 — 같은 테스트(rollback 뒤 확인) |
| 7 켤 때 치우지 않기 | 잡힘 — `test_startup_records_whether_or_not_anything_was_fetched` |
| 8 치우기 실패가 기록도 멈춤 | 잡힘 — `test_startup_still_records_when_the_sweep_fails` |
| 9 0014 CASCADE 빼기 | 잡힘 — `test_the_owner_link_cascades` |
| **R1 (직접) 모델의 CASCADE 빼기** | 좁은 세트에서는 살아남음(87 passed). 전체에서는 **잡힘** — `test_alembic.py::test_models_and_migrations_do_not_drift` |
| **R2 (직접) 보유-종목 짝을 사람만으로** (`& (UserStock.ticker == Holding.ticker)` 빼기) | **살아남음** (전체 1397 passed). 실제로는 같은 동작 — 아래 |
| **R3 (직접) 치우기 outerjoin → join** | 잡힘 — sweep 테스트(SQLite 의 사람 없는 줄) |

실행자의 9/9 는 그대로 다시 나왔다.

**R2 가 막지 않는 까닭.** 이 뮤테이션이 다르게 하는 일은 하나뿐이다.
"활성 종목은 있지만 그 종목 보유가 0이고, 숨긴 종목에만 수량이 있는 사람"에게 `_holds_anything` 이 True 가 된다. 그러면 평가 계산이 설정 행을 만든다.
평가금액 줄은 어느 쪽이든 생기지 않는다(`record_user` 의 `empty` 판정).
그런데 활성 종목이 있다는 건 종목을 넣었다는 뜻이고, 종목을 넣은 사람은 이미 설정 행이 있다. 대시보드를 한 번 열면 설정 행이 생긴다(`step5_settings.py`: `POST /api/stocks 200 settings row: False` → `GET /api/dashboard 200 settings row: True`).
그래서 실제로는 같은 결과다. 굳이 잡으려면 `[hidden stock]` 에 "보유 없는 활성 종목 하나"를 더하면 된다.

## 끝 정리

- 가짜 서버 8183: `kill $(cat revA2/fs.pid)` → `curl … || echo "8183 down"` → `8183 down`. 데이터 `r044/revA2-data`.
- 응답 사진용 가짜 서버(같은 8183, `snapshot.py` 가 스스로 띄우고 끔): 끝난 뒤 `8183 down`.
- Postgres: 내가 만든 `reva2_pg` 는 지웠다(남은 db: postgres·template0/1·t·m — t·m 은 내 것이 아니다). 클러스터는 끄지 않았다.
- 저장소 파일은 고치지 않았다. 뮤테이션은 원래 바이트로 되돌렸다. 커밋하지 않았다.

```
$ git status   (/home/user/Dashboard/.claude/worktrees/agent-a983bdda0d7031498)
HEAD detached at d00e114
nothing to commit, working tree clean
```
