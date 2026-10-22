# 0.45.0 항목 D 재검토 (8bc439d · 9333850 · 177eeb3, 대상 261ab1e) — 두 번째 검토자

# 조건부 합격

앞 판정(`D-review.md`)의 막음 두 가지가 풀렸다.
- **① "버리고 닫기" 뒤 스크롤이 잠기던 것**: 풀렸다. ✕·취소·뒤로가기·Esc·바깥 누르기, 이 다섯 길 모두와 부분 실패 뒤에도 `overflow=''` 이고 휠 스크롤이 된다.
- **② 뮤테이션 M1(첫 실패 줄)**: 이제 잡힌다.

다른 팝업의 스크롤 잠금도 깨지지 않았다. 차트 팝업, 사용자 목록 위 확인 창, 팝업을 닫고 곧바로 다른 팝업을 여는 경우를 빌드한 화면에서 확인했다.
제품 동작에서 막는 결함은 찾지 못했다. 다만 시험 쪽에 고칠 것이 둘 있다(아래 "조건").

worktree: `/home/user/Dashboard/.claude/worktrees/agent-a81ef8a8ada3b395b`, `261ab1e` 에 detached.
결과물: `/tmp/claude-0/-home-user-Dashboard/810611e0-dc75-5957-9144-c46de59cce1c/scratchpad/r045/Drev2/`

## 조건 (다음 라운드 끝 검토 전까지)

1. **D 의 화면 시험이 부하에서 가끔 실패한다(고쳐야 함).**
   - 증상: `StockEditModal.test.tsx` 의 "폰 뒤로가기 — … 계속 고치기면 그대로"와 "첫 실패 줄로 옮기고 …"가 가끔 실패한다.
     실패 자리는 `:96` `getByRole('alertdialog')`(그리고 `:117/121`)이다.
   - 전체 vitest 를 세 번 돌렸다. 1회째는 `Tests 2 failed | 935 passed (937)`, 2·3회째는 `937 passed (937)` 였다. 부하 평균은 약 10(4코어)이었다.
   - 이 파일만 6개를 동시에 돌리면 1개가 같은 자리에서 실패한다(`Drev2/stress*.txt`). 혼자 돌리면 3/3 통과다.
   - 원인(읽은 것): `back()`(`StockEditModal.test.tsx:34-39`)은 `history.back()` 뒤 **30ms 를 고정으로** 기다린다.
     "계속 고치기"로 확인 창이 빠지면 `backToClose.ts` 의 `settle`(`setTimeout 0` → `history.go(-1)`)이 한 박자 뒤에 칸을 뺀다.
     이 일과 시험의 다음 뒤로가기가 겹친다.
   - 사람이 누르는 속도에서는 생기지 않는다. 브라우저로 같은 순서를 걸었을 때 정상이었다.
   - 그래도 CI 를 가끔 빨갛게 만들 수 있다. 고정 시간 대신 `waitFor`/`findByRole` 로, 또는 settle 이 끝나기를 기다리게 바꾼다.
2. **뮤테이션 하나가 살아남았다(고쳐야 함).**
   - 바꾼 것: `UsersModal.tsx:62-65` 정리에서 `release()` 를 뺐다.
   - 결과: `npx vitest run src/lib src/components src/pages` 가 모두 통과했다.
   - 팝업 열한 곳 중 시험이 overflow 를 보는 곳은 넷뿐이다: `ConfirmDialog`·`ChartModal`·`StockEditModal`·`scrollLock`.
   - 열한 곳의 바꿈은 기계적으로 같다(나머지 7곳 diff 의 더한 줄·뺀 줄이 각각 7×3줄로 같다). 브라우저에서도 사용자 목록을 닫은 뒤 스크롤이 된다.
   - 그래도 주인이 짚은 "사용자 목록 위 확인 창" 길은 시험이 없다. 사용자 목록 → 차단 확인 → 취소 → 닫기 뒤 `overflow===''` 를 보는 시험 하나를 둔다.
3. (참고, 막지 않음)
   - README 의 새 줄(`README.md`, 177eeb3 "저장 안 한 일괄 수정")에는 "뒤로가기·취소·✕·Esc"만 있다. 9333850 에서 더한 **바깥 누르기**가 빠졌다.
   - 앞 판정 조건 3이 status 에 아직 없다: D5 제목을 하나로 할지, README 화면 구성·ROADMAP 0-1 을 언제 정리할지.
   - 폰에서 부분 실패 뒤 첫 실패 줄이 화면 맨 위(top≈0)로 간다. 그때 시트 머리(✕)도 함께 위로 밀려 나간다(`Drev2/partial-two.png`). 줄은 보이므로 완료 조건은 맞다.

## 앞 판정 조건 확인

| 조건 | 결과 | 증거 |
| --- | --- | --- |
| ① 버리고 닫기 뒤 overflow `''`·스크롤 됨, 부모가 실제로 지우는 시험 | **풀림** | 원인 처리: `lib/scrollLock.ts` 는 잠근 수를 센다. 처음 잠글 때 원래 값을 쥐고, 마지막이 풀 때 되돌린다. `released` 로 두 번 풀기도 막는다. `grep style.overflow frontend/src`(시험 제외) → scrollLock.ts 밖 0건. `lockBodyScroll()` 은 11곳이고, 812eb5e 의 `overflow = 'hidden'` 11곳과 하나씩 맞는다. 시험: `StockEditModal.test.tsx:159-188` `Host` 가 실제로 시트를 지운다. ✕·취소·뒤로가기 → 버리고 닫기 뒤 `overflow===''`. 브라우저(`Drev2/scroll.js`, 390 폰): `✕/취소/뒤로가기/Esc → 버리고 닫기: 닫힘, overflow='', 칸 0` + `휠 스크롤 scrollY=1200`. PC 1400 바깥 누르기 → 버리고 닫기도 같다. 부분 실패(둘 400) 뒤 버리고 닫기 → `overflow 풀림, 스크롤 됨` |
| ② 뮤테이션 M1 `failed[0]`→마지막 | **풀림(잡힘)** | 새 시험 `StockEditModal.test.tsx:190-209` "여러 종목이 실패하면 **첫** 실패 줄로"는 `scrolled == ['VOO']` 를 본다. `mutate.py`(MUT_REPO=내 worktree) → `M1 … 잡힘`. 브라우저: QQQ·8766.T 둘을 실패시키면 위의 QQQ 가 맨 위(top≈0, 아래 것 3561)로 간다 |
| ③ (참고) D5 제목·README·ROADMAP | 남음(참고) | 위 조건 3 |

## §3 검사표 (D 만)

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 완료 조건 | 통과 | D2~D6 은 앞 검토에서 통과했고, 그 뒤 D 의 바꿈은 아래 넷이다. **D6 Esc·바깥 누르기(9333850)**: 고친 것이 있으면 Esc(390)·바깥 누르기(1400) 둘 다 묻는다. 확인 창의 Esc·바깥 누르기는 확인 창만 닫고 다시 묻지 않는다(`PASS 확인 창 Esc → 확인 창만 …`, `PASS PC 확인 창 바깥 누르기 → … 다시 묻지 않음`). 고친 것 없이 바깥 누르기 → 바로 닫힌다. 폰에서는 시트가 화면 전체라(390: top 0, w 390, h 780) 바깥이 없다. **`/chart?ticker=VOO`** → `/history?ticker=VOO`, 화면 위쪽에 VOO(`Drev2/chart-voo-360.png`). **스크롤 잠금**: 위 ① |
| 계획 때 걱정 | 통과 | 앞 판정이 plan-dev/review/user 의 D 걱정을 모두 "반영 확인, 막음 0"으로 봤다. 그 뒤 바꿈은 불합격을 고친 것과 사용자 확인 반영뿐이라 새 걱정이 없다 |
| 회귀 | 통과 (조건 1) | pytest `1462 passed, 3 skipped`(시작 1425, 줄지 않음 — A·C·D 포함). vitest `937 passed (937)`(시작 912, 2/3회. 1회는 조건 1의 흔들림). lint 경고 22 → 22. `tsc -b` exit 0. 응답 사진: 오늘 날짜로 812eb5e 를 다시 떠서 비교했다(기준은 어제 것이라 가짜 시세가 하루 밀렸다). `snapdiff snap812 snap` → "같음 / 차이 0" |
| 격리 | 해당 없음 | D 에 새 엔드포인트·표 없음 |
| 마이그레이션 | 해당 없음 | D 에 새 리비전 없음 |
| 호환 | 통과 | `apidiff baseline/openapi.json Drev2/openapi.json` → 빠짐 0, 타입 바뀜 0, 더해짐 1 `DashboardCard.sell_conditions`(C 항목, D 와 무관) |
| 입력 한도 | 해당 없음 | 새로 받는 값 없음 |
| 뮤테이션 | **조건부** (12 중 11 잡힘) | `Drev2/mut.md`. 잡힌 것: M1 첫 실패 줄. S1 셈 무시하고 늘 되돌림. S2 늘 원래 값을 다시 쥠. S3 두 번 풀기 허용. S4 ConfirmDialog 안 풂. S5 StockEditModal 안 풂. S6 ChartModal 안 풂. E1 바깥 누르기 대상 확인 빼기. E2 Esc 를 확인 창 떠 있어도 시트가 받음. E3 Esc 옛 동작(고친 것 있으면 무시). R1 `/chart` 넘김에서 `?ticker` 버림. **살아남음**: S7 UsersModal 안 풂 → 조건 2. 돌린 뒤 `git status` 깨끗 |
| 비밀 | 해당 없음 | 177eeb3·9333850 의 D 부분은 화면만 바꿨다. D4(백업 실패 문구)는 앞 검토에서 통과했고 그 뒤 바뀌지 않았다 |
| 규제 | 통과 | D 의 더한 줄(scrollLock·Esc·라우트·시험·README 한 줄)에 "추천·사세요·팔라·저평가·예측" 0건 |
| 데이터 경계 | 해당 없음 | |
| 외부 호출 | 해당 없음 | |
| 화면 | 통과 | `npm run build` 뒤 가짜 서버 8181, `Drev2/scroll.js` → **PASS 61, FAIL 1**. FAIL 1은 내 조건 `top >= 0` 이 −0.x 를 놓친 것이다. 스크린샷에서 QQQ 줄이 맨 위에 보인다(`partial-two.png`). 다른 팝업: 차트 팝업 390·1400 × (✕/뒤로가기/Esc) → 열면 hidden, 닫으면 `''`·path `/` 그대로. 차트 닫자마자 일괄 편집 → hidden, 그 뒤 닫기 → 풀림·스크롤 됨. 일괄 편집 ✕ 하고 같은 박자에 다시 열기 → hidden, 뒤로가기 → 풀림·`/stocks` 그대로. 사용자 목록 → 차단 확인(hidden) → 취소(목록 남음, hidden) → 다시 차단 → 뒤로가기(확인 창만, hidden) → Esc(목록 닫힘, `''`, 칸 0) → 스크롤 됨. 콘솔 오류 0(일부러 넣은 400 둘 제외). 넘침·테마 검사는 앞 검토의 것이 그대로다(그 뒤 D 의 바꿈에 모양 변경 없음) |
| 말 | 통과 (참고) | 새 화면 말 없음. README 줄의 "바깥 누르기" 빠짐 → 조건 3 |
| 성능 | 통과 | 첫 화면 JS gzip 111.74 kB(시작 111.19, 앞 D 검토 111.49). 늘어난 것은 A·C 를 합친 값이다. D 의 `scrollLock` 은 29줄 |
| 가짜 서버 | 해당 없음 | 새 상태 없음. `test_devtools.py` 는 전체 pytest 안에서 통과 |
| 문서 | 통과 (참고) | README 뒤로가기 줄이 더해졌다(조건 3). 옛 `previous = body.style.overflow` 설명은 scrollLock.ts 머리 주석에 이유와 함께 남았다 |

## 뒷정리

- 가짜 서버 8181: `kill $(cat Drev2/fake.pid)`(PID 14323) → `curl localhost:8181/api/health` 응답 없음, 꺼짐.
  응답 사진용 8182·8183 은 `snapshot.py` 가 스스로 띄우고 끈다. `pkill`·`killall` 은 쓰지 않았다.
- `frontend/node_modules` 는 주 checkout 의 것을 심볼릭 링크로 걸었다가 지웠다. 뮤테이션 12개는 `mutate.py` 가 바로 되돌렸다.
- 812eb5e 의 backend 는 `git archive` 로 `Drev2/base812/` 에 꺼내 썼다(저장소 밖).
- `git status` (worktree):
```
HEAD detached at 261ab1e
nothing to commit, working tree clean
```
