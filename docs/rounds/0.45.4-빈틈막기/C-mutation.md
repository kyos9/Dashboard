# C 뮤테이션 (실행자, 2026-10-29, 커밋 35ecd53 + 시험 보강)

도구: 줄 하나를 바꾸고 그 항목의 시험을 돌린다(`mutate.py`). 바뀐 줄은 시험이 끝나면 되돌린다.

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| C 유지 줄에도 풀이 | `frontend/src/lib/orderPlan.ts` | 잡힘 |
| C 목표 있는 팔기에도 | `frontend/src/lib/orderPlan.ts` | **살아남음** → 시험 보강 뒤 잡힘 |
| C 하나여도 모은 줄 | `frontend/src/lib/orderPlan.ts` | 잡힘 |
| C 폰 카드 풀이 빠짐 | `frontend/src/pages/RebalancePanel.tsx` | 잡힘 |
| C 경고 목표 있어도 | `frontend/src/pages/StockManager.tsx` | 잡힘 |
| C 경고 닫기 안 됨 | `frontend/src/pages/StockManager.tsx` | 잡힘 |
| C 추가 알림 티커로 | `frontend/src/pages/StockManager.tsx` | 잡힘 |
| C 검색칸 안 비움 | `frontend/src/pages/StockManager.tsx` | 잡힘 |
| C 단추가 쳐 둔 글자 안 씀 | `frontend/src/pages/StockManager.tsx` | 잡힘 |
| C 데모 TSLA 작게 | `backend/devtools/fake_server.py` | 잡힘 |

처음 돌림에서 살아남은 것은 시험을 더해(아래) 다시 돌려 잡혔다.
- `RebalancePanel.test.tsx`: 목표가 있는 팔기(과중)에는 풀이가 없다 — 시험 데이터에 그런 줄이 없었다.
