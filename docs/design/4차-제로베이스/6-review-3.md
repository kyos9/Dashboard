# 디자인 4차 묶음 6 손님 · 처음 온 사람 · 빈 화면 — 세 번째 검토 (4c6cc0b)

## 판정: 합격

검토 범위는 `e5218cd..4c6cc0b`, 커밋 하나다.
- 따로 만든 worktree(`--detach 4c6cc0b`)에서 직접 돌리고 쟀다.
- 화면은 그 worktree 에서 `npm run build` 한 다음에 띄웠다. 서버가 내주는 `assets/index-C7yA5Qqd.js` 와 dist 의 파일이 같다.
- 가짜 서버는 포트 8796 에 띄웠다. `--data-dir` 는 저장소 밖 scratchpad/r6c/data 이다.
- 주 작업 트리, 8765, backend/.devdata 는 건드리지 않았다.

6-review-2 의 조건 셋이 모두 풀렸다. 돌연변이로 확인했고, 폰에서 직접 재서도 확인했다. 새로 깨진 곳은 없다. 남은 것은 참고뿐이다.

## 항목별

| # | 항목 | 판정 | 증거 |
|---|---|---|---|
| 0 | 앞 조건 1 — 주석의 "종목은 30개까지" · 보이는 글 테스트 | 통과 | `Dashboard.tsx` 에서 `30개까지` 는 767 줄 `<p className="hint">종목은 30개까지 담을 수 있습니다.</p>` 한 곳뿐이다. 766 줄 주석에는 그 말이 없다. `Dashboard.test.tsx:282` 가 `getByText('종목은 30개까지 담을 수 있습니다.')` 로 본다. 돌연변이는 아래 6 줄 M1 · M2 · M3 |
| 0 | 앞 조건 2 — 커서 표시를 한 번 쓰고 지움 | 통과 | `StockManager.tsx:108-116` 는 처음 그릴 때 한 번 `navigate(pathname+search, { replace: true, state: purged ? {purged} : null })` 를 부른다. 자식(SymbolSearch)의 포커스 effect 가 부모 effect 보다 먼저 돌기 때문에, 커서를 옮긴 다음에 표시를 지운다. 실측은 아래 4 줄 |
| 0 | 앞 조건 3 — 테스트 넷이 돌연변이를 잡나 | 통과 | 아래 6 줄 N1 · D1 · H1 · S1 · S4 가 모두 잡힌다 |
| 0 | `searchKey === 0` 을 뺀 까닭 | 맞다 | 표시를 지우면 다음 렌더에서 `focusSearch` 가 false 가 된다. `setSearchKey` 는 담기(251 줄) 한 곳에만 있다. 그래서 칸을 다시 그릴 때는 늘 `focusOnMount=false` 이고, 따로 둔 가드는 같은 일을 두 번 하는 군더더기였다. 효과를 빼는 돌연변이(S1)를 넣으면 "담은 뒤" 테스트가 실패한다. 실측도 맞다. 담은 뒤 `document.activeElement` 는 BODY 였다(F3). `App.tsx:28` 의 `PageBoundary key={pathname}` 는 같은 경로로 replace 해도 화면을 다시 만들지 않는다. 그래서 포커스가 살아 있다(F1 · F4 는 INPUT) |
| 1 | backend · api · lib · types · AppState diff 0 | 통과 | `git diff --stat e5218cd 4c6cc0b -- backend frontend/src/api frontend/src/lib frontend/src/types.ts frontend/src/AppState.tsx` → 빈 출력. `be919b2..4c6cc0b` 로 봐도 빈 출력 |
| 1 | 그 밖 .tsx | 통과 | `StockManager` 는 처음 그릴 때 주소 기록(history)의 표시 하나를 지운다. 경로 · 저장 · 권한은 그대로다. `Dashboard.tsx` 는 주석 한 줄만 바뀌었다 |
| 2 | 프런트 테스트 | 통과 | `npx vitest run` → `Test Files 70 passed (70)`, `Tests 1178 passed (1178)`. 1175 에 3 이 더해졌다(NoStocksYet 1 · StockManager 2. StockDetailPage 는 있던 it 을 늘렸다). `git diff e5218cd 4c6cc0b -- frontend/src \| grep "^-\s*it("` → 빈 출력 |
| 2 | **백엔드 테스트(전체)** | 통과 | worktree 에서 `cd backend && python -m pytest -q -x` → `1611 passed, 5 skipped, 6163 warnings in 142.01s`. `tests/test_policy_page.py` → `19 passed` |
| 2 | 린트 | 통과 | `npm run lint` 의 `warning` 줄은 19 다. 새 `eslint-disable-next-line react-hooks/exhaustive-deps` 하나는 SymbolSearch 의 같은 자리와 같은 쓰임이다 |
| 2 | tsc · build | 통과 | `npx tsc -b` → exit 0. `npm run build` → `✓ built in 435ms` |
| 3 | 색은 tokens.css 만 · CSS 300줄 | 통과 | + 줄에 `#hex` · `rgb(` · `hsl(` 이 0 이다. 새 규칙은 `color: var(--accent)` 하나다. flat.css 는 258 줄 |
| 4 | 커서 실측 (폰 390, new@, isMobile · hasTouch) | 통과 | `history.state.usr` 와 `activeElement` 로 쟀다. **F1** 홈 "종목 담으러 가기" → `INPUT[combobox]`, usr `null`. **F2** /stocks 새로 고침 → BODY. **F3** VOO 담은 뒤 → BODY. **F4** /stocks/AAPL "종목 탭으로" → INPUT, usr `null`, idx 1(replace 라 기록 칸이 늘지 않는다). **F5** VOO 안으로 들어가 ‹("종목 목록으로") → BODY. **F6** 매크로로 갔다가 브라우저 뒤로 → BODY. F6b 앞으로 갔다 다시 뒤로 → BODY. **F7** 아래 탭 매크로 → 뒤로 → `A 매크로`(탭 링크), 찾기 칸이 아니다. **F8** 새로 고침 → BODY. /rebalance · /fundamentals 의 "종목 담으러 가기" → INPUT, usr `null`. 화면 오류(pageerror · console error)는 0 이다 |
| 4 | purged 표시(종목 안에서 지우고 돌아온 알림) | 통과 | 커서 표시로 /stocks 에 온 뒤 VOO 안 → 보유 → "VOO 삭제" → "네, 지웁니다" 를 눌렀다. /stocks 로 돌아오고 usr `{"purged":"Vanguard S&P 500 ETF"}`, 알림 `✓Vanguard S&P 500 ETF을(를) 지웠습니다.` 가 나온다(스크린샷 p1). 커서는 가지 않는다(BODY). 새 effect 는 `focusSearch` 가 없으면 바로 끝나서 purged 기록을 건드리지 않는다 |
| 4 | 참고 반영 — `.empty-state a:not(.link-button)` | 통과(해 없음) | 아래 "빈 화면 안 링크" 표를 본다 |
| 5 | 폰 320 / 390 · PC 1280 × 다크 · 라이트 | 통과 | 화면 16개 × 6 조건 = 96 에서 잰 것. 화면은 손님 홈 · 종목 · 리밸런싱 · AAPL, 대기 홈 · 종목, new 홈 · 종목 · 리밸런싱 · 재무 · AAPL, 주인 홈 · 종목 · 매크로, new 보유 없음 홈 · 종목이다. 페이지 넘침 0, pageerror · console error 0. 스크린샷 new-320-dark · new-held-390-light · new-held-1280-dark 에서 잘린 글이 없고, "리밸런싱" 링크가 옆의 "금액 가리기" · "시그널 목록 보기" 와 같은 색이다 |
| 6 | 돌연변이 | 잡을 것은 다 잡음 (아래 표) | 돌연변이마다 `git checkout -- <file>` 로 되돌렸다. 끝난 뒤 worktree `git status` 는 clean 이다 |
| 7 | 계획 검토 걱정 | 해당 없음 | plan-*.md 에 묶음 6 고유의 막음이 없다(앞 두 검토와 같다) |

### 돌연변이

| | 바꾼 것 | 결과 |
|---|---|---|
| M1 | 보이는 글만 "30개까지 담을 수 있습니다." 로 줄임(앞 검토에서 살아남은 모양) | 백엔드 `1 failed, 18 passed` · 프런트 Dashboard.test `1 failed \| 59 passed` — **잡음** |
| M2 | "종목은 50개까지" 로 바꿈 | 백엔드 `1 failed` · 프런트 `1 failed` — **잡음** |
| M3 | 글은 줄이고 주석에 `"종목은 30개까지"` 를 다시 넣음 | 백엔드 `19 passed`(원문 전체를 보니 여전히 주석에 속는다) · 프런트 `1 failed` — 프런트가 **잡음** (참고 1) |
| N1 | `NoStocksYet.tsx` 의 `state={{ focusSearch: true }}` 지움 | `1 failed \| 449 passed` — **잡음** |
| D1 | `StockDetailPage.tsx:88` 의 "종목 탭으로" 에서 같은 것을 지움 | `1 failed \| 17 passed` — **잡음** |
| H1 | `Dashboard.tsx:763` 에서 같은 것을 지움 | `1 failed \| 59 passed` — **잡음** |
| S1 | 표시를 지우는 effect 를 하지 않음(`if (!focusSearch \|\| true) return`) | "뒤로 와도 다시 안 옮긴다" · "담은 뒤 … 다시 옮기지 않는다" 둘 다 `×`, `2 failed \| 64 passed` — **잡음** |
| S4 | `focusOnMount={false}` | `3 failed` — **잡음** |
| S2 | `replace: true` 를 뺌(push) | `66 passed` — 살아남음 (참고 2) |
| S3 | `state: null` 로 purged 까지 버림 | `66 passed` — 살아남음. 지금 흐름에서는 purged 와 focusSearch 가 같이 오는 일이 없어서 동작에 차이가 없다 (참고 2) |

### 빈 화면 안 링크 (`.empty-state a`, 96 조건 전수)

| 자리 | class | 라이트 | 다크 | 비고 |
|---|---|---|---|---|
| 손님 4화면 동의 줄 "개인정보처리방침과 이용약관" | 없음 | `rgb(0, 81, 168)` 대비 6.81 | `rgb(146, 177, 219)` 8.71 | 앞 검토와 같은 값이다(원래 `.login-prompt .consent-line a` 로 같은 색). /policy 에 먼저 다녀와 `:visited` 가 된 뒤에도 같다 |
| new 보유 없음 홈 "리밸런싱"(`PortfolioView.tsx:242`) | 없음 | `rgb(0, 81, 168)` 7.66 | `rgb(146, 177, 219)` 8.21 | 앞 검토에서는 `rgb(0,0,238)` · `rgb(158,158,255)`(브라우저 기본)였다 → 강조색. /rebalance 에 먼저 다녀온 뒤에도 같다. 밑줄은 그대로 |
| AAPL "종목 탭으로", 리밸런싱 · 재무 "종목 담으러 가기" | `link-button` | `rgb(255, 255, 255)` 7.66 | `rgb(11, 15, 24)` 8.70 | `:not(.link-button)` 로 빠져서 단추 글자색 그대로다 |

`.empty-state` 를 쓰는 곳은 11곳이다(`grep -rn empty-state --include=*.tsx`). 단추가 아닌 `<a>` 는 위 두 곳뿐이다. MacroPanel · Dashboard 두 곳 · StockManager · AiSummaryPage · App NotFound 에는 링크가 없거나 `link-button` 만 있다. 손님 홈의 매크로 줄(`a.macro-row-open`)은 `.empty-state` 밖이라 영향이 없다.

## 참고 (조건 아님)

1. `backend/tests/test_policy_page.py:65` 는 여전히 `Dashboard.tsx` 원문 전체를 본다. 그래서 같은 말을 주석에 다시 적으면 백엔드 쪽은 또 속는다(M3).
   - 지금은 프런트 테스트가 보이는 글을 정확히 보고 있어서 둘이 같이 있으면 빈틈이 없다.
   - 주석 자체가 "주석에 같은 말을 적으면 테스트가 주석만 보고 통과한다" 고 경고해 둔 것도 좋다. backend diff 0 규칙 때문에 이번 묶음에서는 더 할 것이 없다.
2. 커서 표시를 지우는 effect 의 두 갈래는 테스트가 없다.
   - `replace: true`(S2): push 로 바뀌면 /stocks 기록 칸이 둘이 된다. 그러면 뒤로가기를 한 번 더 눌러야 앞 화면으로 간다. 그래도 같은 경로라 화면을 다시 만들지 않으니 자판은 뜨지 않는다.
   - purged 를 남기는 갈래(S3): 지금 흐름에서는 같이 오는 일이 없다.
   - 둘 다 생길 수 있는 해가 작다. 다음에 손댈 때 "기록 칸 수(idx)가 그대로" 를 한 줄 보면 S2 도 잡힌다.
3. purged 알림은 지운 뒤 /stocks 를 새로 고치면 다시 나온다(P2: `✓Vanguard S&P 500 ETF을(를) 지웠습니다.`).
   - purged 가 기록에 남아 있어서다. 이번 커밋이 만든 것이 아니라 그 전부터 그랬다.
   - 커서 표시와 같은 "한 번 쓰고 지움" 을 purged 에도 쓸지는 ③ 목록감이다.
4. 개발 모드(StrictMode)에서는 effect 가 두 번 돌아 replace 도 두 번 한다. 같은 주소, 같은 state 라 해는 없고, 빌드한 화면에서는 한 번이다.

## 정리

- 가짜 서버(8796)는 `kill $(cat scratchpad/r6c/server.pid)` 로 껐다. 껐는지 확인했다(`ps` 에 없음, curl `000`).
- 고백: 서버가 뜨기를 기다리던 내 `until curl …8796` 루프 하나를 `pkill -f "until curl -s -o /dev/null http://127.0.0.1:8796"` 로 껐다. 첫 기동이 `--reset` 폴더 문제로 실패해서 루프가 남아 있었다. 서버를 끄는 데는 쓰지 않았고, 이 패턴에 걸리는 다른 프로세스는 없었다.
- 돌연변이 10개는 각각 `git checkout -- <file>` 로 되돌렸다.
- worktree 는 node_modules 심볼릭 링크를 먼저 지운 뒤 `git worktree remove --force` 로 지웠다. 빌드 결과(dist)가 남아 있어서 `--force` 가 필요했다.
- 판정문은 저장소 밖(scratchpad/r6c/6-review-3.md)에 썼다. 저장소에 옮기는 것은 총괄이 한다.
- 4c6cc0b worktree 의 `git status`(지우기 직전):

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
