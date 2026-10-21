# C 뮤테이션 (총괄)

9개. "종가를 아무 날 것으로"가 처음에 살아남아(지표보다 앞선 종가가 있는 날의 시험이 없었다) 그 시험을 더하고 다시 돌려 잡힘. **9/9 잡힘.**

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| 종가를 아무 날 것으로(날짜 확인 없음) | `backend/app/routers/dashboard.py` | 살아남음 → 시험 더한 뒤 잡힘 |
| 종가를 안 넘김 | `backend/app/services/signals.py` | 잡힘 |
| 매도 대신 매수 규칙 | `backend/app/services/signals.py` | 잡힘 |
| 내 기준 무시 | `backend/app/routers/dashboard.py` | 잡힘 |
| 날짜 달라도 보냄 | `backend/app/routers/dashboard.py` | 잡힘 |
| 화면: 꺼진 날도 보임 | `frontend/src/components/BuyConditions.tsx` | 잡힘 |
| 화면: 충족에 초록 | `frontend/src/components/BuyConditions.tsx` | 잡힘 |
| 화면: 폰 높이 안 줄임 | `frontend/src/components/ChartModal.tsx` | 잡힘 |
| 화면: 이름 (참고) 빼기 | `frontend/src/components/BuyConditions.tsx` | 잡힘 |
