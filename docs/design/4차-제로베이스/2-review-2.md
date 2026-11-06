# 디자인 4차 묶음 2 재검토 판정 — daed60c (지난 검토 204fe42)

# 조건부 합격

지난 조건 6개는 모두 풀렸다(아래 1장). 그 뒤에 들어온 사용자 확인 반영, 주인 답, 시그널 목록(목업 10 가)도 거의 다 맞게 들어왔다.
그런데 새 시그널 목록에서 **audit 회귀**가 생겼다. touch 0 → 35, 열지 못한 것 0 → 1, cond-missing 0 → 825, folded2-360 1 → 29 이다.
실행자가 알린 합계("나머지 0, folded2-360 1")와 내가 잰 값이 맞지 않는다. 아래 조건 1~4는 꼭 고치고, 5~6은 적거나 주인에게 묻는다.

검토자가 직접 한 것: 자기 worktree 에서 `HEAD detached at daed60c` 로 두고 `npm ci` → tsc → lint → vitest → build 를 돌렸다.
가짜 서버는 둘을 띄웠다. 8173(`--reset`, audit 용)과 8174(`--reset --demo-backup-warning`, 사진·흐름 확인용)이다. 데이터는 저장소 밖 `scratchpad/r2/data*` 에 두었고, 둘 다 PID 로 껐다.
사진·스크립트는 `/tmp/claude-0/-home-user-Dashboard/872d4c20-7cc1-5690-b20f-f626e7020f9d/scratchpad/r2/shots/` 와 `.../scratchpad/aud/rv2a~f.mjs` 에 있다. audit 결과는 `.../scratchpad/r2/audit/summary.md` 다.

## 합격으로 올릴 조건

1. **시그널 목록 "구분" 고르기가 42×40px 로 눌려 글이 안 보인다 (audit touch 0 → 35)**
   - `.filter-chips` 는 `flex-wrap: nowrap` 이다. 그런데 `flex: none` 은 `.chip` 에만 걸려 있다(shell.css "filter-chips .chip"). 그래서 `label.category-pick` 이 줄어든다. 높이도 `min-height: 40px` 다.
   - 폰 390·360 둘 다 그렇다. 칩 줄을 끝까지 밀어도 "구분: 전체" 글은 없고 ▾ 만 보인다(`shots/p390-chips-end-default.png`).
   - 측정: `select size [42,40]`. audit touch 35 는 모두 이것이다(`section.signal-filter > … > label.category-pick > select`, dash-signal 다섯 화면 × 폰 7조건).
   - 고칠 길: `.category-pick { flex: none }` 을 주고 높이를 44 로 한다. 그 뒤 audit touch 0 을 보인다.
2. **audit 의 cond-missing 0 → 825 · folded2-360 1 → 29 — 재는 방법을 바꾸고, 그 까닭을 적는다**
   - cond-missing 은 모두 `article.stock-card got 0 want 4(5)` 다. 폰 카드가 접혀서 조건 칩을 그리지 않기 때문이다. 기능이 사라진 것이 아니라 잰 방법이 맞지 않는 것이다(펼치면 조건 4개가 다 나온다, `shots/p390-red-signal-open1.png`).
   - 지난 clipped 때처럼 audit 이 카드를 펼쳐 재거나, 접힌 카드는 빼고 펼친 카드를 따로 하나 재도록 고친다. 그 뒤 0 을 보인다.
   - folded2-360 28개 늘어난 것은 접힌 카드의 한 줄 이유다. 360 에서 두 줄이 된다(`span.signal-card-why` "매도(참고) · 이격도 +12.8% · 200일선 +53% · 비중 11.3% · 목표 5%"). 규칙상 "목록으로 남김" 이라 막지는 않는다. 그래도 목업 10 의 "한 줄 이유" 와 다르다. 줄일지(비중 뒤를 빼는 등), 두 줄을 받아들일지를 적는다.
   - 실행자 보고(나머지 0, folded2-360 1, orphan 70)와 내 값(orphan 33, num-split 16, fake-button 8)이 다르다. daed60c 를 빌드한 뒤 다시 돌린 합계를 남긴다.
3. **열지 못한 화면 1 — `modal-chart-fund` × `ph390-text130-dark`, 두 번 돌려도 같다**
   - 재현: `node docs/design/audit.mjs --base <서버> --only modal-chart-fund --out <밖>` → `실패: locator.click: Timeout`.
   - 까닭: 300px 폭에서 시그널 목록의 레이아웃 폭이 **349px** 로 넓어진다(`rv2f.mjs`: `sw 349 · cw 300`, 320px 에서도 349). 그래서 차트 팝업의 닫기 단추가 화면 오른쪽 끝에 걸리고, `modal-head` 가 누르기를 가로챈다(`shots/t130-fail-0.png`).
   - 카드가 오른쪽에서 잘리는 것도 보인다(`shots/w300-signal.png`). 머리 "시그널 11종목" 은 두 줄로 접힌다.
   - 넓히는 것은 `stock-card.css` `.card-grid { grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)) }` 로 보인다. 폰 화면의 양옆 여백을 빼면 290 보다 좁다. 이 줄은 예전부터 있었을 수 있지만, 이번 검사에서 드러났다.
   - audit 의 page-overflow 는 isMobile 에서 `innerWidth` 가 함께 커져(349) 이 넘침을 잡지 못한다. 그것도 같이 적는다.
   - 고칠 길: `minmax(min(290px, 100%), 1fr)` 처럼 바꾸고, 300px 에서 `scrollWidth == clientWidth` 와 열지 못한 것 0 을 보인다.
4. **옛 이름·말이 화면에 남았고, 문구변경.md 에 적지 않았다**
   - 주인 답은 "AI 포트폴리오 **점검**" 이다. 그런데 화면 글에 "진단" 이 남았다.
     - `AiSummaryPage.tsx:50` "포트폴리오 진단은 관리자가 열어 둔 동안…"
     - `Policy.tsx:98` "포트폴리오 진단과 종목 분석은…"
     - `AiPanel.tsx:44` "전체를 진단받습니다"
   - 사용자가 지운 달라고 한 "대시보드" 가 `Policy.tsx:116` "대시보드의 정렬·보기·손익 통화" 에 남았다.
   - 문구변경.md 는 묶음 2에서 한 번도 바뀌지 않았다(`git log -- 문구변경.md` 의 마지막이 97005f4). 진단 → 서버 상태, 진단/전체 정리 → 점검/종목 정리, 방침의 탈퇴 길, 빈 홈 안내, "밝게/어둡게", 나가기 묻기가 빠져 있다. 지난 조건 5의 "문구변경.md 에 적는다" 가 아직 남았다.
   - 덜 급한 것: fake_server `--demo-backup-warning` 도움말 "⋯ 의 점"(fake_server.py:834). 그리고 주석 여럿(AuthGate.tsx:53·55, backupWarnings.ts:5, refreshText.ts:38, backend 의 "헤더 ⋯").
5. **목업 10 과 다른 곳 — 차이표에 적거나 주인에게 묻는다 (3-2 "목업과 같음")**
   - **같은 화면의 수가 둘이다.** 머리는 "시그널 11종목" 인데 첫 칩은 "전체 15" 다. 목록에는 신호가 없는 관망 종목(SCHD 등 "—")까지 15개가 나온다. 목업 10 은 머리와 칩이 모두 11이고, 신호가 뜬 종목만 보인다.
     - 사용자가 "13이 무엇의 수인지 몰랐다" 고 한 것이 11/15 로 다시 생길 수 있다. 관망까지 보일지, 신호 종목만 보일지(관망은 칩이나 작은 줄로 둘지)를 정한다.
   - **접힌 카드가 목업의 두 배 높이다.** 156~206px 이고, 목업은 약 80px 다. 앱은 이름·값 줄, 배지 줄, 이유 줄이 따로다. 목업은 배지가 값 옆에 있고 이유 한 줄만 있다. 폰 390 의 첫 화면에 다 들어오는 카드는 3장이다(`rv2c.mjs`, `shots/p390-dark-signal.png`).
   - AI 종목 정리가 머리 오른쪽에 있고(목업은 칩 아래 줄), ⋯ 가 머리에 있다. 이 둘은 2-보완.md 에 적혀 있다. 괜찮다.
   - PC 계정 줄은 "owner / 관리자" 다. 목업 09b 는 "내 포트폴리오 / 관리자 · 알림 켜짐" 이다. 사용자(friend)는 아래 줄에 이메일이 나온다. 알림 상태를 뺀 까닭을 한 줄 적는다.
   - PC 요약 다섯 칸에서 날짜·전일 % 가 숫자 옆 같은 줄에 붙는다(목업은 아래 줄). 배치 차이이므로 적기만 한다.
6. **배지를 누르고 넘어오면 그 카드가 펼쳐지는 동작에 테스트가 없다**
   - 동작은 맞다. 폰 390·360 에서 홈의 TIGER·AAPL 배지 → `/?view=signal` 에서 그 카드만 `aria-expanded=true` 고 화면 가운데에 온다(`rv2b.mjs` "from badge … open [\"381180.KS\"]").
   - 하지만 `Dashboard.tsx:709 setOpenCard(focus)` 를 지워도 실패할 테스트가 없다. grep 한 결과, 배지에서 넘어오는 것과 펼침을 같이 보는 테스트가 없다. 하나 더한다.

## 1. 지난 조건 6 — 직접 재현

| # | 조건 | 판정 | 증거 |
| --- | --- | --- | --- |
| 1 | 신호 0 이면 시그널 목록에 갈 길 없음 | 통과 | dashboard·rebalance 응답에서 신호를 모두 끄고(`rv2a.mjs`) 열었다. 폰 390·PC 1440 에 "확인할 신호가 없습니다 **시그널 목록 보기**" 단추가 있다(85×44). 누르면 `/?view=signal` 이 되고, AI 종목 정리 · 표/카드 보기 · 종목 설정 · 시그널 기준에 갈 수 있다. 테스트 Dashboard.portfolio.test.tsx:803 |
| 2 | aria-current | 통과 | 390·1440 모두에서 `/fundamentals`·`/history`·`/stocks` → `종목\|page`, `/ai/portfolio`·`/ai/watchlist`·`/?view=signal` → `홈\|page`. 주소마다 page 는 하나뿐이다. PC 계정 줄(같은 /settings 링크)에는 붙지 않는다. 테스트 TabBar.test.tsx:68-76 |
| 3 | B4 숫자 + 점 | 통과 | 8174(가입 신청 1, 백업 경고)에서 숫자(26×19)와 점(8×8)이 둘 다 보인다(`shots/b4-390.png`, `b4-1440.png`). 링크 이름은 `"가입 신청 1건 서버 상태를 확인하세요 — 백업 · 시세 받기 설정"`. 점이 작고 숫자 아래 모서리라 눈에 덜 띄는 것은 참고 |
| 4 | audit clipped | 통과 | 347조합 `clipped 0` |
| 5 | 옛 문구 | 부분 | 방침 "설정 탭의 탈퇴"(Policy.tsx:165)와 빈 홈 3단계는 고쳤다(`new home` 글 확인). 남은 것과 문구변경.md 는 조건 4 |
| 6 | 목업 차이 이유 · PC 계정 줄 | 통과(남은 것은 조건 5) | 2-보완.md 에 차이표가 있다. PC 왼쪽 메뉴 아래에 계정 줄이 있다(1440·1100 에서 보이고 1099 에서 숨음, 누르면 /settings) |

## 2. 그 뒤에 들어온 것

| 항목 | 판정 | 증거 |
| --- | --- | --- |
| 빈 홈 안내 | 통과 | new@: "…매수·매도·비중조절 신호 칸을 누르면 종목마다 시그널이 보입니다" |
| 종목 탭 위 차트/재무 | 통과 | `/stocks` 에 nav "종목 보기"(차트 · 재무, 44 높이). 재무를 누르면 `/fundamentals`, 탭은 종목이 켜진 채 |
| PC 신호 뜬 종목 몇 중 몇 · 이름 누르면 차트 | 통과 | "신호가 뜬 종목 5 / 11", "시그널 11종목 모두 보기". 이름을 누르면 dialog "TIGER … 차트" |
| '대시보드' 말 | 부분 | 조건 4(Policy.tsx:116) |
| 밝게/어둡게 | 통과 | 설정 줄 `화면 어둡게 · 상승 초록` |
| 로고 ₩ | 통과 | 폰 머리줄도 ₩(`shots/nosig-390.png`) |
| 설정 배지 자리 | 통과 | PC 숫자가 톱니 오른쪽 위 바깥에 있다(`b4-1440.png`) |
| 이름 정리 | 통과(남은 글은 조건 4) | 설정 "서버 상태"(팝업 제목도 같다), /ai/portfolio "AI 포트폴리오 점검", /ai/watchlist "AI 종목 정리", 매크로 "✦ AI 매크로 정리" |
| 나가기 한 번 묻기 | 통과 | alertdialog "이 기기에서 나갈까요?". 취소와 Esc 를 누르면 닫히고 /settings 에 남는다. 나가기를 누르면 손님 홈이 된다 |
| PC 표 수량 · 한 단계 진하게 | 통과 | `.holdings-table td .holding-sub { color: var(--text-dim) }`, 종목 아래 줄 그대로. audit contrast 0 |
| AI 화면 ‹ (지난 참고 1) | 통과 | about:blank → /ai/portfolio → ‹ 를 누르면 `/`(앱 안) |
| 거르기 칩 한 줄 | 부분 | 전체 · 매수 · 매도 · 비중조절(켜면 초과·미달) · 구분. 칩은 모두 44 높이, `aria-pressed`. 구분 고르기는 조건 1 |
| 폰 카드 접힘 · 하나만 | 통과 | 15장 모두 접혀 있다. 0을 펴면 0만 펴진다. 2를 펴면 0은 접히고 2만 펴진다. 2를 다시 누르면 모두 접힌다. 키보드 Enter·Space 로도 펴고 접힌다. 포커스는 토글에 남는다 |
| aria-expanded · aria-controls | 통과(참고 1) | 토글은 button, `aria-expanded` 가 맞게 바뀐다. 접혀 있을 때는 `aria-controls` 가 없는 id 를 가리킨다(`id-missing`) |
| 한 줄 이유 | 부분 | 390 은 한 줄, 360 은 매도 + 비중 카드가 두 줄(조건 2) |
| 보기·설정은 ⋯ | 통과 | 머리 ⋯ 44×44, `aria-label="보기·설정"`, `aria-expanded` false → true. 펴면 표·카드·종목 설정·시그널 기준·순서 편집 |
| AI 종목 정리 작은 링크 | 통과 | 머리 오른쪽, 44 높이 |
| 배지에서 넘어오면 펼침 | 통과(테스트 없음 → 조건 6) | 폰: 그 카드만 펼쳐지고 가운데에 온다. PC 오른쪽 칸 배지 → `/?view=signal`(표) |
| PC 홈 요약 다섯 칸 | 통과 | 1440: 총액 · 평가손익 · 수익률 · 최근 거래일 대비 · 다음 리뷰, 구분선(`shots/pc1440-home-owner-warn.png`). 900 에서는 예전 배치다(1100 미만이 맞다) |
| 상승 빨강 | 통과 | `p390-red-signal-open1.png`: 매수 빨강▲, 매도 파랑▼, 비중 ◆ 청록 |

## 3. 명령

| 항목 | 판정 | 증거 |
| --- | --- | --- |
| npm ci | 통과 | exit 0 |
| tsc -b | 통과 | exit 0 |
| lint | 통과 | exit 0, warning 22(기준선 22) |
| vitest | 통과 | `Test Files 66 passed (66)` · `Tests 1073 passed (1073)` — 실행자 보고와 같다 |
| build | 통과 | `✓ built in 441ms` |
| 기능 불변 | 통과 | backend·api 의 diff 는 없다. types.ts 는 주석 두 줄, lib/aiTitles.ts 는 이름 두 개뿐이다. audit.mjs 는 '진단' → '서버 상태' 한 줄 |

## 4. audit (전체, 347조합, 8173 `--reset`)

| 검사 | 직전(실행자 보고) | 이번(검토자) | 판단 |
| --- | --- | --- | --- |
| 열지 못한 것 | 0 | **1** | 조건 3 |
| page-overflow | 0 | 0 | 다만 300·320px 의 레이아웃 폭 넘침을 못 잡는다(조건 3) |
| clipped | 0 | 0 | 통과 |
| orphan | 70 | 33 | 줄었다. 버튼 8(모두 menu-users·fundamentals 의 긴 이름 — 앞 차수부터), 문단 20, 제목 5 |
| num-split | 14 | 16 | fundamentals 10 · macro 3 · menu-diagnostics 2 · guest-macro 1. 이번 diff 와 관계없는 화면이다 |
| folded2-360 | 1 | **29** | 조건 2(목록 규칙) |
| touch | 0 | **35** | 조건 1 |
| cond-missing | 0 | **825** | 조건 2(잰 방법) |
| fake-button | 9 | 8 | modal-chart-fund 만 |
| 나머지(contrast · console · focus-ring · text-overlap …) | 0 | 0 | 통과 |

## 5. 목업 10 비교 (사진: `shots/p390-dark|light|red-*`, `p360-dark-*`, `pc1440-*`, `pc900-*`)

- 폰 가: 칩 한 줄, 접힌 카드, 펼치면 지표·조건·마지막 매수·AI 분석이 나오는 것은 같다. 다른 곳은 조건 5에 적었다(11 대 15, 카드 높이, AI 링크 자리).
- PC: 위쪽은 칩 한 줄 + 보기 줄, 표는 그대로다. 목업은 제목·칩·AI 링크가 한 줄이고 앱은 세 줄이다. 배치 차이라 적기만 한다.
- PC 홈: 다섯 칸은 같다. 날짜가 붙는 자리는 조건 5.

## 참고 (막지 않음)

1. 접힌 카드의 `aria-controls` 가 없는 id 를 가리킨다. 몸통을 `hidden` 으로 늘 그려 두거나, 접혔을 때는 속성을 빼면 깔끔하다.
2. 시그널 목록의 토글 접근성 이름은 "관망(매수·매도 조건 미충족) 비중 미달 이격도 …" 로 길다. 쓰기에는 괜찮다.
3. PC 900~1100 에서 표 끝 신호 열이 가로 스크롤 쪽으로 밀리는 것(지난 참고 3)은 그대로다.
4. B4 점은 숫자 아래 모서리의 8px 라 눈에 덜 띈다(조건은 충족).

## 검토자 작업 트리

```
$ git status
HEAD detached at daed60c
nothing to commit, working tree clean
```
저장소 파일은 고치지 않았고 커밋하지 않았다. 뮤테이션 검사도 하지 않았다(조건 6은 grep 으로 판단). frontend/node_modules·dist 는 git 이 무시하는 것이다. 가짜 서버 둘(8173·8174)은 PID 로 껐다.
