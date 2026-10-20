# A 뮤테이션 (총괄, 75d26d9 + 테스트 한 줄)

15개. 처음 돌림에서 "attention 30일 → 3일"이 살아남아(3일 전 시험만 있어 경계가 비었다) 29일 시험을 더하고 다시 돌려 잡힘. **15/15 잡힘.**

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| 상태 파일 통째로 덮어쓰기(합치지 않음) | `backend/app/services/backup.py` | 잡힘 |
| 꺼낸 시각 안 읽음 | `backend/app/services/backup.py` | 잡힘 |
| 못 써도 True | `backend/app/services/backup.py` | 잡힘 |
| attention 30일 → 3일 | `backend/app/services/backup.py` | 살아남음 → 29일 시험 더한 뒤 잡힘 |
| attention 실패 무시 | `backend/app/services/backup.py` | 잡힘 |
| 꺼낸 적 없어도 점 | `backend/app/services/backup.py` | 잡힘 |
| auth status 에 안 실음 | `backend/app/routers/auth.py` | 잡힘 |
| 스크립트: premigrate 도 고름 | `deploy/backup-export.sh` | 잡힘 |
| 스크립트: -T 빼기 | `deploy/backup-export.sh` | 잡힘 |
| 스크립트: 앞의 것 안 비움 | `deploy/backup-export.sh` | 잡힘 |
| 스크립트: 쓰는 중 확인 없음 | `deploy/backup-export.sh` | 잡힘 |
| bat 4벌 → 7벌(방침과 어긋남) | `server-backup-pull.bat` | 잡힘 |
| 화면: 30일 경고 없음 | `frontend/src/components/DiagnosticsModal.tsx` | 잡힘 |
| 화면: 메뉴 점 안 그림 | `frontend/src/components/HeaderMenu.tsx` | 잡힘 |
| 화면: 옛 서버 칸 없음에 줄 | `frontend/src/components/DiagnosticsModal.tsx` | 잡힘 |
