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
