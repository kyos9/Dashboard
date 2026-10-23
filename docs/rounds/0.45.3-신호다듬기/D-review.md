# 0.45.3 D 검토 — 차트 팝업 조건 줄(이름표 단추·펼친 풀이·기준일)

# 조건부 합격

동작·화면·규제·접근성은 모두 맞다. 막히는 곳은 하나다. 뮤테이션에서 **시험 구멍 3개가 살아남았다**(매도 줄 풀이, 기준일이 없을 때, "MM-DD" 꼴). 코드는 맞게 동작한다. 그것을 지키는 시험만 없다.

검토 환경: 자기 worktree `scratchpad/r048/rvD`(9f9eeca, 분리 HEAD), `frontend` 에서 `npm run build`(index-CtDJlrq2.js),
가짜 서버 포트 8181(`--reset`, 데이터 `scratchpad/r048/rvD-data`, PID 로 끔). 스크립트는 `scratchpad/r048/pw/rvD.js`·`rvD2.js`·`rvD3.js`, 그림은 `scratchpad/r048/rvD-shots/`.

## 조건부 — 고칠 것

1. **시험 더하기(뮤테이션 살아남음 3).** 전체 `npx vitest run` 으로도 살아남았다.
   - R3 / R7: 매도 줄 풀이를 아예 펼치지 않거나 다른 조건으로 펼쳐도 잡히지 않는다(`BuyConditions.tsx:181`).
     지금 시험은 매도 단추가 `aria-expanded=false` 인지만 본다(`ChartModal.test.tsx` 의 0.45.3 D 시험).
     → 매도 단추를 눌러 패널에 "✓ 충족 · MA50 위: …" 세 줄이 나오는지 본다.
   - R4: `{date && <p …>}` 막음을 지워도 잡히지 않는다(`BuyConditions.tsx:85`).
     지우면 `indicators.date` 가 null 인 종목은 펼칠 때 `date.slice` 에서 터진다. 지금 코드는 맞다 — QQQ 날짜를 null 로 끼우니 기준일 줄 없이 펼쳐졌다.
     → 날짜 null 카드로 펼치는 시험을 하나 둔다.
   - R5: `date.slice(5)` 를 `date` 로 바꿔도 잡히지 않는다. 시험이 `toHaveTextContent('10-22 기준')` 이라 "2026-10-22 기준" 도 통과한다.
     → 패널 첫 줄이 "10-22 기준" 으로 **시작**하는지 본다.

## 참고(조건 아님)

- R8 `max-width: 112px` 를 지워도 시험은 통과한다(jsdom 은 CSS 를 모른다). 게다가 데모의 이름표 폭은 최대 95px 라 상한이 아직 한 번도 걸리지 않는다. 폭 상한은 화면 측정으로만 지켜진다.
- 펼친 풀이의 "10-23 기준" 과 읽기 줄의 "2026-10-23" 이 한 화면에 섞인다(plan-recheck 의 참고). 계획이 "MM-DD 기준" 으로 정한 대로라 결함은 아니다.
- 데모 데이터에는 판정 불가가 섞인 종목이 없다. 그래서 응답을 끼워 넣어 확인했다(아래 "화면"). 데모에 그런 종목을 두는 것은 이번 범위 밖이다.

## RULES §3 표

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 완료 조건 | 통과 | plan.md:28·31·39·40 을 하나씩 확인했다.<br>• 이름표가 단추다: `<button aria-expanded aria-controls>`(`BuyConditions.tsx:56-68`).<br>• 두 줄 이름표: `flex-direction: column`(`index.css:5632-5649`). 360 측정 62×44 / 매도 줄 있는 날 95×44.<br>• 폭 상한 112px ≤ 120 이고, 측정 최대 95px.<br>• 높이 316/256 그대로: `ChartModal.tsx:115`, 이 라운드 diff 에서 높이 줄 변경 0.<br>• 15종목 접힌 상태 날짜 축: 360×640 최대 633(라이트·다크), 390 최대 633, 150% 최대 631.<br>• "일 때" 를 붙이지 않는다: `grep "일 때" BuyConditions.tsx` → 0.<br>• 기호는 `conditionMark` 그대로("✓ 충족"·"· 미충족"·"? 판정 불가", `display.ts:334-338`).<br>• 서버 풀이의 " — " 는 화면에서만 ", " 로 바꾼다(`BuyConditions.tsx:96`). 서버 문자열은 그대로다.<br>• 카드에서는 단추가 아니다: 대시보드 카드 보기·시그널 보기 모두 `.cond-toggle` 0개. |
| 계획 때 걱정 | 통과 | • 개발자 막음(칩마다 44px)은 줄마다 단추 하나로 풀렸다.<br>• 사용자 "이름표 옆 기준일" → 펼친 풀이 맨 위로 옮겼다.<br>• "서버 문구 그대로·— 둘" → 꼴을 바꾸고 이음표 0. 패널 텍스트에 "—" 없음(시험과 화면에서 둘 다 확인).<br>• 검토자 "테두리 단추" → `border:1px solid var(--border)`.<br>• 다시 보기 "폭 상한" → 두 줄·112px. "일 때"·✗ → `conditionMark` 를 그대로 쓴다.<br>• 참고 걱정: null 날짜면 기준일 줄을 뺀다(끼워서 확인). ▾ 는 `aria-hidden`. 접근 이름은 "매수 조건 2/4" / "매도 조건 (참고) 3/3"(ariaSnapshot). 두 줄은 따로 펼쳐진다(시험 + 화면).<br>• 남은 막음 0. |
| 회귀 | 통과 | • vitest: 62 파일 **1027 passed**(시작 1020, `baseline/vitest.txt`).<br>• lint 경고 22 → 22.<br>• 서버는 `114dd42..9f9eeca` 에서 `backend/app/version.py` 만 바뀌었다. 그래서 응답 사진은 D 와 관계없다. |
| 격리 | 해당 없음 | 새 엔드포인트·표 없음 |
| 마이그레이션 | 해당 없음 | 리비전 없음 |
| 호환 | 통과 | • API 변경 없음.<br>• `explain` 의 기본값이 false 라 다른 곳에서 쓰는 부품 모양은 그대로다.<br>• 기준일이 없는 응답(QQQ `indicators.date=null` 을 끼움)에서도 깨지지 않고 날짜 줄만 빠진다. |
| 입력 한도 | 해당 없음 | 새 입력 없음 |
| 뮤테이션 | **실패(조건부 1)** | • 총괄의 D 4줄(`mutation.md:17-20`)을 다시 돌렸다: 4/4 잡힘.<br>• 직접 8줄: R1 aria-expanded 고정 · R2 aria-controls 다른 id · R6 기호 빠짐 → 잡힘.<br>• R3 매도 풀이 안 펼침 · R4 날짜 null 막음 지움 · R5 연도 그대로 · R7 매도 풀이 조건 바꿈 → **살아남음**(전체 vitest 로도).<br>• R8 CSS 폭 상한 → 살아남음(jsdom 한계, 참고).<br>• 명령: `MUT_REPO=…/rvD python3 tools/mutate.py rvD-muts.json rvD-mut.md`. |
| 비밀 | 해당 없음 | 화면 문구만 바뀜 |
| 규제 | 통과 | • `git show 211364c \| grep "^+" \| grep -E "추천\|사세요\|팔라\|팔아\|저평가\|예측\|사라"` → 0.<br>• 펼친 패널을 4 크기 × 2 테마로 열어 정규식(—·팔·사세요·추천·예측·일 때)을 찾았다 → 0.<br>• 매도 칩은 회색 그대로다: 라이트 `rgb(82,98,122)`·바탕 `rgba(82,98,122,.1)`, 다크 `rgb(159,176,195)`.<br>• 펼친 매도 풀이 글자도 같은 회색(`--text-dim`)이다. 빨강·초록 없음. |
| 데이터 경계 | 해당 없음 | |
| 외부 호출 | 해당 없음 | 화면 상태만 있다(useState) |
| 화면 | 통과 | `rvD.js`: 주인 15종목 × {360×640·390×844 (hasTouch) · 1400 · 933@1.5} × 두 테마.<br>• 결과: `BAD 0`, 콘솔 오류 0, 가로 넘침 0(접힘·펼침 모두). 단추 높이는 최소 44, 폭은 최대 95.<br>• 키보드: Enter 와 Space 로 펼치고 접기를 줄마다 확인했다. `aria-expanded` 가 바뀌고, `aria-controls` 의 패널이 생겼다 사라진다.<br>• Tab 순서: ✕ → 매수 이름표 → 매도 이름표. 포커스 링 `outline solid 2px`.<br>• 팝업을 닫았다 다시 열면 접혀 있다.<br>• 지인 4종목 360: 축 최대 633.<br>• 판정 불가 섞임: VOO 를 adx·di null 로 끼우니 "? 판정 불가 · ADX > 20: …" 로 나온다.<br>• 매도에 null 이 섞이면 매도 줄을 그리지 않는다(`showsSellConditions`). MSFT 에 끼워 확인했다.<br>• 그림: `rvD-shots/inj-l-AAPL-open.png`, `360d-sell-1.png`. |
| 말 | 통과 | • 용어집에 "매수 조건 n/4 ▾ · ○○ 기준" 줄이 있다.<br>• README "화면 구성" 에 D 문장이 있다.<br>• 화면 말·시험이 서로 맞는다. |
| 성능 | 해당 없음 | 펼침은 사람이 누를 때만 그린다 |
| 가짜 서버 | 해당 없음 | 새 서버 상태 없음 |
| 문서 | 통과 | README·ROADMAP(11-7·0-1)·용어집에 D 가 들어갔다(9f9eeca).<br>측정값(축 633·이름표 95px)은 내가 다시 잰 값과 같다. |

## 끝 상태

```
$ git -C scratchpad/r048/rvD status
Not currently on any branch.
nothing to commit, working tree clean
```
뮤테이션은 줄마다 원래대로 되돌렸다(mutate.py 의 finally, 위 status 로 확인). 가짜 서버 8181 은 PID 로 껐다.
