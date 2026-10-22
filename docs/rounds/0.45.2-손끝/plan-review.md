# 0.45.2 계획 검토 — 검토자 입장 (읽기만, 25a6fe0)

요약: **막음 0 · 고쳐야 함 10 · 참고 7.** 규제·데이터 경계·외부 호출·입력 한도는 초안 말대로 영향이 없다. 걱정은 주로 "완료 조건을 그대로 잴 수 있나"와 시각·차트 동작의 빈틈이다.

## A. 숫자 칸이 말한 뒤

**찬성**: 화면만 바뀌고 저장 값은 그대로다. 보유 수량 칸 셋이 맞다(`StockEditModal.tsx:353`, `StockManager.tsx:414`, `RebalancePanel.tsx:279`). A4 의 금액은 `amount()` 를 쓰면 금액 가리기를 따른다(`lib/display.ts:118`). 문구에 "팔라"로 읽히는 말이 없다("판 만큼"은 지난 일을 말한다).

**걱정**
- A1 **고쳐야 함** — 칸이 스크롤되어 팝업 머리 밑으로 들어가도 줄이 "칸을 따라가면" 다시 제목·✕ 를 덮는다. 그때는 줄을 보이는 본문 안으로 붙이거나 숨겨야 하는데, 그 규칙이 초안에 없다. 완료 조건에 "칸이 머리 밑까지 올라간 상태"를 넣을 것.
- A1 **고쳐야 함**(확인 방법) — "390×400 창"은 크롬에서 레이아웃 화면 자체가 줄어든다. 그래서 `visualViewport.offsetTop>0` 인 아이폰 키보드 상태가 재현되지 않는다(지금 코드가 다루는 경우, `NumberInput.tsx:174-185`). 두 가지를 더한다. ① vitest 에서 `visualViewport` 를 목으로 바꿔(offsetTop 300, height 400) 줄의 top 이 그 안인지 본다. ② Playwright 에서는 CDP `Input.synthesizePinchGesture` 로 확대해 offset 을 0 이 아니게 만든다.
- A1 "사각형 교차 0" 재는 법 — Playwright 로 `.num-notice` 와 `.modal-head h3`, `.modal-head .icon-btn`, **치고 있는 칸 자신**의 `boundingBox()` 를 잰다. 교차 넓이는 `max(0,min(r)-max(l))*max(0,min(b)-max(t))` 로 구해 0 인지 본다. 화면 안인지는 `visualViewport` 사각형 안에 들어가는지로 본다. 칸 자신과의 교차를 조건에 더할 것(참고).
- A3 **고쳐야 함** — 일부 실패 → 다시 저장 성공으로 닫히면 N 이 마지막 회차의 수가 된다(`StockEditModal.tsx:155-166`). 일부 저장 뒤 ✕ 로 닫으면 `savedAny` 로 `onSaved` 가 불리는데(`:68`) 알림 줄이 없다. 팝업을 연 동안 **누적해 저장한 종목 수**로 정하고, ✕ 로 닫을 때도 그 수를 말하게 할 것. "다른 동작까지 남는다"는 시험할 수 있는 말로 정할 것(예: 팝업을 다시 열거나 화면을 떠나면 지운다)(참고).
- A4 참고 — "₩1,000,000 를"은 "백만 원을"로 읽혀 조사가 어긋난다. 새 돈만 나누기(`buyOnly`)에서는 "다시 계산"이 아니라 "나눴습니다"다(`RebalancePanel.tsx:1221`). "↑"는 `aria-hidden` 으로. 새 줄에 `role=status` 를 또 달면 위 줄(`:1218`)과 두 번 읽힌다.
- A2 참고 — 리밸런싱의 "거래 반영 · 팔았다" 수량 칸(`RebalancePanel.tsx:194`)에는 `minusHint` 를 붙이지 않는다. 그 칸은 판 수량을 넣는 칸이다. 시험에 그 칸이 "없음" 쪽으로 들어가야 한다.

## B. 진단·백업이 눈에 띄게

**찬성**: API 는 필드 하나만 더한다. 관리자 전용 엔드포인트라 시간대가 드러나도 해가 없다. 빨강·초록은 쓰지 않는다. `diag-warn` 는 라이트 `#a64d09`/흰 바탕에서 약 5.7:1 이다. B3 은 상수 둘이라 되돌리기 쉽다.

**걱정**
- B2 **고쳐야 함** — "꺼낸 기록 없음"을 `diag-warn` 로 만들면 노란 줄이 생긴다. 그런데 맨 위 요약(`backupWarnings().any`, `backupWarnings.ts:21`)과 서버 ⋯ 점(`backup.py:344-355`, 일부러 뺐다)은 그 경우를 세지 않는다. 0.45.1 C1 이 막은 "노란 줄은 있는데 위에는 경고 없음"이 되살아난다. 모양을 경고와 다르게(안내) 하거나, 요약에만 넣고 점은 빼는 식으로 기준을 적을 것.
- B3 **고쳐야 함** — 서버·화면 상수가 같은지 보는 시험이 **없다**(grep: `backupWarnings.ts:5` 주석뿐). 백엔드 시험이 `frontend/src/lib/backupWarnings.ts` 에서 `OFFSITE_STALE_DAYS = (\d+)` 를 읽어 `backup.OFFSITE_STALE_DAYS` 와 비교하게 할 것(`signalRulesLegacy.json` 대조와 같은 방식). 바꿀 기존 시험은 `test_backup.py:478-479`(29/31일)과 `DiagnosticsModal.test.tsx:297,421-432`("30일 동안…")이다. 말을 고칠 곳은 **`DEPLOY.md:409`·`README.md:94`**, `AuthGate.tsx:53`·`backup.py:345`·`backupWarnings.ts:17` 주석이다. 초안의 화면 말 목록에 DEPLOY 가 빠졌다.
- B5 **고쳐야 함** — "느린 요청·시그널 다시 계산 시각도 같은 꼴로"는 시간대가 없는 문자열을 바꾸는 일이다. `slow_requests.py:68,79` 는 `dt.datetime.now()`(서버 현지 시각), `signal_recompute.py:88` 은 `utcnow()`(UTC) 인데 둘 다 표시가 없다. `new Date()` 에 그대로 넣으면 9시간 어긋난다. 각각 무엇으로 읽을지(UTC 로 읽기 / 로그의 offset 쓰기 / 그대로 두기) 정하고 시험할 것.
- B5 **고쳐야 함** — 로그 시각 "2026-10-22 00:30:15" 를 `new Date(...)` 로 읽으면 아이폰 사파리에서 Invalid Date 다(가운데가 공백). jsdom 은 읽어 내서 시험이 못 잡는다. 정규식과 `Date.UTC` 로 읽을 것. 화면 시험의 "서울 시간대"는 `TZ` 를 고정해야 CI(UTC)에서도 뜻이 있다.
- B5 참고 — offset 하나는 "지금" 값이다. 서머타임이 있는 TZ, 또는 TZ 를 바꿔 다시 띄운 뒤의 옛 줄은 1시간이나 그 이상 틀린다. 줄마다 `time` 을 현지 시각으로 보고 `astimezone()` 로 offset 을 구하면 정확하다. 로그 파일이 없는 갈래(`logs.py:83-91`)에도 필드를 넣을 것.
- B1 참고 — `diag-warn` 은 글자색뿐이다(`index.css:5566`). "노랑 테두리 글"이 아니다. `summarize()` 가 문자열을 돌려주므로(`DiagnosticsModal.tsx:36`) 꼴을 바꿔야 한다.
- B4 찬성 — 읽기 이름은 이미 둘 다 말한다(`HeaderMenu.tsx:48`). 시험은 `menu-dot` 과 숫자가 같이 있는지 본다(`:58-64` 의 삼항을 푼다).

## C. 차트를 손가락으로

**찬성**: 규제·데이터 영향이 없고 점 색도 그대로다. jsdom 30 에 `PointerEvent` 가 있어 목 시험을 쓸 수 있다.

**걱정**
- C2 **고쳐야 함** — PC 에서는 차트를 누른 뒤 마우스를 ◀ 로 옮기면 차트를 떠나는 순간 `onMove(null)` 이 돈다. 그러면 가리킨 날이 마지막 날로 돌아간다(`PriceChart.tsx:155-158`). ◀ ▶ 가 늘 마지막 날에서 시작한다. "고른 날"을 hover 와 따로 두고, 1400 에서 "차트 클릭 → ◀" 을 완료 조건에 넣을 것.
- C2 **고쳐야 함**(접근성) — 끝에서 `disabled` 가 되면 키보드 포커스가 body 로 빠진다. 포커스를 반대쪽 단추로 옮기거나 `aria-disabled` 를 쓸 것. Tab 확인을 조건에 넣을 것.
- C3 **고쳐야 함** — `subscribeVisibleLogicalRangeChange` 는 폭이 바뀔 때도 돈다(`PriceChart.tsx:105` ResizeObserver, 폰 회전, 팝업 열림). 데이터 갈래만 빼면 "전체 보기"가 아무 때나 뜬다. 사람이 누르거나 휠을 쓴 뒤의 변화만 세고, "창 크기 바꾸기 → 단추 없음"을 조건에 넣을 것.
- C1 **고쳐야 함** — 세로 스크롤로 넘어가면 `pointercancel` 이 온다. 두 손가락(벌리기)은 한 손가락을 뗄 때 "탭"으로 잡힐 수 있다. 활성 포인터가 둘 이상이면 탭이 아니라고 보고, 시험에 cancel·두 손가락을 더할 것. "전체 보기" 단추를 차트 칸 안에 두면 그 탭이 차트 탭으로 올라온다(참고).
- C1 확인 방법 — 있다. `hasTouch:true` 문맥에서 `page.touchscreen.tap(x1)`, 300ms 쉬고 `tap(x2)` 를 한다. 기대 날은 같은 x2 를 1초 뒤 따로 한 번 탭했을 때의 읽기 줄로 잡는다. 밀기와 늦게 떼기는 CDP `Input.dispatchTouchEvent`(touchMove)로 한다. 라이브러리 dblClick 이 같이 돌지 않는지는 읽기 줄이 한 번만 바뀌는지로 본다.

## 공통 · 끝

- 호환: 옛 서버(필드 없음) 시험은 B5 만 해당되고, 초안에 있다(찬성). `types.ts` 의 `LogsResponse` 에 선택 필드로 넣을 것.
- 다섯 차트 시험 목: 실제로 lightweight-charts 를 목으로 바꾸는 시험은 7개다(`MacroChart.options`·`backToClose.modals`·`FundamentalsPage` 포함). 부품을 같이 쓰는 곳의 목도 확인할 것(참고).
