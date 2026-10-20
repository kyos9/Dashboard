# D 뮤테이션 (총괄, 8bc439d)

핵심 줄 13개를 하나씩 바꿔 그 테스트가 잡는지. **13/13 잡힘.** 도구: scratchpad/tools/mutate.py

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| D2 * 경로 빼기 | `frontend/src/App.tsx` | 잡힘 |
| D2 /chart 넘김 빼기 | `frontend/src/App.tsx` | 잡힘 |
| D3 일치 → 일째 | `frontend/src/pages/RebalancePanel.tsx` | 잡힘 |
| D3 보유 모습 빼기 | `frontend/src/pages/RebalancePanel.tsx` | 잡힘 |
| D4 MigrationBackupFailed 안 잡음 | `backend/app/tools/downgrade.py` | 잡힘 |
| D4 갈래 대신 원문 | `backend/app/tools/downgrade.py` | 잡힘 |
| D5 단추 빼기 | `frontend/src/components/NoStocksYet.tsx` | 잡힘 |
| D6 뒤로가기 막지 않음 | `frontend/src/components/StockEditModal.tsx` | 잡힘 |
| D6 onBlocked 부르지 않음 | `frontend/src/lib/backToClose.ts` | 잡힘 |
| D6 취소가 묻지 않음 | `frontend/src/components/StockEditModal.tsx` | 잡힘 |
| D6 실패 줄로 안 옮김 | `frontend/src/components/StockEditModal.tsx` | 잡힘 |
| D6 오류 때도 안내 | `frontend/src/components/StockEditModal.tsx` | 잡힘 |
| D6 확인 창 머무는 단추 말 | `frontend/src/components/ConfirmDialog.tsx` | 잡힘 |
