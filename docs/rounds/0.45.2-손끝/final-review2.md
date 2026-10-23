# 0.45.2 끝 검토 다시 보기 (560ae92 · 31b11a8)

## 불합격

내 worktree `scratchpad/r047/rvF2` 에서 `31b11a8` 을 받아 직접 돌렸다. 빌드는 `index-BMc_7QKE.js` 이고, 가짜 서버 8192 에 띄웠다.
끝 검토의 조건부 1–4(F1·F2·F4·ROADMAP)는 **고쳐졌다**. 겸용 기기·펜도 브라우저에서 맞다.
그러나 31b11a8 이 고친다고 한 **C 사용자 다시 보기의 헤맴(전체 보기 뒤 십자선·읽기 줄이 고른 날과 다름)은 PC 에서 그대로**다. 폰에서도 휙 민 뒤 곧바로 누르면 남는다.
시험(jsdom)은 통과하지만 실제 라이브러리에서는 길이 다르다. 그리고 새 줄의 뮤테이션 3줄이 살아남았다.

### 고쳐야 할 것
1. **PC: ◀ 를 누른 뒤 "전체 보기"를 누르면 읽기 줄이 딴 날로 바뀐다. 이어서 ◀ 를 누르면 뒤 날로 간다. C-user2 의 주인 1400 과업 4 와 같다.**
   - 재현(`rvF2-pw/pc.js`, 측정을 끼우지 않은 판)
     - 클릭 01-19 → 휠 → ◀ `01-16` → 전체 보기 `read 2026-01-14 cross 2026-01-14` → ◀ `2026-01-15`. 01-14 를 보고 ◀ 를 눌렀는데 01-15 로 간다.
     - 클릭 03-17 → 마우스 끌기 → ◀ `03-16` → 전체 보기 `read 2026-04-30` → ◀ `2026-03-13`.
     - `hasTouch` 1400 도 같다.
   - 원인(`rvF2-pw/dbg5.js` 로그)
     - 전체 보기 단추 click 뒤 21ms 에 `READ 2026-01-14` 가 찍힌다. 그 사이 차트 칸에는 pointer·mouse 사건이 하나도 없다.
     - 라이브러리는 코드로 놓은 십자선(◀ 의 `setCrosshairPosition`)을 화면의 같은 x 에 둔다. 구간이 바뀌면 그 x 의 새 날로 `crosshairMove` 를 다시 보낸다.
     - `PriceChart.tsx:169` 의 거름은 `pointing.type === 'touch'` 일 때만 막는다. 그래서 마우스 기기에서는 이 사건이 `hoverRef` 에 들어간다. 그러면 `:190` `if (… || hoverRef.current) return` 이 다시 놓기를 건너뛴다.
     - 시험 `PriceChart.markers.test.tsx:345` 의 가짜 라이브러리는 구간이 바뀌어도 `crosshairMove` 를 보내지 않는다. 그래서 이 길을 보지 못한다.
   - 스크린샷: 앞 `dbg-3prev.png`(01-16) → 뒤 `dbg-5away.png`(읽기 줄·십자선 01-14, 같은 화면 x).
   - 고칠 방향(참고): 진짜 마우스가 차트 위에 있을 때만 가리킴으로 받는다(예: `param.sourceEvent` 가 없는 사건은 버리거나, 차트 칸의 pointerenter/leave 로 "위에 있음"을 따로 든다). 시험의 가짜 라이브러리도 구간이 바뀔 때 십자선 사건을 한 번 보내게 해야 이 길이 잡힌다.
2. **폰: 휙 밀고(관성) 0.3초 안에 "전체 보기"를 누르면 세 날이 어긋난다.** 고른 날, 읽기 줄, 십자선이 각각 다르다.
   - 재현(`rvF2-pw/dbg4.js`·`dbg3.js`, 390): 밀기 뒤 `01-21` → 전체 보기 → 읽기 줄 `2026-01-13`, 십자선은 9월 근처(밀기가 끝난 화면 자리), ◀ → `2026-01-20`.
     - `dbg3-fit.png`: 읽기 줄 83.43, 가격 이름표 91.89.
     - 360 `moves=8 wait 300ms` 도 `fit read 01-20 → ◀ 01-21`.
     - 1.5초 기다린 뒤 누르면 맞는다(390 `01-21 → fit 01-21`).
   - 원인(로그)
     - 관성으로 구간이 아직 움직이는 동안 손가락이 "전체 보기" 단추에 닿는다. 그러면 `pointerdown touch` 가 창 전체에서 `down: true` 가 된다(`:201`).
     - 그 사이 라이브러리의 십자선 사건이 `hoverRef` 에 들어간다(`1495~1580ms READ 01-20 … 01-13`). 그 뒤 rAF 가 건너뛴다.
     - 원인은 1 과 같다. "누르고 있음"이 차트 위가 아니라 창 어디서나 잡힌다.
3. **뮤테이션 살아남음 3줄**(§3 합격선 "0")
   - **N4** `if (!day || day.of !== history || hoverRef.current)` 에서 `day.of !== history ||` 를 지워도 통과한다.
     - 이 줄이 망가지면 종목·기간을 바꿀 때 `fitContent` 의 구간 사건으로 옛 데이터의 고른 날에 십자선을 놓는다.
     - `pickedRef` 는 데이터가 바뀌어도 비우지 않는다.
   - **N6** `:169` 를 `type !== 'mouse'` 로 되돌려(펜을 손가락처럼) 도 통과한다. 펜 시험이 없다.
   - **N7** `onRange` 의 `cancelAnimationFrame(frame)` 을 지워도 통과한다. 이 줄이 빠지면 구간 사건마다 rAF 가 쌓인다(총괄이 짚은 성능 점).

### 참고
- 측정 방법
  - 날짜 축의 십자선 이름표는 그림이라 DOM 으로 읽을 수 없다. 그래서 위 칸(top canvas) 이름표의 가운데 x 를 구했다.
  - 그 x 를 마우스로 가리켜 읽기 줄의 날을 읽었다. 그 뒤 `mouse.move(1,1)` 로 치웠다(`rvF2-pw/lib.js` `crossX`·`dateAtCross`).
  - 전체 보기 배율(1px 남짓에 하루)에서는 ±1 거래일이 측정 오차로 나온다(390·360 `fit read 01-21 cross 01-22` 꼴). 이것은 실패로 세지 않았다.
- 휠·끌기·◀ 를 할 때마다 측정을 끼우면 결과가 달라진다. 측정 때 마우스가 떠나면 라이브러리가 십자선을 지운다. 이렇게 되면 전체 보기는 맞게 돈다(`measureEvery=true` 판: `fit read 01-16 cross 01-16`, `◀ 01-15/01-15`).
  그래서 "십자선이 남아 있는 채 전체 보기"가 1 의 조건이다. 사람이 ◀ 를 누른 뒤 곧바로 전체 보기를 누르면 바로 이 조건이 된다.
- 크게 밀어 빈 칸까지 간 경우(C-user2 거슬림)는 고쳐졌다. 390·360 모두 `bigpan read 10-21 cross 10-21 → ◀ 10-20/10-20 → ◀ 10-19/10-19`.
- 구간 구독이 무한 반복하지 않는다. 전체 보기 뒤 2초 동안 `requestAnimationFrame` 이 0번 불렸다(PC·폰 모든 판). 콘솔 오류는 모든 판에서 0 이다.

---

## 확인한 것

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 앞 조건부 1 (F1 창 듣기 풀기) | 통과 | 시험 `PriceChart.markers.test.tsx:550-560`: 창에서 capture 로 붙인 넷과 푼 넷이 같은지 본다. 내 뮤테이션 F1 `removeEventListener('pointerdown', down, true)` 지움 → 잡힘. F1b pointermove 해제 지움 → 잡힘. F1c capture 인자 뺌 → 잡힘 |
| 앞 조건부 2 (F2 겸용 기기) | 통과 | 시험 `:289` 손가락 탭 → 마우스 pointermove → 그 날. 뮤테이션 `if (e.pointerType !== 'touch')` → `if (false)` 잡힘. 브라우저 1400 hasTouch: `tap 2026-01-07 → mouse hover 2026-07-21 → mouse leave 2026-01-07` |
| 앞 조건부 3 (F4 마우스 끌기) | 통과 | 시험 `:300`. 뮤테이션 `e.pointerType === 'touch' && held ?` → `held ?` 잡힘. 브라우저 1400 `click2 03-17 → drag → read 03-17` |
| 앞 조건부 4 (ROADMAP) | 통과 | `git diff 7f5adee..31b11a8 -- ROADMAP.md`: "20px 오르내린다" 줄이 빠지고 C 다시 보기 거슬림 줄이 들어왔다. `grep -n "20px 오르내린다" ROADMAP.md` → 0줄 |
| 펜 (끝 검토 참고) | 통과(시험 없음 → 3 N6) | CDP `Input.dispatchMouseEvent pointerType:'pen'`, 1400 hasTouch·390 hasTouch: 탭 뒤 `pen hover 2026-06-11 → hover2 2026-08-28 → pen leave 2026-01-27(탭한 날)`. 펜 클릭은 그 날을 고른다(`05-04`). 펜 끌기 뒤에도 클릭한 날(`05-04 (=clicked OK)`). ◀ `05-01`. 390 도 같다 |
| C 다시 보기: 전체 보기 뒤 십자선 | **실패(1·2)** | PC 1400(`pc.js`, hasTouch 있음·없음 둘 다): ◀ → 전체 보기 → `read 2026-01-14`(고른 날 01-16) → ◀ `2026-01-15`. 폰 390/360(`phone.js`·`dbg4.js`): ◀◀ 뒤 전체 보기는 맞다(`*fit read 07-16 cross 07-17`, ±1 오차). 밀고 곧바로 전체 보기는 `fit2 read 01-14 → ◀ 01-20` 처럼 어긋난다. 오래 기다리면 맞다 |
| C 다시 보기: 마지막 날 풀이 | 통과 | 390: `open 10-22 (마지막 날 — …)` → ◀ `10-21 (▶ 나 오른쪽 끝을 …)` → ▶ `10-22 (마지막 날 — …)`. 오른쪽 끝을 탭해도 `(마지막 날 — …)`. 뮤테이션 N3 잡힘 |
| 뮤테이션 (새 줄) | **실패(3)** | `MUT_REPO=rvF2 python mutate.py`(명령 `npx vitest run src/components src/pages`). N1 구간 구독 안 함 → 잡힘. N2 hoverRef 조건 뺌 → 잡힘. N3 → 잡힘. N5 구독 해제 지움 → 잡힘. **N4 `day.of` 조건 뺌 · N6 펜을 손가락처럼 · N7 `cancelAnimationFrame` 지움 → 살아남음** |
| 회귀 | 통과 | vitest `Test Files 62 passed (62) · Tests 1013 passed (1013)`(앞 1009). lint 경고 22. `tsc -b` rc=0. build `index-BMc_7QKE.js 364.19 kB │ gzip: 113.11 kB`. pytest 는 건너뛰었다. `git diff --stat 7f5adee..31b11a8` 에서 바뀐 코드는 `frontend/src/components/PriceChart.tsx`·`PriceChart.markers.test.tsx` 뿐이고, 나머지는 `ROADMAP.md` 와 라운드 문서 셋(`C-user2.md`·`final-review.md`·`mutation.md`)이다 |
| 성능 | 통과 | `onRange` 는 rAF 를 하나만 남긴다(`:186-187`). 전체 보기 뒤 2초 동안 rAF 0번 → 무한 반복 없음. 다만 그 줄을 지켜 주는 시험이 없다(N7) |
| 콘솔 오류 | 통과 | `pc.js`·`phone.js`·`hybrid.js` 모든 판 `console errors 0` |
| 격리·마이그레이션·호환·입력 한도·비밀·규제·데이터 경계·외부 호출·가짜 서버 | 해당 없음 | 프런트 차트 한 파일만 바뀌었다. 새 문자열은 풀이 하나("마지막 날 — 차트를 누르면 그 날")이고 기존 문구다 |
| 실행자 `mutation.md` | 일부 맞음 | "구간 바뀌어도 다시 놓지 않음 / 가리키는 중에도 다시 놓음 / 마지막 날 풀이" 셋은 내 N1·N2·N3 과 같이 잡힌다. 다만 N2 는 jsdom 에서만 맞다. 실제 라이브러리에서는 그 조건이 PC 의 다시 놓기를 막는다(1) |

## 스크립트·스크린샷
- 스크립트: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r047/rvF2-pw/` (`pc.js`·`phone.js`·`dbg3.js`·`dbg4.js`·`dbg5.js`·`hybrid.js`·`last.js`·`lib.js`)
- 출력·스크린샷: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r047/rvF2-out/` (`dbg-3prev.png`·`dbg-5away.png`·`dbg3-fit.png`·`mut.md`)

## 끝 상태

```
$ git -C scratchpad/r047/rvF2 status
Not currently on any branch.
nothing to commit, working tree clean
```
가짜 서버 8192 는 PID 로 껐다(`curl` → 000). worktree `rvF2` 는 이 파일을 쓴 뒤 지웠다. 저장소에 쓴 것은 이 파일 하나다.
