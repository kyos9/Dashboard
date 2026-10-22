# 0.45.0 B 검토 — 알림 아침/오후 고르기 · 종목별 끄기 (0015)

## 불합격

worktree `9be090b`(origin/claude/new-session-fftcg1)에서 시작 `812eb5e` 와 비교했다. B 커밋은 5909ad8·24e5411·d52fbaa·9be090b 와 08a7aa4 의 시험 한 개다.

**불합격인 까닭 두 가지 (고치기는 작다)**
1. **백엔드 시험 하나가 늘 실패한다.** 08a7aa4 가 더한 `tests/test_push.py::test_get_shows_only_muted_stocks_still_in_my_list`(941행)는
   `db.get(UserSettings, LOCAL_USER_ID)` 가 `None` 이라 `AttributeError` 로 넘어진다. 그 앞에서 설정 행을 만드는 요청(GET `/api/push/settings` 등)이 없어서다.
   전체 실행: `1 failed, 1478 passed, 3 skipped`. 따로 돌려도 같다. 이대로면 CI 가 빨갛다.
   status.md 의 "백엔드 1479"는 이 시험이 통과한 것으로 센 수다.
2. **그래서 뮤테이션 "GET 이 내 목록 밖도 보임"은 실제로는 살아남는다.** B-mutation.md 는 "시험 더한 뒤 잡힘"이라 적었다. 그런데 그 시험은 뮤테이션과
   상관없이 넘어지므로 잡은 것이 아니다. 이 시험을 빼고 돌리면 `push.py:73` 의 `[t for t in prefs["muted"] if t in mine]` → `list(prefs["muted"])` 가 **살아남음**이다.

고칠 길(참고, 검토자는 고치지 않았다): 그 시험에서 `client.get("/api/push/settings")` 로 행을 먼저 만들거나 `settings_service.get_settings(db, …)` 를 쓴다. 그 뒤 뮤테이션을 다시 돌린다.

Postgres 검사는 못 했다(아래 "마이그레이션"). 총괄이 돌려야 한다.

---

## §3 표

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 완료 조건 | 통과(시험 하나 빼고) | 아래 "완료 조건과 특히 볼 것" |
| 계획 때 걱정 | 통과 | 아래 "계획 걱정" — B 에 막음은 없다. "반영"이라 한 것은 모두 코드에 있다 |
| 회귀 | **실패** | `cd backend && python -m pytest -q` → `FAILED tests/test_push.py::test_get_shows_only_muted_stocks_still_in_my_list` · `1 failed, 1478 passed, 3 skipped`(시작 1425 passed). 원인은 `AttributeError: 'NoneType' object has no attribute 'push_prefs'`(test_push.py:941). 프런트 `npx vitest run` → `942 passed`(시작 912). 응답 사진은 같은 날 812eb5e 에서 다시 떠서 비교했다(시작 사진은 10-20 데모라 날짜 때문에 970곳이 다르다). `snapdiff snap0 snap1` → `같음 · 차이 0` |
| 격리 | 통과 | 새 경로는 없다(기존 `PUT/GET /api/push/settings` 에 칸만 더했다). `test_isolation.py:808-830` 은 B 의 GET 모양과 "A 만 담은 VOO 를 B 가 끌 수 없다 → 400, A 의 push_prefs 는 None"을 본다(통과). 가짜 서버에서 친구가 주인만의 종목 `QQQ` 를 끄면 `400 내 목록에 없는 종목입니다.`, 주인 설정은 그대로다. 손님·대기 GET/PUT → 401. 탈퇴: `push_prefs` 는 `user_settings` 칸이라 탈퇴 때 행이 통째로 지워진다(`routers/auth.py:385` 의 목록에 UserSettings 가 있다). `check_withdraw`(user_id 칸이 있는 모든 표) 통과 |
| 마이그레이션 | SQLite 통과 · **Postgres 못 함** | 아래 "0015" |
| 호환 | 통과 | `apidiff baseline/openapi.json → 지금`: `빠짐 0`, 더해짐 `KindsIn.slots`·`KindsIn.muted`(+C 의 `DashboardCard.sell_conditions`). 타입이 바뀐 것은 `KindsIn.kinds` 하나로, 필수에서 선택(null 허용)이 됐다. 요청 쪽이 넓어진 것이라 옛 화면에 해가 없다. 옛 화면 PUT `{"kinds":[…]}` → 200, slots·muted 는 그대로다(`test_push.py` test_api_slots_and_muted + 가짜 서버 probe). 새 화면 ↔ 옛 서버: `settings?.slots`·`settings?.muted` 가 없으면 두 칸을 그리지 않는다(PushModal.tsx:228, :262). 화면 시험이 있고 실행자 뮤테이션 "옛 서버에도 받을 때"가 잡혔다 |
| 입력 한도 | 통과 | 가짜 서버(친구)에서: 없는 때 `["night"]` → 400 "없는 알림 때입니다." · `slots: []` → 400 "아침·오후 중 하나는…" · slots 3개 → 422 too_long · muted 201개 → 422 too_long · muted 10만 자 문자열 → 400 "내 목록에 없는 종목" · muted `[1]` → 422 · muted `"VOO"`(목록 아님) → 422 · 모르는 칸 `quiet_start` → 422 extra_forbidden · 빈 몸 `{}` → 200(바뀌는 것 없음) · 친구가 `signup` 종류 → 400. 종목마다의 글자 수 한도는 없지만 내 목록에 있는지로 걸러진다 |
| 뮤테이션 | **실패(살아남음 1)** | 아래 "뮤테이션" |
| 비밀 | 해당 없음 | 새 키·비밀을 다루지 않는다 |
| 규제 | 통과 | B 가 더한 화면 문자열(PushModal.tsx:22-25, 255-258, 288)과 방침 줄(Policy.tsx:54-55)에 "추천·사세요·팔라·저평가·예측·수익률"이 없다. 규제 영향 항목도 아니다 |
| 데이터 경계 | 통과 | `user_settings.push_prefs` 는 사용자별이고 다시 만들 수 있는 설정이다. 공용 표는 건드리지 않는다. 판정 상태(`push_state`)는 사용자별 그대로 |
| 외부 호출 | 통과 | 새 외부 호출이 없다. 받지 않는 때는 그 사람 판정을 건너뛰어 오히려 줄어든다 |
| 화면 | 통과 | 빌드(`npm run build` → index gzip 111.72 kB) 뒤 가짜 서버 8184 에서 Playwright 로 봤다. 주인 1400·390·360 × 밝게/어둡게 6가지 모두 "받을 때" 아침 ☐ · 오후 ☑(끌 수 없음) · "종목별 알림 — 1종목 끔" · 펼치면 SCHD 만 꺼져 있다. 가로 넘침 0, 콘솔 오류 0(1400 밝게의 1건은 일부러 낸 500). 아침을 켜면 서버가 `[morning, afternoon]`, 오후 체크가 다시 풀린다. 되돌리면 `[afternoon]`. PUT 500 을 흉내 내면 체크가 되돌아간다. 친구: 둘 다 ☑, "가입 신청 알림은 바로 갑니다" 줄 없음, "모두 받음". 처음 온 사람: "받을 때"는 있고 종목별 칸은 없다(종목 0). 손님·대기: 🔔 0개. 키보드: Tab 으로 아침 체크·summary·종목 체크 16곳에 닿는다(끌 수 없는 오후는 disabled 라 건너뛴다). 사진 `scratchpad/r045/Brev/shots/` |
| 말 | 통과 | 용어집 두 줄 더함("받을 때 — 아침 (7:30쯤) / 오후 (4시쯤)", "종목별 알림"). 화면 말과 같다. README "알림 (v0.23.0)" 절(README.md:560)은 아직 이 기능을 말하지 않는다. 라운드 끝 README 몫이라 참고로 둔다 |
| 성능 | 통과 | 대시보드 경로는 그대로다(응답 사진 차이 0). run_daily 에 사람마다 `db.get(UserSettings)` 하나, GET 설정에 티커 조회 하나가 늘 뿐이다 |
| 가짜 서버 | 통과 | 데모 주인 오후만·SCHD 끔(fake_server.py:705-711). `test_devtools.py` 가 `(["afternoon"], ["SCHD"])` 를 본다. 전체 실행에서 통과 |
| 문서 | 통과(참고 1) | 방침 "알림을 켰을 때" 줄에 받을 때·끈 종목이 들어갔다. 시행일 `POLICY_EFFECTIVE = '2026-10-20'`(A 가 바꿈, 같은 배포) · DEPLOY 9-4(되돌릴 때 내리지 않음, 내리면 칸만, 백업 조건 없음) · 용어집. README 는 위 "말" 칸 참고 |

---

## 완료 조건과 특히 볼 것

**주인 말과 총괄 해석.** 주인 말은 "두 번의 알림이니까 사용자가 직접 선택할 수 있게 하기"다. 해석(아침/오후 체크 두 개, 기본 둘 다, 둘 다 끄기 거절, 받지 않는 때의 신호는 다음 때 모아)은 이 말과 맞는다. "모아 받기"는 질문 2(나)의 문장("아침 알림을 받지 않고 오후에 모아 받기")에 이미 있던 뜻이라 주인이 본 보기와도 어긋나지 않는다. 둘 다 끄기를 거절하는 것은 총괄이 덧붙인 것이다. 화면이 마지막 하나를 disabled 로 막고 서버는 400 으로 막는다. 무리가 없다.

**"받지 않는 때는 건너뛰고 상태를 적지 않아 다음에 모아 간다" — 실제 스케줄에서**
- 판정은 시세 갱신 끝에 `_send_alerts → alerts.run_daily(db)` 로 돈다(scheduler.py:55-69). `now` 를 넘기지 않으므로 **판정할 때의 실제 시각**으로 때를 정한다(alerts.py:326).
- 07:30 KST(22:30 UTC, 미국+전체 갱신): misfire 유예 1시간(scheduler.py:252)에 갱신 시간을 더해도 12시 전이라 아침이다. 4시간 넘게 걸려야 오후로 넘어가는데, 그럴 일은 낮다.
- 16:00·16:30 KST(일본·한국): 유예를 더해도 17시 남짓이라 오후다.
- 켤 때 따라잡기(scheduler.py:105-129): 받아 온 것이 있을 때만 판정하고, 그 시각의 때를 따른다. 경계는 `5 <= hour < 12`. 시험(test_slot_of_is_the_korean_time)이 04:59·05:00·11:59·12:00·시간대 있는 값을 본다. 12–16시에 켜서 미국 갱신을 따라잡으면 "오후"로 간다. 아침만 받는 사람은 다음 날 아침에 받는다(그때도 켜져 있으면). 정한 규칙 그대로다.
- 건너뛸 때는 `_changes` 앞에서 `continue` 한다(alerts.py:331-333). 그래서 `push_state` 를 적지 않는다. test_skipping_mornings_saves_it_for_the_afternoon 이 아침 뒤 `PushState is None`, 오후에 VOO 한 번, 다시 돌리면 0번인 것을 본다. 반대 방향 시험도 있다.
- 예외 하나(참고): 받지 않는 때 사이에 시그널 기준을 바꾸면 `record_buy_state_quietly`(signal_rules.py:37)가 매수 상태를 조용히 적는다. 그동안 켜진 매수는 다음 때 가지 않는다. 0.42 의 "기준을 바꾼 순간은 조용히" 약속과 같은 동작이라 결함으로 보지 않는다.

**끈 종목의 상태는 적히나** — 적힌다. `_changes` 가 먼저 모든 값을 적고, 그 뒤 `compose` 가 끈 종목의 `buy:`·`band:` 만 뺀다(alerts.py:283-284). 다 빠져 message 가 None 이어도 상태는 이미 커밋됐다. test_a_muted_stock_is_not_told_but_is_remembered 가 다시 켠 뒤 0건(쏟아지지 않음)을 본다. 리뷰는 종목 단위가 아니라 그대로 간다.

**옛 화면 PUT(kinds 만)·옛 서버 응답** — 위 "호환" 칸.

**0015**
- SQLite, 실제 모양 데이터: 812eb5e 가짜 서버가 만든 데모 DB(0014, 표 23개, 6만 3212행, user_settings 2행)를 복사해 올렸다(`scratchpad/r045/Brev/migtest.py`).
  `upgrade → 0015 · counts same: True · prefs values: {None} · other cols same: True`. 한 행에 prefs 를 넣고
  `downgrade → 0014 · counts same: True · push_prefs col: False · rows same: True`, 다시 올리면 `0015`.
  저장소 시험 test_migration_0015.py 3개(올리기·백업 없이 내리기·옛 이미지)도 전체 실행에서 통과. `DATA_ON_DOWNGRADE`·`IRREVERSIBLE` 에 0015 가 없다. 설정 칸이라 맞다. DEPLOY 9-4 와 같다.
- 옛 이미지: worktree 를 812eb5e 로 돌려 0015 DB 를 열었다. `old code knows 0015: False` · "DB 리비전 0015 는 이 버전이 모릅니다 … 그대로 씁니다" · `upgrade_to_head -> 0015` · 옛 ORM 으로 user_settings 읽기·쓰기 문제없음. 그 뒤 9be090b 로 돌렸다.
- **Postgres: 못 했다 — 총괄이 돌릴 것.** 55441 이 꺼져 있다(`Connection refused`). `pg_ctl` 은 root 로 못 돌고, postgres 사용자로 띄우는 것은 권한 분류기가 막았다. 우회하지 않았다. 돌릴 것:
  `cd backend && PYTHONPATH=/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r044/revA/pylib TEST_DATABASE_URL=postgresql+psycopg://postgres@127.0.0.1:55441/postgres python -m pytest -q tests/test_migration_0015.py tests/test_migration_0014.py tests/test_alembic.py tests/test_push.py tests/test_isolation.py`
  (test_push 의 깨진 시험은 Postgres 에서도 넘어진다.) 0015 는 `batch_alter_table` 의 JSON 칸 더하기·지우기 하나라 Postgres 에서 걸릴 곳은 낮아 보인다.

**탈퇴 · 방침** — 위 "격리"와 "문서" 칸.

## 계획 걱정 (plan.md B 표 · 주인 답 2)

| 걱정 | 반영 확인 |
| --- | --- |
| 시각 고르기 오해 · 23.5시간 창 | 해당 없어짐(주인 답 2 — 때 두 개에서 고름). 둘 다 끄기는 400(push.py:100-106) |
| 그 사이 꺼진 신호는 안 온다 | 문구 "받지 않는 때 생긴 신호는 다음에 받는 때 알려 드립니다 — 그때도 켜져 있는 것만."(PushModal.tsx:255) |
| 가입 신청 알림·시험 알림은 즉시 | `notify_signup`·`/test` 는 run_daily 밖이라 때와 상관없다. 화면 풀이는 관리자에게만(9be090b, 친구 화면에 없음 확인) |
| `run_daily(now=None)` | 반영(alerts.py:310, 326) |
| muted 한도 = 내 목록 + 200 | 반영(push.py:43, 109-116, alerts.py:57). 201개 → 422 |
| 400 + 한국어, kinds 선택, 모르는 키 거절 | 반영. 모양 오류(목록 길이·타입·모르는 칸)는 422(pydantic)다. 0.44 에서도 kinds 길이 초과는 422 였으니 같은 모양이다 |
| 지웠다 다시 담으면 되살아나나 | purge 때 muted 에서 뺀다(stocks.py:351-356). test_purging_a_stock_unmutes_it |
| 360 에 15종목 | 접힌 `<details>`, 끈 수만 보인다. 360×640 넘침 0 |
| 켠 상태 화면 | 화면 시험이 흉내 낸다. 주인 실기기 확인 목록 몫 |
| signal_diff 가 끈 종목을 모름 | 그대로(적어 둠) |

## 뮤테이션

실행자 것 다시(깨진 시험을 `-k 'not test_get_shows_only_muted_stocks_still_in_my_list'` 로 빼고, test_push·test_isolation·test_devtools):

| 뮤테이션 | 결과 |
| --- | --- |
| 아침 경계 5→6 · 받지 않는 때도 보냄 · 받지 않는 때 상태를 적음 · 끈 종목 안 거름 · 끈 종목 비중 안 거름 · 남의 종목 허용 · 둘 다 끄기 허용 · 기본이면 NULL 안 됨 · 지울 때 muted 그대로 | 9개 모두 잡힘 |
| **GET 이 내 목록 밖도 보임**(push.py:73) | **살아남음**. 실행자의 "잡힘"은 깨진 시험 덕이다 |
| kinds 만이면 prefs 다시 씀(`if True:`, push.py:92) | 살아남음. **동등이 맞다**: 저장값을 `prefs_of` 로 고른 뒤 같은 값(기본이면 NULL)을 다시 쓸 뿐이다. 이상한 저장값(빈 slots·모르는 키)이 정리되는 차이는 있지만 읽는 뜻은 같다 |

직접 3줄 이상:

| 뮤테이션 | 결과 |
| --- | --- |
| 아침 끝에 12시 포함(`hour <= 12`, alerts.py:82) | 잡힘 |
| muted 중복을 안 지움(`list(payload.muted)`, push.py:116) | 잡힘 |
| 끈 종목 한도 200→1000(alerts.py:57) | 잡힘 |
| `prefs_of` 가 빈 slots 를 둘 다로 안 바꿈(alerts.py:90) | 살아남음 — API 로는 빈 slots 를 저장할 수 없어(400) 방어 줄이다. 참고 |

주의: 처음에는 깨진 시험이 든 채로(`-x`) 돌렸는데, 그러면 무엇이든 "잡힘"이 된다. 위 표는 모두 그 시험을 빼고 다시 돌린 결과다(`scratchpad/r045/Brev/mut-out2.md`, `mut-out3.md`). 실행자의 백엔드 뮤테이션도 08a7aa4 뒤에 돌렸다면 같은 이유로 거짓 "잡힘"이 섞였을 수 있다. 그래서 위에서 모두 다시 돌렸다.

## 참고 (막지 않음)

1. **숨긴 종목을 끈 채로 두면 수가 어긋난다.** 주인이 SCHD 를 숨기면(`DELETE /api/stocks/SCHD` → active=false) GET `muted` 는 여전히 `["SCHD"]` 다(서버의 `mine` 은 숨긴 것도 포함). 화면 목록은 숨긴 종목을 빼므로 "1종목 끔"인데 꺼진 줄이 하나도 없다(가짜 서버에서 확인).
2. 아침 줄의 풀이 "미국 종목"을 보면, 아침을 끄면 미국 종목 알림이 아예 안 온다고 읽을 수 있다. 실제로는 오후에 모아 간다. 아래 풀이 문장이 설명하고 있으니 사용자 확인에서 볼 것.
3. 끌 수 없는 마지막 칸(disabled)에 왜 끌 수 없는지 풀이가 없다. "알림을 아예 끄려면…"은 서버 400 문구에만 있다.
4. purge 뒤 남은 prefs 가 기본 모양(`{"slots":[둘 다],"muted":[]}`)이어도 NULL 로 돌아가지 않는다(stocks.py:354-356). 뜻은 같다.
5. README "알림" 절(README.md:560)에 이 기능이 아직 없다. 라운드 끝 문서 정리 몫.

## 끝 정리

- 가짜 서버(8184, pid 6195): `kill $(cat …/Brev/fake.pid)` 로 껐다. `ps -p 6195` 결과 없음, `curl …/api/health` → 연결 안 됨(000). 응답 사진용으로 snapshot.py 가 띄운 서버 둘은 스크립트가 스스로 껐다.
- 잠깐 걸어 둔 `frontend/node_modules` 링크는 지웠다. worktree 는 812eb5e 로 잠깐 돌렸다가 `9be090b` 로 돌려놓았다. 뮤테이션은 도구가 매번 원래대로 돌렸고, 손으로 한 sed 하나는 `git checkout` 으로 되돌렸다.
- 무시 목록에 든 산출물(`frontend/dist`, `backend/backups`, `backend/logs`, `__pycache__`)이 남아 있다. git 이 보지 않는다.
- `git status`:

```
HEAD detached at 9be090b
nothing to commit, working tree clean
```
