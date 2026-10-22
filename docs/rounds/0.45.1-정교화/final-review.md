# 0.45.1 라운드 끝 회귀·호환 검토 + 앞 조건 재검토

**조건부 합격**

이번에 본 것: `baa6048..7c6b047` 전체이고, 앞 조건을 고친 커밋은 `f4ab145`·`c911773`·`31f9aa9`·`7c6b047` 이다.
돌린 곳은 내 worktree `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/rvfinal`(detached 7c6b047) 이다. 순서는 `npm ci` → `npm run build` → 가짜 서버 8190.
산출물(스크립트·로그·스크린샷·뮤테이션)은 `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r046/final/` 에 있다.

## 조건 (넷, 모두 작다)

1. **회귀: 목록 받기에 실패한 뒤 "전체 새로고침"으로 목록을 받아도 오류 줄이 남는다.**
   - 재현: `/api/stocks` 를 500("boom")으로 막고 `/history?ticker=VOO` 를 연다. 막기를 풀고 "전체 새로고침"을 누른다. 칩 19개와 차트가 다시 나오는데 "⚠ boom" 이 그대로 남는다.
   - 증거: 스크린샷 `final/pw/shots/b2-stale-after-refresh.png`, 스크립트 `final/pw/b2.js`·`stale.js`.
   - baa6048 에서는 시세 effect 의 `setError(null)` 이 새로고침 때 지웠다.
   - 원인: 지금은 `listError` 를 성공 갈래에서 지우지 않는다(`HistoryChart.tsx:38-49`, `:52`). `.then` 에 `setListError(null)` 을 넣으면 풀린다.
2. **뮤테이션 둘이 살아남았다.**
   - F5 `HistoryChart.tsx:48` 의 `setSearchParams` 를 끄면 소문자·이름 주소가 `?ticker=voo` 로 남는다. 커밋이 말하는 "티커로 바꿔 연다"를 시험이 보지 않는다(칩·이름 줄은 `shownTicker` 로 맞아서 통과한다).
   - F6 `:133` 의 `loading || !listed` 를 `loading` 으로 바꾸면 BCD 조건 1 의 "기다리는 동안 저장된 시세 없음 대신 불러오는 중"이 사라진다. 이것도 시험이 없다. 화면에서는 고쳐져 있다(아래 B2).
3. **말: 화면과 문서가 다르다.**
   - 화면은 "‘만·억·천’ 은 읽지 않습니다"(`numberDropped.ts:26`)인데, README:108 과 용어집 `docs/design/glossary.md:27` 은 아직 "‘만·억’" 이다.
   - 새 문구 "빼기(−)는 맨 앞에만 쓸 수 있습니다"는 README·용어집 어디에도 없다.
   - README:112 "비활성 종목·소문자 주소는 전처럼 열립니다"는 지금 동작(소문자·이름 주소 → 담은 종목의 티커로 바꿔 연다)과 맞지 않는다.
4. **디자인 규칙: `overflow-wrap: anywhere` 가 두 곳에 있다.** DESIGN_PROMPT.md:93(§0)과 index.css:6 이 금지한 값이다. 이번 라운드에 새로 들어왔다.
   - 들어온 곳: `index.css:1899` `.num-notice`(ef00c17), `:2670` `.history-unknown`(31f9aa9). baa6048 에는 주석 한 줄뿐이었다(`grep -c` → 1, 지금은 3).
   - 규칙이 허락하는 `overflow-wrap: break-word` 로 바꿔 빌드한 화면에서 재 봤다. 360 에서 300자 티커의 넘침이 0, 줄 폭 328, 높이 59 로 지금과 같다(`final/pw/bw.js`).

## 앞 조건 다섯 (A 둘 · BCD 셋)

| 앞 조건 | 판정 | 증거 |
| --- | --- | --- |
| A1 시험 셋 R1·R2·R3 | 통과 | 시험이 더해졌다: `droppedKinds('5천')`, 이어 치기 "-3"→"5"→"." 로 줄이 '소수점' 으로 바뀌는 것, 음수 칸 "0.2−" 붙여넣기. 내 뮤테이션 F10(minusMiddle→minus)도 잡혔다. 1bcb4c0→7c6b047 시험 diff 에서 지운 단정은 `getByRole('status')` → `live()` 로 바꾼 것과 문구가 바뀐 것뿐이다 |
| A2 화면 읽기 live region | 통과 | 빌드한 화면, 1400·390d·360. `/stocks` 를 열자마자(치기 전) `[data-num-live]` 1개가 있고 글은 "", `aria-live=polite`, role 은 없다. "-3" 을 치면 글이 "VOO 보유수량 — 빼기(−)는 넣을 수 없습니다 · 지금 값 3" 이 되고, 보이는 줄은 `aria-hidden=true` 다. Tab 을 누르면 글이 "". aria-modal 팝업(일괄 수정)이 열린 동안에도 CDP `Accessibility.getFullAXTree` 에서 그 노드가 `ignored:false` 다. `role=status` 수: /stocks 0, /rebalance 1(전부터 있던 반영 줄). 섞이지 않는다(`final/pw/a.js`). 뮤테이션 F8(줄을 다시 role=status)·F9(정리 안 함) 잡힘 |
| BCD1 B2 목록 받기 실패 | 통과(회귀 하나는 조건 1) | `/api/stocks` 500 → `/api/history/VOO?range=1y` 200 한 번, 캔버스 그려짐, 범례 "매수 34일 (12번)…", "boom" 줄이 보이고 "저장된 시세 없음"·"매수 0일" 은 없다. 목록을 2.5초 늦추면 0.9초 때 "불러오는 중" 이 보이고 "저장된 시세 없음" 은 없다. 끝에는 정상 범례 |
| BCD2 D2 비활성만 | 통과 | friend 의 목록을 모두 `active:false` 로 바꿨다 → 줄 0, 종목별 칸 0. new 계정 → "종목을 담으면 여기서 종목마다 알림을 끌 수 있습니다." 그대로. 뮤테이션 F1 잡힘 |
| BCD3 D3 키보드 포커스·sticky | 통과 | `.push-modal` 계산값 `scroll-padding-top: 72px`, `overflow-y: auto`. 360×740 두 테마·390×844·933×600@1.5·1400 dark 에서 Shift+Tab 22번과 Tab 22번 → 머리 밑이나 화면 밖에 숨은 포커스 0. **대조**로 `scroll-padding-top:0` 을 넣으면 같은 스크립트가 "이 기기에서 알림 켜기"(top 0.4, 머리 bottom 68)를 잡는다(`final/pw/d.js`·`d3neg.js`) |

참고로 고친 것도 확인했다:
- 긴 티커: 300자 주소를 360·390·1400 × 두 테마로 열었다 → 넘침 0. 다만 쓴 값은 조건 4.
- 모두 다시 받기 뒤 포커스: Enter → 포커스 `SUMMARY 종목별 알림 — 모두 받음`, 15/15 체크, 다음 Tab 은 체크칸. 뮤테이션 F2 잡힘.
- 소문자·이름 주소: `voo` → `?ticker=VOO`, 칩 VOO 눌림, 요청은 `/api/history/VOO` 하나(소문자 요청 0). `삼성전자` → `?ticker=005930.KS`, 칩 눌림, 요청 하나, 문장 없음. `NOPE` 문장 그대로. 콘솔 0.
- 음수 칸 글자 키보드: 근원 PCE 예상치 `inputmode=text`, 보유수량 `decimal`, 새로 넣을 돈 `numeric`(바뀌지 않음). "-0.2" → 값 -0.2, 줄 0. 뮤테이션 F7 잡힘.

## §3 항목별

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 완료 조건 | 통과 | 앞 판정 A·BCD 의 완료 조건이 그대로이고, 위 다섯도 풀렸다 |
| 계획 때 걱정 | 통과 | plan.md 의 플래그 이름이 `--demo-backup-warning` 으로 맞춰졌다. 막음은 처음부터 하나였고 풀렸다. 앞 판정이 짚은 "표에 없던 걱정 셋"(D2 비활성만·긴 티커·D1 포커스)은 코드로 반영됐다 |
| 회귀 | **조건 1** | pytest `1487 passed, 3 skipped`(시작 1484, `final/pytest.txt`). vitest `61 files, 970 passed`(시작 944, 흔들림 없음). lint 경고 22(시작 22, `grep -c "warning "`). build 통과(오류 0). 응답 사진: `snapshot.py final/snap 8191` → `snapdiff baseline/snap final/snap` → "같음 / 차이 0"(11개 파일, 새 설정 없이). 목록 실패 뒤 새로고침에서 오류 줄이 남는 회귀 하나가 있다(조건 1) |
| 격리 | 해당 없음 | 새 엔드포인트·표 없음. `backend/app` 의 변경은 `routers/push.py` 3줄과 `version.py` 뿐 |
| 마이그레이션 | 해당 없음 | `git diff --stat baa6048..7c6b047 -- backend/alembic` 빈칸 |
| 호환 | 통과 | `apidiff baseline/openapi.json final/openapi.json` → 빠짐 0 · 타입 바뀜 0 · 더해짐 0. **옛 서버↔새 화면**: 0.44.0(819f1f2, 지금 배포된 것) 가짜 서버에 새 dist 를 얹어 8190 에 띄웠다. 1400·390 에서 `/`, `/history?ticker=voo`(→VOO, 칩 눌림), `?ticker=NOPE`, `/stocks`, `/rebalance`, `/macro` 를 열었다 → 넘침 0, 콘솔 0, 4xx 0. 알림 팝업은 muted 없는 서버라 종목별 칸 0, 안내 줄 0(`final/pw/old.js`). 끝난 뒤 그 worktree 는 지웠다 |
| 입력 한도 | 해당 없음 | 새로 받는 값 없음(D4 는 앞 판정에서 통과) |
| 뮤테이션 | **조건 2** | 직접 11개(`MUT_REPO=…/rvfinal python tools/mutate.py final/muts.json final/mut-result.md`). 잡힘: F1·F2·F3·F4·F7·F8·F9·F10. 살아남음: F5(주소 바꾸기)·F6(기다리는 동안 불러오는 중)이 조건이다. F11(`history-unknown` 클래스 지움)은 CSS 라 jsdom 시험이 볼 수 없고 브라우저로 확인했으니 참고로 둔다. 돌린 뒤 worktree 는 깨끗하다 |
| 비밀 | 해당 없음 | 키·로그 길이 바뀌지 않았다(앞 판정 BCD 에서 SENTINEL 확인) |
| 규제 | 통과 | `git diff baa6048..7c6b047 -- frontend/src backend/app deploy` 의 + 줄에서 추천·사세요·팔라·저평가·예측·수익률 0건. 규제 영향 없음 |
| 데이터 경계 · 외부 호출 | 해당 없음 / 통과 | 새 표 없음. 소문자 주소가 이제 시세를 한 번만 부른다(전에는 소문자로 한 번) |
| 화면 | **조건 4** | 1400·390·360 × 두 테마, 933@1.5: 넘침 0, 콘솔 0(일부러 낸 500 빼고), 키보드 Shift+Tab·Tab 숨김 0. 디자인 §0 줄바꿈 규칙 위반 둘(조건 4) |
| 말 | **조건 3** | 위 조건 3 |
| 성능 | 통과 | 첫 화면 JS gzip 111.71 → **112.41 kB**(+0.70, A 판정 때 112.23 에서 +0.18). 대시보드 20종목: 7c6b047 50.6·55.1·51.9·48.5 ms, **같은 때 baa6048 54.6 ms**, 쿼리 12 = 12. 시작 수치 42.8 과의 차이는 기계 부하다(대시보드 경로 코드는 바뀌지 않았다) |
| 가짜 서버 | 통과 | `test_devtools.py` 가 전체 pytest 에 들어 통과. `--demo-backup-warning` 은 앞 판정에서 확인 |
| 문서 | 조건 3 외 통과 | `version.py` `APP_VERSION = "0.45.1"`, 화면 머리 `v0.45.1`. ROADMAP 11-5 에 고친 것과 사용자 확인 반영이 있다(:2506). 0-1 의 다음 후보·주인 확인(:42 아이폰 "-0.2")이 있다. DEPLOY 는 바꿀 것이 없다(마이그레이션·새 .env 없음, `git diff --stat -- DEPLOY.md` 빈칸) |

## 참고 (조건 아님)

- 음수 칸이 `inputMode=text` 로 바뀌었다. 아이폰 글자 키보드의 자동 고침·첫 글자 대문자가 숫자에는 대개 무해하지만, `autoCorrect="off"`·`autoCapitalize="off"` 를 같이 주면 더 안전하다. 실기기 확인은 ROADMAP:42 에 이미 올라 있다.
- `listFailed` 는 한 번 true 가 되면 계속 true 로 남는다. 지금은 해가 없다(목록을 받으면 `all` 이 우선한다).
- 이름 대조 `s.name === ticker` 는 비활성 종목 이름도 받는다. 그때 이름 줄·칩은 없지만 차트는 열린다. 비활성 티커의 지금 동작과 같다.
- 앞 판정의 vitest 흔들림(`backToClose.modals`)은 이번 전체 실행에서 생기지 않았다.

## 끝 상태

- 가짜 서버(8190)는 세 번 띄웠다. 새 화면, 0.44.0 서버 + 새 화면, break-word 대조다. 모두 `kill $(cat final/server*.pid)` 로 껐다. 끈 뒤 `curl` → 000, `ps -p` → 없음.
- 잠깐 만든 worktree 둘(`rvfinal-old` 819f1f2, `rvfinal-base` baa6048)은 `git worktree remove --force` 로 지웠다.
- 저장소 `/home/user/Dashboard` 의 `git status --short` → 0줄.
- 내 worktree:
  ```
  $ git -C …/scratchpad/rvfinal status
  Not currently on any branch.
  nothing to commit, working tree clean
  $ git -C …/scratchpad/rvfinal log -1 --format=%H
  7c6b047e55ff329769f099b6372d741f1a35168f
  ```
