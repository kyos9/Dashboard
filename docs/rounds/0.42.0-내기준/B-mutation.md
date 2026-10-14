# B 뮤테이션 — 작은 화면 고치기

도구는 A 와 같다(`tools/mutate.py`). 화면은 orderPlan·PriceChart·display·signalRules·Dashboard·RebalancePanel 테스트, 서버는 test_my_signals·test_signal_rules·test_fundamentals.

## 1차

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| B-M1 오늘 ▲ 안 찍음 | `frontend/src/lib/chartFormat.ts` | 잡힘 |
| B-M2 연속을 거래일 셋까지 | `frontend/src/lib/chartFormat.ts` | 잡힘 |
| B-M3 언어 고정 없음 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| B-M4 가격 소수 늘 둘째 | `frontend/src/lib/chartFormat.ts` | 잡힘 |
| B-M5 눈금 날짜 꼴 | `frontend/src/lib/chartFormat.ts` | 잡힘 |
| B-M6 이격도 칩 초록 고정 | `frontend/src/lib/display.ts` | 잡힘 |
| B-M7 공용 이름 안 씀 | `backend/app/models.py` | 잡힘 |
| B-M8 재무 목록 이름 | `backend/app/services/fundamentals.py` | 잡힘 |
| B-M9 새 돈만 나누기 무시 | `frontend/src/lib/orderPlan.ts` | 잡힘 |
| B-M10 비례 없음 | `frontend/src/lib/orderPlan.ts` | 잡힘 |
| B-M11 새 돈 잡음 기준 없음 | `frontend/src/lib/orderPlan.ts` | **살아남음** |
| B-M12 정수 주 반올림 | `frontend/src/lib/orderPlan.ts` | 잡힘 |
| B-M13 설명 줄 칸 순서 없음 | `frontend/src/lib/signalRules.ts` | 잡힘 |
| B-M14 현금 모자람 무시 | `frontend/src/lib/orderPlan.ts` | **살아남음** |
| B-M15 0종목 안내 옛 글 | `frontend/src/pages/Dashboard.tsx` | 잡힘 |
| B-M16 매도 없음 깨기 | `frontend/src/lib/orderPlan.ts` | 잡힘 |

살아남은 둘(B-M11 잡음 기준, B-M14 현금 모자람)은 같은 테스트 하나가 둘 다 지키는 줄 알았는데, 그 테스트의 B 종목이 목표보다 많아 두 줄이 아무 일도 하지 않았다 → 줄마다 그것에 기대는 경우를 따로 둔 테스트 둘로 바꿨다.

## 2차

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| B-M11 새 돈 잡음 기준 없음 | `frontend/src/lib/orderPlan.ts` | 잡힘 |
| B-M14 현금 모자람 무시 | `frontend/src/lib/orderPlan.ts` | 잡힘 |

## 3차 (브라우저에서 찾은 결함 뒤)

브라우저 확인에서 **동작 결함** 하나: 4.8억 포트폴리오에 새 돈 100만 원으로 '새 돈만 나누기'를 켜면 아무것도 사지 않았다 — 잡음 기준을 전체 자금의 0.5% 로 쟀기 때문(100만 원은 0.2%). 새 돈의 0.5% 로 바꾸고 그 경우를 테스트로 더했다.

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| B-M11 새 돈 잡음 기준 없음 | `frontend/src/lib/orderPlan.ts` | 잡힘 |
