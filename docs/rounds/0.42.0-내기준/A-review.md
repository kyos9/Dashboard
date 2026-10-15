조건부 합격

# 0.42.0 A. 시그널 기준 내 설정 — 검토 (커밋 5edbf2d, 범위 289b097..5edbf2d)

검토자(새 눈). 실행자 보고는 믿지 않고 직접 돌렸다. 저장소 파일은 고치지 않았고 커밋도 하지 않았다.

**작업 자리**: 처음 받은 worktree(`.claude/worktrees/agent-a1a50ecbdb8fa47c3`)가 검토 도중 환경에서 지워졌다(첫 pytest 가 "FileNotFound" 20 실패·38 오류로 끝났는데, 결과가 아니라 그 탓이다. 이 실행은 버렸다). 그 뒤로는 `git archive 5edbf2d` 를 저장소 밖에 풀어서 썼다:
`r042/rv/src`(5edbf2d, 뮤테이션 확인용으로 `git init` 함), `r042/rv/src2`(5edbf2d backend, 읽기 전용 실험), `r042/rv/base`(289b097). 프런트는 `src/frontend/node_modules` → 본 저장소 node_modules 심볼릭 링크를 썼다.

## 동작 결함 (고칠 것 — 합격 조건)

1. **아주 큰 정수에 500 (422 가 아니다).** `PUT /api/signal-thresholds {"adx_trend": 10**400}` (그리고 `-10**400`) → **500**. 그 뒤 keep-alive 연결이 끊긴다. 원인 `backend/app/schemas.py:204` `math.isfinite(value)` 가 1e308 을 넘는 int 에서 `OverflowError: int too large to convert to float` 를 낸다(서버 로그로 확인). `10**20`·`10**30` 은 422 다. 범위 검사를 isfinite 앞으로 옮기거나, 실수로 바꿀 때 나는 OverflowError 를 잡아 422 로 돌리면 된다. 테스트도 하나 더한다.
2. **메모리 판정이 "같은 날짜의 값 고침"을 모른다.** 캐시 키가 `(기준, 종목, 마지막 지표 날짜, 행 수)` 다(`backend/app/services/my_signals.py:163`). 그런데 갱신은 이미 있는 행도 그 자리에서 고친다. 시세는 `data_ingestion.py:175`, 지표는 `:206` 이후에서 고치고, 매번 2년치를 다시 받는다(`:259`). 제공자가 값을 고치거나 분할을 다시 맞췄는데 새 거래일 행이 없으면(휴장일 갱신 등), 공용 `signal_daily` 는 새 값이 되지만 내 기준인 사람은 다음 거래일 행이 생길 때까지(또는 프로세스를 다시 켤 때까지) 옛 판정을 본다. 직접 재현했다(가짜 DB 복사본, ADX 15, TSLA):
   ```
   custom today before True
   after last-row adx corrected to 1.0 (same date,count): custom today True   ← 옛 값
   after cache clear False
   ```
   고치는 법(제안): `refresh_ticker`/재계산이 끝날 때 그 종목의 캐시를 지우거나, 키에 "데이터 판"(예: 그 종목 지표의 갱신 시각·마지막 몇 행의 해시)을 넣는다. 이 경우를 잡는 테스트가 없다(`test_judged_history_is_shared_from_memory_until_prices_change` 는 행이 늘어나는 경우만 본다).

## 테스트 빈 곳 (지금 동작은 맞다 — 내가 독립 계산으로 확인했다. 그런데 테스트가 지키지 않는다)

직접 만든 뮤테이션 7개 가운데 **6개가 살아남았다.** 명령: `python -m pytest -x -q`(백엔드 전체), `r042/rv/mut.py`, 결과는 `r042/rv/mut.log`.

| 뮤테이션 | 자리 | 결과 | 뜻 |
| --- | --- | --- | --- |
| R1 캐시 키에서 기준 `t` 를 뺌 | `my_signals.py:163` | 잡힘 (`test_memory_has_a_size_limit`) | |
| R2 카드 지표 행 수를 공용 `LOOKBACK_DAYS+1` 로 | `routers/dashboard.py:41` | **살아남음** | 비교 기간이 5보다 큰 사람이면 조건 ✓ 의 "변동성"이 판정 불가가 되고 knee_buy_v2 와 어긋난다 |
| R3 AI 지시문 "N거래일 전" 글자를 공용 N 으로 | `ai_analysis.py:419` | **살아남음** | AI 에 "(5거래일 전 …)"이라고 틀린 이름표가 간다 |
| R4 사람 판(`rules_version`)에 ADX 만 넣음 | `signal_rules.py:406` | **살아남음** | ADX 는 같고 다른 값만 바꾸면 다른 기기 화면이 규칙을 다시 받지 않는다 |
| R5 차트 점이 기간(`since`)을 무시 | `my_signals.py:222` | **살아남음** | 1년 차트에 10년치 점이 실린다 |
| R6 `is_default` 를 ADX 만으로 판단 | `signal_rules.py:64` | **살아남음** | 비교 기간·거래량비·이격도**만** 바꾼 사람이 모든 자리에서 공용 판정을 본다 — 이 기능의 3/4 가 테스트 밖이다 |
| R7 AI 지표 칸 "N일 전 값"을 공용 N 행에서 | `ai_analysis.py:237` | **살아남음** | AI 에 엉뚱한 날의 ADX·표준편차가 간다 |

원인은 하나다. 백엔드 테스트의 "내 기준"이 거의 `MINE = Thresholds(adx_trend=15.0, lookback_days=3)` 한 벌뿐이다(`tests/test_my_signals.py:29`). ADX 가 늘 같이 바뀌고, 비교 기간은 늘 5보다 작다. 계획 검토(plan-review 제안)와 plan.md:21 "경계값으로 네 길을 한 테스트에서 — 반영"은 **반만 반영됐다**: 거래량비·이격도 경계값, 값 하나만 바꾼 사람, N > 5 인 경우를 보는 테스트가 없다.
합격 조건: R2~R7 을 잡는 테스트(값 하나만 바꾼 사람 셋, lookback 10 이상, AI 지시문의 숫자와 값, `range=1y` 차트 점, 판이 값마다 다름).

실행자 뮤테이션(A-mutation.md): 22개 + 2차. M8(종목 사이 빈 행)은 동등 변이라는 설명이 맞다. 앞 종목 행을 읽는 것은 첫 N(≤20) 행뿐인데, 그 행들은 ADX 가 아직 없다(약 27행 필요). 그래서 매수·매도가 늘 거짓이다. 받아들인다. M11 을 지운 것도 맞다(단위 1 이 소수를 거른다).

## §3 검사 표

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 완료 조건 | **조건부** | 아래 "완료 조건" 절. 1·2·3·4·6·7·8·9 통과. 5(입력 한도)는 결함 1. 10(성능)은 통과(참고 있음) |
| 계획 때 걱정 | **조건부** | 막음 2건은 실제로 반영됐다(아래 절). "반영"이라 한 것 가운데 경계값 네 길 테스트는 반만 됐다. 마지막 매수일 "최근 1년부터 거꾸로"는 하지 않았다(대신 전체 판정 + 캐시) — 참고 |
| 회귀 | 통과 | pytest `1347 passed, 3 skipped`(시작 1309), vitest `57 files, 825 passed`(시작 807), oxlint 경고 23(시작 23), `npm run build`(tsc -b 포함) 통과, 첫 화면 `index-*.js gzip 110.09 kB`(시작 109.79). 응답 사진: `snapshot.py rv/snap 8361` → `snapdiff.py` "차이 0". **날짜도 빼지 않는** 엄한 비교(`rv/strict.py`, 같은 날 뜸): `diffs 0`, 새 필드는 `DashboardCard.knee_buy_v2_default`(기본인 사람은 null)뿐. AI 지시문 상수(`ai_consts.py`): `__file__`·`__cached__` 경로 말고 같음. 기본인 사람의 AI 보내는 내용 19경로 × owner·friend(`/api/ai/*/context`): 289b097 와 5edbf2d 가 `diffs 0`. `/api/signal-rules` payload: version·thresholds·rules·changes 같음(`faa56cf123c6edfa` = 공용 지문), 더해진 것 `custom, defaults, limits` |
| 격리 | 통과 | `test_isolation.py:101-103` `(MINE, USER)` 셋, CHECKS `:868-870`, A→B 안 보임 `:658-666`. 직접: 주인 ADX 15(custom True, 판 `9831d42750070ae5`)일 때 지인은 custom False·판 `faa56cf123c6edfa`·ADX > 20. 손님 PUT 401·GET 401, 승인 대기 PUT 401. 주인 전용 동작은 없다(403 해당 없음) |
| 마이그레이션 | 통과 | SQLite: `test_migration_0013.py` 4개 통과. 직접 버전을 건넜다(가짜 DB 복사본, 0013, 사람 4·보유 18·signal_daily 18720): 옛 코드 289b097 의 `init_db` → `ResolutionError: No such revision or branch '0013'`(막음 확인) → 새 코드 `python -m app.tools.downgrade 0012` → `DB 스키마: 0013 → 0012 rc=0` → 옛 코드 `init_db` 성공, rev 0012, 사람 4·보유 18·signal 18720 그대로 → 새 코드로 다시 올림 → 0013, `signal_thresholds` 모두 None. Postgres: 이 컨테이너에는 서버도 psycopg 도 없다. 그래서 CI 를 본다: 5edbf2d 실행 38536196360 "백엔드 (Postgres) success"(at_0004 는 `TEST_DATABASE_URL` 이 있으면 Postgres 를 쓴다, `tests/dbsetup.py:49`). 되돌릴 수 없는 0005·0006 을 건너면 도구가 거절한다(테스트 있음) |
| 호환 | 통과 | `apidiff.py`: `빠짐 0`, `타입 바뀜 0`, `더해짐 8`(PUT·DELETE, knee_buy_v2_default, defaults·custom·limits, 스키마 둘). 새 화면 ↔ 0.40(404)·0.41(`custom` 없음): `canCustomize`(`lib/signalRules.ts`)와 `Dashboard.test.tsx:776,872,882` 통과. 옛 0.41 화면 ↔ 새 서버: 카드 판과 `/api/signal-rules` 판이 같은 `rules_version(t)` 라 다시 받기가 반복되지 않는다. 요청 쪽은 바뀐 필드가 없다 |
| 입력 한도 | **실패** | 422 로 잘 막는 것: 9.5·40.5·25.3·"25"·true(adx, 일수)·2.5일·0·21·1.12·0.5·−20.5·모르는 키·목록·객체·배열 본문·NaN·Infinity·−Infinity·1e999·깨진 JSON·10**20·10**30. 받는 것: 10·40·3.0·0.55·−20·20·1.0일·1.15·2.95. 넷 다 기본값이면 custom False, `{}` → 기본, DELETE → 기본. **10**400 → 500(결함 1).** 참고: 본문 크기 제한은 앱 어디에도 없다. 5 MB 본문 → 422 인데, 오류 응답이 입력을 그대로 되돌려 응답도 5,000,108 바이트다(원래 있던 앱 전체 문제. plan.md:18 "스키마가 막는다"는 파싱 비용까지 막지는 않는다) |
| 뮤테이션 | **실패** | 직접 7개 중 6개 살아남음(위 표). 뮤테이션 뒤 `rv/src` 의 `git status --short` 는 빈 줄 — 모두 되돌렸다 |
| 비밀 | 해당 없음 | AI 키 흐름이 바뀌지 않았다: `git diff --stat 289b097..5edbf2d -- backend/app/services/providers backend/app/routers/ai.py frontend/src/lib/aiKey* frontend/src/components/AiKeyModal.tsx` 빈 출력. 새로 AI 로 가는 것은 기준 숫자뿐이다(지시문 글자) |
| 규제 | 통과 | 바뀐 화면·서버 줄(`git diff … -- frontend/src backend/app | grep '^+'`)에서 `추천|사세요|팔라|팔아|저평가|예측|수익률|공격적|백테스트` 0건. 프리셋 이름·수익률 표시 없음. 기획의 "규제 영향 없음"과 맞다 |
| 데이터 경계 | 통과 | 새 칸 `user_settings.signal_thresholds` 하나(사용자별, NULL=기본). 공용 표는 쓰지 않는다: 여러 번 PUT 한 뒤에도 독립 오라클(`rv/oracle.py`, 내가 짠 판정) 대 `signal_daily` 가 `rows 18720 mismatch 0` 이다. `fingerprint()`·재계산·`admin.py:135` 는 공용 그대로 |
| 외부 호출 | 통과 | `my_signals` 는 DB 읽기와 numpy 계산뿐이다. 더한 줄에 `requests|httpx|urlopen|fetch_` 0건 |
| 화면 | 통과 (참고) | 직접 Playwright(`rv/audit.js`): owner(내 기준)·friend(기본)·new(0종목) × 1400·390·360 × 어둠·밝음 = 18판. 가로 넘침 0, 콘솔 오류 0. 팝업 입력 넷. 폰에서 버튼 44px, 팝업 안 44px 미만 0(PC 의 ✕ 만). Esc 로 닫힌다. friend 는 `.mine-note` 없음, new 는 버튼 없음. 참고: 팝업을 열어도 포커스가 안으로 들어가지 않고 갇히지도 않는다. 주인 PC 에서 Tab 12번이 모두 뒤 화면에 머물렀다. 다른 팝업(AiKeyModal 등)도 같아서 원래 있던 방식이다. 스크린숏 `rv/shots/` |
| 성능 | 통과 (이유 있음) | 같은 순간 번갈아 쟀다(20종목×10년, `tools/perf_dashboard2.py`=289b097, `tools/perf_custom.py`=5edbf2d). 기본 길: 시작 57.0/71.5 ms q12 ↔ 지금 55.9~68.7 ms **q12**(같음). 내 기준 처음 한 번 789~1015 ms q13(목표 1 s — 6번 가운데 2번이 1012·1015 ms 로 살짝 넘음. 흔들리는 컨테이너라 참고). 그다음 88~108 ms(기본 + 30~45 ms, 목표 +100 ms 안) |
| 가짜 서버 | 통과 | `--demo-custom-thresholds`(주인 ADX 15). 띄워 보니 주인 오늘 매수 5(QQQ·NVDA·TSLA·005930·069500), 기본이면 4. 지인은 기본. `test_devtools.py::test_demo_custom_thresholds_shows_my_thresholds` 는 전체 실행에서 통과. 초안(plan-draft:234)의 "friend 에 25"와 다르다. friend 로는 매수 수가 바뀌지 않는다는 이유가 `fake_server.py:724-726` 에 적혀 있다 — 받아들인다 |
| 문서 | 통과 (참고) | 명세 12장, README(화면·가짜 서버), DEPLOY 8 주의 + 9-2, Policy "내가 입력한 것"과 AI 단락. 참고 ① DEPLOY 9-2 는 새 이미지가 **떠 있는 채로** `run --rm … downgrade 0012` 를 한다. 그 사이 떠 있는 앱은 없어진 칸을 읽어 오류가 나고, 2) 전에 앱이 다시 켜지면 0013 이 다시 올라간다. 1) 앞에 `docker compose stop app` 한 줄을 권한다. ② Policy 는 여전히 "그 종목의 **공용** 데이터(…시그널…)"라고 쓰고 뒤에 한 문장을 덧붙였다 — 뜻은 맞지만 plan-review 걱정 3(b)의 "공용이 틀린 말"은 반쯤 남았다. ③ version.py·ROADMAP 은 이 범위(A)에 없다(뒤 커밋 721b4fd 에서 다룸 — 이번 검토 밖) |

## 완료 조건 (plan-draft A 1~10 + plan.md 더한 것)

1. 기본 사용자 응답 사진 같음·AI 지시문 상수 같음 — **통과** (회귀 칸).
2. 바꾼 사람의 카드·조건·마지막 매수일·차트 점·알림·리밸런싱이 독립 계산과 같음 — **통과**. 내가 짠 오라클(`rv/oracle.py`)로 먼저 기본값에서 `signal_daily` 18720행과 0 차이임을 확인했다. 그다음 세 기준으로 API 와 맞췄다: 주인 `{22.5, 1.3, −1.5, 3}`(기본과 다른 날 1952), 주인 `{ADX 15}`(1048), 지인 `{거래량비 0.8, 비교 12}`(829). 15·15·4 종목 모두 오늘 매수·매도, `last_buy_signal_date`, `knee_buy_v2_default`, `range=max` 차트 점 전부, 리밸런싱 `shoulder_signal_fired_in_period`(이번 분기, 15종목 중 6개 참)가 `bad []` 였다. 조건 ✓ 넷 = knee_buy_v2(불일치 0). 알림 길은 `current_values` 가 같은 `Source.today` 를 쓴다(`alerts.py:163`). 테스트는 `test_all_four_paths_follow_my_thresholds` 가 있다(다만 빈 곳은 위).
3. 기본값을 DB 에 넣고 강제로 다시 판정 = `signal_daily` — **통과** (`test_judging_with_the_default_values_reproduces_every_stored_signal`, 그리고 내 오라클).
4. "기본값으로" 뒤 처음과 같음 — **통과** (DELETE → custom False, 판 `faa56cf123c6edfa`).
5. 입력 한도 422 — **실패** (결함 1).
6. 격리 + 공용 표 그대로 — **통과**.
7. 0013 두 DB 올리기·내리기 + 리비전 목록 — **통과** (SQLite 직접, Postgres 는 CI).
8. 새 화면 ↔ 옛 서버 버튼 숨김 — **통과**.
9. 화면 PC·폰 × 두 테마, 키보드, 44px, 콘솔 0 — **통과** (포커스 참고).
10. 성능 — **통과** (참고: 처음 한 번이 1 s 언저리).
- 더한 것: 기본 판 = `fingerprint()` 글자 그대로(통과, 위 payload 비교), 사람 기준이 재계산·지문에 닿지 않음(통과, `test_my_thresholds_never_touch_the_shared_definition`, 오라클), 경계값 네 길(**반만** — 테스트 빈 곳), AI 셋 같은 기준(통과: 주인·지인 모두 watchlist·portfolio·종목 context 에 `ADX > {A}`·`{N}거래일 전`이 들어 있음. 다만 R3·R7 이 산다).

## 계획 걱정이 반영됐나

- 검토자 막음(옛 이미지가 0013 DB 에서 안 뜸) — 반영. DEPLOY 9-2, `app.tools.downgrade`, `migrate.is_known`(모르는 앞선 리비전이면 경고하고 뜸, `migrate.py:137-142`). 위에서 실제로 건너 봤다.
- 개발자 막음(바꾼 사람 성능) — 반영(캐시 512, 사람끼리 나눠 씀). 목표는 거의 지킨다. 다만 "최근 1년부터 거꾸로"는 하지 않았고, 캐시 키 때문에 결함 2 가 생겼다.
- 매도 종가 붙이기(`_frames` 바깥 조인) · 거래량비는 매수만 · `build_rules` 공장(기본 `BUY/SELL` 같은 객체) · `rules_version` 따로 · 격리 (MINE, USER) · GET 없앰 · 엄격한 스키마 422 · 바꾼 직후 조용히 기록(`alerts.record_buy_state_quietly`, 알림 켠 사람만) · AI 셋 · 방침 · 이격도 −20~0 과 값에서 만드는 문구 · 버튼 자리·"⚙ 종목 설정" · 칸마다 쓰이는 조건 풀이 · N=M 일 때 "기본 기준과 같습니다" — 모두 코드에서 확인했다.
- 경계값 네 길 테스트 — 반만 반영(테스트 빈 곳).
- 참고: 신호 요약 카드의 "시그널 기준" 버튼은 내 기준인 사람에게만 나온다(`Dashboard.tsx:796-804`). 기본인 사람은 시그널 보기 위 버튼으로만 들어간다. plan.md:25 는 두 자리 다라고 했는데, "기본인 사람 화면은 그대로"와 맞추려는 선택으로 보인다 — 참고.

## 합격 조건 (조건부 목록)

1. 결함 1: 아주 큰 정수 → 422, 테스트.
2. 결함 2: 같은 날짜의 값을 고쳤을 때 내 기준 캐시가 새로 세게 하고, 테스트.
3. 뮤테이션 R2~R7 을 잡는 테스트(값 하나만 바꾼 사람, 비교 기간 > 5, AI 숫자, `range` 별 차트 점, 값마다 다른 판).
4. (권함, 조건 아님) DEPLOY 9-2 에 `docker compose stop app` 먼저.

## 끝 상태

- 띄운 가짜 서버(포트 8361, 데이터 `r042/rv/fsdata`)는 PID 6349 로 껐다(`ps -p 6349` 빈 줄, health 000).
- 내 작업 사본 `r042/rv/src` (5edbf2d 를 풀어 `git init`): `git status --short` → (빈 출력), `git log --oneline -1` → `1c21b17 snap5edbf2d`. 뮤테이션은 모두 되돌렸다.
- 처음 받은 worktree 는 검토 도중 환경에서 지워졌다(`git worktree list` 에 없음). 내가 남긴 pytest 로그 폴더(`backend/logs/app.log` 하나)만 있어서 지웠다.
- 본 저장소 `/home/user/Dashboard` 는 건드리지 않았다. 끝날 때 `git status --short` 출력은 아래와 같다 — 모두 총괄의 B 작업이고 내 것이 아니다:
  ```
   M frontend/src/components/AppHeader.phone.test.tsx
   M frontend/src/pages/Dashboard.test.tsx
   M frontend/src/pages/RebalancePanel.test.tsx
   M frontend/src/pages/StockManager.test.tsx
  ?? "docs/rounds/0.42.0-내기준/B-review-2.md"
  ```
