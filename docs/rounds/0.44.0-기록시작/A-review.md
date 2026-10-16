# 0.44.0 A "날마다 평가금액 기록" — 검토자 판정

# 조건부 합격

- 본 범위: `4844bf0..b6f7d06` (A = `b6f7d06` 하나). 전체 회귀는 머리 `ef7f2bb`(detached)에서 돌렸다.
- 규칙: `docs/rounds/0.44.0-기록시작/PROMPT.md` v5. 완료 조건: `plan.md` A 표, 5절, 6절 ①.
- 작업 폴더(저장소 밖): `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r044/revA/`
- Postgres: 이 컨테이너에 PostgreSQL 16 바이너리가 있다. 전용 클러스터를 띄웠다(`/tmp/revA-pg-8a1795`, 포트 55441, 끝에 `pg_ctl stop`).
  - 이 경로는 scratchpad 밖이다. `/tmp/claude-0` 이 700 이라 postgres 사용자가 들어갈 수 없어서다.
  - 드라이버 `psycopg[binary]` 는 scratchpad `revA/pylib` 에 `--target` 으로 받았다(시스템에 깔지 않음).
  - 처음 받을 때 `pip download` 가 wheel 하나를 worktree 에 떨어뜨렸다. 지웠고, 아래 git status 는 깨끗하다.

## 조건 (고쳐야 함 2)

1. **0.43 으로 "이미지만" 되돌린 동안 탈퇴가 깨진다.** DEPLOY 9-3 은 이 방법을 권하는데, 그 결과가 문서에 없다. 실제 0.43 코드(`git archive 4844bf0`)를 0014 DB 에 붙여 돌려 봤다(`revA/step2_old.py`).
   - **Postgres**: 0014 DB 로 뜨고(`DB 리비전 0014 는 이 버전이 모릅니다 … 그대로 씁니다`), `/api/rebalance/current` 는 200 이다. 그런데 친구 탈퇴 `DELETE /api/auth/me` 가 **500** 이다.
     `ForeignKeyViolation: update or delete on table "users" violates foreign key constraint "portfolio_value_daily_user_id_fkey"`
     0.43 의 탈퇴 목록(`routers/auth.py:373` 옛 줄)에 새 표가 없고, 0014 의 FK 에는 `ondelete` 가 없다(`migrations/versions/0014_portfolio_value_daily.py:27`).
   - **SQLite**(운영 SQLite 는 FK 를 강제하지 않는다): 탈퇴는 204 다. 하지만 `pvd rows for 2: 5 user 2 exists: 0` 로 고아 줄 5개가 남는다. 방침 5절 "탈퇴하면 … 평가금액 기록을 바로 지웁니다"와 어긋난다.
     게다가 `users.id` 는 AUTOINCREMENT 없는 INTEGER PK 다. 맨 끝 번호인 사람이 탈퇴하면 다음 가입자가 같은 id 를 받는다. 사본에서 확인했다: id 4 를 지운 뒤 넣으니 `max(id)=4`.
     그러면 그 사람에게 남의 기록이 붙는다. 지금은 "○일째"뿐이지만, 나중에 성과 화면이 생기면 남의 금액이 된다.
   - 고칠 방법은 실행자가 정한다. 예를 들면 다음 셋이다.
     - FK 에 `ondelete="CASCADE"`: PG 의 0.43 탈퇴가 통한다.
     - 0.44 가 켤 때 `users` 에 없는 `user_id` 줄을 지운다.
     - 최소한 DEPLOY 9-3 에 "되돌린 동안 탈퇴 불가(PG)·기록이 남음(SQLite) — 다시 올린 뒤 …"를 적는다.
   - 테스트 `test_the_previous_image_still_opens_a_db_at_0014` 는 `is_known` 을 바꿔 흉내만 낸다. 그래서 이 길을 보지 못한다.
2. **뮤테이션 하나가 살아남았다**: `value_record._holds_anything` 의 `Holding.quantity > 0` → `>= 0` 은 121 passed 로 통과한다.
   - 수량 0 짜리 보유 행은 실제로 생긴다(`routers/stocks.py:207-213` 는 평단가만 넣어도, `routers/rebalance.py:104-107` 은 수량을 0 으로 고쳐도 만든다).
   - 그런 사람에게는 `portfolio_valuation → get_settings` 가 설정 행을 만든다. 계획의 "빈 사람에게 설정 행 안 만듦"과 어긋난다.
   - 지금 코드는 맞다. 다만 그 경우를 지키는 테스트가 없다(`tests/test_value_record.py:116-125` 는 보유 행이 아예 없는 경우만 본다).
   - 같은 길이 하나 더 있다. 감춘(비활성) 종목에만 보유가 있는 사람도 `_holds_anything` 이 True 라서 설정 행이 생기고, 줄은 남지 않는다. 테스트 하나면 둘 다 잡힌다.

## 참고 (막지 않음)

- 내리기에서 백업이 실패하면 `MigrationBackupFailed` 문구가 "업그레이드를 멈춥니다 … 이번 업데이트는 되돌릴 수 없는 스키마 변경 … 이전 버전으로 돌아가세요"라고 나온다(`services/backup.py:207-213`). 내리기에는 맞지 않는 말이다.
  `app.tools.downgrade` 는 `ValueError` 만 잡아서 이 경우 traceback 이 그대로 나온다(`app/tools/downgrade.py:22-25`). 멈추는 동작 자체는 맞다(아래).
- 안내 줄의 "N일째"는 쌓인 **줄 수**다(`value_record.my_days`). 휴면이나 꺼짐으로 빈 날이 있으면 "since 부터 N일째"가 날짜 차이와 달라진다. "N일치"가 더 정확하다.
- 가짜 서버 `seed()` 는 Postgres 에서 FK 순서 때문에 넘어진다(holding 이 user_stock 보다 먼저 flush). 0.43 부터 있던 것이고 가짜 서버는 SQLite 만 쓴다. 검토용 스크립트에서 우회했다.

## §3 검토 표

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 완료 조건 | 통과 (조건 1 빼고) | 아래 "완료 조건 하나씩" |
| 계획 때 걱정 | 통과 | 아래 "계획 검토 걱정" — "반영"으로 답한 것 모두 코드·문서에 있음. 막음 0 |
| 회귀 | 통과 | SQLite `pytest -q`: **1391 passed, 3 skipped** (시작 1364 passed, 3 skipped). Postgres 전체: **1393 passed, 1 skipped**. vitest **892 passed** (시작 884; A +7, B +1). lint 경고 22 = 22. `npm run build`(tsc -b 포함) 통과, 첫 화면 JS gzip 111.10 kB (시작 111.04). 응답 사진 owner/friend × 5경로 `snapdiff.py baseline/snap revA/snap` → `같음 / 차이 0` (`value_record` 는 더한 칸이라 빠짐). AI 상수 `ai_consts.json`: 다른 것은 `__file__`·`__cached__` 경로뿐 |
| 격리 | 통과 | `test_isolation.py:143-144` `("GET","/api/admin/records"): (SHARED, OWNER)`, 주인 전용 15(:199-203), `OWNER_CALLS`(:1022). 가짜 서버 8180: owner `/api/admin/records` 200, friend·new **403**, 손님·pending 401. 남의 기록: id 를 받는 길이 없다. `/api/rebalance/current` 의 `value_record` 는 내 것만 — friend 5일, `test_isolation.py:709-710` B=2 / A=3 이 섞이지 않음. 뮤테이션 "my_days 남의 것까지"는 여기서 잡힌다 |
| 마이그레이션 | 통과 (호환 쪽은 조건 1) | 아래 "마이그레이션" |
| 호환 | 통과 (조건 1 빼고) | `apidiff.py`: `빠짐 0 / 타입 바뀜 0 / 더해짐 3 ['GET /api/admin/records', 'RebalanceCurrentOut.value_record', 'schema ValueRecordOut']`. 옛 응답 화면 테스트: `RebalancePanel.test.tsx`("옛 서버(칸 없음)·꺼 둔 서버면 그리지 않는다"), `DiagnosticsModal.test.tsx`(경로가 없으면 '기록' 머리 없음). 새 요청 필드 없음. 새 DB ↔ 옛 서버는 조건 1 |
| 입력 한도 | 해당 없음 | 새로 받는 값 없음 (GET 둘, 환경변수 하나) |
| 뮤테이션 | 실패 (1 살아남음 → 조건 2) | 아래 "뮤테이션" |
| 비밀 | 해당 없음 | 키·토큰을 다루지 않는다. 기록 실패 로그는 `사용자 %s` 번호와 traceback 뿐이고 금액은 없다(`value_record.py` record_day) |
| 규제 | 통과 | 새 화면 문자열에 `추천·사세요·팔라·저평가·예측·수익률` 0건. `수익률`은 서버 docstring 한 줄뿐. 진단은 합계만(마지막 날짜·그날 사람 수·줄 수 — `value_record.status`, 화면 "평가금액 기록: 마지막 2026-10-16 · 그날 2명 · 모두 10줄"). 방침 6절 약속과 맞다. 명세 13장에 "나중에 하지 않는 것" 셋 |
| 데이터 경계 | 통과 | `portfolio_value_daily` 는 사용자별만이고 다시 만들 수 없다(`models.py` 클래스 docstring). 공용 표는 건드리지 않음 |
| 외부 호출 | 통과 | `record_day` → `portfolio_valuation` → `fx.get_rates` 는 저장값만 읽는다(가져오기 없음). 사람 수만큼 늘어나는 것은 DB 읽기뿐 |
| 화면 | 통과 | `audit.mjs --only rebalance,menu-diagnostics,policy,guest-rebalance,friend-dashboard --shots` (PC 1400·폰 390/360 × 두 테마 + 빨강 + 확대 150%, 45 화면×조건): page-overflow·clipped·contrast·console·touch·fake-button 등 모두 0. num-split 4 는 진단 바닥의 **로그 파일 경로**(내가 준 긴 데이터 폴더 경로) — A 와 상관없다. 폰 360 리밸런싱: "리뷰 기록과 따로, 평가금액은 매일 아침 자동으로 남깁니다 — 2026-10-12부터 5일째." 날짜가 갈라지지 않고 가로 넘침 0(`revA/shots2/friend-rebalance-360.png`). Tab: 새로 생긴 누를 것이 없다(글 두 줄) |
| 성능 | 통과 | `/api/rebalance/current` 같은 DB(데모, 주인): 0.43 코드 중앙값 13.7 ms·쿼리 7 → 0.44 13.4 ms·쿼리 8 (`my_days` 집계 하나) |
| 가짜 서버 | 통과 | seed 가 닷새치를 쓴다(`fake_server.py:694-699`). 8180 에서 owner·friend 5일, new 0. `test_devtools.py` 는 전체 실행에 들어 있고 통과 |
| 문서 | 통과 (조건 1 은 DEPLOY 보탬) | 방침 1절 "서버가 날마다 만드는 기록"·5절 탈퇴·`POLICY_EFFECTIVE='2026-10-16'`. 명세 13장의 시각·날짜·in_use·0 줄·한국/일본 갱신 뒤 안 함·끄기가 코드와 맞다(`scheduler.py` 84-90·123-127, `value_record.py`). DEPLOY 9-2 줄·9-3(되돌릴 때 내리지 않기, 내리기는 백업 조건, premigrate 백업 옮기기). README 는 라운드 끝(status 에 적힘) |

## 완료 조건 하나씩 (plan.md A 표)

| 정한 것 | 판정 | 증거 |
| --- | --- | --- |
| 표·칸·`(user_id,date)` 유일 | 통과 | `models.py` PortfolioValueDaily, 0014 :22-38. PG 데모 한 줄: `fx.rates.USD.source='stored'`, positions 마다 `close_date` |
| 미국 갱신 끝에 · 실패해도 · 켤 때 결과 없어도 | 통과 | `scheduler.py` `_daily_refresh_job` try/finally, `_startup_refresh_job` 끝 `_record_values()`. 테스트 `test_daily_job_records_after_the_refresh_even_when_the_refresh_fails`, `test_startup_records_*`, `test_korea_and_japan_jobs_do_not_record` (PG 에서도 PASSED) |
| `date` = 한국 날짜 · 종가 날짜 | 통과 | `record_date` ZoneInfo("Asia/Seoul"). 테스트 14:59/15:00 경계 |
| upsert · 사람마다 rollback | 통과 | **같은 날 두 번 → 한 줄**: PG·SQLite 둘 다 `same day twice {...'written': 2} {...'written': 2} rows 10`(10 그대로) |
| 대상 in_use · 보유나 현금 · 활성 종목 · 계산 같이 쓰기 | 통과 | `rebalance.portfolio_valuation` 을 둘이 같이 쓴다. pending 은 빠짐(대상 3명 = owner·friend·new) |
| **빈 사람에게 설정 행 안 만듦** | 통과 (조건 2: 테스트 구멍) | PG·SQLite 데모: new@ 는 기록도 설정 행도 없음 `settings rows after [1, 2]` |
| 꺼져 있던 날 안 되살림 · 입출금 한계 | 통과 | 명세 13장 |
| 내리기 백업 성공 조건 | 통과 | 아래 |
| 탈퇴 지우기 · metadata 테스트 · Postgres | 통과 | `auth.py:382-385`. `test_isolation.py:784-799` 는 모은 표마다 B 줄이 먼저 있는지 본다. PG 전체 실행에서 `DELETE /api/auth/me` 통과 |
| 방침 | 통과 | 위 |
| 진단 합계만 · 안내 줄 "리뷰 · 기록" 안 | 통과 | 위 스크린샷. "아직 남긴 기록이 없습니다"와 같이 보이지만 "리뷰 기록과 따로"로 이어진다 |
| `SIGNAL_DASHBOARD_VALUE_RECORD=0` | 통과 | PG·SQLite: `switched off None rows 10`, `status.enabled False`. 진단 "꺼져 있습니다" |
| 나중에 하지 않는 것 | 통과 | 명세 13장 |
| 가짜 서버 며칠치 | 통과 | 위 |
| 주인 결정 ① | 통과 | 범위대로 — A 에 C·D 가 섞이지 않음(커밋 파일 목록) |

## 마이그레이션

- **SQLite**(`revA/s1-before-old.db`, 데모 크기 · price_daily 18750 · holding 18)
  - 올리기: init_db → 0014.
  - 내리기 백업 실패: `SIGNAL_DASHBOARD_BACKUP_DIR` 를 파일 밑으로 주고 `python -m app.tools.downgrade 0013` → EXIT 1, `MigrationBackupFailed … [Errno 20] Not a directory`. 그 뒤 DB 는 `0014`, 줄 `10` 그대로.
  - 내리기 백업 성공: `DB 스키마: 0014 → 0013`. 다른 표 행 수가 모두 같다(users 4, user_stock 19, holding 18, user_settings 2, price_daily 18750, signal_daily 18750). premigrate 백업 안에 `portfolio_value_daily` 10줄.
- **Postgres 16**(DB `m`)
  - 올리기: 데모 → 0014.
  - 내리기 백업 실패: `PATH` 에서 pg_dump 를 빼고 내리기 → EXIT 1, `pg_dump 를 찾을 수 없습니다`. 그 뒤 `0014`, `10` 그대로.
  - 내리기 백업 성공: `0014 → 0013`, `.sql` 백업에 표가 들어 있음. 그 뒤 `to_regclass` 비어 있음, users 4·holding 18 그대로.
  - 다시 올리기: `0014`, 빈 표, price_daily 18750 그대로.
- 0013 까지만 내리는 경우는 백업 조건이 없다(`test_downgrading_only_0013_does_not_require_a_backup`). 0014 테스트 6개는 PG 에서도 PASSED.
- **0.43 이미지 + 0014 DB**: SQLite·PG 둘 다 뜨고 리밸런싱 응답 200. 탈퇴는 조건 1.

## 뮤테이션

명령: `revA/mut.py` — 한 줄 바꾸고 `pytest -q -x tests/test_value_record.py tests/test_migration_0014.py tests/test_isolation.py tests/test_rebalance.py`, 그 뒤 원래 내용으로 다시 쓴다. 결과는 `revA/mut.txt`.

| 뮤테이션 | 결과 |
| --- | --- |
| (실행자 것 다시) 내리기 백업 조건 없애기 | 잡힘 — `test_downgrading_past_0014_requires_a_backup` |
| (실행자 것 다시) my_days 남의 것까지 | 잡힘 — `test_b_cannot_see_or_touch_what_is_a[GET /api/rebalance/current]` |
| (실행자 것 다시) 탈퇴에서 평가금액 빼기 | 잡힘 — `[DELETE /api/auth/me]` |
| 검토자1 백업 조건을 목표 리비전으로(`& {revision}`) | 잡힘 |
| **검토자2 `Holding.quantity > 0` → `>= 0`** | **살아남음** (121 passed) → 조건 2 |
| 검토자3 positions `value_base` 에 현지 금액 | 잡힘 |
| 검토자4 since 를 `max` 로 | 잡힘 |
| 검토자5 켤 때 기록을 `if results:` 안으로 | 잡힘 |

실행자의 18/18 은 셋을 다시 돌려 그대로 잡히는 것을 봤다. 직접 넣은 다섯 중 하나가 살아남았다.

## 계획 검토 걱정 — "반영"이 실제로 있나

| 걱정 | 판정 |
| --- | --- |
| 개발자: 탈퇴 목록 · test_isolation 모델 목록 | 반영 — auth.py 목록 + metadata 로 모으기 |
| 개발자·검토자 A1: 내리기 백업 · 9-2 "이미지만" | 반영 — `DATA_ON_DOWNGRADE`, DEPLOY 9-2·9-3. 다만 그 권고의 부작용이 조건 1 |
| 개발자: 같은 날·중복 → upsert, try/rollback | 반영 — `record_user` IntegrityError 다시 쓰기, `record_day` 사람마다 rollback |
| 개발자: 미국 갱신 끝 · 켤 때 갱신 뒤, 결과 없어도 | 반영 |
| 개발자: 종가 날짜 `last_close_date` | 반영 — `rebalance.py:251,291` |
| 개발자: 통화별 현금 · fx 출처 | 반영 |
| 개발자 참고: active_only · 같이 쓰는 함수 · in_use · 설정 행 · 격리 표 · 가짜 서버 | 반영 (설정 행은 조건 2 의 테스트 구멍) |
| 검토자 A2: metadata 탈퇴 테스트 | 반영 |
| 검토자 A3: 방침 1·5절 · POLICY_EFFECTIVE · 안내 줄 | 반영 |
| 검토자 참고 4·5·6 | 반영 — 합계만, 명세 "하지 않는 것", recorded_at 유지 |
| 사용자: 안내 줄이 "기록 없음"과 어긋남 | 반영 — "리뷰 · 기록" 안에 "리뷰 기록과 따로" |
| 다시 보기 1: 갱신이 넘어진 날 | 반영 — try/finally, 따로 세션 |
| 다시 보기 2: 줄 안 깐 표 · `_a_is_untouched` | 반영 — `test_isolation.py:350-351, 784-788` |
| 다시 보기 3·4 (백업 상태 파일·분류) | D0 몫 — A 범위 아님 |
| 다시 보기 참고: in_use 표현 · 0 줄 · Asia/Seoul · "그날 마지막 값" · premigrate 7벌 | 반영 — 명세 13장, DEPLOY 9-3 |

## 끝 정리

- 가짜 서버 8180: `kill $(cat revA/server.pid)` → `curl … || echo "8180 down"` → `8180 down`
- Postgres 클러스터: `pg_ctl -D /tmp/revA-pg-8a1795/data stop` → `server stopped`
- 저장소 파일은 고치지 않았다. 뮤테이션은 원래 내용으로 다시 썼다.

```
$ git status   (/home/user/Dashboard/.claude/worktrees/agent-a1795cf5d8fd5bd7c)
HEAD detached at ef7f2bb
nothing to commit, working tree clean
```
