# 0.44.0 C "작은 고치기 2" — 두 번째(좁은) 검토

## 조건부 합격

- 1(첫 검토 조건 둘): **풀렸다.** 두 뮤테이션 모두 이제 잡힌다.
- 2(데모 `demo_thresholds`): **오늘(2026-10-20)은 통과한다. 하지만 날짜에 매이지 않는다고는 할 수 없다.** 2026-06-01부터 2027-06-30까지 평일 283일을 흉내 내 보니 **27일은 후보가 하나도 달라지지 않았다.** 그 날엔 `test_demo_custom_thresholds_shows_my_thresholds` 가 다시 넘어진다. 다음 날은 **2026-11-04**이고, 진짜 길(seed → recompute → demo_thresholds)로 확인했다.
- 3(C가 바꾼 줄 뮤테이션, 직접 7개): 잡힘 3, **살아남음 3**, 동등(같은 동작) 1.
- 전체: 프런트 vitest **910 passed (58 files)**, lint **경고 22**(exit 0), tsc exit 0, 백엔드 **1419 passed, 3 skipped**. 총괄이 준 숫자와 같다.

검토한 커밋: `5023d59`. worktree를 detached로 두고 봤다. `frontend/node_modules` 는 본 저장소로 가는 심볼릭 링크를 잠시 뒀다가 지웠다.

---

## 1. 첫 검토 조건 둘 (`C-review.md` 조건 1·2, 고친 커밋 `ee93f1d`) — 통과

뮤테이션 도구는 `…/scratchpad/r044/rev2/mut.sh` 다. 파일을 백업하고, 한 군데만 바꾸고, 테스트를 돌리고, 되돌린 뒤 `cmp` 로 확인한다.

| 뮤테이션 | 결과 | 증거 |
| --- | --- | --- |
| (a) `PriceChart.tsx:189` `chartPrice(shown.close, currencyOfTicker(history.ticker))` → `chartPrice(shown.close, 'USD')` | **잡힘** | `× 한 줄의 값은 그 종목의 통화 꼴 — 원화는 소수점 없이` / `Tests 1 failed \| 60 passed (61)` (PriceChart·ChartModal·HistoryChart 테스트) / RESTORED |
| (b) `client.ts:145` `technical \|\| body)` → `body)` | **잡힘** | `× 422 의 detail 목록은 칸 이름 + 범위의 한국어 한 줄 …` / `Tests 1 failed \| 13 passed (14)` / RESTORED |

더해진 테스트는 `PriceChart.markers.test.tsx:208-213`(원화 `68,000`, `.00` 없음)과 `client.test.ts:84-87`(`toBe('Input should …; …')`)이다.

## 2. 데모 고침 `backend/devtools/fake_server.py:740-764` `demo_thresholds` — 오늘은 통과, 날짜에는 아직 매인다

- **오늘 통과:** `pytest tests/test_devtools.py -k demo_custom` → `1 passed`. 전체 백엔드도 통과(아래).
- **날짜 흉내 1 — 순수 계산** (`…/scratchpad/r044/rev2/sim_dates.py`): `devtools.fake_server.dt` 를 바꿔 끼워 `date.today()` 만 그 날로 돌려준다. 주인 15종목마다 `fake_history` → `compute_indicators` → `compute_signals(DEFAULT / Thresholds(adx_trend=후보))` 를 하고 마지막 날 `knee_buy_v2` 를 센다. `demo_thresholds` 와 같은 순서로 첫 후보를 고른다.
  - 2026-10-16 → 15.0 (기본 4, 15에서 5). **2026-10-19 → 25.0** (15·12·17.5·10 모두 4로 같다. 커밋 설명과 맞다). 2026-10-20 → 12.0 (기본 2, 12에서 3).
  - 범위 2026-06-01 ~ 2027-06-30, 평일 283일: `{15.0: 104, 25.0: 58, 12.0: 42, 30.0: 27, 35.0: 12, 10.0: 9, 40.0: 4, None: 27}`
  - **후보가 하나도 안 되는 날 27일:** 2026-06-10, 07-21, 07-24, 07-27, 08-25, 09-29, 09-30, 10-02, **11-04, 11-05**, 11-26, 12-02, 12-21, 12-24, 12-25, 12-28, 2027-02-05, 03-31, 04-26, 06-02, 06-03, 06-07, 06-09, 06-10, 06-11, 06-14, 06-15.
    - 예: `2026-11-04 chosen= None | default:2 15.0:2 12.0:2 17.5:2 10.0:2 25.0:2 30.0:2 35.0:2 40.0:2`
    - 예: `2026-11-05 … default:3 … 40.0:3`. 모든 후보에서 매수 수가 같다.
- **날짜 흉내 2 — 진짜 길** (`…/scratchpad/r044/rev2/real_path.py`): 저장소 밖 폴더에서 `prepare_data_dir(reset)` → `configure_env` → `install_fakes` → `init_db` → `seed` → `recompute_signals` 를 거쳐, DB로 `my_signals.judge` 와 `demo_thresholds` 를 부른다.
  - 2026-10-20: `counts {'default': 2, 15.0: 2, 12.0: 3, …}` → `{'adx_trend': 12.0}`. 흉내 1과 같다.
  - **2026-11-04:** `counts` 가 모두 2 → `{'adx_trend': 15.0}`(첫 후보로 돌아간다). 이 상태면 시험의 `assert mine != default` 가 넘어진다.
  - **2026-09-29:** 마찬가지로 모두 2 → 15.0.
- 정리: 후보를 하나로 박아 두던 것보다는 넓어졌다. 그래도 "날짜 따라 넘어지는 시험"은 약 10%의 평일(283일 중 27일)에 그대로 남는다. 다음 날은 2026-11-04·11-05다.
- 필요한 것(하나만 하면 된다):
  - (가) 후보를 ADX 하나에서 다른 기준(거래량비·이격도·비교 기간)까지 넓힌다. 그 뒤 위 흉내를 1년 넘게 돌려 None 0을 보인다.
  - (나) 데모 시세의 모양을 날짜와 상관없이 고정한다. 예: 한 종목에 ADX 경계에 걸리는 `shape` 를 준다.
  - (다) 시험이 기준을 두고 `mine != default` 를 묻지 않게 한다. 예: 날짜를 몇 개 고정해 `demo_thresholds` 가 달라지는 값을 고르는지 묻는다.
  - 어느 쪽이든 `sim_dates.py` 같은 여러 날짜 시험이 하나 있어야 다시 묻히지 않는다.

## 3. C가 바꾼 줄 안의 뮤테이션 (직접 7개, `C-mutation.md`·`C-review.md` 목록과 겹치지 않음)

범위는 `git diff 4844bf0 5023d59 -- PriceChart.tsx client.ts StockManager.tsx` 의 `+` 줄이다.

| # | 줄 | 뮤테이션 | 결과 | 증거 |
| --- | --- | --- | --- | --- |
| M1 | `PriceChart.tsx:163` (1824fc1 `dataByIndex`) | `if (!hit && param.logical !== undefined)` → `if (param.logical !== undefined)` (날이 있어도 늘 `dataByIndex` 로 덮음) | 살아남음 — **동등으로 본다** | `Tests 61 passed`. 진짜 차트에서는 `param.logical` 자리의 막대가 `seriesData` 와 같은 막대라 결과가 같다. 셈에 넣지 않는다 |
| M2 | `PriceChart.tsx:190` | `{!current && <span hint>}` → 늘 보임 | 잡힘 | `× 짧게 탭하면 십자선을 그 자리로 옮기고, 한 줄이 그 날을 말한다` |
| M3 | `PriceChart.tsx:181` | `p.date === pointed.date && p.close === pointed.close` → 날짜만 | 잡힘 | `× 종목을 바꾸면 가리켰던 날을 버리고 새 종목의 마지막 날` |
| M4 | `client.ts:144` | `.filter(Boolean)` 빼기 | **살아남음** | `Tests 14 passed (14)`. msg 없는 칸이 섞이면 기술적 원인이 `a; ; b` 가 되고, 둘 다 없으면 `"; "` 가 되어 본문 대신 빈 구분자만 남는다 |
| M5 | `client.ts:143` | `detail.length > 0` → `>= 0` | **살아남음** | `Tests 14 passed`. `detail: []` 이면 `입력값을 확인해 주세요 — ` (뒤가 빈 한 줄)가 뜬다. 원래는 객체 갈래로 가서 hint 가 null 이다 |
| M6 | `client.ts:114` | `lt` 갈래 끔 (`if (false && n(ctx.lt))`) | **살아남음** | `Tests 14 passed`. 지금 서버 스키마에는 `lt=` 가 없다(`grep -P "[(,\s]lt=" backend/app` → 0줄). 그래서 실제 영향은 없고, 시험이 안 된 갈래다 |
| M7 | `StockManager.tsx:454` | 고르기 전 도움말 `'그 종목을 거래하는 통화 기준'` → `'미국 달러 기준'` | 잡힘 | `× 고르기 전에는 평단가에 단위가 없고, 국내 종목을 고르면 원화로 (0.44.0 C3)` |

모든 뮤테이션 뒤에 `RESTORED` 를 확인했다(cmp 일치).

살아남은 3개(M4·M5·M6)는 진짜 서버(pydantic은 늘 `msg` 를 주고, 빈 목록은 안 보내고, `lt` 는 안 쓴다)로는 화면에 드러나지 않는다. 심각도는 참고 수준이다. 그래도 판정 기준(살아남음 0)에 따라 테스트 셋이 필요하다.
- `client.test.ts` — 422 `detail: [{loc:[body,quantity], type:'x'}, {loc:[body,note], msg:'Too long', ctx:{max_length:200}}]` → `error.detail` 이 `toBe('Too long')` (M4).
- `client.test.ts` — 422 `detail: []` → `error.message` 가 `입력값을 확인해 주세요` 로 시작하지 않는다 / hint 가 null (M5).
- `client.test.ts` — `ctx: {lt: 10}` → `…은 10보다 작아야 합니다` (M6). 또는 쓰지 않는 `lt` 갈래를 지운다.

## 4. 전체 돌림

| 무엇 | 결과 |
| --- | --- |
| `npx vitest run --maxWorkers=2` | `Test Files 58 passed (58)` / `Tests 910 passed (910)` |
| `npm run lint` (oxlint) | exit 0, `warning` 22줄(경고 22) |
| `npx tsc -b --noEmit` | exit 0 |
| `python -m pytest -q -x` (backend) | `1419 passed, 3 skipped, 5273 warnings in 154.28s` |
| `pytest tests/test_devtools.py -k demo_custom` | `1 passed` (오늘 2026-10-20) |

## worktree `git status` (끝)

```
HEAD detached at origin/claude/new-session-fftcg1
nothing to commit, working tree clean
```
(`git log --oneline -1` → `5023d59 D0 좁은 검토 조건: 폴더에 못 쓰는 날의 실패 · 테스트 넷`)
