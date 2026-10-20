# 0.44.0 D0 "진단에 백업 상태" — 두 번째 검토 (좁은 검토, `bc14ccd`)

## 조건부 합격

1(앞 검토 조건 셋)은 모두 풀렸다. 2(상태 파일)도 물은 것은 모두 통과다. 다른 프로세스에서 같은 실패를 읽고, 망가진 파일·쓰기 실패에 넘어지지 않으며, 벌 수·prune 에 섞이지 않고, 파일에 경로·원문이 없다.
**3에서 `+` 줄 뮤테이션 6줄을 넣었는데 6줄이 모두 살아남았다**(백엔드 5, 화면 1). 그래서 판정 기준에 따라 조건부다.
따로 하나 새로 찾았다. 백업 폴더에 쓸 수 없는 날에는 상태 파일도 못 써서 실패가 화면에 안 보인다. 아래 조건 5에 적었다.

전체 결과: 백엔드 `1411 passed, 3 skipped`, 프런트 vitest `910 passed (910)`, lint 경고 22·오류 0, `tsc -b` 통과. 넘겨받은 숫자와 모두 같다.

### 조건 (끝 전에, 테스트만 더하면 되는 것 4 + 결정 1)
1. **망가진 상태 파일 가운데 JSON 이지만 객체가 아닌 경우**(`[]`, `null`, `"x"`)를 테스트에 넣는다.
   지금은 `AttributeError` 를 빼도 잡히지 않는다(N1). 빠지면 `status()` 가 예외를 던지고 `/api/admin/records` 가 500 이 된다.
2. **상태 파일 쓰기 실패를 삼키는지** 테스트한다. 예: `STATUS_FILE` 자리에 폴더를 두고 `run_backup()` 이 예외 없이 `None` 을 돌려주는지 본다.
   지금은 `except OSError` 를 바꿔도 잡히지 않는다(N2). 빠지면 성공한 백업 뒤에도 `_write_failure(None)` 에서 넘어져 `prune()` 을 건너뛴다(`backup.py:203-205`).
3. **업그레이드 직전 백업이 두 벌 이상일 때 "마지막"이 가장 최근 것인지** 테스트한다(N3). `before[0]`→`before[-1]` 이 지금 살아남는다.
4. **화면에서 업그레이드 줄 시각을 정확한 글로 맞춘다**(F1). 지금 테스트는 정규식 `마지막 .+` 라서, 업그레이드 시각 자리에 매일 백업 시각을 넣어도 통과한다.
5. **(새 발견 · 고쳐야 함) 백업 폴더 자체에 못 쓰는 날에는 실패가 화면에 남지 않는다.** 둘 중 하나를 한다.
   - 메모리 대체를 둔다: 상태 파일을 못 쓰면 이 프로세스 메모리에라도 남기고 `status()` 가 그것도 본다.
   - 아니면 DEPLOY 10·status 에 "폴더 권한·디스크 찬 날은 36시간 경고로만 보인다"고 적고 주인 확인을 받는다.
   재현과 근거는 아래 2-e 에 있다.

참고(조건 아님)
- N4 (`_read_failure` 가 파일의 dict 를 그대로 돌려줌), N5 (`reason` 타입 검사 뺌)도 살아남았다. 이 파일은 앱만 쓰는 것이라 위험은 작다. 다만 "필요한 두 칸만 내보낸다"를 지키는 테스트(남는 키·`reason` 숫자)가 있으면 좋다.
- 시간대 테스트 `test_times_are_converted_from_the_server_clock_not_relabelled`(`test_backup.py` 끝)는 `finally` 에서 `delenv("TZ")` 뒤 `tzset()` 을 부른다. 원래 환경에 `TZ` 가 있었다면, monkeypatch 가 되돌린 뒤에는 `tzset()` 을 다시 부르지 않는다. 그래서 그 뒤 테스트는 시스템 기본 시간대로 돈다. CI 가 TZ 를 따로 정하지 않으면 영향은 없다.
- 업그레이드 직전 백업 실패(`snapshot_before_migration`)와 손 백업(`main()`)은 여전히 상태 파일에 남지 않는다. 앞 검토의 참고와 같다.

---

## 1. 앞 검토 조건 셋

| 조건 | 결과 | 증거 |
| --- | --- | --- |
| (1) premigrate 가 "마지막"·멈춤 경고를 가림 | 통과 | `backup.py` `status()`: `daily = [p … if _label(p) == ""]` 로 거르고, `last_at`·`last_size` 는 `daily[0]` 만 쓴다. premigrate 는 따로 `{"count","last_at"}` 로 낸다.<br>**재현** — 새 파이썬 프로세스, `TZ=Asia/Seoul` 에서 매일 백업을 3일 전 1벌, 방금 `-premigrate.db` 1벌 만들었다. `status()` 결과: `"count": 2, "last_at": "2026-10-17T05:06:29+00:00", "last_size": 100, … "premigrate": {"count": 1, "last_at": "2026-10-20T05:06:29+00:00"}`.<br>이 JSON 을 그대로 `BackupLines` 에 넣어(서울 시간대, now=05:07Z) 그렸다. 나온 줄:<br>`백업: 마지막 10월 17일 14:06 · 100B · 2벌 보관(최대 7)`<br>`업그레이드 직전 백업 1벌 · 마지막 10월 20일 14:06 (위 벌 수에 들어 있습니다)`<br>`하루 넘게 새 백업이 없습니다 — 서버 로그를 보세요.`<br>`마지막 실패: 10월 20일 14:06 — DB 파일을 찾지 못했습니다`<br>**경고가 남는다.** (그리는 데 쓴 테스트 파일은 저장소 밖 복사본에만 두었고 지웠다.) |
| (2) 실패가 메모리에만 | 통과 | `_last_failure` 전역은 없어졌다. `_write_failure`·`_read_failure` 가 `BACKUP_DIR/backup-status.json` 을 쓰고 읽는다(`backup.py:44-70`). 다른 프로세스에서도 읽힌다(2-a). |
| (3-J) 서버 `astimezone`→`replace(tzinfo=utc)` | 통과(잡힘) | `test_backup.py`: `1 failed, 26 passed` — `FAILED …test_times_are_converted_from_the_server_clock_not_relabelled`. 되돌린 뒤 27 passed. |
| (3-I) 화면 `when()` 에 `timeZone:'UTC'` | 통과(잡힘) | `Tests 1 failed \| 26 passed (27)` — `× 시각은 보는 사람의 시간대로 — 한국이면 UTC 23:30 이 다음 날 08:30`. `vi.stubEnv('TZ')` 가 실제로 Intl 시간대를 바꾼다는 것도 이것으로 확인했다. |
| (3-K) 멈춤이면 실패 줄 숨김 | 통과(잡힘) | `Tests 1 failed \| 26 passed (27)` — `× 멈춤과 실패가 같이면 두 줄 다`. |

## 2. 상태 파일

명령은 `python …/scratchpad/r044/drive.py <단계…>` 다. 단계마다 **새 파이썬 프로세스**로 돌리고, `SIGNAL_DASHBOARD_BACKUP_DIR` 은 저장소 밖, `TZ=Asia/Seoul` 이다. 코드는 `bc14ccd` 를 `git archive` 한 복사본(`…/r044/mut`)이다.

| 검사 | 결과 | 증거 |
| --- | --- | --- |
| a. 다른 프로세스가 같은 실패를 읽나 | 통과 | `fail` 단계(pid A)에서 `run_backup -> None` 이 나오고, 파일 내용은 `{"last_failure": {"at": "2026-10-20T05:06:28+00:00", "reason": "DB 파일을 찾지 못했습니다"}}` 이다.<br>그 뒤 `read` 를 pid 4624 와 4632 두 프로세스에서 돌렸다. 둘 다 같은 `last_failure` 를 읽었다. |
| b. 망가진 파일 | 통과 | `'{망가짐'`, `'[]'`, `'"x"'`, `'null'`, `'{"last_failure": "str"}'`, `'{"last_failure": {"at": "a", "reason": 3}}'`, `''`, 바이트 `\xff\xfe\x00bad` 를 차례로 넣었다. 모두 `-> None` 이고 예외가 없다.<br>단, `[]`·`null`·`"x"` 는 테스트에 없다(조건 1). |
| c. 쓰기 실패 | 통과(넘어지지 않음) | **상태 파일 자리가 폴더인 경우** — 로그에 `백업 상태 파일을 쓰지 못했습니다: [Errno 21] Is a directory …` 가 남고, 예외는 없다. `status()` 의 `last_failure` 는 `None`, `count` 2(폴더는 세지 않는다).<br>**폴더 권한** — 실제 권한으로는 해 보지 못했다. 나는 root 이고, 스크래치 경로(`/tmp/claude-0` 700)는 nobody 가 열 수 없다. 그래서 `probe_ro.py` 에서 그 폴더 안의 `Path.write_text` 와 백업 쓰기를 `PermissionError` 로 바꿔 흉내 냈다: `LOG ERROR 백업에 실패했습니다: [Errno 13] …` / `LOG WARNING 백업 상태 파일을 쓰지 못했습니다: [Errno 13] …` / `run_backup -> None`. 넘어지지 않는다.<br>단, 테스트는 없다(조건 2). |
| d. 벌 수·prune 에 섞이나 | 통과 | `prune` 단계: `backup-status.json` 과 남은 `.tmp` 가 있는 폴더에 매일 백업 5벌을 더했다. `count before 7`(매일 6 + premigrate 1, 상태 파일 둘은 빠짐). `prune(keep=2)` 는 `signalboard-*` 5개만 지웠다. 남은 것: `['backup-status.json', 'backup-status.json.tmp', 'signalboard-20261017-140629.db', 'signalboard-20261020-140629-premigrate.db']`. 이름이 `signalboard-` 로 시작하지 않아서다(`existing_backups`). |
| e. 파일 안에 경로·예외 원문 | 통과 | 실패 DB 경로를 `…/SENTINEL-secret-dir/SENTINEL.db` 로 두었다. `SENTINEL in file: False`, `str(S) in file: False`. 원문은 서버 로그(`백업할 DB 파일이 없습니다: …/SENTINEL.db`)에만 있다. |
| (새 발견) 폴더에 못 쓰는 날 실패가 보이나 | **걱정 · 고쳐야 함** | c 의 흉내에서 `status.last_failure -> None` 이 나왔다. ENOSPC 를 흉내 낸 경우도 똑같다(`[Errno 28] No space left on device` 뒤 `-> None`).<br>`bc14ccd` 전의 메모리 방식에서는 이 두 갈래("백업 폴더에 쓸 수 없습니다", 디스크가 정말 찼을 때의 "디스크가 찼습니다")도 보였다. 지금은 사실상 화면에 나올 수 없다. 첫날에는 "마지막 실패" 줄도 멈춤 경고도 없다. 36시간이 지나야 멈춤 경고가 뜬다.<br>`backup.py:59` 주석("디스크가 찬 날이면 이것도 못 쓴다")이 알고 있는 일이지만, status·DEPLOY 에는 적혀 있지 않다(조건 5). |

## 3. `bc14ccd` 의 `+` 줄 뮤테이션 (D0-mutation.md 20줄과 겹치지 않게)

`python …/r044/mut.py be|fe <old> <new> [테스트]` 로 돌렸다. 저장소 밖 복사본에서 한 줄을 바꾸고 테스트를 돌린 뒤 되돌린다. 모두 `RESTORED True` 였다.
백엔드는 `tests/test_backup.py test_scheduler.py test_migration_0014.py test_migration_0005.py test_policy_page.py` 77개다. `test_devtools.py` 는 넣지 않았다. 데모가 `count`·`last_size`·`last_at`·`last_failure is None` 만 보기 때문에(`test_devtools.py:239`) 아래 줄과 상관이 없다.

| # | 줄 | 바꾼 것 | 결과 |
| --- | --- | --- | --- |
| N1 | `backup.py:66` | `except (OSError, ValueError, AttributeError)` → `(OSError, ValueError)` | **살아남음** (77 passed) |
| N2 | `backup.py:58` | `_write_failure` 의 `except OSError` → `except ValueError` | **살아남음** (77 passed) |
| N3 | `backup.py:260` | `_taken_at(before[0])` → `_taken_at(before[-1])` (가장 오래된 업그레이드 백업) | **살아남음** (77 passed) |
| N4 | `backup.py:69` | `return {"at": …, "reason": …}` → `return failure` (파일의 dict 그대로) | **살아남음** (77 passed) · 참고 |
| N5 | `backup.py:68` | `and isinstance(failure.get("reason"), str)` 뺌 | **살아남음** (77 passed) · 참고 |
| F1 | `DiagnosticsModal.tsx:157` | `when(backup.premigrate.last_at)` → `when(backup.last_at ?? backup.premigrate.last_at)` | **살아남음** (`Tests 27 passed (27)`) |

**살아남음 6/6.** 필요한 테스트는 위 조건 1–4 와 참고에 적었다.

## 전체 한 번

| 무엇 | 결과 |
| --- | --- |
| 백엔드 `python -m pytest -q` (worktree `backend`) | `1411 passed, 3 skipped, 5274 warnings in 151.04s` |
| 프런트 `npx vitest run --maxWorkers=2` | `Tests 910 passed (910)` |
| `npm run lint` (oxlint) | 경고 22, 오류 0, exit 0 |
| `npx tsc -b` | 통과 (`TSC-OK`) |

이번에는 가짜 서버를 띄우지 않았다. 좁은 검토라 화면은 `BackupLines` 에 실제 `status()` JSON 을 넣어 그리는 것으로 대신했다. 그래서 끌 PID 도 없다.
`frontend/node_modules` 는 본 저장소로 가는 심볼릭 링크를 잠시 두었다가 지웠다. 산출물은 모두 `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r044/` 아래에 있다(`mut/`, `probe/`, `drive.py`, `probe.py`, `probe_ro.py`, `mut.py`, `be-full.txt`, `fe-full.txt`, `lint.txt`).

## worktree `git status`
```
HEAD detached at origin/claude/new-session-fftcg1
nothing to commit, working tree clean
```
(`git log -1`: `bc14ccd`. 무시 대상만 남아 있다: pytest 가 만든 `backend/logs/`, `backend/signal_dashboard.db`, `__pycache__/`.)
