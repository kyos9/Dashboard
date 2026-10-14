합격

# 0.41.0 항목 A 재검토 (두 번째 판정, 처음부터 새로 함)

- 검토한 트리: `origin/claude/new-session-fftcg1` = `d4c221f` (detached). 첫 판정 `A-review.md`의 조건부 두 건이 풀렸는지와, d8343c3 이후 A에 닿은 변경을 봤다.
- 뮤테이션은 모두 sed로 바꾸고 `git checkout -- <파일>`로 되돌렸다. 서버는 snapshot.py가 직접 띄우고 껐다(8198, 8199). 끝난 뒤 `pgrep -af fake_server`에 남은 것은 없다.

## 1. 조건부 두 건 — 새 테스트와 뮤테이션 — 통과
`test_signal_rules.py` 실행 결과는 `26 passed`. 아래 다섯 변이를 넣고 `-k "row_n_trading_days_ago or values_n_trading_days_ago"`로 돌렸다. 다섯 개 모두 잡혔다.

| # | 바꾼 것 | 결과 |
| --- | --- | --- |
| ① (첫 검토자) | `dashboard.py:38` `limit=LOOKBACK_DAYS + 1` → `LOOKBACK_DAYS` | 잡힘 `test_signal_rules.py:304 AssertionError: S00` |
| ② (첫 검토자) | `ai_analysis.py:241` `rows[lookback]` → `rows[lookback - 1]` | 잡힘 `:321` (adx_5d_ago) |
| ③ (내 것) | `ai_analysis.py:237` `limit=lookback + 1` → `lookback` | 잡힘 `:321` |
| ④ (내 것) | `ai_analysis.py:257` `stddev20_5d_ago`가 `latest.stddev20`을 읽게 | 잡힘 `:322` |
| ⑤ (내 것) | `signals.py:65` `buy_conditions_many`의 `size = LOOKBACK_DAYS + 1` → `LOOKBACK_DAYS` | 잡힘 `:304` |

대시보드 테스트가 실제로 무언가를 잡는지도 확인했다. 테스트에 print를 잠시 넣고 돌린 뒤 되돌렸다.
- 출력: `ONLY_BY_SHRINK 7 12`. 12종목 중 7종목은 변동성 조건이 StdDev20이 줄어든 것만으로 참이다(거래량비는 1.1 이하).
- `assert only_by_shrink > 0`이 있어서, 시드가 바뀌어 이런 종목이 사라지면 테스트가 실패한다.

## 2. d8343c3 이후 A에 닿은 변경 — 통과
`git diff d8343c3..HEAD --stat`: 다섯 파일, 75 줄 더하고 8 줄 뺌.
- **schemas.py:155-159** — 주석만 바뀌었다. 기준값을 적은 주석(`> 1.1`, `ADX > 20`, `이격도 < 0`)을 지우고 말로 바꿨다. 필드·타입은 그대로다.
- **display.ts:201 `readAdx`** — `v < 25`를 `v < trend + 5`로 바꿨다.
  - 화면에서 부르는 곳은 `Dashboard.tsx:1031`, `:1301`(`rules.thresholds.adx_trend`)이다. 지금 서버가 보내는 값과 옛 서버용 기본값(`LEGACY_SIGNAL_RULES`)이 모두 20이다. 그래서 경계는 그대로 25이고, 화면은 바뀌지 않는다.
  - 테스트에 세 줄이 더해졌다: `readAdx(24.9)` → 추세 형성, `readAdx(25)` → 추세 강함, `readAdx(27, 25)` → 추세 형성.
  - display.ts:186 주석도 기준값 대신 `disparity_below`를 가리킨다.
- **signal_rules.py:333-334** — 바뀌었다는 안내 끝에 `CHANGES[-1].what`을 붙인다.
  - `CHANGES`는 지금 한 줄(`signal_rules.py:47-53`)이고, `changed_on()`은 줄이 둘 이상일 때만 날짜를 준다.
  - 그래서 지금은 안내가 나오지 않는다. 직접 실행 결과: `changed_on()=None`, `change_notice()=None`, `change_notice(2026-09-17)=None`.
  - 30일 창 테스트는 붙는 말까지 확인한다(`:244` `"... 바뀌었습니다 — ADX 25"`).
- **금지어 테스트** — `test_change_history_words_stay_inside_the_regulatory_line`(`:176`)이 `CHANGES`의 `what`·`why`에 추천·사세요·예측·수익률 같은 말이 없는지 본다. 통과한다.

## 3. 회귀 — 통과
- 백엔드 `python -m pytest -q` → `1308 passed, 3 skipped`. 첫 판정 때는 1301/3이었다. 줄어든 것은 없다.
- 프런트 `npm test -- --run` → `Test Files 55 passed`, `Tests 807 passed`.
- `npx tsc -b` → exit 0.
- `npm run lint` → exit 0, 경고 23, 오류 0. 한도(23 이하) 안이다.
- 응답 사진은 오늘 둘 다 새로 떴다.
  - 시작 커밋 worktree(`scratchpad/base`)는 포트 8198에서 → `revA2/snap-base`
  - d4c221f는 포트 8199에서 → `revA2/snap-head`
  - `snapdiff.py revA2/snap-base revA2/snap-head` → `같음 / 차이 0`(파일 11개)

## 나머지 §3 칸
첫 판정(`A-review.md`)과 같다. 이번 변경은 주석, 화면 경계식(값은 같음), 안내 문구, 테스트뿐이다.
- 격리·마이그레이션·입력 한도: 새로 생긴 것이 없어 해당 없음.
- 호환: API 모양을 바꾸지 않았다. schemas는 주석만 바뀌었다.

## git status
```
HEAD detached at origin/claude/new-session-fftcg1
nothing to commit, working tree clean
```
(HEAD `d4c221f`)
