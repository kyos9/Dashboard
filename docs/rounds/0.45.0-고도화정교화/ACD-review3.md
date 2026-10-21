# 0.45.0 A·C·D 좁은 재검토 (a8dce22)

- **A: 합격**
- **C: 조건부 합격** — 남은 것은 조건 3(README "화면 구성"의 C 줄) 하나다. 라운드 끝 문서 정리에서 쓴다.
- **D: 합격**

대상은 `origin/claude/new-session-fftcg1` a8dce22 이다. worktree `/home/user/Dashboard/.claude/worktrees/agent-a6dbfdb6c9e0b51b0` 를 거기에 detached 로 두었다.
보는 범위는 앞 판정의 조건과, a8dce22 가 바꾼 줄 안의 뮤테이션뿐이다. 실행자 보고는 믿지 않고 모두 직접 돌렸다.
내가 만든 파일과 출력은 `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/ACDrev3/` 에 있다.

## A — 조건 5개 (A-review.md)

| 조건 | 판정 | 증거 |
| --- | --- | --- |
| 1 잠금 시험 | 통과 | `test_backup.py:507-530` `test_writes_from_two_processes_at_once_are_not_lost` 를 더했다. fork 로 두 프로세스를 띄워 저마다 키를 200번 쓴다. 지금 코드로는 혼자 0.6초에 통과하고, vitest 두 벌과 같이 돌린 전체 pytest 에서도 통과했다. `backup.py:68` 의 `fcntl.flock(lock, fcntl.LOCK_EX)` 를 `pass` 로 바꾸는 뮤테이션을 **5번** 돌렸다(`lock5.json` → `lock5.md`). 결과는 **5/5 잡힘**이다. 한 번은 손으로 바꿔 실패의 까닭이 예외가 아니라 키를 잃은 것임을 확인했다: `AssertionError: assert {'app0', … 'app102', …} <= {'app0', … 'app107', …}` (`tests/test_backup.py:522`). 그 뒤 `git checkout` 으로 되돌렸다 |
| 2 export 의 꺼낸 뒤 크기 확인 | 통과 | 가짜 docker 에 `SHORT_COPY` 를 더하고 시험 `test_export_refuses_a_copy_of_the_wrong_size` 를 더했다. 이 시험은 "(3 / 12)", exit 1, stdout 비어 있음, 꺼낼 폴더 없음을 본다. 앞 판정의 뮤테이션 `if [ "$got" != "$after" ]` → `if false` 는 이제 **잡힘** |
| 3 시간대 없는 pulled_at | 통과 | `_read_pulled` 는 시간대가 없으면 UTC 로 본다(`backup.py:128-130`). 가짜 서버(8185)에서 상태 파일에 `"2026-09-01T00:00:00"` 을 넣고 관리자로 불렀다. `/api/auth/status` → **200**, `backup_attention = True`. `/api/admin/records` → `{"last_at": "2026-09-01T00:00:00+00:00"}`. fake.log 에 Traceback 0건(`naive.py`). 파일은 원래대로 되돌렸다(`restored True`). 뮤테이션 `if parsed.tzinfo is None:` → `if False:` 는 **잡힘** |
| 4 30일 경계 | 통과 | 화면 경계를 `age > 30*86400_000` 으로 바꿨다(`DiagnosticsModal.tsx:182-188`). 서버의 `now - pulled > timedelta(days=30)` 과 같은 경계다. 시험은 30일이 안 된 때, 30.5일, 31일을 본다(`DiagnosticsModal.test.tsx:380-388`). 30.5일에는 "30일 동안 밖에 꺼내지 않았습니다…"가 뜬다. 뮤테이션 둘(날 수 `days > 30` 으로 되돌림, `>= 29일`)은 모두 **잡힘** |
| 5 PC 모드의 offsite 줄 | 통과 | `admin.py:147-152` 는 `auth.mode() != MODE_GOOGLE` 이면 `offsite` 를 뺀다. 시험은 `test_signup_approval.py::test_offsite_line_only_on_a_server_with_google_login` 이다. 뮤테이션 `if False:` 는 **잡힘**. 화면은 앞 판정에서 이미 `backup.offsite` 가 없으면 줄을 그리지 않는 것을 봤다 |
| 참고였던 것들 | 반영됨 | bat 에서 `pause` 를 부르는 다섯 곳(`server-backup-pull.bat:32,46,98,103,109`)이 모두 `if /i not "%~1"=="/quiet"` 로 감싸였다. `:badconf` 는 `goto` 로 가는 라벨이라 `%~1` 이 그대로 batch 인자다. CRLF 는 그대로다(`file`: "with CRLF line terminators"). DEPLOY 10-0 에 다음이 들어갔다: 처음 한 번 `ssh -i … yes`, 키 권한("too open"), "최근 4벌", 손 명령 `scp … .` 사본도 4벌 안으로. `backup.bat:5` 에 두 bat 의 차이 한 줄이 들어갔다. 줄 끝은 원래처럼 LF 다 |

## C — 조건 3개 (C-review.md)

| 조건 | 판정 | 증거 |
| --- | --- | --- |
| 1 360×640 날짜 축 | 통과 | 빌드한 화면(`npm run build`, 가짜 서버 8185)에서 쟀다. 폰 360×640(isMobile, 배율 2), 밝음·어둠 둘 다다. 홈에서 종목 카드를 누르고 "차트"를 눌렀다(`pw.js`). 잰 값은 캔버스 전체(시간 축 포함)의 아래 끝이다. **오늘 데이터**: 000660.KS(매도 줄 있음, 300) **605/640**. AAPL(줄 있음) **576/640**. 7203.T 는 오늘 매도(참고)가 꺼져 있어(`ref:false`) 380 이고 **629/640** 이다. **세 종목에 매도 줄을 억지로 켬**(`force`): 000660.KS 605, **7203.T 605**, AAPL 576. **판정 불가가 섞임**(`nullmix`): 줄 없음, 380, 000660.KS·7203.T 629, AAPL 599. 모든 경우에 가로 넘침 0, 콘솔 오류 0. 스샷 `ACDrev3/shots/force-l-7203.T.png` 에서 축의 "2026 · 5월 · 9월"이 화면 안에 보인다 |
| 2 뮤테이션 2개 | 통과 | 앞 판정의 `BuyConditions.tsx` `=== true` → `!== false` 는 이제 뜻이 없는 뮤테이션이다. `showsSellConditions` 가 모두 `true` 일 때만 그 줄을 그리게 하기 때문이다(`signalRules.ts:94-97`). 같은 자리를 막는 새 줄에 직접 뮤테이션 셋을 돌렸다. `.every(v => v === true)` → `v !== false` **잡힘**. `&& Object.keys(states).length > 0` 뺌 **잡힘**. 높이 조건을 옛 것(`card?.shoulder_sell_ref && card.sell_conditions`)으로 **잡힘**. 이 마지막 것이 앞 판정 `ChartModal.tsx:112` 뮤테이션의 자리다. 이제 `sell_conditions: null`·null 이 섞인 날에 380 인지를 본다(`ChartModal.test.tsx:128-129`) |
| 3 README 화면 구성 | **남음** | 라운드 끝 문서 정리에서 쓴다(지시대로) |

## D — 조건 2개 (D-review2.md)

| 조건 | 판정 | 증거 |
| --- | --- | --- |
| 1 뒤로가기 시험이 부하에서 흔들림 | 통과 | `back()`(`StockEditModal.test.tsx:34-49`)은 이제 `popstate` 를 기다린 뒤 30ms 를 기다리고, 그다음 `act` 한 번을 더 기다린다. 이렇게 돌렸다. ① 같은 파일 사본 8개 + 원본 = 9파일을 `npx vitest run --maxWorkers=6` 으로 **9번** → 9번 모두 `90 passed (90)`(`stress-copies-1..9.txt`). 뒤로가기 시험만 해도 각각 81번 돌았다. ② 이 파일 하나를 프로세스 6개로 동시에, **3번** → 18/18 `10 passed`(`s6-*.txt`). ③ 전체 vitest **3번** → 3번 모두 `943 passed (943)`(`vitest1..3.txt`). 첫 두 번은 전체 pytest 와 동시에 돌렸다. 정직하게 적을 것: 대조군으로 옛 `back()`(고정 30ms)도 같은 부하에 돌렸다. 6프로세스 ×3 은 18/18 통과했고, 9사본 ×3 은 1번 실패했다(다른 시험 "고친 것이 없을 때 닫아도"). 그래서 앞 판정의 흔들림을 내 부하에서 확실히 되살리지는 못했다. 더 센 부하(9사본 × 6프로세스 동시, 부하 평균 28/4코어)에서는 D 와 상관없는 시험까지 `findByRole` 1초·5초 시간 초과로 넘어졌다. 이것은 시험 틀의 한계라 판정에 넣지 않는다 |
| 2 사용자 목록 닫기 뒤 스크롤 | 통과(참고 하나) | 시험 `UsersModal.test.tsx:166-175` 을 더했다. 앞 판정의 뮤테이션(`UsersModal.tsx:62-65` 에서 `release()` 뺌)을 `src/components src/lib src/pages` 로 돌리면 **잡힘**이다. 손으로 다시 해 보니 바로 그 시험이 실패한다(`× 닫으면 뒤 화면이 다시 스크롤된다 — 확인 창을 거쳐도`). 참고: 시험 이름은 "확인 창을 거쳐도"인데, 본문은 목록을 열고 닫기만 한다. 차단 확인 → 취소를 거치지 않는다. 앞 판정이 바란 "차단 확인 → 취소 → 닫기" 길 자체는 시험이 없다. 다만 effect 가 `confirmBlock` 에 따라 풀고 다시 잠그는 같은 정리 함수를 쓴다(`UsersModal.tsx:58-66`). 그래서 이 뮤테이션은 잡힌다. 이름을 본문에 맞추거나 확인 창을 한 번 거치게 하면 좋다(막지 않음) |

## 직접 뮤테이션 (a8dce22 가 바꾼 줄 안) — `muts.json` → `muts.md`, `MUT_REPO`=내 worktree

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| 잠금 없앰 ×5 (`lock5.json`) | backend/app/services/backup.py | 5/5 잡힘 |
| 시간대 없는 값을 UTC 로 바꾸지 않음 | backend/app/services/backup.py | 잡힘 |
| PC 모드에서도 offsite 를 실음 | backend/app/routers/admin.py | 잡힘 |
| 스크립트의 꺼낸 뒤 크기 확인 없앰 | deploy/backup-export.sh | 잡힘 |
| 30일 경계를 날 수로 되돌림 | frontend/src/components/DiagnosticsModal.tsx | 잡힘 |
| 30일 경계를 `>= 29일` 로 | frontend/src/components/DiagnosticsModal.tsx | 잡힘 |
| null 도 충족으로 | frontend/src/lib/signalRules.ts | 잡힘 |
| 빈 조건 `{}` 도 그림 | frontend/src/lib/signalRules.ts | 잡힘 |
| 높이 조건을 옛 것으로 | frontend/src/components/ChartModal.tsx | 잡힘 |
| 사용자 목록 정리에서 `release()` 뺌 | frontend/src/components/UsersModal.tsx | 잡힘 |

살아남은 것은 0이다. 대조로 뮤테이션 없이 같은 명령을 돌렸다. vitest `src/components src/lib src/pages` → `859 passed (859)`, `DiagnosticsModal.test.tsx` → `30 passed`, 백엔드 다섯 파일 → `119 passed`. 그러니 "잡힘"은 명령이 원래 실패해서 생긴 것이 아니다. bat 의 `/quiet` 줄은 윈도우가 없어 읽기만 했다.

## 전체 수

- pytest: `1483 passed, 3 skipped, 5361 warnings in 166.13s` (기대와 같음, `pytest.txt`)
- vitest: `Test Files 61 passed (61) · Tests 943 passed (943)` ×3 (`vitest1..3.txt`)
- lint: 경고 22 (`lint.txt`)
- `npm run build`(`tsc -b && vite build`): exit 0, `✓ built in 1.07s` (`build.txt`)

## 정리

- 가짜 서버(포트 8185, 데이터 `ACDrev3/fake-data`, PID 파일 `ACDrev3/fake.pid`)는 `kill $(cat …/fake.pid)` 로 껐다. 끈 뒤 `ps` 는 dead, `curl /api/health` 는 000. pkill·killall 은 쓰지 않았다.
- 부하 시험용 `frontend/src/components/StressCopy*.test.tsx` 사본은 지웠다. 빌드에 잠깐 건 `frontend/node_modules` 링크도 지웠다. 뮤테이션은 모두 원래대로 돌렸다(도구의 `finally`, 손으로 한 둘은 `git checkout`).
- worktree `git status`:
```
HEAD detached at a8dce22
nothing to commit, working tree clean
```
