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

## 검토 뒤 (`D0-review.md` 조건부 — 계획의 반영 둘 · 살아남은 셋)

- 계획(`plan.md` 5절)이 "반영"이라 한 두 가지를 빠뜨렸다: 업그레이드 직전 백업(`premigrate`)을 매일 백업과 나눠 보이기,
  마지막 실패를 백업 폴더의 `backup-status.json` 에(메모리가 아니라 — 다시 켜도, 다른 워커도). 둘 다 넣었다.
- 시간대 실수를 못 잡던 것: 테스트 환경이 UTC 였다 → 서버는 `TZ=Asia/Seoul`, 화면은 `vi.stubEnv('TZ', 'Asia/Seoul')` 로 본다.

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| 서버 시각에 UTC 꼬리표만 (검토자) | `backend/app/services/backup.py` | 잡힘 |
| 화면 시각을 UTC 로 (검토자) | `frontend/src/components/DiagnosticsModal.tsx` | 잡힘 |
| 멈춤이면 실패 줄 숨김 (검토자) | `frontend/src/components/DiagnosticsModal.tsx` | 잡힘 |
| 업그레이드 백업도 마지막으로 | `backend/app/services/backup.py` | 잡힘 |
| 업그레이드 백업 안 셈 | `backend/app/services/backup.py` | 잡힘 |
| 실패를 파일에 안 씀 | `backend/app/services/backup.py` | 잡힘 |
| 성공해도 실패 남김 | `backend/app/services/backup.py` | 잡힘 |
| 망가진 파일을 그대로 | `backend/app/services/backup.py` | 잡힘 |
| 업그레이드 줄 안 보임 | `frontend/src/components/DiagnosticsModal.tsx` | 잡힘 |

**9/9 잡힘** (검토자의 셋 포함). 백엔드 1411 passed, 프런트 910 passed, lint 22, tsc 통과.
(검토자 메모: 처음 표의 "옛 서버에서 넘어짐" 줄은 Date.now 를 옮긴 뒤 글이 코드와 맞지 않는다 — 검토자가 손으로 돌려 잡힘.)
