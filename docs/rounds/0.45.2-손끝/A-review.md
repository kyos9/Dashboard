# 0.45.2 A(숫자 칸이 말한 뒤) 검토 판정

## 조건부 합격

내 worktree 에서 직접 돌렸다. worktree 는 `scratchpad/r047/rvA`, 커밋은 `8cbcf83`. 확인한 A 커밋은 `06368e6` A2 · `c395e05` A3 · `243009e` A4 · `7a5a184` A1 이다. 완료 조건·화면·회귀는 모두 통과했다.
뮤테이션은 내가 4줄을 돌렸고 그중 **2줄이 살아남았다**(§3 합격선은 "살아남은 것 0"). 두 줄 모두 동작은 맞다. 브라우저로 확인했다. 시험만 비어 있다.

### 조건부 목록 (고쳐야 함)
1. **A1 visualViewport 연결이 시험에 없다.** `NumberInput.tsx:184` 의 `bottom: vv.offsetTop + vv.height` 를 `bottom: vv.height` 로 바꿔도 `src/components` 시험이 전부 통과한다.
   계획(검토자 걱정 답)에는 "vitest 에서 `visualViewport` 목으로 offsetTop·height 를 바꿔 자리 계산을 시험"이라고 적혀 있다. 그런데 지금 시험은 순수 함수 `noticeTop` 에 `view` 를 직접 넘기는 것뿐이다(`NumberInput.test.tsx` "폰 키보드가 올라오면…").
   컴포넌트가 `window.visualViewport` 를 읽어 `view` 를 만드는 줄은 jsdom 에 vv 가 없어서 한 번도 돌지 않는다.
   고칠 것: 컴포넌트 시험 하나를 더한다. `window.visualViewport` 를 `{offsetTop:200, height:400}` 목으로 두고, 칸이 위쪽에 있을 때 `style.top` 이 `552px` 인지 본다.
2. **A3 대시보드에서 수정을 다시 열 때 줄을 지우는 동작이 시험에 없다.** `PortfolioView.tsx:118` 의 `setSavedNote('')` 를 지워도 `src/components`·`Dashboard.portfolio.test.tsx`·`Dashboard.test.tsx` 가 통과한다.
   종목 관리 쪽(`StockManager`)만 시험이 있다. 대시보드에도 "저장 → 줄 → 다시 열면 없음" 시험을 하나 더한다.

### 참고 (막지 않음)
- A3: 저장한 뒤 그 종목 이름을 다시 고치고 저장하지 않은 채 ✕ 로 닫으면, 줄에 저장하지 않은 새 이름이 나온다. `StockEditModal.tsx` 의 `savedLabels` 가 닫는 순간의 `drafts` 를 읽기 때문이다. 드문 경로라 막지 않는다.
- A3: `role="status"` 줄이 내용과 함께 새로 생긴다(`PortfolioView.tsx`·`StockManager.tsx` 의 `{savedNote && <p role="status">}`). 일부 화면 읽기 프로그램은 처음부터 있던 live 영역만 읽는다. 아이폰 VoiceOver 확인 목록에 넣을 만하다.
- A4: 다시 보기의 참고 ①·②가 남아 있다. ①은 "새로 넣을 돈"이 한 덩이에 세 번 나오는 것, ②는 새 돈만 나누기에서 위 줄은 "나눴습니다"인데 아래는 "반영"인 것이다. 둘 다 계획에서 참고로 둔 것이다.
- A1: 핀치로 확대했을 때(offsetLeft>0) 줄은 레이아웃 화면 가운데에 놓여서 가로로는 보이는 부분 밖일 수 있다. 다만 칸 글꼴이 16px 라 iOS 가 칸에 들어갈 때 스스로 확대하지 않는다. 그래서 키보드 상황에서는 생기지 않는다(390 에서 `fontSize 16px` 확인).

---

## §3 표

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 완료 조건 | 통과 | 아래 "완료 조건" 절 |
| 계획 때 걱정 | 통과 | 아래 "계획 걱정 반영" 절. 막음 0 |
| 회귀 | 통과 | pytest `1492 passed, 3 skipped`(시작 1487) · vitest `Test Files 62 passed · Tests 999 passed`(시작 61·972) · lint 경고 22(시작 22) · build `index-BhSrjxi6.js 364.16 kB │ gzip 113.10 kB`(시작 362.77/112.42, A3·A4 문구만큼 늘었다). A 커밋 넷은 `frontend/` 밖을 고치지 않았다(`git show --stat` 에서 frontend 밖 줄 0). 그래서 응답 사진은 A 와 무관하다 |
| 격리 | 해당 없음 | 새 엔드포인트·표 없음 |
| 마이그레이션 | 해당 없음 | 리비전 없음 |
| 호환 | 통과 | `apidiff.py baseline/openapi.json 끝` → `빠짐 0 · 타입 바뀜 0 · 더해짐 1 ['LogEntry.at']`. 더해진 하나는 B5 것이다. A 는 서버를 쓰지 않는다. `onSaved(saved: string[])` 는 인자를 더한 것이라 부르는 쪽이 안 써도 된다 |
| 입력 한도 | 해당 없음 | 서버로 가는 새 값 없음 |
| 뮤테이션 | **실패(조건부 1·2)** | 아래 "뮤테이션" 절. 총괄 A 14줄은 모두 잡힘(`mutation.md:9-22`). 내 4줄 중 2줄이 살아남았다 |
| 비밀 | 해당 없음 | 키·외부 호출 없음 |
| 규제 | 통과 | A 커밋 넷의 더한 줄에서 `추천|사세요|팔라|저평가|예측` → 0. "팔았으면 ‘팔았다’를 고르세요"는 지난 거래를 고르는 말이다 |
| 데이터 경계 | 해당 없음 | 표·칸 없음 |
| 외부 호출 | 해당 없음 | |
| 화면 | 통과 | 빌드한 화면(`index-BhSrjxi6.js`, 가짜 서버 8180)으로 1400 · 390m · 360m × 두 테마를 검사했다. 줄을 잰 횟수 258, `BAD 0`. 가로 넘침 0, 콘솔 오류 0. Tab 으로 칸을 떠나면 줄이 내려가고 포커스는 `평단가` 로 간다. 아래 "화면" 절 |
| 말 | 통과 | 용어집 `glossary.md:30-31`, README 118-121 이 화면 문구와 같다. 옛 말("가진 전체 수량을 넣", "판 만큼", "위 주문 ↑")은 `frontend/src` 에서 0 |
| 성능 | 통과 | 줄이 떠 있는 동안만 rAF 로 잰다(`NumberInput.tsx` effect, 줄이 내려가면 `cancelAnimationFrame`). 번들은 +1.4 kB |
| 가짜 서버 | 해당 없음 | 새 서버 상태 없음(데모 그대로 A1~A4 를 모두 걸어 볼 수 있었다) |
| 문서 | 통과 | README·용어집은 위와 같다. 명세·DEPLOY·방침은 해당 없음 |

## 완료 조건 (plan.md A + 다시 보기)

- **A1** 일괄 수정 팝업을 360·390·1400 × 두 테마, 두 화면(종목 관리 `/stocks`, 대시보드 `/`)에서 봤다. 첫·가운데·마지막 줄 보유 수량에 "-" 를 쳤다.
  줄 ∩ 머리 h3 · ✕ · 치는 칸 = 0 이고, 줄 전체가 visualViewport 안이다. 팝업 본문(`.modal.stock-edit-modal`)을 +80·−160·+400·−1000·+10000 만큼 스크롤한 뒤에도 같다.
  예(`pw-a.txt`):
  `360-dark /stocks first notice y 68 h 79 field y 234 overlap[h3,x,field] 0,0,0 visible in`
  `360-light / mid scroll 400 … notice y 653 h 79 field y 28 overlap 0,0,0 visible in`(칸이 위로 가면 아래 끝 ②)
  `390-light /stocks mid notice y 8 …`(머리가 스크롤로 사라지면 팝업 보이는 위 + 8, 다시 보기 ①)
  - 리밸런싱 표 편집(보유수량 15칸 중 첫·끝, ±스크롤)과 거래 수량도 모두 겹침 0, 화면 안이다.
  - **키보드(offsetTop>0) 재현**: CDP `Input.synthesizePinchGesture` 로 2.2배 확대해 offsetTop 을 140~460 으로 만들었다. 390·360 × 칸 0·2·4·마지막, 스크롤 ±60/−120 에서 모두 줄이 vv 안이고 겹침 0 이다(`pw-vv.txt`, `BAD 0`).
    예: `390 idx 2 vv {"t":460,…} notice rect {"top":467.98,…}` / `360 idx 0 scroll 60 vv t 140 h 336 → notice 389.4~468.3`(② = vv 아래 끝 − 8)
  - vitest 목 시험은 순수 함수 수준에만 있다. 조건부 1 참고.
- **A2** 붙는 칸은 넷이다. 일괄 수정, 종목 추가, 리밸런싱 표·카드(`useRowFields`)가 한 마디를 함께 쓴다. 거래 수량은 "샀다"일 때만 붙는다.
  브라우저: `trade buy: … 지금 값 6,326 · 팔았으면 ‘팔았다’를 고르세요` / `trade sell: … 지금 값 3`(꼬리 없음).
  시험: `RebalancePanel.test.tsx`(붙는 칸·안 붙는 칸), `NumberInput.test.tsx`, `StockEditModal.test.tsx`, `StockManager.test.tsx`.
  화면 읽기 자리도 같은 글이다(`live()` 단언).
- **A3** 시험 넷이 있다. 한 번에 성공 `['VOO','QQQ']`, 일부 실패 뒤 다시 저장하면 합친 수, 일부 저장 뒤 실패를 버리고 닫기 `['VOO']`, 저장 없이 닫기. `savedStocksText` 는 하나·셋까지·넷부터("A 외 3종목")를 본다.
  브라우저: 두 화면 모두 수정 단추 바로 아래 12px 에 `✓ VOO을(를) 저장했습니다` 가 뜨고, 다시 열면 사라진다(`FAIL` 없음). 저장 없이 ✕ 로 닫으면 줄이 없다.
- **A4** 360 에서 `#new-money` 칸과 풀이 "새로 넣을 돈 ₩1,000,000 반영 — …"가 한 화면 안이다(`360-light-a4.png`). 칸을 비우면 앞말이 사라진다. `role=status` 는 하나뿐이다(시험). 금액은 `plan.newMoney` 를 `amount()` 로 낸다(다시 보기 ③).

## 계획 걱정 반영 (plan-dev / review / user / recheck)

| 걱정 | 반영 |
| --- | --- |
| 칸 아래 줄이 아래 칸·저장 단추를 덮음(셋 모두) | 반영. 칸 옆에 두지 않고 ①머리 아래 / ②아래 끝(`numberDropped.ts` `noticeTop`) |
| 칸이 머리 밑으로 가면 제목을 덮음(review) | 반영. 줄이 칸을 따라가지 않는다. 스크롤 뒤 h3·✕ 겹침 0(위) |
| 스크롤 상자 이벤트가 올라오지 않음(dev 1) | 반영. 떠 있는 동안 rAF 로 다시 잰다 |
| 390×400 은 offsetTop 을 재현하지 못함(review) | 반영했지만 덜 됐다. 순수 함수만 목 시험이고 컴포넌트 연결은 시험이 없다(조건부 1). 브라우저에서는 핀치로 확인했다 |
| 머리가 sticky 가 아님 → `max(머리 아래, 팝업 위, vv.offsetTop)+8`, 둘 다 겹치면 ②(recheck) | 반영(`noticeTop` 첫 줄 · `if (!overlaps && …) return first` 다음이 ②) |
| A2 문구 "지금" 두 번·주어·종목 추가 "판 만큼"·거래 수량 위험(user·dev) | 반영(`HOLDING_MINUS_HINT`·`TRADE_MINUS_HINT`, 거래는 `side === 'buy'` 일 때만). "팔았다" 칸에는 붙이지 않는다(review 참고) |
| A3 누적·✕ 경로·어느 종목·자리·사라지는 때 | 반영(`saved` ref 누적·`close()` 에서 알림·이름·수정 단추 아래·다시 열면 지움). 화면을 떠나면 언마운트로 사라진다 |
| A4 조사·화살표·풀이 사라짐·두 번 읽힘·`plan.newMoney` | 반영("₩X 반영 —"로 조사 없음·화살표 없음·풀이 유지·status 하나·`plan.newMoney`) |

## 뮤테이션

총괄의 A 14줄은 모두 잡혔다(`mutation.md:9-22`). 내가 돌린 것은 아래 넷이다(`MUT_REPO=<내 worktree> python scratchpad/tools/mutate.py rvA-out/muts.json`).

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| A1 보이는 아래 끝을 offsetTop 없이(`vv.offsetTop + vv.height` → `vv.height`) | `frontend/src/components/NumberInput.tsx` | **살아남음** |
| A3 대시보드 수정 다시 열 때 줄 안 지움(`setSavedNote('')` 지움) | `frontend/src/components/PortfolioView.tsx` | **살아남음** |
| A2 리밸런싱 표·카드 보유 칸 한 마디 뺌 | `frontend/src/pages/RebalancePanel.tsx` | 잡힘 |
| A4 새 돈 0 일 때도 앞말(`> 0` → `>= 0`) | `frontend/src/pages/RebalancePanel.tsx` | 잡힘 |

돌린 뒤 `git -C rvA status --short` 는 빈 출력이다(원래대로 되돌아왔다).

## 화면

- 스크립트는 저장소 밖에 있다. `scratchpad/r047/rvA-pw/a.js`(세 크기 × 두 테마), `vv.js`(핀치로 offsetTop), `fs.js`(칸 글꼴). 출력은 `scratchpad/r047/rvA-out/pw-a.txt`·`pw-vv.txt`, 스크린샷은 `scratchpad/r047/rvA-shots/` 에 있다.
- 서버를 띄운 명령: `(nohup python -m devtools.fake_server --port 8180 --data-dir scratchpad/r047/rvA-data --reset … & echo $! > rvA-out/fake.pid)`. 끌 때는 `kill $(cat rvA-out/fake.pid)` 를 썼다.

## 작업 트리

```
$ git -C scratchpad/r047/rvA status
Not currently on any branch.
nothing to commit, working tree clean
$ git -C /home/user/Dashboard status --short     # 이 판정문을 쓰기 전
(빈 출력)
```
저장소에 쓴 것은 이 파일 하나다. 커밋은 하지 않았다.
