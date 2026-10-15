조건부 합격

B 재검토 3차 (d4c221f). 앞 판정의 조건 M5·M6 은 풀렸다. 다만 이번에 내가 새로 만든 뮤테이션 5개 중 2개(N3·N5)가 전체 테스트에서도 살아남았다. 고칠 것은 테스트 두 개다.

## 1. 새 단언 — 통과
- `git diff 172f54a..HEAD -- backend` 에서 B 몫은 테스트 두 파일이다. `schemas.py` 주석 4줄은 A 몫이다.
- `test_signal_recompute.py:306-311`
  - CCC 의 오늘 매도를 뒤집은 뒤 1·3·5년 매도 전−후 차이가 ±1 인지 단언한다(방향은 `flipped_on` 으로 정한다).
- `test_signal_recompute.py:325-334` `test_signal_diff_does_not_count_people_who_are_not_active`
  - 구독이 있는 사용자를 `blocked` 로 바꾼다.
  - `{"users_with_alerts_on": 0, "users": 0, "stocks": []}` 를 단언한다.
- `test_signal_rules.py:176-181`
  - `CHANGES` 의 `what`·`why` 를 금지어로 검사한다.
  - `CHANGES` 에 지금 1건이 있으므로 빈 반복이 아니다.
  - 참고: 금지어 목록에 앞 판정의 grep 목록에 있던 "팔아"가 빠졌다.
- 수정 전 상태에서 세 파일이 `122 passed` 다.

## 2. 뮤테이션 — 실패 (M1~M9 는 모두 잡힘, 새로 만든 것 중 2개 살아남음)
- 명령: `python -m pytest -q tests/test_signal_recompute.py tests/test_signal_rules.py tests/test_push.py`
- 뮤테이션마다 파일을 원래대로 돌려놓았다(`restored True`).

| 뮤테이션 | 결과 |
| --- | --- |
| M1 `_last_true` → `hits.min()` | 잡힘 (every_column_matches…) |
| M2 3·5년 창 → `days=365` | 잡힘 |
| M3 매수 알림 끈 사람도 셈 | 잡힘 (skips_people_who_turned_buy_alerts_off) |
| M4 `today_changed` 에서 매도 무시 | 잡힘 (sees_a_change_in_todays_sell_only) |
| M5 매도 before 를 `_counts(new, …)` 로 | **잡힘** (sees_a_change_in_todays_sell_only) |
| M6 `.filter(User.status == STATUS_ACTIVE)` 삭제 | **잡힘** (does_not_count_people_who_are_not_active) |
| M7 `d > since` → `d >= since` | 잡힘 |
| M8 오늘 매수 before = 새 판정 | 잡힘 (finds_a_new_buy_alert) |
| M9 알림 before = `set()` | 잡힘 |
| N1 `signal_recompute.recompute_all`: 실패가 있어도 지문을 적음 (`if not failed:` → `if True:`) | 잡힘 (a_failed_ticker_keeps_the_old_fingerprint…) |
| N2 `scheduler.py:92` 켠 직후 job 에서 재계산을 따라잡기 갱신 **뒤로** | 잡힘 (startup_job_recomputes_before_catching_up) |
| N4 `with_indicators` 의 `stored_indicator is not None and` 삭제 | 잡힘 (indicator_version_change_recomputes…) |
| **N3** `admin.py:137` `"up_to_date": stored == fingerprint()` → `stored is not None` | **살아남음** — 세 파일 122 passed, 전체 1308 passed |
| **N5** `alerts.pending_changes` (`alerts.py:198`) `if value and value != …` → `if value != …` | **살아남음** — 세 파일 122 passed, 전체 1308 passed |

**N3 이 살아남은 까닭**
- `test_signal_recompute.py:253` 은 지문이 없음(None)일 때만 본다.
- `:258` 은 지문이 같을 때만 본다.
- `test_devtools.py:218,239` 도 True 만 본다.
- 그래서 "옛 지문이 적혀 있는데 지금과 다르다"는 경우가 없다. 그 경우에 진단 화면의 "아직 다시 계산하지 않았습니다"(`DiagnosticsModal.tsx:109`)가 뜨지 않아도 테스트가 모른다.

**N5 가 살아남은 까닭과 영향**
- 실제 문제임을 확인했다. 임시 테스트를 넣었다가 지웠다.
  - 1일차: VOO 매수 켜짐 → 알림 1건.
  - 2일차: VOO 매수 꺼짐.
  - 원본: 2일차 알림 0건 → passed.
  - N5: 2일차에 `{'title': '매수 시그널', 'body': 'VOO'}` 가 한 번 더 간다 → failed.
- 즉 시그널이 **꺼질 때** "매수 시그널" 알림이 가도 지금 테스트는 모른다.
  - `test_a_signal_that_went_off_is_not_told`(`test_push.py:523`) 는 켜진 상태를 저장한 적이 없이 꺼진 것만 본다.
  - 밴드 쪽은 값이 비면 `compose` 가 걸러서 드러나지 않는다.
- `pending_changes` 는 이번 B 커밋(09e1c2b)에서 떼어 냈다. `signal_diff` 의 알림 효과 계산도 이 함수에 기댄다.

## 3. 전체 회귀 — 통과
- `cd backend && python -m pytest -q` → `1308 passed, 3 skipped` (기준 ≥ 1306).

## 조건부 (고쳐야 합격) — 테스트만
1. **N5**: `test_push.py` 에 "알림을 받은 매수 시그널이 다음 날 꺼지면 알림이 0건"인 테스트를 넣는다(위 임시 테스트 모양). 넣은 뒤 N5 가 잡히는지 확인한다.
2. **N3**: `/api/admin/signal-rules` 테스트에서 저장된 지문을 지금과 다른 값으로 적는다(`app_settings.set_value(db, FINGERPRINT_KEY, "old")`). 그때 `up_to_date is False` 인지 단언한다.

## git status
```
HEAD detached at d4c221f
nothing to commit, working tree clean
```
- 임시 테스트 `backend/tests/test_zz_review_tmp.py` 는 지웠다.
- 뮤테이션 스크립트는 저장소 밖 scratchpad 에 있다.
- 가짜 서버는 띄우지 않았다.
