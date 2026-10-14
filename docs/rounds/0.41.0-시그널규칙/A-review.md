조건부 합격

# 0.41.0 항목 A (시그널 규칙을 한 곳으로) — 검토자 판정

- 검토한 트리: `origin/claude/new-session-fftcg1` = `d8343c3` (detached). A 범위는 `344575c..099b8cd`이고, docs/rounds는 뺐다. B 커밋은 A에 닿는 곳만 봤다.
- 비교 기준: 시작 커밋 `344575c`와 A 끝 `099b8cd`를 `git archive`로 저장소 밖(`scratchpad/revA/base`, `revA/a`)에 풀었다. 같은 날(2026-10-14), 같은 기계에서 나란히 돌렸다.
  - 시작 때 떠 둔 `baseline/snap`은 하루 전 데이터다. 그래서 날짜가 붙지 않은 지표 값(stddev20 등)까지 946곳이 다르다. 날짜 차이일 뿐이므로 판정에는 같은 날 시작 커밋에서 다시 뜬 사진을 썼다.
- 서버 포트는 8191만 썼다. 띄운 서버(PID 30650, 4885, 6752, 7401)는 모두 PID로 껐고, 남은 프로세스가 0인 것을 확인했다.

## 검사별

**완료 조건 — 통과.** 일곱 가지(계획의 여섯 줄 중 첫 줄을 응답 사진과 API 모양으로 나눔)를 모두 확인했다.
1. **응답 사진** — 시작 커밋 대 A, 시작 커밋 대 지금(같은 날): `snapdiff.py revA/snap-base revA/snap-a` → `같음 / 차이 0`, `snap-base` 대 `snap-head`도 `차이 0`.
   - 새 필드 확인: owner 15종목, friend 4종목 모두 `buy_conditions == knee_conditions`이고 `signal_rules_version`은 `faa56cf123c6edfa` 한 값이다.
   - AI 보내는 내용(`/api/ai/context/{15종목}`, watchlist·macro·portfolio·research 컨텍스트, owner와 friend, `prompt`·`system` 전문)도 시작 커밋 대 지금 `차이 0`이다.
2. **API 모양** — `apidiff.py baseline/openapi.json revA/openapi-head.json` → `빠짐 0`, `타입 바뀜 0`, `더해짐 8`이다(A가 더한 것 6: `/api/signal-rules`, `DashboardCard.buy_conditions`·`signal_rules_version`, 스키마 4개. 나머지 `/api/admin/signal-rules`는 B).
   - 따로 기존 경로의 parameters·requestBody·200 응답과 스키마 required 목록도 비교했다 → `total 0`.
3. **AI 지시문 글자** — `ai_consts.py`: 상수 18개 중 다른 것은 `__file__`·`__cached__`뿐이다. `test_signal_rules.py:148` `test_ai_text_is_unchanged_to_the_letter`도 통과한다.
4. **ADX 20→25** — 테스트 `test_signal_rules.py:200`은 모듈 사본으로 본다. 그래서 진짜 모듈이 같이 따라오는지 직접 확인했다. `signal_rules.py:34`를 잠시 25.0으로 고쳐 끝에서 끝까지 돌렸다(`revA/adx25.py`).

   | 무엇 | 20일 때 | 25로 고친 뒤 |
   | --- | --- | --- |
   | 저장 판정 매수 횟수 | 25 | 6 (옛 식을 25로 돌린 값과 같음) |
   | 오늘 조건(ADX 22) | True | `buy_conditions` / `buy_conditions_many` / `knee_conditions` 셋 다 False |
   | AI 지시문 | `④ ADX > 20.` | `④ ADX > 25.`, 조건 줄 `④ ADX>25` |
   | `/api/signal-rules` | `adx_trend` 20.0, `ADX > 20` | 25.0, `['ADX > 25']`, version `faa56…` → `9f1c9c82…` |

   - 같은 상태에서 관련 테스트는 9 failed였다. 그 뒤 `git checkout`으로 되돌렸다.
5. **좁힌 문자열 검사** — `grep -rnE "ADX ?(&gt;|>) ?20|> ?1\.1|네 조건|조건 4개|이격도 ?(<|&lt;) ?0|shift\(5\)"`로 찾았다.
   - 지정한 다섯 파일과 dashboard.py에는 하나도 없다. `test_signal_rules.py:258`도 통과한다.
   - 남은 것은 주석뿐이다: `display.ts:186`, `schemas.py:149-158`, `types.ts:139`(참고).
6. **두 길 같은 답** — 넓힌 테스트는 `test_knee_conditions.py`가 아니라 새 파일 `test_signal_rules.py:77-145`에 들어갔다. 다룬 범위:
   - 매수와 어깨매도 모두 0.40.0 식과 같은지(결측 포함 4 시드)
   - 오늘 한 줄 = 저장 판정 (6행 미만, 결측)
   - 여러 종목을 한 번에 평가 = 종목마다 평가
   - OR 묶음 표 7가지
   
   `dashboard.py:15`의 `_knee_conditions` 별칭은 남아 있고, 기존 `test_knee_conditions.py`가 그 자리로 불러 통과한다.
7. **옛 응답** — `Dashboard.test.tsx` "옛 서버 — 규칙 API 가 404 이고 카드에 새 필드가 없어도 0.40.0 화면 그대로"가 통과한다. 실제 브라우저로도 확인했다(아래 화면 칸).

**계획 때 걱정 — 통과.** `plan.md`의 "검토 의견에 대한 답" 표에서 A에 해당하는 "반영"을 하나씩 확인했다.
- `(SHARED, USER)` — `test_isolation.py:101`. 손님은 `curl /api/signal-rules` → 401.
- OR 의미 고정 — `signal_rules.py:97-112`, 테스트 `:134`.
- 좁힌 문자열 검사와 값을 바꾸면 따라오는 테스트 — 있다.
- 빠졌던 곳 셋 — `AiPanel.tsx:28`, `ai_analysis.py:139`, `ai_rules_text`·`ai_condition_line`.
- 색 풀이 기준값 — `display.ts:197`, `:221`.
- PWA 판 비교 후 다시 받기 — `signalRules.ts:32-50`, `Dashboard.tsx:367`.
- 깜빡임 없음 — 옛 서버용 기본값이 지금 서버가 보내는 것과 같다(`test_signal_rules.py:163`).
- "그 밖의 조건" 데모는 뺐다.

"막음" 1건(재계산과 갱신이 동시에 쓰는 문제)은 B 몫이다. A에는 막음이 없다. "반영 안 함(이번)"인 변동성 칸 문제는 `ROADMAP.md:67` 다음 라운드 후보로 올라가 있다.

**회귀 — 통과.**
- 백엔드 `pytest -q` → `1301 passed, 3 skipped`(시작 1263/3, 줄어든 것 없음).
- 프런트 `vitest run` → `55 files, 807 passed`(시작 791).
- `npm run lint` → 경고 23(시작 23). `npx tsc -b` → 통과.
- `git diff 344575c..HEAD -- backend/tests frontend/src`에서 지워진 `def test_`·`it(`는 0이다.
- 응답 사진 차이 0(위 완료 조건 1).

**격리 — 통과.** 새 엔드포인트 `GET /api/signal-rules`는 `test_isolation.py:101`에 `(SHARED, USER)`로 적혀 있고, 격리 테스트도 통과한다. 공용이라 남의 것 404는 해당하지 않는다. 주인 전용 동작도 없다. 손님은 401이다.

**마이그레이션 — 해당 없음.** A에는 새 테이블·컬럼·리비전이 없다(`git diff --stat`에 migrations 없음). Postgres 갈래는 CI 로 확인.

**호환 — 통과.**
- API: 빠진 것 0, 타입 바뀜 0, required 바뀜 0.
- 새 화면 ↔ 옛 서버: 화면 테스트가 있고, 실제 브라우저로도 봤다(`pw/revA-check.mjs`). `/api/signal-rules`를 404로 막고 `/api/dashboard`에서 `buy_conditions`·`signal_rules_version`을 지운 화면과 그냥 화면을 비교했다.
  - PC 1400과 폰 390 모두 `text same=true titles same=true`, 규칙 요청은 각 1회, 콘솔 오류 0.
- 옛 화면 ↔ 새 서버: `knee_conditions`를 그대로 채운다(사진 차이 0).
- 요청에 새 필드는 없다. GET 하나만 더해졌다.

**입력 한도 — 해당 없음.** 새로 받는 사용자 입력이 없다. `GET /api/signal-rules`는 인자가 없다.

**뮤테이션 — 실패 (살아남은 것 2).** `A-mutation.md`를 확인했다.
- 살아남았다고 적은 "거래량비 > → >=" — 다시 돌렸더니 `test_signals.py:80`에서 잡혔다.
- "지문에서 기준값 빼기"는 동등한 변이라고 적었고, 그 설명에 동의한다(`logic`에 기준값이 들어 있다).

직접 해 본 5개(모두 `git checkout`으로 되돌림):

| # | 바꾼 것 | 결과 |
| --- | --- | --- |
| ① | `dashboard.py:38` `limit=signal_rules.LOOKBACK_DAYS + 1` → `LOOKBACK_DAYS` | **살아남음** — 전체 `1301 passed`. 그런데 응답 사진에서는 owner 카드 6개와 friend 카드 1개, 모두 7곳의 `knee_conditions.volatility_or_volume`이 True → False로 바뀐다(`snapdiff snap-base snap-mut1` → `차이 7`). 대시보드가 실제로 몇 행을 읽는지 지키는 테스트가 없다 |
| ② | `ai_analysis.py:241` `rows[lookback]` → `rows[lookback - 1]` | **살아남음** — 전체 `1301 passed`. AI에 가는 "5거래일 전" ADX·표준편차 값이 하루 어긋나도 아무 테스트도 모른다. 옛 코드의 `rows[5]`도 테스트가 없었지만, 이 줄은 A가 다시 쓴 줄이다 |
| ③ | `signals.py` `buy_conditions_many` 빈 행 채움을 뒤로 | 잡힘 (`test_many_tickers_at_once_equal_one_by_one`) |
| ④ | `signals.py` 옛 모양 `knee_conditions`의 빈 행 수 off-by-one | 잡힘 (3개 실패) |
| ⑤ | `Dashboard.tsx:367` `useSignalRules(cards[0]?.signal_rules_version)` → `useSignalRules()` | 잡힘 ("카드가 다른 판을 말하면 규칙을 다시 받는다") |

**비밀 — 통과.**
- 가짜 서버(8191)에서 owner로 `X-AI-Key: SENTINEL-a41review-9f8e7d6c5b4a`를 붙여 불렀다: `/api/ai/analyze/NVDA`(502 오류 길), `…/stream`, `/api/ai/watchlist/stream`, `/api/ai/models`, `/api/signal-rules`, `/api/dashboard`.
- 응답 6건 모두 SENTINEL 없음. `grep -rla SENTINEL fakedata3/ fake3.log`(app.db, logs/app.log, 서버 로그) → 없음(exit 1).
- A 차이에서 키·로그를 다루는 줄을 찾아봤다 → 0줄.

**규제 — 통과.**
- `git diff 344575c..099b8cd -- backend/app frontend/src`의 더해진 줄과 `signal_rules.py`·`signalRulesLegacy.json`에서 `추천|사세요|팔라|저평가|예측|수익률`을 찾았다 → 0건(exit 1).
- AI 지시문은 글자 그대로이고, 기획의 규제 영향은 "없음"이다. 수익률 표현도 없다.

**데이터 경계 — 통과.** 새 표·컬럼이 없다. `/api/signal-rules`는 공용이고 읽기만 한다. 공용 `signal_daily`를 사용자 설정으로 바꾸는 길이 없다.

**외부 호출 — 통과.** 바깥 호출은 0이다. 화면은 규칙을 한 번 받고, 판이 다를 때만 다시 받는다(브라우저에서 15종목일 때 규칙 요청 1회). 대시보드는 종목 수와 상관없이 한 표로 평가하고, 쿼리는 12건 그대로다.

**화면 — 통과.**
- `npm run build`를 하고 가짜 서버 8191에서 `docs/design/audit.mjs` 전체를 돌렸다(화면×조건 189개, 열지 못한 것 0).
  - page-overflow·clipped·num-split·folded3·touch·contrast·console 모두 0.
  - orphan 15와 folded2-360 2는 fundamentals·macro·menu-users 화면에서만 나온다. A가 건드리지 않은 화면이다.
  - 시작 커밋을 빌드해 같은 화면(`--only fundamentals,macro,menu-users,dash-signal`)을 돌리면 똑같이 orphan 15, folded2-360 2가 나온다. 원래 있던 것이다.
  - A가 바꾼 dash-signal은 모든 조건에서 0이다.
- 키보드: PC 1400 시그널 보기에서 Tab을 60번 눌렀다. 머리 → 탭 → 보기 전환 → 필터 → 표/카드 → 종목 버튼·AI 분석 순서로 걸림 없이 가고, 포커스 표시가 없는 곳은 0이다. A는 새로 포커스 받는 요소를 더하지 않았다(바꾼 날 줄은 `<p role="note">`).

**성능 — 통과.**
- `perf_dashboard.py`(20종목): 지금 `median 36.0 ms, queries 12`, 같은 기계에서 시작 커밋 `35.1 ms, queries 12`. 1 ms 안이라 잡음 범위다.
- 첫 화면 JS: `index-*.js gzip 109.80 kB`(시작 109.97 kB).

**가짜 서버 — 통과.** A가 더한 화면 상태(규칙 API, 옛 서버 기본값)는 가짜 서버에서 그대로 돈다. `/api/signal-rules`는 200, 손님은 401이다. `test_devtools.py`는 전체 실행 안에서 통과했다. 바꾼 날 데모(`--demo-rule-change`)는 B 몫이다.

**문서 — 통과.**
- `SIGNAL_APP_SPEC.md`: 3·4장 머리에 "정의는 `signal_rules.py`", 10장 바꾸는 순서를 새 길로, 11장 정의 변경 이력이 새로 생겼다. 이력은 `signal_rules.CHANGES`와 같다.
- `README.md` "시그널 규칙 (v0.41.0)" 줄과 `ROADMAP.md:63`, `:67`, `:2342`, `:2349`가 구현과 맞다.
- DEPLOY·방침: A에는 해당이 없다. 수집하는 것이 늘지 않았다.

## 조건 (조건부 합격)

1. **`dashboard.py:38` 행 수를 지키는 테스트를 더한다.** 대시보드 응답의 `knee_conditions`·`buy_conditions`가 "N거래일 전" 비교에 N+1행을 쓰는지 보는 API 수준 테스트가 필요하다. 예: 변동성 절이 StdDev20 축소로만 참이 되는 종목을 넣고, 응답이 저장 판정과 같은지 본다. 지금은 `limit=LOOKBACK_DAYS`로 바꿔도 1301개가 다 통과하는데, 실제 응답은 7곳이 바뀐다.
2. **`ai_analysis.py:241` "N거래일 전" 행을 지키는 테스트를 더한다.** AI 컨텍스트의 `adx_5d_ago`·`stddev20_5d_ago`가 N+1번째 행 값인지 본다. 지금은 `rows[lookback - 1]`로 바꿔도 다 통과한다.

## 참고 (조건 아님)

- 넓힌 같은 답 테스트는 `test_knee_conditions.py`가 아니라 `test_signal_rules.py`에 있다. 내용(어깨매도, 6행 미만, 결측)은 계획대로다.
- `test_changing_one_threshold_…`(`test_signal_rules.py:200`)는 모듈 사본에서 본다. 그래서 진짜 `signals`·`ai_analysis`·라우터가 같이 따라오는 것은 연결 구조와 문자열 검사로만 지켜진다. 끝에서 끝까지 따라오는 것은 내가 직접 확인했다(완료 조건 4).
- `display.ts:199` `readAdx`의 "추세 형성" 상한 25는 그대로 박혀 있다. 나중에 ADX 기준을 25 이상으로 바꾸면 그 구간이 사라진다. 정의를 바꾸는 라운드에서 같이 볼 일이다.
- `schemas.py:156-158`, `display.ts:186` 주석에 옛 기준값이 남아 있다(주석이라 화면에 나오지 않는다).

## git status (끝)

```
$ git status
HEAD detached at d8343c3
nothing to commit, working tree clean
```
(`frontend/node_modules`는 `/home/user/Dashboard/frontend/node_modules`로 가는 심볼릭 링크이고 무시 목록에 들어 있다. 뮤테이션 6건과 ADX 25 시험 1건은 모두 `git checkout`으로 되돌렸다.)
