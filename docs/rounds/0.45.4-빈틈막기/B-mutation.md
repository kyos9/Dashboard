# B 뮤테이션 (실행자, 2026-10-29, 커밋 35ecd53 + 시험 보강)

도구: 줄 하나를 바꾸고 그 항목의 시험을 돌린다(`mutate.py`). 바뀐 줄은 시험이 끝나면 되돌린다.

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| B nosniff 빠짐 | `backend/app/security_headers.py` | 잡힘 |
| B frame-ancestors 빠짐 | `backend/app/security_headers.py` | 잡힘 |
| B HSTS 늘 붙음 | `backend/app/security_headers.py` | 잡힘 |
| B 스위치가 헤더 다 뺌 | `backend/app/security_headers.py` | 잡힘 |
| B 해시 mtime 안 봄 | `backend/app/security_headers.py` | 잡힘 |
| B 길이 없는 본문 안 셈 | `backend/app/security_headers.py` | 잡힘 |
| B 문서 화면 다시 엶 | `backend/app/main.py` | 잡힘 |
| B 이름 한도 빠짐 | `backend/app/schemas.py` | **살아남음** → 시험 보강 뒤 잡힘 |
| B 순서 한도 30 | `backend/app/schemas.py` | 잡힘 |
| B logout-all epoch 안 올림 | `backend/app/routers/auth.py` | 잡힘 |
| B logout-all 구독 안 지움 | `backend/app/routers/auth.py` | 잡힘 |
| B logout-all 구글 아니어도 | `backend/app/routers/auth.py` | 잡힘 |
| B 화면 이 기기 AI 키 안 지움 | `frontend/src/components/AuthGate.tsx` | 잡힘 |
| B 화면 승인 대기에게도 보임 | `frontend/src/components/AppHeader.tsx` | 잡힘 |
| B 409 한도도 바꿈 | `frontend/src/pages/StockManager.tsx` | 잡힘 |

처음 돌림에서 살아남은 것은 시험을 더해(아래) 다시 돌려 잡혔다.
- `test_input_limits.py`: 추가(POST)할 때 이름·구분 한도 — 고칠 때(PUT)만 보고 있었다.

## 끝 검토 뒤 (final-review.md 조건 1)

끝 검토의 직접 뮤테이션에서 살아남은 넷과 새 고침 하나를 시험을 더한 뒤 다시 돌렸다.

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| F5 순서 한도 50 | `backend/app/schemas.py` | 잡힘 |
| F8 이름 한도 100 | `backend/app/schemas.py` | 잡힘 |
| F9 티커 한도 16 | `backend/app/schemas.py` | 잡힘 |
| F6 이 종목 자신은 빼고 지움 | `backend/app/services/ai_portfolio.py` | 잡힘 |
| 405 영어 그대로 | `frontend/src/components/AppHeader.tsx` | 잡힘 |

## 끝 검토 다시 뒤 (final-review2.md 조건 1~3)

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| N4 실패 뒤 단추 막힘 | `frontend/src/components/AppHeader.tsx` | 잡힘 |
| N2 404 갈래 빠짐 | `frontend/src/components/AppHeader.tsx` | 잡힘 |
| N7 티커 한도 1000 | `backend/app/schemas.py` | 잡힘 |
