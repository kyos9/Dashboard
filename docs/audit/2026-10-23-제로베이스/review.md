# 제로베이스 전체 점검: 부족하거나 필요한 것 (main d2c41b6, 0.45.3)

읽기만 했다. 테스트를 돌렸고, 뮤테이션 7줄도 돌렸다(아래 "사고" 참고). 지난 판정문은 믿지 않고 코드에서 직접 확인했다.
돌린 것: 백엔드 `pytest -q` → `1492 passed, 3 skipped`(SQLite, py3.13). 프런트 `vitest run`(깨끗한 worktree) → `1030 passed (62 files)`. `npm audit --omit=dev` → 0건. `oxlint` → 경고 22, 오류 0.

| # | 부족/필요한 것 | 근거(파일:줄, 재현 명령) | 심각도 | 확인 정도 |
|---|---|---|---|---|
| 1 | **방침이 실제 AI 전송과 다르다.** 방침에는 "보유수량·평단가·목표비중처럼 나의 포트폴리오는 보내지 않"는다고 적혀 있다. 그런데 **포트폴리오 진단과 종목 분석은 비중(현재·목표·차이)과 수익률을 보낸다.** 두 기능 이름이 방침에 아예 없다. 게다가 사용자에게 기본으로 열려 있다 | `frontend/src/pages/Policy.tsx:76-84`(`grep -n 진단 Policy.tsx` → 0건) · `backend/app/services/ai_portfolio.py:3-9,276-284,395` · `app_settings.py:28`(`AI_ADVICE_FOR_USERS: True`) · `ChartModal.tsx:264`(canAdvise면 "AI 분석"이 곧 research) | 높음 | 확인함 |
| 2 | **규제 선 재검토가 필요하다.** 종목 분석 지시문이 AI에게 "알파버킷 편입 판단: 적합/조건부 적합/부적합"을 내리고 "사이징 코멘트"를 쓰게 한다. 틀은 **주인 개인 전략**(core-alpha-hedge, 동일비중 5%)인데 모든 사용자에게 적용된다. "개별 고객 상황에 맞춘 자문"(ROADMAP 3절)에 가장 가깝다. 주인 결정(9-8·9-15)은 있었지만, 다중 사용자에게 기본으로 열린 상태는 따로 다시 정해야 한다 | `ai_portfolio.py:80-84,120-124` · `ROADMAP.md:2703-2707` · `EVOLVE_RULES.md:127-130` | 높음 | 확인함 |
| 3 | **보안 헤더가 하나도 없다**(CSP·HSTS·frame-ancestors/X-Frame-Options·nosniff·Referrer-Policy). Caddy는 HSTS를 기본으로 붙이지 않는다. AI 키가 localStorage에 있어서 XSS가 하나라도 나면 키가 바로 털린다 | `Caddyfile:27-35`(header 지시문 없음) · `main.py`·`web.py` 미들웨어 없음 · `lib/aiKey.ts:112`. 재현: TestClient `GET /` 응답 헤더에 위 4종 모두 없음 | 높음 | 확인함 |
| 4 | **Starlette 0.41.3이 알려진 권고 범위에 든다**(fastapi 0.115.6 고정). 예: CVE-2025-62727은 FileResponse/StaticFiles의 Range 헤더 처리 DoS다. 로그인 없이 닿는다: `GET /`에 `Range: bytes=0-1`을 보내면 **206** | `backend/requirements.txt:1` · `python -c "import starlette;print(starlette.__version__)"` → 0.41.3 | 중간 | 추정(권고 기준. 버전과 도달 가능성은 확인함) |
| 5 | CI에 **의존성 취약점 검사가 없다**(pip-audit·npm audit·Dependabot 모두 없음). `cryptography>=41`은 고정되지 않았고, Actions는 SHA가 아니라 태그로 핀했다 | `.github/workflows/tests.yml:60-103` · `docker.yml` · `requirements.txt:20` | 중간 | 확인함 |
| 6 | **운영 형식(Postgres) 백업의 복구를 자동으로 시험하지 않는다.** pg_dump는 테스트에서 가짜이고, 받은 덤프의 무결성도 크기만 본다. 복구 절차는 PG16에서 손으로 한 번 해 본 것뿐인데 운영은 PG17이다. 밖(PC)에 꺼낸 사본으로 복구해 본 기록도 없다. CI의 Postgres 잡에서 `pg_dump → 빈 DB에 psql → 행 대조` 한 번이면 메워진다 | `tests/test_backup.py:201-243`(subprocess 가짜) · `DEPLOY.md:455` · `docker-compose.yml:24` · `deploy/backup-export.sh:45-49`(크기만) | 중간 | 확인함 |
| 7 | **`/docs`·`/redoc`·`/openapi.json`이 로그인 없이 열린다.** 문지기는 `/api/`만 지킨다. 스키마 84KB가 공격면 전체를 알려 준다 | `main.py:49`(docs_url 기본값) · `routers/auth.py:403-409`. 재현: TestClient(비밀번호 모드) `/openapi.json` → 200, 84335B | 중간 | 확인함 |
| 8 | **나가기가 쪽지를 무효로 만들지 않는다.** 쿠키만 지우므로, 새어 나간 쪽지는 30일 동안 그대로 통한다. "모든 기기에서 나가기"도 없다. epoch는 관리자가 차단할 때만 오른다 | `routers/auth.py:266-268` · `services/auth.py`(SESSION_SECONDS 30일) · `admin.py:93` | 중간 | 확인함 |
| 9 | **승인 대기·거절·차단 계정을 지울 API가 없다.** 방침은 "관리자에게 문의"라고 하는데, 관리자도 DB를 손으로 고치는 수밖에 없다. 삭제 요구에 응할 수단이 없는 셈이다 | `Policy.tsx` 5절 · `test_isolation.py:126-140`(admin은 users GET·status PUT뿐) | 중간 | 확인함 |
| 10 | **입력 한도가 비어 있다.** 종목 `name`·`category`·`ticker`, 순서 바꾸기 `tickers` 목록에 길이 제한이 없다. 요청 본문 크기 한도도 앱·Caddy 어디에도 없다. 승인된 사용자가 MB 단위 글자를 공용 DB에 넣을 수 있다 | `schemas.py:29-31,42-43,72` · `models.py:109,111`(String 무제한) · `Caddyfile`(request_body 없음) | 중간 | 코드 확인함, 영향 추정 |
| 11 | **검증 체계 1: 방침 시험이 한도 숫자만 대조한다.** "무엇을 보내나" 같은 데이터 흐름 문장은 아무것도 대조하지 않는다. #1이 지나간 이유다. AI 문맥 생성기가 비중 필드를 담으면 방침 문구를 확인하게 하는 시험이 필요하다 | `tests/test_policy_page.py` · `Policy.tsx:10-11` 주석 | 중간 | 확인함 |
| 12 | **검증 체계 2: 뮤테이션이 CI 밖에 있다.** 라운드마다 스크래치의 도구로 "바뀐 줄"만 본다. 그 도구는 저장소에 없고, 한때 주 checkout에 경로가 굳어 있었다(0.45.0 D 검토). 보안 핵심 줄의 상시 뮤테이션 세트(아래 7줄 같은)를 저장소에 두고 주기적으로 돌리면 좋다 | `docs/rounds/0.45.0-*/D-review*.md` · `git ls-files \| grep -i mutat` → 0건 | 중간 | 확인함 |
| 13 | **검증 체계 3: CI가 확인하지 않는 것들.** oxlint(경고 22)가 CI에 없다. 실제 브라우저 e2e가 없다(jsdom뿐). 빌드한 Docker 이미지를 **띄워 보지 않는다**(헬스체크·마이그레이션 기동 없음). 커버리지 하한도 없다 | `tests.yml:85-104` · `docker.yml`(build-push만) · `package.json` scripts.lint | 중간 | 확인함 |
| 14 | **밖에 꺼낸 백업이 관리자 PC에 평문으로 남는다.** 전원의 보유·평가금액 기록이 들어 있다. PC를 잃어버리면 그대로 샌다 | `server-backup-pull.bat`(암호화 없음) · `backup-export.sh:28,46` | 낮음~중간 | 확인함 |
| 15 | **백업 7벌에 업데이트 직전 백업(premigrate)과 켤 때 백업이 같이 세어진다.** 업데이트가 잦은 날에는 복구할 수 있는 기간이 1~2일로 준다. 방침의 "하루 한 번, 최근 7벌"과도 정확히 맞지 않는다 | `backup.py:240-259,360-372,378-389` | 낮음 | 확인함 |
| 16 | **CSRF 방어가 SameSite=Lax와 JSON에만 기대고 있다**(Origin 확인 없음). 운영에서도 CORS가 `localhost:5173`을 credentials와 함께 허용한다 | `routers/auth.py:163-172` · `main.py:56-62` | 낮음 | 확인함 |
| 17 | **VAPID 키와 세션 키는 DB 백업에 들지 않는다.** 서버를 잃으면 알림 구독이 전부 끊긴다(DEPLOY에는 적혀 있다) | `Dockerfile:35-39` · `DEPLOY.md:242` | 낮음 | 확인함 |
| 18 | **방침 4절에 빠진 기기 저장 항목이 있다**(대시보드 정렬·보기·손익 통화, 매수만 보기) | `lib/portfolio.ts:148-150` · `RebalancePanel.tsx:977` · `Policy.tsx` 4절 | 낮음 | 확인함 |
| 19 | **푸시 문구 "매수 시그널", "비중 미달(매수 검토)"에 참고용 표시가 없다.** 화면 밖(잠금 화면)에서는 권유로 읽힐 수 있는 회색 지대다 | `services/alerts.py:290-295` · `lib/pushText.ts:5-7` | 낮음 | 추정 |

**사고(보고):** 처음 뮤테이션을 **주 checkout에서** 돌려 auth.py·admin.py·web.py·google_login.py가 잠시 바뀌었다. 총괄의 지적을 받고 바로 멈췄고, `kill PID`로 끈 뒤 마지막 한 줄(`google_login.py`)을 `git checkout --`로 되돌렸다. `git diff --stat`은 비어 있다. 다시 돌린 것은 전용 worktree(`.../scratchpad/audit/wt-review`, d2c41b6)에서 했다.
**주의:** 주 트리 `frontend/src/**/*.js`와 `frontend/vite.config.js`에 추적되지 않는 파일 약 150개가 있다(14:49 생성, `tsc` 산출물로 보임). 내가 돌린 명령(vitest·oxlint)은 파일을 쓰지 않는다. 지우지 않았다. 이 파일들이 vitest에 잡혀 주 트리에서는 시험 1개가 실패했다(`backToClose.test.js`). 깨끗한 worktree에서는 1030개 모두 통과한다.

**뮤테이션(직접 7줄, worktree, 기준선 175 passed): 7/7 잡힘.** 세션 서명 확인 빼기, 차단 때 epoch 안 올림, 주인 탈퇴 허용, dist 밖 파일 허용, email_verified 안 봄, 손님 쓰기 허용, 비밀번호 잠금 없음.

## 잘 된 것
- **격리 표**(`test_isolation.py`)가 앱 라우트와 자동으로 대조한다(빠진 것·남은 것 양쪽). 사용자별 API마다 B→A 확인이 있고, 주인·`열면`·손님 칸까지 시험한다. 탈퇴 시험은 손 목록이 아니라 **`user_id` 칸이 있는 모든 표**를 본다.
- **쪽지(v2)**: 서명에 epoch와 google_sub를 섞어 번호 재사용을 막는다. 구글 로그인은 state·nonce·PKCE와 `email_verified`를 확인하고, 토큰 교환 실패 때 본문을 로그에 남기지 않는다.
- **비밀값**: 키 파일을 0600으로 원자적으로 만든다. `.gitignore`·`.dockerignore`가 DB·키·로그·devtools를 막는다(이력에도 없다). AI 키는 헤더로만 오고, Caddy 로그 필터가 걸러 내며, Gemini 키를 주소에 넣지 않는다.
- **배포**: 컨테이너가 root가 아니다. 앱 포트는 127.0.0.1에만 열린다. compose에 기본 비밀번호가 없다. 서비스 워커는 `/api/`를 캐시하지 않는다. SPA 경로 조작 방지는 시험이 잡는다. 푸시 endpoint는 허용 목록으로 거른다.
- **데이터**: 마이그레이션 리비전마다 내리기 시험이 있다. 되돌릴 수 없는 리비전에는 IRREVERSIBLE 가드가 있다. 업데이트 직전 백업(실패하면 멈춤)이 있다. 0014를 내리려면 백업이 먼저 성공해야 한다. CI는 SQLite와 Postgres 두 DB에서 돈다.
- **규제 문구**: 종목 정리(3c) 지시문은 권유·예측·저평가 판단을 막는다. "추천"이라는 말은 화면에서 걷어냈다. AI 출처 주소는 http(s)만 받는다.

git status: 주 트리 `git diff --stat` 비어 있음(추적 파일 변경 0, 위 미추적 .js는 내 것 아님). worktree `git status --short` 비어 있음.
