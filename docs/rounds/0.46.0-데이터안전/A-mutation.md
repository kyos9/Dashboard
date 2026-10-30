# A 백업 — 뮤테이션 (실행자)

핵심 줄을 하나씩 되돌려 시험이 잡는지. 도구: 스크래치 `tools/mutate.py`. 처음 16 중 15 잡힘, 1 은 동작이 같은 약한 뮤테이션(아래) → 진짜 둘로 바꿔 둘 다 잡힘. 진짜 Postgres 셋 잡힘. **살아남은 것 0.**

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| A2 시간 한도 빼기 | `backend/app/services/backup.py` | 잡힘 |
| A2 반쯤 쓴 파일 안 지움 | `backend/app/services/backup.py` | 잡힘 |
| A2 시간 초과 갈래 없앰 | `backend/app/services/backup.py` | 잡힘 |
| A2 PGCONNECT_TIMEOUT 빼기 | `backend/app/services/backup.py` | 잡힘 |
| A2 env 최소값 무시 | `backend/app/services/backup.py` | 잡힘 |
| A1 끝 표지 검사 빼기 | `backend/app/services/backup.py` | 잡힘 |
| A1 꼬리 대신 마지막 줄만 | `backend/app/services/backup.py` | 잡힘 |
| A3 꼬리표 섞어 세기 | `backend/app/services/backup.py` | 잡힘 |
| A3 직전 백업 7일 무시 | `backend/app/services/backup.py` | 잡힘 |
| A3 keep 합 대신 매일만 | `backend/app/services/backup.py` | 잡힘 |
| A4 경고 저장 안 함 | `backend/app/services/backup.py` | 잡힘 |
| A4 sh 가 인자 안 넘김 | `deploy/backup-export.sh` | 잡힘 |
| A1 CI 판 확인 빼기 | `.github/workflows/tests.yml` | **살아남음** |
| A1 Dockerfile PG_MAJOR 바뀜 | `Dockerfile` | 잡힘 |
| 화면: 매일 백업 따로 문구 | `frontend/src/components/DiagnosticsModal.tsx` | 잡힘 |
| 화면: PC 사본 경고 안 보임 | `frontend/src/components/DiagnosticsModal.tsx` | 잡힘 |

살아남은 하나("CI 판 확인 빼기")는 단계 **이름만** 바꾼 것이라 동작이 그대로였다 — 뮤테이션이 약했다. 실제로 판 확인 줄(grep 17)을 빼거나 REQUIRE_PG_RESTORE 를 빼는 둘로 다시:

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| A1 CI 판 확인 줄 빼기(grep 17) | `.github/workflows/tests.yml` | 잡힘 |
| A1 CI REQUIRE 빼기 | `.github/workflows/tests.yml` | 잡힘 |

## 진짜 Postgres(로컬 16 — 서버·pg_dump 같은 판)에서 되돌리기 시험이 잡는지

| 뮤테이션 | 결과 |
| --- | --- |
| 덤프에서 `holding` 표의 데이터를 뺌(`--exclude-table-data=holding`) — 붓기는 성공하지만 내용 대조가 잡아야 | 잡힘 |
| 덤프에서 `alembic_version` 데이터를 뺌 | 잡힘 |
| 시험이 한 표(stock_split)를 채우지 않음 — "모든 표에 줄" 검사가 잡아야 | 잡힘 |
