# 디자인 2차 계획 재검토 — 검토자 (바뀐 부분만, 읽기만)

본 것: plan.md 1장 R1~R11, 3장 전체, `git diff ad9ba7f -- docs/design/audit.mjs`, /tmp/claude-0/work/audit-try·audit-try2 (audit-base-v2 는 아직 비어 있다).
도는지: try 에서 `dash-signal-xcond` 의 cond-missing 이 카드 15(4/5)·표 줄 15(4/5)로 잡힌다. 바뀌지 않은 `dash-signal` 은 0이고 카드 높이 중앙값은 596(ph390-dark)이다. try2 에서는 nowrap-split·sticky-left 가 0으로 돈다. `-cards-xcond`·매크로·손님 화면은 try 에 없다.

- R1 덜 풀림(참고): 기준이 숫자로 박혀 막음은 풀렸다. 다만 "문단 10·버튼 5"와 "재무 8·매크로 2·150% 1"은 옛 기준선 숫자다. 조건(빨강+라이트)이 하나 늘었으니 audit-base-v2 의 숫자로 다시 적어야 한다.
- R2 풀림. 화면 이름은 audit.mjs 에 다 있다(modal-chart-fund/-ai 는 audit.mjs:142-143).
- R3 풀림. 응답을 바꾸는 방식이고 버전은 건드리지 않는다. `\bcond\b` 는 `cond-mark` 도 배지로 센다. 의도와 맞는다.
  - 새 걱정(고쳐야 함): `cardChecks` 는 모든 화면에서 `.stock-card` 를 고른다. 매크로 카드도 `stock-card macro-card` 다(MacroPanel.tsx:254). 그래서 `macro` 화면에서는 매크로 카드마다 cond-missing(0/4)이 잡히고, 카드 높이 표에도 섞인다. 손님 화면에서는 `fetch('/api/signal-rules')` 가 401 을 받는다(signal_rules.py:25 `current_user_id`). 이때 Chromium 이 "Failed to load resource" 콘솔 오류를 남겨 "콘솔 0 → 0"을 거짓으로 깰 수 있다. 다음 셋을 고친다. 고르는 선택자는 `.stock-card:not(.macro-card)`(또는 `.signal-card`, 기준선과 같이), fetch 는 `view: 'signal'`·`xcond` 화면에서만 한다. 그리고 기준선을 뜨기 **전에** 고친다.
- R4 풀림(참고): 목표 500 과 시안 493 의 차이가 7px 뿐이다. 데모 시세가 날짜로 바뀌므로 검토 날 기준선(지금 코드)을 같은 날 다시 재서 함께 적는다.
- R5 풀림. R6 풀림: sticky-left 검사는 `.signal-table` 밖을 잡는다. 이 클래스는 지금 없다(A8 에서 붙인다). 이름이 다르면 검사가 바로 걸리므로 거짓 0은 아니다.
- R7 풀림. `.metric-chip` 은 Dashboard.tsx:257 한 곳에만 있다. 조건 추가는 audit.mjs:50 에 있다.
- R8 풀림. R10·R11 풀림(눈으로 / 보고).
- R9 덜 풀림(참고): nowrap-split 은 `.nowrap` 클래스만 본다. B1·U6 가 묶음을 다른 클래스로 만들면 그 묶음은 재지 않는다. 계획에 "묶음은 `.nowrap` 으로"를 적는다.
- 3장 cond-missing 칸의 "(15 × 조건)"은 "카드 15·표 줄 15, 조건마다"로 적어야 덜 헷갈린다(참고).

## git status
```
$ git -C /home/user/Dashboard status --short
(출력 없음이면 깨끗)
```
