# 디자인 4차 묶음 6 손님 · 처음 온 사람 · 빈 화면 — 첫 검토 (95f5ff0)

## 판정: 조건부 합격 (조건 1은 막음 — 고치기 전에는 합격 아님)

검토한 범위는 `be919b2..95f5ff0`이다(617f879 목업 15, 95f5ff0 넣기). 따로 만든 worktree 둘에서 직접 띄우고 다시 쟀다. 하나는 `--detach 95f5ff0`, 다른 하나는 기준선용 `--detach be919b2`이다.
- 화면은 먼저 `npm run build` 했다.
- 가짜 서버는 포트 8793(지금)과 8794(기준선)에 띄웠다. `--data-dir` 는 저장소 밖 scratchpad/r6/data · bdata 이다.
- 주 작업 트리, 8765, backend/.devdata 는 건드리지 않았다.

### 조건 (넷)

1. **[막음] 백엔드 테스트가 하나 깨졌다. CI 도 빨갛다.**
   - 측정(95f5ff0 worktree): `cd backend && python -m pytest -q` 의 결과는 `1 failed, 1610 passed, 5 skipped` 이다.
     ```
     FAILED tests/test_policy_page.py::test_first_screen_states_the_same_cap
     assert '종목은 30개까지' in _flat(DASHBOARD)
     ```
   - 같은 파일을 be919b2 에서 돌리면 `19 passed` 다. 그러니 이번 커밋이 깨뜨린 것이다.
   - 까닭: 처음 온 사람 홈의 아래 줄이 "종목은 30개까지 담을 수 있습니다. …"에서 "30개까지 담을 수 있습니다."로 바뀌었다(`Dashboard.tsx:768`).
     - 이 백엔드 테스트(`backend/tests/test_policy_page.py:65`)는 서버 한도 `MAX_STOCKS_PER_USER` 와 첫 화면 글이 같은지 `Dashboard.tsx` 원문으로 본다.
   - CI 도 같다. `gh run view 44553334013 --log-failed` 는 이후 커밋 86e7503 의 결과다. 거기서 백엔드(SQLite · Postgres) 둘 다 이 테스트 하나로 실패했다(`1 failed, 1614 passed`).
   - 실행자 보고(테스트 1171 · lint · tsc · build)는 프런트만 말했다. PROMPT 2-2 의 9번 `cd backend && pytest -q` 는 보고에 없다.
   - 고칠 것: 프런트 글을 "종목은 30개까지 담을 수 있습니다."로 되돌린다. 목업 ② 의 "30개까지 담을 수 있습니다."에 주어만 붙이는 것이다.
     - backend/ 는 diff 0 이어야 하니 테스트 쪽을 고치면 안 된다.
     - 문구변경 표의 "처음 온 사람 아래 줄" 칸도 같이 고친다.
2. **[고쳐야 함] 금리차 "%p" 를 금리차에만 붙이는지 지키는 테스트가 없다.**
   - 돌연변이 M22: `series.code === 'TERM_SPREAD' && value.endsWith('%')` 를 `value.endsWith('%')` 로 바꿨다. 그러면 모든 % 지표에 p 가 붙는데 `GuestMacroList.test` 와 `GuestHome.test` 15개가 다 통과한다.
   - 손님 줄은 관리자가 고른 기본값을 쓴다. 미 10년물 · CPI 같은 % 지표가 들어오면 "4.37%p"가 되는 것을 아무도 못 잡는다.
   - 고칠 것: "풀이 줄" 테스트(CPI 2.65)에 `getByText('2.65%')` 하나를 더한다. 아니면 금리차 테스트에 % 지표 하나를 같이 넣는다.
3. **[고쳐야 함] "매크로 지표 모두 보기" 링크 색이 토큰이 아니라 브라우저 기본값이다(목업 ③ 나와 다름).**
   - 실측(390, `getComputedStyle(a).color`): 라이트는 `rgb(0, 0, 238)`, 다크는 `rgb(158, 158, 255)`. 목업의 `a.lk` 는 `var(--accent)` 다.
   - 이 링크는 `/macro` 로 간다. 한 번 다녀오면 `:visited` 기본 보라색으로 바뀐다.
   - 앱에 `a` 색 전역 규칙이 없다. 동의 줄 링크도 전부터 같은 처지다. 이번 묶음이 ③ 의 주인공 자리에 기본색 링크를 하나 더 둔 것이다.
   - 이후 커밋 86e7503 제목에 "링크 색"이 있다. 다음 검토에서 고쳐졌는지 본다.
4. **[보완 — 테스트 · 문서]**
   - "신호 없는 날" 글(`매수, 매도, 비중조절 모두 조용합니다.`)을 지키는 테스트가 없다.
     - 돌연변이 M13: 옛 "매수 · 매도 · 비중조절"로 되돌려도 Dashboard.test 59개가 다 통과한다. 표에도 "고친 테스트 —"로 적혀 있다.
     - v6 "바꾼 곳마다 테스트"에 맞추려면 하나를 더한다.
   - 목업 ③ 나와 다른 곳의 까닭이 표 · status 에 없다(3-2 "차이마다 이유").
     - "매크로 지표 **12개** 모두 보기" → 앱은 "매크로 지표 모두 보기"다. 짐작하는 까닭은 `pinned` 응답에 전체 개수가 없어서이고, 그렇다면 API 를 바꾸지 않으려 뺀 것이다. 그 까닭을 적는다.
     - 목업의 줄(VIX · 공포·탐욕 · 미 10년물)과 앱의 줄(VIX · 장단기 금리차 · 공포·탐욕)이 다르다. 앱 줄은 서버 기본값이다.
     - 목업에 없는 "공포 구간 25~44" 꼬리표가 있다. 매크로 탭과 같은 줄이라서다.
     - 목업은 줄과 로그인 사이가 곧은 선인데, 앱은 양 끝이 둥글게 휜 선이다(아래 참고 1).

## 항목별

| # | 항목 | 판정 | 증거 |
|---|---|---|---|
| 0 | 계획 검토 걱정 · 앞 조건 | 해당 없음 | 묶음 6 첫 검토라 앞 판정의 조건이 없다. plan-*.md 에 묶음 6 고유의 "막음"은 없다 |
| 1 | backend · api · lib · types · AppState diff 0 | 통과 | `git diff --stat be919b2 95f5ff0 -- backend frontend/src/api frontend/src/lib frontend/src/types.ts frontend/src/AppState.tsx` → 빈 출력 |
| 1 | 그 밖 .tsx 한 줄씩 | 통과(참고 있음) | 아래 셋은 상태 · 경로 · 권한 변경이 아니다. 나머지는 글 · 마크업 · 표시 부품이다. `useCachedLoad('strip:macro-pinned', …)` 은 같은 키 · 같은 실패 처리로 옮겨졌다 |
| | | | · `LoginPrompt` 에 `lead` · `macroHint` prop 이 생겼다. 표시용이고 기본값은 옛 모양 그대로다 |
| | | | · `StockManager` 의 `firstVisit={false}` 는 도움말 첫 펼침의 기본값이다. 주인 답 ④ "도움말 접힌 채"에 따른 것이다 |
| | | | · `MacroPanel` 의 `isAdmin ?` 는 같은 파일이 이미 쓰는 값으로 글만 가른다 |
| 1 | aria-label · role 지움 | 통과 | `MacroStrip` 의 `aria-label="매크로 지표 요약"` 이 없어지고, 대신 `section aria-label="오늘 매크로"` · `ul aria-labelledby` 가 생겼다. 줄 링크 이름은 "VIX, 변동성 지수 · 시장의 공포, 21.0 −0.0 — 매크로 탭에서 보기"처럼 더 길어졌다. 이것으로 찾던 테스트(`name: /VIX/`)는 더 좁게 고쳐졌다 |
| 2 | 프런트 테스트 | 통과 | `npx vitest run` → `Test Files 69 passed (69)`, `Tests 1171 passed (1171)`. 새 it 9개(GuestMacroList 2 · GuestHome 3 · Dashboard 1 · MacroPanel 1 · Policy 1 · StockManager 1)로 1162 + 9 와 맞다. 지운 it 은 없다(제목 두 개만 바뀜) |
| 2 | **백엔드 테스트** | **실패(조건 1)** | `pytest -q` → `1 failed, 1610 passed, 5 skipped`. CI 도 실패 |
| 2 | 린트 | 통과 | `npm run lint` 의 `warning` 줄 20 |
| 2 | tsc · build | 통과 | `npx tsc -b` 출력 없음, exit 0. `npm run build` → `✓ built in 764ms` |
| 2 | 고친 테스트 ↔ 문구변경 표 | 통과 | 바뀐 6개(처음 온 사람 둘 · 빈 화면 단추 셋 · 없는 티커 · 금리차)가 표 항목과 1:1 이다. "신호 없는 날"은 테스트가 없다(조건 4) |
| 3 | 색은 tokens.css 만 | 통과 | `styles/`(tokens.css 제외) · `.tsx` 에서 `#hex` · `rgb(` · `hsl(` 0. 새싹 SVG 의 `#23b169` · `#68c76f` 는 토스페이스 원본 파일 안의 색이다(원본 그대로라는 주인 규칙) |
| 3 | CSS 300줄 이하 | 통과 | flat.css 246 · guest-macro.css 57(새 파일) · rebalance.css 234 · callout.css 91 · stock-name.css 59 |
| 3 | 지운 CSS 가 다른 곳에서 쓰이지 않나 | 통과 | `grep -rnE "macro-chip\|macro-strip\|macro-home\|guest-features\|MacroStrip"` 의 src 결과는 `GuestHome.test.tsx:58`(없음을 확인하는 줄) 하나다 |
| | | | · `.first-steps` 는 Dashboard.tsx · test 에서만 쓴다. 새 규칙은 flat.css 에 있다 |
| | | | · 같이 지워진 `.callout .pin-btn`(금리차 띠의 ☆)은, 띠에서 ☆ 가 묶음 5 에 빠졌다(MacroPanel.tsx:49-66 에 pin-btn 없음) |
| | | | · `.macro-chip::after` 도 대상이 없다 |
| 4 | ② 처음 온 사람 홈 ↔ 목업 | 통과 | new@ 390 다크: 새싹 64px · "종목을 담으면 시작합니다" · 한 줄 · 번호 동그라미 1~3 + 이름 / 풀이 · 꽉 찬 "종목 담으러 가기" · "30개까지 담을 수 있습니다." 목업 col 나와 배치 · 색 · 위계가 같다. 제목이 `--fs-title` 로 목업(`--fs-strong`)보다 한 단계 크다(참고) |
| 4 | ③ 손님 첫 화면 ↔ 목업 | 통과(차이는 조건 3 · 4) | "오늘 매크로 · 11/19 기준" → 줄 셋(값 · 변화 · ›) → "매크로 지표 모두 보기" → 선 → 제목 · 한 줄 · 로그인 단추 · "계정마다…" · 동의 줄. 기능 소개 셋과 "로그인 없이도 매크로"는 없다 |
| 4 | ① 다른 빈 화면은 점선 상자 그대로 | 통과 | 리밸런싱 0개 · 없는 티커 · AI 없는 주소 · 종목 0개 모두 `.empty-state` 그대로이고 그림 0 |
| 4 | ④ 글 9곳 ↔ 화면 | 통과 | 실측 글이 표와 같다: "종목 담으러 가기"(리밸런싱 0개), "담은 종목에 없는 종목입니다 / … 차트, 신호, 재무를 …"(/stocks/NOPE), "없는 화면입니다 / 주소가 바뀌었거나 잘못 들어왔습니다. / 첫 화면으로"(/ai/zzz), "위 찾기 칸에 이름이나 코드를 넣어 담습니다." + 도움말 접힘(new@ /stocks), 승인 대기 한 문장 + 문의 줄, 지인 · 손님 매크로 빈 화면 "아직 지표를 받지 못했습니다. 잠시 뒤 다시 열어 주세요."(관리자는 docker 명령 그대로) |
| 5 | 폰 320 / 390 · PC 1280 × 다크 · 라이트 | 통과 | 화면 8개(손님 홈 · 승인 대기 · new 홈 · new 종목 · 손님 리밸런싱 · 없는 티커 · AI 없는 주소 · new 리밸런싱) × 6 조건에서 페이지 넘침 0, 콘솔 오류 0. 320 에서도 단계 풀이가 두 줄로 고르게 접히고 잘린 글이 없다 |
| 5 | 터치 44px | 통과 | 폰에서 44 미만은 문장 속 동의 링크(149×15, 예외)뿐이다. `a.macro-row-open` 은 min-height 60, `.guest-macro-all` 은 44, "종목 담으러 가기"는 48 |
| 5 | 키보드 · 읽기 이름 | 통과(참고 있음) | 손님 390 Tab 순서: 로그인 → 탭 다섯 → 줄 셋 → 모두 보기 → 구글 로그인 → 동의 → 바닥 링크. new@ 1280: … → "종목 담으러 가기" → Enter 로 /stocks. 새싹 `alt=""`(꾸밈). 제목은 H1 "자산관리" → H3 이다(전부터 H2 없음, 참고 2). audit focus-ring 0 |
| 5 | 승인 대기가 손님 첫 화면을 볼 때 | 통과 | pending@ 390: 매크로 줄 셋 + 모두 보기 → 선 → "가입 신청을 받았습니다" 한 문장 + 문의 → "승인됐는지 확인". 로그인 단추 0. 매크로 실패(500) 때는 안내만 나오고 선(border-top 0px)이 없다 |
| 5 | 매크로가 비었거나 실패할 때 | 통과 | `/api/macro/pinned` 를 가로챘다. 500 · 빈 응답: `.guest-macro` 없음, 선 없음, 화면 오류 띠 없음(콘솔에는 브라우저 자원 500 한 줄뿐). 배지만: 배지 + 선 + 안내. `as_of` 없음: "기준" 글이 빠진다. 값 null: "—" |
| 5 | 금리차 %p | 통과(테스트 빈틈은 조건 2) | 손님 줄 "0.36%p +0.08%p", 링크 이름도 %p. 음수 가로채기: "-0.12%p −0.20%p"(값은 ASCII `-`, 변화는 `−` — 전부터 `lib/macro`. 참고 3). 매크로 탭에는 금리차 줄이 없고 띠가 "+0.36%p"라 단위가 같다 |
| 6 | 새 테스트가 돌연변이를 잡나 | 20/22 | 잡음: %p 끄기(M1, M21), 기준일(M2), 쉼표 풀이(M3), 모두 보기 주소(M4), 목록 지우기 · 순서 바꾸기(M5 · M5b), macroHint(M6 · M7), alt(M8), 관리자만 명령(M9), 도움말 접힘(M10), AI 단추(M11), 대기 한 문장(M12), 면책 줄(M14), 점선 상자(M15), 구간 글(M16), lead(M17), 종목 0개 글(M18), 없는 티커(M19), 링크 이름(M20). 살아남음: M13(조건 4), M22(조건 2). 돌연변이마다 `git checkout -- <file>` 로 되돌렸다 |
| 7 | audit | 통과(회귀 0) | 397 조합 전체(95f5ff0): 열지 못한 것 0. page-overflow · clipped · folded3 · touch · contrast · console · fake-button · text-overlap · focus-ring 모두 0. orphan 26 · num-split 19 · folded2-360 47 |
| | | | · 이번 묶음 화면 9개(guest-home · guest-rebalance · guest-macro · pending · new-dashboard · new-stocks · friend-dashboard · guest-settings · macro)를 be919b2 에서도 같은 방법으로 쟀다. 두 결과가 줄마다 같다(folded2-360 12 = 12, 나머지 0) |
| | | | · orphan 26 은 모두 손대지 않은 화면에서 나왔다(dash-signal 류 · menu-users · modal-chart · rebalance 설정). menu-diagnostics 1 은 내 `--data-dir` 경로가 길어서 생긴 것이다 |
| 8 | 토스페이스 라이선스 | 통과 | `cmp docs/design/mockups/4차/tossface/u1F331.svg frontend/src/assets/tossface/u1F331.svg` → 같다. 설정의 "토스페이스 — © Viva Republica, Inc. · 라이선스 (전문)" 줄(SettingsPage.tsx:254)과 `public/licenses/tossface.txt` 가 이미 있다. 빌드는 이 SVG 를 `data:` 로 넣어서 sw.js 에 더할 파일이 없다. 바깥 원본과의 대조는 오프라인이라 못 했다(status 기록 믿음) |
| 8 | 목업 README | 통과 | `docs/design/mockups/README.md` 에 묶음 6 줄이 있다 |

## 참고 (조건 아님)

1. 줄 목록과 로그인 사이 선: `.guest-macro + .login-prompt { border-top }` 이 `border-radius: 12px` 인 상자에 걸린다. 그래서 선 양 끝이 위로 휜 호로 보인다(390 · 1280 스크린샷). 목업은 곧은 선이다. 86e7503 제목에 "선"이 있으니 다음 검토에서 본다.
2. 손님 · 처음 온 사람 화면은 H1 다음이 바로 H3 이다. 전부터 그랬다.
3. 금리차가 음수일 때 값은 ASCII `-`, 변화는 `−` 다. `lib/macro` 의 `macroValue` 가 전부터 그렇다.
4. `.first-steps-list` · `.macro-list` 는 `list-style: none` 이다. 이러면 iOS 사파리 VoiceOver 가 목록으로 읽지 않는다. CSS 주석의 "읽기 프로그램은 목록 번호를 따로 읽는다"는 사파리에서는 맞지 않을 수 있다. `role="list"` 하나로 풀린다. 주인 기기가 아이폰이라 끝 보고의 "직접 확인할 것"에 넣기를 권한다.
5. `section aria-label="오늘 매크로"` 와 `ul aria-labelledby` 가 같은 이름이라 읽기 프로그램이 "오늘 매크로"를 두 번 읽는다(구역 · 목록).
6. `PageIntro.tsx` 머리 주석의 "처음 온 사람에게는 펼쳐서 보여준다"는 이제 종목 탭에는 맞지 않는다(재무 · 리밸런싱은 그대로 쓴다).
7. PC 1280 에서 손님 · 대기 안내의 단추는 712×33 이다. PC 는 44px 규칙 밖이고 전부터 같은 꼴이다.

## 정리

- 서버 둘은 `kill $(cat scratchpad/r6/server.pid) $(cat scratchpad/r6/bserver.pid)` 로 껐다.
- 돌연변이 22개는 각각 `git checkout -- <file>` 로 되돌렸다.
- 판정문은 저장소 밖(scratchpad/r6/6-review.md)에 썼다. 저장소에 옮겨 넣는 것은 총괄이 한다.
- 95f5ff0 worktree 의 `git status`(지우기 직전):

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
