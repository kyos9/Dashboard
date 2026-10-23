# 0.45.3 끝 검토 다시 보기 — 앞 판정 조건부 확인 (검토자, bfd8c2c..42966fe)

# 합격

앞 판정(`final-review.md`)의 조건 셋이 모두 풀렸다. 이번 고침에서 새 결함은 나오지 않았다.

검토 환경
- 자기 worktree `scratchpad/r048/rvF2`(42966fe, 분리 HEAD)를 만들었다. frontend `node_modules`는 링크로 걸었다.
- 그 안에서 `npm run build`를 돌렸다. 결과는 `index-CAcrLVmD.js`, gzip 113.92 kB다.
- 가짜 서버는 포트 8191(`--reset`, 데이터 `scratchpad/r048/rvF2-data`)에 띄웠고, 끝나면 PID로 껐다.
- 스크립트는 `scratchpad/r048/rvF2pw/`에 두었다. 앞 검토자의 `rvFpw/*.js`와 총괄의 `pw/wn.js`(→ `wn_main.js`)를 포트만 8191로 바꿔 옮겼다.
- 그림은 `scratchpad/r048/rvF2-shots/`에 있다.
- 볼 범위: `git diff --stat bfd8c2c 42966fe`. 8파일이다(README·ROADMAP·version.py 주석, Dashboard.tsx·두 시험, mutation.md, final-review.md). 서버 코드·마이그레이션 변경은 0이다.

## 앞 판정 조건부 확인

| 조건 | 판정 | 증거 |
| --- | --- | --- |
| 1 카드 비중 줄이 카드 밖으로 | **통과** | **고친 곳**: `Dashboard.tsx:146-155`. 바깥 span에서 `nowrap`을 빼고, 네 조각(지금 / · 목표 / · 차이 / (허용))을 각각 `.nowrap`으로 묶어 조각 사이에서 꺾이게 했다.<br>**`wn.js`**: 주인·지인 × 360·390·1400·933@1.5 × 두 테마로 **BAD 0, 콘솔 오류 0**. span·card 오른쪽 차이와 `scrollWidth`를 쟀다. 360·1400에서는 217px·209px로 2줄로 꺾이고, 390·933@1.5에서는 1줄이다.<br>**`wn_main.js`**(총괄, 조각마다 `.nowrap` 오른쪽 끝과 카드 끝): 가장 나쁜 값이 1400 −17, 390 −26, 360 −17이다(두 테마 같음). **BAD 0**.<br>**그림**: `wnclip-1400.png`·`wnclip-360.png`(다크). "지금 35.3% · 목표 6%" / "· +29.3%p (허용 ±5%p)"가 카드 안쪽에 있다.<br>**A 회귀**(`dash.js`): 첫 카드 y 360 572, 390 554, 1400 638로 앞 판정과 같다. 칩 2개, 누르면 2줄, BAD 0 |
| 2 목표·밴드 반올림 | **통과** | **고친 곳**: `pctText`(`Dashboard.tsx:115-117`, `String(Number(v.toFixed(2)))`)를 목표·밴드 둘 다에 쓴다.<br>**`frac.js`**: 지인 SCHD를 목표 2.5, 밴드 2.25로 바꾸면 카드가 **"지금 58.7% · 목표 2.5% · +56.2%p (허용 ±2.25%p)"**다. 58.68 − 2.5 = 56.18 → 56.2로 셈이 맞고, 밴드도 적은 그대로 나온다.<br>시험: `Dashboard.test.tsx:340` QQQ "지금 1.0% · 목표 2.5% · -1.5%p (허용 ±2.25%p)" |
| 3 뮤테이션 F1·F3·F6 | **통과** | 아래 표. 셋 다 잡힌다. 시험은 `ChartModal.test.tsx:124`(매도 "3/3 · 10-22"), `Dashboard.test.tsx:340`(미달 "-1.5%p"), `Dashboard.test.tsx:379`(title 전체 글)다 |
| 참고 ROADMAP 95px | 고침 | `ROADMAP.md:2562` "이름표 최대 106px — 기준일을 붙인 뒤" |
| 참고 version 주석 | 고침 | `version.py:145` "지금·목표·차이(+d%p)·허용 폭". `import app.version` → `0.45.3` |
| 참고 README 매도 이름표 | 고침 | `README.md:131` "매도 조건 (참고) 3/3 · 10-23 ▾" |

## 뮤테이션 (직접, 전체 `npx vitest run`)

명령은 `MUT_REPO=…/r048/rvF2 python3 tools/mutate.py r048/rvF2-muts.json r048/rvF2-mut.md`다. 도구가 매번 원복했고, 뒤 `git status`는 깨끗하다.

| 뮤테이션 | 결과 |
| --- | --- |
| F1 매도 이름표 기준일 뺌 (`BuyConditions.tsx:167`) | 잡힘 |
| F3 차이 `Math.abs` | 잡힘 |
| F6 "매도 조건도" title 이음표 되돌림 (`SignalShape.tsx:40`) | 잡힘 |
| G1 `pctText` 정수 반올림(`toFixed(0)`) | 잡힘 |
| G2 `pctText` 소수 하나(`toFixed(1)`, 2.25 → 2.3) | 잡힘 |
| G3 목표만 옛 `num(,0)` | 잡힘 |
| G4 밴드만 옛 소수 하나 식 | 잡힘 |
| G5 바깥 span 한 덩어리 `nowrap` 되돌림 | 잡힘 |
| G6 "지금" 조각 `nowrap` 뺌 | 잡힘 |
| G7 "(허용" 조각 `nowrap` 뺌 | 잡힘 |
| G8 차이 조각 `nowrap` 뺌 | 잡힘 |
| G9 목표 자리에 실제 비중 | 잡힘 |
| G10 밴드 자리에 목표 | 잡힘 |

모두 13개이고, **살아남은 것은 0이다.** 실행자의 `mutation.md` 5줄과 겹치는 F1·F3·F6·목표 반올림·한 덩어리 nowrap은 결과가 같다.

## 회귀·빌드

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| vitest | 통과 | `Test Files 62 passed (62)` / `Tests 1030 passed (1030)`. 새 단언은 기존 두 시험 안에 들어가서 개수는 앞과 같다 |
| lint | 통과 | `npx oxlint`에서 warning 22개(≤22). 오류 0 |
| tsc | 통과 | `npx tsc -b --noEmit` 종료 0 |
| build | 통과 | `npm run build` ✓. JS gzip 113.87 → 113.92 kB(+0.05) |
| 서버·API·마이그레이션 | 해당 없음 | 이번 범위에서 backend 변경은 `version.py` 주석 한 줄뿐이다 |
| 규제 | 통과 | 새 글자는 같은 숫자 줄을 조각으로 나눈 것뿐이고 낱말은 늘지 않았다 |

## 참고(조건 아님)

- 360·1400에서는 꺾인 둘째 줄이 "· +29.3%p …"처럼 가운뎃점으로 시작한다. 조각 앞에 점을 붙였기 때문이다. 읽기에는 지장이 없고 테두리 안에 있다. 다듬는다면 점을 앞 조각 끝으로 옮기면 된다.
- 목표·밴드는 소수 둘째 자리까지 보이고, 차이는 첫째 자리까지 보인다. 서버는 임의의 소수를 받는다(`schemas.py:32-33`, ge 0·le 100).
  그래서 33.333 같은 값이면 "목표 33.33%"와 차이 사이에 0.05 안쪽의 반올림 어긋남이 날 수 있다. 사람이 적는 2.5·2.25 같은 값에서는 맞는다.

## 끝 상태

```
$ git -C scratchpad/r048/rvF2 status       # remove 전
Not currently on any branch.
nothing to commit, working tree clean
$ git -C /home/user/Dashboard worktree remove --force scratchpad/r048/rvF2   # build 산출물(무시 파일) 때문에 --force
removed
$ git -C /home/user/Dashboard status --short   # 이 판정문을 쓰기 전
(빈 출력)
```
가짜 서버 8191은 `kill $(cat r048/rvF2.pid)`로 껐다(`curl localhost:8191/` → 000).
