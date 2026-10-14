# 0.42.0 라운드 끝 검토 (전체 회귀·호환) — 3aabeec

## 판정: 조건부 합격

막는 결함 1건(D1). 앱이 도는 동안에는 생기지 않는다. 주인이 실제로 밟을 배포 길(0.40.0 → 0.42.0, DEPLOY 9-1 의 배포 전 비교)에서 도구가 넘어진다.
고칠 것이 작고, 그동안 피해 가는 길도 있다. 나머지 회귀·호환·마이그레이션·화면은 모두 통과했다.

검토 범위: 289b097..3aabeec. worktree 를 `git checkout --detach 3aabeec` 로 맞췄다.
작업 파일: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r042/end/`.
옛 코드는 `git archive` 로 꺼냈다: `old/`(289b097), `v040/`(344575c = 0.40.0).

## 막는 결함

**D1. 0.42 이미지의 `app.tools.signal_diff` 가 0012 DB(지금 서버의 0.40.0)에서 넘어진다 — 알림을 켠 사람이 한 명이라도 있으면**
- DEPLOY 9-1 은 "올리기 전에 새 이미지의 비교 도구를 **지금 DB** 에 대고 돌린다"고 한다. 서버는 0.40.0 이라 0012 이다.
  0.40 → 0.42 는 0.41 의 정의 재계산이 처음 도는 업데이트이므로 이 단계를 밟을 이유가 있다.
- 재현: 0.40.0 가짜 서버로 만든 DB 에 user_settings·push_subscription·push_state 를 넣었다(`mig/v040.db`). 그다음
  `DATABASE_URL=sqlite:///…/diff.db python -m app.tools.signal_diff` →
  `sqlite3.OperationalError: no such column: user_settings.signal_thresholds`, 종료 1.
  - 넘어진 자리: `backend/app/tools/signal_diff.py:103` `db.get(UserSettings, uid)`. 0.42 모델이 새 칸까지 SELECT 한다.
    바로 아래 `my_signals.thresholds_for` 도 그 칸을 읽는다.
  - 알림 구독이 없는 DB(`diff-nopush.db`)는 종료 0이다. 주인은 알림을 쓰므로 실제 서버는 넘어지는 쪽이다.
  - 같은 DB 에 289b097 의 signal_diff 를 돌리면 종료 0이다("알림 켠 사람 3명 중 0명"). **이번 라운드에 생긴 회귀다.**
  - DB 는 바뀌지 않는다(읽기만, 실행 전후 표 해시가 같다). 잃는 것은 없고 도구만 못 쓴다.
- 조건(하나 고른다):
  - (a) signal_diff 가 칸이 없는 DB 에서도 돌게 고친다. 예: 칸이 없으면 모두 기본으로 보고, 필요한 칸만 읽는다.
    그리고 0012 DB + 알림 구독으로 돌리는 테스트를 더한다.
  - (b) DEPLOY 9-1 에 "0.41.x 이하에서 올릴 때는 0.41.0 이미지의 signal_diff 로 본다(0.42 는 공용 정의를 바꾸지 않았다)"를 적는다.

  (a) 를 권한다.

## 참고 (막지 않음)
- R1. 리비전 0013 독스트링과 `backend/app/migrate.py` 의 `upgrade_to_head` 주석이 되돌리기를 "DEPLOY.md 8번"이라고 적는다.
  DEPLOY 8번은 "폰에 설치"이고, 실제 절은 9-2 다.
- R2. ROADMAP 0-1 의 "지금 남은 것" 표 제목이 아직 *(v0.37.0 뒤)* 다. 0.42 배포 같은 주인 할 일이 없다. "다음 라운드 후보"는 고쳐져 있다.
- R3. 이 컨테이너에서는 Postgres 로 돌리지 못했다. psycopg 는 저장소 밖에 설치했지만, `su`/`runuser` 가 막혀 클러스터를 띄울 수 없었다.
  Postgres 갈래는 CI 결과로 확인해야 한다.
- R4. PUT 응답의 `thresholds.lookback_days` 가 `5.0`(float)으로 나온다. 화면은 문제없이 쓴다. `{"lookback_days": 2.0}` 은 받고, 2.5 는 422 다.

## 항목별

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| 백엔드 회귀 | 통과 | `python -m pytest -q`(SQLite): **1363 passed, 3 skipped**(시작 1309/3). `end/pytest.txt` |
| 프론트 vitest | 통과 | 58 files, **863 passed**(시작 807) |
| 테스트 안정성 | 통과 | vitest 전체 3번 모두 863/863. 1회차는 가짜 서버가 데이터를 만드는 중에 같이 돌았다. `end/vitest-{1,2,3}.txt` |
| tsc | 통과 | `npx tsc -b` 종료 0 |
| lint | 통과 | `npm run lint` 경고 **22**(시작 23). PriceChart.tsx 의 only-export-components 1건이 빠졌다 |
| build·첫 화면 JS | 통과(조금 커짐) | index gzip 109.79 → **110.31 kB**(+0.52). 미리 받는 셋까지 합치면 117.90 → 118.73 kB. 시그널 기준 팝업(2.38 kB)은 누를 때 받는다 |
| 응답 사진(기본인 사람) | 통과 | `tools/snapshot.py`(8367, `--reset`) vs `r042/baseline/snap`: 날짜 필드를 뺀 비교에서 **차이 3**, 셋 다 B9(friend 7203.T `name: None → 'トヨタ自動車'` — dashboard·fundamentals·rebalance). 날짜 필드를 빼지 않은 엄격 비교(`s/strictdiff.py`)에서도 나머지 71건은 모두 `checked_at`·`last_ok_at`·`updated_at` 시각이다. 마지막 매수일 등 날짜 값은 같다. 더해진 키는 `knee_buy_v2_default` 뿐이고, 기본인 사람은 null 이다 |
| API 모양 | 통과 | `apidiff.py`: 빠짐 0 · 타입 바뀜 0 · 더해짐 9(PUT·DELETE /api/signal-thresholds, DashboardCard.knee_buy_v2_default, SignalRules.custom·defaults·limits, StockOut.shown_name, 스키마 2). 깊은 비교(`s/apideep.py`, 응답·요청 본문·파라미터·required·필드 스펙 글자)에서 기존 경로 변경 **0** |
| AI 지시문 상수 | 통과 | ai_analysis·ai_portfolio 의 문자열 18개 중 바뀐 것 0(`__file__`·`__cached__` 경로만 다름) |
| 기본인 사람 AI context | 통과 | 289b097 와 3aabeec 가짜 서버에서 owner 20·friend 9 경로(종목별 context·portfolio·research/NVDA·macro·watchlist)가 시각 필드를 빼면 **같다**. `/api/signal-rules` 는 formula 글자 둘(B1 이름, 주인 결정)과 더한 키 셋. `version`(=공용 지문) 은 같아서 0.41→0.42 에 재계산이 돌지 않는다 |
| 대시보드 쿼리 수 | 통과 | `perf_q.py` 20종목×10년: 새 코드 **12건**·35.8 ms, 289b097 **12건**·38.3 ms |
| 0013 올리기·내리기(SQLite) | 통과 | 0.40 DB(실제와 같은 모양 + 설정·알림 줄): `upgrade_to_head` 0012→0013, 백업 1벌, 새 칸 빼고 표 22개 행 수·내용 해시 같음. user 2 에 `{"adx_trend":15}` 를 넣고 `python -m app.tools.downgrade 0012` → "DB 스키마: 0013 → 0012", 백업 1벌. 새 칸 빼고 해시 같음, user_settings DDL 같음 |
| downgrade 도구 경계 | 통과 | 0004 → "0005, 0006 은 되돌릴 수 없습니다" 종료 1 · abc / 모르는 0014 → 거절 종료 1 · 0013→0013·0012→0012 는 아무것도 안 함 |
| 옛 코드가 0012 DB 로 뜨는지 | 통과 | 내린 DB 로 289b097 · 0.40.0 앱이 뜬다(health 200, rev 0012). 0013 DB 로는 둘 다 `ResolutionError '0013'` — DEPLOY 9-2 의 전제와 맞다 |
| 새 코드가 앞선 리비전으로 뜨는지 | 통과 | 0014 로 찍은 DB → 경고 "DB 리비전 0014 는 이 버전이 모릅니다" 후 health 200 |
| 0.40 → 0.42 바로 | **실패(D1)** · 앱 길은 통과 | 앱 길: 0.40 DB 로 새 앱을 띄우면 0013 이 돌고 health 200. `signal_recompute.run_if_changed` = first, 15종목 0줄 바뀜 0.6 s, 두 번째는 None. 모든 사람의 signal_thresholds 는 NULL. 배포 전 비교 도구는 D1 에서 넘어진다 |
| DEPLOY 9·9-2 | 통과(참고 R1) | 9-2 순서(stop app → 새 이미지 downgrade 0012 → 옛 IMAGE_TAG): 이미지에 ENTRYPOINT 가 없어 `run … python -m app.tools.downgrade` 가 시작 마이그레이션 없이 돈다(Dockerfile CMD 만 있음). db 는 켜진 채로 둔다 |
| 입력 한도(살아 있는 서버) | 통과 | 9.5·40.5·20.3·2.5일·0일·21일·true·모르는 키·이격 +0.5·문자열·NaN·Infinity·1e400·배열 → 422. 양 끝(10·40·−20) → 200. 기본값과 같은 값 → custom false. 손님·승인 대기 → 401 |
| 문서·버전 | 통과(참고 R1·R2) | version.py `APP_VERSION="0.42.0"` 와 한 줄 설명 · README 두 줄과 `--demo-custom-thresholds` · ROADMAP 11-2·다음 후보 · SPEC 12장 범위·기본값이 `signal_rules.LIMITS`(10–40/0.5, 0.5–3.0/0.05, −20–0/0.5, 1–20/1)와 같음 |
| 새 .env | 해당 없음 | 더해진 줄에 `os.environ`·`import.meta.env` 없음. compose·Dockerfile 변경 없음 |
| 규제 낱말 | 통과 | docs/rounds 를 뺀 더해진 줄에서 추천·사세요·파세요·팔아·저평가·예측·수익률·순위 검색 → 1건: 0종목 안내의 "평가금액·수익률이 나오고"(내 손익, 옛 문구를 고쳐 쓴 것). orderPlan.ts 에 시그널 우선 배분 없음 |
| 화면 | 통과 | 가짜 서버 8367 `--demo-custom-thresholds`, Chromium(/opt/pw-browsers). owner·friend·new × 1400/390/360 × dark/light × 상승 초록·빨강 = 36 조합. 시그널 보기·포트폴리오 보기·시그널 기준 팝업·차트·리밸런싱(새 돈 1,000,000 넣음)에서 문서 가로 넘침 0, 화면 밖 글자 0, 팝업이 화면 안(폰 0–390/0–360), 콘솔·페이지 오류 0, 팝업 Esc 로 닫힘, 차트 canvas 있음. 스크린샷 `end/shots/`·`end/shots-red/` |
| 마이그레이션 Postgres | 해당 없음(여기서 못 함, R3) | CI Postgres 갈래로 확인한다 |

## 정리
- 가짜 서버(PID 24373·24375)는 껐다. 확인 결과 `ps` 에 fake_server 0개.
- 잠시 이은 `frontend/node_modules` 심볼릭 링크, 빌드한 `frontend/dist`, 테스트가 만든 `backend/logs` 는 지웠다.
- 저장소 밖에 둔 것: pip 로 받은 psycopg(`end/pylib`), 실수로 worktree 에 받은 whl 은 `end/` 로 옮겼다.

## 끝날 때 worktree `git status`
```
HEAD detached at 3aabeec
nothing to commit, working tree clean
```
