# 0.45.0 A 검토 — 백업을 서버 밖으로 (관리자 PC 가 당겨 오기)

# 조건부 합격

대상: `origin/claude/new-session-fftcg1` 261ab1e (A = c5f4a2c · 75d26d9 · fb45329, 시작 812eb5e). worktree `/home/user/Dashboard/.claude/worktrees/agent-a1e32fa0591c4ad63`.
실행자 보고는 믿지 않고 직접 돌렸다. 내가 쓴 파일과 출력은 모두 `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/Arev/` 에 있다.

막는 결함은 없다. 계획 때의 막음 둘(상태 파일 덮어쓰기, 방침 5절)은 실제로 풀렸다. 다만 **직접 뮤테이션 3줄이 모두 살아남았다**. 그중 하나는 동시 쓰기 잠금이다. 잠금을 빼면 실제로 기록이 사라지는데(아래 race 20/20), 시험이 이것을 잡지 못한다. 고칠 것이 작은 것까지 다섯 개 있다.

## 조건 (합격 전에 고칠 것)

1. **잠금 시험 없음.** 뮤테이션 `fcntl.flock(lock, fcntl.LOCK_EX)` → `pass` 가 살아남는다. 직접 잰 결과는 이렇다(`Arev/race.py`). 실패 기록을 쓰는 프로세스 6개가 도는 동안 꺼낸 시각을 한 번 적었다. 잠금이 없으면 **20번 중 20번 `pulled_at` 이 사라지고**, 잠금이 있으면 20번 중 0번이다. 잠금은 제 일을 하는데 시험이 그것을 지키지 않는다. 여러 프로세스로 도는 시험 하나를 `test_backup.py` 에 더한다(race.py 모양).
2. **`backup-export.sh` 의 "꺼낸 뒤 크기 확인"(`deploy/backup-export.sh:45-49`)에 시험이 없다.** `if [ "$got" != "$after" ]` → `if false` 가 살아남는다. 가짜 docker 의 `cp` 가 짧게 쓰게 하는 시험 하나면 된다(내 가짜 docker `Arev/fakebin/docker` 의 `SHORTCP`). bat 쪽 크기 확인이 한 번 더 있어서 실제 피해는 작다. 그래도 §3 뮤테이션 칸의 기준은 "살아남은 것 0"이다.
3. **시간대 없는 `pulled_at` 하나가 관리자의 `/api/auth/status` 를 넘어뜨린다.** `_read_pulled`(`backend/app/services/backup.py:121-129`)는 `fromisoformat` 이 되는지만 본다. 그래서 `"2026-09-01T00:00:00"` 같은 값이 통과한다. 그다음 `attention()`(`:352`)에서 `TypeError: can't subtract offset-naive and offset-aware datetimes` 가 난다. 가짜 서버에서 확인했다. 관리자로 `/api/auth/status` 를 부르면 연결이 끊기고, 로그에 위 traceback 이 남는다(`Arev/naive.py`, `Arev/fake.log`). 이 값은 `mark_pulled` 가 늘 시간대를 붙여 쓰므로 손으로 고친 파일에서만 생긴다. 하지만 화면 전체가 기다리는 경로다. 시험은 이미 망가진 값(`5`, `"어제"`, `[1,2]`)을 다룬다(`test_backup.py`). 시간대 없는 값도 None 으로 읽고, 같은 parametrize 에 한 줄 더한다.
4. **30일 경계가 점과 진단 줄에서 다르다.** 서버는 `now - pulled > timedelta(days=30)` 를 쓴다(`backup.py:352`). 화면은 `Math.floor(일) > 30`, 곧 31일 이상을 쓴다(`DiagnosticsModal.tsx` OffsiteLine). 그래서 30일~31일 사이 하루 동안 ⋯ 에 점과 "진단 !" 이 뜬다. 그런데 진단을 열면 그 까닭을 말하는 줄이 없다. 확인: 30.5일 전으로 적었을 때 aria-label 은 `메뉴 — 가입 신청 1건 — 백업을 확인하세요`, 항목은 `진단 !` 이다. 진단의 줄은 `밖에 꺼낸 것: 마지막 9월 21일 01:12 (관리자 PC)` 뿐이고 경고 줄이 없다(`Arev/shots/pulled30_5-*-diag.png`). 실행자의 화면 시험도 "30일 1시간은 경고 없음"을 굳혀 두었다. 한쪽 기준으로 맞춘다.
5. **혼자 쓰는 PC 모드에서도 "밖에 꺼낸 기록이 없습니다 — 서버가 사라지면 … DEPLOY.md 10." 이 늘 뜬다.** 재확인 걱정 6(`plan-recheck.md`)은 "offsite 줄과 점은 서버 배포일 때만"을 요구했고, 답은 "반영"이었다. 그런데 반영된 것은 점(`backup_attention`, 구글 모드에서만)뿐이다. `status()` 는 모드와 상관없이 `offsite` 를 싣는다. 열린 모드에서 `/api/admin/records` → `"offsite": {"last_at": null}` 이다(`Arev/pcmode.py`). 화면은 `backup.offsite` 가 있으면 그 줄을 그린다. PC 앱에는 서버가 없으니 맞지 않는 안내다. 서버에서 PC 모드면 `offsite` 를 빼거나, 화면에서 `mode === 'google'` 일 때만 보이게 한다. 아니면 이대로 둘지 주인이 정한다.

## §3 표

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 완료 조건 | 통과 | ① 합쳐 쓰기: 실패 기록과 꺼낸 시각이 서로 지우지 않는다(`test_backup.py::test_marking_pulled_keeps_the_last_failure_and_back`). 8프로세스 × 300번 동시 쓰기(`Arev/conc.py`) 뒤 키 `['last_failure','pulled_at']` 가 둘 다 남고, 남은 임시 파일이 없다. ② `offsite.last_at`: 가짜 서버 관리자 `/api/admin/records` → `"offsite": {"last_at": "2026-10-18T13:09:14+00:00"}`. ③ 진단 세 상태를 빌드한 화면에서 봤다. 없음 = "밖에 꺼낸 기록이 없습니다…", 있음 = "밖에 꺼낸 것: 마지막 10월 18일 13:12 (관리자 PC)", 31일 = "31일 동안 밖에 꺼내지 않았습니다 — PC 에서 server-backup-pull.bat 을 실행하세요." 옛 응답(offsite 를 뺌)에서는 그 줄이 없다. ④ ⋯ 점: 신청 0건으로 만들면 `.menu-dot` 이 10×10 으로 버튼 오른쪽 위에 뜬다. ⑤ 스크립트는 아래 "스크립트" 칸. ⑥ 비밀 0건. 경계 둘은 조건 4·5 |
| 계획 때 걱정 | 통과(일부 조건) | 막음 ① 덮어쓰기: 반영(`backup.py:84-104`, 잠금 + pid 임시 파일). 막음 ② 방침 5절: 반영(`Policy.tsx:114-116`, "최근 4벌만 … 약 4주", `POLICY_EFFECTIVE` 2026-10-20). 문구와 bat 의 지우는 수가 같은지는 `test_policy_page.py::test_the_pc_copies_are_kept_as_the_policy_says` 가 본다. 재확인 1(export/clean, clean 은 늘)·3(이름 바이트수)·4(별도 모듈)·5(DEPLOY 10 의 `~/dashboard-backups` 지우기, 9-3 의 premigrate 사본 지우기)·참고(flock, 2초 동안 크기 같음)는 모두 반영됐다. 재확인 2의 "관리자"도 반영됐다. 재확인 6은 **절반만** 반영됐다(조건 5). plan-review 6 의 "README·용어집에 두 bat 의 차이" 중 용어집과 새 bat 머리글은 했다. 하지만 `backup.bat` 머리에 한 줄 풀이(계획 답 "두 bat 맨 위에")가 없다(`backup.bat:1-12` 바뀌지 않음, 참고). plan-dev 참고 "처음 한 번은 손으로(호스트 키)"는 DEPLOY 에 없다 → 주인 확인 목록 |
| 회귀 | 통과 | pytest `1462 passed, 3 skipped`(시작 1425, D·C 포함). vitest `937 passed`(시작 912). lint 경고 22 → 22. `npm run build` 성공. 응답 사진: 시작 기준 사진과는 970곳이 다르다. 날짜로 씨앗을 뿌리는 데모라서 그렇다. 그래서 오늘 812eb5e 를 `git archive` 로 꺼내 같은 도구로 다시 떴다. 그것과 비교하면 **`같음 / 차이 0`** 이다(`Arev/snap-base-today` ↔ `Arev/snap`) |
| 격리 | 해당 없음(새 엔드포인트 없음) | 새 필드 `backup_attention` 은 관리자에게만 실린다. 가짜 서버: owner `True False`, friend·new·pending 은 키가 없다. 손님 `/api/auth/status` 에도 없다. `test_signup_approval.py` 가 대기 상태에 없음을 본다. `/api/admin/records` 는 friend 403, pending 401 |
| 마이그레이션 | 해당 없음 | A 는 리비전이 없다. 상태 파일에 키를 더하기만 한다(옛 이미지는 `last_failure` 만 읽는다) |
| 호환 | 통과 | apidiff: `빠짐 0 · 타입 바뀜 0 · 더해짐 1 ['DashboardCard.sell_conditions']`(C 것). `offsite`·`backup_attention` 은 dict 응답이라 스키마 밖이고, 더하기만 한다. 새 화면 ↔ 옛 서버: Playwright 로 `offsite`·`backup_attention` 을 뺀 응답을 넣었다 → 줄 없음, 점 없음, `진단` 그대로(`old-*`). 화면 시험 "옛 서버(칸 없음)면 그 줄이 없다". 옛 이미지 + 새 스크립트: 812eb5e 의 backend 에서 `python -m app.tools.backup_pulled` → `No module named app.tools.backup_pulled`, **exit=1**. 백업 폴더도 생기지 않는다(새로 뜨지 않는다) |
| 입력 한도 | 해당 없음 | 사용자가 보내는 새 값이 없다. `backup_pulled.main` 은 인자를 쓰지 않는다 |
| 뮤테이션 | **실패 → 조건 1·2** | 실행자 15/15(`A-mutation.md`)는 받아들인다. 직접 3줄(`Arev/muts.json` → `Arev/mut-out.md`, `MUT_REPO`=내 worktree)은 3줄 모두 **살아남음**: 잠금 없앰, 스크립트의 꺼낸 뒤 크기 확인 없앰, `_update_status` 가 늘 `_unsaved.pop`. 셋째는 운영에서 뜻이 없다. 앱 프로세스는 `mark_pulled` 를 부르지 않는다(가짜 서버 seed 만 부른다). 그래서 참고. 돌린 뒤 `git status` 는 깨끗했다 |
| 비밀 | 통과 | `git diff 812eb5e fb45329` 의 더한 줄에서 IP·개인키·비밀번호를 찾았다 → 예시 `ubuntu@1.2.3.4`(DEPLOY) 하나뿐이다. `git check-ignore -v backup-pull.local.txt` → `.gitignore:42`(슬래시가 없어 어느 폴더에서나 막힌다). 상태 파일 내용은 `{"last_failure": null, "pulled_at": "…"}` 뿐이다. 응답에는 `last_at` 시각만 있다. 가짜 서버 로그·app.log 에서 `ssh|.key|ubuntu@|pulled` 는 0건이다. 스크립트는 키를 받지 않는다(PC 가 ssh 로 붙는다) |
| 규제 | 통과 | 더한 줄에서 `추천|사세요|팔라|저평가|예측|수익률` 은 0건이다 |
| 데이터 경계 | 통과 | 새 표가 없다. 상태 파일은 서버 공용(운영 기록)이고 사용자별이 아니다 |
| 외부 호출 | 통과 | 서버 쪽 새 외부 호출은 0이다. `attention()` 은 관리자 `/api/auth/status` 마다 백업 폴더를 한 번 읽을 뿐이다(`ls` 수준) |
| 화면 | 통과(조건 4·5) | 빌드한 화면, PC 1400 · 폰 390/360 × 밝음/어둠 → 가로 넘침 0(헤더, 진단 모두). 점 색: 밝음 `rgb(166,77,9)`, 어둠 `rgb(240,180,41)`. 위치 1400 `[1363,19,10,10]`, 360 `[337,7,10,10]`, 화면 안. 신청 수가 있으면 숫자 배지가 점을 가리고, 까닭은 aria-label 과 메뉴 항목 "진단 !" 으로 남는다(계획대로). 키보드: Tab 6번 만에 `메뉴 — 가입 신청 1건 — 백업을 확인하세요`, Enter → ↓ 하면 "진단 !" 에 초점. 지인·대기 화면에는 점도 "백업" 글자도 없다. 스크린샷 `Arev/shots/` |
| 말 | 통과 | 용어집 "밖에 꺼낸 백업"(`docs/design/glossary.md:24`), 화면 문구, 화면 시험의 글자가 같다. "운영자" → "관리자" 로 맞췄다. 평가금액 기록 줄 풀이도 화면 시험에 글자 그대로 있다 |
| 성능 | 해당 없음 | 관리자 상태 응답에 폴더 읽기 하나가 더해진다 |
| 가짜 서버 | 통과 | seed 가 사흘 전에 꺼낸 것처럼 적는다(`fake_server.py:709-710`). `test_devtools.py` 가 `offsite.last_at` 과 `backup_attention is False` 를 보고, 전체 실행에서 통과했다 |
| 문서 | 통과(참고 셋) | DEPLOY 10-0 이 실제 순서·`/quiet`·23:30 피하기·예전 폴더 지우기와 맞다. 방침 5절도 맞다. 참고: (a) DEPLOY "PC 의 예전 사본도 **최근 몇 벌만**"은 방침의 4벌로 적는 편이 맞다. (b) DEPLOY 의 손 명령 `scp … .` 은 지금 폴더로 받는다. 그 사본은 4벌 지우기 밖이다(방침과 어긋날 수 있다). (c) README 에 `server-backup-pull.bat` 이 없다(라운드 끝 문서 정리에서) |

### 스크립트 `deploy/backup-export.sh` — 가짜 docker 로 직접 (`Arev/export-test.sh`)

| 경우 | 결과 |
| --- | --- |
| 볼륨: 매일 2벌 + `-premigrate` + `.sql.tmp` + 상태 파일·`.lock`·`.42.tmp` + 이름에 공백이 든 파일. 꺼낼 폴더에는 지난주 것이 남아 있음 | stdout `signalboard-20261019-233000.sql 10`, exit 0. 꺼낼 폴더에는 그 한 벌만 있다(지난 것은 지움). 폴더 700, 파일 600 |
| 모든 `exec` 에 `-T` | 로그 전부 `compose exec -T app …`. `-T` 가 없으면 가짜가 TTY 오류로 넘어진다 |
| `clean` | 폴더가 없어진다. 없을 때 다시 해도 exit 0 |
| 쓰는 중(크기가 자람) | "백업을 쓰는 중입니다 — 잠시 뒤 다시 하세요.", exit 1. 빈 폴더가 남지만 bat 이 늘 clean 을 부른다 |
| cp 가 짧게 씀 | "꺼낸 파일의 크기가 다릅니다 (3 / 10)", exit 1, 폴더를 지운다 |
| 매일 백업 없음(premigrate 만) | "매일 백업이 아직 없습니다…", exit 1, stdout 비어 있음 |
| 컨테이너가 꺼짐 | docker 오류 + "매일 백업이 아직 없습니다…"(말이 틀리다 — 참고), exit 1 |
| `mark` 옛 이미지 | `No module named app.tools.backup_pulled`, exit 1 |
| 다른 폴더(`/`)에서 절대 경로로 부름(ssh 와 같음) | 정상. `cd "$(dirname "$0")/.."` |

### `server-backup-pull.bat` — 읽기만 (윈도우 없음)

맞게 된 곳:
- CRLF 로 저장됐다(`file`: "with CRLF line terminators"). `goto`·라벨이 안전하다.
- `for /f` 의 명령이 따옴표로 시작하지 않는다(`ssh -i "…"`). 그래서 `cmd /c` 가 바깥 따옴표를 벗기는 문제가 없다. 키 경로의 공백은 `"%KEY%"` 로 감쌌다.
- scp 가 실패하면(`PULLED≠0`) 표시하지 않는다. `goto :fail` 로 mark 를 지나친다.
- 크기는 `%%~zF` 와 서버의 바이트 수를 글자로 비교한다(2GB 를 넘어도 된다). 파일이 없으면 GOT 가 비어 다르다고 나온다.
- clean 은 scp 뒤 성공과 상관없이 늘 부른다. export 가 실패해도 `:clean_fail` 에서 부른다.
- 4벌 지우기는 `$env:DEST` 를 쓴다(cmd 의 `set` 은 자식 프로세스에 넘어간다). `signalboard-*` 를 이름 내림차순으로 놓고 5번째부터 지운다. 받기에 성공한 길에서만 돈다.
- 펼쳐질 `!` 가 글자로 든 줄이 없다(지연 확장 문제 없음).

깨질 수 있는 자리 → **주인 확인 목록**에 넣을 것:
1. **첫 실행의 호스트 키.** `-o BatchMode=yes` 는 "모르는 호스트, 계속할까요?" 질문도 막는다. 이 PC 의 같은 윈도우 사용자로 그 서버에 ssh 한 적이 없으면 손으로 돌려도 "Host key verification failed" 로 [1/4]에서 멈춘다. DEPLOY 10-0 에 "먼저 `ssh -i <키> ubuntu@<IP>` 로 한 번 접속해 yes" 를 넣을지 확인한다.
2. **키 파일 권한.** 윈도우 OpenSSH 는 다른 사용자도 읽을 수 있는 키를 거절한다(plan-dev 참고). 증상은 1과 같다.
3. **`/quiet` 인데도 멈추는 길.** `:badconf`, 키 파일 없음, 첫 실행(메모장 + `pause`)은 `/quiet` 를 보지 않고 `pause` 한다(`server-backup-pull.bat:33-34, 44-47, 101-104`). 작업 스케줄러에서 설정이 틀리면 보이지 않는 창이 영원히 기다린다. 그러면 다음 주 실행이 "이미 실행 중"으로 건너뛰어질 수 있다.
4. **설정 값의 모양.** `KEY` 에 따옴표를 넣으면(`KEY="C:\…"`) `""…""` 가 되어 깨진다. `SERVER=` 뒤에 공백이 남으면 scp 의 `"%SERVER%:…"` 가 깨진다. 키·DEST 경로에 `)` 가 있으면 `if not exist "%KEY%" ( echo … %KEY% )` 블록이 일찍 닫힌다. 값 안의 `!` 는 지연 확장 때문에 사라진다. 메모장이 BOM 을 붙이면 첫 줄 주석이 변수로 읽히지만 해는 없다.
5. **scp 의 로컬 경로 `C:\…` 와 원격 상대 경로 `dashboard-backup-export/…`.** 윈도우 OpenSSH 판(SFTP 방식 포함)에서 받는지 확인한다.
6. **실패 표시를 일부러 만들어 보기.** 키를 틀리게 → 진단에 표시가 새로 생기지 않는다, 서버에 `~/dashboard-backup-export` 가 남지 않는다. 8번 돌리면 PC 에 4벌. 이름 끝에 `/quiet` 를 붙였을 때 창이 닫힌다.
7. scp 는 성공했는데 clean 의 ssh 가 끊기면 서버에 한 벌이 다음 export 까지 남는다(다음 export 가 먼저 비운다). 받아들일 만하지만 주인이 알아 둔다.

### 방침 5절과 실제 동작

문구는 이렇다. "관리자가 서버 밖(관리자 PC)으로 꺼낸 백업 사본도 최근 4벌만 두고 오래된 것부터 지웁니다(일주일에 한 번 꺼내면 약 4주)." bat 의 `Select-Object -Skip 4` 와 맞고, 시험이 둘을 묶는다. 남는 틈은 셋이다(참고). ① bat 을 그만 돌리면 마지막 4벌이 기한 없이 남는다. "약 4주"는 매주 돌릴 때만 맞다. ② DEPLOY 의 손 명령과 9-3 premigrate 사본은 4벌 지우기 밖이다. DEPLOY 가 "지운다"고 적어 두었다. ③ 서버 쪽 꺼낼 폴더는 늘 비우므로 "서버 백업 최대 7일"은 그대로 참이다.

## 참고 (조건 아님)
- 뮤테이션 "늘 `_unsaved.pop`" 이 살아남았다. 운영에서는 뜻이 없다(위).
- 메뉴 항목의 `!` 는 `span` 에 붙은 aria-label 이다(역할이 없어 읽기 프로그램이 무시할 수 있다). 메뉴 버튼의 aria-label 이 같은 말을 하므로 해는 작다.
- 컨테이너가 꺼졌을 때 "매일 백업이 아직 없습니다" 는 틀린 말이다(docker 오류가 같이 뜨기는 한다).

## 정리
- 띄운 가짜 서버(포트 8182, PID 파일 `Arev/fake.pid`)는 `kill $(cat …/fake.pid)` 로 껐다. 끈 뒤 `ps` 는 dead, `curl /api/health` 는 000. pkill 은 쓰지 않았다. 바꿨던 데이터 폴더의 상태 파일은 처음 내용으로 되돌렸다.
- 빌드하려고 잠깐 건 `frontend/node_modules` 링크는 지웠다.
- worktree `git status`:
```
HEAD detached at 261ab1e
nothing to commit, working tree clean
```
