# 0.45.3 뮤테이션 (총괄)

핵심 줄 16개. 첫 판 15 잡힘·1 살아남음(초과 칩 다시 누르기 — 시험 더함) → 다시 잡힘.

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| A over 거르기 지움 | `frontend/src/pages/Dashboard.tsx` | 잡힘 |
| A 칩 다시 누르면 전체 안 됨 | `frontend/src/pages/Dashboard.tsx` | **살아남음** |
| A aria-pressed 지움 | `frontend/src/pages/Dashboard.tsx` | 잡힘 |
| A 세기가 꺼진 신호도 | `frontend/src/components/weightSignal.ts` | 잡힘 |
| A 아래 칩이 초과를 말하지 않음 | `frontend/src/pages/Dashboard.tsx` | 잡힘 |
| A 아래 칩 켜짐 빠짐 | `frontend/src/pages/Dashboard.tsx` | 잡힘 |
| B 숫자 안 넘김 | `frontend/src/pages/Dashboard.tsx` | 잡힘 |
| B 밴드 뺌 | `frontend/src/pages/Dashboard.tsx` | 잡힘 |
| C 관망 풀이 이음표 | `frontend/src/pages/Dashboard.tsx` | 잡힘 |
| C 칩 풀이 서버 이음표 그대로 | `frontend/src/lib/display.ts` | 잡힘 |
| D 카드도 단추 | `frontend/src/pages/Dashboard.tsx` | 잡힘 |
| D 펼침 안 닫힘 | `frontend/src/components/BuyConditions.tsx` | 잡힘 |
| D 기준일 뺌 | `frontend/src/components/BuyConditions.tsx` | 잡힘 |
| D 풀이 이음표 그대로 | `frontend/src/components/BuyConditions.tsx` | 잡힘 |
| E 가운데 날 안 봄(점 날만) | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| E 매도 표시 뺌 | `frontend/src/components/PriceChart.tsx` | 잡힘 |

## 다시

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| A 칩 다시 누르면 전체 안 됨 | `frontend/src/pages/Dashboard.tsx` | 잡힘 |

## 검토 조건부 (ABCE-review.md · D-review.md)

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| ABCE 넘어오기에서 초과 안 풂 | `frontend/src/pages/Dashboard.tsx` | 잡힘 |
| ABCE 미달에 아래 칩 안 켜짐 | `frontend/src/pages/Dashboard.tsx` | 잡힘 |
| ABCE 밴드 정수로 | `frontend/src/pages/Dashboard.tsx` | 잡힘 |
| D 매도 풀이 안 펼침 | `frontend/src/components/BuyConditions.tsx` | 잡힘 |
| D 날짜 없을 때 막음 지움 | `frontend/src/components/BuyConditions.tsx` | 잡힘 |
| D 월-일 대신 전체 날짜 | `frontend/src/components/BuyConditions.tsx` | 잡힘 |
