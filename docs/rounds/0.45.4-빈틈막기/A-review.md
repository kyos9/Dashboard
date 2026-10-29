# 0.45.4 A 검토 — 방침 맞추기 + 지인 AI 종목 분석 중립 틀

**판정: 조건부 합격**

- 본 커밋: `1ca56d9`(시작 `500a540`). `8da60e0` 은 `backend/tests/test_my_signals.py` 만 봤다.
- 돌린 곳: 따로 만든 worktree `scratchpad/r049/wt-revA`(1ca56d9, detached). 가짜 서버는 포트 8199, 데이터 `scratchpad/r049/revA/data`. 다 쓴 뒤 PID로 껐다.
- 핵심인 중립 틀·주인 틀 바이트·틀 고르기·화면 글은 모두 맞다. 다만 고쳐야 할 것이 넷 있다.
  - 화면 시험 1개가 빨갛다.
  - 허용 목록 뮤테이션 1개가 살아남는다.
  - 방침 3절·4절에 실제와 다른 곳이 2군데 있다.
- 그리고 B·C 를 앞서 적은 방침·용어집 줄이 있다. 라운드가 끝날 때 참이어야 한다.

## 조건부 목록 (합치기 전에 닫는다)

1. **화면 시험 빨강(회귀)**
   - `frontend/src/pages/Policy.test.tsx:60` 이 아직 `'시행일 2026-10-20'` 을 기대한다. `policy.ts:11` 은 `2026-10-24` 로 바뀌었다.
   - 1ca56d9 에서 `npx vitest run` 결과는 **1 failed | 1029 passed (1030)** 이다. 다음 커밋 `eeff03f` 에도 같은 줄이 남아 있다.
2. **허용 목록이 한 단계 깊이까지만 막는다(뮤테이션 생존)**
   - 시험(`test_policy_page.py:117-160`)이 보는 것은 맨 위 열쇠, `rows[]`, `cash` 의 열쇠, 종목 분석의 `portfolio[]` 까지다.
   - `review`·`top`·`thresholds` 안은 보지 않는다. `review` 에 `"cash_value": 1` 을 더한 뮤테이션(M9)이 **38 passed 로 살아남았다**.
   - 실제로 새어 나가려면 `render_portfolio` 도 같이 고쳐야 한다. 그래도 계획이 말한 "정확한 집합"과 §3 "살아남은 것 0"에 못 미친다.
   - 고칠 것: `review` 열쇠(`period,next_date,due`), `top` 열쇠(1·3·5 안), `thresholds` 열쇠를 고정한다.
3. **방침 3절 "AI 정리"가 내가 붙인 분류를 빠뜨렸다**
   - `Policy.tsx:84-86` 은 "그 종목들의 이름·티커와 공용 데이터…**만** 보냅니다"라고 적는다.
   - 실제로는 `ai_analysis.build_context`·`watchlist_context` 가 사용자 분류(`category`)를 싣고(`ai_analysis.py:318`, `:522`), 글로 보낸다(`:426` "사용자가 붙인 분류", `:544`).
   - 진단·종목 분석 칸에는 "내가 붙인 분류"가 적혀 있다. 정리 칸에만 빠졌다.
4. **방침 4절 기기 저장 목록에 "금액 가리기"가 없다**
   - `prefs.ts:24` 의 `dashboard.hide-amounts` 는 localStorage 에 저장된다.
   - 그런데 `Policy.tsx:115-117` 목록에는 테마·상승 색·정렬·보기·손익 통화·새 돈만 나누기·설치 안내만 있다.
   - 계획 "4절에 기기 저장 목록을 더한다"가 덜 됐다.
5. **(라운드 안 조건) B·C 를 앞서 적은 줄**
   - `Policy.tsx:112` "모든 기기에서 나가기를 누르면…"이 있다. 용어집에도 "모든 기기에서 나가기"·"목표 0%라 전부 파는 계산입니다" 두 줄이 있다.
   - 1ca56d9 에는 이 기능들이 없다(`grep -rn "logout-all\|logout_all" backend/app frontend/src` → Policy.tsx 한 줄뿐).
   - B·C 가 이 문구 그대로 들어오면 닫힌다. 들어오지 않는 항목이 있으면 그 줄을 지운다. B·C 검토자에게 넘긴다.

## §3 표

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 완료 조건 | 통과(조건 2 제외) | 아래 "완료 조건 하나씩" |
| 계획 때 걱정 | 통과 | 아래 "계획 걱정 대조". 막음 0 |
| 회귀 | **실패 → 조건 1** | pytest `1497 passed, 3 skipped`(시작 1492, +5 = 새 시험 5개). vitest **1 failed / 1029 passed / 1030**(시작 1030 통과). 응답 사진은 10개 중 8개가 같다. 남은 둘(`/api/rebalance/current` 주인·친구)은 날짜 칸 `value_record.since` 2026-10-20→2026-10-21 하나만 다르다(날짜라 빼고 본다). 한 번은 vitest 가 2 failed 였다. 다시 돌리면 1개라 하나는 흔들리는 시험으로 본다(이름은 못 잡음, 참고) |
| 격리 | 통과 | 새 엔드포인트가 없다. 가짜 서버(1ca56d9 빌드)에서 `/api/ai/research/{t}/context` 결과: 주인 200·주인 틀, 친구 200·중립 틀, new(종목 없음) 404, 대기 401, 손님 401. 닫았을 때의 403 은 기존 `test_api_is_for_users_when_open…` 이 본다(친구 = 중립 틀 단언이 더해짐, `test_ai_owner.py:341-343`) |
| 마이그레이션 | 해당 없음 | 리비전·칸 바뀜 없음 |
| 호환 | 통과 | `app.openapi()` 가 기준 `openapi.json` 과 JSON 으로 같다(`openapi identical: True`). 응답 필드 바뀜 없음. 옛 화면은 옛 소개 글을 보이지만 서버 지시문은 바로 중립이다(계획대로) |
| 입력 한도 | 해당 없음 | 새 입력 없음 |
| 뮤테이션 | **실패 1 → 조건 2** | 아래 표. 12개 중 11개가 잡히고 1개(M9)가 산다 |
| 비밀 | 해당 없음 | 키 길은 바뀌지 않았다 |
| 규제 | 통과 | 아래 표 참고. 좁히는 쪽이고 주인 결정 "지인엔 중립 틀"과 맞다 |
| 데이터 경계 | 해당 없음 | 새 표 없음 |
| 외부 호출 | 통과 | `research_prompt` 는 `db.get(User)` 하나만 더한다(`ai_portfolio.py:468-471`). 바깥 호출은 늘지 않는다 |
| 화면 | 통과 | 아래 "화면" |
| 말 | 통과(참고 2) | 용어집 `glossary.md:40` "이미 담은 종목 중 같은 업종"이 6절 제목·빠른 요청과 같다. 참고는 아래 |
| 성능 | 통과 | 첫 화면 JS gzip 113.91 kB(시작 113.92). lint 경고 22(시작 22). `npx tsc -b` 통과 |
| 가짜 서버 | 해당 없음 | 새 상태 없음. 친구로 중립 틀이 바로 보인다 |
| 문서 | 조건 3·4·5 | README:220·ROADMAP:2232·2336·2716-2718·app_settings.py:7 은 고쳐졌다. 방침은 위 조건 |

## 완료 조건 하나씩

- **허용 목록 방침 시험이 있다** — 있다. `test_policy_page.py:117-160`(`test_ai_contexts_send_only_what_the_policy_lists`·`test_policy_says_what_each_ai_feature_sends`). 깊이는 조건 2 를 본다.
- **금액 열쇠 더하기 뮤테이션이 잡힌다** — 맨 위·줄 단위에서는 잡힌다(M1·M2·M4). 안쪽 dict 에서는 산다(M9).
- **방침에서 "종목 분석"을 지우는 뮤테이션이 잡힌다** — 잡힌다(M3).
- **사용자 system 지시문 grep 0** — 통과. 패턴 `편입|사이징|알파|alpha|core|hedge|버킷|적합|동일 ?비중|익스포저|초과수익|하방`(re.I)을 모듈의 큰 지시문 전부에 걸었다.
  - 0개: `USER_RESEARCH_PROMPT`, `PORTFOLIO_PROMPT`, `ai_analysis.SYSTEM_PROMPT`·`WATCHLIST_PROMPT`·`MACRO_PROMPT`·`SIGNAL_RULES`.
  - 걸리는 것: `RESEARCH_PROMPT`(주인 전용) 뿐이다.
  - 가짜 서버로 친구가 받은 `system` 도 `[]` 이다.
- **주인 지시문이 0.45.3 과 바이트까지 같다** — 통과. `git archive 500a540`(APP_VERSION 0.45.3)과 1ca56d9 의 sha256 이 같다.
  - `RESEARCH_PROMPT`: `cab4b493…b701`
  - `PORTFOLIO_PROMPT`: `45d7ac36…067d`
  - 정리 셋을 이은 것: `d5b32931…63c3`
- **사용자 6절 제목** — 통과. `## 6. 이미 담은 종목 중 같은 업종`(`ai_portfolio.py:177`). 가짜 서버 친구 응답에도 `True`. "이 종목 자신은 빼고"가 있다(`:178`).
- **`/api/ai/research/{t}/context` 주인=주인 틀, 친구=중립 틀** — 통과. 가짜 서버 결과: owner `VOO (200, 'OWNER')`, friend `SCHD (200, 'USER')`.
- **화면 소개 글에 편입·알파·익스포저 0(사용자)** — 통과. 빌드한 화면, 친구, 1400·390·360 × 밝게·어둡게 = 6벌 모두 `{"neutral":true,"ownerCopy":false,"bad":[]}`. 주인은 6벌 모두 주인 글(그대로).
- **방침 3절과 실제 문맥을 직접 대조**
  - 진단(`portfolio_context`, `ai_portfolio.py:236-291`과 `render_portfolio`): 비중·목표·차이·밴드·수익률(가격·환율 몫)·현금 비중·목표 합계·리뷰·시그널 기준·분류가 모두 방침에 있다. 상위 비중·실질 종목 수·시장/통화별은 비중에서 나온 값이다. 맞다.
  - 종목 분석(`research_context`, `:396-415`): 종목 공용·재무, 내 종목 `ticker,name,market,category,actual,target,held` 이고 수익률은 없다. 방침과 맞다(`held` 보유 여부는 방침에 말로 없음 — 참고).
  - 정리(`ai_analysis.build_context`·`watchlist_context`): **분류가 빠졌다 → 조건 3**.
  - "목표비중은 보내지 않는다"는 지워졌다(시험이 확인, `test_policy_page.py:178`).
- **비밀번호·열린 모드(1번=관리자)에서 화면과 서버가 같은 틀** — 통과.
  - 서버: 가짜 서버 DB 를 복사해 `GOOGLE_CLIENT_ID` 없이 `DASHBOARD_PASSWORD=…`(password 모드, 로그인 200)와 비움(open 모드)으로 TestClient 를 돌렸다. 둘 다 `frame: OWNER`.
  - 화면: `AuthGate.tsx:254` `isAdmin = mode === 'google' ? user?.is_owner === true : true` 이므로 주인 글이 나온다.
  - 서버가 고르는 기준(`user.is_owner`)은 기존 `require_owner`(`users.py:85`)·`stocks._is_owner` 와 같다. 1번은 늘 `is_owner=True` 다(`users.py:143`, 0005 마이그레이션).

## 뮤테이션 (worktree 에서, 돌릴 때마다 `git checkout -- .`)

| # | 바꾼 것 | 결과 |
| --- | --- | --- |
| M1 | 진단 줄에 `"value"` 더하기 | 잡힘(2 failed) |
| M2 | 종목 분석 portfolio 줄에 `return_pct` 더하기 | 잡힘 |
| M3 | 방침 `<b>AI 종목 분석</b>` → `<b>AI 분석</b>` | 잡힘 |
| M4 | `cash` 에 `"amount"` 더하기 | 잡힘 |
| M5 | `research_prompt` 가 늘 주인 틀 | 잡힘(2) |
| M6 | 늘 중립 틀 | 잡힘(3) |
| M7 | 주인 틀 글자 하나(1200→1300) | 잡힘(해시) |
| M8 | 중립 6절 제목에 "편입" | 잡힘 |
| **M9** | `review` 에 `"cash_value": 1` | **삶(38 passed) → 조건 2** |
| M10 | 방침에서 "수익률은 보내지 않습니다." 지우기 | 잡힘 |
| M11 | 정리 `build_context` 에 `quantity` | 잡힘(기존 시험) |
| FM1 | 화면 소개 글이 늘 사용자 글 | 잡힘(ChartModal) |
| FM2 | 늘 주인 글 | 잡힘(ChartModal:490) |

## 규제

- 더한 줄(backend/app·frontend/src, 시험 제외)에서 `추천|사세요|팔라|저평가|예측`을 찾았다. 걸린 것은 모두 **금지 문장**이다.
  - `ai_portfolio.py` 7번 "저평가…로 판단하지 않습니다", 8번 "예측하지 않고"
  - `AiPanel.tsx` help "사라·팔라…내지 않습니다"
- 중립 틀은 계획대로 만들어졌다.
  - 역할 "자료 정리 도우미"
  - 평가 금지·권유 금지·목표가/상승 여력/하락 폭/적정 배수 금지
  - 5절은 배수 없는 "지켜볼 조건"
  - 3절 "강점으로 꼽히는 점", 4절 "위험 요인"(폭 없음)

## 계획 걱정 대조 (A 에 해당하는 "반영")

| 걱정 | 실제 |
| --- | --- |
| 화면 글·빠른 요청을 둘로, ChartModal:490 친구 기대값 | 됨. `AiPanel.tsx:65-75,158-159`(`USER_RESEARCH_COPY` :69, 고르기 :159), `ChartModal.test.tsx:490-493` |
| 중립 틀에 평가·권유·목표가 금지, 배수 없는 시나리오, "자료 정리 도우미" | 됨. `ai_portfolio.py:137,157-160,176`. 시험 `test_ai_owner.py:231-249` |
| grep 을 system 에만, 대소문자 무시, `초과수익\|하방` 더함 | 됨. `test_ai_owner.py:224` |
| 방침 3절을 정리·진단·종목 분석 세 갈래로, "목표비중은 보내지 않는다" 삭제 | 됨. 다만 정리 칸에 분류 빠짐 → 조건 3 |
| 허용 목록(줄 단위 포함), 실패 글이 방침을 가리킴 | 됨(hint 문구 `test_policy_page.py:150`). 깊이 → 조건 2 |
| 6절 제목 "이미 담은 종목 중 같은 업종", "이 종목 자신은 빼고" | 됨 |
| `research_job` 이 User 를 본다, 주인 틀 시험은 그대로 | 됨. `test_ai_owner.py:206-215` 바뀌지 않음 |
| README·app_settings·용어집·ROADMAP 3절·9-8 | 됨 |
| 4절 기기 저장 목록 | 덜 됨 → 조건 4 |

## 화면 (빌드한 화면 `npm run build`, 가짜 서버 8199, Playwright)

- 친구·주인 × 1400·390·360 × 밝게·어둡게, 12벌. 종목 팝업의 AI 분석 탭을 열었다.
  - 가로 넘침 0
  - 페이지 오류 0
  - Tab 으로 빠른 요청 단추에 닿는다(`tabReachesExample:true`)
- 스크린샷: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r049/revA/shots5/f-360-dark.png` 외 `shots2/`·`shots5/`.

## 참고 (막지 않음)

- `README.md:220` 이 아직 "**관리자만** 쓰는 AI 두 가지"라고 적는다. 9-15 에서 사용자에게도 열렸으니 0.45.4 이전부터 낡은 말이다. 이번 줄 바로 앞이라 같이 고치면 좋다.
- 분류 제안 `CATEGORY_SUGGESTIONS = ['지수','알파','안전자산']`(`stockEdit.ts:46`, `StockManager.tsx:33,351`)은 사용자에게도 보인다. 사용자 자신이 붙이는 이름이라 계획이 허용한 범위다. 다만 지인에게 "알파"를 권하는 꼴이기는 하다.
- 방침의 종목 분석 칸에 "보유 여부"(`held`)가 말로 없다. 비중 0과 거의 같은 뜻이다.
- 시험 고침 `8da60e0`(`test_my_signals.py:153-154,309`): 오늘(2026-10-24 토)에 통과한다. 평일에는 `bdate_range(end=today)` 의 마지막 날이 오늘이라 예전과 같다. 앱 코드 바뀜 없음. 통과.

## 끝날 때 worktree

```
$ git -C …/scratchpad/r049/wt-revA status
Not currently on any branch.
nothing to commit, working tree clean
```
(frontend 의 `node_modules` 는 본 트리 것을 가리키는 심볼릭 링크이고, `dist` 와 함께 `.gitignore` 가 무시한다.)
