# 0.44.0 B "종합 신호등 정리" — 두 번째 검토 판정

# 조건부 합격

본 범위는 `b5f3e11`, `ef7f2bb`, `bb58fa0`이다. 검토 worktree의 HEAD는 bb58fa0(origin/claude/new-session-fftcg1)이고, 기준은 라운드 시작 `4844bf0`이다.
`git diff --stat ef7f2bb bb58fa0 -- backend` 출력은 비어 있다. bb58fa0은 화면 2파일, 테스트 1파일, 문서 3파일만 고쳤다.

앞 검토의 조건 셋은 화면에서 모두 풀렸다. 다만 §3 뮤테이션의 합격 기준은 "살아남은 것 0"이다. 직접 되돌린 4줄 가운데 2줄이 살아남았다. 둘 다 이번에 고친 조건 ①과 ②를 지키는 테스트가 없다는 뜻이다.

## 조건 (합치기 전에)

1. **(고쳐야 함) 홈 범례 "비중조절(비중 초과·미달)"을 지키는 테스트가 없다.**
   - `PortfolioView.tsx:415`를 "과중·미달"로 되돌려도 `src/pages src/components src/lib`의 816개가 모두 통과한다(M3).
   - 조건 ②가 다시 깨져도 알 수 없다. 범례 글자를 확인하는 한 줄이면 된다.
2. **(고쳐야 함) 폰에서 풀이 줄이 보이는지 지키는 테스트가 없다.**
   - 조건 ①은 바로 "폰에서 못 본다"였다. 그런데 `Dashboard.test.tsx:221`이 `innerWidth`를 1440으로 고정한다.
   - 그래서 `<p className="hint signal-key" hidden={narrow}>`로 폰에서만 숨겨도 816개가 모두 통과한다(M4).
   - narrow 상태(예: `innerWidth` 360)에서 `.signal-key`가 보이는지 확인하는 테스트가 필요하다.

## 앞 조건 셋 — 풀렸는가

| 앞 조건 | 판정 | 증거 |
| --- | --- | --- |
| ① 폰·키보드에서 "—" 풀이를 볼 수 없음 | 통과 (테스트는 조건 2) | `Dashboard.tsx:1021-1025`에 `.signal-key` 한 줄을 더했다. 목록 밖에 있어 표·카드·설정 보기 어디서나 나온다. 폰 360(owner·friend × 라이트·다크) 네 경우 모두 화면 글이 "시그널 줄은 지표로 본 매수·매도이고, 흐린 —는 관망(매수·매도 조건 미충족)입니다. 비중 줄은 지표와 따로, 목표 비중에서 벗어났는지(비중 초과·비중 미달)를 말합니다."이다. 360에서 3줄(높이 56px)로 left 14 / right 346 안에 들어간다. scrollWidth 332 = clientWidth 332로 잘림 없고, 가로 넘침 0이다. 12px이다. 대비는 라이트 4.61:1(rgb(97,113,134) on rgb(244,246,250)), 다크 5.55:1로 둘 다 4.5 이상이다. 그림: `revB2-ui/m360-light-friend-key.png`, `m360-dark-owner-key.png`. `role="img"`도 붙었다(`Dashboard.tsx:75`). CDP AX의 신호 칸 "—"가 `image:관망 — 매수·매도 조건 미충족`으로 나오고, owner 8개·friend 2개 모두 role=img이다. 키보드: 풀이가 이제 화면의 보통 글이다. 그래서 초점이 없어도 읽힌다 |
| ② 홈 범례 "과중" | 통과 (테스트는 조건 1) | `PortfolioView.tsx:415`가 "비중조절(비중 초과·미달)"이 됐다. Playwright로 8가지 경우(PC·360 × 두 테마 × owner·friend)의 홈 innerText를 보면 범례가 `비중조절(비중 초과·미달)`이다. 홈과 시그널 보기에서 "과중·매도 검토·매수 검토·종합 신호등"은 0건이다. 용어집 `glossary.md:19`와 맞는다 |
| ③ ROADMAP 색 표·DESIGN_PROMPT 배지 예 | 통과 (참고 1) | `ROADMAP.md:2040-2041`: 보라 줄은 "비중 미달 · 비중 초과", 노랑 줄은 "신호 요약의 관망 N, 0.44.0부터 신호 칸의 관망은 흐린 —"로 고쳐졌다. `DESIGN_PROMPT.md:116`은 "◆ 비중 미달"과 "폰·키보드로도 보이게 화면 글에도 한 번 둔다"가 됐다. 그 밖의 ROADMAP "과중·매수 검토"(81, 1610, 1859, 1982, 2016 등)는 지난 버전의 이력 글이다 |

## 검사 표 (PROMPT §3, B 범위)

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 완료 조건 (plan "B." + 주인 결정 ①) | 통과 | 한 칸 두 줄, 관망은 흐린 "—", 비중 미달/초과, 숨기기는 그리기에서만. 요약은 `신호 요약 15종목 4 매수 8 관망 3 매도 3 비중조절 비중 초과 2 비중 미달 1`이고, 관망 수(8)와 "—" 수(8)가 같다. 친구는 2 = 2다. 1차에서 본 것을 bb58fa0이 바꾸지 않았다(diff는 role 속성과 풀이 문단뿐) |
| 계획 때 걱정 | 통과 | 1차 표 그대로. bb58fa0이 사용자 판정의 헤맴 1(=조건 ①)과 거슬림 1(범례 "과중")을 반영했다. 막음 0 |
| 회귀 — 테스트 | 통과 | `npx vitest run --maxWorkers=2` → `Test Files 58 passed (58) / Tests 892 passed (892)`. 시작 884, B 1차 892로 줄어든 것 0이다. 이번에는 넘어진 시간 의존 테스트가 없었다. 출력: `revB2-vitest.txt` |
| 회귀 — 응답 사진 | 통과 | `snapshot.py r044/revB2-snap 8183` 다음 `snapdiff.py baseline/snap revB2-snap` → `같음 / 차이 0` |
| 회귀 — lint / tsc | 통과 | warning 22개로 시작과 같다(`revB2-lint.txt`). error 0. `npx tsc -b` exit 0 |
| 격리 · 마이그레이션 · 입력 한도 · 비밀 | 해당 없음 | 새 엔드포인트·테이블·입력·키가 없다. backend diff 0 |
| 호환 — API 모양 | 통과 | `apidiff.py baseline/openapi.json revB2-openapi.json` → `빠짐 0 / 타입 바뀜 0 / 더해짐 3`. 셋 모두 A의 것(`GET /api/admin/records`, `value_record`, `ValueRecordOut`)이다 |
| 호환 — 새 화면 ↔ 옛 서버 / 옛 화면 ↔ 새 서버 | 통과 / 해당 없음 | bb58fa0은 새 필드를 읽지 않는다. 화면 글만 더했다 |
| 뮤테이션 — 실행자 결과 | 통과 | `B-mutation.md` 13/13. 1차 검토가 R1~R5로 다시 확인했다. bb58fa0의 새 줄은 실행자 표에 없다 |
| 뮤테이션 — 직접 | **실패 (2/4 살아남음)** | `revB2-mut/mut.py`로 돌렸다. 고친 뒤 되돌리고 내용이 같은지 assert한다. 명령은 `npx vitest run --maxWorkers=2 src/pages src/components src/lib`. M1 `role="img"` 빼기 → 잡힘(1 failed). M2 풀이 줄에서 관망 문장 빼기 → 잡힘(1 failed). **M3 범례를 "과중·미달"로 → 살아남음(816 passed)**. **M4 `hidden={narrow}`로 폰에서 풀이 줄 숨기기 → 살아남음(816 passed)**. 뒤의 `git status`는 깨끗했다. 결과: `revB2-mut/out.md` |
| 규제 | 통과 | 새 글(풀이 줄, 범례, 문서)에 "추천·사세요·팔라·저평가·예측"이 0건이다. 풀이는 상태를 말한다("벗어났는지를 말합니다") |
| 데이터 경계 · 외부 호출 · 가짜 서버 | 해당 없음 | 서버를 바꾸지 않았다. 데모 owner·friend에 관망과 비중 초과·미달이 있다 |
| 화면 — 자동 검사 | 통과 | `revB2-ui/ui.js`(포트 8182, 빌드 뒤)로 10가지를 봤다: owner·friend 360 × 두 테마, owner PC 1400 × 두 테마 × 두 보기, new·pending 360. 모든 경우 가로 넘침 0, 콘솔 오류 0, 금지 말 0이다. new·pending에서는 "시그널" 단추와 `.signal-key`가 없어 새어 보이지 않는다(`homeKey=false`, `key=null`). 결과: `revB2-ui/result.json`. 참고: PC의 "표/카드" 단추를 정확한 이름으로 찾지 못해 두 경우가 같은 기본 보기였을 수 있다. 풀이 줄이 목록 밖에 있는 것은 코드(`Dashboard.tsx:1021`)로 확인했다 |
| 화면 — 읽어 주는 이름 / 키보드 | 통과 (참고 2) | 신호 칸의 "—"는 `image:관망 — 매수·매도 조건 미충족`이다. 풀이 줄은 보통 글이라 Tab 없이도 읽기 모드로 읽힌다 |
| 성능 | 통과 | 첫 화면 JS(`index-*.js`)는 111.04(시작) → 111.10(B 1차) → **111.20 kB gzip**이다. 시작 대비 +0.16, bb58fa0 몫은 +0.10이다. 한글 문단 하나(raw +490 B)를 더한 것이라 이유가 있다. `revB2-build.txt` |
| 문서 | 통과 (참고 1·3) | 조건 ③은 풀렸다. 용어집 기호 줄은 조금 낡았다(참고 3) |

## 참고 (막지 않음)

1. `ROADMAP.md:2040`의 "(0.44.0 까지 '매수 검토 · 매도 검토')"는 거꾸로 읽힌다. 옛 말을 쓴 것은 0.43까지이고 0.44.0부터 바뀌었다. "0.43 까지"가 맞다.
2. 풀이 줄 안의 "—"는 `aria-hidden`이다. 그래서 읽기 기기에는 "흐린 · 는 관망(…)"으로 들린다(AX: `StaticText: 줄은 지표로 본 매수·매도이고, 흐린 ` / `StaticText:는 관망…`). 뜻은 통하지만 어색하다. `aria-hidden`을 빼거나 눈에 안 보이는 "줄표"를 넣는 쪽이 낫다.
3. `docs/design/glossary.md:39`의 흐린 `—` 줄은 아직 "풀이는 툴팁·읽어 주는 이름"이다. 이제 화면 글(시그널 보기 아래 한 줄)도 풀이 자리다.
4. 풀이 줄은 목록 **맨 아래**에 있다. owner 360에서는 문서 높이 8641px 가운데 8246px에서 시작한다. 15장의 카드를 다 내려야 나온다. 사용자 판정의 "표 맨 아래 작은 글씨"와 같은 자리다. 친구(4종목, 2652/3048)는 괜찮다. 다음 사용자 검토에서 볼 만하다.
5. "—"의 뜻이 바로 아래 문단과 부딪친다. 풀이 줄 바로 아래 문단 `…거래량 > 1.1) — 네 조건을 모두…`와 홈 범례 `— 누르면 시그널 보기`가 "—"를 이음표로 쓴다. 풀이 줄이 "흐린 —는 관망"이라고 정해 둔 바로 다음이다. 흐린 색으로 구별은 되지만, 사용자 판정 거슬림 2가 그대로 남았다.
6. 1차 참고("비중 비중 초과" 겹침, 리밸런싱 차이 "과중 +x%p", 정기 리뷰 툴팁 사라짐)는 그대로다.

## 만든 것 (모두 저장소 밖)

- 판정문: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r044/B-review2.md`
- 테스트·lint·빌드: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r044/revB2-vitest.txt`, `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r044/revB2-lint.txt`, `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r044/revB2-build.txt`
- 응답 사진·API: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r044/revB2-snap/`, `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r044/revB2-openapi.json`
- 뮤테이션: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r044/revB2-mut/` (`mut.py`, `muts.json`, `out.md`)
- 화면: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r044/revB2-ui/` (`ui.js`, `result.json`, 전체·홈·풀이 줄 그림)
- 가짜 서버: 포트 8182, 데이터 `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r044/revB2-data`, PID 21982. `kill`로 껐고, 끈 뒤 health는 `000`이다. 응답 사진용 서버(포트 8183)는 snapshot.py가 직접 띄우고 껐다

## worktree `git status`

```
HEAD detached at bb58fa0
nothing to commit, working tree clean
```
