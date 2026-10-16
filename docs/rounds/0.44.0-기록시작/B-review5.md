# 합격

B "종합 신호등 정리"의 다섯 번째 검토로, 범위를 좁혀 본 검토다. 머리는 `5fe2513`(origin/claude/new-session-fftcg1, detached)이고, worktree는 `agent-a02aa0928e8ac3d31`이다.
주인이 범위를 좁혔으므로 두 가지만 봤다. 하나는 네 번째 검토 조건 O4가 풀렸는지, 다른 하나는 B가 바꾼 `+` 줄 안에서 하는 뮤테이션이다. 화면·호환·문서는 다시 보지 않았다(앞 네 번 모두 통과).

## 1. 네 번째 검토 조건 O4 — 풀렸다

- 고친 커밋은 `4e734f9`다. 바뀐 파일은 `frontend/src/pages/Dashboard.test.tsx`(+3 -1)와 문서 둘뿐이고, 제품 코드는 0줄이다. 테스트 데이터에 `SCHD`(`밴드 초과(매도 검토)`)를 더해 초과 2·미달 1로 만들었다. 확인하는 말은 `/^비중 초과 2$/`·`/^비중 미달 1$/`이다(`Dashboard.test.tsx:397-412` 부근).
- 직접 넣어 봤다. 명령은 `npx vitest run --maxWorkers=2 src/pages src/components src/lib`이다.

| 뮤테이션 | 자리 | 결과 |
| --- | --- | --- |
| O4 `비중 초과 {summary.sellReview}` → `{summary.buyReview}` | `Dashboard.tsx:850` | 잡힘 — exit 1 · 1 failed / 817 passed (818). 실패는 "맨 위 요약도 같은 모양 — 매수 ▲ · 매도 ▼ · 비중조절 ◆" 테스트다 |
| O4 반대: `비중 미달 {summary.buyReview}` → `{summary.sellReview}` | `Dashboard.tsx:856` | 잡힘 — exit 1 · 1 failed / 817 passed. 실패한 테스트는 위와 같다 |

## 2. B가 바꾼 줄 안에서 하는 뮤테이션 — 살아남은 것 0

대상은 `git diff 4844bf0 5fe2513 -- (지정한 6개 파일)`의 `+` 줄이다. 앞 목록과 겹치는 것은 뺐다. 앞 목록은 B-mutation.md의 13개, M1–M4, N1–N4, O1–O4다(관망 글자·빈칸·풀이, 이름표 지우기, 비활성 비중, 매도 꼬리표 빼기, 옛 말, 정기 리뷰 비중 줄, role="img", 범례, hidden, 풀이 줄, 표 머리, title, isWeightReason 매수 빠짐, 요약 수).
`frontend/src/index.css`의 `+` 줄(`.signal-cell-rows`, `.traffic-watch`)은 **제외했다**. vitest 설정이 `css: false`라서 단위 테스트로는 볼 수 없다. 이 줄들은 앞 검토의 화면 확인이 덮었다.

스크립트는 `r044/revB5/mut.py`다. 한 줄을 바꿔 돌린 뒤 원래대로 되돌리고, sha256이 같은지 assert한다. 결과는 `r044/revB5/out.md`에 있다.

| 뮤테이션 | 자리 | 결과 |
| --- | --- | --- |
| P1 `{weight.length > 0 && (` → `>= 0` (사유가 없어도 빈 "비중" 줄을 그림) | `Dashboard.tsx:116` | 잡힘 — 2 failed / 816 passed. 실패는 "카드: 시그널 · 비중 · 매수 조건 줄 …"과 "신호 칸은 이름표 두 줄 …"이다 |
| P2 관망 "—"에서 `aria-label={WATCH_HINT}` 지움(title은 남김, O2와 반대쪽) | `Dashboard.tsx:75` | 잡힘 — 1 failed. 실패는 "관망은 흐린 "—" — 상자 없이, 설명과 읽어 주는 말은 "관망"" 테스트다 |
| P3 `card.knee_buy_v2 && card.shoulder_sell_ref &&` → `card.shoulder_sell_ref &&` (매도만 떠도 꼬리표가 붙음) | `Dashboard.tsx:113` | 잡힘 — 1 failed. 실패는 "신호 칸은 이름표 두 줄 …" 테스트다 |
| P4 초과 사유 배지 `label: '비중 초과'` → `'비중 미달'` (말을 뒤바꿈, 옛 말 아님) | `display.ts:302` | 잡힘 — 3 failed. 실패는 `display.test.ts`, `Dashboard.test.tsx`, `RebalancePanel.test.tsx`에서 났다 |
| P5 `over: '비중 초과'` → `'비중 미달'` (말을 뒤바꿈) | `portfolio.ts:38` | 잡힘 — 2 failed. 둘 다 `Dashboard.portfolio.test.tsx`(신호 점, 폰 두 줄)다 |
| P6 `hasWeightSignal`의 `reasons.some(isWeightReason)` → `reasons.length > 0` | `weightSignal.ts:15` | 잡힘 — 1 failed. 실패는 "정기 리뷰 사유만 붙은 종목은 비중조절로 세지 않는다" 테스트다 |

정리하면 직접 넣은 8개(O4 둘, P1–P6)가 모두 잡혔고, 살아남은 것은 0이다.

## 회귀 한 번

| 검사 | 결과 |
| --- | --- |
| `npx vitest run --maxWorkers=2` | exit 0 · `Test Files 58 passed (58)` · `Tests 894 passed (894)` (`r044/revB5/vitest.txt`) |
| `npm run lint` | exit 0 · 경고 22개 (`grep -c ": warning "` = 22, `r044/revB5/lint.txt`) |
| `npx tsc -b --noEmit` | exit 0 · 출력 없음(0바이트, `r044/revB5/tsc.txt`) |

## 실행 기록

- worktree에 `node_modules`가 없었다. 그래서 `frontend/node_modules` → `/home/user/Dashboard/frontend/node_modules` 심볼릭 링크를 잠시 두었고, 끝난 뒤 지웠다.
- 가짜 서버는 띄우지 않았다(화면은 범위 밖).
- 저장소 파일은 고치지 않았고 커밋도 하지 않았다. 뮤테이션으로 바꾼 줄은 스크립트가 되돌렸고, sha256이 같은지 assert했다.

## worktree `git status`

```
HEAD detached at origin/claude/new-session-fftcg1
nothing to commit, working tree clean
```
