# 0.45.2 끝 검토 (전체 회귀·호환)

## 조건부 합격

내 worktree `scratchpad/r047/rvF` 에서 끝 커밋 `7f5adee` 을 받아 직접 돌렸다. 시작 커밋은 `d5bc80d` 이다. 빌드한 화면은 가짜 서버 8190 에 띄웠다. 시작 빌드를 따로 띄울 때는 `rvF-base` 를 8191 에 띄웠다.
회귀·호환·화면·문서·앞 판정 조건부는 모두 통과했다. 다만 daef49c 에서 새로 생긴 **창 전체 pointer 듣기** 코드에서 내 뮤테이션 3줄이 살아남았다. §3 합격선은 "살아남은 것 0"이다.
브라우저로 확인해 보니 동작은 셋 다 맞다. 시험만 비어 있다.

### 조건부 목록 (고쳐야 함)
1. **창 pointer 듣기 해제가 시험에 없다.** `PriceChart.tsx` 정리 함수에서 `window.removeEventListener('pointerdown', down, true)` 를 지워도 `src/components src/pages` 시험이 모두 통과한다.
   "닫으면 구독·듣기를 푼다"(`PriceChart.markers.test.tsx:477`) 시험은 창에 대해 `pointerup`·`pointercancel` 만 본다(`arrayContaining`).
   고칠 것: 창에서 `pointerdown`·`pointermove` 도 같은 capture 인자로 풀었는지 본다. 브라우저에서는 새는 것이 없었다. 대시보드에서 차트 팝업을 4번 열고 닫은 뒤 창의 pointer 듣기는 `0 → 0` 이었다(연 동안 6).
2. **마우스·터치 겸용 기기 시험이 없다.** 창 `pointermove` 의 `if (e.pointerType === 'mouse') pointing.current = { type: 'mouse', … }` 를 `if (false)` 로 바꿔도 시험이 통과한다.
   이 줄이 망가지면 터치스크린 노트북에서 한 번 탭한 뒤 마우스로 가리켜도 날짜 줄이 따라오지 않는다.
   고칠 것: 시험 하나를 더한다. 손가락 탭 → 마우스 `pointermove` → 십자선 이동 → 그 날로 바뀌는지 본다.
   브라우저(1400, `hasTouch`)에서는 맞게 돈다. `tap 2025-12-19 then mouse hover 2026-04-15 OK`, 떠나면 `2025-12-19` 로 돌아온다.
3. **마우스 끌기 뒤에는 가리킨 날을 고른 날로 삼지 않는다는 것이 시험에 없다.** `up` 의 `e.pointerType !== 'mouse' && held ?` 를 `held ?` 로 바꿔도 시험이 통과한다.
   이 줄이 망가지면 PC 에서 차트를 끌어 민 뒤 커서 아래 날이 고른 날이 된다.
   고칠 것: 시험을 더한다. 마우스로 클릭 → 끌기(10px 넘게) → 십자선 이동 → 떼기 → 떠나기를 한 뒤에도 처음 클릭한 날인지 본다.
   브라우저에서는 맞다. `mouse pan: picked 2026-01-19 after pan+leave 2026-01-19`.
4. **문서 한 줄이 낡았다.** `ROADMAP.md:95-96` 의 0-1 후보에 "360 팝업에서 '(마지막 날 …)' 풀이가 붙고 빠질 때 읽기 줄이 한 줄↔두 줄이라 차트가 20px 오르내린다"가 남아 있다.
   그런데 이것은 daef49c 가 고쳤다. 풀이를 늘 같은 길이로 두었고(`PriceChart.tsx` 의 `<span className="hint">{current ? …}`), `.chart-readout { min-height: calc(2 * 1.45em) }` 로 두 줄 자리를 잡았다. 이 줄을 지우거나 "0.45.2 에서 고침"으로 바꾼다.

### 참고 (막지 않음)
- 펜(`pointerType 'pen'`)은 손가락처럼 다룬다. 그래서 펜을 화면에 대지 않고 띄운 채 가리키면(Apple Pencil 호버·윈도 펜) 날짜 줄이 따라오지 않는다. 시작 버전에서는 따라왔다. 드물어서 막지 않는다.
- `pointing` 의 처음 값이 `mouse` 이다. 그래서 페이지를 연 뒤 첫 터치가 오기 전에는 흉내 마우스의 가리킴을 받는다.
  총괄 `steptop.js` 는 360/390 의 `top 130` 첫 회차에서 `BAD 4` 를 냈다. 이것은 Playwright 가 로그인 때 클릭한 자리에 마우스가 남아 있어서다. 같은 스크립트 앞에 터치를 한 번 넣으면(`steptop2.js`) `BAD 0` 이고, ◀ 는 `2026-10-22 → 10-21 → 10-20 → 10-19` 로 간다.
  실기기에서는 화면을 미는 첫 손가락이 `pointerdown touch` 라 생기지 않는다.
- daef49c 의 창 capture 듣기 넷은 `pointing` ref 에 값을 적기만 한다. `preventDefault`·`stopPropagation` 을 하지 않는다. 그리고 `PriceChart` 가 떠 있는 동안만 붙는다. 다른 화면의 입력을 해치지 않는다. 화면 검사의 콘솔 오류도 0 이다.
- 차트 위 세로 밀기는 CDP 터치에서 화면을 내리지 않는다. 시작 빌드도 같다. 8191 `vertical scroll 170 → 170`, 8190 `231 → 231` 이다. 회귀가 아니고, ROADMAP 0-1 에 이미 적혀 있다.

---

## §3 표

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 완료 조건 | 통과 | A: `check.js` A1 칸 줄 ∩ (h3·✕·칸) = 0, 화면 안에 들어옴. 1400·390·360 × 두 테마 × 첫·마지막 줄, `BAD 0`. A2 "판 수량이 아닙니다". A3 "✓ VOO 1종목을 저장했습니다". A4 "새로 넣을 돈 ₩1,000,000 반영 —" 가 화면 안. B: B1 꼬리 노랑 굵게, 대비 밝은 테마 5.70 · 어두운 테마 9.29. B4 `badge 1 dot 1`. B6 "벌" 0. C: 390·360 두 탭 60·200px → 두 번째 날(`2026-01-28 want 2026-01-28` 등). 밀기는 날을 바꾸지 않음(`swipe day 2026-07-30 → 2026-07-30`, 탭 없이도 같음). 길게 누른 채 밀기 `2026-03-03 → 2026-07-10`. 1400 클릭 → ◀ `2026-02-16 ◀ 2026-02-13`. ◀×3 `10-22 → 10-19`. ▶ 끝 aria-disabled. 단추 44px 이상. 전체 보기는 밀기·휠 뒤에 뜨고, 누르면 내려가며 차트 위치는 그대로. 360×640 팝업 날짜 축 607 ≤ 640 |
| 계획 때 걱정 | 통과 | `plan.md` 표·다시 보기 3건은 모두 "반영"이다. 막음 0. 다시 보기 셋은 A1 max(머리·팝업 위·vv) — A 검토가 확인했고 내 A1 측정도 겹침 0. B5 옛 서버 느린 요청은 시간대가 없으면 null 로 글자 그대로(`diagTime.ts` `naive === 'utc' ? utc : null`, 내 뮤테이션 F5 잡힘). C3 단추 줄은 형제로 두고 자리를 늘 잡아 둠(차트 위치 같음) |
| **회귀** | 통과 | pytest `1492 passed, 3 skipped`(시작 1487) · vitest `Test Files 62 passed · Tests 1009 passed`(시작 61·972) · lint 경고 22, 경고 종류·파일은 시작과 같다(줄 번호를 뺀 `diff` rc=0) · build `index-BuTuKtSQ.js 364.19 kB │ gzip 113.11 kB`(시작 112.42). 지운 `it(` 9개는 모두 이름을 바꾸거나 새 설계 시험으로 갈아 끼운 것이다(30→10일, 벌→개, dblClick → "click·dblClick 은 받지 않는다", "구독을 푼다" → "구독·듣기를 푼다"). 응답 사진: `snapshot.py rvF-snap 8192` 뒤 `snapdiff.py baseline/snap rvF-snap` → `같음 / 차이 0` |
| 격리 | 해당 없음 | 새 엔드포인트·표 없음. `at` 은 이미 주인만 보는 로그 응답에 더한 필드 |
| 마이그레이션 | 해당 없음 | `git diff d5bc80d..7f5adee -- backend/alembic` 0줄 · `alembic heads` → `0015 (head)` |
| **호환** | 통과 | `apidiff.py` → `빠짐 0 · 타입 바뀜 0 · 더해짐 1 ['LogEntry.at']`. 옛 화면 + 새 서버: 옛 `shortTime` 은 `^\d{4}-(\d{2}-\d{2})T(\d{2}:\d{2})` 앞부분만 읽어 `+09:00` 이 붙어도 같은 글자다(`d5bc80d:DiagnosticsModal.tsx:55-58`). 새 화면 + 옛 서버: `DiagnosticsModal.test.tsx` "옛 서버면 글자 그대로" 통과. 옛 요청: 받는 값 바뀐 것 없음 |
| 입력 한도 | 해당 없음 | 서버로 가는 새 값 없음 |
| 뮤테이션 | **실패(조건부 1·2·3)** | 실행자 `mutation.md` 는 41줄 + 조건부·사용자 뒤 13줄이 모두 잡힘. 앞 판정 조건부를 내가 다시 돌린 6줄은 모두 잡힘(A vv offsetTop · A 대시보드 다시 열기 · B 오프셋 분 · C ◀ 가리킨 날 · C 마우스 240ms · C 창에서 놓기). 내 새 7줄: F3 손가락 누른 동안 가리킴 · F5 시간대 없는 값 UTC · F6 서버 11일 · F7 `at` 시간대 → 잡힘. **F1 창 pointerdown 해제 · F2 겸용 기기 마우스 복귀 · F4 마우스 끌기 뒤 가리킨 날 → 살아남음**. 끝난 뒤 `git status` 깨끗 |
| 비밀 | 해당 없음 | 키·외부 호출 없음 |
| 규제 | 통과 | `git diff d5bc80d..7f5adee -- frontend/src backend/app` 의 더한 줄에서 `추천\|사세요\|팔라\|저평가\|예측` → 0줄. 규제 영향 없음(계획) |
| 데이터 경계 | 해당 없음 | 표 없음 |
| 외부 호출 | 해당 없음 | 없음 |
| 화면 | 통과 | 내 빌드 + 8190(`--demo-backup-warning`): `check.js` 1400·390m·360m × 두 테마 → `BAD 0`(가로 넘침·콘솔 오류 포함). 150%(933×600, dpr 1.5) × 두 테마 → `BAD 0`. `modals.js` 360×640 worst 607. 키보드 Tab(1400·390): `… 1년 \| 5년 \| 전체 \| 이전 거래일 \| 다음 거래일[dis]` → 숨은 "전체 보기"는 건너뛰고 다음 링크로 감. ◀ 에 Enter 두 번 → `2026-10-20`, 포커스는 ◀ 에 남음. 스크린샷(`rvF-shots/360-dark-c3-fit.png`·`360x640-chartmodal.png`)은 눈으로 봤다. 첫 판(서버 플래그 없이)의 `B1 no tail` 6건은 데모 플래그를 안 준 내 실수다. 다시 돌려 0건 |
| 말 | 통과 | 용어집 0.45.2 여섯 줄의 말이 코드에 있다(`numberDropped.ts`·`NumberInput.tsx`·`DiagnosticsModal.tsx`·`display.ts`·`PriceChart.tsx`·`RebalancePanel.tsx:1202`). 진단 화면에 "벌" 없음. A 사용자 뒤 한 종목 문구는 화면에 "VOO 1종목을 저장했습니다" 로 나옴 |
| 성능 | 통과 | `perf_dashboard2.py` → `median 41.0 ms, queries 12`(시작 40.1 ms·12). 서버 대시보드 길은 바뀌지 않았다. JS gzip +0.69 kB 는 문구와 차트 코드 몫이다 |
| 가짜 서버 | 통과 | `--demo-backup-warning` 에서 꼬리 노랑·⋯ 숫자와 점이 같이 보임. `test_devtools.py` 는 전체 pytest 안에서 통과 |
| 문서 | **조건부 4** | `version.py:144 APP_VERSION = "0.45.2"` · README "화면 구성" 0.45.2 세 줄이 코드와 맞음 · DEPLOY 10일(:94 외) · ROADMAP 11-6 이 커밋과 맞음 · `mutation.md` 표가 실제 결과와 맞음(내가 다시 돌린 6줄). 다만 `ROADMAP.md:95-96` "20px 오르내린다"는 이미 고친 것이다 |

## 앞 판정 조건부를 고친 것

| 판정 | 조건 | 지금 |
| --- | --- | --- |
| A | visualViewport 컴포넌트 시험 | `NumberInput.test.tsx:425` 이 vv `{offsetTop:200,height:400}` 에서 `552px` 를 본다. offsetTop 을 빼는 뮤테이션은 잡힘 |
| A | 대시보드 다시 열 때 지우기 | `Dashboard.portfolio.test.tsx` 에서 `openEditor()` 뒤 줄 없음. `setSavedNote('')` 를 지우는 뮤테이션은 잡힘 |
| B | 분 오프셋 | `diagTime.test.ts:14-16` `+05:30`·`-03:30`. 분을 버리는 뮤테이션은 잡힘 |
| C | 마우스 천천히 끌기 · 차트 밖에서 놓기 · ◀ 고른 날 | 시험 셋 있음. 세 뮤테이션 모두 잡힘. 브라우저 1400 에서 클릭 → 떠나기 → ◀ 는 고른 날에서 |
| A 사용자 | beaa4bc 한 종목 문구 | 화면 `✓ VOO 1종목을 저장했습니다` |
| BC 사용자 | daef49c ◀ 가 위쪽에서 멈춤 | 터치 한 번 뒤 `steptop2.js` 360/390 × VOO/SCHD × top 130/60/20 → `BAD 0`. 데이터가 바뀌면 고른 날·십자선을 버림(시험 있음, 뮤테이션 잡힘). 팝업 316 → 607/640. 새 결함은 위 조건부 1–3(시험 빈 곳)과 참고(펜) |

## 끝 상태

```
$ git -C scratchpad/r047/rvF status
Not currently on any branch.
nothing to commit, working tree clean
```
worktree `rvF`·`rvF-base` 는 지웠다(`git worktree list` → `/home/user/Dashboard 7f5adee [claude/new-session-fftcg1]` 하나). 가짜 서버 8190·8191 은 PID 로 껐다. 저장소에 쓴 것은 이 파일 하나다. CI 는 PR 이 아직 없어 보지 못했다.
