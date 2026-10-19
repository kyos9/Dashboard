# C 뮤테이션 — 작은 고치기 2 (C1 차트 짧은 탭 · C2 422 한국어 · C3 종목 추가 칸)

한 줄씩 바꾸고 그 파일의 테스트를 돌린 뒤 되돌림 (frontend).

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| C2 목록 갈래 빼기 | `frontend/src/api/client.ts` | 잡힘 |
| C2 같은 말 겹침 허용 | `frontend/src/api/client.ts` | 잡힘 |
| C2 칸 이름 대신 첫 loc | `frontend/src/api/client.ts` | 잡힘 |
| C2 은/는 늘 은 | `frontend/src/api/client.ts` | 잡힘 |
| C2 양쪽 범위를 이하로만 | `frontend/src/api/client.ts` | 잡힘 |
| C1 탭에 십자선 안 옮김 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C1 탭에 한 줄 안 바꿈 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C1 떠나도 그 날 유지 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C1 구독 안 풂 | `frontend/src/components/PriceChart.tsx` | 잡힘 |
| C3 고르기 전 미국 단위 | `frontend/src/pages/StockManager.tsx` | 잡힘 |
| C3 구분 회색 지수 | `frontend/src/pages/StockManager.tsx` | 잡힘 |
| C1 종목을 바꿔도 가리킨 날 유지 | `frontend/src/components/PriceChart.tsx` | 잡힘 |

**12/12 잡힘.**

브라우저(빌드 뒤, friend): PC 1400 · 폰 390/360(터치) × 두 테마 — 짧은 탭 두 번이 서로 다른 날로 십자선·한 줄을 옮김, 가로 넘침 0, 콘솔 오류는 검사가 일부러 보낸 422 하나뿐. 360 에서 "모르면 비워두기"가 잘려 "모르면 비움"으로. 실제 422 응답 모양(`loc: [body, rebalance_band_pct]`, `ctx.le: 100.0`)이 해석기와 맞음.

## 사용자 확인 뒤 (`C-user.md` 헤맴 1 — 맨 끝을 눌러도 오늘로 돌아오지 않음)

오른쪽 빈 칸(오늘 ▲ 자리로 비워 둔 `rightOffset`)을 누르면 그 자리에 날이 없어 아무 일이 없었다 → 왼쪽으로 가장 가까운 날(`dataByIndex(…, NearestLeft)`)로.
테스트 하나 더함. 폰 390 터치로 그림 칸 오른쪽 끝에서 3px 안쪽 탭 → 2026-10-19(마지막 날), 8·15·25px 안쪽은 그 날들.

## 검토 뒤 (`C-review.md` 조건부 — 테스트 둘) + 날짜 따라 넘어지던 데모 시험

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| 한 줄 통화를 늘 USD (검토자) | `frontend/src/components/PriceChart.tsx` | 살아남았음 → 원화 종목 테스트 더한 뒤 잡힘 |
| 기술적 원인에 본문 전체 (검토자) | `frontend/src/api/client.ts` | 살아남았음 → detail 을 `toBe` 로 본 뒤 잡힘 |
| 데모 기준을 늘 첫 후보 | `backend/devtools/fake_server.py` | 잡힘 |

검토자가 찾은 `test_devtools::test_demo_custom_thresholds_shows_my_thresholds` 실패(라운드 시작 4844bf0 에서도 같다): 데모 "내 기준"을
ADX 15 로 못 박았는데 TSLA 는 모양을 정하지 않은 종목이라 날짜가 바뀌면 마지막 날이 달라져 2026-10-19 엔 기본과 같았다 →
그날 오늘 매수 수가 달라지는 첫 후보(15·12·17.5·10·25…)를 고른다. 백엔드 1407 passed.
