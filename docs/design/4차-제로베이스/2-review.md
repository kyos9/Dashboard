# 디자인 4차 묶음 2 검토 판정 — 204fe42

# 조건부 합격

검토자가 직접 돌려 본 것: 자기 worktree 에서 HEAD detached at 204fe42. 실행자 보고는 근거로 쓰지 않았다.
가짜 서버는 8171(--demo-backup-warning, 사진·흐름 확인용)과 8187(깨끗한 --reset, audit 용) 두 개를 썼다. 데이터는 저장소 밖 scratchpad 에 두었고, 둘 다 PID 로 껐다.
사진·스크립트는 `/tmp/claude-0/-home-user-Dashboard/872d4c20-7cc1-5690-b20f-f626e7020f9d/scratchpad/shots/`, `.../scratchpad/aud/` 에 있다.

## 합격으로 올릴 조건 (모두 해야 함)

1. **신호가 하나도 없으면 시그널 목록에 들어갈 길이 없다 (기능 사라짐)**
   - 지금 들어가는 길은 신호 칸 단추, 신호 배지, PC 의 "시그널 모두 보기" 셋뿐이다. 신호가 0 이면 `SignalLine` 이 `<p class="signal-line quiet">확인할 신호가 없습니다</p>` 만 그린다(PortfolioView.tsx:291-296). PC 오른쪽 칸도 `signalCount > 0` 일 때만 나온다(:152).
   - 그러면 시그널 목록에만 있는 것들에 갈 수 없다. AI 전체 정리(/ai/watchlist 로 가는 줄은 Dashboard.tsx:768, 시그널 목록 안에만 있다), 시그널 기준, 카드 보기, 종목 설정(편집), 관망 종목의 지표가 모두 막힌다. 예전에는 "포트폴리오 / 시그널" 전환이 늘 있었다.
   - 재현: `scratchpad/aud/nosig.mjs` 는 /api/dashboard·/api/rebalance 응답에서 knee_buy_v2·shoulder_sell_ref 를 false 로, reasons 를 [] 로 바꿔 홈을 연다. 폰 390과 PC 1440 모두 main 안에 시그널·AI 관련 링크가 "AI 포트폴리오 진단" 하나뿐이다. 사진은 `shots/nosig-390.png`.
   - 고치는 길: 신호가 0 이어도 "시그널 목록 보기 ›" 처럼 들어가는 줄을 늘 둔다. 이게 다시 생기지 않는지 보는 테스트도 남긴다.
2. **같은 탭인데 다른 주소에서는 `aria-current` 가 빠진다**
   - /fundamentals 와 /history 에서는 종목 탭이, /ai/* 에서는 홈 탭이 겉으로는 켜져 있다(`active` 클래스). 하지만 `aria-current` 는 null 이다.
   - 까닭: NavLink 는 자기 주소가 맞을 때만 `aria-current` 를 붙이고, 넘겨준 값은 그때만 쓴다(TabBar.tsx:30-36).
   - 측정: `jobs4.mjs` → `cur-fund ["종목|bottom-tab active|null"]`, `cur-ai ["홈|bottom-tab active|null"]`. `/?view=signal` 에서만 `page` 가 붙는다.
   - 테스트는 `activeTab()` 함수만 보고 그려진 속성은 보지 않는다(TabBar.test.tsx:68-80).
   - 고치는 길: `NavLink` 대신 `Link` 에 `aria-current` 를 직접 붙이거나, `aria-current` 를 함수로 넘긴다. 그려진 화면에서 /fundamentals·/ai/portfolio 의 속성을 보는 테스트를 더한다.
3. **0.45.2 B4 회귀 — 신청 수가 있으면 백업·시세 경고 점이 안 보인다**
   - 예전 ⋯ 단추는 숫자와 점을 같이 보였다. HeaderMenu.tsx 주석에 "숫자에 가려 백업 경고가 안 보였다(0.45.2 B4)" 고 적혀 있었고, 읽기 이름에도 둘 다 들어 있었다.
   - 지금 설정 탭 아이콘은 `count > 0 ? 숫자 : diag ? 점 : null` 이라 둘 중 하나만 그린다(TabBar.tsx:20-26). 테스트도 이 동작에 맞춰 바뀌었다(AppHeader.phone.test.tsx:132 "탭에는 숫자가 먼저").
   - 재현: 8171(--demo-backup-warning, 가입 신청 1). 탭 접근성 이름은 `link "가입 신청 1건 설정"` 이고 진단 까닭이 없다. 사진은 `shots/p390-home-dark.png`.
   - 고치는 길: 예전처럼 숫자와 점을 같이 보이고, 링크 이름에 까닭도 넣는다. 테스트를 B4 원래 뜻으로 되돌린다.
4. **audit 의 "잘린 글" 이 0 에서 120 으로 늘었다**
   - 모두 설정 화면(settings·guest-settings)에서, 10조건 × 12 이다. 자리는 접힌 `details.settings-credits > ul > li` 다.
   - 펼친 사진(`shots/p390-settings-credits.png`)에서는 잘리지 않는다. 그래서 잰 방법이 잘못 잡은 것으로 보인다. 그래도 합격선은 0 이다.
   - 고치는 길: audit 의 clipped 검사도 겹침 검사처럼 접힌 `<details>` 의 내용을 빼거나, 펼친 상태로 잰다. 그 뒤 0 임을 보인다.
   - 재현: `node docs/design/audit.mjs --base <8187> --out <밖>` → summary.md `clipped 120`.
5. **옛 구조를 가리키는 문구가 남았다**
   - Policy.tsx:165 "화면 위의 **탈퇴**(폰은 ⋯ 메뉴 안)". ⋯ 메뉴는 없어졌고, 법적 고지에 길을 잘못 적은 것이다.
   - Dashboard.tsx:742-744 의 첫 화면 3단계 "맨 위에 생기는 **포트폴리오 / 시그널** 탭에서 '시그널'을 고르면". 그런 탭은 없다(`shots/p390-new-home.png`).
   - 덜 급한 것: AuthGate.tsx:53 주석 "⋯ 메뉴에 점", NoStocksYet.tsx:5·RebalancePanel.tsx:1190 의 "더보기 안", fake_server `--demo-backup-warning` 도움말 "⋯ 의 점".
   - 고치는 길: 문구를 고치고 `문구변경.md` 에 적는다.
6. **목업과 다른 곳의 이유가 적혀 있지 않다 (3-2 "목업과 같음", 합격 8)**
   - status·문구변경 어디에도 09·09b 와의 차이표가 없다. 아래 "목업 비교" 의 차이마다 이유를 적거나, 주인 ② 보고에 넣는다. 특히 다음 둘이다.
   - PC 왼쪽 메뉴 아래의 계정 줄(09b: "내 포트폴리오 / 관리자 · 알림 켜짐")이 빠졌다. 그래서 PC 에서 **누구로 들어와 있는지 한눈에 볼 자리가 사라졌다**(예전 PC 머리줄 account-chip — 원래 코드 주석의 까닭은 "다른 계정으로 들어온 것" 가리기). 지금은 설정 탭에 들어가야만 보인다. 목업대로 넣는 것을 권한다.
   - 09b 의 "홈" 제목 줄, 정렬 칩(셀렉트를 그대로 씀), 오른쪽 칸 종목 아래의 신호 까닭 줄이 빠졌다.

## 실행자가 알린 남은 것 셋 — 막는가

| 남은 것 | 판정 |
| --- | --- |
| 시그널 목록 카드가 09 처럼 바뀌지 않음(예전 시그널 보기 그대로) | **막지 않음**. 다만 plan 9-2 표는 묶음 2에 "시그널 목록 화면" 을 넣었으므로 묶음 2가 덜 끝난 것이다. ② 보고에 "머리(‹ · 개수 · AI 줄)만 바뀌고 본문은 다음" 이라고 분명히 적고, 언제 할지(묶음 2 보완인지 3인지) 주인에게 묻는다 |
| PC 요약이 구분선 다섯 칸이 아니라 예전 한 줄 | **막지 않음**(배치 차이, 숫자·위계는 같음). 조건 6의 차이표에 이유를 적는다 |
| ROADMAP 9-10 "수량은 제 칸" → 종목 아래 작은 줄 | **막지 않음, 주인 확인 필수**. 9-10 은 "이름 옆 작은 회색 글씨라 안 보였다" 는 불만을 고친 주인 결정이다. 지금 `2,000주 · 평단 ₩80,054.48` 이 작은 회색 줄이라 같은 불만이 다시 생길 수 있다. 주인이 고른 09b 에도 이 모양이 있지만 9-10 을 뒤집는다는 말은 없었다 → ② 에서 "9-10 을 이렇게 바꿨다" 고 따로 묻는다. 금액 가리기는 지켜진다(`qty()` 가 가림, lib/display.ts:136) |

## 항목별

| 항목 | 판정 | 증거 |
| --- | --- | --- |
| tsc -b | 통과 | `tsc exit 0` |
| lint | 통과 | 경고 22(기준선 22), `lint exit 0` |
| vitest | 통과 | `Test Files 66 passed`, `Tests 1070 passed (1070)`(시작 1065) |
| build | 통과 | `✓ built in 609ms`, SettingsPage 청크 19.87kB(누를 때 받음) |
| 기능 불변 — backend·api·types·AppState | 통과 | `git diff --stat 79b8850 204fe42 -- backend frontend/src/api frontend/src/types.ts frontend/src/AppState.tsx` 비어 있음 |
| 기능 불변 — frontend/src/lib | 해명 필요(되돌림 아님) | aiTitles.ts(옮김) · pageChunks.ts(청크 둘) · tabs.ts(새로) · portfolio.ts(loadView/saveView 삭제). 주인이 B 구조와 보기 전환 "다" 를 골랐으니 이동 경로 변경은 승인된 것이다. 다만 3-1 은 lib diff 가 비어야 한다고 하므로 이유를 문구변경·status 에 적는다. `DashboardView` 타입과 `localStorage 'dashboard.view'` 옛 값은 남는다(해 없음) |
| 사라진 기능 — 설정 탭 | 통과(조건 1·6 빼고) | a11y 트리(owner, /settings): 화면(값 "다크 · 상승 초록") · 알림 · AI 키 · 진단(! + 까닭) · 사용자(신청 1) · 나가기 · 모든 기기에서 나가기 · 방침 · 만든 것들 · `v0.46.1`(title 에 커밋·제공자). 탈퇴는 friend 에게 보임(canWithdraw 같은 식). 앱 설치는 `install.available` 일 때(헤드리스에선 안 나옴, 코드 같은 조건). 손님: 화면 · 방침 · 만든 것들 + 로그인. 승인 대기: 화면 · 나가기 · 방침(모든 기기 없음 — 예전과 같음). syncPush 는 AppHeader 에 남음(AppHeader.tsx:35-38) |
| 옛 주소 | 통과 | /fundamentals → 재무, /history → 히스토리 차트, /chart → /history?ticker=VOO, /stocks → 종목 관리. /ai/xyz → "없는 화면입니다" |
| 뒤로가기 | 통과(참고 1) | 신호 칸 → `/?view=signal` → AI 전체 정리 → 뒤로(‹) → `/?view=signal` → 하드웨어 뒤로 → `/`. 홈 AI 줄 → `/ai/portfolio` → 뒤로 → `/`. 설정 "화면" 팝업 → 뒤로 → 팝업 닫힘, `/settings` 그대로. `/?view=signal` 로 바로 와서 ‹ → `/`(replace) |
| 탭 아이콘·켜짐 | 통과 | 08b 추천 그림(둥근 집 · 캔들 · 도넛 · 계기판 · 둥근 톱니), 켜지면 속 채움 + 알약 바탕. 09 와 나란히 본 사진 `shots/tabs-cmp.png` |
| 접근성 — 탭 이름·아이콘 | 통과 | nav "화면", 링크 이름 홈·종목·리밸런싱·매크로·설정, 모든 svg `aria-hidden="true"` |
| 접근성 — aria-current | **실패** | 조건 2 |
| 44px | 통과 | 폰 탭 78×54, PC 207×44. audit touch 0 |
| 포커스 | 통과 | 폰·PC 탭과 설정 줄에 포커스 테두리가 보인다(`shots/focus-cmp.png`). audit focus-ring 0 |
| 대비 | 통과 | audit contrast 0(두 테마, 상승 빨강 포함) |
| 색표 밖 색 | 통과 | `styles/` 의 tokens.css 밖과 .tsx 에서 `#hex · rgb( · hsl(` grep 0. tokens.css 바뀐 것 없음 |
| 관리자 신청 수·진단 점 | 부분 실패 | 숫자는 보임(폰·PC). 숫자가 있으면 점이 숨음 → 조건 3. 사용자에게는 둘 다 없음(테스트 :144) |
| 손님·승인 대기 화면 | 통과 | `p390-guest-home/settings`, `pc1440-guest`, `p390-pending(-settings)`. 머리줄: 손님은 로그인만, 대기는 비어 있음 |
| 상승 빨강 | 통과 | `pc1440-home-red.png`: 매수 빨강▲ · 매도 파랑▼ · 비중 청록◆, 오르내림 빨강/파랑. 모양과 글자가 늘 같이 붙음 |
| 토스페이스 라이선스 | 통과 | 앱의 SVG 10개가 `/home/user/toss/tossface/dist/svg/` 원본과 `cmp` 로 같다(u1F6B6 은 들어 있지만 쓰지 않음). `public/licenses/tossface.txt` 는 원본 LICENSE 와 바이트까지 같고, 저작권 안내 주소(toss.im/tossface/copyright)가 맨 위에 있다. 설정 "만든 것들" 에 "© Viva Republica, Inc. · 토스페이스 라이선스(전문) · 원본 그대로". `/licenses/tossface.txt` 가 가짜 서버에서 열림. 참고 4 |
| audit 전체 | **실패 1** | 347조합, 열지 못한 것 0. 앞 판정(0eb1fc1, r5) 대비: clipped 0→**120**(조건 4) · orphan 71→73(rebalance 의 PC1400 두 테마 `p.zero-target-note` 6줄 끝 4자 — 왼쪽 메뉴로 본문이 232px 좁아진 탓, 문단이라 20% 규칙 안) · num-split 16 · folded2-360 1 · fake-button 9 같음 · 나머지 0 |
| 목업과 같음 | **실패** | 조건 6 |
| 계획 걱정 반영 | 통과 | 9-2 결정(탭 B · 더보기 없음 · ⋯ → 설정 · 홈 "다" · AI 화면) 모두 들어감 |

## 목업 비교 (폰 390 · PC 1440 · 900 · 360, 다크/라이트)

- 폰 홈(09 왼쪽): 배치, 신호 칸 셋, AI 줄, 탭 바가 같다. 정렬은 칩이 아니라 이름표 붙은 셀렉트다(묶음 1 결정이라 괜찮음).
- 시그널 목록(09 가운데): 머리 `‹ 시그널 13` 과 AI 전체 정리 줄은 같다. 그 아래는 예전 본문(신호 요약 상자 · 구분 · 신호 칩 · 보기·설정 · 큰 카드)이다. 09 의 거르기 알약 한 줄과 짧은 카드가 아니다.
- AI 화면(09 오른쪽): 머리와 ‹ 는 같다. 다만 이 화면 머리글(LEADS)과 AiPanel 자체 안내가 같은 말을 두 번 한다(참고 2).
- 설정(09 아래): 그룹과 토스페이스 그림은 같다. 09 는 줄마다 값(알림 "켜짐", AI 키 "등록됨", 사용자 "신청 1")이 있는데 앱은 화면에만 값이 있다. "로그아웃" → "나가기"(용어 유지, 좋음).
- PC(09b A): 왼쪽 메뉴, 표 열 순서, 비중 막대와 목표선, 글자 신호 배지, 오른쪽 칸(신호 칸 · 신호 뜬 종목 · 시그널 모두 보기 · AI 진단)이 같다. 다른 점: 요약이 다섯 칸이 아님, "홈" 제목 없음, 메뉴 아래 계정 줄 없음, 오른쪽 칸에 까닭 줄 없음, AI 칸이 09b 의 미리보기가 아니라 한 줄.
- PC 900(좁은 메뉴): 오른쪽 칸이 표 위로 내려간다. 표 끝 "신호" 열이 표 안 가로 스크롤 쪽으로 밀려 배지가 잘려 보인다(`pc900-home.png`, 표 안 스크롤이라 규칙 위반은 아님 → 참고 3).

## 참고 (막지 않음)

1. AiSummaryPage 의 ‹ 는 `window.history.length > 1` 로 고른다(AiSummaryPage.tsx:25). 다른 사이트에서 이어 들어왔거나 같은 탭에 앞 기록이 있으면 앱 밖으로 나간다. 재현: 새 페이지에서 바로 /ai/portfolio → ‹ → about:blank. Dashboard 처럼 `location.state` 나 `location.key === 'default'` 로 가르는 편이 맞다.
2. AI 화면에 안내 문단이 두 개다("담은 종목의 비중과 수익률(%)만…" + AiPanel 의 "내 포트폴리오의 비중… % 로만"). 하나로 줄이면 첫 화면이 짧아진다.
3. PC 900~1100 에서 신호 열이 스크롤 밖으로 나간다. 열 순서상 가장 중요한 것이 가장 먼저 숨는다.
4. 쓰지 않는 `assets/tossface/u1F6B6.svg` 는 빼도 된다(빌드에는 안 들어감). 라이선스 파일이 `sw.js` 캐시에 없어 오프라인에서는 "전문" 링크가 안 열린다.
5. `styles/pages/shell.css` 392줄, `components/nav.css` 159줄 — 300줄 "되도록" 을 넘는다.
6. 탭의 점·숫자는 `span[aria-label]`(역할 없음)이다. 크롬은 링크 이름에 넣었지만(`가입 신청 1건 설정`), 화면 읽기 프로그램마다 다를 수 있다. 링크에 `aria-label` 을 직접 짓는 편이 확실하다(조건 3과 같이).

## 검토자 작업 트리

```
$ git status
HEAD detached at 204fe42
nothing to commit, working tree clean
```
저장소 파일은 고치지 않았다. 판정문은 검토자 규칙("저장소 안에 쓰지 않는다")에 따라 저장소 밖에 썼다. `docs/design/4차-제로베이스/2-review.md` 로 옮기는 것은 총괄이 한다.
