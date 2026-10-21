# 0.45.0 B 두 번째 검토 — 알림 받을 때 고르기 · 종목별 알림 (0015)

## 조건부 합격

worktree 를 `origin/claude/new-session-fftcg1` 머리 `15009f6`("B 검토 불합격 고침: 숨긴 종목은 끈 수에서 빼기 …")에 맞췄다(`git fetch` 뒤 `git log -1` → `15009f647dfd…`).
B 의 서버 코드(push.py·alerts.py·stocks.py·모델·0015)는 앞 검토(9be090b) 뒤로 바뀌지 않았다(`git diff 9be090b HEAD --stat -- backend` 에 B 서버 파일이 없고, B 시험은 test_push.py 4줄뿐이다).

**앞 검토의 불합격 조건 두 가지는 모두 풀렸다.**
1. `test_get_shows_only_muted_stocks_still_in_my_list` — a8dce22 에서 `db.get(UserSettings, …)` 를 `get_settings(db, LOCAL_USER_ID)` 로 바꿨다(test_push.py:940-943). 따로 돌려 `1 passed`, 전체에서도 통과(`1483 passed, 3 skipped`, FAILED 0).
2. "GET 이 내 목록 밖도 보임"(push.py:73 → `list(prefs["muted"])`) — 이제 **진짜로 잡힌다**. 그 시험 하나만 돌려도 잡히고, 그 시험을 빼면 살아남는다. 그러니 잡는 것은 바로 이 시험이고, 이제는 이 시험이 그냥 넘어지지 않는다(뮤테이션 없이 통과). 앞 검토 "참고 1"(숨긴 종목을 끈 채로 두면 수가 어긋남)도 15009f6 에서 고쳤고, 가짜 서버에서 확인했다.

**남은 조건 두 가지 (작다, 막지 않음)**
1. **뮤테이션 하나가 살아남는다**: PushModal.tsx:273 `off > 0` → `off >= 0`(끈 것이 없어도 "0종목 끔"). 15009f6 이 다시 쓴 줄인데 화면 시험이 "모두 받음"을 어디에서도 보지 않는다(`grep '모두 받음' frontend/src/components/*.test.tsx` → 0건). 숨긴 종목만 끈 경우(OLD)에 "모두 받음"이 나오는지 보는 시험 한 줄이면 된다. RULES §3 뮤테이션 합격 기준이 "살아남은 것 0"이라 조건으로 둔다.
2. **말: 옛 말이 남아 있다.** B 사용자 확인 뒤 a8dce22 가 때 설명에서 "미국 종목"을 뺐다(PushModal.tsx:23-25, "두 번 모두 모든 종목을 본다"). 그런데 같은 창 맨 아래 줄(PushModal.tsx:299-301, 0.23 때 줄)이 아직 "미국 종목은 한국 아침, 한국 종목은 오후"라고 한다. 사용자가 헷갈렸던 바로 그 읽기("아침을 끄면 미국 종목 알림이 안 온다")를 그 줄이 다시 부른다. 390 어둡게 사진에서 "받을 때" 칸과 같은 화면에 함께 보인다(`r045/Brev2/shots/owner-390-dark.png`). 문장을 고치거나(예: "시세를 받은 다음에 옵니다 — 받는 때는 위에서 고릅니다") 그대로 둘 까닭을 적는다.

---

## §3 표

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 완료 조건 | 통과 | plan.md B + 주인 답 2 — 앞 검토가 본 서버 동작은 바뀐 줄이 없다. 깨졌던 시험이 고쳐져 완료 조건 시험이 모두 초록이다 |
| 계획 때 걱정 | 통과 | 앞 검토 표 그대로다(바뀐 서버 줄 없음). 막음 0 |
| 회귀 | 통과 | `cd backend && python -m pytest -q` → `1483 passed, 3 skipped`, FAILED 0(`r045/Brev2/pytest.txt`). 시작 1425. Postgres(총괄 `r045/pytest-pg.txt`) `1485 passed, 1 skipped` — Postgres 에서만 도는 시험 2개 차이라 맞다. `npx vitest run` → `Test Files 61 passed · Tests 943 passed`(시작 912, 앞 검토 942 → +1 은 a8dce22 쪽). 응답 사진: 대시보드 경로 코드가 9be090b 뒤로 바뀌지 않아 앞 검토의 `snapdiff 차이 0` 이 그대로 맞다(다시 뜨지 않았다) |
| 격리 | 통과 | 바뀐 줄 없음. 이번 전체 실행에서 test_isolation 통과. Postgres 에서도 통과(아래) |
| 마이그레이션 | 통과 | 55441 이 떠 있어서 직접 돌렸다: `PYTHONPATH=…/r044/revA/pylib TEST_DATABASE_URL=postgresql+psycopg://postgres@127.0.0.1:55441/postgres python -m pytest -q tests/test_migration_0015.py tests/test_migration_0014.py tests/test_alembic.py tests/test_push.py tests/test_isolation.py` → `170 passed in 43.42s`(같은 묶음을 SQLite 로 돌리면 `170 passed in 19.12s` — 시간이 달라 Postgres 에서 돈 것이다). 총괄의 0013→0015→0014→0013→0015(`r045/pgmig/out.txt`)는 `push_prefs` 보존, 내리기에 백업 조건 없음, 행 수 같음이다. SQLite 는 앞 검토 통과 그대로 |
| 호환 | 통과 | 서버 API 는 바뀌지 않았다. 15009f6 은 화면에서 세는 방법만 바꿨다. 옛 서버(칸 없음)면 두 칸이 없다는 시험이 그대로 있고 통과한다 |
| 입력 한도 | 통과 | 바뀐 줄 없음(앞 검토 통과) |
| 뮤테이션 | **실패(살아남음 1, 위 조건 1)** | `MUT_REPO=<worktree> python tools/mutate.py r045/Brev2/muts.json r045/Brev2/mut-out.md` 결과는 아래 "뮤테이션" |
| 비밀 | 해당 없음 | 새 키·비밀을 다루지 않는다 |
| 규제 | 통과 | 바뀐 문구 "(하나는 받아야 합니다)", "끈 때 생긴 신호는 버리지 않고 …", "밤사이 미국 장 시세를 받은 뒤", "모두 받음/N종목 끔"에 금지어가 없다 |
| 데이터 경계 | 통과 | 바뀐 줄 없음 |
| 외부 호출 | 통과 | 바뀐 줄 없음 |
| 화면 | 통과 | `frontend` 에서 `npm run build`(index gzip 111.71 kB) 뒤 가짜 서버 8186(새 데이터 폴더). Playwright: 주인 360 밝게에서 처음엔 "종목별 알림 — 1종목 끔", SCHD(끔). `DELETE /api/stocks/SCHD` → 200, active=false. GET 은 여전히 `muted:["SCHD"]`. 다시 열면 **"모두 받음"**, 목록에 SCHD 없음. 거기서 VOO 를 끄면 서버 `["SCHD","VOO"]`(숨긴 것도 남는다) · "1종목 끔". 다시 켜면 `["SCHD"]` · "모두 받음". 1400 어둡게·390 어둡게(주인), 360 밝게(친구): 가로 넘침 0, 콘솔 오류 0. 못 끄는 오후 칸에 "(하나는 받아야 합니다)", 친구에게는 가입 신청 줄이 없고 못 끄는 칸 문구도 없다(둘 다 켜져 있어서). 펼침 삼각표시가 보인다(`r045/Brev2/shots/`). 키보드·여섯 조합 전체는 앞 검토가 보았고, 15009f6 은 글자만 바꿨다 |
| 말 | **실패(위 조건 2)** | PushModal.tsx:299-301 의 "미국 종목은 한국 아침, 한국 종목은 오후"가 a8dce22 의 고침(:23)과 어긋난다 |
| 성능 | 통과 | 화면에서 거르기 한 번(종목 수 × 끈 수, 200 안쪽)뿐이다 |
| 가짜 서버 | 통과 | 데모 주인 오후만·SCHD 끔(GET0 `slots:["afternoon"], muted:["SCHD"]`). test_devtools 는 전체 실행에서 통과 |
| 문서 | 통과 | 앞 검토 참고 5(README 알림 절)는 da98747 라운드 끝 문서 몫이다. B 의 판정 범위 밖이라 보지 않았다 |

## 뮤테이션

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| GET 이 내 목록 밖도 보임 — 고친 시험 하나만 | push.py:73 | 잡힘 |
| 같은 것 — 그 시험을 빼고 test_push·test_isolation·test_devtools | push.py:73 | 살아남음(잡는 것이 바로 그 시험이라는 뜻. 실행자의 "test_api_slots_and_muted 를 빼고도 잡힘"과 맞다) |
| 같은 것 — test_push·test_isolation·test_devtools 전부 | push.py:73 | **잡힘** — 앞 검토 조건 2 풀림 |
| 화면: 끈 수를 저장 전체로 셈(15009f6 되돌림) | PushModal.tsx:272 | 잡힘(PushModal.test.tsx:288·293·301) |
| 화면: 종목을 끌 때 숨긴 끈 종목을 버림 | PushModal.tsx:283 | 잡힘(`['SCHD','OLD','VOO']` 기대) |
| 화면: 못 끄는 칸 까닭 문구를 숨김(a8dce22) | PushModal.tsx:252 | 잡힘 |
| 화면: `off > 0` → `off >= 0`("0종목 끔") | PushModal.tsx:273 | **살아남음** — 조건 1 |

도구가 매번 원래대로 되돌렸다. 끝난 뒤 `git status --short` 출력은 비어 있다.

## 참고 (막지 않음)

- 앞 검토의 `prefs_of` 빈 slots 방어 줄(살아남음, API 로는 저장할 수 없음)과 `if True:` 동등 뮤테이션은 바뀐 것이 없어 같은 판단이다.
- 앞 검토 참고 4(purge 뒤 기본 모양이어도 NULL 로 돌아가지 않음)도 그대로다. 뜻은 같다.

## 끝 정리

- 가짜 서버 8186(pid 17353): `kill $(cat …/r045/Brev2/fake.pid)` 로 껐다. `curl …:8186/api/health` → 000. `ps -o pid,stat,cmd -p 17353` 에서 줄이 없다.
- 잠깐 걸어 둔 `frontend/node_modules` 링크(→ /home/user/Dashboard/frontend/node_modules)는 지웠다. 무시 목록에 든 `frontend/dist`·`__pycache__` 는 남아 있다(git 이 보지 않는다).
- 저장소 파일을 고치지 않았고 커밋하지 않았다. `git status`:

```
HEAD detached at 15009f6
nothing to commit, working tree clean
```
