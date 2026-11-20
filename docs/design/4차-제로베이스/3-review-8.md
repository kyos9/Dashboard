# 디자인 4차 묶음 3 (종목) ② 반영 재검토 둘째 — d516940 (범위 5d5dbb8..d516940, 지난 판정 3-review-7.md 조건부)

# 합격

지난 판정의 조건 둘과 참고 1이 모두 풀렸다. 새 회귀는 없다. 아래 참고 셋은 조건이 아니다.

- **조건 1(둘째 손가락이 끌기를 가로챔)이 풀렸다.**
  - 진짜 터치(CDP), 390 · 360 에서 쟀다.
  - 첫 손가락이 손잡이를 잡은 채 둘째 손가락이 움직이고 떨어져도 순서는 그대로다. 저장도 없고(PUT 0), 끄는 상태는 이어진다.
  - 그 뒤 첫 손가락으로 마저 끌어 놓으면 `PUT 1` 이다. 화면 · 서버 모두 기대와 같다.
  - 둘째 손가락이 다른 손잡이를 잡아도 끌기가 새로 시작되지 않는다.
- **참고 1(취소에도 저장)은 새 결정대로 처리됐다.** `touchCancel` 이면 저장하지 않고 제자리로 돌아간다(PUT 0 · 말 0 · 끄는 상태 0). 그 뒤 다시 끌면 PUT 1 이다.
- **조건 2(카드 제목 외톨이 17)가 풀렸다.**
  - 東京海上(8766.T) · TIGER(381180.KS)를 오른쪽 칸에 두고 audit 30 조합을 쟀다. page-overflow 0 · orphan 0, 나머지 검사도 모두 0 이다.
  - 우리 데이터의 짧은 이름 · 한국어 이름은 바뀌지 않았다. 모두 한 줄이다.
- 보통 끌기(위 · 아래 · 손잡이 밖에서 놓기, 1400 · 150% 마우스 포함)는 그대로다.

## 참고(조건 아님)

- **참고 1 — 시작 막기 줄은 테스트가 지키지 않는다.**
  - 대상은 `DragOrderList.tsx:82` `if (pointer.current !== null) return` 이다.
  - 이 줄을 빼도 vitest 59/59 가 통과한다(`mutC.log`).
  - 실제 브라우저에서는 이 줄 덕분에 둘째 손가락이 다른 손잡이를 잡아도 끌기를 빼앗지 못한다(`extra3.log` C).
  - 다음에 손댈 때 "끄는 중 다른 pointerId 의 pointerDown(다른 손잡이)은 끄는 줄을 바꾸지 않는다"를 하나 넣으면 된다.
- **참고 2 — 카드 제목이 글자 사이에서 끊긴다(keep-all 예외의 값).**
  - 우리 데이터에서 두 줄이 되는 제목은 둘이다. `東京海上ホー / ルディングス`, `TIGER 미국필라델 / 피아반도체나스닥` 이다. 외톨이는 없다.
  - TIGER 는 "필라델/피아"처럼 낱말 가운데서 끊긴다. 다만 띄어쓰기 없는 13자 낱말이라 다른 길이 없다(keep-all 이면 넘친다).
  - 데이터에 없는 이름을 넣어 봤다(`names.log`, 360). 띄어쓰기가 있는 이름도 낱말 가운데서 끊을 수 있다. 예: `ACE 미국빅테 / 크TOP7 Plus`. keep-all 이었다면 `ACE 미국빅테크TOP7 / Plus` 였다.
  - 지금 담긴 15 종목에는 해당이 없다. ③ 에 적어 둘 만하다.
- **참고 3 — 지난 판정의 탐침 한 줄을 바로잡는다.**
  - CDP `Input.dispatchTouchEvent` 의 `touchEnd` 는 **적은 점을 뗀다.** 지난 `extra2.mjs` 의 "둘째만 뗀" 단계(`touchEnd [첫 손가락]`)는 실제로는 첫 손가락을 뗐다(`cdpt.log`: `release f2 via end[p1] → up#2`(첫 손가락)).
  - 그래도 지난 조건 1 은 맞았다. 둘째 손가락의 move 가 끌기를 움직인 것은 그대로 사실이다.
  - 이번 `extra3.mjs` 는 둘째를 `touchEnd [둘째]` 로 뗐다. 이벤트 기록으로 확인했다(`둘째 뗌 pointerup#3 / 끝 pointerup#2`).

## 볼 것별 판정

| # | 볼 것 | 판정 | 증거 |
|---|---|---|---|
| 1a | 지난 extra2 둘째 손가락(첫 손가락 VOO 손잡이 2px, 둘째가 6번 줄 이름에서 40px, 둘째 뗌, 첫 손가락 뗌) | 통과 | `extra3.log` A, 390 · 360 같음: `둘째 움직인 뒤 VOO,QQQ,SCHD,…(처음 그대로) 끄는 중 1 \| 둘째만 뗀 직후 끄는 중 1 PUT 0 \| 첫 손가락 뗀 뒤 화면=서버=처음 PUT 0 말 0` |
| 1b | 둘째가 움직이고 뗀 뒤 첫 손가락으로 마저 1→3 | 통과 | `extra3.log` B, 390 · 360 × 손잡이 · 이름 위에서 놓기: `둘째 움직인 뒤 그대로 true \| 둘째 뗀 뒤 끄는 중 1 PUT 0 \| 놓기 전 PUT 0 \| 화면=기대 true 서버=기대 true PUT 1 끄는 중 0 말 1` |
| 1c | 끄는 중 둘째가 5번 손잡이를 잡고 위로 150px | 통과 | `extra3.log` C: `끄는 줄 VOO(처음 VOO) 순서 그대로 true \| 둘째 뗀 뒤 PUT 0 \| 첫 손가락 1→3 화면=기대 true 서버=기대 true PUT 1` |
| 1d | touchCancel — 저장 없이 제자리(새 결정) | 통과 | `extra3.log` D: `끄는 중 QQQ,SCHD,VOO → 뒤 화면 VOO,QQQ,SCHD 서버 VOO,QQQ,SCHD 화면=처음 true PUT 0 끄는 중 남음 0 말 0`, 이벤트 `pointercancel#2`. D′ 취소 뒤 다시 4→1: `PUT 1 말 1`. `extra.log` 390 `끄는 중 취소(touchCancel) … PUT 0 … 말 0`(지난번 PUT 1) |
| 1e | 보통 끌기 — 위 · 아래 · 맨 끝, 손잡이 · 이름 위에서 놓기(390 · 360 터치, 1400 · 150% 마우스) | 통과 | `drag2.log` 20 칸 모두 `미리 벌림 true · 놓기 전 PUT 0 · 화면=기대 true · 서버=기대 true · PUT 1 · 끄는 중 남음 0 · 말 O`, scrollY 변화 없음. 새로고침 뒤 화면=서버 넷 다 true, errs 0. ("맨 끝→맨 위(멀리)"는 ③ 남김 그대로) |
| 1f | 손잡이 밖에서 놓기 | 통과 | `stuck.log` 다섯 줄 모두 `PUT 1 · is-dragging 0 · 말 1`. `extra3.log` B "이름에서 놓기" PUT 1. `extra2`(띠) 대신 `extra.log` 390 `아래 띠 · 위 띠 PUT 1`, 1400@1 · 933@1.5 마우스 `아래 띠 · 목록 밖 오른쪽` 모두 `화면=서버=기대 · PUT 1 · 남음 0 · 말 1`. (`extra.mjs` 360 줄은 스크롤 없이 740 높이에서 줄이 화면 밖이라 탐침이 어긋난다 — 지난 r3g 에서도 같았다. 360 은 스크롤을 맞춘 `extra3` · `drag2` 로 본다) |
| 1g | 빠른 톡 · 두 손잡이 동시 톡 뒤 멈추지 않음(가리기로 생길 수 있는 잠김) | 통과 | `tap.log`: `빠른 톡 5번 뒤 끄는 중 0 PUT 0 순서 그대로 true` · `두 손잡이 동시 톡 뒤 끄는 중 0 PUT 0` · `그 뒤 1→3 끌기 화면=기대 true 서버=기대 true PUT 1 errs 0` |
| 2a | audit `--only stocks,stocks-card,stocks-sheet`, 8766.T · 381180.KS 오른쪽 칸 | 통과 | `put2.log`: 서버 순서 `VOO,8766.T,SCHD,381180.KS,…`. `card.log`: 폰 둘 다 c2, 1400 은 c2 · c4, 150% 는 c2 · c4. `audit/summary.md`: 30 조합, 열지 못한 것 0. page-overflow 0 · orphan 0 · clipped 0 · 나머지 모두 0(r3g orphan 17 → 0) |
| 2b | 카드 제목 끊김 눈으로(360 · 390 · 1400 · 150%, 두 테마) | 통과(참고 2) | `card.log`: 7 조건 모두 `넘침 0 · word-break normal · text-wrap balance`. 두 줄은 `東京海上ホー / ルディングス` · `TIGER 미국필라델 / 피아반도체나스닥` 뿐이다. VOO · 삼성전자 · 삼성전자우 · KODEX 200 · トヨタ自動車 · SK하이닉스 등은 모두 한 줄이다. 그림 `shots/crop-card-360-dark.png` · `shots/crop-card-1400-light.png` |
| 3a | 뮤테이션 — move 의 pointerId 가리기 빼기(`:50`) | 통과 | `mutA.log`: `× 순서 바꾸기 — 끄는 동안 다른 손가락은 …` · `Tests 1 failed \| 58 passed (59)` |
| 3b | 뮤테이션 — finish 의 pointerId 가리기 빼기(`:58`) | 통과 | `mutB.log`: 같은 테스트 1 failed |
| 3c | 뮤테이션 — 둘 다(`e.pointerId !== pointer.current` → `false`) | 통과 | `mutE.log`: 1 failed |
| 3d | 뮤테이션 — 취소 분기 빼기(`:64` `\|\| e.type === 'pointercancel'`) | 통과 | `mutD.log`: 같은 테스트 1 failed |
| 3e | 뮤테이션 — 시작 막기 빼기(`:82`) | 테스트 없음(참고 1) | `mutC.log`: `Tests 59 passed (59)` |
| 3f | 뮤테이션 뒤 되돌림 | 통과 | 매번 `git checkout -- src/components/stock/DragOrderList.tsx` 뒤 `git status --short` 빔 |
| 4 | 색표 밖 색 | 통과 | `stocks.css` · `DragOrderList.tsx` 에서 `#hex/rgb(/hsl(` grep 0 |

## 빌드 · 테스트 · 기능 불변

| 무엇 | 결과 |
|---|---|
| `npm ci` | 0 (`ci.log`) |
| `npm run build` | 0 (`build.log`, 화면은 이 build 뒤에 봤다) |
| `npx tsc -b` | 0 (`tsc.log`) |
| `npm run lint` | 0, 경고 20(기준 22, 실행자 20), 오류 0. `DragOrderList` · `StockManager` 경고 없음(`lint.log`) |
| `npx vitest run` | `Test Files 68 passed (68)` · `Tests 1111 passed (1111)`(`vitest.log`). 1110 + 1(새 테스트) = 1111. 기존 테스트는 고치지 않았다(diff 는 추가 33줄뿐) |
| `git diff --stat 5d5dbb8..d516940 -- backend frontend/src/api frontend/src/lib frontend/src/types.ts frontend/src/AppState.tsx` | 빔 |
| 그 밖의 .tsx 변경 | `DragOrderList.tsx` 만 바뀌었고 한 줄씩 읽었다. `pointer` ref 를 넣었다. move · finish 는 같은 pointerId 만 받는다. start 는 끄는 중이면 새로 시작하지 않는다. pointercancel 이면 drop 을 부르지 않는다. 저장 · 되돌림은 부르는 쪽 그대로다. 2-2 에 닿는 것은 없다 |
| `stocks.css` | `.stock-tile .stock-row-title` 의 `overflow-wrap: break-word` 를 `word-break: normal; text-wrap: balance` 로 바꿨다. 카드 제목에만 걸린다 |

## 검토자가 한 일

- 작업 트리는 `/home/user/Dashboard`(브랜치 `claude/design-4-zerobase`, HEAD d516940)다.
- 프런트는 `npm ci` → `npm run build` → `tsc -b` → lint → vitest 순서로 돌렸다.
- 가짜 서버는 8189 에서 `--reset` 으로 띄웠다. 데이터는 저장소 밖 `…/scratchpad/r3h/data` 에 두었고, 다 쓴 뒤 PID 로 껐다.
- 탐침은 이렇게 돌렸다.
  - `drag2` · `stuck` · `extra` 는 r3g 것을 포트만 바꿔 그대로 돌렸다.
  - 새로 짠 것은 `extra3.mjs`(A–D: 둘째 손가락 · 이어 끌기 · 다른 손잡이 · touchCancel), `cdpt.mjs`(CDP touchEnd 뜻 확인), `tap.mjs`, `put2.mjs`, `card.mjs`, `names.mjs` 다.
- 산출물은 `/tmp/claude-0/-home-user-Dashboard/c9553d42-71a5-5379-90e1-1c42ba786c3a/scratchpad/r3h/` 에 있다.
- 뮤테이션 다섯은 모두 `git checkout` 으로 되돌렸다. 저장소 파일은 고치지 않았고 커밋하지 않았다.
- 끝낸 뒤 `git status --short`:

```
?? "docs/design/4\354\260\250-\354\240\234\353\241\234\353\262\240\354\235\264\354\212\244/3-review-8.md"
```

(이 판정문 하나뿐이다.)
