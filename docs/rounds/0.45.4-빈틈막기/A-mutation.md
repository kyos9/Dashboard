# A 뮤테이션 (실행자, 2026-10-29, 커밋 35ecd53 + 시험 보강)

도구: 줄 하나를 바꾸고 그 항목의 시험을 돌린다(`mutate.py`). 바뀐 줄은 시험이 끝나면 되돌린다.

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| A 사용자에게도 주인 틀 | `backend/app/services/ai_portfolio.py` | 잡힘 |
| A 주인에게 중립 틀 | `backend/app/services/ai_portfolio.py` | 잡힘 |
| A 중립 틀 저평가 금지 지움 | `backend/app/services/ai_portfolio.py` | 잡힘 |
| A 중립 틀에 편입 판단 되살림 | `backend/app/services/ai_portfolio.py` | 잡힘 |
| A 종목 분석 문맥에 금액 칸 | `backend/app/services/ai_portfolio.py` | 잡힘 |
| A 진단 review 에 칸 더함 | `backend/app/services/ai_portfolio.py` | 잡힘 |
| A 방침에서 종목 분석 지움 | `frontend/src/pages/Policy.tsx` | 잡힘 |
| A 방침에서 수익률은 안 보낸다 지움 | `frontend/src/pages/Policy.tsx` | 잡힘 |
| A 화면 사용자 글 주인 것으로 | `frontend/src/components/AiPanel.tsx` | 잡힘 |
| A 화면 관리자에게 사용자 글 | `frontend/src/components/AiPanel.tsx` | 잡힘 |
