합격

B 4차 검토 (34b212d). 3차 판정의 조건 둘(N3·N5)이 풀렸다. 이번에 돌린 뮤테이션 16개(M1~M9, N1~N5, 내가 새로 만든 O1·O2)가 모두 잡혔다. 사용자나 주인이 실제로 틀린 결과를 보게 되는 동작 결함은 찾지 못했다.

## 1. 새 테스트와 단언 — 통과
- `git diff d4c221f..HEAD -- backend` 에서 바뀐 것은 테스트 세 파일뿐이다. 앱 코드는 바뀌지 않았다.
- `tests/test_push.py:530-536` `test_a_told_signal_that_goes_off_the_next_day_is_not_told_again`
  - 1일차: VOO 매수가 켜져 알림이 `["VOO"]` 로 간다.
  - 2일차: `buy=False` 가 되면 알림이 `[]` 다.
  - 3차 판정문의 임시 테스트와 같은 모양이다.
- `tests/test_signal_recompute.py:259-263`
  - 저장된 지문을 `"old-definition"` 으로 적는다.
  - 그때 `up_to_date is False` 이고 `stored_version == "old-definition"` 인지 단언한다.
- `tests/test_signal_rules.py:178` 금지어 목록에 "팔아"가 다시 들어갔다.
- 수정 전 상태에서 세 파일이 `123 passed` 다(3차 때 122 + 1).

## 2. 뮤테이션 — 통과 (16개 모두 잡힘)
- 명령: `python -m pytest -q tests/test_signal_recompute.py tests/test_signal_rules.py tests/test_push.py`
- 뮤테이션마다 파일을 원래대로 돌려놓았다(모두 `restored True`).
- 스크립트: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r4/mut.py`

| 뮤테이션 | 결과 (처음 실패한 테스트) |
| --- | --- |
| M1 `_last_true` → `hits.min()` | 잡힘 (every_column_matches_an_independent_count) |
| M2 `days=365 * years` → `days=365` | 잡힘 (every_column_matches…) |
| M3 매수 알림 끈 사람 거르기 삭제 | 잡힘 (skips_people_who_turned_buy_alerts_off) |
| M4 `today_changed` 에서 매도 무시 | 잡힘 (sees_a_change_in_todays_sell_only) |
| M5 매도 before 를 `_counts(new, …)` 로 | 잡힘 (sees_a_change_in_todays_sell_only) |
| M6 `.filter(User.status == STATUS_ACTIVE)` 삭제 | 잡힘 (does_not_count_people_who_are_not_active) |
| M7 `d > since` → `d >= since` | 잡힘 (every_column_matches…) |
| M8 오늘 매수 before = 새 판정 | 잡힘 (finds_a_new_buy_alert) |
| M9 알림 before = `set()` | 잡힘 (finds_a_new_buy_alert) |
| N1 `if not failed:` → `if True:` (`signal_recompute.py:101`) | 잡힘 (a_failed_ticker_keeps_the_old_fingerprint_so_it_retries) |
| N2 `_startup_refresh_job` 에서 재계산을 따라잡기 갱신 뒤로 (`scheduler.py:92`) | 잡힘 (startup_job_recomputes_before_catching_up) |
| **N3** `"up_to_date": stored is not None` (`admin.py:137`) | **잡힘** (admin_status_shows_the_last_recompute) — 3차에서는 살아남았다 |
| N4 `stored_indicator is not None and` 삭제 (`signal_recompute.py:70`) | 잡힘 (indicator_version_change_recomputes_indicators_too) |
| **N5** `if value != stored.get(…)` (`alerts.py:198`) | **잡힘** (test_push::a_told_signal_that_goes_off_the_next_day_is_not_told_again) — 3차에서는 살아남았다 |
| O1 (내 것) `run_if_changed` 의 reason `first`·`definition_changed` 를 맞바꿈 | 잡힘 (2 failed: first_start_recomputes_once…, changed_definition_rewrites…) |
| O2 (내 것) `signal_diff` 의 `old_today = None` (저장된 오늘 판정을 무시) | 잡힘 (2 failed: every_column_matches…, sees_a_change_in_todays_sell_only) |

동작 결함과 테스트 빈 곳을 따로 보면 다음과 같다.
- 동작 결함: 없다. 이번 커밋은 테스트만 바꿨다. 3차에서 N5 로 보인 동작("꺼질 때 다시 알림")은 원본 코드에서는 일어나지 않는다. 새 테스트가 원본에서 통과하는 것으로 확인했다.
- 테스트 빈 곳: 이번에 살아남은 뮤테이션이 없다.

## 3. 전체 회귀 — 통과
- `cd backend && python -m pytest -q` → `1309 passed, 3 skipped` (기준 ≥ 1309).

## 참고
- 가짜 서버는 띄우지 않았다. 이번 검토는 테스트만 바뀐 커밋이라 화면을 다시 볼 일이 없었다.

## git status
```
HEAD detached at origin/claude/new-session-fftcg1
nothing to commit, working tree clean
```
(HEAD 34b212d)
