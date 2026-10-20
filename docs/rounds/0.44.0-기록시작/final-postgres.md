# 라운드 끝 검토 조건 2 — Postgres (총괄이 직접 돌림, 2026-10-20)

검토자는 worktree 격리 때문에 Postgres 를 띄우지 못했다(`final-review.md` 조건 2). 총괄이 머리(e920bb4 의 테스트 포함)에서 돌렸다.
Postgres 16, 127.0.0.1:55441.

| 검사 | 결과 |
| --- | --- |
| 전체 pytest (`TEST_DATABASE_URL=postgresql+psycopg://…`) | **1427 passed, 1 skipped** (6분 14초). SQLite 는 1425 passed, 3 skipped — 합 1428 같음 |
| 0013 → 0014 | 21개 표의 행 수·내용 해시가 그대로, 새 표 `portfolio_value_daily` 하나 |
| 외래키 | `portfolio_value_daily.user_id → users.id`, `ondelete=CASCADE` |
| 0014 → 0013 (`migrate.downgrade_to`) | 백업 `…-premigrate.sql` 이 떠졌고 그 안에 기록 1줄(`COPY public.portfolio_value_daily`). 21개 표가 0013 때와 같다 |
| 다시 0014 | 기록 0줄 — 문서(0014 머리말, DEPLOY 9-2·10)와 같다 |

검사 스크립트: 저장소 밖 `scratchpad/r044/pgmig/run.py` (빈 DB `mig044` 를 만들고 끝에 지운다).
