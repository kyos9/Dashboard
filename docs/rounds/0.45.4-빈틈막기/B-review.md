# 0.45.4 B 웹 보안 기본값: 검토자 판정

**판정: 조건부 합격**

- 검토 범위: 라운드 시작 500a540, B 커밋 eeff03f·6489152·4479479(사용자 확인 고침). 검토한 끝은 4479479다. c5ab510(A)·ee38abc(C)는 다른 항목이라 겹치는 곳만 봤다.
- 돌린 곳: 내 worktree `…/scratchpad/r049/wt-revB`(detached HEAD, 6489152 다음 4479479). 가짜 서버는 포트 8191에 띄웠고 PID로 껐다.
- 기준: `…/scratchpad/r049/baseline/`(openapi.json, snap/).

## 조건부 목록 (합치기 전에 닫는다)

1. **(고쳐야 함, 4479479에서 생긴 회귀) 종목 30개 한도 안내가 "이미 담은 종목"으로 바뀌어 보인다**
   - `StockManager.tsx` catch(4479479)는 **모든 409**를 `${query}은(는) 이미 담은 종목입니다`로 바꾼다.
   - 그런데 서버는 종목 30개 한도에도 409를 준다. `routers/stocks.py:160-169`의 hint는 "종목은 30개까지 담을 수 있습니다 … 삭제하고 다시 추가해 주세요"다.
   - 그래서 한도에 닿은 지인이 새 종목을 넣으면 **틀린 말**("NEWONE은(는) 이미 담은 종목입니다")을 본다. 바르던 한국어 안내는 사라진다.
   - 재현: 임시 vitest에서 `createStock`이 `ApiError(409, '종목은 30개까지…', 'stock limit reached')`를 던지게 했다. 결과는 `Unable to find /30개까지/`였고, 화면에는 "NEWONE은(는) 이미 담은 종목입니다. 아래 목록에서 찾아 고치세요."가 나왔다. 임시 시험은 지웠다.
   - 고칠 것: 서버가 hint를 주지 않는 409(`detail`이 `… already exists`)에만 바꾼다. 한도 409 시험을 하나 둔다.
2. **(고쳐야 함) "이 기기 정리" 시험이 없다. 뮤테이션 R18이 살아남는다**
   - 계획은 "이 기기에서는 나가기와 같은 정리(알림 끄기·AI 키·글 지우기)"라고 했다.
   - 그런데 `AuthGate.tsx` `logoutEverywhere`에서 `clearAi()`를 지워도 `npx vitest run src/components`가 통과한다.
   - 브라우저로는 실제로 지워짐을 확인했다. `signalboard:ai-key`를 넣고 폰 390에서 모든 기기에서 나가기를 누르자 localStorage가 비었다. 남은 것은 시험이다.
   - `forgetPushDevice` 호출과 `clearAi`를 보는 화면 시험 하나가 필요하다.
3. **(고쳐야 함) `B-mutation.md`가 없다**
   - RULES §2-3과 §3 "실행자 결과 확인"에 걸린다. 라운드 폴더에 A·C 판정문은 있는데 B 뮤테이션 기록은 없다.
   - 아래 내 표를 넘겨도 된다. 그래도 실행자 기록이 있어야 한다.
4. **(고쳐야 함, 작음) 헤더 시험에 "정적 파일" 칸이 없다**
   - 완료 조건은 "페이지·API·정적·401·404·413"이다.
   - `test_security_headers.py:73`의 parametrize는 `/api/ok`·`/api/locked`·`/api/nope`·`/`·`/history`뿐이다. 작은 앱의 dist에 assets 파일이 없다.
   - 실측으로는 붙는다. `/assets/index-*.js` 200 → 다섯 헤더 모두 있음, `/manifest.webmanifest`도 같다. 다만 시험으로 고정되어 있지 않다.

**참고**(조건 아님)
- R2(CRLF 정규화 줄 삭제)가 살아남는다. `Path.read_text`가 universal newline으로 이미 `\r\n`→`\n`을 바꾸기 때문이다. 동작은 맞다(등가 뮤턴트). 다만 CRLF 시험은 그 줄이 아니라 `read_text`를 지키고 있다는 점은 적어 둔다.
- R6(Content-Length 선검사 삭제)도 등가다. 읽으며 세기가 같은 413을 낸다. R11(엔드포인트의 상태 검사)도 등가로, 문지기가 먼저 401을 낸다. R19(`!pending`)도 등가로, `guest`가 대기를 포함한다(`AuthGate.tsx:264`).
- 4479479 "추가" 단추 고침은 반쯤이다. 성공한 뒤에도 검색칸에는 "QQQ"가 남고 `form.ticker`만 비워진다(임시 시험에서 `value` ≠ '' 확인).
  - 그 상태에서 "추가"를 한 번 더 누르면 다시 "입력해주세요"가 난다. Enter 길도 전부터 같다.
- PC "나가기" 단추의 새 풀이(4479479)는 `title`이라 마우스를 올려야만 보인다. 사용자 판정의 "나가기부터 누른다"를 막지는 못한다. 디자인 후보로 남긴다.
- 422 응답은 pydantic 기본대로 `input`(예: 257자 비밀번호)을 그 요청자에게 되돌린다. 전부터 그랬다. 로그·DB에는 남지 않았다(SENTINEL grep 0).
- 용어집 41줄 "다른 기기의 로그인·알림이 다 꺼진다"는 맞다. 다만 이 기기도 나간다는 말은 없다. 확인 창에는 있다.
- 다시 보기 검토자 제안 "비밀번호 모드 로그인 전이면 401" 시험은 더해지지 않았다. 문지기가 401을 내므로 동작은 맞다.

## 앞 판정 조건부 넘어온 것 (A-review 조건 5)

**닫힘.**
- `Policy.tsx:112`(c5ab510): "모든 기기에서 나가기를 누르면 다른 기기에 남은 로그인 쿠키도 그 자리에서 무효가 되고, 모든 기기의 알림이 꺼집니다."
  - 실제 동작이 그렇다. 쪽지가 둘(같은 계정 두 세션)인 상태에서 logout-all을 하자 두 세션 모두 `/api/stocks` 401이 됐다. 주인은 200 그대로였다. 서버는 그 사람의 `PushSubscription`을 모두 지운다(`routers/auth.py` logout_everywhere).
- 용어집 41줄 "폰 계정 메뉴의 나가기 아래, PC 는 이름 단추(▾) 안"도 화면과 맞다. 폰 ⋯ 메뉴 순서는 나가기 → 모든 기기에서 나가기 → 탈퇴(빨강)다(`menu-friend-360-d.png`). PC는 `friend ▾` 단추 안이다(`menu-owner-1400-d.png`).

## §3 표

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 완료 조건 | 통과(조건 4 제외) | 아래 "완료 조건 하나씩" |
| 계획 때 걱정 | 통과 | 아래 "계획 반영" — 막음 0. B의 "반영" 14건이 코드에 있다 |
| 회귀 | **실패 → 조건 1** | 아래 "회귀" |
| 격리 | 통과 | 아래 "격리" |
| 마이그레이션 | 해당 없음 | 새 리비전·테이블·칸 0 |
| 호환 | 통과 | 아래 "호환" |
| 입력 한도 | 통과 | 아래 "입력 한도" |
| 뮤테이션 | **실패 → 조건 2·3** | 아래 표. 20개 중 15 잡힘, 5 생존(R18 진짜 생존, 4 등가) |
| 비밀 | 통과 | 아래 "비밀" |
| 규제 | 통과 | `git diff 1ca56d9 6489152 -- frontend/src backend/app \| grep "^+" \| grep -c "추천\|사세요\|팔라\|저평가\|예측"` → 0. 4479479의 새 글도 0 |
| 데이터 경계 | 해당 없음 | 새 표 없음. logout-all은 자기 `users.session_epoch`·`push_subscriptions`만 쓴다 |
| 외부 호출 | 통과 | 새 외부 호출 0 |
| 화면 | 통과 | 아래 "화면" |
| 말 | 통과(참고 하나) | 용어집 41줄·방침 4절·DEPLOY 9-5·확인 창이 맞다. 4479479 새 말 "이미 담은 종목입니다"는 조건 1에서 틀린 곳에도 나온다 |
| 성능 | 통과 | 대시보드 20종목 중앙값 36.8 → 39.8 ms, 쿼리 12 → 12(같음). 미들웨어 둘과 요청마다 index.html stat 한 번 몫이며 흔들림 범위다. 첫 화면 JS gzip 113.92 → 114.38 kB(+0.46, 이름 단추·확인 창·C 몫 포함) |
| 가짜 서버 | 통과 | 로그인 흉내 페이지(`/api/dev/google-login`)에도 헤더가 붙는다. 그 아래에서 CSP 위반 0. `test_devtools.py`는 전체 pytest 안에서 통과 |
| 문서 | 통과 | 아래 "문서" |

### 회귀
- **pytest**: 6489152에서 `1528 passed, 3 skipped`, 4479479에서 `1528 passed, 3 skipped`.
  - 시작 기준(`baseline/pytest.txt`)은 `3 failed, 1489 passed, 3 skipped`였다. 주말 실패는 8da60e0에서 고쳐졌다. 줄어든 시험은 0이다.
- **vitest**: 6489152에서 `1 failed | 1033 passed`였다. 그 하나는 A 조건 1인 `Policy.test.tsx` 시행일이다. c5ab510의 두 파일을 넣고 돌리면 `8 passed`라 B 몫이 아니다.
  - 4479479에서는 **`1043 passed (1043)`**이다. 시작 1030보다 줄지 않았다.
- **lint·tsc**: lint 경고는 22개로 시작과 같다. `npx tsc -b`는 통과한다.
- **응답 사진**: 6489152 가짜 서버(같은 날)에서 주인·친구 × 5 경로를 다시 떴다. `snapdiff.py baseline/snap revB-snap` → **차이 0**.
  - 4479479는 B 서버 코드가 같아 다시 뜨지 않았다. 바뀐 것은 fake_server 3줄(C)과 시험뿐이다(`git diff --stat 6489152 4479479 -- backend`). 날짜도 바뀌었다.
- **화면 회귀는 조건 1이다.** 30개 한도 409 안내가 틀린 말로 바뀐다.

### 격리
- `test_isolation.py:87` 표에 `("POST", "/api/auth/logout-all"): (MINE, USER)`가 있다.
- `check_logout_all`이 본다:
  - **진짜 쪽지**로, 구글 모드에서
  - B의 두 기기 쪽지가 401이 된다
  - B의 알림 기기는 0개가 된다
  - A의 쪽지는 200, A의 epoch와 알림 기기 수는 그대로다
  - `Max-Age=0` 쿠키가 온다
- 가짜 서버 실측:
  - pending은 401, 손님은 401
  - friend 두 세션이 200·200 → logout-all 200 → 두 세션 401·401, owner는 200
  - 다시 로그인하면 200
- PUBLIC_PATHS에 없다(`routers/auth.py:43-52`).

### 호환
- `apidiff.py baseline/openapi.json revB-openapi.json`의 결과:
  - **빠짐 0**, 더해짐 1(`POST /api/auth/logout-all`)
  - "타입 바뀜" 6은 모두 요청 스키마에 `maxLength`·`maxProperties`·`propertyNames`를 더한 것이다(StockCreate/Update.name·category, SettingsUpdate.cash·fx_overrides). 응답 필드는 바뀌지 않았다.
- `/openapi.json` 경로 이동은 스키마 밖이다. 저장소 안에 부르는 곳이 없다: `grep -rn "openapi.json\|/redoc"`의 결과는 main.py·시험·DEPLOY·감사 문서뿐이다.

### 입력 한도
가짜 서버 8191에서 쟀다.
- `ticker` 64자 → 400(해석 실패, 한도는 통과). 65자 → 422(`string_too_long`). 길이 없이(chunked) 보내도 422다.
- 순서 목록: 주인 15개 → 200, 501개 → 422. `test_input_limits.py:30`이 주인 40개 순서 저장 200을 본다(뮤테이션 R13 ORDER_MAX=30에서 잡힘).
- `cash` 열쇠 9자 → 422.
- 옛 긴 값(500자 이름) 읽기 → 그대로다(`test_input_limits.py:21`).
- 본문 1MB+1(Content-Length 있음) → 413이고 본문은 `{"detail":{"hint":"보낸 내용이 너무 큽니다…","message":"request body too large"}}`다. 헤더 5개가 붙는다.
- chunked 1.1MB → 413. 로그인 없이 2MB → 413(헤더 붙음, 문지기보다 먼저).
- 요청 스키마를 다 훑었다(중첩 포함). 글자 칸 중 한도가 없는 것은 `AiAnalyzeIn.question`(서비스 `QUESTION_MAX`가 본다)과 `KindsIn.kinds/slots/muted[]`의 원소뿐이다. 이 원소들은 개수 한도가 있고 값은 알려진 집합·내 종목과 대조한다(`routers/push.py:40-43,111`).

### 비밀
- 가짜 서버에 `SENTINEL-…` 비밀번호를 보냈다. 300자는 422, 1.1MB는 413이 났다.
- 그 뒤 `grep -rl SENTINEL revB-fake.log revB-data` → 0이다.
- logout-all은 키를 받지 않는다.

### 화면 (빌드한 화면, 4479479 다시 빌드 뒤 한 번 더)
- **CSP 위반**: 주인·친구 × 1400·390·360 × 라이트·다크, 12조합.
  - 거친 단계: 로그인 흉내 → 대시보드 → 팝업 차트(SCHD) → 리밸런싱·차트(PC)·매크로·재무 → 알림 창·AI 키 창(PC) → 모든 기기에서 나가기 메뉴·확인 창·취소.
  - 서비스 워커 등록은 1이다.
  - `securitypolicyviolation` 이벤트 0, 콘솔 "Refused/Content Security Policy" 0, pageerror 0이다. 6489152와 4479479 두 번 모두 **TOTAL 0**이다.
- **키보드**(PC 1400 friend):
  - Tab 순서는 알림 → AI → `friend — 계정` → 나가기 → 탈퇴 → 화면이다.
  - Enter를 누르면 `aria-expanded=true`가 되고 초점이 "모든 기기에서 나가기"로 간다. Esc를 누르면 초점이 이름 단추로 돌아온다.
- 이름 단추의 높이는 32px이다. 옆 나가기·AI 단추가 33px이라 PC 머리줄과 같다. 44px 규칙은 폰 대상이고, 폰은 ⋯ 메뉴 항목이다.
- PC "나가기" title(4479479)은 `이 기기에서 나가기 — 다른 기기까지 나가려면 이름(▾)에서 "모든 기기에서 나가기"`다. 구글 모드에서만 이 글이다.
- 끝까지 해 봤다: 폰 390에서 확인 → 로그인 화면, localStorage가 비었다. 같은 계정 PC를 다시 불러오면 로그인 화면이다.

### 문서
- DEPLOY 9-5(`DEPLOY.md:383-399`)에 있는 것:
  - CSP 끄기(`.env`에 `SIGNAL_DASHBOARD_CSP=off` → `docker compose --profile https up -d`, pull 불필요)
  - HSTS 30일은 이미지를 되돌려도 남는다
  - /docs 닫힘과 /api/openapi.json
  - 1MB
  - 모든 기기에서 나가기
- `.env.example`에 스위치 설명이 있다. `docker-compose.yml`은 `SIGNAL_DASHBOARD_CSP: ${SIGNAL_DASHBOARD_CSP:-}`를 넘긴다(`test_compose_passes_the_csp_switch_to_the_app`, 뮤테이션 R20에서 잡힘).
- 방침 4절과 용어집은 위 A 조건 5에서 봤다. README·ROADMAP 11-8은 ee38abc(라운드 끝)에서 고쳤다.

## 완료 조건 하나씩

- **헤더 시험**: 있다. `test_security_headers.py:73-136`.
  - 페이지(`/`·`/history`), API 200·401·404, 413, HSTS(https만, `max-age=2592000`, includeSubDomains 없음), 스위치 off → CSP만 빠지고 넷은 남는다.
  - 정적은 실측뿐이다 → **조건 4**.
  - 실측: `X-Forwarded-Proto: https`로 `/`를 보내면 `strict-transport-security: max-age=2592000`이 오고, 그 헤더 없이 보내면 HSTS가 없다.
- **CRLF·mtime 해시**: 있다(`:96`, `:104`). 실제 빌드 해시와 원본 테마 스크립트 해시가 같은지도 본다(`:138`).
  - 실측 CSP: `script-src 'self' 'sha256-bIcLTDDQ…'`이고 `unsafe-inline`·`unsafe-eval`은 script에 없다.
- **스키마 JSON이 안 나온다**: 실측 결과다.
  - `/docs`·`/redoc`·`/openapi.json`·`/docs/oauth2-redirect` → 200 `text/html`(SPA)이고 스키마는 없다.
  - `/api/openapi.json`은 로그인 전 401, 주인 로그인 뒤 200이다(`openapi`, `info`, `paths`).
  - 시험은 `:160`이다(뮤테이션 R15·R16에서 잡힘).
- **입력 한도 경계·옛 긴 값·주인 31개 이상**: 있다(`test_input_limits.py`). 실측은 위 "입력 한도"에 있다.
- **본문 1MB, 길이 없이도 413**: 있다(`:121`, `:129`, `:173`, `:179`). 실측도 413이다.
- **logout-all**: 있다(`test_logout_all.py`).
  - 열린 PC·비밀번호 모드 → 400 `no accounts`
  - 대기·거절·차단 → 401이고 epoch는 그대로
  - 손님 → 401
  - 주인도 쓸 수 있고 알림 기기가 지워진다
  - 격리 표 `check_logout_all`(다른 기기 쪽지 무효·남의 것 그대로)
- **fastapi 0.120.4 / starlette 0.49.3 / cryptography 고정과 전체 pytest**:
  - `requirements.txt:1-3,21`(`cryptography==50.0.1`)에 고정돼 있다.
  - 실제로 깔린 판: `0.120.4 0.49.3 50.0.1`.
  - 전체 pytest는 1528 passed다.
  - `.github/dependabot.yml`은 pip·npm·actions를 한 달에 한 번 PR로 낸다.
- **docker-compose가 CSP 스위치를 넘긴다**: 넘긴다(위 "문서").
- **DEPLOY 9-5**: 있다.
- **브라우저 CSP 위반 0**: 직접 다시 쟀다. 0이다(위 "화면").

## 계획 반영 (B 관련 걱정)

| 걱정 | 반영됐나 |
| --- | --- |
| /docs 404는 못 이룸 → "스키마 JSON 없음" | 됨(`test_security_headers.py:160`, 실측) |
| starlette 따로 고정 | 됨(`requirements.txt:3`) |
| CRLF·mtime | 됨(`security_headers.py:56-62,90-104`) |
| 순서 한도 500·주인 31개 이상 | 됨 |
| 넉넉한 한도(64·200·60)·옛 긴 값 읽기 | 됨 |
| logout-all이 구독을 모두 지움·이 기기 정리 | 서버는 됨. 화면 정리는 동작하지만 시험이 없다 → 조건 2 |
| 구글 아님 400·대기/차단/손님 401·격리 표·PUBLIC_PATHS 밖 | 됨 |
| 폰 계정 메뉴 나가기 아래·PC 이름 단추(테두리+▾)·탈퇴 빨강 따로 | 됨(스크린샷) |
| HSTS 30일·DEPLOY에 되돌릴 때·CSP 끄기·Referrer same-origin | 됨 |
| 순수 ASGI 맨 바깥·413/401 헤더·413 본문 모양·500은 뺀다고 적음 | 됨(`main.py` 등록 순서 SecurityHeaders > BodyLimit > SlowRequestLog, `test_security_headers.py:79` 주석) |
| 입력 한도 대상 표·FIELD_LABEL·"개" 단위 | 됨(`client.ts:96-101,118`, `client.test.ts`) |
| 확인 문구(다시 보기: 이 기기도·잃어버린 기기의 AI 키) | 됨. 글자 그대로 `AppHeader.tsx:403-408` |
| requirements-dev 안 나눔 | 반영 안 함(이유 있음), 동의 |

## 뮤테이션 (내 worktree, 끝나면 되돌림. `git status` 깨끗)

| # | 바꾼 것 | 결과 |
| --- | --- | --- |
| R1 | HSTS 언제나 | 잡힘 |
| R2 | CRLF 정규화 줄 삭제 | 생존(등가 — `read_text`가 이미 바꾼다) |
| R3 | mtime 안 봄 | 잡힘 |
| R4 | 길이 없이 오면 안 셈 | 잡힘 |
| R5 | CSP 스위치 무시 | 잡힘 |
| R6 | Content-Length 선검사 삭제 | 생존(등가 — 읽으며 세기가 같은 413) |
| R7 | logout-all 알림 기기 안 지움 | 잡힘 |
| R8 | 남의 알림 기기까지 지움 | 잡힘 |
| R9 | epoch 안 올림 | 잡힘 |
| R10 | 구글 아님도 받음 | 잡힘 |
| R11 | 엔드포인트 상태 검사 삭제 | 생존(등가 — 문지기가 먼저 401) |
| R12 | 쿠키 안 지움 | 잡힘 |
| R13 | ORDER_MAX=30 | 잡힘 |
| R14 | StockUpdate.name 한도 삭제 | 잡힘 |
| R15 | openapi를 /openapi.json으로 | 잡힘 |
| R16 | docs 다시 켬 | 잡힘 |
| R17 | 비밀번호 한도 삭제 | 잡힘 |
| R18 | 화면: logoutEverywhere에서 `clearAi()` 삭제 | **생존 → 조건 2** |
| R19 | 화면: canLogoutAll에서 `!pending` 삭제 | 생존(등가 — guest가 pending 포함) |
| R20 | compose의 CSP 줄 삭제 | 잡힘 |

## 끝난 뒤 worktree

```
$ git -C …/scratchpad/r049/wt-revB status
HEAD detached at 4479479
nothing to commit, working tree clean
```

가짜 서버는 `kill $(cat …/r049/revB-fake.pid)`로 껐다(그 뒤 `ps -p` 비어 있음).
