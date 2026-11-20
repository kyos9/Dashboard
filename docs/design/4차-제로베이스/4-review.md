# 묶음 4 리밸런싱 넣기 — 검토 판정 (bce7275, 앞 db2efc6 · 함께 36864e9)

## 판정: **조건부 합격**

계산 · 저장은 바뀌지 않았고 빠진 기능도 없다. 테스트 · 빌드도 통과한다. 다만 아래 조건 6개를 고쳐야 한다. 2-2 규칙 위반(말줄임 · 숫자 갈라짐 · 가짜 단추), 새 시트의 접근성, 테스트가 비어 있는 두 곳이다.
검토한 커밋은 bce7275 이다. 검토 중에 브랜치에 3794eaa(사용자 확인 보완)가 올라왔지만 그 커밋은 보지 않았다. 아래 조건 가운데 일부(저장 확인, 좁은 PC)는 그 커밋에서 이미 다뤘을 수 있다. 재검토 때 조건마다 다시 돌려 봐야 한다.

## 검사 결과

| 항목 | 결과 | 증거 |
| --- | --- | --- |
| 계산 · 저장 로직 불변 | 통과 | `git diff db2efc6 bce7275 -- frontend/src/lib` 의 변경은 `orderPlan.ts:260,271` 문구 두 줄뿐(ZERO_TARGET_NOTE)이다. buildOrderPlan · saveRow · changesOf · saveAll · 거래 반영(applyTrade)은 손대지 않았다. RebalancePanel 은 그리기만 바뀌었다(정렬 `bySize` 는 보이는 순서만 바꾼다). 3-1 "lib diff 비어 있음"에는 어긋나지만 문구만 바뀌었고 문구변경.md 에 적혀 있으므로 참고로 둔다. |
| 빠진 기능 | 통과 | 거래 입력은 시트 · PC 표에 있고, 새 돈만 나누기 · 현금 줄 · 합계 줄 · 목표 0% 풀이(시트 · PC 표) · 금액 가리기(`amount` · `signedAmount` · `qty` 가 전역으로 가림, 주수는 원래대로 보임) · 환율 경고 · 설정 · 기록도 모두 있다. 줄어든 것은 요약의 평가손익 · 수익률 · 최근 거래일 대비, 줄마다 평가손익, PC 합계 줄의 "목표 금액 합계"이다. 앞의 둘은 12c 와 주인 답에 따른 것이고 "목표 금액 합계"는 말 없이 빠졌다(참고). ② 에서 주인에게 알린다. |
| 테스트 수 | 통과 | `npx vitest run` → **1114 passed (1114)**. RebalancePanel.test 는 57 → 60 이다. |
| 고친 테스트의 뜻 | 통과(참고 1) | 옮겨 간 뜻은 다른 테스트가 지킨다. 엔 100엔 단위는 `HoldingTab.test:75` · `StockManager.test:210`, 보유수량 빼기 안내는 `StockEditModal.test:227`, "평단가 입력 시"는 `Dashboard.portfolio.test:315`, 평단가를 비우면 null 은 `Dashboard.portfolio.test:540` 에 있다. 약해진 것: "환율 효과를 넣은 줄은 원화 손익"(shown_pnl)은 리밸런싱 화면에서 사라졌다. 다른 화면 테스트에 같은 단언이 있는지는 찾지 못했다(참고). |
| 돌연변이 | 조건 | 11개 중 9개를 잡았다(띠 클래스 · Esc · 가두기 · 정렬 · 부호 · PC 읽기 이름 · 줄 읽기 이름 · 고친 줄 표시 · 반영 뒤 시트 닫힘). **살아남은 둘: `Sheet.tsx` 의 `useBackToClose(onClose)` 삭제, `lockBodyScroll()` 무력화** → 60 passed 그대로 → 조건 5. |
| lint · tsc · build | 통과 | oxlint 경고 20, `tsc -b` 오류 없음, `npm run build` 성공(RebalancePanel 청크 48.10 kB). |
| 백엔드 테스트 | 통과(수 정정) | `pytest -q` → **1611 passed, 5 skipped**, 실패 0(수집 1616). 실행자 보고 "1612 통과"는 1 많다. 실패는 없다. |
| 36864e9 일본 이름 | 통과(참고) | 테스트 2개가 통과한다. 돌연변이 둘(`stock.name == old` 조건 빼기, 한글 이름 건너뛰기 빼기)은 모두 잡혔다. 앱이 뜰 때마다 운영 데이터의 이름을 고쳐 쓰는데, 되돌릴 수 없고 3-1 "backend diff 비어 있음" 밖이다. 주인 지시("일본 종목은 한글로")이므로 받아들인다. 새로 담는 일본 종목은 다음 재시작 전까지 영문으로 남는다(참고). |
| CSS 300줄 · 색표 밖 색 | 통과 | `rebalance-orders.css` 226 · `rebalance-sheets.css` 262 · `rebalance-table.css` 78. 새 css · tsx 에서 `#hex` · `rgb(` · `hsl(` grep 결과 0. |
| 띠 색 · 상승 빨강 | 통과 | 다크 초록 모드는 팔기 띠 rgb(244,113,113), 사기 띠 rgb(60,207,113)이다. 라이트 빨강 모드는 팔기 rgb(29,78,216)(파랑), 사기 rgb(185,28,28)(빨강)이다. 부호 주수 글자색도 띠와 같다(`--signal-*` 를 따름). |
| 줄 단추 이름 | 통과 | 예: "TIGER 미국필라델피아반도체나스닥 1,641주 (1,641.27) 팔기 — 자세히", 유지 줄은 "… 유지 — 자세히". PC 주문 칸 `aria-label` 에도 사기/팔기가 들어 있다. |
| 대비 · 터치(폰) | 통과 | audit 대비 0, touch 0. 직접 잰 폰 390 · 360 · 320 에서도 44px 아래 0이다(PC 의 24px 단추들은 기존 규칙대로 폰만 본다). |
| 넘침 · 겹침 | 통과(참고) | 390 · 360 · 320 · 1280 · 900 에서 페이지 가로 넘침 0. 폰 길이 390 은 2,447px이다. PC 표는 1280 에서 다 들어가지만(990/990), **1100 · 900 에서는 표 안 스크롤**(942 > 810 · 760)로 신호 · 거래 열이 오른쪽에 숨는다. 표 안 스크롤은 허용이지만 "신호 열이 잘렸다"를 고친다는 목표는 1100 아래에서 아직 이루지 못했다(참고). |
| 시트 가두기 | 조건 | 브라우저에서 확인한 것: Tab · Shift+Tab 은 시트 안에서만 돈다(거래 칸을 펼쳐도 같다). Esc · 뒤로가기 · 바깥 누르기로 닫히고, 열려 있는 동안 body overflow hidden, 뒤 화면 스크롤은 0→0, 닫으면 연 단추로 포커스가 돌아온다. **다만 주문 시트는 열 때 포커스가 시트로 가지 않는다** → 조건 4. |
| 자동 검사(audit 397 조합) | 조건 | 열지 못함 0. 앞 기준(r3)과 비교: clipped **0 → 7**, fake-button **0 → 18**(모두 rebalance), console 0 → 1(stock-detail "Object is disposed", 이번 변경과 무관해 보임), num-split 22 → 23(날짜 "-11" · 진단 경로, rebalance 0), 외톨이 62 → 23, 360 두 줄 49 → 38. audit 는 시트를 열지 않으므로 시트 안은 직접 쟀다(조건 2). |

## 조건 (보완)

1. **말줄임 금지 위반**(2-2 "말줄임(…)도 금지") — 폰 주문 줄의 긴 이름이 잘린다.
   - 위치: `rebalance-sheets.css` `.order-row-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap }`
   - 재현: 가짜 서버 → /rebalance 폰 390 · 360 · 320 → "TIGER 미국필라델피아반도체나…".
   - audit `clipped` 7건 = rebalance ph390/360 × 테마와 상승 빨강 · text130.
2. **숫자 갈라짐** — 주문 시트 위 큰 숫자에서 부호 "−"가 금액과 다른 줄로 떨어진다.
   - 위치: `.order-sheet-act` 의 `b.mono` · `span.mono` · `small`
   - 재현: 390 · 360 에서 TIGER 줄을 누르면 "−" / "₩141,295,447" 로 두 줄이 된다.
   - 320 에서는 15개 중 13개 시트에서 주수 · 금액 · "주문 −$…"가 두 줄이 된다(Range 의 줄 수로 잼).
3. **가짜 단추** — 요약의 "현금 ₩0" · "기본 밴드 ±5.0%p" 알약이 `span.rb-pill` 이다.
   - 진짜 단추인 "목표 합계" 알약과 생김새가 같고 높이도 44px이다. audit fake-button 18건(9 조건 × 2)이다.
   - 고치는 길: 둘을 단추가 아닌 꼴로 하거나 눌리게 만든다(예: 설정으로 가기).
4. **주문 시트가 열릴 때 포커스가 들어가지 않는다**.
   - 원인: `Sheet.tsx` 가 `initialFocus` 없이 불리면 `useFocusTrap` 이 `ref.current`(tabindex 없는 div)에 `.focus()` 를 부른다. 이 호출은 아무 일도 하지 않는다.
   - 재현: 폰 390 에서 주문 줄에 포커스 → Enter. 열린 뒤 `document.activeElement` 가 여전히 뒤 화면의 줄 단추다. 읽기 프로그램은 대화상자에 들어가지 못한다.
   - 고치는 길: 시트 div 에 `tabIndex={-1}` 을 주거나 첫 칸(닫기)을 `initialFocus` 로 넘긴다. jsdom 테스트에 "열자마자 activeElement 가 시트 안"을 넣는다.
5. **새 시트의 뒤로가기 · 스크롤 잠금 테스트가 없다**(돌연변이 2개 생존).
   - 재현: `Sheet.tsx` 에서 `useBackToClose(onClose)` 줄을 지우거나 `lockBodyScroll()` 을 `() => {}` 로 바꿔도 `npx vitest run src/pages/RebalancePanel.test.tsx` 가 60 passed 이다.
   - 고치는 길: `Sheet` 에 테스트 두 개를 단다(popstate 로 닫힘, 열려 있는 동안 `body.style.overflow === 'hidden'`, 닫으면 원래대로).
6. **목표 · 밴드 시트의 합계가 입력을 따라가지 않는다. 저장하지 않고 닫으면 화면 어디에도 표시가 없다.**
   - 합계: 시트 머리 "합계 90.0% — 100%가 되게 맞추면"은 `plan.targetSum`(저장된 값)이다. 첫 칸에 +10 을 쳐도 "90.0%" 그대로다(390 · 360 · 320 에서 확인). 100% 를 맞추려고 여는 시트인데 맞췄는지 알 수 없다. drafts 로 합계만 다시 세는 것은 그리기 쪽 일이다.
   - 닫힘: 값을 고친 뒤 Esc · 뒤로가기 · 바깥을 누르면 시트가 닫히고, 페이지에 "바뀐 N줄"이 없다(예전에는 표 아래 save-bar 가 늘 보였다). 다시 열면 값은 남아 있다. 그사이 거래를 입력하면 다시 받아 오면서 그 값이 말 없이 사라진다.
   - 고치는 길: 종목 탭 "한 번에 수정"처럼 "닫을까요?"를 묻거나, 페이지에 한 줄 표시를 둔다.

## 참고(조건 아님)

- PC 1100 · 900 에서 표 끝 두 열이 표 안 스크롤로 숨는다(묶음 2에서 넘어온 항목, 여전히 남음).
- PC 합계 줄: 전체 금액이 "비중" 열 아래에 놓이고, 목표 금액 합계가 빠졌다.
- 거래 칸을 펼친 채 Esc 를 누르면 시트째 닫혀 쳐 둔 수량이 사라진다.
- 반영 뒤 시트가 닫히면 그 줄이 다른 묶음으로 옮겨질 수 있다. 그러면 포커스가 돌아갈 단추가 다시 그려져 포커스를 잃는다(유지로 바뀌면 접힌 묶음 안).
- 폰 "새로 넣을 돈" 단추의 `aria-controls="new-money-block"` 는 접혀 있을 때 가리키는 요소가 없다.
- `TargetSheet` 의 `.target-actions` 에 `role="status"` 가 단추를 감싸고 있다(바뀔 때마다 단추 글이 읽힌다).

## 재현 환경

- 작업 트리: 저장소 밖 worktree(bce7275)를 썼고 끝난 뒤 지웠다. node_modules 는 저장소 것을 링크했다.
- 순서: `frontend` 에서 `npm run build` → `backend` 에서 `python -m devtools.fake_server --port 8794 --data-dir <scratchpad>/r4/data --reset`(nohup, pid 파일로 띄우고 끔) → owner@example.com 로그인.
- audit: scratchpad 에서 `node <wt>/docs/design/audit.mjs --base http://127.0.0.1:8794 --out <scratchpad>/r4/audit`. 결과는 `<scratchpad>/r4/audit/summary.md`.
- 직접 잰 스크립트: `<scratchpad>/r4/js/p1.mjs`(폭 · 색 · 터치 · 잘림), `p2.mjs`(시트 Tab · Esc · 뒤로 · 스크롤 · 포커스), `p3.mjs`(시트 숫자 갈라짐 · 합계), `p4.mjs`(PC 표 열 위치). 스크린샷은 `<scratchpad>/r4/shots/`.
- `<scratchpad>` = /tmp/claude-0/-home-user-Dashboard/c9553d42-71a5-5379-90e1-1c42ba786c3a/scratchpad

## git status

검토 worktree 를 지우기 전 `git status --short`: (빈 출력)
저장소 /home/user/Dashboard `git status --short`: (빈 출력). HEAD 는 검토 중 다른 쪽이 커밋한 3794eaa 이다.
