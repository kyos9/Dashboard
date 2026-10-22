# A — 숫자 칸 26곳 (0.45.1)

`grep -rn "<NumberInput" frontend/src --include=*.tsx | grep -v test` (2026-10-22, 초안의 "31곳"은 테스트 줄까지 센 것). 칸 이름은 줄에 붙는 이름(aria-label, 없으면 `<label for>`).

| 파일:줄 | 칸 이름 | 소수 | 음수 | 화면에 닿는 길 |
| --- | --- | --- | --- | --- |
| components/StockEditModal.tsx:339 | `<종목> 목표 비중` | O | X | 종목 관리 → 일괄 수정 |
| components/StockEditModal.tsx:346 | `<종목> 밴드 임계값` | O | X | 종목 관리 → 일괄 수정 |
| components/StockEditModal.tsx:353 | `<종목> 보유수량` | O | X | 종목 관리 → 일괄 수정 |
| components/StockEditModal.tsx:361 | `<종목> 평단가` | O | X | 종목 관리 → 일괄 수정 |
| components/StockEditModal.tsx:368 | `<종목> 산 환율` | O | X | 종목 관리 → 일괄 수정(외화 종목) |
| components/SignalThresholdsModal.tsx:173 | 기준 이름(`<label for>`) | 칸마다(N거래일 X) | 칸마다(하나 O) | 대시보드 → 시그널 기준 |
| pages/MacroPanel.tsx:196 | `<지표> 예상치` | O | **O** | 매크로 → 예상치 |
| pages/Dashboard.tsx:1399 | `<종목> 목표 비중` | O | X | 대시보드 → 비중 편집 |
| pages/Dashboard.tsx:1409 | `<종목> 밴드 임계값` | O | X | 대시보드 → 비중 편집 |
| pages/StockManager.tsx:405 | 목표 비중 (%) | O | X | 종목 관리 → 종목 추가 |
| pages/StockManager.tsx:414 | 보유 수량 | O | X | 종목 관리 → 종목 추가 |
| pages/StockManager.tsx:424 | 평단가 | O | X | 종목 관리 → 종목 추가 |
| pages/StockManager.tsx:436 | 산 환율 | O | X | 종목 관리 → 종목 추가(외화) |
| pages/RebalancePanel.tsx:194 | `<종목> 거래 수량` | O | X | 리밸런싱 → 거래 입력 |
| pages/RebalancePanel.tsx:208 | `<종목> 거래 가격` | O | X | 리밸런싱 → 거래 입력 |
| pages/RebalancePanel.tsx:221 | `<종목> 거래 환율` | O | X | 리밸런싱 → 거래 입력(외화) |
| pages/RebalancePanel.tsx:279 | `<종목> 보유수량` | O | X | 리밸런싱 → 표 편집 |
| pages/RebalancePanel.tsx:283 | `<종목> 평단가` | O | X | 리밸런싱 → 표 편집 |
| pages/RebalancePanel.tsx:296 | `<종목> 산 환율` | O | X | 리밸런싱 → 표 편집 |
| pages/RebalancePanel.tsx:307 | `<종목> 목표 비중` | O | X | 리밸런싱 → 표 편집 |
| pages/RebalancePanel.tsx:313 | `<종목> 밴드` | O | X | 리밸런싱 → 표 편집 |
| pages/RebalancePanel.tsx:472 | `<통화> 현금` | USD 만 | X | 리밸런싱 → 현금 |
| pages/RebalancePanel.tsx:483 | 현금 목표 비중 | O | X | 리밸런싱 → 현금 |
| pages/RebalancePanel.tsx:1186 | 이번에 새로 넣을 돈 (선택) | 기준 통화 USD 만 | X | 리밸런싱 → 주문 가이드 |
| pages/RebalancePanel.tsx:1652 | `원/<통화>` 환율 | O | X | 리밸런싱 → 환율 |
| pages/RebalancePanel.tsx:1713 | 전역 기본 밴드 | O | X | 리밸런싱 → 밴드 |

모든 칸이 같은 부품(`NumberInput`)이라 줄의 동작은 하나다 — 칸마다 다른 것은 소수·음수 두 값과 이름뿐이다. 시험은 부품에서, 화면은 길마다 대표로 본다.
- 소수 X 칸(3): 시그널 기준 N거래일 · 원화 현금 · 원화 새로 넣을 돈 — "7.5" → 줄 "소수점…" · 지금 값 75
- 음수 O 칸(2): 물가 예상치 · 시그널 기준 하나 — "-0.2"·"−0.2" 에 줄 없음, 값 -0.2. "0.2-" 에 줄
- 나머지(21): "-3" → 줄 "빼기…" · 지금 값 3. 어느 칸이든 "100만" → 줄 "‘만·억’…" · 지금 값 100
