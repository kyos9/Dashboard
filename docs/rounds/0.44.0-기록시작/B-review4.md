# 조건부 합격

B "종합 신호등 정리" 네 번째 검토다. 머리는 `3530d0c`(origin/claude/new-session-fftcg1, detached)이고, 검토자 worktree는 `agent-ac19eaa47d53a8526`이다.

세 번째 검토의 조건 N3는 풀렸다. 다시 넣으니 잡힌다. M4도 이제 실패가 그 테스트 하나뿐이다. matchMedia 스텁이 다음 테스트로 새던 문제도 고쳐졌다. 다만 직접 넣은 4줄 가운데 **O4 하나가 살아남았다**. §3 기준은 "살아남은 것 0"이므로 조건이 하나 남는다.

## 조건 (합치기 전에)

1. **신호 요약의 "비중 초과 N"·"비중 미달 N"이 수를 서로 바꿔 보여 줘도 통과한다 (O4)** — 고쳐야 함
   - 뮤테이션: `Dashboard.tsx:850` `비중 초과 {summary.sellReview}` → `비중 초과 {summary.buyReview}`
   - 결과: `src/pages src/components src/lib` 818개가 모두 통과했다(exit 0).
   - 원인: 지키는 테스트는 `Dashboard.test.tsx:397-409` 하나다. 그런데 이 테스트의 데이터가 초과 1·미달 1로 수가 같다. 그래서 두 수를 바꿔도 테스트가 알아채지 못한다.
   - 이 구멍은 라운드 시작(`4844bf0` 의 `:341,344`, `매수 검토 1`/`매도 검토 1`) 때부터 있었다. B는 같은 줄의 말만 바꿨다.
   - 그래도 B의 목표가 "초과·미달을 헷갈리지 않게"이고, 이 줄은 B가 고친 줄이다. 그래서 조건으로 둔다.
   - 고칠 것: 그 테스트의 데이터를 서로 다른 수로 바꾼다. 예를 들어 `밴드 초과(매도 검토)` 종목을 2개로 하고 `/^비중 초과 2$/`·`/^비중 미달 1$/`를 확인한다. 테스트 파일만 바꾸면 된다.

## 앞 조건 — 풀렸는가

| 조건 | 판정 | 증거 |
| --- | --- | --- |
| B-review3 N3 — 풀이 줄을 "(과중·미달)"로 되돌려도 통과 | 통과 | `Dashboard.test.tsx:361-363`에 `toHaveTextContent('비중 초과·비중 미달')`와 `not.toMatch(/과중/)`가 더해졌다. N3를 다시 넣으니 `Tests 1 failed / 817 passed (818)`이고, 실패 자리는 `Dashboard.test.tsx:362:19`(`toHaveTextContent`)다 |
| B-review3 참고 1 — 실패하면 matchMedia 스텁이 다음 테스트로 샌다 | 통과 | `vi.stubGlobal('matchMedia', …)`(모든 질의에 참)를 `pretendPhone()`으로 바꿨다. `pretendPhone()`은 `NARROW_QUERY`만 참으로 한다. 정리는 `try { … } finally { forgetPhone() }`(`:350-366`)에서 한다. M4를 다시 넣으니 **1 failed / 817 passed**였다. 실패는 `:359:19` `toBeVisible`이다. 3차 때는 14 failed였다 |
| `vi.unstubAllGlobals()`가 빠져 innerWidth 360이 새는가 | 새지 않음 | 파일 맨 위의 `beforeEach`(`Dashboard.test.tsx:218-224`)가 테스트마다 `vi.stubGlobal('innerWidth', 1440)`으로 다시 놓는다. 전체가 통과한 것(아래)도 같은 뜻이다 |
| B-review·B-review2 조건 | 통과 (앞 검토에서 확인, 제품 코드는 그 뒤 그대로) | `git diff d00e114 3530d0c --stat`: `frontend/src/pages/Dashboard.test.tsx` 32줄과 문서 셋(`B-mutation.md`, `B-review3.md`, `status.md`)만 바뀌었다. 제품 코드는 0줄이다 |

## §3 — B 범위

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 완료 조건 (plan "B." + 주인 결정 ①) | 통과 (앞 검토 그대로) | 3530d0c는 제품 코드를 바꾸지 않았다. 결정 셋은 코드에 그대로 있다. 이름표 두 줄은 `SignalAndWeightRows`, 흐린 "—"와 `WATCH_HINT`는 `Dashboard.tsx` 상단, "비중 초과/비중 미달"은 `display.ts`·`portfolio.ts`·`Dashboard.tsx:850,856`에 있다. 앞 판정 셋이 화면으로 확인했다 |
| 계획 때 걱정 | 통과 (앞 검토 그대로) | 바뀐 것이 테스트 파일뿐이라 새로 볼 것이 없다 |
| 회귀 — 프런트 전체 | 통과 | `npx vitest run --maxWorkers=2` → `Test Files 58 passed (58)` · `Tests 894 passed (894)`, exit 0. 3차 때와 같은 수다(이번 수정은 테스트를 더하지 않고 확인 줄만 더했다). 출력: `r044/revB4/vitest.txt` |
| lint | 통과 | `npm run lint` exit 0, 경고 22개(시작·3차와 같음). `r044/revB4/lint.txt` |
| tsc | 통과 | `npx tsc -b --noEmit` exit 0, 출력 없음. `r044/revB4/tsc.txt` |
| 격리 / 마이그레이션 / 입력 한도 / 비밀 / 데이터 경계 / 외부 호출 / 가짜 서버 | 해당 없음 | B는 화면만 바꾼다. 이번 커밋은 테스트 파일만 바꾼다 |
| 호환 — API 모양 | 통과 (3차 그대로) | B 커밋들은 `backend`·`src/api`를 건드리지 않는다(3차 `apidiff`: 빠짐 0 · 타입 바뀜 0). 3530d0c도 마찬가지다 |
| 뮤테이션 — 실행자 결과 | 통과 | `B-mutation.md` "세 번째 검토 뒤" 표에 N3 잡힘, "M4 정확히 1 failed"라고 적혀 있다. 직접 다시 돌려 같은 결과를 얻었다(아래) |
| 뮤테이션 — 직접 3줄 이상 | **실패 (O4 살아남음)** | 아래 표. 스크립트 `r044/revB4/mut/mut.py`는 바꾸고 돌린 뒤 되돌리고, sha256이 같은지 assert한다. 명령은 `npx vitest run --maxWorkers=2 src/pages src/components src/lib` |
| 규제 | 통과 (3차 그대로) | 화면 글은 바뀌지 않았다 |
| 화면 | 다시 보지 않음 | `git diff d00e114 3530d0c --stat`으로 바뀐 것이 테스트 파일과 문서뿐임을 확인했다. 빌드 결과물은 3차(`revB3-ui`, PC 1400·360 × 두 테마, 콘솔 오류 0)와 같다. 그래서 다시 띄우지 않았고, 가짜 서버도 띄우지 않았다 |
| 성능 | 해당 없음 | 제품 코드가 바뀌지 않았다 |
| 문서 | 통과 | `B-mutation.md`에 "세 번째 검토 뒤" 표(N3, M4 다시)가 더해졌다. 내용은 직접 돌린 결과와 맞는다. O4가 나왔으니 고친 뒤 한 줄 더 적어야 한다 |

### 직접 뮤테이션 (`r044/revB4/mut/out.md`)

| 뮤테이션 | 자리 | 결과 |
| --- | --- | --- |
| N3 풀이 줄 → "(과중·미달)" (다시) | `Dashboard.tsx:1024` | 잡힘 — 1 failed / 817 passed. 실패는 `Dashboard.test.tsx:362` |
| M4 `hidden={narrow}` (다시) | `Dashboard.tsx:1022` | 잡힘 — **1 failed** / 817 passed. 실패는 그 폰 테스트 하나(`:359`)뿐이다 |
| O1 표 머리 "신호" → "종합 신호등" | `Dashboard.tsx:1186` | 잡힘 — 1 failed. 실패는 "시그널 규칙은 서버에서 … 열 머리" 테스트다 |
| O2 관망 "—"의 `title={WATCH_HINT}` 지우기 | `Dashboard.tsx` `TrafficBadge` | 잡힘 — 1 failed. 실패는 "관망은 흐린 —" 테스트다 |
| O3 `isWeightReason`에서 `매수 검토` 빠뜨리기 | `weightSignal.ts` | 잡힘 — 3 failed |
| O4 "비중 초과 N"에 미달 수(`buyReview`) | `Dashboard.tsx:850` | **살아남음 — 818 passed** |

## 실행 기록

- worktree에 `node_modules`가 없었다. 그래서 `frontend/node_modules` → `/home/user/Dashboard/frontend/node_modules` 심볼릭 링크를 잠시 두었다(`.gitignore`가 무시하므로 status는 깨끗했다). 끝난 뒤 지웠다.
- 뮤테이션 도중 바꾼 저장소 파일은 스크립트가 되돌렸고, sha256이 같은지 assert했다. 가짜 서버는 띄우지 않았다.

## worktree `git status`

```
HEAD detached at 3530d0c
nothing to commit, working tree clean
```
