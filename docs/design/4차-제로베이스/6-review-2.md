# 디자인 4차 묶음 6 손님 · 처음 온 사람 · 빈 화면 — 두 번째 검토 (e5218cd)

## 판정: 조건부 합격 (셋 — 막음은 없다)

검토 범위는 `95f5ff0..e5218cd` 이다. 커밋은 44862ef(audit 기록), 86e7503(사용자 확인 보완), e5218cd(첫 검토 조건 보완) 셋이다.
- 따로 만든 worktree(`--detach e5218cd`)에서 직접 돌리고 쟀다.
- 화면은 먼저 `npm run build` 했다.
- 가짜 서버는 포트 8795 에 띄웠다. `--data-dir` 는 저장소 밖 scratchpad/r6b/data 이다.
- 주 작업 트리, 8765, backend/.devdata 는 건드리지 않았다.

첫 검토 조건 넷은 겉으로는 모두 풀렸다. 백엔드 전체 pytest 와 CI 도 초록이다. 다만 조건 1 을 푼 방식에 빈틈이 있다(아래 조건 1).

### 조건 (셋)

1. **[고쳐야 함] "종목은 30개까지" 를 지키는 백엔드 테스트가 이제 주석을 보고 통과한다.**
   - `Dashboard.tsx:766` 에 JSX 주석이 새로 생겼다. `{/* "종목은 30개까지" — 서버 한도와 같은 말인지 backend/tests/test_policy_page.py 가 본다 */}`
   - `test_first_screen_states_the_same_cap`(`backend/tests/test_policy_page.py:65`)은 `Dashboard.tsx` 원문 전체에서 `종목은 30개까지` 를 찾는다. 그래서 이 주석 하나로도 통과한다.
   - 돌연변이로 확인했다.
     - 보이는 글만 "30개까지 담을 수 있습니다." 로 줄였다(첫 검토에서 깨졌던 바로 그 모양). 결과는 `pytest tests/test_policy_page.py` → `19 passed` 다. 프런트 테스트도 `Dashboard.test` 60 passed 로 아무도 못 잡는다.
     - 주석의 말까지 지우면 `1 failed, 18 passed` 다. 주석이 지킴을 막고 있다는 뜻이다.
   - 반대 방향도 같다. 서버 한도가 30 그대로인데 화면 글을 "종목은 50개까지" 로 바꿔도, 주석이 남아 있으면 테스트가 통과한다.
   - 고칠 것(backend 는 diff 0 이어야 하니 프런트에서 고친다):
     - 주석에서 `종목은 30개까지` 를 뺀다. 예: "한도 문구 — 서버 한도와 같은지 backend/tests/test_policy_page.py 가 본다".
     - 처음 온 사람 테스트에 `getByText('종목은 30개까지 담을 수 있습니다.')` 하나를 더한다. v6 "바꾼 곳마다 테스트" 에 맞추는 것이다.
2. **[고쳐야 함] "찾기 칸에 커서" 표시가 기록(history)에 남아 있다. 그래서 그냥 돌아와도 커서가 다시 간다.**
   - `focusSearch` 는 `<Link state>` 로 넘긴다. 이 값은 그 기록 칸의 `history.state` 에 그대로 남는다. `StockManager` 는 새로 그려질 때마다 이 값을 읽는다(`StockManager.tsx:100-103`, `searchKey` 는 0 으로 다시 시작한다).
   - 실측(폰 390, new@):
     - /stocks/AAPL 에서 "종목 탭으로" 를 누르면 커서가 간다(의도대로).
     - 칸을 빼고 VOO 줄을 눌러 종목 안으로 들어간다. 거기서 ‹("종목 목록으로") 를 누르면 /stocks 로 돌아오고 커서가 다시 찾기 칸에 간다. 그때 `history.state` 는 `{"usr":{"focusSearch":true},…}` 다.
     - 매크로 탭으로 갔다가 브라우저 뒤로가기를 해도 같다(F5).
     - /stocks 를 새로 고쳐도 같다(F6).
   - 폰에서는 ‹ 로 목록에 돌아올 때마다 자판이 저절로 뜬다. 이번 보완이 피하려던 것("그냥 탭으로 오면 안 옮김 — 폰 자판")이 바로 이것이다. ‹ 로 돌아오는 것은 종목을 담은 뒤 매일 하는 동작이다.
   - 고칠 것: 커서를 한 번 옮긴 뒤 표시를 지운다.
     - 예: `navigate('.', { replace: true, state: { ...navState, focusSearch: undefined } })`. 아니면 `purged` 처럼 한 번만 쓰는 값으로 다룬다.
     - "종목 안에서 ‹ 로 돌아오면 커서가 안 간다" 는 테스트를 하나 둔다.
3. **[고쳐야 함 — 테스트] 말한 동작 셋을 지키는 테스트가 없다(돌연변이가 살아남음).**
   - A2: `NoStocksYet.tsx` 의 `state={{ focusSearch: true }}` 를 지웠다. 리밸런싱 · 재무 빈 화면의 "종목 담으러 가기" 가 커서를 안 넘기게 되는데, 1175 passed 로 그대로다.
   - A3: `StockDetailPage.tsx` 의 "종목 탭으로" 에서 같은 것을 지웠다. 이것도 1175 passed 다.
   - A1: `focusOnMount={focusSearch && searchKey === 0}` 을 `focusSearch` 로만 바꿨다. 종목을 담은 뒤 다시 그려진 칸에도 커서가 가게 되는데, `StockManager.test` 64 passed 다.
     - status 가 적은 "종목을 담아 칸이 다시 그려져도 다시 안 옮김" 을 아무도 지키지 않는다는 뜻이다.
     - 실제 동작은 맞다. 실측으로 담은 뒤 `document.activeElement` 는 BODY 였다.
   - 고칠 것:
     - 링크 둘(리밸런싱 · 재무 빈 화면 단추, 담지 않은 종목의 "종목 탭으로")에 Dashboard 테스트처럼 probe 경로로 `focusSearch` 를 확인하는 it 을 하나씩 둔다.
     - StockManager 에 "담은 뒤에는 커서가 안 간다" 를 하나 둔다.

## 항목별

| # | 항목 | 판정 | 증거 |
|---|---|---|---|
| 0 | 앞 판정 조건 1 "종목은 30개까지" | 통과(빈틈은 조건 1) | `Dashboard.tsx:767` `<p className="hint">종목은 30개까지 담을 수 있습니다.</p>`. 화면도 그렇다(new 320 다크). 문구변경 표의 "처음 온 사람 아래 줄" 칸도 고쳐졌다. backend diff 0 |
| 0 | 앞 판정 조건 2 %p 는 금리차에만 | 통과 | `GuestMacroList.test.tsx:197-199` 는 `getByText('2.65%')` · `queryByText('2.65%p')` 를 본다. 돌연변이 A8(`series.code === 'TERM_SPREAD' &&` 지움) → `1 failed | 17 passed`. 잡는다 |
| 0 | 앞 판정 조건 3 "모두 보기" 링크 색 | 통과 | `guest-macro.css:58-62` 가 `.guest-macro-all, .login-prompt .consent-line a { color: var(--accent) }` 다. 실측 라이트는 `rgb(0, 81, 168)`(대비 6.81), 다크는 `rgb(146, 177, 219)`(8.71) 이다. /macro 에 먼저 다녀온 뒤(:visited)에도 같다. 동의 줄은 손님 다른 탭 넷에서도 같은 색이다 |
| 0 | 앞 판정 조건 4 신호 없는 날 테스트 · 까닭 | 통과 | `Dashboard.test.tsx:455` 가 `getByText('매수, 매도, 비중조절 모두 조용합니다.')` 를 본다. 돌연변이 A9(가운뎃점으로 되돌림) → `1 failed`. status.md 에 "목업 15 ③ 나와 다른 곳의 까닭" 줄이 있다. 개수 뺌(pinned 에 전체 수 없음, api 그대로) · 서버 기본값 줄 · 공포 구간 꼬리표(4-user-2.md:67 좋았던 것) · 곧은 선 |
| 1 | backend · api · lib · types · AppState diff 0 | 통과 | `git diff --stat be919b2 e5218cd -- backend frontend/src/api frontend/src/lib frontend/src/types.ts frontend/src/AppState.tsx` → 빈 출력 |
| 1 | 그 밖 .tsx 한 줄씩 | 통과(조건 2) | `LoginPrompt` 는 sessionStorage 키 하나와 표시만 더했다. `SymbolSearch` 에는 `focusOnMount` prop(표시)이 생겼다. `StockManager` 는 location.state 를 읽기만 한다. `NoStocksYet` · `StockDetailPage` · `Dashboard` 는 Link 에 state 를 더했다. `PortfolioView` 는 글이다. 상태 저장 · 경로 · 권한은 바뀌지 않았다. state 가 기록에 남는 것은 조건 2 다 |
| 2 | 프런트 테스트 | 통과 | `npx vitest run` → `Test Files 69 passed (69)`, `Tests 1175 passed (1175)`. 1171 + 4(Policy 1 · Dashboard 1 · StockManager 2)다. 지운 it 은 0 이다(`git diff 95f5ff0 e5218cd -- frontend/src \| grep "^-\s*it("` 빈 출력) |
| 2 | **백엔드 테스트(전체)** | 통과 | worktree 에서 `cd backend && python -m pytest -q -x` → `1611 passed, 5 skipped in 149.97s`. `tests/test_policy_page.py tests/test_signal_rules.py` → `55 passed`(실행자 보고와 같다). CI: `gh run list` 에서 e5218cd "테스트" 는 success, 86e7503 은 failure(첫 검토가 본 것) |
| 2 | 린트 | 통과 | `npm run lint` 의 `warning` 줄 19 |
| 2 | tsc · build | 통과 | `npx tsc -b` exit 0, 출력 없음. `npm run build` → `✓ built in 521ms` |
| 2 | 고친 테스트 ↔ 문구변경 표 | 통과 | 새 표 "묶음 6 · 사용자 확인 보완" 의 두 줄(아직 승인 전 · 보유 없음)이 새 it · 고친 it 과 맞는다. "처음 온 사람 아래 줄" 칸도 고쳐졌다 |
| 3 | 색은 tokens.css 만 | 통과 | 바뀐 줄(`git diff 95f5ff0 e5218cd -- frontend/src` 의 + 줄)에 `#hex` · `rgb(` · `hsl(` 이 0 이다. 새 색은 `var(--accent)` · `var(--border)` 뿐이다 |
| 3 | CSS 300줄 이하 | 통과 | guest-macro.css 62 · flat.css 253 |
| 4 | 사용자 확인 보완 — 승인 대기 "아직 승인 전" | 통과 | pending@ 390 라이트: 처음에는 `[role=status]` 가 없다. "승인됐는지 확인" 을 누르면 / 로 다시 읽고 `아직 승인 전입니다 (15:47에 확인).` 이 나온다. 그때 sessionStorage 는 비어 있다. 그냥 새로 고치면 사라진다(한 번만). 종목 탭에서 눌러도 / 로 가서 같은 글이 나온다. Policy.test 새 it 이 글 모양 · 키 지움을 본다. 돌연변이 A5(지우기 뺌) · A14(role 뺌) · A15(저장 뺌) 모두 잡는다 |
| 4 | 빈 화면 "종목 담으러 가기" · "종목 탭으로" → 커서 | 통과(조건 2 · 3) | 실측: 홈(F1) · 리밸런싱(F3) · /stocks/AAPL(F4) 에서 오면 `INPUT[combobox]` 에 커서가 간다. 아래 탭으로 오면 `A 종목` 에 머문다(F2). 담은 뒤에는 BODY 다(F8). 다만 ‹ · 뒤로 · 새로 고침에도 다시 커서가 간다(조건 2). 돌연변이 A4 · A6 · A7 은 잡고, A1 · A2 · A3 은 살아남는다(조건 3) |
| 4 | 손님 화면 위 선 | 통과 | 손님 · 대기 홈에서 `.login-prompt` 는 `border-radius 0px`, `border-top 1px solid`, 옆 `0px none` 이다(320 · 390 · 1280 × 두 테마). 스크린샷 guest-390-light · guest-1280-light 에서 곧은 선이다. 다른 탭의 안내는 12px 그대로(선 없음) |
| 4 | 링크 강조색 | 통과(참고 1) | 위 0-3 줄과 같다 |
| 4 | PC 로그인 안내 폭 720 | 통과(참고 2) | 1280 에서 손님 홈 · 종목 · 리밸런싱 · /stocks/AAPL, 대기 홈 · 종목 모두 `.login-prompt` 너비 720, left 260 이다. 홈 목록도 720 이다 |
| 4 | 보유 없음 "보유 종목의 "수정"" | 통과 | new@ 가 VOO(수량 없음)를 담은 뒤 1280 다크: "아직 보유수량을 적은 종목이 없습니다. 보유 종목의 "수정"이나 리밸런싱에서…". "수정" 단추는 "보유 종목" 머리 오른쪽에 있다. 돌연변이 A13 → `1 failed` |
| 4 | SymbolSearch `focusOnMount` | 통과 | `SymbolSearch.tsx:59-63` 은 처음 그릴 때 한 번만 실행된다(deps `[]`). 다른 쓰는 곳은 prop 이 없어 그대로다 |
| 4 | 참고 반영 — role="list" · 구역 이름 · PageIntro | 통과 | `GuestMacroList.tsx:96` · `Dashboard.tsx:749` 에 `role="list"` 가 있다. `<section className="guest-macro">` 의 aria-label 이 빠져 "오늘 매크로" 를 한 번만 읽는다. `PageIntro.tsx:7-8` 주석이 고쳐졌다. role="list" · 구역 이름은 테스트가 없다(A11 · A12 · A16 살아남음). 접근성 속성이라 참고로만 둔다 |
| 5 | 폰 320 / 390 · PC 1280 × 다크 · 라이트 | 통과 | 화면 11개(손님 홈 · 종목 · 리밸런싱 · AAPL, 대기 홈 · 종목, new 홈 · 종목 · 리밸런싱 · AAPL, 주인 홈) × 6 조건 = 66: 페이지 넘침 0, 콘솔 · pageerror 0. 320 다크 손님 · new 홈 스크린샷에서 잘린 글이 없다. new@ 빈 화면은 `--reset` 으로 되돌린 뒤 쟀다 |
| 6 | 돌연변이 | 11/16 잡음 | 잡음: A4 · A5 · A6 · A7 · A8 · A9 · A13 · A14 · A15, 백엔드 쪽 A10(주석까지 지운 경우만). 살아남음: A1 · A2 · A3(조건 3), A10(보이는 글만 — 조건 1), A11 · A12 · A16(role · 이름, 참고). 돌연변이마다 `git checkout -- <file>` 로 되돌렸다 |
| 7 | 계획 검토 걱정 | 해당 없음 | plan-*.md 에 묶음 6 고유 막음이 없다(첫 검토와 같다) |

## 참고 (조건 아님)

1. 홈 "보유 없음" 문장 속 `리밸런싱` 링크(`PortfolioView.tsx:242`)는 브라우저 기본색이다. 라이트 `rgb(0, 0, 238)`, 다크 `rgb(158, 158, 255)` 이다.
   - 바로 옆 "금액 가리기" · "리밸런싱(D-41)" · "시그널 목록 보기" 는 강조색이라 한 화면에서 색이 갈린다(스크린샷 new-1280-dark).
   - 86e7503 이 이 문장을 고쳤는데 링크 색은 손님 화면 두 곳에만 넣었다. 사용자 확인의 "링크 색이 따로 놂" 과 같은 종류다. 전역 `a` 규칙이나 이 문장 하나를 넣기를 권한다.
2. PC 1280 바닥 줄(개인정보처리방침 · 투자 권유 아님)은 본문 가운데에 있다(left 약 578). 그래서 왼쪽 720 칸과 줄이 안 맞는다.
   - 6-user.md "거슬린 화면" 셋째 줄의 뒷부분이다. 폭은 고쳤지만 바닥 줄은 status 의 ③ 목록에도 없다. 넘길 것이면 ③ 에 적어 둔다.
3. "아직 승인 전입니다" 의 `role="status"` 는 다시 읽은 화면에 처음부터 있다. 처음부터 있는 live region 은 VoiceOver · TalkBack 이 읽지 않을 때가 있다. 눈으로 보는 데는 문제없다.
   - 같은 탭에서 누른 뒤 승인됐으면 PendingPrompt 가 안 그려져서 키가 남는다. 해는 없다(다시 대기가 될 일이 거의 없다).
4. `flat.css:216` 주석 "읽기 프로그램은 목록 번호를 따로 읽는다" 는 role="list" 가 들어가서 이제 맞다.
5. 손님 · 처음 온 사람 화면의 H1 → H3, 금리차 음수의 `-`/`−` 는 첫 검토 참고 2 · 3 그대로다.

## 정리

- 가짜 서버(8795)는 `kill $(cat scratchpad/r6b/server.pid)` 로 껐다. 데이터를 되돌리려고 한 번 다시 띄웠고(`--reset`), 그것도 같은 방법으로 껐다.
- 돌연변이 16개는 각각 `git checkout -- <file>` 로 되돌렸다.
- 판정문은 저장소 밖(scratchpad/r6b/6-review-2.md)에 썼다. 저장소에 옮겨 넣는 것은 총괄이 한다.
- e5218cd worktree 의 `git status`(지우기 직전):

```
Not currently on any branch.
nothing to commit, working tree clean
```

- 주 작업 트리 `git status`:

```
On branch claude/design-4-zerobase
Your branch is up to date with 'origin/claude/design-4-zerobase'.

nothing to commit, working tree clean
```
