# A 뮤테이션 — 총괄 (커밋 전)

명령: `python -m pytest -q -x tests/test_value_record.py tests/test_migration_0014.py tests/test_isolation.py tests/test_rebalance.py`

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| 한국 날짜 → UTC 날짜 | `backend/app/services/value_record.py` | 잡힘 |
| 보유 0 종목도 positions 에 | `backend/app/services/value_record.py` | 잡힘 |
| 종가 날짜 빼기 | `backend/app/services/value_record.py` | 잡힘 |
| 0 줄(전날 기록) 안 남기기 | `backend/app/services/value_record.py` | 잡힘 |
| 미리 거르기 없애기(빈 설정 행) | `backend/app/services/value_record.py` | 잡힘 |
| 같은 날 덮어쓰기 대신 늘 새 줄 | `backend/app/services/value_record.py` | 잡힘 |
| 유일키 충돌 다시 쓰기 없애기 | `backend/app/services/value_record.py` | 잡힘 |
| in_use 대신 모두 | `backend/app/services/value_record.py` | 잡힘 |
| 한 사람 실패가 전체를 멈춤 | `backend/app/services/value_record.py` | 잡힘 |
| 끄기 무시 | `backend/app/services/value_record.py` | 잡힘 |
| 현금 통화별 빼기 | `backend/app/services/value_record.py` | 잡힘 |
| 총액에서 현금 빼기 | `backend/app/services/rebalance.py` | 잡힘 |
| 미국 갱신 실패 시 기록 안 함 | `backend/app/services/scheduler.py` | 잡힘 |
| 켤 때 받은 게 있을 때만 기록 | `backend/app/services/scheduler.py` | 잡힘 |
| 탈퇴에서 평가금액 빼기 | `backend/app/routers/auth.py` | 잡힘 |
| 내리기 백업 조건 없애기 | `backend/app/migrate.py` | 잡힘 |
| my_days 남의 것까지 | `backend/app/services/value_record.py` | 잡힘 |
| status 그날 사람 수 → 전체 | `backend/app/services/value_record.py` | 잡힘 |

18개 중 18개 잡힘.

## 검토 조건 뒤 (A 검토 1차 조건부 — 조건 둘)

검토자가 찾은 살아남은 줄(`_holds_anything` 의 `> 0` → `>= 0`)과, 고치며 더한 줄(활성 종목만·주인 없는 줄 치우기·CASCADE).
명령: `python -m pytest -q -x tests/test_value_record.py tests/test_migration_0014.py tests/test_isolation.py` (backend).

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| 수량 0 도 보유로 (검토자가 찾은 것) | `backend/app/services/value_record.py` | 잡힘 |
| 숨긴 종목도 보유로 | `backend/app/services/value_record.py` | 잡힘 |
| 사람 없는 줄은 두기 | `backend/app/services/value_record.py` | 잡힘 |
| 가입 전 줄은 두기 | `backend/app/services/value_record.py` | 잡힘 |
| 가입 전 판정을 <= 로 | `backend/app/services/value_record.py` | 살아남음 → 가입 순간의 줄을 테스트에 더한 뒤 잡힘 |
| 치운 뒤 커밋 빼기 | `backend/app/services/value_record.py` | 살아남음 → 테스트가 rollback 뒤에 세게 바꾼 뒤 잡힘 |
| 켤 때 치우지 않기 | `backend/app/services/scheduler.py` | 잡힘 |
| 치우기가 넘어지면 기록도 멈춤 | `backend/app/services/scheduler.py` | 잡힘 |
| 외래키 CASCADE 빼기 | `backend/migrations/versions/0014_portfolio_value_daily.py` | 잡힘 |

**9/9 잡힘** (둘은 테스트를 더한 뒤). Postgres 16(이 컨테이너)에서: 0014 의 외래키 `ondelete=CASCADE`, users 행을 지우면
(0.43 의 탈퇴가 하는 일) 평가금액 줄 0 — 손으로 확인. `test_value_record`·`test_migration_0014`·`test_isolation` 87 passed.

## 두 번째 검토 뒤 (합격 — 살아남은 R2 하나, 참고 둘)

치우기를 스케줄러(켠 뒤 30초)에서 `db.init_db`(요청을 받기 전)로 옮김, 데모 가입일을 기록보다 앞(30일 전)으로.

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| R2 보유·종목 짝에서 ticker 빼기 (검토자) | `backend/app/services/value_record.py` | 살아남았음 → 활성 종목(보유 없음) + 숨긴 종목(보유) 테스트로 잡힘 |
| init_db 에서 치우지 않기 | `backend/app/db.py` | 잡힘 |
| 치우기가 넘어지면 앱도 멈춤 | `backend/app/db.py` | 잡힘 |
| 데모 가입일을 오늘로 | `backend/devtools/fake_server.py` | 잡힘 (기존 `test_demo_has_daily_value_records` — 켤 때 치우기가 데모 줄을 지운다) |

백엔드 1398 passed / 3 skipped. Postgres 16: value_record·0014·isolation·devtools 101 passed.
