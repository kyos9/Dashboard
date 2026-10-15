# A 뮤테이션 결과 (총괄)

핵심 줄 13개를 하나씩 바꿔 관련 테스트를 돌렸다 (`mutate.py`, 저장소 밖). 한 번 돌린 뒤 살아남은 둘을 보고 테스트를 더해 다시 돌렸다.

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| ADX 기준 20→21 | `backend/app/services/signal_rules.py` | 잡힘 |
| 거래량비 > → >= | `backend/app/services/signal_rules.py` | **살아남음** |
| 비교 기간 5→4 | `backend/app/services/signal_rules.py` | 잡힘 |
| OR 묶음: 모두 불가면 거짓 | `backend/app/services/signal_rules.py` | 잡힘 |
| 판정 불가를 참으로 접기 | `backend/app/services/signal_rules.py` | 잡힘 |
| 비교에서 결측 표시 빼기 | `backend/app/services/signal_rules.py` | 잡힘 |
| 묶음 평가: 마지막 행 대신 첫 행 | `backend/app/services/signals.py` | 잡힘 |
| AI 조건 줄 구분자 | `backend/app/services/signal_rules.py` | 잡힘 |
| 지문에서 기준값 빼기 | `backend/app/services/signal_rules.py` | **살아남음** |
| 바뀐 날 표시 31일 | `backend/app/services/signal_rules.py` | 잡힘 |
| 화면: 카드 판 무시(다시 안 받음) | `frontend/src/lib/signalRules.ts` | 잡힘 |
| 화면: buy_conditions 무시 | `frontend/src/lib/signalRules.ts` | 잡힘 |
| 화면: ADX 풀이 기준 고정 20 | `frontend/src/lib/display.ts` | 잡힘 |

## 다시 돌린 것

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| 거래량비 > → >= | `backend/app/services/signal_rules.py` | 잡힘 |
| 지문에서 기준값 빼기 | `backend/app/services/signal_rules.py` | **살아남음** |

- **거래량비 > → >=**: 1.1 경계 테스트가 없었다 → `test_signals.py::test_knee_buy_v2_false_when_vol_ratio_exactly_threshold` 더함 → 잡힘.
- **지문에서 기준값 빼기**: 동등한 변이 — 조건마다의 `logic` 글에 기준값이 이미 들어 있어(`adx > 20.0`) 지문이 그대로 달라진다. 기준값을 따로 넣어 둔 것은 앞으로 `logic` 에 기준값을 빠뜨린 조건이 생겨도 지문이 바뀌게 하려는 안전판이라 그대로 둔다.
