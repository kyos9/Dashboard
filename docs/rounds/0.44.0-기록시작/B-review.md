# 0.44.0 B "종합 신호등 정리" — 검토 판정

# 조건부 합격

본 범위: `b5f3e11`, `ef7f2bb`(브랜치 `claude/new-session-fftcg1`, 검토 worktree HEAD = ef7f2bb). 기준선은 라운드 시작 `4844bf0`이다. A(b6f7d06)와 534ebaa는 보지 않았다.
`git diff --stat b6f7d06 ef7f2bb -- backend` 출력은 비어 있다. B는 화면만 고쳤다.

## 조건 (합치기 전에 고치거나 주인이 그대로 두라고 정한다)

1. **(고쳐야 함) 폰과 키보드에서는 "—"의 풀이를 볼 길이 없다.**
   - 지금 풀이는 `title`과 `aria-label` 두 곳에만 있다(`frontend/src/pages/Dashboard.tsx:73-79`). `<span>`이라 초점을 받지 않는다. Tab으로 200번 옮겨도 신호 칸에 들어간 초점은 0번이었다.
   - 터치 기기에서는 길게 눌러도 `title`이 뜨지 않는다. 계획 이견 ②의 추천안이 말한 "마우스·**길게 누르면**"이 폰에서는 이뤄지지 않는다.
   - 지인(갤럭시만 씀)에게 남는 단서는 신호 요약의 "8 관망" 하나다. 그런데 그 칸은 노랑이고 줄의 "—"는 회색이라 둘을 이어 읽기 어렵다.
   - 같은 표의 다른 칸은 "—"를 "값 없음"으로 쓴다(`Dashboard.tsx:304` 등락 없음 '—', 기준일 '—').
   - 고칠 길: 화면에 보이는 풀이 한 줄을 더한다(예: 신호 거르기 줄이나 요약 근처에 "— 관망(조건 미충족)"). 아니면 사용자 검토(지인 폰 360)에서 "—"를 이해하는지 보고, 주인에게 "폰은 풀이 없음"을 그대로 둘지 묻는다.
   - 덧붙여(참고): ARIA 1.2는 `role` 없는 span(generic)에 `aria-label`을 붙이는 것을 금한다. Chromium은 이름을 낸다(아래 증거). 하지만 iOS VoiceOver 같은 읽기 기기는 "—"만 읽거나 아무것도 읽지 않을 수 있다. `role="img"`를 달거나, 눈에 안 보이는 글자로 넣는 쪽이 확실하다.
2. **(고쳐야 함) 용어집과 화면이 어긋난다 — 홈의 범례.**
   - `frontend/src/components/PortfolioView.tsx:415` 범례가 "◆ 비중조절(과중·미달)"이다. 화면에도 보인다. Playwright로 owner 홈 innerText를 보면 "… 매도 시그널 비중조절(과중·미달) — 누르면 시그널 보기"가 나온다.
   - 용어집 `docs/design/glossary.md:19`는 "과중"을 쓰지 않는 말로 적었다.
   - 바로 옆 점의 읽어 주는 이름은 이미 "비중 초과"다. "삼성전자우 신호: 비중 초과. 시그널 보기로"
   - 범례를 "비중조절(초과·미달)"로 고치거나, 용어집 비고에 범위를 적는다.
   - `RebalancePanel.tsx:1344`의 차이 표시 "과중 +x%p"도 같은 말이다. 다만 배지가 아니라 숫자의 방향이라 참고로 둔다.
3. **(고쳐야 함, 라운드 끝까지) 문서가 지금 화면과 맞지 않는다.**
   - `ROADMAP.md:2040-2041` 색 표가 "보라 + ◆ | 비중조절 — 매수 검토 · 매도 검토", "노랑 | 관망 … 신호등 '관망'"이라고 적는다. 지금 줄의 관망은 회색 "—"다.
   - `DESIGN_PROMPT.md:116`은 배지 이름의 예로 "◆ 매수 검토"를 든다.
   - `README.md:142`는 v0.33 이력이라 그대로 둬도 된다. 0.44 이력 줄은 라운드 끝에 쓸 것으로 본다.

## 검사 표 (PROMPT §3)

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 완료 조건 — 표 한 칸에 이름표 두 줄 | 통과 | 머리가 `<th style={{width:196}}>신호</th>`다(`Dashboard.tsx:1181`, 너비 그대로). 칸 안은 `SignalAndWeightRows`(`Dashboard.tsx:102-128`)이고 카드와 같은 부품이다. PC 1400 표 보기 Playwright: `VOO :: 시그널 매도 / 비중 비중 미달`, `SCHD :: 시그널 —`. 그림: `revB-ui/pc-table-crop.png` |
| 완료 조건 — 관망은 흐린 "—", 풀이 "관망 — 매수·매도 조건 미충족" | 통과 (조건 1 참고) | `WATCH_HINT`(`Dashboard.tsx:67`), `.traffic-watch { color: var(--text-faint) }`(`index.css`). 데모 owner 화면에 "—" 8개, 요약 "8 관망"으로 수가 맞는다 |
| 완료 조건 — 비중 배지 "비중 미달 / 비중 초과", 서버 사유 글은 그대로 | 통과 | `display.ts:301-310` 라벨만 바꿨다. 서버 `rebalance.py`는 바뀐 것이 없다(backend diff 0). 응답 사진에는 `'밴드 미달(매수 검토)'`가 그대로 있다. 사유 글을 세는 곳도 그대로 서버 글을 센다: `weightSignal.ts:11`, `portfolio.ts:51-52` |
| 완료 조건 — 관망 숨기기는 그리기에서만 | 통과 | `summary.watch`는 그대로 `lights.filter(state==='watch')`(`Dashboard.tsx:554`)로 센다. 화면 요약은 "4 매수 8 관망 3 매도 3 비중조절"이다. 뮤테이션 R5(관망 수를 0으로)가 잡혔다 |
| 완료 조건 — 비중 줄은 초과·미달만, 정기 리뷰는 요약 배지로 | 통과 | `Dashboard.tsx:105`의 `active ? reasons.filter(isWeightReason) : []`. 응답을 고쳐 모든 종목에 '정기 리뷰 도래'를 실었을 때: 요약에 "정기 리뷰 15" 배지가 서고, 줄과 카드에는 "정기 리뷰"가 0개다(`result.json` `*-tweak`) |
| 정기 리뷰를 카드에서도 뺀 결정(ef7f2bb) | **맞다** | 0.43(디자인 2차 C 검토)의 결정은 "비중조절 수·거르기·◆ 점은 과중·미달만, 정기 리뷰는 요약의 '정기 리뷰 n' 배지"였다(`docs/design/2차-정돈/문구.md:68`, `C-review-2.md:33`). 0.43 카드가 비중 줄에 정기 리뷰를 세운 것은 따로 정한 일이 아니다. 같은 카드에서 ◆ 수·거르기와 어긋나 있던 것이다. 리뷰 날 카드 15장 모두에 같은 배지가 서던 것이 없어지고, 같은 말은 요약에 남는다. 다만 0.43 대비 **보이는 변화**이므로 끝 보고에 한 줄 적기를 권한다(`status.md:66`에는 적혀 있다) |
| 계획 때 걱정 | 통과 | 개발자 7(그리기에서만) 반영. 개발자 8(카드 시그널 줄 빈 줄)은 "—"로 반영. 개발자 참고(정기 리뷰)는 ef7f2bb에서 반영. 개발자 9(서버 글 그대로) 반영. 검토자 B1(상태 말)은 "비중 미달/초과"로, B2(빈칸 금지)는 흐린 "—"로 반영. 사용자 2·3·4는 주인 결정 ①대로다. 사용자 "빈칸 = 시세 없음과 같아 보임"은 반영됐다: 시세 없는 종목은 "갱신 필요" 상자를 그대로 쓴다(테스트 `Dashboard.test.tsx` "관망은 흐린 —"). 막음 0 |
| 회귀 — 테스트 | 통과 | `npx vitest run --maxWorkers=2` → `Test Files 58 passed (58) / Tests 892 passed (892)`. 시작 884, A 뒤 891, B 892. 줄어든 테스트 0. 참고: 일꾼 수를 기본으로 두고 부하 중에 돌린 두 번은 매번 다른 1개가 넘어졌다(`AppHeader.phone.test.tsx` 뒤로가기, `backToClose.modals.test.tsx`). 둘 다 B가 건드리지 않은 시간 의존 테스트이고, 그 파일만 3번 다시 돌리면 13/13이다. 출력: `revB-vitest.txt`, `revB-vitest2.txt`, `revB-vitest3.txt` |
| 회귀 — 응답 사진 | 통과 | `python tools/snapshot.py r044/revB-snap 8181` 다음 `snapdiff.py baseline/snap revB-snap` → `같음 / 차이 0` |
| 회귀 — lint | 통과 | `npm run lint`의 warning 22개로, 시작 때 22개와 같다 |
| 격리 | 해당 없음 | 새 엔드포인트가 없다 |
| 마이그레이션 | 해당 없음 | backend diff 0 |
| 호환 — API 모양 | 통과 | `apidiff.py baseline/openapi.json revB-openapi.json` → `빠짐 0 / 타입 바뀜 0 / 더해짐 3`(셋 다 A의 것). `apidiff openapi-A.json revB-openapi.json` → 0 / 0 / 0 |
| 호환 — 새 화면 ↔ 옛 서버 | 통과 | B가 읽는 필드는 `knee_buy_v2`·`shoulder_sell_ref`·`data_stale`·`rebalance_signal{active,reasons}`뿐이고, 모두 0.43 이전부터 있다. `/api/dashboard` 사진도 4844bf0과 차이 0이다. 옛 서버가 주는 사유 글이 그대로라 `isWeightReason`이 센다. 참고: 서버가 언젠가 **모르는 사유 글**을 보내면, 예전 표는 날 글자로라도 보였지만 이제 표·카드 비중 줄에서 사라진다(`display.ts:287-288` 주석 "모르는 사유가 오면 그대로 보여준다"는 리밸런싱 화면 `RebalancePanel.tsx:921`에만 맞는다) |
| 호환 — 옛 화면 ↔ 새 서버 | 해당 없음 | 서버가 바뀌지 않았다 |
| 입력 한도 | 해당 없음 | 새 입력이 없다 |
| 뮤테이션 — 실행자 결과 | 통과 | `B-mutation.md` 13/13. 참고: "비활성 비중도 보이기"의 옛 줄(`card.rebalance_signal.active && …length > 0`)은 ef7f2bb 이후 코드에 없다. 그래서 새 코드 기준(R1)으로 다시 돌렸고 잡혔다 |
| 뮤테이션 — 직접 | 통과 (5/5) | 스크립트 `revB-mut/mut.py`(이 worktree만 고치고 되돌린 뒤 내용이 같은지 assert). R1 `active ? … : []` 빼기 → 잡힘(Dashboard.test "이름표 두 줄"). R2 `portfolio.ts:51` `'매도 검토'`→`'비중 초과'`(서버 글 대신 화면 말을 세게) → 잡힘(Dashboard.portfolio.test 2개). R3 `isWeightReason`이 초과를 빼먹게 → 잡힘(3개). R4 매도만 떠도 "매도 조건도" → 잡힘. R5 관망 수 0 → 잡힘. 뒤에 `git status`는 깨끗했다 |
| 비밀 | 해당 없음 | 키를 다루는 곳을 고치지 않았다 |
| 규제 | 통과 | B diff에서 더한 화면 글에 "추천·사세요·팔라·저평가·예측"이 0건이다. 배지는 상태를 말한다("비중 초과/미달"). 관망은 색 없는 회색 "—"다. 남는 색은 0.43과 같다(초록 ▲ 매수, 빨강 ▼ 매도, 보라 ◆). 참고: 툴팁 "줄일지 검토하세요 / 채울지 검토하세요"(`display.ts:303,308`)는 0.43부터 있던 글이다. 참고: "—"가 회색이 되면서 칸에 색이 있는 것은 매수·매도뿐이다. 그래서 칸이 행동 목록처럼 읽히는 정도는 0.43보다 조금 세다. 주인 결정 ②의 범위 안이다 |
| 데이터 경계 / 외부 호출 | 해당 없음 | |
| 화면 — 자동 검사 | 통과 | `revB-ui/ui.js`. PC 1400(표 보기·카드 보기, 데모 그대로와 고친 응답) 4가지와 폰 390·360(friend, owner + 고친 응답) 4가지를 라이트·다크 두 테마로 돌려 16장을 봤다. 16장 모두 가로 넘침 `ovX=0`, 잘린 글자 `clip=[]`, 콘솔 오류 0, 화면에 "매도 검토/매수 검토/종합 신호등/과중" 0이다(시그널 보기 기준). "—" 대비는 라이트 4.98:1(rgb(97,113,134) on #fff), 다크 4.97:1(rgb(123,139,158) on rgb(19,27,38))로 둘 다 4.5 이상이다. 둘 다 뜬 종목(QQQ·SCHD를 고쳐 실음): `시그널 매수 매도 조건도`, 폰 카드도 같다(`revB-ui/m360-dark-crop.png`) |
| 화면 — 읽어 주는 이름 | 통과 (조건 1 참고) | CDP `Accessibility.getPartialAXTree` → `{"role":"generic","name":"관망 — 매수·매도 조건 미충족"}`. 표 칸 ariaSnapshot은 `cell "시그널 관망 — 매수·매도 조건 미충족"` |
| 화면 — 키보드(Tab) | 조건 1 | Tab 200번: 신호 칸 안에서 멈춘 초점 0번. 0.43도 배지는 초점을 받지 않았다. 그때는 "관망" 글자가 보였지만 지금은 풀이가 마우스에서만 보인다 |
| 성능 | 통과 | 첫 화면 JS 111.04 → 111.10 kB gzip(A와 B 합계, +0.06 kB). `tsc -b && vite build` 통과 |
| 가짜 서버 | 해당 없음 | 새 화면 상태는 없다. 데모 owner에 관망 8, 비중 초과 2, 미달 1이 있다. 둘 다 뜬 종목과 정기 리뷰 날은 데모에 없어 응답을 고쳐서 봤다 |
| 문서 | 조건 3 | 용어집 2줄 더함(`glossary.md:19-20,39`). 화면과 맞지 않는 곳은 조건 2·3에 적었다 |

## 참고 (막지 않음)

- **"비중" 이름표가 겹친다.** 이름표 "비중"과 배지 "◆ 비중 초과"가 한 줄에 붙어 "비중 비중 초과"로 읽힌다. 읽어 주는 이름도 "시그널 매도 비중 비중 미달"이다. 리밸런싱 화면 묶음은 테스트 기대값 자체가 `'비중비중 초과'`다(`RebalancePanel.test.tsx:826`). 주인이 고른 말이니 그대로 둬도 되지만, 사용자 검토에서 볼 만하다.
- 정기 리뷰가 줄에서 빠지면서, 종목별 정기 리뷰 툴팁("정기 리뷰 도래 — …")도 대시보드에서 사라졌다. 요약 배지 "정기 리뷰 15"에는 `title`이 없다.
- 테스트 시간 의존(`AppHeader.phone`, `backToClose.modals`)은 부하가 걸리면 넘어진다. B와는 관계없다. CI가 일꾼 수를 기본으로 두면 가끔 빨개질 수 있다.

## 만든 것 (모두 저장소 밖)

- 판정문: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r044/B-review.md`
- 테스트·lint·빌드 출력: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r044/revB-vitest3.txt`, `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r044/revB-lint.txt`, `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r044/revB-build.txt`
- 응답 사진과 API 모양: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r044/revB-snap/`, `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r044/revB-openapi.json`
- 뮤테이션: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r044/revB-mut/` (`muts.json`, `out.md`, `r1~r5.txt`)
- 화면: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r044/revB-ui/` (`ui.js`, `ax.js`, `result.json`, 스크린샷 16장 + 잘라낸 그림)
- 가짜 서버: 포트 8181, 데이터 `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r044/revB-data`. PID 17037을 `kill`로 껐고, 끈 뒤 health 응답은 `000`이다

## worktree `git status`

```
HEAD detached at ef7f2bb
nothing to commit, working tree clean
```
