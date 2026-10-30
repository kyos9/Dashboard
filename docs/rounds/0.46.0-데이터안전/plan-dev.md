# 0.46.0 계획 검토 — 개발자 입장

읽은 것: plan-draft.md, RULES §1-6·운영 규칙, 초안이 든 코드·시험 전부. 고친 파일 없음.

## A1 복구 시험
- **찬성**: 만들 수 있다. 표 22개 + `alembic_version`, 외래키 순서는 `Base.metadata.sorted_tables` 가 준다. CI 의 `postgres` 는 슈퍼유저라 `CREATE DATABASE` 가 된다. python:3.14-slim(데비안 trixie)의 `postgresql-client` 는 17 이다. docker 쪽은 판이 **같아야** 맞다(`>=` 가 아님): 17 의 pg_dump 가 쓰는 `SET transaction_timeout` 은 16 에 부으면 넘어졌다. 다음 큰 판도 같을 수 있다.
- **걱정**
  - 고쳐야 함: 러너에 16 이 깔려 있고 cluster 16/main 도 있다. PGDG 에서 `postgresql-client-17` 을 깔아도 `/usr/bin/pg_dump`(pg_wrapper)가 16 을 고를 수 있다. → `echo /usr/lib/postgresql/17/bin >> $GITHUB_PATH` 를 넣고, 다음 단계에서 `pg_dump --version` 이 17 인지 본다.
  - 고쳐야 함: "마지막 줄 자르기 → 붓기 실패" 시험은 성립하지 않는다. 덤프 꼬리가 주석·빈 줄·`\unrestrict` 라서 잘라도 psql 은 성공한다. 문장 사이를 자르면 **표가 빠진 채 성공**한다. → `_backup_postgres`(backup.py:204-214)가 뜬 뒤 꼬리에 `-- PostgreSQL database dump complete` 가 없으면 실패로 처리하게 하고, 그것을 시험한다.
  - 고쳐야 함: 운영의 붓기는 db 컨테이너의 psql(alpine)로 한다(DEPLOY.md 10-1 의 3번). 덤프는 앱 이미지의 pg_dump(데비안)가 뜬다. 17.6 부터 덤프에 `\restrict` 가 들어가고, 17.6 보다 옛 psql 은 `ON_ERROR_STOP` 으로 멈춘다. → CI 의 붓기를 `docker exec ${{ job.services.postgres.id }} psql …` 로 서비스 컨테이너 안에서 한다(DEPLOY 와 같은 길). DEPLOY 10-1 에는 `docker compose pull db` 를 먼저 하라고 한 줄 넣는다.
  - 고쳐야 함: 다른 시험은 `signal` DB 를 시험마다 스키마째 비운다(tests/dbsetup.py:24-40). → 덤프할 DB 와 부을 DB 를 둘 다 새로 만든다. `CREATE DATABASE` 는 AUTOCOMMIT 연결에서만 된다.
  - 참고: 원본 DB 는 맨 `alembic upgrade head` 가 아니라 `init_db()` 로 만든다(db.py:244 `_seed_macro_series`). 대조를 마친 **뒤에** 되돌린 DB 로 `init_db` 를 부른다. 그 전에 부르면 시드·고아 줄 치우기가 대조할 값을 바꾼다.
  - 참고: "빠진 표" 기준은 모델만 보지 말고 **DB 를 inspect 한 표 목록**(alembic_version 빼고)으로 잡는다. 마이그레이션에만 있는 표도 걸린다. 해시는 서버에서 `md5(string_agg(t::text, ',' ORDER BY pk))` 로 양쪽을 비교하면 소수·JSON 비교로 헤매지 않는다.
- **제안**: docker.yml 단계는 실행 중인 이미지를 받아야 해서(PR 에서는 push 가 없어 `load` 가 필요하다) 번거롭다. Dockerfile 에 `ARG PG_MAJOR=17` 과 `RUN pg_dump --version | grep -q " ${PG_MAJOR}\."` 를 넣으면 빌드가 곧 확인이다. compose 의 `postgres:17` 과 그 ARG 가 같은지는 파이썬 시험이 글자로 본다(test_backup_export_script.py 방식).

## A2 pg_dump 시간 한도
- **찬성**: 작다. `subprocess.run(timeout=)` 이 넘으면 자식 프로세스를 죽인다.
- **걱정**
  - 고쳐야 함: `TimeoutExpired` 는 OSError 가 아니어서 `_failure_kind`(backup.py:144-160)에서 "알 수 없는 오류"로 빠진다. 갈래를 하나 더한다.
  - 고쳐야 함: compose 는 `environment:` 에 적은 이름만 넘기고 `env_file` 이 없다. 그래서 `SIGNAL_DASHBOARD_BACKUP_KEEP` 도 지금 서버에서 안 먹는다(docker-compose.yml 의 app). TIMEOUT·KEEP·KEEP_PREMIGRATE 를 `${…:-}` 로 넘기고, 빈 글자이면 기본값을 쓴다. `KEEP = int(...)`(backup.py:36)는 잘못된 값이면 import 때 앱이 죽는다. 같은 안전 파서를 쓴다.
  - 참고: 죽은 DB 에 연결하다 매달리는 것은 `PGCONNECT_TIMEOUT` 이 더 빨리 끊는다. env 에 같이 넣는다.

## A3 세는 법
- **찬성**: 꼬리표별로 나누는 것은 `status()`·`attention()`(daily 만 본다, backup.py:317·354)·backup-export.sh(꼬리표 없는 것만 고른다, :35)와 부딪히지 않는다.
- **걱정**
  - 고쳐야 함: 진단 문구 `${count}개 보관(최대 ${keep}개)`(DiagnosticsModal.tsx:185)가 옛 화면에서 "12개 보관(최대 7개)"로 거짓이 된다. 지금은 prune 이 전체를 7로 막아 늘 참이다. 날짜 방식에 "오늘 것은 다 남김"을 더하면 최대값 자체가 없어진다.
  - 고쳐야 함: "최근 7일치"가 달력 7일인지 백업이 있는 날 7개인지 정하지 않았다. 달력 7일이면 백업이 8일 실패한 뒤 하루 성공할 때 옛것이 다 지워진다. 백업 있는 날 7개이면 방침의 "최대 7일"이 깨진다.
  - 참고: 이름 속 시각은 서버의 지역 시각이다(backup.py:164, 컨테이너는 UTC). "날짜"·"오늘"도 그 시각을 기준으로 적는다. 손 백업(`main`)은 꼬리표가 없어 매일 백업으로 세어진다. 초안의 "손 백업이 같이 세어져"는 곧 매일 백업 이야기다.
- **제안(더 작은 길)**: 날짜를 세지 말고 **벌 수로 나눈다**. 매일 백업 최근 7개, 업데이트 직전 백업은 최근 3개 그리고 7일 안. 켤 때 여러 벌이 생기는 것은 이미 12시간 규칙(`run_backup_if_stale`)이 막는다. 이렇게 하면 `keep` 을 "모두 합친 최대"(10)로 내보낼 수 있어 옛 화면 문구가 참으로 남는다(`keep_daily` 는 더한다). 방침의 "7벌"과 DEPLOY 10 도 고칠 것이 거의 없고, 시행일도 바꾸지 않아도 된다.

## A4 PC 사본
- **찬성**: 판단이 맞다(같은 PC 에 서버 키가 있다). `icacls "%DEST%" /inheritance:r /grant:r "%USERNAME%":(OI)(CI)F` 한 줄이면 된다.
- **걱정**: 참고. OneDrive 확인은 `%OneDrive%`·`%OneDriveCommercial%` 접두어로 비교한다. 폴더를 옮겨 둔(알려진 폴더 이동) 문서 폴더도 잡힌다. 이미 받아 둔 파일에는 상속이 끊긴 뒤의 권한이 새로 적용되지 않을 수 있다. 처음 한 번은 `/T` 로 건다.

## B 헬스체크
- **찬성**: 작다. 화면은 실패하면 `setHealth(null)`(AppHeader.tsx:95-98)로 넘어지지 않는다. test_slow_requests·test_isolation 은 바뀌지 않는다. 시험은 `status`·`version` 만 봐서 `db` 를 더해도 그대로다(test_api.py:11·243, test_auth.py:36·87).
- **걱정**
  - 고쳐야 함: `SELECT 1` 은 `Depends(get_db)`(또는 `_db_factory`)로 연다. 전역 `engine` 을 쓰면 시험이 바꿔 끼운 DB 를 보지 않아, "엔진을 망가뜨린 시험"이 쓰는 DB 와 실제로 보는 DB 가 다르다.
  - 고쳐야 함: 연결된 채 매달린 DB 에는 `connect_timeout` 이 듣지 않는다. 그런 DB 에서는 30초마다 health 가 커넥션 하나와 스레드 하나를 붙잡아, 풀(5+10)이 마르고 다른 요청까지 멈춘다. → health 트랜잭션에서만 `SET LOCAL statement_timeout = '3s'` 를 건다(Postgres일 때).
  - 참고: 구글 모드에서 쪽지가 있는 브라우저는 문지기(`resolve_user_id`, auth.py:443-447)가 먼저 DB 를 봐서 503 이 아니라 500 을 받는다. 헬스체크 curl 은 쪽지가 없어 503 까지 간다. 초안의 "화면은 503" 문장만 고친다.
- **제안**: `connect_timeout` 은 `db.engine_options`(db.py:69) Postgres 갈래에 `connect_args={"connect_timeout": 5}` 로 넣는다. migrations/env.py:56 도 같은 함수를 써서 한 자리면 된다.

## C 시세 받기 실패
- **찬성**: 스케줄러는 리더 하나에서만 돈다(scheduler.py:40·281). app_setting 은 DB 에 있어 다른 워커도 같은 값을 읽는다. `/api/auth/status` 에 더하는 비용은 관리자일 때 기본 키 조회 한 번이다.
- **걱정**
  - 고쳐야 함: 22:30 "daily" 갱신은 `market=None` 으로 **전 시장**을 받는다(scheduler.py:91). 결과 줄에는 시장도 제공자도 없다(`{"ticker","error","hint"}`, pipeline.py:132·138). 시장은 Instrument 로 다시 찾고, 제공자 이름은 `DataIngestionError.__cause__`(AllProvidersFailed.failures)에서 꺼내 결과 줄에 **더해야** 한다. 사람이 누르는 새로고침 응답에도 같이 붙는다(더하기만이라 괜찮다).
  - 고쳐야 함: JSON 하나에 여러 시장을 고쳐 쓰면, 켤 때 따라잡기와 cron 이 겹칠 때(BackgroundScheduler 의 스레드 풀) 나중 것이 앞 것을 지운다. → 시장마다 키를 따로 둔다(`refresh_status:US` …).
  - 고쳐야 함: 알림 표시 `backupAttention` 은 화면 네 곳에서 "백업을 확인하세요"라는 이름으로 쓰인다(AppHeader.tsx:152·155·258·357). 점이 시세 때문에 떠도 말이 백업이다. 그 말을 고치는 것도 크기에 넣는다.
  - 참고: `TickerNotFound` 만 받은 종목(상장폐지)은 "막힘"을 세는 분모·분자에서 뺀다. 아니면 작은 시장에서 잘못 울린다.
- **가입 신청 스위치에 묶기**: 옛 화면 호환에는 실제로 필요하다. `KIND_TEXT[kind].label`(PushModal.tsx:228, pushText.ts:5)은 모르는 종류에서 넘어진다. 저장된 `push_kinds` 가 있는 관리자에게는 새 종류가 기본으로 꺼진다(alerts.py:69-74). 다만 **더 작은 길**이 있다: 알림 종류로 만들지 말고 관리자에게 늘 보낸다. "바뀐 날 한 번"이라 드물고, `.env` 스위치로 끈다. 그러면 스위치 이름을 바꿀 필요가 없고 "가입 신청을 끄면 시세도 꺼짐"이라는 혼동도 없다. 어느 길이든 새 화면에는 `KIND_TEXT[kind] ?? 기본 풀이` 를 넣어, 다음 라운드부터는 새 종류가 안전하게 한다.

## D 계정 지우기
- **찬성**: 작다. 탈퇴의 표 목록(auth.py:419-422)을 `services/users.delete_user_records(db, user_id)` 로 옮기면 두 곳이 같은 함수를 쓴다. test_isolation 의 `user_id` 칸 전수 검사(:785-787)도 그대로 다시 쓴다. 다시 신청하는 길은 이미 있다: `google_sub` 줄이 없으면 새로 만든다(google_login.py:328-345).
- **걱정**
  - 참고: 지운 이메일이 `ALLOWED_GOOGLE_EMAILS` 에 있으면 승인 대기가 아니라 바로 `active` 로 들어온다(google_login.py:325·342). 대기가 `MAX_PENDING` 으로 차 있으면 다시 신청도 막힌다. 완료 조건과 확인 창 문구에 "허용목록에 없으면"을 붙인다.
  - 참고: 지운 뒤 헤더의 대기 숫자는 `recountPending` 으로 다시 센다.

## 크기
중간~큼이 맞다. A1 이 가장 크다(CI 판 맞추기, DB 둘, 22표 줄, 덤프 꼬리 확인). A3 을 벌 수 방식으로 하고 C 를 "관리자에게 늘 보냄"으로 하면 화면·방침·시행일 손질이 빠져 중간 쪽으로 준다.
