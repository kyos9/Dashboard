# A 뮤테이션 — 시그널 기준 내 설정

도구: 총괄 작업 폴더 `tools/mutate.py` (줄 하나를 바꾸고 테스트를 돌린 뒤 되돌린다). 백엔드 명령: `pytest -x tests/test_my_signals.py tests/test_isolation.py tests/test_migration_0013.py tests/test_signal_recompute.py`, 화면은 줄마다 적힌 vitest 파일.

## 1차 (2a8c379 뒤)

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| M1 카드 오늘 판정을 공용으로 | `backend/app/routers/dashboard.py` | 잡힘 |
| M2 카드 마지막 매수일을 공용으로 | `backend/app/routers/dashboard.py` | 잡힘 |
| M3 차트 점을 공용으로 | `backend/app/routers/history.py` | 잡힘 |
| M4 알림을 공용으로 | `backend/app/services/alerts.py` | 잡힘 |
| M5 리밸런싱 어깨매도를 공용으로 | `backend/app/services/rebalance.py` | **살아남음** |
| M6 AI 분석·정리를 공용으로(종목) | `backend/app/services/ai_analysis.py` | 잡힘 |
| M7 AI 진단을 공용으로 | `backend/app/services/ai_portfolio.py` | 잡힘 |
| M8 종목 사이 빈 행 없음 | `backend/app/services/my_signals.py` | **살아남음** |
| M9 메모리 키에서 날짜·행 수 뺌 | `backend/app/services/my_signals.py` | 잡힘 |
| M10 사람 판을 늘 공용 지문으로 | `backend/app/services/signal_rules.py` | 잡힘 |
| M11 소수 일수 받음 | `backend/app/schemas.py` | **살아남음** |
| M12 바꾼 뒤 조용한 기록 없음 | `backend/app/routers/signal_rules.py` | 잡힘 |
| M13 기본값과 같은 값도 저장 | `backend/app/routers/signal_rules.py` | 잡힘 |
| M14 모르는 리비전에 넘어짐 | `backend/app/migrate.py` | 잡힘 |
| M15 비교 도구가 내 기준인 사람도 셈 | `backend/app/tools/signal_diff.py` | 잡힘 |
| M16 단위 확인 없음 | `backend/app/schemas.py` | 잡힘 |
| M17 저장된 값 범위 확인 없음 | `backend/app/services/signal_rules.py` | 잡힘 |
| F1 옛 서버에도 기준 버튼 | `frontend/src/lib/signalRules.ts` | 잡힘 |
| F2 같을 때도 '기본 기준이면 N개' | `frontend/src/pages/Dashboard.tsx` | 잡힘 |
| F3 저장 뒤 규칙 바로 안 바꿈 | `frontend/src/components/SignalThresholdsModal.tsx` | 잡힘 |
| F4 범위 확인 없음 | `frontend/src/components/SignalThresholdsModal.tsx` | 잡힘 |
| F5 차트 범례 내 기준 없음 | `frontend/src/components/PriceChart.tsx` | 잡힘 |

살아남은 셋:

- **M5** (리밸런싱 어깨매도를 공용으로): 시험 데이터의 이번 분기에 두 기준의 어깨매도가 같았다 → 날짜가 정해진 시세(2026년 2분기, 기본=없음·내 기준=있음)로 `test_this_periods_shoulder_follows_my_thresholds` 를 더함.
- **M8** (종목 사이 빈 행 없음): 비교 기간 20 으로 이어 판정 = 따로 판정 테스트(`test_judging_many_tickers_together_is_the_same_as_one_by_one`)를 더했지만 그래도 산다. **동등 변이**다 — 앞 종목의 행을 읽는 것은 각 종목의 첫 N(≤20) 행뿐인데, 그 행들은 ADX 가 아직 없어(Wilder 14×2 ≈ 27행) 매수·매도 판정이 늘 거짓이다. 빈 행은 지표 정의가 바뀌어도 새지 않게 두는 방어로 남긴다.
- **M11** (소수 일수 받음): 일수의 단위가 1 이라 단위 확인이 이미 2.5일을 거른다 — 같은 일을 하는 줄이라 지웠다.

## 2차

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| M5 리밸런싱 어깨매도를 공용으로 | `backend/app/services/rebalance.py` | 잡힘 |
| M8 종목 사이 빈 행 없음 | `backend/app/services/my_signals.py` | **살아남음** |
