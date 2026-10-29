# 0.45.4 끝 검토 — 라운드 전체 회귀·호환

**판정: 조건부 합격**

- 범위: 라운드 시작 `500a540` → 끝 `f1e4fd1`(커밋 16개). 앞 판정문은 믿지 않고 직접 다시 쟀다.
- 돌린 곳: 내 worktree `scratchpad/r049/final/wt`(f1e4fd1, detached). 비교용 `scratchpad/r049/final/base`(500a540)도 만들었다. node_modules 는 본 트리 것을 심볼릭 링크로 썼다.
- 화면: 두 worktree 에서 각각 `npm run build` 했다.
- 가짜 서버는 PID 로 띄우고 PID 로 껐다. 쓴 포트와 버전:
  - 8193: 새 서버 + 새 화면
  - 8197: 옛 서버 + 새 화면, 다음에 옛 서버 + 옛 화면
  - 8198: 새 서버 + 옛 화면
  - 8196: 옛 응답 사진
- 증거 폴더: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r049/final/`
  - 결과 파일: pytest.txt · vitest.txt · lint.txt · build.txt · openapi.json · snap/ · snap-base/ · mut-out.md · mut-out2.md
  - 그림: shots/ · shots-old/ · shots-mix/
  - 스크립트: ui.js · pop.js · save.js · oldla.js · ml.js · kbd.js

## 조건부 목록 (합치기 전에 닫는다)

1. **직접 뮤테이션에서 4개가 살아남았다**(RULES §3 "살아남은 것 0"). 동작이 틀린 곳은 없다. 시험이 못 박지 않은 곳이다.
   - F5 `schemas.py` `ORDER_MAX = 500` → `50`: **살아남음**
     - `test_input_limits.py:34-47` 은 40개와 `ORDER_MAX + 1` 만 본다.
     - 계획이 500 으로 정한 까닭은 "한도에서 빠지는 주인"이다. 그런데 51개 이상인 주인이 깨져도 시험이 잡지 못한다.
   - F8 `NAME_MAX = 200` → `100`, F9 `TICKER_MAX = 64` → `16`: **살아남음**
     - 시험이 `schemas.NAME_MAX` 를 그대로 기호로 쓴다(`test_input_limits.py:12-21`). 숫자를 줄여도 시험이 따라 줄어든다.
     - 계획 "넉넉하게 잡는다(name 200 — 화면이 늘 다시 보낸다)"는 호환을 위한 결정이다. 시험으로 묶여 있지 않다.
   - F6 중립 틀 6절에서 "이 종목 자신은 빼고, " 를 지움: **살아남음**
     - `test_ai_owner.py` 는 6절 제목만 본다(`:239`).
     - 다시 보기에서 "반영(지시문)"으로 답한 줄이지만, 시험이 지키지 않는다.
   - 고칠 것은 시험뿐이고 코드는 그대로 둔다.
     - 글자 그대로의 값을 시험에 넣는다. 예: 이름 200자는 200, 201자는 422 / 순서 500개는 200, 501개는 422 / 티커 64자는 200.
     - 또는 `assert schemas.ORDER_MAX >= 500` 꼴로 하한을 못 박는다.
     - `USER_RESEARCH_PROMPT` 에 "이 종목 자신은 빼고"가 있는지 본다.

**참고**(조건 아님)
- **새 화면 ↔ 옛 서버의 모든 기기에서 나가기**(아래 호환 3)
  - 옛 0.45.3 서버는 dist 가 있으면 SPA 폴백 때문에 `POST /api/auth/logout-all` 에 **405** 를 준다. dist 가 없으면 404 를 준다.
  - 그때 확인 창에 영어 원문 "Method Not Allowed" 가 그대로 뜬다(`shots/old-server-logoutall.png`).
  - 그래도 로그인은 그대로이고, AI 키도 지우지 않는다. `logoutAll()` 이 먼저 던지기 때문이다(`AuthGate.tsx:233-239`). 이 기기 정리는 일어나지 않는다. 깨지지는 않는다.
  - 이 조합은 이미지를 되돌렸는데 폰에 새 화면이 캐시돼 있을 때만 생긴다.
  - 404·405 를 "이 서버에는 아직 없는 기능입니다"로 바꾸는 것은 다음 후보로 둔다.
- F7(`AppHeader.tsx:116` 에서 `mode === 'google' &&` 를 지움)도 살아남았다. 다만 **등가**다. 서버가 `user` 를 구글 모드에서만 보내므로(`routers/auth.py:185-192`) 비밀번호 모드에서는 `!!user` 가 늘 거짓이다. 조건에 넣지 않았다.
- `status.md:24` 는 아직 "가짜 서버 주인 TSLA 8주"라고 적고, 항목 B·C 도 `[~]` 다. 지금은 60주다(`fake_server.py:103`). 끝낼 때 총괄이 고친다.
- CI 두 갈래가 초록인지는 바깥 인터넷이 없어 볼 수 없다. 총괄이 PR 에서 본다.

## 숫자 표 (시작 → 끝)

| 잰 것 | 시작(500a540) | 끝(f1e4fd1) | 판정 |
| --- | --- | --- | --- |
| pytest | 1489 통과 · 3 실패(주말) · 3 건너뜀 | **1531 통과 · 0 실패** · 3 건너뜀 | 통과(+42, 실패 0) |
| vitest | 1030 (62 파일) | **1049** (63 파일) | 통과(+19) |
| lint 경고 | 22 | **22** | 통과 |
| tsc | 통과 | 통과(`npx tsc -b` 0, 빌드 안 tsc 도 0) | 통과 |
| 첫 화면 JS gzip | 113.92 kB (`index-CAcrLVmD.js`, base 다시 빌드해도 같음) | **114.37 kB** (`index-ySK8FMwi.js`) | 통과(+0.45 kB: 이름 단추·확인 창·경고) |
| 대시보드 20종목 | 36.8 ms · 쿼리 12 (10-24 기준 파일) | 오늘 같은 기계에서 번갈아 두 번: base 42.0/41.4 ms, 끝 41.2/41.6 ms · **쿼리 12** | 통과(같은 기계에서 차이 없음. 36.8 과의 차이는 기계 흔들림) |
| API 모양 | — | 빠짐 **0** · 더해짐 1(`POST /api/auth/logout-all`) · 요청 쪽 한도 6칸(maxLength·maxProperties) | 통과 |
| 응답 사진(같은 날 base vs 끝) | — | 차이 48, 모두 `owner-api_rebalance_current` 의 TSLA 0→60주와 그 몫(합계·비중) | 통과(의도한 것만) |
| Alembic 머리 | 0015 | **0015** | 통과 |

## A·B·C 조건부가 닫혔는지

| 조건 | 판정 | 증거 |
| --- | --- | --- |
| A1 Policy.test 시행일 | 닫힘 | `Policy.test.tsx:60` 은 `'시행일 2026-10-24'` 다. vitest 1049 모두 통과 |
| A2 허용 목록 한 단계 아래 | 닫힘 | `test_policy_page.py:131-165`: `review` 는 정확한 집합, `top` 은 부분집합이고 값이 float, `thresholds` 는 필드 집합. 실행자 뮤테이션 "진단 review 에 칸 더함" 잡힘 |
| A3 정리 칸 분류 | 닫힘 | `Policy.tsx:84` "…그 종목들의 이름·티커와 내가 붙인 분류, 공용 데이터…" |
| A4 금액 가리기 | 닫힘 | `Policy.tsx:116` "화면 테마(밝게·어둡게)·상승 색·금액 가리기, …" |
| A5 B·C 를 앞서 적은 줄 | 닫힘 | 방침 112줄과 용어집 세 줄이 실제 화면과 같다. 아래 브라우저 확인(메뉴·확인 창·풀이 글) |
| B1 409 바꿈은 '이미 있음'에만 | 닫힘 | `StockManager.tsx:323` `status === 409 && !e.hint && /already exists/`. 시험 `StockManager.test.tsx:786-797`(30개 한도 안내 그대로) |
| B2 이 기기 정리 시험 | 닫힘 | `AuthGate.logoutAll.test.tsx:31-51`(forgetPushDevice 한 번, local·session 의 `signalboard:ai-key` 지워짐). 실행자 뮤테이션 "이 기기 AI 키 안 지움" 잡힘 |
| B3 B-mutation.md | 닫힘 | 파일 있음, 15줄 |
| B4 정적 파일 헤더 | 닫힘 | `test_security_headers.py:74-76` 에 `/assets/a.js`·`/manifest.webmanifest`·`/assets/none.js` 404 |
| C1 데모에 풀이가 보임 | 닫힘 | `fake_server.py:103` TSLA 60주. `test_devtools.py:183-185` 는 목표 0% 보유가 0.5% 를 넘는지 본다. 브라우저 주인 1400·390·360 × 두 테마에 `rebal-note=1`, 지인은 0. 360 카드: "TSLA 60주 팔기 … 목표 0%라 전부 파는 계산입니다 · 목표는 아래 '보유 · 목표 비중'에서 정합니다"(`shots/note-owner-360.png`) |
| C2 경고가 다음 추가에 사라지지 않음 | 닫힘 | `StockManager.tsx:293-298`: 경고를 띄우는 추가에서만 바꾼다. 시험 `StockManager.test.tsx:812` |

## §3 표

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 완료 조건 | 통과 | 위 A·B·C 표. 더해서 직접 확인한 것은 아래 다섯 줄 |
| | | `/docs`·`/redoc`·`/openapi.json` → 200 `text/html`(SPA, 스키마 아님). `/api/openapi.json` → 401 JSON |
| | | 1.1 MB 본문 → 413 |
| | | http 에는 HSTS 가 없다 |
| | | 헤더: `nosniff`, `referrer-policy: same-origin`, `x-frame-options: DENY`, CSP `script-src 'self' 'sha256-…'` |
| | | 중립 틀(`USER_RESEARCH_PROMPT`)에 계획 패턴(`편입·사이징·알파·alpha·core·hedge·버킷·적합·동일비중·익스포저·초과수익·하방`)과 추천·사세요·팔라·목표가 grep 결과 0 |
| 계획 때 걱정 | 통과 | 아래 일곱 줄. 막음 0(`plan-review.md:3`, `plan-recheck-review.md:3`) |
| | | Referrer `same-origin`, HSTS `max-age=2592000`, 413 본문 hint·message |
| | | logout-all: 구글 아님 400, 대기 401 — `test_logout_all.py` 가 pytest 에서 통과 |
| | | 확인 창 문구가 다시 보기의 글과 글자 그대로 같다(`oldla.js` 출력) |
| | | PC 이름 단추 ▾: Tab 3번에 닿고, Enter 로 메뉴가 열리고, Esc 뒤 초점이 단추로 돌아온다(`kbd.js`) |
| | | 폰 메뉴 순서: 나가기 → 모든 기기에서 나가기 → 탈퇴(`AppHeader.phone.test.tsx:103`) |
| | | 360 첫 화면 요약 카드 `.money-line` 이 base·끝 모두 주인·지인 `[168,422]` 로 같다. TSLA 60주라 풀이가 생긴 뒤에도 같다(`ml.js`) |
| | | 6절 "이 종목 자신은 빼고"는 지시문에 있다. 다만 시험에 없다 → 조건 1 |
| 회귀 | 통과 | 위 숫자 표 |
| | | 응답 사진은 10-24 기준과 바로 견주면 날짜가 지나 시세가 달라진다(차이 761). 그래서 오늘 base(500a540)로 다시 찍어 같은 날끼리 견주었다 |
| | | 같은 날끼리의 차이 48 은 모두 주인 rebalance rows[7] = TSLA(수량 0→60, 목표 0 그대로)와 그 몫(합계·다른 줄 비중)이다. 지인 사진과 주인 dashboard·fundamentals·macro·history 는 차이 0 |
| 격리 | 통과 | `test_isolation.py` 에 logout-all 이 있다(grep). F4(남의 알림 기기까지 지움) 잡힘 |
| 마이그레이션 | 해당 없음 | `backend/migrations`·models diff 0, `alembic heads` → `0015 (head)` |
| 호환 | 통과(참고 1) | 아래 세 줄 |
| | | ① API: 빠진 경로·필드 0. 바뀐 타입 6 은 모두 요청 스키마에 한도를 더한 것(`SettingsUpdate.cash/fx_overrides`, `StockCreate/StockUpdate.name/category`) |
| | | ② 옛 화면 ↔ 새 서버(8198, 500a540 빌드를 새 서버에 얹음): 1400·390·360 × 주인·지인 6판에서 CSP 위반 0, 콘솔 오류 0, 가로 넘침 0. 폰 팝업 차트 4판 canvas 7 · 뒤로가기로 닫힘. 새 서버가 옛 index.html 의 테마 스크립트 해시를 같게 쟀다 |
| | | ③ 새 화면 ↔ 옛 서버(8197): 6쪽과 팝업에서 오류 0. 모든 기기에서 나가기만 405 "Method Not Allowed" 가 창에 뜨고 로그인은 남는다 → 참고 |
| 입력 한도 | 통과 | pytest `test_input_limits.py` 통과. 직접 1.1 MB → 413. 숫자를 못 박지 않은 것은 조건 1 |
| 뮤테이션 | **실패 → 조건 1** | 실행자: A 10/10, B 15/15, C 10/10(문서). 직접 10줄: 잡힘 6(F1 HSTS 1년 · F2 Referrer 넓힘 · F3 본문 10MB · F4 남의 구독 지움 · F10 CSP 스위치 이름), 살아남음 4(F5·F6·F8·F9), 등가 1(F7) |
| | | 처음 돌림에서 F6 은 없는 시험 파일 탓에 "잡힘"으로 잘못 나왔다. 올바른 파일로 다시 돌려 살아남음을 확인했다(`mut-out2.md`) |
| | | 매번 원래대로 돌려놓았다. 끝에 `git status` 깨끗 |
| 비밀 | 해당 없음 | 이번 diff 에 키가 지나는 길이 바뀐 곳이 없다(`ai_portfolio.py` 는 지시문·문맥만). B 검토의 SENTINEL 0 이후 그 길은 그대로다 |
| 규제 | 통과 | 아래 세 줄 |
| | | diff(+줄, 시험 제외)에서 추천·사세요·팔라·저평가·예측·수익률·목표가 grep 결과는 모두 금지 문장("판단하지 않습니다", "내지 않습니다")이나 사실 설명(방침 "수익률은 보내지 않습니다", 지표 "배당수익률")이다 |
| | | 주인 틀 `RESEARCH_PROMPT` 의 지워진 줄은 주석 2줄뿐이다(바이트 그대로). C 풀이 "전부 파는 계산입니다"는 계산 설명이고 권유가 아니다 |
| | | ROADMAP 3절에 "주인의 전략 틀은 주인에게만"이 더해졌다 — 주인 결정 "지인엔 중립 틀" 그대로 |
| 데이터 경계 | 해당 없음 | 새 표·칸 0 |
| 외부 호출 | 통과 | 사람 수만큼 늘어나는 새 호출 없음. logout-all 은 DB 만 쓴다 |
| 화면 | 통과 | 아래 네 줄 |
| | | 8193 빌드한 화면 1400·390·360 × 밝게·어둡게 × 주인·지인 12판: 홈·팝업·/rebalance·/history·/macro·/fundamentals·/stocks·/policy·메뉴·확인 창 모두 CSP 위반 0, 콘솔 오류 0, 가로 넘침 0(`ui.js` TOTAL 0) |
| | | 폰 팝업 차트 8판 canvas 7, 오류 0, 뒤로가기로 닫힘(`pop.js` BAD 0) |
| | | 폰 저장 막대 한 번 누름: 지인 360×640 SCHD 40→41 저장, 주인 390×844 VOO 18→19 저장(다시 열어 확인, `save.js`) |
| | | 키보드: PC 이름 단추 Tab·Enter·Esc |
| 말 | 통과 | 용어집 세 줄(`glossary.md:40-42`)이 화면 문구와 같다. "모든 기기에서 나가기"는 메뉴·확인 창, 풀이 글은 360·1400 카드 |
| 성능 | 통과 | 위 표 |
| 가짜 서버 | 통과 | `test_devtools.py` 가 전체 pytest 에서 통과. 데모에 목표 0% 팔기가 보인다(C1) |
| 문서 | 통과 | 아래 일곱 줄 |
| | | `version.py:150` `APP_VERSION = "0.45.4"`, 147-149 줄 기록 |
| | | README 129-135 v0.45.4 줄이 실제와 맞다. 스위치, `/api/openapi.json` 로그인 뒤, 이름 200·구분 60, 1MB, fastapi 0.120.4·starlette 0.49.3(`requirements.txt:1-4`) |
| | | ROADMAP: 0-1 주인 확인 줄(CSP 끄기·메뉴 보이는지)과 "점검에서" 후보, 11-8 표·계획과 달라진 것, 3절·9-8·9-15 보탬 |
| | | DEPLOY 9-5: 스위치, HSTS 30일, `/docs` 닫힘, 1MB, 모든 기기에서 나가기 — 실측과 맞다 |
| | | `.env.example` 에 `# SIGNAL_DASHBOARD_CSP=off` |
| | | `docker-compose.yml` 에 `SIGNAL_DASHBOARD_CSP: ${SIGNAL_DASHBOARD_CSP:-}`. F10(스위치 이름 바꿈) 잡힘 |
| | | 남은 것: status.md 의 "TSLA 8주"는 낡았다(참고) |

## 작업 트리

```
$ cd …/scratchpad/r049/final/wt && git status
Not currently on any branch.
nothing to commit, working tree clean
```
- 그 뒤 내 worktree 둘(`final/wt`, `final/base`)은 `git worktree remove` 로 지웠다.
- 본 트리 `/home/user/Dashboard` 에서 `git status --short` 를 돌렸을 때 이 파일을 쓰기 전에는 빈 출력이었다. 지금은 이 파일 `final-review.md` 하나만 커밋하지 않은 채 남아 있다.
- 가짜 서버 8193·8196·8197·8198 은 모두 PID 로 껐다(`ps -p` 빈 출력).
