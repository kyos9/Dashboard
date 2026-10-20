# 0.44.0 라운드 끝 — 전체 회귀·호환 검토 판정

## 조건부 합격

조건 (둘)
1. **살아남은 뮤테이션 F1 (고쳐야 함, 테스트 한 개)** — `backend/app/routers/rebalance.py:250` 의 `value_record.enabled()` 를 `True` 로 바꿔도 백엔드 전체(1422개)가 통과한다. `SIGNAL_DASHBOARD_VALUE_RECORD=0` 으로 끈 서버도 `GET /api/rebalance/current` 가 `value_record.enabled: true` 를 내보내게 된다. 그러면 화면은 "평가금액은 매일 아침 자동으로 남깁니다 — …"라고 **사실과 다른 안내**를 띄운다. 화면 쪽(`RebalancePanel.test.tsx:927`, enabled=false 면 안 그림)은 테스트가 있다. 서버 쪽은 `value_record.status()` 만 본다(`test_value_record.py:215-220`). API 응답의 `enabled` 를 보는 테스트는 없다. 끈 상태로 `/api/rebalance/current` 를 불러 `enabled is False` 를 확인하는 테스트 하나가 필요하다.
2. **Postgres 확인을 이번에 못 함 (고쳐야 함, 총괄이 돌린다)** — 55441 클러스터가 꺼져 있었다(`connect_ex` → 111). `su postgres -c "pg_ctl …"`·`runuser` 는 이 에이전트의 worktree 격리 가드가 거절했다. 그래서 띄우지 못했다. 가드를 피해 가지 않았다. 마지막 Postgres 전체 실행은 A 두 번째 검토(9c7757f, 1399 passed 1 skipped)다. 그 뒤 백엔드는 `db.py`(init_db 의 치우기, e7e47fa)·`backup.py`(D0)·`scheduler.py`·`admin.py` 가 바뀌었다. D0 검토 때도 클러스터는 꺼져 있었다(D0-review.md:39). **라운드 머리에서 Postgres 전체 pytest 와 0013→0014→0013 을 한 번** 돌려야 한다. 코드를 읽어 본 바로는 위험이 낮다. `sweep_orphans` 는 ORM 의 outerjoin 과 시각 비교뿐이고 넘어져도 init_db 가 삼킨다(db.py:248-262). 그래도 직접 돌린 증거는 아니다.

참고 (조건 아님)
- F2: `APP_VERSION = "0.44.0"` → `"0.43.0"` 으로 바꿔도 테스트가 다 통과한다(`backend/app/version.py:135`). 버전 줄은 라운드마다 손으로 바꾸는 것이라, 버전 값을 박아 두는 테스트는 권하지 않는다. 판정에서 셈하지 않았다. 대신 F4 를 하나 더 돌렸다.
- 서버 로그에는 백업 실패의 원문이 남는다(파일 경로 포함, 주인 전용 로그. 계획대로). Postgres 비밀번호·사용자·DB 이름은 남지 않는다(아래 비밀).

## 검토 대상

- worktree `/home/user/Dashboard/.claude/worktrees/agent-a30a716f3a22db1d6` 를 `git fetch origin claude/new-session-fftcg1` 한 뒤 `git checkout --detach 8589d93` 했다(원격 머리 = 8589d93). 시작점은 4844bf0 이다. `git log 4844bf0..HEAD` 는 커밋 36개, 84 files, +4952 −575 다.
- 4844bf0 은 `git archive 4844bf0 | tar -x` 로 저장소 밖 `r044/final-base4844/` 에 꺼냈다. 오늘(2026-10-20) 그것과 머리를 같은 도구로 찍었다.

## 표

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 회귀 — 백엔드 테스트 | 통과 | `cd backend && python -m pytest -q -p no:cacheprovider` 는 **1422 passed, 3 skipped**(`r044/final-pytest.txt`)다. 기준은 1364 passed 3 skipped 다. `git diff 4844bf0..HEAD -- backend/tests` 에서 지운 `def test_` 는 0, 더한 것은 44 다 |
| 회귀 — 프런트 테스트 | 통과 | `npx vitest run --maxWorkers=2` 는 **58 files, 912 passed**(기준 884)다. 지운 `it(` 은 둘이다. `Dashboard.test.tsx` 신호 칸 테스트와 `StockManager.test.tsx` 평단가 단위 테스트인데, 둘 다 같은 자리에서 이름과 기대값을 바꾼 것이다(B 주인 결정 "이름표 두 줄", C3 "고르기 전 단위 없음"). 줄어든 테스트는 0 이다 |
| 회귀 — lint·tsc·빌드 | 통과 | `npm run lint` 경고 **22**(기준 22). `npx tsc -b` 종료 0. `npm run build` 첫 화면 `index-CbVR8jxi.js` 는 **111.19 kB gzip**(기준 111.04, +0.15 kB, B·C 의 Dashboard·client 변경) |
| 회귀 — 응답 사진 | 통과 | `snapshot.py` 로 4844bf0(포트 8181)과 머리(8182)를 오늘 찍었다. owner/friend × 5 경로다. `snapdiff.py final-snap-base final-snap-head` 는 **같음 / 차이 0** 이다. 머리에만 있는 칸은 `rebalance_current` 의 `value_record` 하나다(A 가 더한 것). 참고로 며칠 전 기준 사진과 비교하면 차이가 960 이다. 가짜 시세의 날짜(roc5·stddev20·price …) 때문이고, 그래서 오늘 다시 찍었다. 새 설정은 기본값이다(`env` 에 `SIGNAL_DASHBOARD_*` 없음) |
| AI 지시문 상수 | 통과 | `ai_consts.py` 결과를 baseline 과 견주면 키 18개 중 다른 것은 `__file__`·`__cached__`(worktree 경로) 넷뿐이다. 실제 지시문 14개는 같다. `git diff --stat 4844bf0..HEAD -- 'backend/app/services/ai*'` 는 비어 있다 |
| 호환 — API 모양 | 통과 | `apidiff.py baseline/openapi.json final-openapi.json` 은 **빠짐 0, 타입 바뀜 0**, 더해짐 3(`GET /api/admin/records`, `RebalanceCurrentOut.value_record`, `schema ValueRecordOut`)이다. 오늘 4844bf0 에서 뽑은 openapi 는 baseline 과 같은 객체다(`a==b` True). `value_record` 는 `anyOf[ValueRecordOut, null]` 이고 필드에 기본값이 다 있다 |
| 호환 — 새 화면이 옛 응답을 받을 때 | 통과 | `RebalancePanel.test.tsx` 의 `CURRENT`(35행)에는 `value_record` 가 없다. 그래서 그 파일의 다른 테스트는 모두 옛 응답으로 패널을 그린다. `:927` 은 `record={undefined}` 면 빈 칸이다. 진단 창은 `DiagnosticsModal.test.tsx:157`(records 경로 없음), `:231`(404), `:314`(`backup` 칸 없음)이다. `types.ts:477` 는 `value_record?: … \| null` 이다 |
| 호환 — 서버가 옛 요청을 받을 때 | 통과 | 요청 스키마에 더해지거나 바뀐 필드가 없다(apidiff 더해짐 셋은 모두 응답이다). 새 경로는 입력이 없는 GET 하나다 |
| 격리 | 통과 | `test_isolation.py:144` `("GET","/api/admin/records"): (SHARED, OWNER)`, `:1022` 는 사용자 → 403 표다. `/api/rebalance/current`(MINE) 의 `value_record` 는 `:710` 이 남의 날을 세지 않는 것을 본다. 전체 실행에서 통과했다 |
| 마이그레이션 — SQLite | 통과 | `r044/final-mig/run.py` 를 썼다. 4844bf0 가짜 서버가 만든 실제 모양 DB(0013, 표 21개: price_daily 18780·indicator_daily 18780·signal_daily 18780·macro_value 5879·fundamental_fact 840·users 4 …)로 올렸다. **0013→0014**: 새 표 `portfolio_value_daily` 하나, 기존 21표의 행 수·내용 해시는 그대로다. `record_day` 는 3명 중 2줄을 썼다(written 2). **0014→0013**(`migrate.downgrade_to`): 21표의 행 수·해시가 시작과 같고 0014 표는 사라졌다. premigrate 백업이 떠졌다(백업 안에 2줄). 다시 0014 로 올리면 기록은 0줄이다(되살아나지 않는다는 문서와 맞다) |
| 마이그레이션 — Postgres | **못 함 → 조건 2** | 위 사정. 리비전 파일·문서는 확인했다. 0014 내리기가 기록을 지운다는 것은 `0014_portfolio_value_daily.py:1-8`, `DEPLOY.md:341,365`, `migrate.py:49-51`(`DATA_ON_DOWNGRADE`, 백업에 성공해야만 내림)에 적혀 있다 |
| 입력 한도 | 해당 없음 | 새로 받는 값이 없다(새 경로는 인자 없는 GET 하나, 요청 스키마 변경 0) |
| 뮤테이션 (직접) | **1 살아남음 → 조건 1** | 저장소 복사가 아니라 worktree 를 겨누도록 `mutate.py` 의 `REPO` 만 바꾼 사본(`r044/final-mut/mutate.py`)을 썼다. **F1** `routers/rebalance.py` `enabled()`→`True` : **살아남음**(백엔드 전체 -x 통과). **F3** `pages/Policy.tsx` 5절 탈퇴 문장에서 "서버가 날마다 남긴 평가금액 기록" 빼기 : 잡힘(vitest). **F4** `services/rebalance.py:251` `prices[0].date`→`prices[-1].date` : 잡힘. (F2 버전 줄은 참고에 따로 적었다.) 고른 곳은 항목 뮤테이션 표(A·D0-mutation.md)에 없는 곳이다. 돌린 뒤 `git status` 는 깨끗하다 |
| 비밀 | 통과 | `r044/final-secret/run.py`. ① Postgres 주소 `SENTINEL-user-91:SENTINEL-pw-91@127.0.0.1:1/SENTINEL-db-91` 로 실제 `pg_dump`(16) 실패. ② SQLite 파일 경로에 `SENTINEL-missing-91`. ③ 백업 폴더를 `SENTINEL-file-91` 파일 아래로(쓰기 실패). 이 셋에서 `backup.status()`(= `/api/admin/records` 의 `backup`) 의 SENTINEL 은 **0** 이다. 사유는 "pg_dump 가 실패했습니다 / DB 파일을 찾지 못했습니다 / 파일을 쓰지 못했습니다" 다. 상태 파일 `backup-status.json` 도 0 이다. 서버 로그에는 경로 속 SENTINEL 3건(file·missing)이 있고, `pw-91`·`user-91`·`db-91` 은 0 이다(PGPASSWORD 로 넘기고 주소에서 뺀다, `backup.py:128-139`). DB 에는 백업 실패가 쓰지 않는다 |
| 규제 | 통과 | `git diff 4844bf0..HEAD -- backend/app frontend/src backend/devtools` 의 더한 줄에서 `추천\|사세요\|팔라\|저평가\|예측\|수익률\|이겼\|앞섰\|벌었` 를 찾으면 3건이다. 모두 주석이다: `value_record.py` 모듈 설명 "시간가중 수익률은 … 낼 수 있지만"과 `display.ts:290`·`Dashboard.tsx:99,1520` 의 "팔라는데 사라고도?"(왜 바꿨는지 설명). 화면 문자열·AI 지시문은 0건이다. 새 화면 글은 날 수("…부터 12일째")와 합계 줄 수만 보이고 금액·수익률은 없다 |
| 데이터 경계 | 통과 | `portfolio_value_daily` 는 사용자별이다(user_id FK CASCADE, (user_id,date) 유일). 공용 표는 바꾸지 않는다. 주인 진단(`value_record.status`)은 마지막 날짜·그날 사람 수·줄 수만이다(`value_record.py:188-202`). `my_days` 는 user_id 로 거른다 |
| 외부 호출 | 통과 | `portfolio_valuation`→`fx.get_rates` 는 DB 만 읽는다(`fx.py get_rates` 에 fetch/requests 없음). 사람 수만큼 늘어나는 외부 호출이 없다 |
| 화면 | 해당 없음(이번) | 항목 검토 A·B·C·D0 이 PC 1400·폰 390/360 × 두 테마를 봤다(status.md). 이번 끝 검토는 빌드 통과만 확인했다 |
| 가짜 서버 | 통과 | `test_devtools.py` 는 전체 실행 안에서 통과했다(`test_demo_has_daily_value_records` :229 포함). 응답 사진을 찍을 때 두 버전 모두 떴다 |
| 문서 | 통과 | README:72-83 v0.44.0 세 절, DEPLOY 9-2·9-3·10, 방침 1·5절과 `POLICY_EFFECTIVE='2026-10-16'`(F3 가 잡음), `version.py` 0.44.0 줄 |

## 돌린 명령 (요지)

```
git fetch origin claude/new-session-fftcg1 && git checkout -q --detach 8589d93
cd frontend && npm ci --offline && npx tsc -b && npm run lint && npm run build && npx vitest run --maxWorkers=2
cd backend && python -m pytest -q -p no:cacheprovider                     # 1422 passed, 3 skipped
(4844bf0 사본/backend) python tools/snapshot.py r044/final-snap-base 8181
(머리/backend)         python tools/snapshot.py r044/final-snap-head 8182
python tools/snapdiff.py r044/final-snap-base r044/final-snap-head           # 같음 / 차이 0
python tools/apidiff.py r044/baseline/openapi.json r044/final-openapi.json  # 빠짐 0 · 바뀜 0 · 더해짐 3
PYTHONPATH=. python tools/ai_consts.py r044/final-ai_consts.json             # 경로 키 넷만 다름
PYTHONPATH=. python r044/final-mig/run.py at0013.db work.db                  # SQLite 0013→0014→0013
PYTHONPATH=. python r044/final-secret/run.py r044/final-secret/w1            # 응답 SENTINEL 0
python r044/final-mut/mutate.py muts.json / muts2.json                       # F1 살아남음, F3·F4 잡힘
```

## 끝 정리

- 띄운 서버: 가짜 서버는 `snapshot.py` 가 스스로 띄우고 `terminate()` 로 껐다(8181, 8182). 끝에 `ps aux | grep "[f]ake_server"` 는 0줄이다. Postgres 는 띄우지 못했으므로 끌 것도 없다. pkill·killall 은 쓰지 않았다.
- 저장소 밖에만 썼다: `r044/final-*`(pytest·vitest·lint·build·tsc·openapi·ai_consts·snap·mig·secret·mut).
- worktree `git status`:

```
HEAD detached at 8589d93
nothing to commit, working tree clean
```
(`frontend/node_modules`·`dist` 는 .gitignore 대상이다.)
