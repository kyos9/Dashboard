# 0.45.2 끝 검토 네 번째 (01711cc)

## 조건부 합격

내 worktree 두 개에서 `01711cc` 를 받아 직접 돌렸다.
- `scratchpad/r047/rvF4`: 뮤테이션과 뮤테이션 빌드용
- `scratchpad/r047/rvF4b`: vitest·lint·tsc·build 와 브라우저용. 빌드는 `index-4LVoaVqc.js` 이고, 가짜 서버 8196 에 `--demo-backup-warning` 으로 띄웠다.

**final-review3 의 조건 1(M4)·2(M7)는 고쳐졌다.** 둘 다 이제 시험이 잡는다. 브라우저는 final-review3 과 같거나 낫다.
- `steptop.js` 를 마우스를 치우지 않은 채 돌리면 앞 판은 `BAD 12` 였고, 이번 판은 `BAD 4` 다. 남은 4개도 ◀ 동작이 틀린 것이 아니라 첫 읽기를 마우스 가리킴으로 읽은 것이다(아래 표).
- 터치 노트북 시나리오도 브라우저에서 맞게 동작한다.

다만 **새 줄 `touchAnywhere`(`PriceChart.tsx:222-227`)에 넣은 뮤테이션 중 셋이 살아남았고, 그 셋이 실제 동작을 바꾼다.** 그중 둘은 브라우저에서 바로 틀린 화면을 만든다.

### 조건부 목록 (고쳐야 함)
1. **T5·T6: 손가락이 닿을 때 가리킴을 지우는 두 줄 중 하나를 지워도 살아남는다.**
   - 바꾼 줄
     - T5: `PriceChart.tsx:225` `hoverRef.current = null` 지움
     - T6: `PriceChart.tsx:226` `setHover(null)` 지움
   - 지금 시험(`PriceChart.markers.test.tsx:425`)은 손가락으로 ◀ 를 누르는 경우만 본다. 그런데 ◀ 의 `pick` 이 어차피 둘 다 비우기 때문에 이 두 줄을 지켜 주지 못한다.
   - 브라우저 확인: 뮤테이션마다 빌드해서 8197 에 띄우고 `nbfit.js` 를 돌렸다. 시나리오는 1400·390 hasTouch 에서 손가락 탭 → 마우스로 차트 위에서 휠 → 마우스를 차트 위에 둔 채 손가락으로 "전체 보기"(또는 페이지 빈 곳)를 탭하는 것이다.
     - 원본(01711cc): `read 2026-02-17 cross 2026-02-17 OK` · 빈 곳 탭 `read 2026-02-17 OK` → `BAD 0`
     - T6(`index-DJPLYgtK.js`): `finger 전체 보기 read 2026-07-22 cross 2026-02-17 BAD` · 빈 곳 탭 `read 2026-07-22 BAD`. 390 도 같은 꼴 → `BAD 4`. 읽기 줄이 남은 마우스 가리킴에 머문다.
     - T5(`index-ByJFIiQZ.js`): `finger 전체 보기 read 2026-02-17 cross 2026-07-22 BAD`(390 `cross 2026-09-01`) → `BAD 2`. 십자선이 고른 날로 돌아가지 않는다. final-review2 의 1번과 같은 꼴이다.
   - 필요한 시험: 마우스가 차트 위에 있는 동안 손가락이 ◀ 가 아닌 곳(예: 전체 보기, 차트 밖)에 닿으면 다음 둘을 본다.
     - 읽기 줄이 고른 날이다.
     - 그 뒤 구간이 바뀌면 십자선을 고른 날로 다시 놓는다(`setCrosshairPosition` 이 고른 날로 불린다).
2. **T9: 해제의 capture 표시를 빼도 살아남는다.**
   - 바꾼 줄: `PriceChart.tsx:236` `window.removeEventListener('pointerdown', touchAnywhere, true)` → `(…, touchAnywhere)`
   - 이렇게 되면 capture 로 붙인 리스너가 풀리지 않는다. 그래서 차트를 열 때마다 창에 리스너가 하나씩 쌓인다(새는 것).
   - 닫기 시험(`:644-655`)은 `target·type·fn` 만 짝지어 보고 capture 는 보지 않는다.
   - 필요한 시험: 붙일 때와 풀 때의 capture 가 같은지 짝 비교에 넣는다.

### 참고 (고칠 것으로 세지 않음)
- **T2·T2b**: 종류 검사를 지워 마우스 누름에도 가리킴을 놓게 하거나, 펜 누름에도 놓게 하면 살아남는다.
  - 마우스·펜은 누를 때 이미 차트 위에 있다. 누른 채로 있는 동안에만 읽기 줄이 잠깐 고른 날로 돌아간다. 떼면 클릭으로 그 날을 고르고, 움직이면 `enter` 가 되살린다.
  - 그래서 짧은 깜빡임 말고는 같은 동작이다. "마우스로 누른 채(떼기 전) 읽기 줄은 가리킨 날" 시험 하나면 둘 다 잡힌다. 더하기를 권한다.
- **T3**: `|| !pointing.current.over` 를 지워 손가락이 닿을 때마다 비우게 해도 살아남는다.
  - `over` 가 꺼진 채 가리킴이 남는 것은 손가락 누름이 취소된 뒤의 묵은 가리킴뿐이다. 그것을 비우는 쪽이 오히려 낫다. 같은 동작으로 본다.
- **T7**: capture 대신 bubble 로 붙여도 살아남는다. 차트와 단추 어디에서도 `pointerdown` 전파를 막지 않으니(`PriceChart.tsx`·`lightweight-charts.production.mjs` 에서 `grep stopPropagation` → 0) 같은 동작이다.
- `pc.js` 의 `measureEvery=true` 판에 나오는 `NO-CROSS` 줄(별표 없는 click·wheel·drag)은 돌릴 때마다 개수가 다르다(앞 판 4, 이번 7, 다시 돌린 판 5).
  - 마우스를 치운 직후의 그림을 재는 문제다. 이번 바뀐 코드는 마우스·펜이면 첫 줄에서 바로 돌아간다(`:223`).
  - 판정에 쓰는 별표 줄은 네 판 모두 앞 판과 같다.

---

## 확인한 것

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 앞 조건 1 M4 (마우스 누름도 touch) | 통과 | `MUT_REPO=rvF4 python mutate.py`(`npx vitest run src/components src/pages`): `M4 if (e.pointerType)` → 잡힘. 같은 줄을 `!== 'pen'` 으로 바꾼 M4b → 잡힘. 시험 `PriceChart.markers.test.tsx:403` |
| 앞 조건 2 M7 (창 pointercancel 안 들음) | 통과 | `M7 window.addEventListener('pointercancel', lift)` 지움 → 잡힘. `lift` 대신 빈 함수를 붙인 M7b(집합 검사를 피하는 꼴) → 잡힘. 시험 `:413` |
| 새 줄 뮤테이션 | **실패(조건부 1·2)** | 잡힘: M5 lift 안 내림 · T1 창 pointerdown 안 붙임 · T4 over 안 내림 · T8 해제 지움 · T10 창 대신 차트 칸에 붙임. **살아남음: T5 hoverRef 안 비움 · T6 setHover 안 함 · T9 해제 capture 틀림**(조건부). 참고로 셈: T2 · T2b · T3 · T7. 전체 표 `rvF4-out/mut.md` |
| 실행자 `mutation.md` | 맞음(좁음) | 실행자의 M4·M7·T1 "잡힘" 은 내 결과와 같다. T5·T6·T9 는 실행자 표에 없다 |
| 회귀: vitest | 통과 | `rvF4b`: `Test Files 62 passed (62) · Tests 1018 passed (1018)`(앞 1015, 셋 더함) |
| 회귀: lint | 통과 | `npm run lint` rc=0, 경고 22(`grep -c "^src/.*warning"` → 22) |
| 회귀: tsc·build | 통과 | `npx tsc -b` rc=0. build `index-4LVoaVqc.js 364.19 kB │ gzip: 113.11 kB` |
| PC 클릭→휠→◀→전체 보기 (`pc.js`) | 통과 | 별표 줄은 네 판(hasTouch 있음·없음 × 매번 잼·안 잼)이 모두 같다: `*fit 01-19/01-19 → *◀ 01-16/01-16`, `*fit 03-17/03-17 → *◀ 03-16/03-16`, `*kbd-fit 03-16/03-16`. `idle raf 0`, 콘솔 오류 0. `diff rvF3-out/pc.txt` 에서 다른 줄은 별표 없는 `NO-CROSS` 셋뿐이다(참고) |
| 폰: 밀고 곧바로 전체 보기 (`dbg4.js`) | 통과 | `diff rvF3-out/dbg4.txt rvF4-out/dbg4.txt` → 같음 |
| 겸용 기기·펜 (`hybrid.js`) | 통과 | `diff` → 같음. 1400 `tap 01-08 → mouse hover 07-22 → mouse leave 01-08 → … pen drag+leave 05-05 (=clicked OK) → ◀ 05-04`, 콘솔 오류 0 |
| 마지막 날 (`last.js`) | 통과 | `diff` → 같음 |
| 터치 노트북: 마우스를 차트 위에 둔 채 손가락 ◀ / 손가락 탭 뒤 마우스 되살아남 (`notebook.js`, 새로 씀) | 통과 | 1400·1024·390 hasTouch → `BAD 0`. 1400: `tap 02-17 → mouse on chart 07-22 → finger ◀x3 02-16 02-13 02-12 OK → mouse moves again 07-29 (revived OK) → mouse leave 02-12 OK → mouse on + finger tap chart 03-27 → mouse leave 03-27 OK → mouse click 05-05 → mouse ◀ 05-04 OK`. 콘솔 오류 0 |
| 터치 노트북: 손가락으로 전체 보기·빈 곳 (`nbfit.js`, 새로 씀) | 통과(원본) | 1400 `read 02-17 cross 02-17 OK`, 빈 곳 `read 02-17 OK`. 390 `03-09/03-09 OK` → `BAD 0`. T5·T6 빌드는 조건부 1 |
| `steptop.js` 마우스를 치우지 않은 채 (앞 BAD 12) | 나아짐 | `BAD 4`. 틀린 줄은 넷 다 `top 130` 첫 줄이다(`360 VOO top 130 2026-06-10 → 2026-10-22 2026-10-21 2026-10-20`). ◀ 세 번은 고른 날(10-23)에서 하루씩 앞으로 간다. 시작 읽기 `06-10` 은 로그인 때 남은 마우스의 가리킴이라 스크립트의 비교가 틀렸다. 31b11a8 의 `BAD 4` 와 같은 꼴이다. 662c977 은 `06-05 → 06-05 06-05 06-05` 였다 |
| `steptop.js` 마우스 치운 판 | 통과 | `BAD 0`(360·390 × VOO·SCHD × top 130·60·20) |
| `check.js` (치우지 않은 원본, `--demo-backup-warning`) | 통과·나아짐 | 1400·390m·360m × 두 테마 → `BAD 0`. `diff rvF3-out/check.txt` 에서 다른 줄은 360 `swipe day 2026-09-03 → 2026-10-14`(앞) → `2026-09-03 → 2026-09-03`(이번) 둘뿐이다. 앞 판의 참고 줄이 고쳐졌다. `longpress 03-04 → 07-13`·`03-19 → 08-12`, `C2 x3 10-23 → 10-20` 은 앞과 같다 |
| 성능 | 통과 | 전체 보기 뒤 2초 rAF 0(`pc.js` 네 판). 새 리스너는 창 `pointerdown` 하나이고, 마우스·펜이면 첫 줄에서 돌아간다 |
| 콘솔 오류 | 통과 | 모든 스크립트·모든 판 0 |
| 문서 | 통과 | `ROADMAP.md`·`status.md`·`mutation.md` 에 이번 줄이 더해졌고, 코드(`:220-236`)와 맞는다. 다만 `mutation.md` 는 T1 하나만 적었다(조건부 1·2) |
| pytest·호환·격리·마이그레이션·입력 한도·비밀·규제·데이터 경계·외부 호출·가짜 서버 | 해당 없음 | `git diff --stat 662c977 01711cc`: 코드는 `PriceChart.tsx`(+10)·`PriceChart.markers.test.tsx` 뿐이다. 새 화면 문자열은 없다 |

## 스크립트·출력
- 스크립트
  - `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r047/rvF4-pw/`: 앞 검토자 것을 포트 8196 으로 바꿈. 내가 더한 것은 `notebook.js`·`nbfit.js` 다.
  - `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r047/rvF4-pw2/`: 총괄 `check.js`·`steptop.js`(치우지 않은 원본, 포트만 바꿈)와, 앞 검토자의 치운 판 `steptop-m.js`
  - `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r047/rvF4m-pw/`: 뮤테이션 빌드용(8197)
- 출력: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r047/rvF4-out/`
  - 뮤테이션: `muts.json`·`mut.md`·`mut.log`
  - 브라우저: `pc.txt`·`pc2.txt`·`dbg4.txt`·`hybrid.txt`·`last.txt`·`notebook.txt`·`nbfit.txt`·`nbfit-T5.txt`·`nbfit-T6.txt`·`steptop.txt`·`steptop-m.txt`·`check.txt`
  - 그 밖: `lint.txt`

## 끝 상태

```
$ git -C scratchpad/r047/rvF4 status
Not currently on any branch.
nothing to commit, working tree clean
$ git -C scratchpad/r047/rvF4b status
Not currently on any branch.
nothing to commit, working tree clean
```
- **첫 뮤테이션 실행이 중단되었다.** 도구 시간 한도(600s)에 걸려 T10 이 바뀐 채로 멈췄다.
  - `git checkout -- PriceChart.tsx` 로 되돌리고 status 가 깨끗한 것을 확인한 뒤 처음부터 다시 돌렸다. 위 결과는 다시 돌린 판이다.
- T5·T6 브라우저 판은 `rvF4` 에서 줄을 바꿔 빌드한 뒤 원래 파일로 돌려놓았다(`git diff` 0줄).
- 가짜 서버 8196·8197 은 PID 로 껐다(`curl` → 000).
  - 8197 의 T6 서버는 첫 kill 뒤에도 살아 있었다. 그래서 T5 판은 그 서버가 같은 `rvF4/frontend/dist` 에서 T5 빌드(`index-ByJFIiQZ.js` 확인)를 내주었다. 그 뒤 그 PID 를 따로 껐다.
- 실수 하나: 기다리기용 `tail -f /dev/null` 을 치우려고 `pkill -f` 를 한 번 썼다. 이것이 내 셸만 끝냈다(exit 144). 남의 서버는 건드리지 않았다(8196 은 그 뒤에도 응답했다).
- worktree 둘은 이 파일을 쓴 뒤 지운다. 저장소에 쓴 것은 이 파일 하나다.
