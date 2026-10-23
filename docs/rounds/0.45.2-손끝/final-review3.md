# 0.45.2 끝 검토 세 번째 (662c977)

## 조건부 합격

내 worktree `scratchpad/r047/rvF3` 에서 `662c977` 을 받아 직접 돌렸다. 빌드는 `index-BSjMr_aD.js` 이고, 가짜 서버 8193 에 띄웠다.
비교하려고 앞 커밋 `31b11a8` 도 따로 빌드했다(`rvF3old`, `index-BMc_7QKE.js`, 8194). 그리고 같은 스크립트를 두 판에 돌렸다.
**final-review2 의 불합격 사유 1·2(PC 전체 보기 뒤 날 어긋남, 폰 관성 중 전체 보기)는 브라우저에서 고쳐졌다.** 앞 판정의 N4·N6·N7 도 이제 잡힌다.
다만 새 줄에 내가 넣은 뮤테이션 중 2줄이 살아남았다(§3 합격선 "0"). 그 가운데 M4 는 브라우저에서 바로 **final-review2 의 1번을 되살린다**.

### 조건부 목록 (고쳐야 함)
1. **M4: 마우스 누름도 `touch` 로 들면 살아남는다.** 이 줄이 망가지면 final-review2 의 1번이 되살아난다.
   - 바꾼 줄: `PriceChart.tsx:214` `if (e.pointerType === 'touch') pointing.current.touch = true` → `if (e.pointerType) pointing.current.touch = true`
     - `e` 를 아예 안 쓰게 바꾸면 `tsc -b` 가 TS6133 으로 막는다. vitest 만으로는 둘 다 통과한다.
   - 이렇게 되면 마우스로 한 번 누른 뒤 `touch` 가 내려가지 않는다(`lift` 는 손가락만 본다). 그래서 차트 밖에서 오는 라이브러리 알림을 다시 받는다.
   - 브라우저 확인: 이 뮤테이션으로 빌드(`index-BQcq9aak.js`, 8195)하고 `pc.js` 를 돌렸다. `◀ 01-19 → 전체 보기 read 2026-01-15 → ◀ 2026-01-16`(◀ 가 뒤로 감), `◀ 03-17 → 전체 보기 read 2026-05-01`.
   - 필요한 시험: 마우스로 누르고 뗀 뒤 차트를 떠난 상태에서 라이브러리 가리킴이 오면 받지 않아야 한다.
2. **M7: `window.addEventListener('pointercancel', lift)` 를 지워도 살아남는다.**
   - 손가락 누름이 취소로 끝나면(브라우저가 스크롤·확대로 가져감) `touch` 가 켜진 채 남는다. 그러면 폰에서 관성·코드 십자선 알림을 다시 받는 길이 열린다. 이것은 final-review2 의 2번과 같은 원인이다.
   - 닫기 시험(`:598`)은 창에 붙인 종류가 `pointerup`·`pointercancel` 인지 본다. 그러나 탭 effect 도 창에 `pointercancel` 을 붙이기 때문에(`PriceChart.tsx:315`) 이 줄이 빠져도 집합이 같다(아래 "참고").
   - 필요한 시험: 손가락 `pointerdown` 뒤 `pointercancel` 를 보내고, 그 다음 오는 라이브러리 가리킴을 받지 않는지 본다.

### 참고
- **M11**: 손가락의 pointerleave 도 처리하는 뮤테이션(`if (e.pointerType === 'touch') return` 지움)은 살아남았다.
  - 손가락은 누른 요소에 붙잡혀(implicit capture) 뗀 뒤에야 leave 가 온다. 그리고 `up` 은 그 전에 `held` 를 읽는다. 그래서 거의 같은 동작으로 본다. 고칠 것으로 세지 않는다.
- **M7 집합 검사가 통과한 까닭**: 지운 것은 `addEventListener` 줄 하나다. 그런데 닫기 시험은 `addWin` 스파이가 잡은 것만 "붙인 것"으로 센다. 그래서 붙이지 않은 `pointercancel` 은 처음부터 목록에 없다.
  - 그래도 `toEqual(new Set(['pointerup','pointercancel']))` 이 통과한다. 탭 effect 가 창에 `pointercancel` 을 붙이기 때문이다(`PriceChart.tsx:314-315`).
  - 그러니 이 집합 검사로는 "가리킴 effect 가 창 `pointercancel` 을 듣는다"를 지킬 수 없다.
- **흉내 브라우저에 남은 마우스**(호출자 말대로 흉내 브라우저의 일, `mouse.move(1,1)` 로 치운 뒤 판정): 그래도 동작이 앞과 달라진 점을 적는다.
  - 로그인 때 클릭한 마우스 자리가 차트 위에 남아 있다. 이 상태에서 손가락으로 ◀ 를 누르면 다음과 같다.
    - 31b11a8: 첫 탭부터 손가락이 이긴다. `steptop.js` 치우지 않은 판 `BAD 4`, 첫 줄만 틀린다.
    - 662c977: 마우스 가리킴이 늘 이긴다. `BAD 12`, ◀ 세 번이 다 그 날(`2026-06-05 → 06-05 06-05 06-05`)에 머문다.
  - 로그(`stale.js`)를 보면 탭 뒤 13ms 에 크롬이 `mouseover CANVAS` 를 다시 보내 마우스 가리킴이 돌아온다.
  - `check.js` 360 의 `swipe day 09-03 → 10-14`(31b11a8 은 `09-03 → 09-03`)도 같은 까닭이다. 마우스를 치우면 `09-03 → 09-03` 이다.
  - 실제 폰에는 마우스가 없다. 다만 **터치 노트북에서 마우스 커서를 차트 위에 둔 채 손가락으로 ◀ 를 누르는 경우**가 실기기에서 같을 수 있다. 주인 확인 목록에 넣기를 권한다.
- 폰에서 휙 민 뒤의 읽기 줄(`phone.js` `tap 03-09 → swipe 07-21`)은 31b11a8 과 같은 값이다. 바뀐 것이 아니다.
- `phone.js` 의 `fit3 read 10-20 cross 09-01`, 오른쪽으로 민 판의 `fit read 10-23 cross 12-23` 은 측정 문제다.
  - 십자선 날짜 이름표가 차트 끝에서 안쪽으로 밀려 그려져서 그 가운데 x 가 딴 날로 읽혔다.
  - 측정 없이 찍은 `edge-390-fit.png` 을 보면 세로선이 오른쪽 끝 10-20 자리에 있고, 가격 이름표 `92.58` 이 읽기 줄 종가와 같다. 31b11a8 도 같은 값이다.
- `measureEvery=true`(폰 흉내에서 마우스로 잴 때마다 가리킴이 섞임)의 어긋남도 31b11a8 과 같다. 다른 곳은 fit2 하나뿐이고, 그것은 고쳐진 쪽이다(아래 표).

---

## 확인한 것

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 앞 불합격 1 (PC 클릭→휠→◀→전체 보기) | 통과 | `rvF3-pw/pc.js`, 1400, hasTouch 없음·있음 × 매번 잼·안 잼 네 판 모두 같음. `◀ 01-19 → *fit read 2026-01-19 cross 2026-01-19 → *◀ 2026-01-16/01-16`. `◀ 03-17 → *fit 03-17/03-17 → *◀ 03-16/03-16`. 키보드 전체 보기 `03-16/03-16`. 31b11a8 에서는 `fit read 01-14 → ◀ 01-15` 였다. `dbg5.js`: 전체 보기 click 뒤 `READ` 줄이 하나도 없음(앞 판은 21ms 뒤 `READ 2026-01-14`). `dbg.js`: `fit 2026-01-19 … fit+mouse away 2026-01-19` |
| 앞 불합격 2 (폰: 밀고 곧바로 전체 보기) | 통과(±1 은 측정 오차) | `dbg4.js` 390·360 × moves 8/20 × 기다림 300/1500/3000ms 열두 판: 읽기 줄은 늘 민 뒤 그 날, ◀ 는 늘 하루 앞. 예: `after swipe 01-22 → fit read 01-22 cross 01-23 → ◀ read 01-21 cross 01-22`, `360 moves=8 300ms 01-23 → fit 01-23/01-23 → ◀ 01-22/01-22`. `phone.js` fit2: 31b11a8 `read 2026-01-14 cross 2026-09-01` → 662c977 `read 2026-01-22 cross 2026-01-23`(390, 네 판), 360 `01-23/01-23`. `dbg3.js`: 전체 보기 탭 뒤 READ 없음(앞 판 `READ 01-20 … 01-13`) |
| 읽기 줄과 ◀ 의 앞뒤 | 통과 | 위 모든 판에서 ◀ 뒤 읽기 줄은 앞 읽기 줄보다 하루 앞(거래일)이었다. 첫 날(2025-10-23)에서는 ◀ 가 멈춘다(`◀ 10-23 → ◀ 10-23`). 31b11a8 과 같다 |
| 앞 N4·N6·N7 | 통과 | `MUT_REPO=rvF3 python mutate.py`(`npx vitest run src/components src/pages`): N4 `day.of !== history ||` 지움 → 잡힘. N6 enter `=== 'mouse'` → 잡힘. N6b leave `!== 'mouse'` → 잡힘. N7 `cancelAnimationFrame(frame)` 지움 → 잡힘. 시험: `PriceChart.markers.test.tsx` "종목·기간을 바꾼 뒤의 구간 사건…", "펜은 마우스처럼…", "한 그림 안에 여럿 와도 한 번만" |
| 뮤테이션 (새 줄 직접 15줄) | **실패(조건부 1·2)** | 잡힘: M1 손가락도 over · M2 leave 의 hoverRef 비움 지움 · M3 leave 의 setHover 지움 · M5 lift `if (false)` · M6 container pointermove 안 들음 · M8 거름 줄 지움 · M9 `!over` 만 · M10 `!touch` 만 · M12 deps `[]` · M13 pointerleave 해제 지움 · M14 pointerup 해제 지움 · M15 pointerenter 안 들음. **살아남음: M4 마우스 누름도 touch · M7 창 pointercancel 안 들음 · M11 손가락 leave 처리(같은 동작, 참고)**. 끝난 뒤 `git -C rvF3 status` 깨끗 |
| 실행자 `mutation.md` | 맞음 | 실행자 N1–N8 의 이름과 내가 겹쳐 돌린 N4·N6·N7 결과가 같다. M4·M7 은 실행자 표에 없다 |
| 손가락 탭 뒤 흉내 마우스 (`steptop.js`) | 통과(마우스 치운 뒤) | `mouse.move(1,1)` 뒤: 360·390 × VOO·SCHD × top 130·60·20 → `BAD 0`. 예: `390 VOO top 20 btnY 49 2026-10-15 → 2026-10-14 2026-10-13 2026-10-12 OK`. 치우지 않은 판은 참고 셋째 줄 |
| 길게 누른 채 밀어 간 날 · 종목·기간 바꾸기 · 빠른 두 탭 (`check.js`, 포트만 바꿈, `--demo-backup-warning`) | 통과 | 1400·390m·360m × 두 테마 → `BAD 0`. `C1 gap 60/200 … want` 모두 맞음. `longpress 03-04 → 07-13`(390)·`03-19 → 08-12`(360) 뗀 뒤에도 그 날. `C2 x3 10-23 → 10-20`. 1400 `C2 02-17 ◀ 02-16`. 31b11a8 과 같은 판을 diff 했을 때 다른 줄은 360 `swipe day` 둘뿐이다(참고 셋째 줄). 마우스를 치운 `check-m.js` 360·390 → `09-03 → 09-03`, `BAD 0` |
| 겸용 기기·펜 (`hybrid.js`) | 통과 | 1400 hasTouch: `tap 01-08 → mouse hover 07-22 → mouse leave 01-08 → tap2 01-28 → pen hover 06-12 → pen leave 01-28 → pen click+leave 05-05 → pen drag+leave 05-05 (=clicked OK) → ◀ 05-04`. 390 hasTouch 도 같은 꼴. 콘솔 오류 0 |
| PC 마우스 가리킴·떠나면 고른 날 | 통과 | `hybrid.js` 위 줄. `dbg5.js`: 휠 때 `READ 02-17`(가리킴) → `mouseleave` → `READ 2026-01-20`(고른 날) |
| 마지막 날 풀이 (`last.js`) | 통과 | `open 10-23 (마지막 날 — 차트를 누르면 그 날)` → ◀ `10-22 (▶ 나 오른쪽 끝을…)` → ▶ `10-23 (마지막 날 …)` → 오른쪽 끝 탭 `10-23 (마지막 날 …)` |
| 360×640 팝업 날짜 축 (`modals.js`) | 통과 | `TSLA sell 0 bottom 607 · worst 607`(앞 판정과 같음) |
| 회귀: vitest | 통과 | 별도 worktree `rvF3b`(662c977): `Test Files 62 passed (62) · Tests 1015 passed (1015)`(앞 1013) |
| 회귀: lint | 통과 | `npm run lint` rc=0, 경고 22(`grep -c "^src/.*warning"` → 22) |
| 회귀: tsc·build | 통과 | `npx tsc -b` rc=0. build `index-BSjMr_aD.js 364.19 kB │ gzip: 113.10 kB`(앞 113.11) |
| pytest | 해당 없음(건너뜀) | `git diff --stat 31b11a8 662c977`: 코드는 `frontend/src/components/PriceChart.tsx`·`PriceChart.markers.test.tsx` 뿐이고, 나머지는 `ROADMAP.md` 와 라운드 문서(`final-review2.md`·`mutation.md`·`status.md`)다 |
| 성능 | 통과 | 전체 보기 뒤 2초 동안 rAF 0번(`pc.js` 네 판, `phone.js` 여덟 판). onRange 의 rAF 하나만 남기기는 시험이 지킨다(N7 잡힘) |
| 콘솔 오류 | 통과 | `pc.js`·`phone.js`·`hybrid.js`·`edge.js` 모든 판 0 |
| 문서 | 통과 | `ROADMAP.md` 의 0.45.2 에 "끝 검토 다시 보기(불합격) … 마우스·펜이 차트 칸 위에 있거나 손가락이 차트를 누르고 있을 때만 받는다" 줄이 더해졌고 코드(`PriceChart.tsx:199-234`)와 맞는다. `status.md` 는 세 번째 끝 검토를 기다린다고 적혀 있다 |
| 호환·격리·마이그레이션·입력 한도·비밀·규제·데이터 경계·외부 호출·가짜 서버 | 해당 없음 | 프런트 차트 한 파일의 포인터 처리만 바뀌었다. 새 화면 문자열은 없다 |

## 스크립트·출력
- 스크립트
  - `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r047/rvF3-pw/`: 앞 검토자 것을 포트 8193 으로 바꿈. 내가 더한 것은 `edge.js` 다.
  - `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r047/rvF3-pw2/`: `steptop.js`·`check.js`·`check-m.js`·`modals.js`·`stale.js`
- 출력: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r047/rvF3-out/`
  - 실행 결과: `pc.txt`·`phone.txt`·`dbg3.txt`·`dbg4.txt`·`hybrid.txt`·`check.txt`·`mut.md`·`muts.json`
  - 스크린샷: `edge-390-fit.png`
  - 31b11a8 비교: `rvF3old-out/`
  - M4 브라우저 판: `rvF3m-out/`

## 끝 상태

```
$ git -C scratchpad/r047/rvF3 status
Not currently on any branch.
nothing to commit, working tree clean
```
- `rvF3b`·`rvF3old` 도 깨끗하다. M4 브라우저 판은 `rvF3b` 에서 줄을 바꿔 빌드한 뒤 원래대로 돌려놓았다(`git diff` 0줄).
- 가짜 서버 8193·8194·8195 는 PID 로 껐다(`curl` → 000).
- worktree 셋은 이 파일을 쓴 뒤 지운다. 저장소에 쓴 것은 이 파일 하나다.
