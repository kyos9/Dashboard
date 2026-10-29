# 개발 건강 점검 (제로베이스) — 자산관리 0.45.3, 2026-10-23

## 잰 숫자

| 항목 | 값 |
| --- | --- |
| 백엔드 pytest (로컬 Python 3.13.16, SQLite) | **1492 통과 · 3 건너뜀 · 실패 0**, 경고 5,382개, 4분 4초 |
| 프런트 vitest | **62 파일 · 1030 통과 · 실패 0**, 143초 (jsdom을 62번 만듦 = 전체의 43%, 172초) |
| oxlint | 오류 0 · 경고 22 (only-export-components 16, set-state-in-effect 6) |
| `npx tsc -b` | 오류 0 |
| 코드 줄 수 | 추적되는 py/ts/tsx 합계 77,993줄 · 백엔드 비테스트 파이썬 24,229줄 · 백엔드 테스트 파일 83개 · 마이그레이션 15개(리비전마다 테스트 있음) |
| 가장 큰 파일 10개 (테스트 제외) | RebalancePanel.tsx 1749 · Dashboard.tsx 1635 · services/macro.py 1332 · types.ts 889 · providers/ai.py 879 · devtools/fake_server.py 850 · services/symbols.py 835 · schemas.py 823 · ai_analysis.py 725 · PortfolioView.tsx 708 |
| 가장 긴 함수 (백엔드) | dashboard.get_dashboard 119줄 · rebalance.compute_rebalance_current 115 · compute_positions 112 · signal_rules._build_rules 110 · stocks.create_stock 94 |
| 타입 구멍 | TS `any` 1곳(lib/lazyChunk.ts:31), 비테스트 `as X` 캐스트 34곳, `as unknown as` 1곳, lint 끄기 주석 8곳(그중 exhaustive-deps 7) · 파이썬 `type: ignore` 0 |
| 오류 처리 | `except Exception` 71곳(app/), 조용히 `pass` 하는 곳 0 |
| API | 엔드포인트 65개 중 response_model 있는 것 39개, `-> dict` 반환 24개 |

## 부족하거나 필요한 것

| # | 부족/필요한 것 | 근거(파일:줄, 잰 값) | 심각도 | 크기 |
| --- | --- | --- | --- | --- |
| 1 | **Postgres 백업을 실제로 복구해 보는 시험이 없다.** pg_dump는 테스트에서 늘 가짜다. 복구는 DEPLOY 문서의 손 절차뿐이다. CI에 Postgres 서비스가 이미 떠 있는데도 쓰지 않는다 | backup.py:178-215, tests/test_backup.py:211-235(`which`를 가짜로 바꿈), test_migration_0005.py:137("실제 pg_dump는 부르지 않는다"), DEPLOY.md:459-482 | 높음 | 중간 |
| 2 | **pg_dump에 타임아웃이 없다.** 마이그레이션 전 백업이 필수(`required`)인 리비전이면 기동이 막힐 수 있다. 정기 백업 스레드도 함께 묶인다 | backup.py:204 `subprocess.run(...)` timeout 없음, migrate.py `snapshot_before_migration(required=...)` | 중간 | 작음 |
| 3 | **.dockerignore의 `*.db`·`*.sqlite3`는 최상위만 막는다.** 로컬 `docker compose build`(compose에 `build: .`가 있음)에서는 `backend/signal_dashboard.db`가 이미지에 들어갈 수 있다. CI 이미지는 git checkout이라 안전하다. Docker 패턴 규칙에서 나온 결론이고 실측은 못 했다(데몬 없음) | .dockerignore `*.db`, 로컬에 backend/signal_dashboard.db 262KB 있음, Dockerfile `COPY backend/ ./` | 중간 | 작음 |
| 4 | **/api/health가 DB를 확인하지 않는다.** DB가 죽어도 컨테이너 헬스체크는 녹색이다 | main.py:84-101, Dockerfile HEALTHCHECK | 중간 | 작음 |
| 5 | **프런트 타입이 서버 스키마를 손으로 베낀 것인데, 어긋남을 잡는 장치가 없다.** OpenAPI 생성도 대조 시험도 없다(grep 0건). 관리자·푸시·인증 API는 dict를 그대로 돌려줘 스키마조차 없다 | types.ts 889줄 ↔ schemas.py 823줄, routers `-> dict` 24곳(admin.py:62-143 등) | 중간 | 중간 |
| 6 | **화면 파일 두 개가 너무 크다.** 둘 다 훅이 많고, 의존성 경고를 끈 effect가 있다 | RebalancePanel.tsx 1749줄·useState/useEffect 34, Dashboard.tsx 1635줄·27, exhaustive-deps 끄기 Dashboard.tsx:697/711/724 · macro.py 1332줄 | 중간 | 큼 |
| 7 | **CI가 프런트 lint를 돌리지 않는다.** build와 test만 돈다. oxlint 설정에도 규칙이 2개뿐이라 exhaustive-deps 끄기 주석이 실제로 무언가를 끄고 있는지 불분명하다(추정) | tests.yml frontend 잡, .oxlintrc.json | 중간 | 작음 |
| 8 | **SQLite에 WAL·busy_timeout·foreign_keys 설정이 없다.** 스케줄러 스레드, 시세 받기 스레드풀, 요청이 동시에 쓴다. 매크로 23:00, 재무 23:15, 백업 23:30이 길어지면 겹친다 → "database is locked" 가능(추정) | db.py:66(`check_same_thread`뿐), data_ingestion.py:92, scheduler.py:284-337 | 중간 | 작음 |
| 9 | **파이썬 버전이 갈린다.** 로컬은 3.13(pycache cpython-313, 실측 3.13.16)이고 CI·Docker는 3.14다. 그런데 주석은 "같은 버전으로 맞춘다"고 한다. setup.bat은 버전을 고정하지 않는다 | tests.yml:58, Dockerfile `python:3.14-slim`, setup.bat:9 | 낮음 | 작음 |
| 10 | **`datetime.utcnow()`가 32곳(14파일)에 있다.** 테스트 경고 5,382개의 대부분이 이것이라 진짜 경고가 묻힌다 | alerts.py 5, symbols.py 5, app_settings.py 4 등 | 낮음 | 작음 |
| 11 | **의존성 고정에 구멍이 있다.** `cryptography>=41`은 열려 있고, 전이 의존성 잠금(해시·freeze)이 없다. pytest·httpx가 실행용 requirements에 들어 있어 운영 이미지에도 깔린다 | requirements.txt(cryptography·pytest·httpx 줄) | 낮음 | 작음 |
| 12 | **문서와 코드가 어긋난다.** ① "지원 시장은 한국과 미국"이라고 하지만 일본도 지원한다(README:305). ② "Docker 빌드를 매번 돌리지 않는다"고 하지만 docker.yml은 푸시마다 돈다. ③ `pytest --cov=app`을 안내하지만 pytest-cov가 requirements에 없다(실측 미설치) | README.md:825, :780, :784 | 낮음 | 작음 |
| 13 | **새 개발자가 들어오기 어렵다.** README 836줄 중 "화면 구성" 약 244줄이 버전별 변경 기록이다. ROADMAP은 2756줄이다. 시작 경로는 Windows .bat 11개가 중심이다 | README.md:31-275, ROADMAP.md | 낮음 | 중간 |
| 14 | **외부 호출 일부가 라이브러리 기본 타임아웃에 기댄다.** yfinance `.splits`, `get_info`, 재무표 속성이 그렇다(추정: yfinance 기본값). 프런트 fetch도 스트림 말고는 타임아웃·중단이 없다 | fundamentals.py:90, providers/yahoo_fin.py:84-95, api/client.ts(signal은 :269 스트림뿐) | 낮음 | 작음 |
| 15 | **vitest 실행 설정이 비효율적이다.** jsdom을 파일마다 새로 만들어 시간의 43%를 쓴다 | vitest 출력 "jsdom was created 62 times · 172s" | 낮음 | 작음 |
| 16 | **검증 스크립트가 흩어져 있다.** check_jp_seed.py·check_us_seed.py·verify_live.py가 backend 최상위에 있고 테스트가 없다(실제 네트워크용). diagnose 계열은 테스트가 있다 | backend/*.py | 낮음 | 작음 |
| 17 | **색인이 겹친다.** `ticker` 단일 색인과 UNIQUE(ticker,date)가 함께 있어 쓰기 비용만 는다 | models.py:148-195(price/indicator/signal) | 낮음 | 작음 |

### 점검 중 생긴 부작용 (알림)

`npx tsc -b --noEmit false`를 한 번 잘못 돌렸다. 그 결과 `frontend/src/**/*.js` 150개와 `frontend/vite.config.js`가 생겼다. 모두 추적되지 않는 파일이고 14:48:50~14:49:07 사이에 만들어졌다. 지우려 했지만 권한에서 막혔다. 목록은 `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/emitted_js_files.txt`에 있다.

이 파일들을 그대로 두면 두 가지가 생길 수 있다.
- Vite가 확장자 없는 import를 `.tsx`보다 `.js`로 먼저 푼다.
- vitest가 `*.test.js`까지 테스트로 집어 테스트가 두 벌 돈다.

**곧 지워야 한다.** 예: `cd frontend && git clean -n src vite.config.js`로 목록을 확인한 뒤 `-f`로 지운다.

## 잘 된 것

- 테스트가 두텁다. 백엔드 1492개와 프런트 1030개가 모두 통과한다. CI는 SQLite와 Postgres 양쪽에서 돌고, 네트워크는 conftest가 막는다.
- 마이그레이션이 신중하다. 되돌릴 수 없는 리비전 앞에서는 백업이 필수이고, 모르는 리비전이면 그대로 뜬다. 리비전마다 테스트가 있고, 모델-마이그레이션 드리프트 검사와 ini ASCII 검사도 있다.
- 대시보드는 테이블마다 한 번씩만 읽어 N+1을 피한다. 쿼리 수를 세는 테스트도 있다(test_queries.py, test_api.py).
- 스케줄러가 하나만 돌도록 Postgres 어드바이저리 락으로 막았다(leader.py). 꺼진 동안 놓친 갱신은 켤 때 따라잡는다.
- requests 호출에는 대부분 명시 타임아웃이 있다(85곳). 로그는 회전하고, 느린 요청도 기록한다.
- Docker 운영이 단단하다. 비루트 사용자, 헬스체크, GHCR로 미리 빌드해 둔 이미지, compose·Caddyfile·이미지 태그 일치를 CI에서 검사한다.
