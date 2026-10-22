# 0.45.0 항목 D 검토 (8bc439d, 문서 27488d7) — 검토자

# 불합격

**이유 하나**: 일괄 편집에서 고친 것을 **"버리고 닫기"** 하면 `document.body.style.overflow` 가 `hidden` 으로 남는다.
그러면 **새로 고칠 때까지 앱 전체가 스크롤되지 않는다.** 다른 탭으로 옮겨도, 일괄 편집을 다시 열고 닫아도 풀리지 않는다.
이 길은 D6 에서 새로 생긴 것이고, 주인이 이번에 넣기로 정한 장면 그 자체다(주인 답 4). 나머지 검사는 모두 통과했다.
고칠 것은 작다(아래 "고칠 것").

worktree: `/home/user/Dashboard/.claude/worktrees/agent-abd58be93f38daa5c`, `27488d7` 에 detached.
내 결과물은 `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/Drev/` 에 있다.

## 막는 결함 — "버리고 닫기" 뒤 스크롤이 잠긴다

다시 해 보는 순서 (빌드한 화면, 가짜 서버 8188, 주인, 390 폰):
`/stocks` → ✎ 수정 → 수량 하나 고침 → ✕(또는 취소, 뒤로가기) → **버리고 닫기**

`Drev/overflow.js` 출력:
```
/stocks: 버리고 닫기 뒤 overflow='hidden', 문서 높이 2306, 휠 뒤 scrollY 410→410
/stocks: 그다음 고친 것 없이 열고 ✕ 뒤 overflow='hidden'
/: 버리고 닫기 뒤 overflow='hidden', 문서 높이 2063, 휠 뒤 scrollY 0→0
취소→버리고 닫기 뒤 /rebalance 로 옮겨도 overflow='hidden' path=/rebalance
```
`Drev/d6.js` 에서도 같다: `FAIL D6 버리고 닫기 뒤 body overflow 풀림 ('hidden')`. 부분 실패 뒤 "버리고 닫기"도 같다.
고친 것 없이 ✕·취소·뒤로가기로 닫을 때는 `overflow=''` 로 정상이다.

원인(읽은 것):
- `ConfirmDialog.tsx:45-56` 은 열 때 `previous = body.style.overflow` 를 쥔다. 이 값은 일괄 편집이 이미 건 `'hidden'` 이다.
  deps 가 `[busy, onCancel]` 이고 `onCancel` 은 매 렌더 새 화살표라 다시 돌 때마다 다시 쥔다.
- `StockEditModal.tsx:255-258` 의 `onConfirm` 은 `setAsking(false)` 와 `close()` 를 한 번에 부른다. 그래서 부모와 자식이 **같은 커밋에서
  함께** 빠진다. React 는 지워지는 트리의 정리를 부모부터 돌린다.
  먼저 일괄 편집(`StockEditModal.tsx:106-112`)이 `''` 로 되돌리고, 그 뒤 확인 창이 `'hidden'` 을 다시 쓴다.
- 테스트가 놓친 까닭: `StockEditModal.test.tsx:98-105` 는 `onClose` 가 불렸는지만 본다. 부모가 창을 지우지 않으니 둘이 같이 빠지는
  장면이 테스트에 없다.

고칠 것 (하나만 고르면 된다):
- (가) 확인 창이 먼저 빠진 **다음** 닫기: 예를 들어 `asking` 을 내린 뒤 다음 박자에 `close()` 를 부른다.
- (나) 스크롤 잠금을 수 세기 하나로 모으기.

어느 쪽이든 **부모가 실제로 창을 지우는 테스트** 하나를 둔다(`Dashboard.portfolio.test.tsx` 의 "버리고 닫기" 뒤 `document.body.style.overflow === ''`).

## §3 검사표

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 완료 조건 | **실패** (D6) / 나머지 통과 | **D2** 통과. 손님 `/foo` → "없는 화면입니다", [첫 화면으로] → `/`. 주인 `/foo` 도 같다. `/chart` → `/history`(replace). `/privacy`·`/sw.js`·`/?login_error=denied` 는 가로채지 않는다(`d6.js` PASS 8줄). 앱 안의 링크·서버 리디렉트(`auth.py:272` `/`, `/?login_error=`)·알림 URL(`alerts.py:270` `/`·`/rebalance`, `push.py:112` `/`)은 모두 있는 경로다. **D3** 통과. 화면 줄은 "리뷰 기록과 따로, 서버가 매일 아침 평가금액과 보유 모습(수량·평단가·종가·현금·환율)을 남깁니다 — 2026-10-16부터 5일치 쌓였습니다(쌓인 기록을 보는 화면은 아직 없습니다)."이고, 빈 문구는 "아직 리뷰 기록이 없습니다"(`RebalancePanel.tsx:653-660, 697`). **D4** 통과(아래 "비밀"). **D5** 통과. 새 사람의 `/history`·`/fundamentals`·`/rebalance` 에 [종목 추가하러 가기] 가 있다(6 화면 × 3 = PASS 18). **D6**: 묻기·안 묻기·겹친 팝업은 모두 맞다(아래). 다만 "버리고 닫기" 뒤 스크롤이 잠긴다 → 실패 |
| 계획 때 걱정 | 통과 (참고 둘) | plan-dev D3 경로·옛 문구 테스트 → `RebalancePanel.test.tsx:911-923` 이 바뀜. plan-dev D4 `downgrade.py` 에서 잡고 `_failure_kind(e.__cause__)` → `downgrade.py:28-39`, `migrate.py`·`backup.py:315` 업그레이드 문구는 그대로. plan-review D4 "0.42 이상일 때만" → 조건 붙음. plan-review D2 방침 화면 테스트 → `App.routes.test.tsx:44-49`. plan-user D3 "볼 곳 없음" 괄호 → 들어감. plan-user D5 세 화면 말 → 본문 한 틀(`NoStocksYet.tsx`). 막음 0. **참고 ①** 계획(`plan.md` D5)은 "아직 종목이 없습니다"로 **제목까지** 하나로 하겠다고 했다. 실제 제목은 셋이 그대로 다르다("차트로 볼 종목이 없습니다"/"담은 종목이 없습니다"/"리밸런싱할 종목이 없습니다"). 본문·단추만 같다. **참고 ②** D3 괄호 "(수량·평단가·종가·현금·환율)"은 plan-user 가 "폰에서 길다"고 걱정한 부분이다. 계획 답은 "평가금액과 보유 모습"까지만 적었다. 360 에서 4줄이고 넘침은 0이다(`shots/owner-360-light-valueline.png`) |
| 회귀 | 통과 | pytest `1429 passed, 3 skipped`(시작 1425 → +4, 모두 `test_downgrade_tool.py`). vitest `Tests 920 passed (920)`, `Test Files 60 passed`(시작 912/58). lint 경고 22 → 22, 경고 종류·파일 diff 0. 응답 사진: `snapshot.py Drev/snap 8187` → `snapdiff.py baseline/snap Drev/snap` = "같음 / 차이 0" |
| 격리 | 해당 없음 | 새 엔드포인트·새 표가 없다(`git diff --stat 812eb5e 8bc439d` 의 backend 는 `tools/downgrade.py`·테스트뿐) |
| 마이그레이션 | 해당 없음 | 새 리비전이 없다. D4 는 내리기 **도구의 문구**만 바꾼다. 실제 SQLite 0014 DB 로 돌린 결과는 아래 "비밀"에 있다. 실패 뒤 리비전은 `after 0014` 로 그대로다 |
| 호환 | 통과 | `apidiff.py baseline/openapi.json Drev/openapi.json` → 빠짐 0, 타입 바뀜 0, 더해짐 0. `cmp` 로도 같다(OPENAPI_IDENTICAL). 화면이 새 필드를 읽지 않는다 |
| 입력 한도 | 해당 없음 | 새로 받는 값이 없다 |
| 뮤테이션 | **실패** (살아남은 것 1) | 실행자 13/13 은 표를 확인했다. 직접 돌린 5개(`Drev/mut.py`, 내 worktree 에서 돌리고 원래대로 되돌림): M2 확인 창 개수 `dirty.length`→`stocks.length` **잡힘**. M3 `_failure_kind(e.__cause__ or e)`→`(e)` **잡힘**. M4 없는 화면 단추 `/`→`/history` **잡힘**. **M1 `failed[0]`→`failed[failed.length - 1]` 살아남음** — 실패가 하나뿐인 테스트(`StockEditModal.test.tsx:123-151`)라 "첫 실패 줄"을 가리지 못한다. 실패 둘(위·아래)을 넣고 위의 것으로 가는지 보는 줄이 필요하다. M5 `failedLabels.length === 0 && !error`→`!error` 는 살아남았지만 같은 뜻이다(`setFailed`·`setError` 가 늘 같이 바뀐다, `StockEditModal.tsx:166-185`). 참고로만 둔다. 주의: `scratchpad/tools/mutate.py` 는 `REPO = /home/user/Dashboard`(주 checkout)로 굳어 있어서 쓰지 않았다 |
| 비밀 | 통과 | `Drev/d4.sh`. ① 진짜 SQLite DB(이름에 SENTINEL)를 0014 로 올리고 백업 폴더를 파일 아래로 두었다 → `python -m app.tools.downgrade 0013`: exit=1, stdout 비어 있음. stderr 는 "내리기 전 백업에 실패해 멈췄습니다: 파일을 쓰지 못했습니다. … DB 는 그대로입니다." + 갈래 두 줄. `grep -c SENTINEL\|Traceback\|<경로>` = 0. 리비전 0014 그대로. ② 진짜 `pg_dump` 로 `postgresql+psycopg://u:SENTINEL-pw@127.0.0.1:1/SENTINEL-db`(bind 만 흉내) → "pg_dump 가 실패했습니다", SENTINEL·Traceback·127.0.0.1 모두 0. **참고**: 원인 원문은 어디에도 남지 않는다(`snapshot_before_migration` 은 required 일 때 로그 없이 raise). 그런데 갈래가 "알 수 없는 오류"면 문구가 "서버 로그를 보세요"(`backup.py:99`)라서 볼 곳이 없다. 다음 후보로 남길 만하다 |
| 규제 | 통과 | `git diff 812eb5e 8bc439d -- frontend/src backend/app` 의 더한 줄에서 `추천|사세요|팔라|저평가|예측|수익률` 검색 → 0건. 규제 영향 항목 없음 |
| 데이터 경계 | 해당 없음 | 새 표·칸 없음 |
| 외부 호출 | 해당 없음 | 새 호출 없음 |
| 화면 | **실패** (스크롤 잠김) / 나머지 통과 | `npm run build` 뒤 `Drev/d6.js`. 1400·390·360 × 밝음·어두움으로 손님 `/nope`, 새 사람 빈 화면 셋, 주인 확인 창, 주인 리밸런싱을 봤다 → 넘침 0, 확인 창이 화면 안(360: x=16, w=328), 새 사람 콘솔 오류 0. 키보드: 확인 창의 첫 포커스는 "계속 고치기", Tab → "버리고 닫기", Enter → 닫힘. D6 동작은 아래 "D6 장면"에 있다. 실패는 위의 스크롤 잠김 하나다. (콘솔의 400 하나는 부분 실패를 만들려고 내가 일부러 넣은 응답이다) |
| 말 | 통과 (참고) | 옛 문구 "먼저 추가해주세요"·"목표 비중을 설정해주세요"·"아직 남긴 기록이 없습니다"·"일째"를 `frontend/src` 에서 검색 → 주석 한 줄(`RebalancePanel.tsx:648`, 설명)만 남는다. 용어집 `glossary.md:22-23` 은 새 말 둘을 담았다. README:76 은 "○일치"로 바뀌었다. 테스트 `RebalancePanel.test.tsx:911-923`·`Dashboard.portfolio.test.tsx:556-575` 도 새 말이다. 참고: 확인 창 제목은 "저장하지 않고 닫을까요?"이고 본문은 "저장하지 않은 종목 N개(이름…)가 있습니다. 닫으면 고친 것이 사라집니다."다. 주인 답 4의 "…N개가 있습니다 — 버리고 닫을까요?"와 뜻이 같다. 이름을 다 늘어놓으므로 15종목을 다 고치면 본문이 길어진다 |
| 성능 | 통과 | 첫 화면 JS gzip 111.19 → 111.49 kB(+0.30). 이유: `NotFound`·`NoStocksYet`·일괄 편집이 `ConfirmDialog` 를 들여옴 |
| 가짜 서버 | 해당 없음 / 통과 | 새 서버 상태가 없다. `test_devtools.py` 는 전체 pytest 안에서 통과 |
| 문서 | 통과 (참고) | DEPLOY.md:366 은 새 한 줄 문구를 적었고 실제 출력과 맞다("디스크가 찼습니다"는 `backup.py:96` 갈래). 참고: ① README "화면 구성"에 0.45 의 없는 주소·빈 화면 단추·일괄 편집 확인이 아직 없다. README:545 "뒤로가기 — 팝업만 닫힙니다"에도 "고친 것이 있으면 묻는다"가 없다. ② ROADMAP 0-1(`ROADMAP.md:81-83`)에 이번에 고친 것과 뺀 D1 이 그대로 있다(`plan.md` D1 "0-1 후보에서도 지운다"). 라운드 끝에 정리할 것이면 status 에 적어 둔다 |

## D6 장면 (빌드한 화면, `Drev/d6.js` — 확인한 것)

- 고친 것 없음: 뒤로가기·✕·취소 → 묻지 않고 바로 닫힘. `/stocks` 그대로, 칸 0, overflow `''`(전과 같다).
- 고친 것 있음:
  - 뒤로가기 → 확인 창이 뜬다(칸 2). 확인 창에서 다시 뒤로가기 → 확인 창만 닫힌다(칸 1), 고친 값은 남는다.
  - 세 번째 뒤로가기 → 또 묻는다. ✕·취소도 묻는다.
  - 확인 창에서 Esc·바깥 누르기 → 확인 창만 닫힌다. 일괄 편집의 Esc 는 `dirty>0` 이면 아무것도 하지 않는다(전과 같다).
  - 버리고 닫기 → 둘 다 닫힘, 칸 0. **다음 뒤로가기는 이전 화면 `/`** 로 간다(빈 칸이 남지 않음).
  - 다만 overflow 가 `hidden` 으로 남는다 ← 결함.
- 부분 실패(첫 종목 성공, 마지막 종목 400):
  - 창이 남고, 안내 두 줄이 숨고, 실패 줄이 보이는 자리로 간다(top=225/780, `shots/owner-390-partial.png`).
  - 뒤로가기 → "저장하지 않은 종목 1개(東京海上ホールディングス)". 성공한 종목은 실제로 저장됐다(다시 열어 확인).
  - 다시 연 뒤 고친 것 없음 → ✕ 바로 닫힘.
- 다른 팝업이 깨지지 않는지:
  - 사용자 목록 위 차단 확인 창 → 뒤로가기 한 번에 확인 창만, 두 번째에 사용자 목록 → `/stocks` 그대로.
  - `onBlocked` 는 `canClose` 가 거짓인 창에서만 불린다. 그것을 넘기는 곳은 `StockEditModal.tsx:77` 하나다(`grep useBackToClose(`).
  - 차트 팝업 뒤로가기는 단추를 찾지 못해 이번에 직접 보지 못했다(`SKIP`). `backToClose.ts` 변경은 `onBlocked` 가 있을 때만 다르게 돌아서 영향이 없다고 읽었다.

## 다시 볼 조건 (재검토 때)

1. "버리고 닫기"(✕·취소·뒤로가기 세 길, 부분 실패 뒤 포함) 뒤 `document.body.style.overflow === ''` 이고 스크롤된다. 부모가 창을 실제로 지우는 화면 테스트가 있다.
2. 뮤테이션 M1(`failed[0]` → 마지막)을 잡는 테스트 — 실패 둘 중 위의 줄로 가는지.
3. (참고, 막지 않음) D5 제목을 계획대로 하나로 할지, 지금처럼 둘지 status 에 적는다. README 화면 구성·ROADMAP 0-1 정리를 언제 할지.

## 뒷정리

- 가짜 서버 8188: `kill $(cat Drev/fake.pid)`(PID 14302) → `curl localhost:8188/api/health` 응답 없음 = 꺼짐.
  8187 은 `snapshot.py` 가 스스로 띄우고 끈다(`proc.terminate()`). `pkill`·`killall` 은 쓰지 않았다.
- `frontend/node_modules` 는 주 checkout 의 것을 잠깐 심볼릭 링크로 걸었다가 지웠다. 뮤테이션 5개는 모두 원래대로 되돌렸다.
- `git status` (worktree):
```
HEAD detached at 27488d7
nothing to commit, working tree clean
```
