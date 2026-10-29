# 0.45.4 끝 검토 다시 — 조건 1 과 0ddfdbb

**판정: 조건부 합격**

- 범위: 라운드 시작 `500a540` → 끝 `0ddfdbb`. 앞 끝 검토(`final-review.md`, f1e4fd1) 뒤에 바뀐 코드는 `AppHeader.tsx` 한 파일(+10 −2)과 시험 셋이다(`git diff --stat f1e4fd1 0ddfdbb -- backend/app frontend/src`).
- 돌린 곳: 내 worktree `scratchpad/r049/final2/wt`(0ddfdbb, detached). node_modules 는 본 트리 것을 심볼릭 링크로 썼다. 옛 서버를 띄우려고 `final2/base`(500a540)도 만들었다.
- 증거 폴더: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r049/final2/`
  - 결과 파일: pytest.txt · vitest.txt · lint.txt · tsc.txt · build.txt · openapi.json · muts.json · mut-out.md
  - 브라우저: la.js · shots/logoutall-pc.png · shots/logoutall-phone.png

## 조건부 목록 (합치기 전에 닫는다)

모두 시험만 고치면 된다. 코드는 옳게 동작한다. 브라우저에서 직접 확인했다(아래 "화면").

1. **N4 — 실패 뒤 확인 창이 다시 눌리는지를 시험이 지키지 않는다.**
   - 뮤테이션: `AppHeader.tsx:64` 의 `setLeavingEverywhere(false)` 를 지운다. 결과는 **살아남음**.
   - 이 줄이 빠지면 창의 두 단추가 `disabled` 로 남는다. Esc 와 바깥 누름도 막힌다(`ConfirmDialog.tsx:43,48,59,76,79`). 사용자는 창에 갇힌다.
   - 0ddfdbb 의 새 안내는 "이 기기에서만 나가려면 "나가기"를 누르세요"라고 말한다. 그러려면 먼저 이 창을 닫아야 하므로 이 줄이 꼭 있어야 한다.
   - 고칠 것: `AppHeader.test.tsx:290-298`(500)이나 `:325-347`(405) 시험에 한 줄을 더한다. 실패 뒤 `취소` 단추가 `disabled` 가 아니고, 누르면 창이 닫히는지 본다.
2. **N2 — 404 갈래를 시험하지 않는다.**
   - 뮤테이션: `(e.status === 404 || e.status === 405)` 를 `(e.status === 405)` 로 바꾼다. 결과는 **살아남음**.
   - 커밋 설명과 앞 판정 참고는 dist 가 없는 옛 서버가 404 를 준다고 적었다. 그 경우 다시 영어 "Not Found" 가 뜬다.
   - 고칠 것: 같은 시험을 404 로도 돈다(`it.each([404, 405])`).
3. **N7 — 티커 한도를 위로 푸는 것을 시험이 잡지 못한다.**
   - 뮤테이션: `TICKER_MAX = 64` 를 `1000` 으로 바꾼다. 결과는 **살아남음**.
   - 새 시험은 64자를 받는지만 본다(`test_input_limits.py:67`). 65자 거절은 아직 기호 `schemas.TICKER_MAX + 1` 로만 본다(`:17`). 그래서 숫자를 올리면 시험도 따라 올라간다.
   - 이름(201)·구분(61)·순서(501)는 거절도 글자 그대로의 값으로 시험한다. 티커만 빠졌다.
   - 고칠 것: `client.post("/api/stocks", json={"ticker": "A" * 65}).status_code == 422` 를 더한다.

**참고**(조건 아님)
- CI 두 갈래가 초록인지는 바깥 인터넷이 없어 보지 못했다. 총괄이 PR 에서 본다.
- `status.md:3` 은 아직 "진행 중"이다. §5 의 "끝·푸시·PR" 은 총괄이 끝낼 때 닫는다. 앞 판정의 "TSLA 8주" 참고는 닫혔다. 지금 `status.md:24` 는 "TSLA 60주"라고 적는다.
- 브라우저 콘솔에 `Failed to load resource: … 405` 가 한 줄 찍힌다. 이것은 브라우저가 스스로 남기는 네트워크 기록이고 앱 오류가 아니다.
- F7 은 앞 판정처럼 등가라서 이번에 다시 돌리지 않았다.

## (1) 조건 1 이 닫혔는지 — 직접 뮤테이션 11줄

`MUT_REPO=final2/wt python tools/mutate.py muts.json mut-out.md` 로 돌렸다. 매번 원래대로 돌려놓았고, 끝에 `git status` 는 깨끗했다.

| 뮤테이션 | 결과 |
| --- | --- |
| F5 `ORDER_MAX` 500→50 | 잡힘 |
| F6 중립 틀 "이 종목 자신은 빼고, " 지움 | 잡힘 |
| F8 `NAME_MAX` 200→100 | 잡힘 |
| F9 `TICKER_MAX` 64→16 | 잡힘 |
| N1 화면: 405 를 안내에서 뺌(404만) | 잡힘 |
| N2 화면: 404 를 안내에서 뺌(405만) | **살아남음 → 조건 2** |
| N3 화면: 모든 4xx·5xx 를 "서버가 모름"으로 | 잡힘(500 시험 `:290`) |
| N4 화면: 실패 뒤 `setLeavingEverywhere(false)` 지움 | **살아남음 → 조건 1** |
| N5 `CATEGORY_MAX` 60→30 | 잡힘 |
| N6 `ORDER_MAX` 500→499 | 잡힘 |
| N7 `TICKER_MAX` 64→1000 | **살아남음 → 조건 3** |

→ 앞 조건 1 의 네 줄(F5·F6·F8·F9)은 **닫혔다**. 새로 돌린 7줄 가운데 3줄이 살아남았다. 그중 둘은 0ddfdbb 가 더한 AppHeader 고침을 시험이 지키지 못하는 곳이다.

## (2) 0ddfdbb 가 회귀를 만들었는지

| 잰 것 | 시작(500a540, `r049/baseline`) | 앞 끝(f1e4fd1) | 지금(0ddfdbb) | 판정 |
| --- | --- | --- | --- | --- |
| pytest | 1489 통과 · 3 실패(주말) · 3 건너뜀 | 1531 · 0 실패 | **1532 통과 · 0 실패 · 3 건너뜀**(145.8 s) | 통과 |
| vitest | 1030 (62 파일) | 1049 (63) | **1050 통과 (63 파일)** | 통과 |
| lint 경고 | 22 | 22 | **22** | 통과 |
| tsc | 통과 | 통과 | `npx tsc -b` → 0 | 통과 |
| 빌드 · 첫 화면 JS gzip | 113.92 kB | 114.37 kB | **114.47 kB** `index-BeYhyM03.js`, rc 0 | 통과(+0.10 kB, 안내 한 문장) |
| API 모양(`apidiff` 시작과 비교) | — | — | 빠짐 **0** · 타입 바뀜 6(모두 요청 쪽 maxLength·maxProperties·propertyNames) · 더해짐 1 `POST /api/auth/logout-all` | 통과 |
| API 모양(f1e4fd1 과 비교) | — | — | 빠짐 0 · 바뀜 0 · 더해짐 0. JSON 이 같음(`identical True`) | 통과 |

- 서버 코드는 f1e4fd1 뒤로 바뀌지 않았다. 그래서 응답 사진·성능·Alembic(0015)은 앞 판정의 측정이 그대로 맞는다.

## (3) RULES §5 합격 기준 — 라운드 전체

| 기준 | 판정 | 근거 |
| --- | --- | --- |
| 모든 항목 합격, 조건부 비었음 | **아직** | 위 조건 1-3. CI 는 못 봄(참고) |
| 테스트 수 줄지 않음, lint 늘지 않음 | 통과 | pytest 1489+3→1532, vitest 1030→1050, lint 22→22 |
| 새 기능을 켜지 않으면 이전과 같은 결과 | 통과 | API 빠짐 0. 서버 diff 는 f1e4fd1 과 같다(앞 판정에서 같은 날 응답 사진 차이 48 은 모두 데모 TSLA 0→60주) |
| 옛 화면·새 서버, 새 화면·옛 서버 | 통과 | 새 화면 ↔ 옛 서버는 이번에 다시 봤다(아래 "화면"). 옛 화면 ↔ 새 서버는 서버가 그대로라서 앞 판정 ② 가 맞다 |
| 못 끝냄 없음 | 통과 | C 의 못 끝냄 1 은 2f528db 에서 고쳤다(`status.md:24`) |
| 문서가 코드와 맞음 | 통과 | 0ddfdbb 는 문서를 바꿀 동작을 더하지 않았다(오류 문구뿐). 앞 판정의 문서 줄은 그대로 맞다 |
| status "끝"·푸시·PR·CI | 아직 | `status.md:3` "진행 중". 총괄 몫 |

## 화면 — 0ddfdbb 가 건드린 확인 창

- 띄운 것: 옛 서버(500a540 의 `devtools.fake_server`)에 0ddfdbb 로 빌드한 dist 를 얹었다. 포트 8195. 첫 화면은 `index-BeYhyM03.js` 를 내준다.
- 흐름(`la.js`): friend 로 로그인 → 계정 메뉴 → 모든 기기에서 나가기 → 창에서 확인
- **1400 결과**
  - 창에 "서버가 아직 이 기능을 모릅니다 — 서버 업데이트가 끝난 뒤 다시 눌러 주세요. 이 기기에서만 나가려면 "나가기"를 누르세요."가 뜬다. 영어 "Method Not Allowed" 는 없다.
  - 실패 뒤 단추는 `[["취소",false],["모든 기기에서 나가기",false]]` 이다. 둘 다 다시 눌린다.
  - 취소를 누르면 창이 0개가 되고 로그인은 그대로다. 가로 넘침은 없다.
- **360×640 결과**: 1400 과 같다. 빨간 안내 칸이 단추 위에 넘치지 않고 들어간다(`shots/logoutall-phone.png`).
- 콘솔: 브라우저의 405 리소스 기록 한 줄만 있다(참고).

## 작업 트리

```
$ cd …/scratchpad/r049/final2/wt && git status
Not currently on any branch.
nothing to commit, working tree clean
```
- 그 뒤 `git worktree remove` 로 `final2/wt`·`final2/base` 를 지웠다.
- 가짜 서버 8195(PID 17757)는 `kill $(cat old.pid)` 로 껐다. `ps -p` 로 사라진 것을 확인했다.
- 본 트리 `/home/user/Dashboard` 의 `git status --short` 는 이 파일을 쓰기 전에 빈 출력이었다. 지금은 이 파일 `final-review2.md` 하나만 커밋하지 않은 채 남아 있다.
