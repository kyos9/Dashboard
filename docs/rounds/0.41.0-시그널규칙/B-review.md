조건부 합격

# 0.41.0 항목 B — 검토자 판정 (정의를 바꿀 때의 길)

- 본 커밋: `d8343c3` (작업 트리 detached HEAD). 범위 `099b8cd..d8343c3` (`09e1c2b`, `d8343c3`). 비교 기준 `344575c`.
- 동작은 직접 돌려 보니 모두 맞았다. 재계산·비교 도구·알림 미리 보기·진단 줄·가짜 서버 데모가 그렇다.
- 걸린 것은 둘이다.
  - 비교 도구의 표 칸 중 테스트가 지키지 않는 칸이 있다. 뮤테이션 4개가 살아남았다.
  - DEPLOY 9-1 명령 앞에 이미지를 받는 단계가 빠졌다.
- 둘 다 코드 동작이 아니라 테스트와 문서를 고치는 일이다.

## 완료 조건

| 조건 | 판정 | 증거 |
| --- | --- | --- |
| 지문이 다르면 한 번만 돈다 (두 번째 시작엔 안 돈다) | 통과 | `test_first_start_recomputes_once_and_changes_nothing`: 두 번째 `run_if_changed` 가 None. 가짜 서버 첫 시작: `/api/admin/signal-rules` → `reason:first, tickers 15, changed_rows 0, failed []` |
| 일부 실패면 지문 저장 안 함 | 통과 | `signal_recompute.py:100-102` (`if not failed:`). `test_a_failed_ticker_keeps_the_old_fingerprint_so_it_retries`. 총괄 뮤테이션 "실패가 있어도 지문 저장"이 잡혔다 |
| 재계산이 실패해도 앱이 뜬다 | 통과 | `scheduler.py:111-126`: 예외를 삼키고 따라잡기 갱신을 계속한다. `test_startup_job_goes_on_when_recompute_fails` |
| 따라잡기 갱신과 겹치지 않는다 (순서 테스트) | 통과 | `scheduler.py:92`: `_recompute_if_rules_changed()` 를 같은 job 안에서 `refresh_stale_markets` 보다 먼저 부른다. `test_startup_job_recomputes_before_catching_up`. 총괄 뮤테이션 "갱신 뒤에 재계산"이 잡혔다 |
| 지난 날짜만 바뀌면 알림 0, 오늘이 켜지면 한 번 | 통과 | `test_changing_only_past_dates_sends_no_alert`, `test_today_turning_on_alerts_once`. 내 뮤테이션 M6(`pending_changes` 가 저장 상태를 무시)이 잡혔다 |
| 비교 도구가 ADX 20→25 에서 기대 숫자를 내고 DB 에 쓰지 않는다 | **부분** | 동작은 맞다 — 아래 "직접 돌린 것" 1~3. 쓰지 않는 것도 맞다: CLI 전후 파일 sha256 이 같다(`4800237f…` → `4800237f…`). `run()` 전후 `iterdump` 해시도 같다.<br>테스트는 숫자를 **고정하지 않는다.** 1년 매수 횟수만 독립 재계산과 맞춰 본다. 3·5년 창, 마지막 매수일, 오늘 매도 변화, 매수 알림 끈 사람 거르기는 테스트가 지키지 않는다(뮤테이션 M1~M4 살아남음) → 조건부 1 |
| 워커 둘이면 하나만 (Postgres 갈래) | 통과 (CI/코드로 확인) | 이 환경에서는 Postgres 를 띄우지 못했다(`initdb` 는 root 로 안 돌고, `su` 는 막혀 있다). 코드로 본 것:<br>• 재계산을 자동으로 부르는 곳은 `_startup_refresh_job` 하나다.<br>• 그 job 은 `start_scheduler` 가 `SchedulerLock.acquire()` 에 성공한 프로세스에만 생긴다(`scheduler.py:248-250`).<br>• `test_leader.py::test_only_one_of_two_processes_gets_it` 와 `test_scheduler.py:344` 가 이를 지킨다.<br>CI 실행 38489846250(`a05ee02`, `d8343c3` 뒤 문서만 바뀜)에서 "백엔드 (Postgres)" ✓ |
| `set_value` 값이 `/api/admin/settings` 에 안 나온다 | 통과 | 가짜 서버 8192: 지문·요약을 적은 뒤에도 `owner admin/settings {'ai_advice_for_users': True}`. `admin.py:110-111` 이 깃발 이름 하나만 담는다. `set_value` 는 깃발 키를 거부한다(`test_fingerprint_values_are_not_admin_flags`) |
| `/api/admin/signal-rules` 주인 전용, 격리 표에 있다 | 통과 | `test_isolation.py:137-138` 표 `(SHARED, OWNER)`, `OWNER_CALLS` 에 들어 있고 주인 전용 14개 테스트가 통과한다. 직접 부르니 owner 200 · friend 403 · 손님 401 |
| 옛 서버면 진단 줄을 숨긴다 | 통과 | `DiagnosticsModal.tsx`: `.catch(() => setRules(null))` 이고 `{rules && …}` 일 때만 그린다. 테스트 "옛 서버(404)면 그 칸을 그리지 않는다" |
| 가짜 서버 `--demo-rule-change` | 통과 | 8192 에서 같은 데이터로 다시 띄웠다.<br>• `change_notice "시그널 계산 방식이 2026-10-14에 바뀌었습니다"`<br>• 진단: `시그널 기준 faa56cf123c6edfa · 2026-10-14에 바뀜 / 마지막 다시 계산 … (정의가 바뀌어서) — 15종목 중 0종목 0줄 바뀜 · 0.6초`<br>`test_devtools.py` 두 테스트가 통과한다 |
| DEPLOY 9-1 (배포 전 diff, IMAGE_TAG, 0.40.x 되돌리기) | 통과 (조건부 2) | 명령 `IMAGE_TAG=sha-… docker compose run --rm --no-deps app python -m app.tools.signal_diff` 는 맞는 모양이다:<br>• compose `image: …:${IMAGE_TAG:-latest}`, 태그는 `type=sha,format=short` → `sha-xxxxxxx`<br>• `WORKDIR /srv/backend`, ENTRYPOINT 가 없어 마이그레이션이 돌지 않는다. `signal_diff.main` 은 `init_db` 를 부르지 않는다<br>• `--no-deps` 여도 이미 떠 있는 `db` 에 compose 망으로 붙는다<br>0.40.x 로 내릴 때의 줄도 있다(DEPLOY.md:307-308).<br>**빠진 것:** 서비스에 `build: .` 가 같이 있어, 그 태그 이미지가 로컬에 없으면 compose 가 받는 대신 **서버에서 빌드**할 수 있다. 1GB 에서 OOM 이 날 수 있다는 것은 compose 주석이 스스로 경고한다. `pull app` 단계가 앞에 필요하다. ARM(A1.Flex, 로컬 빌드) 경우는 안내가 없다 |

## PROMPT §3 검사

- **계획 때 걱정 — 통과.**
  - "막음"(재계산과 따라잡기 갱신이 유일키를 두고 경쟁)은 같은 job 에서 차례로 돌게 해서 풀렸다(`scheduler.py:92`). 순서 테스트가 있고, 뒤집는 뮤테이션은 잡혔다.
  - "반영"으로 답한 B 쪽 걱정을 하나씩 확인했다. 모두 코드에 있다.
    - 글자 값 함수를 따로 두었다(`app_settings.py:57-73`).
    - 관리자 설정 응답에서 뺐다.
    - 가짜 서버는 켤 때 직접 부른다(`fake_server.py:699-720,746`).
    - 지문에는 평가 모양·기준값·손으로 올리는 판·지표 판만 넣고 문구·이력은 뺐다(`signal_rules.py:290-306`).
    - 전부 성공해야 지문을 적는다.
    - 알림은 실제 판정을 보내지 않고 돌린다(`alerts.pending_changes` 를 `_changes` 가 그대로 쓴다, `alerts.py:192-204`).
    - 시간 출처 둘을 적었다(DEPLOY "0.1~0.25초").
    - 진단 줄은 관리자 API 에만 싣는다.
    - 0.40.x 되돌리기를 DEPLOY 에 적었다.
    - 비교 도구에 매도 횟수가 있다.
    - 배포 전 비교 순서를 DEPLOY 9-1 에 적었다.
- **회귀 — 통과.**
  - 백엔드: `pytest -q` → 1301 passed, 3 skipped (시작 1263/3).
  - 프런트: vitest 807 passed / 55 files (시작 791). lint 경고 23 (시작 23). `tsc -b` 통과.
  - 응답 사진: 시작 커밋 `344575c` 의 backend 를 `git archive` 로 꺼내 **오늘** 다시 찍었다. HEAD 와 `snapdiff` → "차이 0".
  - 어제 기준 사진(`baseline/snap`)과는 946건이 다르다. 가짜 시세가 오늘 날짜에 묶여 있어서다(같은 날 비교 원칙).
- **격리 — 통과.** 위 표 참고. owner 200 · friend 403 · 손님 401.
- **마이그레이션 — 해당 없음.** B 에 새 리비전·테이블·컬럼이 없다. `app_setting` 에 행만 더한다. 0.40.x 는 이 키를 읽지 않는다.
- **호환 — 통과.**
  - `apidiff baseline/openapi.json HEAD` → 빠짐 0, 타입 바뀜 0, 더해짐 8 (A·B 합. B 는 `GET /api/admin/signal-rules`).
  - 새 화면 + 옛 서버 404 화면 테스트가 있다.
  - B 는 요청 본문을 새로 받지 않는다.
- **입력 한도 — 해당 없음.** 새 엔드포인트는 입력이 없는 GET 이다.
- **뮤테이션 — 실패 (조건부 1).**
  - 총괄 결과: 12개 중 다시 돌려 모두 잡혔다(`B-mutation.md`).
  - 내가 직접 6개를 돌렸다(`scratchpad/revB-review/mut.py`, 매번 원래대로 돌려놓음):

| 뮤테이션 | 결과 |
| --- | --- |
| M1 `signal_diff._last_true` 가 가장 **이른** 날 | **살아남음** |
| M2 `_counts` 의 3·5년 창을 1년으로 | **살아남음** |
| M3 `_alert_effect` 가 매수 알림 끈 사람을 거르지 않음 | **살아남음** |
| M4 `today_changed` 에서 오늘 매도 변화 무시 | **살아남음** |
| M5 재계산 요약에서 바뀐 줄 수를 0으로 | 잡힘 |
| M6 `pending_changes` 가 저장 상태를 무시 | 잡힘 |

  - 살아남은 4개는 모두 비교 도구의 보고 칸이다. 도구 자체는 독립 계산과 대조해 맞다(아래 2).
- **비밀 — 해당 없음.** 새 키·AI·외부 호출 길이 없다. 재계산 요약에는 종목 이름·숫자만 들어 있다.
- **규제 — 통과.**
  - B 추가 줄에서 `추천|사세요|팔라|팔아|저평가|예측|수익률` 을 찾았다. 2건이 나왔고 둘 다 "수익률은 보지 않는다" 같은 부정문이다(`signal_diff.py` docstring·출력 끝줄).
  - 도구 출력은 발동 횟수·날짜·사람 수뿐이다. 종목끼리 순위도 없다(티커순).
  - 기획의 "규제 영향 없음"과 맞는다.
- **데이터 경계 — 통과.**
  - 새 값은 공용 `app_setting` 3키(지문·지표 판·요약)이고 다시 만들 수 있다.
  - 재계산은 공용 `signal_daily` 만, 사용자 설정 없이 다시 쓴다. 리밸런싱 기록은 건드리지 않는다.
- **외부 호출 — 통과.**
  - 재계산은 저장된 시세만 쓴다. 테스트가 `fetch_price_history` 를 부르면 실패하게 막아 두었다.
  - 사람 수만큼 늘어나는 호출이 없다.
- **화면 — 통과.**
  - Playwright 로 8192 (`--demo-rule-change`) 에서 찍었다. PC 1400 · 폰 390/360 × 라이트/다크, 6장.
  - 진단 "시그널 기준" 줄과 신호 요약의 "바뀌었습니다" 줄이 6장 모두에 보인다.
  - `scrollWidth` 는 화면 폭과 같다(1400/390/360). 페이지 오류 0.
  - 사진: `scratchpad/revB-review/shots/*-diag.png`, `*-signal.png`.
  - 참고(B 와 무관, 이전부터 그랬을 것으로 보임): PC 에서 진단 창을 연 채 Tab 을 누르면 초점이 뒤의 탭 메뉴(대시보드·재무…)로 간다. 창 틀은 B 가 바꾸지 않았다. 폰에서는 창 안("경고·오류만")으로 간다.
- **성능 — 통과.**
  - `perf_dashboard.py` 결과: HEAD 38.1 ms / 12쿼리, A 끝(`099b8cd`) 37.4 ms / 12쿼리. 같은 기계·같은 때이고 잡음 범위다. B 는 대시보드 길을 건드리지 않는다.
  - 재계산은 15종목×5년에 0.5~0.6초이고 단독 프로세스 최대 RSS 는 112 MB 다.
- **가짜 서버 — 통과.** 새 상태(재계산 요약·바뀐 날)가 데모에 있다(`--demo-rule-change`). `test_devtools.py` 통과(전체 실행에 포함).
- **문서 — 통과 (조건부 2 제외).**
  - README "시그널 규칙 (v0.41.0)"·가짜 서버 옵션, ROADMAP 0-1·11-1, 명세 10장 4번(`SIGNAL_APP_SPEC.md:320-323`), DEPLOY 9-1, `version.py` 0.41.0 이 코드와 맞는다.
  - 수집하는 것이 늘지 않아 방침은 해당 없다.

## 직접 돌린 것 (적대적 확인)

1. **알림 미리 보기 = 실제 `_changes`.** 가짜 서버 DB 복사본에서 확인했다(`chk/dryrun.py`).
   - 방법: 3명 모두 구독을 두고 배포 전 알림 판정을 먼저 돌려 상태를 맞췄다. 그다음 정의를 바꾸고 `signal_diff.run` → 실제 `recompute` → 실제 `_changes` 순서로 돌렸다.
   - ADX 15: 예측 1명 `['TSLA']`, 실제 1명 `['TSLA']` — 일치. 1048줄이 바뀌었다.
   - ADX 25: 예측 0명, 실제 0명 — 일치. 747줄이 바뀌었고, 오늘 바뀐 종목은 `069500.KS`(꺼짐)라 알림이 없다.
   - `run()` 전후 DB 해시가 같다.
2. **비교 도구 숫자 = 독립 계산.** `chk/oracle.py`, ADX 25 에서 확인했다.
   - 대조한 칸: 15종목의 매수·매도 1·3·5년 전→후와 마지막 매수일.
   - 불일치 0. `last_buy_changed` 9종목이 `B-mutation.md` 의 출력과 같다.
3. **CLI 는 DB 를 쓰지 않는다.** `python -m app.tools.signal_diff` 를 돌린 전후로 SQLite 파일 sha256 이 같다.
4. **실제 서버에서 0.41.0 을 처음 켤 때.**
   - 적힌 지문이 없으니 `reason=first` 로 `price_daily` 의 전 종목을 다시 계산한다. 정의가 그대로라 update 는 0줄이다. 시그널 행이 비어 있는 날만 insert 된다.
   - 지표 판이 적혀 있지 않으면 지금 판으로 보므로 지표는 다시 계산하지 않는다(`signal_recompute.py:67`).
   - 시간: 종목당 약 0.04초(SQLite 5년치). 300종목이면 30~75초다(Postgres 10년, 문서 추정).
   - 메모리: 종목마다 표 하나만 들고 버린다. 단독 프로세스로 112 MB 이니 1GB 인스턴스에서 문제없다.
   - 다만 이 시간만큼 따라잡기 갱신이 늦어진다. 60초 백업(pg_dump 는 일관된 스냅숏)과 45·90초 매크로·재무 job 과는 다른 표라서 겹쳐도 된다.
5. **새 종목 받기 스레드와 겹칠 때 (참고).**
   - 시작 직후 30~105초 사이에 사용자가 새 종목을 담거나 "시세 갱신"을 누르는 경우다. 백그라운드 `backfill` 이나 요청 스레드가 같은 종목의 `signal_daily` 에 insert 하면 유일키 충돌이 날 수 있다(종목별 자물쇠가 없다).
   - 재계산 쪽이 지면 그 종목이 `failed` 가 되고, 지문을 적지 않아 다음에 켤 때 다시 돈다. 받기 쪽이 지면 "시세 갱신으로 다시" 안내가 뜬다. 둘 다 스스로 회복된다.
   - 같은 경쟁은 0.40.0 의 따라잡기 갱신·매일 갱신과도 이미 있었다. B 는 창을 조금 늘릴 뿐이다.
6. **영구 실패 종목 (참고).** 늘 실패하는 종목이 하나 있으면 켤 때마다 전 종목을 다시 돈다. 진단에 "다시 계산하지 않았습니다 … 실패: X" 로 보이므로 숨지는 않는다.
7. **0.40.x → 0.41.x 를 다시 올릴 때 (참고).** 정의를 바꾼 0.41.x → 0.40.x → 다시 0.41.x 순서면, 적힌 지문이 이미 새 정의라 자동 재계산이 돌지 않는다. 0.40.x 가 매일 갱신 때 옛 정의로 덮어쓴 종목은 다음 갱신까지 옛 정의로 남는다. DEPLOY 9-1 되돌리기 문단에 `recompute_signals --force` 한 줄을 더하면 좋다. 이번 라운드는 정의를 바꾸지 않아 실제로 생길 일은 없다.

## 조건부 (고쳐야 합격)

1. **비교 도구 테스트에 숫자를 고정하거나 빠진 칸을 지킨다.**
   - 계획의 완료 조건은 "고정한 숫자를 낸다(테스트)"이다. 지금은 1년 매수 횟수와 알림 수만 확인한다.
   - 다음 넷을 잡는 단언을 더한다(`tests/test_signal_recompute.py`):
     - 3·5년 창 (M2)
     - `last_buy` 전·후 날짜와 `last_buy_changed` (M1)
     - 오늘 매도만 바뀐 경우의 `today_changed` (M4)
     - 매수 알림을 끈 사람(`push_kinds` 에서 buy 를 뺌)은 세지 않음 (M3)
   - 예: `_prices` 시드 고정 + ADX 25 로 `report` 의 해당 칸을 숫자로 적는다.
   - 다시 돌려 M1~M4 가 잡히는지 확인한다.
2. **DEPLOY 9-1 명령 앞에 이미지 받기를 넣는다.**
   - `IMAGE_TAG=sha-… docker compose pull app` 다음에 `… run --rm --no-deps app …` 를 돌리게 한다.
   - `app` 서비스에 `build: .` 가 있어, 그 태그가 로컬에 없으면 compose 가 1GB 서버에서 빌드를 시작할 수 있다.
   - ARM(A1.Flex, 로컬 빌드) 서버는 sha 태그 이미지가 없으므로 따로 안내한다. 예: 백업 DB 를 PC 로 가져와 `DATABASE_URL=… python -m app.tools.signal_diff`.

## git status (작업 트리)

```
HEAD detached at d8343c3
nothing to commit, working tree clean
```

띄운 가짜 서버(8192, PID 24324 · 29578)는 PID 로 껐다. 뮤테이션은 매번 원래대로 돌려놓았다. 판정문과 보조 스크립트는 저장소 밖 `scratchpad/revB-review/` 와 `scratchpad/pw/rvB.js` 에 있다.
