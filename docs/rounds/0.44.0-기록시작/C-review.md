# 0.44.0 C 작은 고치기 2 — 검토 판정

## 조건부 합격

- 범위: `561ae95`(C1·C2·C3), `1824fc1`(맨 끝 빈 칸 탭). 라운드 시작 `4844bf0`. worktree 는 `origin/claude/new-session-fftcg1` = `1824fc1` 에서 마지막으로 확인.
- 화면에서는 완료 조건이 모두 맞게 동작한다. 남은 것은 **뮤테이션 둘이 살아남은 것**뿐이다(테스트 빈틈. 화면은 지금 맞다). 둘 다 테스트 한 줄씩이면 메울 수 있다.

### 조건 (합격 전에 할 것)
1. **차트 한 줄의 통화 테스트.** `PriceChart.tsx` 의 `chartPrice(shown.close, currencyOfTicker(history.ticker))` 를 `chartPrice(shown.close, 'USD')` 로 바꿔도 PriceChart·ChartModal·HistoryChart 테스트가 모두 통과한다. 원화·엔화 종목의 한 줄을 확인하는 테스트가 없다. 브라우저에서는 지금 맞다: 삼성전자 `2026-10-19 · 종가 43,934`, 토요타 `3,936`, SCHD `49.72`.
2. **"기술적 원인" 테스트.** `client.ts` 에서 `technical || body)` 를 `body)` 로 바꿔도 `client.test.ts` 가 통과한다. `toContain('Input should…')` 는 JSON 본문 전체에도 들어 있어서 잡지 못한다. 이렇게 되면 "기술적 원인 보기"를 펼쳤을 때 JSON 원문이 다시 나올 수 있다. `toBe(...)`, 또는 `not.toMatch(/\{/)` 를 더하면 된다.

### 참고 (막지 않음, 다음 후보)
- **시그널 기준 422.** `PUT /api/signal-thresholds` 에 `{"adx_trend":500}` 을 보내면 서버는 이렇게 준다: `{"type":"value_error","loc":["body"],"msg":"Value error, adx_trend: 10 ~ 40 사이여야 합니다","ctx":{"error":{}}}`. 서버 말은 이미 한국어다. 그런데 새 해석기는 이를 "입력값을 확인해 주세요 — 입력값은 올바르지 않습니다"로 바꾼다. `SignalThresholdsModal.tsx:121` 은 `e.message` 만 보여서 서버의 한국어 범위는 화면에 나오지 않는다. 화면이 먼저 범위를 거르므로(`valid`) 지금은 화면·서버 범위가 어긋날 때만 닿는다. 예전 JSON 원문보다는 낫다. 다만 `value_error` 의 msg 가 한글이면 `Value error, ` 를 떼고 그대로 쓰면 더 정확하다.
- **날짜 칸 422.** `review_date_override: "2026-13-45"` 를 보내면 오는 `date_from_datetime_parsing` 은 `_parsing` 갈래에 걸려 "입력값은 숫자여야 합니다"가 된다. 날짜 칸에 맞지 않는 말이다. 화면은 `<input type=date>` 라 사실상 닿지 않는다.
- **한쪽 범위만 나온다.** 실제 pydantic 422 의 `ctx` 에는 넘은 쪽 한도만 온다(`{"le":100.0}`). 그래서 "0~100 사이" 갈래(`client.ts` 의 `n(ctx.le) && …ge`)는 실제 서버에서는 나오지 않고 테스트의 합성 값에서만 나온다. 사용자 확인 C-user.md:24 "위쪽 한도만 알려 준다"와 같은 이야기다.
- **360 에서 차트가 위로 20px 올라간다.** 첫 탭에 "(마지막 날 — 차트를 누르면 그 날)"이 빠지면서 한 줄 높이가 41.3→21.1px 로 줄고, 차트가 20px 위로 올라간다(chart y 396→376). 390·1400 에서는 21px 그대로라 움직이지 않는다. C-user.md:27 과 같다.
- **빠른 두 번째 탭은 무시된다.** 0.5초 안에 다시 탭하면 두 번째 탭이 무시된다. lightweight-charts 가 500ms 안의 두 번째 탭을 더블탭으로 보기 때문이다(`lightweight-charts.development.mjs:8348`, `Delay.ResetClick 500`). 400ms 간격 탭에서 두 번째마다 한 줄이 그대로였고(아래 표), 1000ms 간격에서는 9/9 반영됐다. C-user.md:16 과 같다.
- **기간·종목을 바꾼 뒤(터치).** 커밋 글은 "가리킨 날을 버린다"고 하지만, 실제 차트에서 터치 십자선은 같은 픽셀에 남는다. 그래서 한 줄은 새 데이터에서 그 픽셀의 날을 말한다(예: 1년 06-23 → 5년으로 바꾸면 02-27, 종목 VOO 로 바꾸면 07-20). 스크린샷(`m360-hist-5y.png`, `m360-hist-ticker.png`)에서 축 이름표·점과 한 줄이 같은 날이므로 어긋나지는 않는다. PC 마우스는 떠나면 마지막 날로 돌아간다. 테스트의 "종목을 바꾸면 마지막 날"은 흉내 차트에서만 그렇다.
- **C 범위 밖.** `tests/test_devtools.py::test_demo_custom_thresholds_shows_my_thresholds` 가 지금 머리와 라운드 시작 `4844bf0` 에서 **둘 다** 실패한다(`assert 4 != 4`). 오늘 날짜(10-19)에 따라 데모 데이터가 달라지는 것으로 보인다. C 는 backend 를 건드리지 않는다. 총괄이 따로 봐야 한다.
- **C 범위 밖, 원인 미확인.** 리밸런싱 360×900 에서 "바뀐 1줄 저장" 단추(y=835, 아래 탭 막대 근처)를 Playwright 터치 `click` 으로 누르면 요청이 나가지 않았다. JS `click()` 으로는 PUT 이 나가고 C2 문구가 떴다. Playwright 쪽 문제일 수도 있다.

## §3 표

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 완료 조건 C1 | 통과 | 실제 차트(빌드 뒤 가짜 서버 8185, friend, `hasTouch`+`touchscreen.tap`). 1000ms 간격 360 탭 9번이 모두 그 자리 날로 옮겼다: `tap 0.2 → 2025-12-31`, `0.4 → 2026-03-16`, `0.6 → 05-28`, `0.8 → 08-11`, `0.3 → 02-05` … 스크린샷의 축 이름표·점이 한 줄과 같다(`m360-modal-0.75.png`: 축 "2026-09-22" = 한 줄 "2026-09-22 · 종가 51.97"). 처음 화면은 `2026-10-19 · 종가 49.72 (마지막 날 — 차트를 누르면 그 날)`. PC 마우스: 움직이면 그 날, 떠나면 마지막 날(`leave-1400-2leave.png`, 십자선도 사라진다). 클릭 뒤 떠나도 마지막 날로 돌아온다. 팝업(대시보드 → 차트)과 `/history` 둘 다, 360·390(터치)·1400(마우스) × 라이트·다크. 가로 넘침 0(scrollWidth = 폭), 콘솔 오류 0 |
| 완료 조건 C1 (1824fc1 맨 끝) | 통과 | 폰 390 그림 칸 오른쪽 끝 3px 안쪽 탭 → `2026-10-19 · 종가 49.72`, 십자선·축 이름표 "2026-10-19"(`edge-390-history.png`). 팝업 390, `/history` 360, PC 1400 클릭 둘 다 같다. 왼쪽 끝 2px 은 첫 날(2025-10-22). 오른쪽 가격 축 탭은 아무것도 바꾸지 않는다. 콘솔 오류 0 |
| 완료 조건 C2 | 통과 | 실제 서버 응답: `PUT /api/stocks/SCHD {"rebalance_band_pct":201}` → `{"detail":[{"type":"less_than_equal","loc":["body","rebalance_band_pct"],…"ctx":{"le":100.0}}]}`. 화면 "종목 한 번에 수정"(1400·360): `저장하지 못한 종목: SCHD — 나머지는 저장했습니다.` + `입력값을 확인해 주세요 — 밴드는 100 이하여야 합니다`, 단추 `1종목 저장`. 영어 원문은 접힌 "기술적 원인 보기" 안에만 있다(`Input should be less than or equal to 100`, `c2-360-bulk.png`). 리밸런싱 표 밴드 201(`PUT /api/rebalance/targets/SCHD`)도 같은 한 줄. 다른 실제 422 를 해석기에 넣으면: 수량 −1 "수량은 0 이상이어야 합니다", avg_fx 0 "산 환율은 0보다 커야 합니다", "abc" "수량은 숫자여야 합니다", 현금 목표 150 "현금 목표 비중은 100 이하여야 합니다", 메모 201자 "메모는 200자 이하여야 합니다"(화면 칸은 `maxlength=200`), 예상치 `PUT /api/macro/SP500/forecast value 270` → `loc [body,value] le 100` → "예상치는 100 이하여야 합니다". 은/는: 밴드·메모·예상치=는, 수량·산 환율·목표 비중·현금 목표 비중·입력값=은 — 맞다(`topicParticle`, `client.ts`). 단 시그널 기준 422 는 위 참고 |
| 완료 조건 C3 | 통과 | 360·390·1400 × 두 테마: 고르기 전 라벨 `평단가`(단위 없음), 도움말 `평단가(그 종목을 거래하는 통화 기준)`, 구분 자리표시 `비워 둬도 됩니다`, 평단가 자리표시 `모르면 비움`. 글자 폭 73.1px < 칸 안쪽 118px(360)이라 잘리지 않는다(`c3-360.png`). 현대차를 고르면 `평단가 (₩)` |
| 계획 때 걱정 | 통과 | plan-dev C1(고쳐야 함: 동작을 먼저 정하기) → plan.md C1 에 정했고 실제 터치로 확인. C2 `Array.isArray` 갈래 → `client.ts` parseError. C3 "($)" 남음 → 고침. 360 잘림 → 화면으로 확인. plan-review 걱정 2(서버 한도는 그대로) → C 커밋에 backend 변경 0. plan-user C1·C2 재현 → 위에서 해결 확인. 막음 0 |
| 회귀 | 통과 (C 와 무관한 실패 1) | 프런트 `vitest --maxWorkers=2`: 561ae95 에서 901, 머리 1824fc1 에서 **906 passed**(시작 884). 백엔드 머리: `1 failed, 1406 passed, 3 skipped`. 실패한 하나는 `test_devtools::test_demo_custom_thresholds…` 로 `4844bf0` 에서도 실패한다(날짜에 따라 달라짐, 위 참고). C 커밋의 backend 변경: `git show --stat 561ae95 -- backend`·`1824fc1` 둘 다 0줄 → 응답 사진은 C 로 바뀔 수 없다. lint 경고 22(시작 22). 첫 화면 JS gzip 111.19 kB(시작 111.04, +0.15 — 422 해석기) |
| 격리 | 해당 없음 | 새 엔드포인트 없음 |
| 마이그레이션 | 해당 없음 | 없음 |
| 호환 | 통과 | `apidiff.py baseline/openapi.json ↔ 머리` → `빠짐 0 · 타입 바뀜 0 · 더해짐 3`(A 의 `/api/admin/records`·`value_record`). 해석기는 detail 이 목록일 때만 새 길로 가고, 객체·문자열 detail 은 예전 갈래 그대로(`client.ts` parseError). 옛 서버의 422 도 같은 모양이다 |
| 입력 한도 | 해당 없음 | 새 입력 없음. 서버 한도는 그대로(plan-review 걱정 2) |
| 뮤테이션 | **실패 (2 살아남음)** | 실행자 12/12 + 1824fc1 1개는 `C-mutation.md` 에 있다. 그중 3개를 다시 돌려 확인했다(탭에 십자선 안 옮김·구분 회색 지수·종목 바꿔도 유지 → 잡힘). 직접 12줄: loc 뒤집기 없음·missing 갈래 없음·gt 를 '이상'으로·한 칸짜리 422 옛 길·빈 자리 탭 막기 없음·마지막 날 안내 늘 숨김·평단가 자리표시 옛 말·(1824fc1) 빈 칸 갈래 끔·NearestLeft→NearestRight·빈 칸에서 한 줄 안 바꿈 → **잡힘 10**. `technical \|\| body` → `body`, 한 줄 통화 늘 USD → **살아남음 2**(조건 1·2). 돌린 도구는 `…/r044/revC/pw/mut*.py` 이고, 저장소 줄은 매번 되돌렸다(끝의 git status 깨끗) |
| 비밀 | 해당 없음 | 키·비밀 길 변경 없음 |
| 규제 | 통과 | `git diff 561ae95^ 1824fc1 -- frontend/src ':!*.test.*' \| grep '^+' \| grep -E '추천\|사세요\|팔라\|저평가\|예측'` → 0건. 규제 영향 없음 |
| 데이터 경계 | 해당 없음 | 새 테이블 없음 |
| 외부 호출 | 해당 없음 | 없음 |
| 화면 | 통과 (참고 둘) | 360·390 터치, 1400 마우스 × 라이트·다크. 가로 넘침 0, 콘솔 오류 0(검사가 일부러 보낸 422 빼고). 새로 생긴 포커스 가능한 요소는 없다(한 줄은 `<p aria-live="polite">`). 360 의 20px 올라감, 빠른 두 번째 탭은 참고 |
| 성능 | 통과 | 첫 화면 gzip +0.15 kB, 이유 있음(해석기) |
| 가짜 서버 | 해당 없음 | 새 상태 없음(422 는 실제 서버 검사로 바로 나온다) |
| 문서 | 통과 | `C-mutation.md`·`status.md` 에 1824fc1 반영. README·version 은 19d2d8d(C 밖) |

### 빠른 탭 표 (360, 400ms 간격, `taps.js`)
```
tap 0.2 -> 2025-12-31   tap 0.4 -> 2025-12-31 (무시)   tap 0.6 -> 2026-05-28   tap 0.8 -> 2026-05-28 (무시)
tap 0.3 -> 2026-02-05   tap 0.7 -> 2026-02-05 (무시)   tap 0.1 -> 2025-11-24   tap 0.9 -> 2025-11-24 (무시)
```

## 자료
- 스크린샷: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r044/revC/shots/`
- 스크립트: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r044/revC/pw/` (c1.js · taps.js · leave.js · edge.js · c2api.py · c2api2.py · c2ui.js · c3.js · mut*.py)
- 가짜 서버: 포트 8185, 데이터 `…/r044/revC-data`(검토 중 처음 만들었다). 마지막 PID 8607 은 `kill $(cat …/revC/server.pid)` 로 껐다 → `curl /api/health` 응답 없음. 멈추기 전에 띄운 PID 8443 은 이어서 볼 때 이미 없었다. 315 도 같은 방법으로 껐다.

## worktree git status
```
$ git status
HEAD detached at origin/claude/new-session-fftcg1
nothing to commit, working tree clean
$ git log --oneline -1
1824fc1 C: 차트 맨 끝(빈 칸)을 누르면 마지막 날로 — 오늘로 돌아가는 길
```
