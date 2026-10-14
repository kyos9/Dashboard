조건부 합격

# 0.41.0 항목 B — 다시 검토 (앞 판정의 조건 1·2와 d8343c3 이후 바뀐 것)

- 본 커밋은 `172f54a`(detached HEAD)이고, 범위는 `d8343c3..172f54a`다.
- 앞 판정의 조건 둘(M1~M4, DEPLOY 9-1)은 풀렸다.
- 그런데 내가 따로 만든 뮤테이션 4개 중 2개(M5·M6)가 살아남았다.
  - 둘 다 같은 비교 도구의 보고 칸이다. 지시대로 "모두 잡혀야" 한다면 아직 모자란다.
  - 고칠 것은 테스트 몇 줄뿐이고 코드 동작은 맞다. 그래서 조건부로 둔다.

## 1. 조건 1 — 비교 도구 테스트: 실패 (M1~M4 는 통과)

**새로 더한 테스트** (`backend/tests/test_signal_recompute.py:263-317`)
- `test_signal_diff_every_column_matches_an_independent_count`: 1·3·5년 매수·매도 전/후, `last_buy`, `last_buy_changed`, `today_changed` 를 따로 센 값과 맞춰 본다. 5년 창이 1년과 다르다는 단언도 있다.
- `test_signal_diff_sees_a_change_in_todays_sell_only`: CCC 의 오늘 매도만 뒤집는다.
- `test_signal_diff_skips_people_who_turned_buy_alerts_off`: `push_kinds=[band]` 인 사람을 세면 users 0 이어야 한다.

**뮤테이션 결과**
- 스크립트는 `scratchpad/revB2/mut.py` 다. `app/tools/signal_diff.py` 를 바꿔 `tests/test_signal_recompute.py` 를 돌렸다.
- 매번 원래대로 돌려놓았고, 마지막에 `restored True` 가 나왔다.

| 뮤테이션 | 결과 |
| --- | --- |
| M1 `_last_true` 가 `hits.min()` (가장 이른 날) | 잡힘 (1 failed) |
| M2 3·5년 창을 1년으로 (`days=365`) | 잡힘 |
| M3 매수 알림 끈 사람도 셈 (`if KIND_BUY not in kinds: continue` 삭제) | 잡힘 |
| M4 `today_changed` 에서 오늘 매도 변화 무시 | 잡힘 |
| M7(내 것) 창 경계 `d > since` → `d >= since` | 잡힘 |
| M8(내 것) 오늘 매수 before 를 새 판정 값으로 | 잡힘 |
| M9(내 것) 알림 before 집합을 빈 집합으로 | 잡힘 |
| **M5(내 것) 매도 before 를 새 판정으로 (`"sell": {"before": _counts(new, …)`)** | **살아남음** (15 passed) |
| **M6(내 것) 비활성 사용자도 셈 (`.filter(User.status == STATUS_ACTIVE)` 삭제)** | **살아남음** (15 passed) |

**M5 가 살아남은 까닭**
- 시험 정의 변경은 `ADX_TREND` 20→25 하나다. 그런데 어깨매도는 `ADX_TREND` 를 쓰지 않는다. 매도 조건은 `adx > adx[-5]` 이다(`signal_rules.py:235-244`).
- 그래서 고정 데이터에서는 매도 전 = 후다. 칸마다 대조하는 테스트가 "전" 칸을 "후" 값으로 바꿔도 구분하지 못한다.
- 매도 정의를 바꾸는 라운드에서 도구가 매도 "전" 숫자를 틀리게 내도 테스트는 통과한다.

**M6 이 살아남은 까닭**
- `signal_diff` 를 쓰는 테스트는 이 파일 하나뿐이다(`grep -rl signal_diff tests/`).
- 그 안에 비활성(`status != active`) 사용자를 넣는 경우가 없다.

## 2. 조건 2 — DEPLOY 9-1: 통과

**이미지 받기** (`DEPLOY.md:296-298`)
- `IMAGE_TAG=sha-… docker compose pull app` 이 `… run --rm --no-deps app python -m app.tools.signal_diff` 앞에 있다.
- compose 설정과 맞는다.
  - `app` 서비스는 `image: ghcr.io/kyos9/dashboard:${IMAGE_TAG:-latest}` 와 `build: .` 를 같이 가진다.
  - `compose pull app` 은 image 가 있는 서비스를 받아 온다. 받아 두면 `run` 이 빌드하지 않는다.
  - 태그는 `.github/workflows/docker.yml:88` `type=sha,format=short` 이므로 `sha-xxxxxxx` 모양이다.
- `Dockerfile` 은 `WORKDIR /srv/backend` 이고 ENTRYPOINT 가 없다. 그래서 `python -m app.tools…` 가 그대로 돌고 마이그레이션은 돌지 않는다.
- `signal_diff.main` 은 `app.db.SessionLocal` 만 쓴다. `DATABASE_URL` 은 compose 의 `postgresql+psycopg://…@db:5432/signal` 이다.

**ARM 길** (`DEPLOY.md:301-303`)
- 서버에서 빌드하는 ARM 은 받을 이미지가 없다고 적었다. 6번(`DEPLOY.md:168-177`)의 "x86_64 용 하나뿐"과 맞는다.
- 대신 PC 에서 하도록 안내한다: 백업 → PC Postgres 에 붓기 → `DATABASE_URL=postgresql+psycopg://… python -m app.tools.signal_diff`.
- 이 길도 성립한다.
  - 백업은 `pg_dump --no-owner --no-privileges` 라서(`backup.py:82`) 다른 롤로 붓기에 문제가 없다.
  - `db.py:42-49` 가 드라이버 이름을 바로잡는다.
  - `requirements.txt` 에 psycopg 가 있다.
- 참고: "10-1 의 3번과 같은 명령"은 서버 컨테이너용 `docker compose exec db psql …` 이다. PC 에서는 `psql -d <DB> -v ON_ERROR_STOP=1 < 파일` 로 읽어야 한다. 막을 정도는 아니다.

**`--force` 줄** (`DEPLOY.md:314-316`)
- 0.40.x 로 내렸다가 다시 0.41.0 이상으로 올린 뒤 `docker compose exec app python -m app.tools.recompute_signals --force` 를 돌리라고 적었다.
- `recompute_signals.py:21` 에 `--force` 가 있다.
- 올린 뒤 확인 문구("N종목 중 M종목, 판정이 바뀐 날 K개")가 화면 문구와 같다.

## 3. d8343c3 이후 바뀐 것: 통과

**바뀐 날 줄에 `what` 붙이기**
- 코드: `signal_rules.py:333-334`. `CHANGES[-1].what` 이 비면 붙이지 않는다.
- `changed_on()` 은 `len(CHANGES) > 1` 일 때만 값을 낸다. 그래서 처음 정의의 `what` 이 화면에 나올 일은 없다. 지금 `CHANGES` 는 1줄이라 화면에는 변화가 없다.
- 테스트도 고쳤다.
  - `test_signal_rules.py:236` 은 "… — ADX 25" 를 기대한다.
  - `test_devtools.py:234-236` 은 데모 문구 "(데모) 바꾼 것처럼 꾸몄을 뿐 판정은 그대로" 를 기대한다.
- 화면은 `Dashboard.tsx:782-785` 에서 문자열을 그대로 그린다.
- 명세 `SIGNAL_APP_SPEC.md:325-326` 과 README 가 코드와 같다.

**진단 문구**
- `DiagnosticsModal.tsx:105-113` 은 "(날짜)에 바뀜 · 정의 지문 `<mono>`" 와 "N종목 중 M종목, 판정이 바뀐 날 K개 · s초" 를 보인다.
- 테스트(`DiagnosticsModal.test.tsx:217`)와 DEPLOY·README 문구가 서로 같다.

**회귀**
- 백엔드 `python -m pytest -q`: 1304 passed, 3 skipped. 앞 판정 때는 1301 이었고 새 테스트 3개만큼 늘었다.
- 프런트
  - `npm test -- --run`: Test Files 55 passed, Tests 807 passed.
  - `npx tsc -b`: 종료 코드 0.
  - `npm run lint`: 종료 코드 0, 경고 23 (기준 23 이하).

**규제**
- 바뀐 줄(`git diff d8343c3..HEAD -- backend frontend DEPLOY.md README.md SIGNAL_APP_SPEC.md` 의 `+` 줄)에서 `추천|사세요|팔라|팔아|저평가|예측|수익률|수익` 을 찾았다. 0건이다.
- 새 문구는 날짜·정의 설명·건수뿐이다.
- 참고: `CHANGES[].what` 은 정의를 바꾸는 사람이 쓰는 자유 문장인데 이제 화면에 그대로 나온다. 금지어를 막는 테스트는 없고 주석(`signal_rules.py:46`)만 있다. 다음에 바꿀 때 확인할 것으로 적어 둔다.

## 조건부 (고쳐야 합격) — 테스트만

1. **M5: 매도 쪽이 실제로 바뀌는 경우를 만든다.**
   - 예 1: `test_signal_diff_sees_a_change_in_todays_sell_only` 에서 CCC 의 오늘 매도를 뒤집은 뒤 `r["sell"]["before"][1] != r["sell"]["after"][1]` 과 그 차이(±1)를 단언한다.
   - 예 2: 매도 기준(`LOOKBACK_DAYS` 등)을 바꾼 정의로 칸별 대조 테스트를 한 번 더 돌린다.
   - 그 뒤 M5 가 잡히는지 확인한다.
2. **M6: 비활성 사용자를 넣는다.**
   - 구독은 있고 매수 알림은 켰지만 `status` 가 active 가 아닌 사용자를 하나 둔다.
   - `users_with_alerts_on` 과 `users` 에 들어가지 않는지 단언한다.

## git status

```
HEAD detached at 172f54a
nothing to commit, working tree clean
```

뮤테이션은 매번 원래대로 돌려놓았다(`restored True`). `frontend/node_modules` 는 git 이 무시하는 심볼릭 링크다. 가짜 서버는 띄우지 않았다.
