# B 뮤테이션 (총괄)

15개. 처음 돌림에서 둘이 살아남음:
- "GET 이 내 목록 밖도 보임" — 저장에 남은 남의(지운) 티커 시험이 없었다 → 시험 더한 뒤 잡힘
- "kinds 만 보내면 prefs 지움"(`if True:`) — 저장된 값을 그대로 다시 쓸 뿐이라 **같은 동작**(동등 뮤테이션). 셈에서 뺀다

**14/14 잡힘(동등 1 제외).**

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| 아침 경계 5→6시 | `backend/app/services/alerts.py` | 잡힘 |
| 받지 않는 때도 보냄 | `backend/app/services/alerts.py` | 잡힘 |
| 받지 않는 때 상태를 적음(버리기) | `backend/app/services/alerts.py` | 잡힘 |
| 끈 종목 안 거름 | `backend/app/services/alerts.py` | 잡힘 |
| 끈 종목의 비중은 거르지 않음 | `backend/app/services/alerts.py` | 잡힘 |
| kinds 만 보내면 prefs 지움 | `backend/app/routers/push.py` | 동등(같은 값을 다시 씀) |
| 남의 종목 끄기 허용 | `backend/app/routers/push.py` | 잡힘 |
| 둘 다 끄기 허용 | `backend/app/routers/push.py` | 잡힘 |
| 기본이면 NULL 안 됨 | `backend/app/routers/push.py` | 잡힘 |
| 지울 때 muted 그대로 | `backend/app/routers/stocks.py` | 잡힘 |
| GET 이 내 목록 밖도 보임 | `backend/app/routers/push.py` | 살아남음 → 시험 더한 뒤 잡힘 |
| 화면: 마지막 하나도 끌 수 있음 | `frontend/src/components/PushModal.tsx` | 잡힘 |
| 화면: 실패해도 안 되돌림 | `frontend/src/components/PushModal.tsx` | 잡힘 |
| 화면: 숨긴 종목도 목록에 | `frontend/src/components/PushModal.tsx` | 잡힘 |
| 화면: 옛 서버에도 받을 때 | `frontend/src/components/PushModal.tsx` | 잡힘 |

## 다시 돌림 (B 검토 불합격 뒤)

검토가 짚은 대로, 처음의 "GET 이 내 목록 밖도 보임 — 시험 더한 뒤 잡힘"은 그 시험이 설정 행 없이 **늘 넘어져서** 잡힌 것이었다(a8dce22 에서
시험을 고침). 고친 시험으로, 그리고 `test_api_slots_and_muted` 를 빼고도 다시 돌려 **잡힘**(`scratchpad/r045/B/mut3.md`·`mut4.md`).
