# 0.45.2 뮤테이션 (총괄)

핵심 줄 41개를 하나씩 되돌려 그 항목의 시험이 잡는지 본다. 도구: `scratchpad/tools/mutate.py`, 목록: `scratchpad/r047/muts.json`.

첫 판: 38 잡힘, 3 살아남음 — 시험을 고쳐 다시(아래 "다시").

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| A1 줄 자리 겹침 판정 지움 | `frontend/src/lib/numberDropped.ts` | 잡힘 |
| A1 머리 아래 무시 | `frontend/src/lib/numberDropped.ts` | 잡힘 |
| A1 팝업 위 무시(머리가 사라졌을 때) | `frontend/src/lib/numberDropped.ts` | 잡힘 |
| A1 아래 끝이 위로 넘침 | `frontend/src/lib/numberDropped.ts` | 잡힘 |
| A1 컴포넌트가 자리 계산 안 씀 | `frontend/src/components/NumberInput.tsx` | 잡힘 |
| A2 빼기 아닐 때도 한 마디 | `frontend/src/lib/numberDropped.ts` | 잡힘 |
| A2 일괄 수정 보유 칸 한 마디 뺌 | `frontend/src/components/StockEditModal.tsx` | 잡힘 |
| A2 거래 수량 '샀다' 조건 뺌 | `frontend/src/pages/RebalancePanel.tsx` | 잡힘 |
| A2 종목 추가 보유 칸 한 마디 뺌 | `frontend/src/pages/StockManager.tsx` | 잡힘 |
| A3 연 동안 합치기 → 마지막 회차만 | `frontend/src/components/StockEditModal.tsx` | 잡힘 |
| A3 ✕ 로 닫을 때 안 알림 | `frontend/src/components/StockEditModal.tsx` | 잡힘 |
| A3 수정 다시 열 때 안 지움 | `frontend/src/pages/StockManager.tsx` | 잡힘 |
| A3 넷부터 '외' | `frontend/src/lib/display.ts` | 잡힘 |
| A4 금액 앞말 뺌 | `frontend/src/pages/RebalancePanel.tsx` | 잡힘 |
| B1 꼬리 경고 모양 뺌 | `frontend/src/components/DiagnosticsModal.tsx` | 잡힘 |
| B3 서버 일수 30 | `backend/app/services/backup.py` | 잡힘 |
| B3 화면 일수 30 | `frontend/src/lib/backupWarnings.ts` | 잡힘 |
| B4 숫자 있으면 점 숨김 | `frontend/src/components/HeaderMenu.tsx` | 잡힘 |
| B5 로그 at 안 붙임 | `backend/app/routers/logs.py` | 잡힘 |
| B5 응답 하나의 오프셋(서머타임 틀림) | `backend/app/routers/logs.py` | 잡힘 |
| B5 느린 요청 시간대 뺌 | `backend/app/slow_requests.py` | 잡힘 |
| B5 화면 로그 at 무시 | `frontend/src/components/DiagnosticsModal.tsx` | 잡힘 |
| B5 다시 계산을 현지로 읽음 | `frontend/src/components/DiagnosticsModal.tsx` | 잡힘 |
| B5 오프셋 부호 반대 | `frontend/src/lib/diagTime.ts` | 잡힘 |
| B5 시간대 없는 값을 늘 UTC | `frontend/src/lib/diagTime.ts` | 잡힘 |
| C1 10px 밀기도 탭 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C1 늦게 떼도 탭 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C1 두 번째 손가락 무시 안 함 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C1 취소 안 받음 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C1 오른쪽 단추도 탭 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C1 축 위도 탭 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C1 setTimeout 없이 | `frontend/src/components/PriceChart.tsx` | **살아남음** |
| C1 탭이 가리킴을 안 지움 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C2 떠나면 마지막 날(고른 날 잊음) | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C2 끝에서 안 끔 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C2 ◀ 가 마지막 날에서 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C3 길게 누른 뒤 밀기도 전체 보기 | `frontend/src/components/PriceChart.tsx` | **살아남음** |
| C3 세로 밀기도 전체 보기 | `frontend/src/components/PriceChart.tsx` | **살아남음** |
| C3 누르면 안 내림 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C3 데이터가 바뀌어도 남음 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C 폰 팝업 높이 되돌림 | `frontend/src/components/ChartModal.tsx` | 잡힘 |

## 다시 (시험 고친 뒤)

- C1 setTimeout: 같은 박자에는 놓지 않는다는 시험이 없었다 → 더함
- C3 둘: 포인터 이벤트를 act 밖에서 보내 그림이 늦어 기대가 늘 맞았다 → act 로 감쌈

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| C1 setTimeout 없이 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C3 길게 누른 뒤 밀기도 전체 보기 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C3 세로 밀기도 전체 보기 | `frontend/src/components/PriceChart.tsx` | 잡힘 |

**결과: 41/41 잡힘.**

## 검토자 B 의 조건부 (B-review.md)

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| B5 오프셋 분 버림 | `frontend/src/lib/diagTime.ts` | 잡힘 |

## 검토자 A 의 조건부 (A-review.md)

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| A1 visualViewport 아래 끝을 offsetTop 없이 | `frontend/src/components/NumberInput.tsx` | 잡힘 |
| A3 대시보드 다시 열 때 안 지움 | `frontend/src/components/PortfolioView.tsx` | 잡힘 |
| A3 저장한 이름 대신 목록 이름 | `frontend/src/components/StockEditModal.tsx` | 잡힘 |

## 검토자 C 의 조건부 (C-review.md)

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| C2 ◀ 가 가리키는 날에서 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C3 마우스에도 240ms | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C1 창에서 놓은 것 안 받음 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C3 전체 보기 뒤 포커스 안 옮김 | `frontend/src/components/PriceChart.tsx` | 잡힘 |

## BC 사용자 확인 뒤 (흉내 마우스·길게 누른 날·데이터 바뀜·풀이 길이·팝업 높이)

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| C 손가락 뒤 흉내 마우스 받음 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C 길게 누른 날 안 남김 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C 데이터 바뀌어도 고른 날 남음 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C 데이터 바뀔 때 십자선 안 지움 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C 고른 뒤 풀이 뺌 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C 폰 팝업 높이 되돌림 | `frontend/src/components/ChartModal.tsx` | 잡힘 |
