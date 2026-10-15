조건부 합격

# 0.42.0 A. 시그널 기준 내 설정 — 2차 검토 (커밋 9b09779, 전체 범위 289b097..9b09779, 이번에 고친 것 3e3a3d7..9b09779)

검토자는 이 항목을 처음 보는 새 사람이다. 실행자 보고는 믿지 않고 직접 돌렸다. 저장소 파일은 고치지 않았고 커밋도 하지 않았다.
작업 자리: worktree `.claude/worktrees/agent-a42274acd6e32fcbc` 를 `git checkout --detach 9b09779` 했다. 테스트·뮤테이션·실험은 저장소 밖
`git archive` 사본에서 했다: `r042/rv2/src`(9b09779, 회귀·실험), `r042/rv2/mut`(9b09779, 뮤테이션), `r042/rv2/prev`(3e3a3d7 backend, 비교).

## 1차 조건이 풀렸나

### 조건 1. 아주 큰 정수는 422 — **풀림**
- 고친 곳: `backend/app/schemas.py:206-207`. 이제 `isinstance(value, float)` 일 때만 isfinite 를 본다. 정수는 범위 검사(`:208`)에서 막힌다.
- 가짜 서버(8365, `--demo-custom-thresholds`)에 직접 보냈다(`r042/rv2/live.py`):
  ```
  adx 1e400 int: 422      adx -1e400 int: 422      lookback 1e400: 422
  vol 1e400: 422          disp -1e400: 422          adx float 1e400: 422
  adx 10**20: 422         adx 5000 digits: 400 (JSON 단계에서 거절, 500 아님)
  ok adx 25: 200          ok lookback 10: 200       health after 200
  ```
  서버 로그에서 `traceback|overflow` 는 0건이었다. 그 뒤 DELETE → `custom False`.
- 테스트: `test_huge_whole_numbers_are_refused_not_crashed`(`tests/test_my_signals.py:474`). 실행자의 R9 를 되돌리면 이 테스트가 잡는다.

### 조건 2. 같은 날 값이 고쳐지면 캐시가 새로 센다 — **풀림** (방법이 맞다. 테스트에 빈 곳 하나는 아래 N1)
고친 방법: `my_signals.py:158-178`. 캐시 키에 판정이 읽는 지표 7개(`_JUDGED_FIELDS`, `:35`)의 `SUM` 을 넣었다.
- **읽는 지표가 빠짐없이 들어갔나.** 규칙(`signal_rules.py:248-335`)이 읽는 칸은 minus_di, plus_di, disparity, stddev20, vol_ratio, adx, close, ma50, vol_ma5, vol_ma20 이다. 이 가운데 close·vol_ma5·vol_ma20 은 키에 없다. 그래도 빠지는 경우는 없다.
  - close 가 바뀌면 같은 시세에서 다시 센 ma50·stddev20·disparity 가 따라 바뀐다(`indicators.py:95-108`). 지표는 갱신 때마다 DB 시세 전체에서 다시 센다(`data_ingestion.py:204-221`, `refresh_ticker` `:272-274`).
  - vol_ma5·vol_ma20 이 바뀌면 vol_ratio = vol_ma5/vol_ma20(`indicators.py:104`)이 같이 바뀐다.
- **직접 실험**: `r042/rv2/src/backend/tests/test_zz_review2.py`. 사본에만 둔 파일이다. 실제 갱신 길(`refresh_ticker`)로 FLIP 의 시세만 고쳤다.

  | 고친 것 | 9b09779 | 3e3a3d7(고치기 전) |
  | --- | --- | --- |
  | 마지막 날 종가만 ×1.03 (매수 True→False) | 새로 셈, 새 시세 답과 같음 | **옛 답 그대로**(recomputed False, matches False) |
  | 마지막 날 거래량만 ×5 | 새로 셈 | 옛 답 |
  | 마지막 날 고가·저가만 | 새로 셈 | 옛 답 |
  | 100번째 날 종가 ×1.001 | 새로 셈 | 옛 답 |
  | 같은 시세로 다시 갱신 | **메모리 그대로**(같은 객체) | 같음 |
  | 마지막 행 adx → None, 그다음 7칸 모두 None | 둘 다 새로 셈, 매수·매도 없음 | — |

  출력: 9b09779 `7 passed`, 3e3a3d7 `5 failed, 2 passed`.
- **None 일 때.** SQL SUM 은 NULL 을 건너뛴다. 값↔NULL 로 바뀌면 합이 그 값만큼 움직인다. 칸 전체가 NULL 이면 합이 None 이고, 키에도 None 으로 들어간다(`:172`). 값이 정확히 0 인 칸이 NULL 로 바뀔 때만 합이 같다. 이때는 판정도 거의 같다(0 과 NaN 은 `>`·`<` 비교에서 같은 쪽으로 떨어지는 경우가 대부분이다). 그래서 참고로만 남긴다.
- **Postgres 에서 합이 흔들릴 때.** 칸이 `Float`(double precision, `models.py:174-186`)라서, 행을 읽는 순서나 병렬 집계에 따라 합의 마지막 자리가 바뀔 수 있다. 그래도 키가 달라질 뿐이다. 그러면 `_frames` 로 DB 값을 다시 읽어 판정하므로 **답은 틀리지 않고 다시 세기만 한다.** 틀린 답이 나오려면 다른 데이터가 같은 키를 가져야 하는데, 7개 합이 모두 정확히 같아야 한다. 현실에서는 없다고 본다.
  - 경쟁 상황도 따져 봤다. 키를 읽은 뒤 `_frames` 를 읽기 전에 갱신이 끼면, 새 판정이 옛 키에 담긴다. 다음 요청은 새 키로 다시 센다. 옛 데이터의 답이 새 키에 담기는 순서는 생기지 않는다.
  - CI 9b09779 실행 38648755907 에서 "백엔드 (Postgres)" 가 success 다. 같은 데이터에서 메모리를 다시 쓰는지 보는 테스트(`test_judged_history_is_shared_from_memory_until_prices_change` 등)가 Postgres 에서도 통과했다.
  - 참고: `round(float(v), 9)` 는 합이 1e6 을 넘으면 사실상 아무것도 하지 않는다(해롭지 않다). 반대로 합의 ulp 보다 작은 고침(예: 1.75e8 에서 1e-8)은 합에 묻힌다. 그런 고침이 판정을 바꾸려면 값이 문턱에 딱 걸려 있어야 한다. 참고로만 둔다.
- **기본인 사람의 길·쿼리 수.** `judge` 는 `Source.custom` 일 때만 불린다(`my_signals.py:197-239`). 기본 길은 diff 가 없다. `/api/dashboard` 쿼리 수(같은 실험 파일 `test_query_counts`):
  ```
  9b09779 : default 12 / 12   mine 13 (처음) / 12 (메모리)
  3e3a3d7 : default 12 / 12   mine 13 / 12
  ```
  내 기준 사람이 메모리를 쓸 때 `judge` 시간은 20종목×10년(`r042/bench_key.py`)에서 3e3a3d7 9.9~10.6 ms, 9b09779 25.7~30.5 ms 였다. 뮤테이션을 같이 돌리던 중이라 흔들린다. +100 ms 목표 안이다.

### 조건 3. R2~R7 을 잡는 테스트 — **풀림**
1차 정의(`r042/rv/muts.json`, R1 의 old 는 `key = (t, ticker, last, count, *(` 로 맞춤)를 백엔드 **전체** `pytest -x` 로 돌렸다(`r042/rv/mut.py`, 결과 `r042/rv2/mut.log`). R1~R7 이 모두 잡혔다(아래 표).

## 동작 결함
없음. 1차 결함 둘은 위에서 직접 재현해 보았고, 고쳐진 것을 확인했다.

## 뮤테이션 표 (백엔드 전체 pytest -x, 9b09779 사본)

| 뮤테이션 | 자리 | 결과 |
| --- | --- | --- |
| R1 메모리 키에서 기준 뺌 | `my_signals.py:172` | 잡힘 `test_memory_has_a_size_limit` |
| R2 카드 지표 행 수를 공용 N+1 | `routers/dashboard.py:41` | 잡힘 `test_card_conditions_read_my_lookback_days_back` |
| R3 AI 지시문 N 을 공용 | `ai_analysis.py:419` | 잡힘 `test_ai_names_my_lookback_and_reads_that_many_days_back` |
| R4 사람 판에 ADX 만 | `signal_rules.py:407` | 잡힘 `test_every_single_value_gives_its_own_version` |
| R5 차트 점이 기간 무시 | `my_signals.py:238` | 잡힘 `test_chart_markers_keep_to_the_chosen_range` |
| R6 기본 여부를 ADX 로만 | `signal_rules.py:64` | 잡힘 `test_every_single_value_gives_its_own_version` |
| R7 AI 지표 칸 N 거래일 전 행을 공용 N | `ai_analysis.py:237` | 잡힘 `test_ai_names_…` |
| **N1** 키의 지표 합에서 `vol_ratio` 뺌 | `my_signals.py:35` | **살아남음** |
| N2 키의 지표 합에서 `adx` 뺌 | `my_signals.py:35` | 잡힘 `test_memory_notices_values_fixed_on_the_same_day` |
| N3 알림이 공용 기준으로 | `alerts.py:163` | 잡힘 `test_all_four_paths_follow_my_thresholds[adx15-lookback3]` |
| N4 카드 지표 행 하나 모자람(`limit=N`) | `routers/dashboard.py:41` | 잡힘 `test_all_four_paths…` |
| N5 AI "N일 전" 행을 하나 당김 | `ai_analysis.py:242` | 잡힘 `test_ai_names_…` |
| **N6** 아래 경계 값을 거절(`low < value`) | `schemas.py:208` | **살아남음** |
| N7 마지막 매수일은 늘 공용 | `my_signals.py:212` | 잡힘 `test_all_four_paths…` |
| N8 키의 합을 천 단위로 반올림 | `my_signals.py:172` | 잡힘 `test_memory_notices_…` |

뮤테이션을 끝낸 뒤 `diff -r r042/rv2/mut/backend/app <worktree>/backend/app` 를 보았다. `__pycache__` 말고는 차이가 없다. 모두 되돌렸다.

- **N1 은 동등 변이가 아니다.** 사본에 N1 을 넣고 내 실험을 돌렸다. "거래량만 고침" 이 `recomputed False` 로 옛 판정을 그대로 썼다(`1 failed, 6 passed`). 그 뒤 사본은 원래대로 되돌렸다(worktree 와 `diff` 같음). 거래량만 고쳐지면 바뀌는 지표는 vol_ma5·vol_ma20·vol_ratio 셋뿐이다. 그런데 키에는 vol_ratio 하나만 있다. 지금 코드는 맞다. 다만 `test_memory_notices_values_fixed_on_the_same_day` 는 adx 를 직접 바꾸는 경우만 보아서, 이 칸을 지키지 않는다.
- **N6**: 각 범위의 맨 아래 값(ADX 10, 거래량비 0.5, 이격도 −20, 비교 1일)을 **받는다**는 테스트가 없다. 위쪽 경계는 기본값 PUT(이격도 0)으로 지켜진다. 화면은 `limits.min` 을 그대로 고를 수 있게 내준다. 그래서 서버가 최솟값을 거절하게 바뀌면 사람은 저장 오류를 본다. 지금 코드는 받는다(`<=`).

## 회귀 숫자
- 백엔드 전체: `1359 passed, 3 skipped` (1차 검토 때 1347, 시작 1309. 줄어든 것 없음) — `r042/rv2/pytest.txt`.
- 프런트 vitest: `Test Files 58 passed (58) / Tests 863 passed (863)` (1차 때 825·57 파일).
- `tsc -b`: 종료 0. `npm run lint`(oxlint): 경고 **22** (기준 22 이하).
- CI 9b09779: 테스트 실행 38648755907 — 프런트·백엔드(SQLite)·백엔드(Postgres) 모두 success. Docker 이미지도 success.
- 응답 사진(`tools/snapshot.py`, 포트 8365, `--reset`, 기본인 사람): 시작 `r042/baseline/snap` 과 비교해 **차이 3** 이다. 셋 모두 B9(friend 7203.T 이름 None → トヨタ自動車, B 항목에서 승인한 변경이고 status.md 에 적혀 있다). A 때문에 생긴 차이는 0. B 끝 사진 `r042/snap-B` 와는 **차이 0**.
- API 모양(`tools/apidiff.py` 시작 openapi ↔ 9b09779): `빠짐 0`, `타입 바뀜 0`, `더해짐 9`(PUT·DELETE signal-thresholds, knee_buy_v2_default, SignalRules.defaults·custom·limits, StockOut.shown_name(B), 스키마 둘).
- AI 지시문 상수(`tools/ai_consts.py`): 시작과 다른 것은 `__file__`·`__cached__` 경로뿐이다. 글은 같다.
- 규제 낱말: `git diff 289b097..9b09779 -- frontend/src backend/app` 의 더한 줄에서 `추천|사세요|팔라|팔아|저평가|예측|수익률|순위|공격적|백테스트|매수하세요|매도하세요` 를 찾으니 1건이 나왔다. `Dashboard.tsx:677` "평가금액·수익률이 나오고" 다. 0.41 에도 있던 안내 문장을 B(676051d)가 다듬은 것이고, 내 포트폴리오를 보여 준다는 안내다. 비교·순위·자랑이 아니고 A 범위도 아니다. AI 에 매수·매도를 조언하라는 지시문 변경은 없다(위 상수 같음).

## 가짜 서버 (포트 8365)
`--demo-custom-thresholds` 로 띄웠을 때 주인은 `custom True`, ADX 15, 판 `9831d42750070ae5`, 오늘 매수 5(005930.KS·069500.KS·NVDA·QQQ·TSLA)였다. 1차와 같다.
서버는 PID 6932(python)·6930(감싼 bash)로 껐다. `ps -p` 결과 없음, health `000`.

## 합격 조건 (조건부 목록)
1. **N1**: 거래량만(또는 거래량·종가처럼 시세 한 칸만) 고쳐진 갱신을 `refresh_ticker` 길로 넣고, 내 기준 판정이 새로 세는지 보는 테스트. 지금 테스트는 adx 를 직접 바꾸는 것만 본다.
2. **N6**: 네 칸의 최솟값(10·0.5·−20·1)을 PUT 하면 200 이고 그대로 저장되는지 보는 테스트.
두 가지 다 테스트만 더하면 된다. 동작은 지금도 맞다.

참고(조건 아님):
- 1차의 권함 4(DEPLOY 9-2 의 1) 앞에 `docker compose stop app`)는 아직 반영되지 않았다(`DEPLOY.md:327-329`).
- 합 키의 한계: 0↔NULL 이 바뀌거나 ulp 보다 작은 고침은 키에 안 드러난다. Postgres 에서 합이 흔들리면 다시 세기만 한다(위).

## 끝 상태
- 띄운 가짜 서버는 껐다(위). 잠시 이은 `r042/rv2/src/frontend/node_modules` 심볼릭 링크는 지웠다.
- worktree `git status`:
  ```
  HEAD detached at 9b09779
  nothing to commit, working tree clean
  ```
