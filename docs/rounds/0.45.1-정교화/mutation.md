# 0.45.1 뮤테이션 (총괄)

도구: `scratchpad/tools/mutate.py`(줄 하나를 바꿔 그 항목의 시험을 돌린다). 30/30 잡힘. 브라우저로도 하나: B1 의 dblClick 구독을 지우고 빌드하면 390 에서 20px 떨어진 빠른 두 번째 탭이 무시된다(2026-03-19 → 2026-03-19), 되돌리면 그 날로(→ 2026-04-15).

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| A1 빼기 판정 지움 | `frontend/src/lib/numberDropped.ts` | 잡힘 |
| A2 음수 칸 맨 앞 빼기도 말함 | `frontend/src/lib/numberDropped.ts` | 잡힘 |
| A3 소수 판정 지움 | `frontend/src/lib/numberDropped.ts` | 잡힘 |
| A4 만억 판정 지움 | `frontend/src/lib/numberDropped.ts` | 잡힘 |
| A5 지금 값 빠짐 | `frontend/src/lib/numberDropped.ts` | 잡힘 |
| A6 다음 글자에 줄 지움(옛 계획) | `frontend/src/components/NumberInput.tsx` | 잡힘 |
| A7 blur 에 안 지움 | `frontend/src/components/NumberInput.tsx` | 잡힘 |
| A8 부모 onBlur 안 부름 | `frontend/src/components/NumberInput.tsx` | 잡힘 |
| A9 음수 칸 − 읽기 지움 | `frontend/src/components/NumberInput.tsx` | 잡힘 |
| A10 label 이름 안 씀 | `frontend/src/components/NumberInput.tsx` | 잡힘 |
| A11 다 지워도 줄 남김 | `frontend/src/components/NumberInput.tsx` | 잡힘 |
| B1 dblClick 구독 지움 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| B1b dblClick 안 풂 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| B2a 없는 티커 판정 지움 | `frontend/src/pages/HistoryChart.tsx` | 잡힘 |
| B2b 대문자 대조 지움 | `frontend/src/pages/HistoryChart.tsx` | 잡힘 |
| B2c 비활성 제외(활성만 대조) | `frontend/src/pages/HistoryChart.tsx` | 잡힘 |
| B2d 목록 전에 부름 | `frontend/src/pages/HistoryChart.tsx` | 잡힘 |
| B2e 0개 안내 받기 전에도 | `frontend/src/pages/HistoryChart.tsx` | 잡힘 |
| C1a 요약에 백업 안 붙임 | `frontend/src/components/DiagnosticsModal.tsx` | 잡힘 |
| C1b 꺼낸 지 30일 판정 빠짐 | `frontend/src/lib/backupWarnings.ts` | 잡힘 |
| C1c 실패 판정 빠짐 | `frontend/src/lib/backupWarnings.ts` | 잡힘 |
| C1d 모달이 백업 판정을 안 넘김 | `frontend/src/components/DiagnosticsModal.tsx` | 잡힘 |
| D1a 모두 다시 받기 보내는 값 | `frontend/src/components/PushModal.tsx` | 잡힘 |
| D1b 단추 기준을 서버 muted 로 | `frontend/src/components/PushModal.tsx` | 잡힘 |
| D2a 실패를 0개로 | `frontend/src/components/PushModal.tsx` | 잡힘 |
| D2b 옛 서버에도 줄 | `frontend/src/components/PushModal.tsx` | 잡힘 |
| C2 꺼짐 갈래 지움 | `deploy/backup-export.sh` | 잡힘 |
| C2b 폴더 없음을 꺼짐으로 | `deploy/backup-export.sh` | 잡힘 |
| D4 받은 글자 되돌려 줌 | `backend/app/routers/push.py` | 잡힘 |
| 데모 --demo-backup-warning 무시 | `backend/devtools/fake_server.py` | 잡힘 |

D3(제목 붙임)은 CSS 라 시험 대신 브라우저(360·390·933×1.5·1400 × 두 테마)로 — 끝까지 내려도 ✕ 가 화면 안이고 눌린다.
