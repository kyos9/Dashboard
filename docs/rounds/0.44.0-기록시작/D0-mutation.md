# D0 뮤테이션 — 진단에 백업 상태

한 줄씩 바꾸고 테스트를 돌린 뒤 되돌림. 백엔드: `pytest tests/test_backup.py tests/test_devtools.py`, 화면: `vitest DiagnosticsModal.test.tsx`.

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| 실패 사유에 예외 글 그대로 | `backend/app/services/backup.py` | 잡힘 |
| 성공해도 실패 남김 | `backend/app/services/backup.py` | 잡힘 |
| 가장 오래된 것을 마지막으로 | `backend/app/services/backup.py` | 잡힘 |
| UTC 로 안 바꿈 | `backend/app/services/backup.py` | 잡힘 |
| 디스크 찬 갈래 빼기 | `backend/app/services/backup.py` | 잡힘 |
| 데모 백업 안 뜸 | `backend/devtools/fake_server.py` | 잡힘 |
| 멈춤 경고 안 함 | `frontend/src/components/DiagnosticsModal.tsx` | 잡힘 |
| 멈춤 기준 12시간 | `frontend/src/components/DiagnosticsModal.tsx` | 잡힘 |
| 실패 줄 안 보임 | `frontend/src/components/DiagnosticsModal.tsx` | 잡힘 |
| MB 를 KB 로 | `frontend/src/components/DiagnosticsModal.tsx` | 잡힘 |
| 옛 서버에서 넘어짐 | `frontend/src/components/DiagnosticsModal.tsx` | 잡힘 |

**11/11 잡힘.**
