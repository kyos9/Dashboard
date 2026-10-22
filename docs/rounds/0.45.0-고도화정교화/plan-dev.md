# 0.45.0 계획 검토 — 개발자 입장 (2c98e15, 읽기만)

총평: 넷 다 만들 수 있고 크기 "중간"이 맞다. 다만 A 의 상태 파일 덮어쓰기는 **막음**이라 계획에 고칠 길을 적어야 한다. B·C 는 고쳐야 할 것이 몇 개 있다.

## A. 백업을 서버 밖으로
**찬성** (가) 당겨 가기가 가장 작다. 볼륨 구조(`app-data:/data`, `docker-compose.yml:92-94`; `BACKUP_DIR=/data/backups`, `Dockerfile:37`)에서 `exec`로 쓰고 `compose cp`로 꺼내는 길은 DEPLOY 10(`DEPLOY.md:380-390`)이 이미 쓰는 길이다. `exec`는 `signal`(uid 10001)로 돌고 이 사용자가 `/data`의 주인이다(`Dockerfile:63-66`). 그래서 `--mark-pulled`가 상태 파일을 쓸 수 있다.
**걱정**
- **막음**: 상태 파일을 통째로 덮어쓴다. `_write_failure`가 `{"last_failure": …}`만 쓰고(`backup.py:60`) 매일 백업이 성공할 때마다 `_write_failure(None)`을 부른다(`:213`). 그래서 `pulled_at`이 하루 만에 지워진다. 읽고 합쳐 쓰는 방식으로 바꿔야 한다. 앱과 `exec` 프로세스가 같은 `.tmp` 이름(`:59`)을 쓰므로 tmp 이름에 pid를 붙여야 한다.
- **고쳐야 함**: "못 쓰면 0.44 메모리 대체와 같게"는 여기서 뜻이 없다. `--mark-pulled`는 `exec`가 띄운 **별도 프로세스**라 그 메모리(`_unsaved`, `:48`)를 앱이 못 본다. 못 쓰면 exit 1로 끝내고 bat이 알려야 한다.
- **고쳐야 함**: bat이 `python -m app.services.backup`을 부르면 꼬리표 없는 백업이 생긴다(`backup.py:330`). 이것은 "매일 백업"으로 세어진다(`:256`). 그러면 매일 백업이 멈춘 것을 가리고(진단의 last_at이 새것이 된다) 7벌 순환(`:193`)도 하나 당긴다. 새로 뜨지 말고 있는 폴더를 통째로 꺼내거나, 꼬리표를 `pull`로 따로 둔다. 그리고 `main()`은 실패해도 상태 파일에 적지 않는다(`:327-334`).
- **고쳐야 함**: "DEPLOY와 글자까지 같게"는 그대로는 안 된다. ssh로 원격에서 부르면 TTY가 없어서 `docker compose exec`가 "the input device is not a TTY"로 실패한다. `exec -T`가 필요하고, DEPLOY 10의 손 명령에는 `-T`가 없다(`DEPLOY.md:383`). 대조 테스트는 "bat의 명령 = DEPLOY의 명령 + `-T`"로 정하거나 DEPLOY도 `-T`로 바꾼다. 또 bat 맨 위가 "두 줄"로는 모자라다. 사용자(`ubuntu@`)와 서버의 저장소 폴더(`~/Dashboard`, `cd`가 있어야 compose가 파일을 찾는다)가 더 필요하다.
- **참고**: 작업 스케줄러는 사람 없이 돈다. 첫 접속의 호스트 키 질문에서 멈추고, 윈도우 OpenSSH는 키 파일 권한이 넓으면 그 키를 거절한다. 그래서 "처음 한 번은 손으로 돌린다"를 DEPLOY에 적는다. `--mark-pulled`는 scp가 성공한 뒤(`errorlevel` 확인)에만 부른다. 옛 이미지(IMAGE_TAG로 되돌린 서버)의 `main()`은 인자를 무시하므로 `--mark-pulled`가 **백업을 한 벌 더 뜨고 0으로 끝난다**. 해는 없지만 표시도 안 남는다. 30일 숫자를 어디 둘지(환경변수인지 화면 상수인지)가 비어 있다. 저장소 맨 위의 `backup.bat`(PC 전용)과 이름이 비슷해 헷갈릴 수 있다.
**제안** 테스트로 확인할 수 있는 것: ① 합쳐 쓰기(매일 백업이 성공해도 실패해도 `pulled_at`이 남는다) ② `--mark-pulled`의 exit 0/1과 status()의 `offsite` ③ 진단의 세 상태와 옛 응답에서 줄이 숨는지 ④ bat의 명령 줄과 DEPLOY 대조, 비밀 grep. ssh·scp·exec 그 자체는 확인할 수 없으니 주인 확인 목록에 넣는다. 더 작은 길: bat은 `exec -T … --mark-pulled`와 폴더 통째 `compose cp`, `scp -r` 셋만 하고 새로 뜨지 않는다.

## B. 조용한 시간 · 종목별 끄기
**찬성** "미루기"는 지금 구조에서 실제로 된다. 판정은 시세 갱신 뒤 `_send_alerts` 한 곳으로 모인다(`scheduler.py:51,65`). 실행 시각은 UTC 22:30/07:00/07:30이고 KST로 07:30/16:00/16:30이다(`:286-295`). 재시작 때는 받아온 게 있을 때만 판정한다(`:127-128`). `run_daily`에서 그 사람을 `_changes` 전에 건너뛰면 상태가 적히지 않는다(`alerts.py:293-294`, `:203-221`). 그 뒤 비시장 판정(16:00 일본 갱신 뒤)도 **모든 종목**을 보므로(`:158-170`) 미국 신호가 그때 모아 간다. 0015는 0013 본보기(`0013_signal_thresholds.py`)와 같은 크기다. 옛 이미지가 모르는 리비전으로 켜지는 것도 사실이다(`migrate.py:142-147`).
**걱정**
- **고쳐야 함**: 세 판정 시각을 다 덮는 조용한 시간(예: 07:00~17:00)이면 **영영 안 간다**. 거절하거나, 판정 시각 표를 화면에 보이고 경고한다.
- **고쳐야 함**: 가입 신청 알림은 `run_daily` 밖에서 즉시 간다(`alerts.py:107-113`, `google_login.py:374`에서 바로). 상태가 없어서 미룰 수 없다. 조용한 시간에 막을지(=버리기) 그대로 보낼지 정해서 화면에 적는다.
- **고쳐야 함**: 시각은 "예정 시각"이 아니라 **판정할 때의 실제 시각**으로 잰다. misfire 1시간(`scheduler.py:273`)과 갱신에 걸리는 시간 때문이다. 시각을 고정한 테스트를 하려면 `run_daily(db, now=…)`처럼 시각을 넣을 자리가 필요하다(지금은 `utcnow` 직접 호출, freezegun 없음 — requirements).
- **고쳐야 함**: API가 지금 코드와 부딪힌다. `KindsIn.kinds`가 필수다(`routers/push.py:32-33`). 새 화면이 `quiet`만 보내려면 `kinds`도 빠질 수 있어야 한다. 모르는 종류는 지금 **400**인데(`:67-72`) 계획은 422라 한 갈래로 맞춘다. "모르는 키 거절"은 `extra="forbid"`가 있어야 한다(지금 기본값은 무시).
- **참고**: "다시 켤 때 `record_buy_state_quietly`처럼"은 필요 없다. 끈 종목도 `_changes`가 상태를 계속 적으므로(`alerts.py:208-215`) 켤 때 쌓인 것이 없다. 끄기는 `compose` 전에 subject의 티커로 거르면 된다(`compose`는 이름만 받는다, `:248-251`). `tools/signal_diff.py:133`의 "몇 명에게 가나"는 끈 종목을 모른다(셈이 조금 많게 나온다). 0015를 넣으면 0013까지 내리기가 0015와 0014를 건넌다. 이때 0014 때문에 백업은 여전히 꼭 있어야 한다(`migrate.py:51,128`) — 바뀌는 것 없음.
**제안** 쉬는 구간의 판정은 `start<=now<end` 한 가지로 정한다(시작>끝이면 자정을 넘는다, 끝 시각은 들지 않는다). 테스트는 KST 07:30·16:00·16:30과 22:00~08:00·07:30 끝 경계, 재시작(results 있음·없음).

## C. 차트 팝업 매도 근거
**찬성** 같은 함수로 만들 수 있다. `buy_conditions_many`(`signals.py:59-88`)가 이미 "규칙의 조건을 표 하나에 묶어 마지막 행" 방식이다. 규칙 인자를 받게 일반화하고 `signal_rules.evaluate_conditions(SELL, …)`(`signal_rules.py:350`)를 쓰면 배지(`evaluate_rule`, `:355-359`)와 평가 함수가 같다. 내 기준은 `t`(`dashboard.py:39`)를 넘기면 `adx_rising`의 비교 기간(`signal_rules.py:323`)까지 따라온다. 매도 규칙은 `/api/signal-rules`에도 이미 나간다(`signal_rules.py:448`).
**걱정**
- **고쳐야 함**: 종가를 붙이는 자리. `_frame`은 지표 열만 만든다(`signals.py:20-24,36-42`). `above_ma50`은 `df["close"]`를 읽으므로(`signal_rules.py:311`) 열이 없으면 KeyError가 난다. 종가는 `recent_prices(limit=2)`(`dashboard.py:40`)의 첫 줄을 그냥 쓰지 말고 **지표 날짜와 같은 줄**만 쓴다. 다르면 None이다. 이것이 저장 판정(`compute_signals`가 같은 날 종가를 씀)과 내 기준 길(`my_signals._frames`의 같은 날 조인, `my_signals.py:113-115`)과 같은 기준이다.
- **고쳐야 함**: 일치 테스트의 대상. 기본 기준 사람의 배지는 **저장된** `signal_daily`이고 그 날짜는 `signal.date`다(`dashboard.py:42,121`). 조건은 지표의 마지막 날짜로 판정한다. 두 날짜가 다른 종목(지표만 있고 판정이 아직 없는 날)이 생기면 어긋난다. 테스트는 "같은 날짜일 때 같다"를 보이고, 날짜가 다를 때 화면이 무엇을 보일지(줄을 숨긴다)를 정한다.
- **참고**: 계획의 예시 문구("50일선 위 · 거래량 강함")가 규칙 이름("MA50 위", "거래량 받침", `signal_rules.py:305,329`)과 다르다. 계획은 "이름을 그대로"라고 했으니 예시를 고친다. 규칙의 `name`은 "매도 시그널"이고 "어깨매도 (참고)"는 `spec_name`이다(`:299-300`). 어느 쪽을 쓰는지 적는다. "폰 360에서 차트가 첫 화면 안"은 jsdom으로 못 잰다. 스크린샷 확인으로 둔다.
**제안** `conditions_many(rule, recent_by_ticker, t, close_by_ticker=None)` 하나로 만들고 `buy_conditions_many`는 그것을 부르게 한다. 그러면 쿼리가 늘지 않는다.

## D. 작은 고치기
- **D1 찬성** 원인이 맞다. 모델 검사(`schemas.py:193-213`)라 loc가 `body`뿐이고, `FIELD_LABEL`에 네 칸이 없다(`client.ts:86-95`, `:132-133`). **걱정(참고)**: msg가 `"Value error, adx_trend: …"` 꼴이라 화면이 접두어와 키를 떼어 내야 한다. `_finite`는 키 여럿을 쉼표로 묶는다(`schemas.py:190`). **제안**: 키 → 이름은 `LIMITS`나 `/api/signal-rules`에서 가져와 화면이 새로 짓지 않게 한다.
- **D2 찬성** 맞다. `*`가 없다(`App.tsx:54-113`). 서버는 `/api/` 말고 전부 index.html로 넘긴다(`web.py:82-92`). `/chart` 링크는 코드 안에 없다. 걱정 없음.
- **D3 찬성** 맞다. `days`는 줄 수다(`value_record.py:205-212`). 문구 자리는 `pages/RebalancePanel.tsx:656, :694`이고 계획의 경로에 `pages/`가 빠졌다. 기존 테스트 `RebalancePanel.test.tsx:915,919`가 옛 문구를 굳혀 두었으니 같이 바꾼다.
- **D4 찬성** 맞다. `downgrade.py:24`가 `ValueError`만 잡고 `MigrationBackupFailed`는 `RuntimeError`다(`backup.py:288`). 문구는 업그레이드 것이 그대로 나온다(`:315-321`). **제안**: 문구는 `downgrade.py`에서 잡아 따로 쓰고, 갈래는 `_failure_kind(exc.__cause__)`로 낸다. 업그레이드 문구(`migrate.py:154`)는 건드리지 않는다.
- **D5 찬성** 맞다(`HistoryChart.tsx:48-54`, `FundamentalsPage.tsx:73-76`). 본보기는 `RebalancePanel.tsx:1177`이다.
- **D6 찬성** 맞다. sticky 바닥 줄 하나에 다 들어 있다(`StockEditModal.tsx:210-229`, `index.css:4692-4699`). **참고**: "안내 두 줄"은 문단 하나(`:217-220`)이고, jsdom에는 `scrollIntoView`가 없어 테스트는 "불렀다"까지만 볼 수 있다.

## 순서·크기
D → A → C → B 순서에 찬성한다. 0015를 마지막에 두면 B만 빼고 낼 수 있다. A는 **"막음" 하나(합쳐 쓰기)를 계획에 적으면** 작음~중간 그대로다. B의 API(`kinds` 선택, 400/422)는 계획 단계에서 정해 둔다.
