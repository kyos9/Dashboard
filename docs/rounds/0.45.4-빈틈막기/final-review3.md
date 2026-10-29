# 0.45.4 세 번째 끝 검토 — final-review2 조건 N4·N2·N7 과 3cfc554

**판정: 합격**

- 범위는 `0ddfdbb` → `3cfc554` 이다. 이 커밋은 final-review2 의 조건 셋을 고친다.
- 돌린 곳은 내 worktree `scratchpad/r049/final3/wt` 이다(3cfc554, detached). node_modules 는 본 트리 것을 심볼릭 링크로 썼다.
- 증거 폴더: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r049/final3/`
  - 그 안의 파일: muts.json · mut-out.md · pytest.txt · vitest.txt · lint.txt · tsc.txt

## 조건부 목록

없음. final-review2 의 조건 1·2·3(N4·N2·N7)은 모두 닫혔다.

**참고**(조건 아님)
- CI 두 갈래는 보지 못했다. 바깥 인터넷이 없기 때문이다. PR 에서 총괄이 본다.
- `status.md:3` 은 아직 "진행 중"이다. 끝·푸시·PR 은 총괄이 할 일이다.
- 코드는 바뀌지 않았다. 그래서 빌드·화면·API 모양·응답 사진은 다시 재지 않았다. final-review2 의 측정이 그대로 맞는다.

## (1) 3cfc554 가 시험과 문서만 바꿨는지 — 통과

```
$ git diff 0ddfdbb 3cfc554 --stat
 backend/tests/test_input_limits.py         |   1 +
 .../B-mutation.md                          |   8 ++
 .../final-review2.md                       | 102 +++++
 .../status.md                              |   3 +-
 frontend/src/components/AppHeader.test.tsx|  12 ++-
```
- `backend/app` 과 `frontend/src`(시험 파일이 아닌 것)는 바뀌지 않았다.
- 문서 두 줄이 사실과 맞는다.
  - `status.md:33` 은 "셋 다 잡힘"이라고 적는다.
  - `B-mutation.md` 끝의 표는 N4·N2·N7 을 "잡힘"으로 적는다.
  - 아래 (2) 에서 내가 직접 돌린 결과와 같다.

## (2) N4·N2·N7 직접 다시 + 근처 뮤테이션 2줄 — 5/5 잡힘

final-review2 의 `muts.json` 에서 세 줄을 그대로 가져왔다. 거기에 두 줄을 더해 돌렸다.
명령은 `MUT_REPO=final3/wt python tools/mutate.py final3/muts.json final3/mut-out.md` 이다.
도구는 매번 파일을 원래대로 돌려놓는다. 끝난 뒤 `git status --short` 는 빈 출력이었다.

| 뮤테이션 | 결과 |
| --- | --- |
| N2 `(e.status === 404 \|\| e.status === 405)` → `(e.status === 405)` | 잡힘 |
| N4 `AppHeader.tsx:64` 의 `setLeavingEverywhere(false)` 지움 | 잡힘 |
| N7 `TICKER_MAX = 64` → `1000` | 잡힘 |
| M1(새로) 취소가 창을 닫지 않음: `AppHeader.tsx:410` 의 `setConfirmEverywhere(false)` 지움 | 잡힘 |
| M2(새로) `TICKER_MAX = 64` → `65`(한 글자만 풀림) | 잡힘 |

N4 는 손으로 한 번 더 돌려, 바라는 까닭으로 실패하는지 보았다.
- 404·405 두 갈래가 모두 `AppHeader.test.tsx:350` 의 `expect(retry).toBeEnabled()` 에서 실패했다.
- 출력은 `Tests  2 failed | 41 passed (43)` 이다.
- 돌린 뒤 `git checkout` 으로 원래대로 돌려놓았다.

## (3) 새 시험이 정말 그 동작을 보는지 — 통과

- **N4 (`AppHeader.test.tsx:347-352`)**
  - 실패 안내가 뜬 뒤 확인 단추가 `toBeEnabled` 인지 본다. `busy` 가 풀렸는지를 직접 보는 단언이다. `ConfirmDialog.tsx:76,79` 를 보면 두 단추 모두 `disabled={busy}` 이다.
  - 이어서 `취소` 를 실제로 누른다. 그러면 `queryByRole('alertdialog')` 가 null 이어야 한다.
  - 이 단언은 "갇히지 않음"과 "닫힘"을 모두 본다. M1 이 잡힌 것이 그 증거다.
- **N2 (`:325`)**
  - `it.each([404, 405])` 로 두 상태를 각각 거부값으로 준다.
  - 각 갈래에서 두 가지를 본다. 한국어 안내가 있어야 하고, 영어(`Method Not Allowed|Not Found`)는 없어야 한다.
- **N7 (`test_input_limits.py:68`)**
  - 글자 그대로 `"A" * 65` 를 보내고 `== 422` 를 본다. 바로 위 줄(`:67`)은 64자가 `!= 422` 인지 본다.
  - 두 줄이 함께 있으므로, 65자의 422 가 다른 검사(형식 등)에서 온 것이 아니다. 길이에서 온다.
  - 이것으로 64 경계를 위와 아래 양쪽에서 숫자로 고정한다. M2(64→65)가 잡힌 것이 그 증거다.
- 약한 단언(`toBeTruthy`, `!= 200` 같은 것)이나 기호를 따라 움직이는 값은 새로 들어오지 않았다.

## (4) 전체 시험 — 줄지 않음, 통과

| 잰 것 | 앞 판정(0ddfdbb) | 지금(3cfc554) | 판정 |
| --- | --- | --- | --- |
| pytest | 1532 통과 · 3 건너뜀 | **1532 통과 · 0 실패 · 3 건너뜀**(150.6 s), rc 0 | 통과 |
| vitest | 1050 (63 파일) | **1051 통과 (63 파일)**, rc 0 | 통과 |
| lint 경고 | 22 | **22**(`grep -c warning lint.txt`), rc 0 | 통과 |
| tsc | 0 | `npx tsc -b` → 0 | 통과 |

- vitest 가 1 늘어난 까닭은 405 시험 하나가 `it.each` 로 404·405 둘로 나뉘었기 때문이다.

## 작업 트리

```
$ git -C …/scratchpad/r049/final3/wt status
Not currently on any branch.
nothing to commit, working tree clean
```
- 그 뒤 `git worktree remove` 로 `final3/wt` 를 지웠다.
  - `--force` 를 붙였다. 무시되는 `__pycache__` 가 남아 있었기 때문이다.
  - 지우기 전에 심볼릭 링크 node_modules 를 먼저 뗐다. 본 트리의 node_modules 는 그대로다.
- 이번 검토는 가짜 서버를 띄우지 않았다. 화면 코드가 바뀌지 않았기 때문이다.
- 본 트리 `/home/user/Dashboard` 의 `git status --short` 는 이 파일을 쓰기 전에 빈 출력이었다. 지금은 이 파일 `final-review3.md` 하나만 커밋하지 않은 채 남아 있다.
