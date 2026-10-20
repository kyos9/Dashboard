# 조건부 합격

B "종합 신호등 정리" 세 번째 검토. 머리 `d00e114` (origin/claude/new-session-fftcg1). 검토자 worktree `agent-a689374b7668bad2f`.

두 번째 검토의 조건 둘은 풀렸다. M3·M4를 다시 넣으니 둘 다 잡힌다. 새 폰 테스트는 실제로 카드 배치로 그린다(N1으로 확인). 다만 §3 기준은 "살아남은 것 0"인데, 직접 넣은 3줄 가운데 N3 하나가 살아남았다. 같은 구멍이 자리만 옮긴 셈이다.

## 조건 (합치기 전에)

1. **풀이 줄의 비중 말을 지키는 테스트가 없다 (N3)** — 고쳐야 함
   - `Dashboard.tsx:1024`의 `(비중 초과·비중 미달)를 말합니다.`를 `(과중·미달)를 말합니다.`로 되돌렸다. `src/pages src/components src/lib`의 818개가 모두 통과한다.
   - 새 폰 테스트(`Dashboard.test.tsx:348-365`)는 `.signal-key`에서 관망 문장만 본다(`:363`).
   - 그래서 사용자 판정과 1차 조건 ②에서 문제가 된 "과중"이 시그널 보기마다 나오는 풀이 줄로 다시 들어와도 알 수 없다.
   - 고칠 것: 같은 테스트에 한 줄을 더한다. `expect(key).toHaveTextContent('비중 초과·비중 미달')`, `expect(key.textContent).not.toMatch(/과중/)`.

## 앞 조건 — 풀렸는가

| 조건 (B-review2) | 판정 | 증거 |
| --- | --- | --- |
| 1. M3 범례를 "과중·미달"로 되돌려도 통과 | 통과 | 테스트는 `Dashboard.portfolio.test.tsx:316-322`이다. 범례에 `비중조절(비중 초과·미달)`이 있고 "과중"이 없는지 본다. M3을 다시 넣으니 `Tests 1 failed / 817 passed (818)` |
| 2. M4 `hidden={narrow}`로 폰에서만 숨겨도 통과 | 통과 | 테스트는 `Dashboard.test.tsx:348-365`이다. `matchMedia` 스텁이 `useNarrow`(`lib/narrow.ts:13`)를 참으로 만들고, `innerWidth` 360이 첫 보기를 카드로 만든다(`Dashboard.tsx:415`). M4를 다시 넣으니 잡혔다(14 failed). 아래 참고 1에 따르면 진짜 실패는 1개다 |
| 2'. 새 테스트가 정말 카드로 그리는가 | 통과 | N1: 첫 보기를 늘 표로 바꿨다(`window.innerWidth < 1100` → `false`). 이 상태에서 `-t '폰에서도'`로 그 테스트만 돌리니 `1 failed`였다. 풀이 줄은 목록 밖(`Dashboard.tsx:1022`)에 있어 표에서도 보인다. 그러니 실패의 원인은 `:357`의 카드 확인(`.signal-card`, `Dashboard.tsx:1495`)뿐이다. 표 쪽에는 class에 `signal-card`가 들어간 요소가 없다(grep: `Dashboard.tsx:1495` 하나뿐) |
| B-review 조건 셋 | 통과 (2차에서 확인, 이번에 바뀐 제품 코드 없음) | `git diff --stat bb58fa0 HEAD -- frontend/src`에서 바뀐 것은 테스트 파일 둘뿐이다(+27) |

## §3 — B 범위로 다시

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 완료 조건 (plan "B." + 주인 결정 ①) | 통과 | 제품 코드는 2차 때 그대로다. 화면에서 다시 보니 요약은 `신호 요약 15종목 4 매수 8 관망 3 매도 3 비중조절 비중 초과 2 비중 미달 1`이다. 관망 8과 "—" 8(role=img 8/8)이 같고, 친구는 2/2다 |
| 회귀 — 프런트 전체 | 통과 | `npx vitest run --maxWorkers=2` → `Test Files 58 passed (58) / Tests 894 passed (894)`. 2차 때는 892개였고 새 테스트 2개가 더해졌다. 출력: `r044/revB3-vitest.txt` |
| lint / 빌드 | 통과 | `npm run lint` 종료 0, 경고 22개(시작 때와 같음). `npm run build` 종료 0, `index-*.js 358.92 kB │ gzip: 111.20 kB` |
| 호환 — API 모양 | 통과 | B 커밋 넷(`b5f3e11 ef7f2bb bb58fa0 d00e114`)은 `backend`·`src/api`를 건드리지 않는다(`git show --stat` grep 0건). `tools/apidiff.py baseline/openapi.json revB3-openapi.json` → `빠짐 0 · 타입 바뀜 0 · 더해짐 3`. 더해진 셋(`/api/admin/records`, `value_record`, `ValueRecordOut`)은 A 것이다. 서버 사유 글 "매도 검토·매수 검토"는 그대로 두고, 화면 쪽에서만 바꿔 읽는다(`weightSignal.ts:11`, `portfolio.ts:51-52`) |
| 뮤테이션 — 실행자 결과 | 통과 | `B-mutation.md`: 앞 13개와 M3·M4가 잡혔다고 적혀 있다. M3·M4는 직접 다시 확인했다(위) |
| 뮤테이션 — 직접 3줄 이상 | **실패 (N3 살아남음)** | `revB3-mut/mut.py`는 바꾸고 돌린 뒤 되돌리고, 내용이 같은지 assert한다. 명령은 `npx vitest run --maxWorkers=2 src/pages src/components src/lib`. 결과는 아래 표 |
| 화면 (8184, 빌드 뒤) | 통과 | `revB3-ui/ui.js`로 PC 1400 표·카드, 360 owner·friend, 각각 라이트·다크(8가지)와 new·pending을 봤다. 범례는 모두 `비중조절(비중 초과·미달)`이다. 홈과 시그널 보기에서 "과중·매도 검토·매수 검토·종합 신호등"은 0건이다. 풀이 줄은 360에서 left 14 / right 346에 들어간다. 대비는 라이트 4.61, 다크 5.55다. 가로 넘침 0, 콘솔 오류 0이다. 결과: `revB3-ui/result.json`, 그림은 `revB3-ui/*.png` |
| 말 | 통과 (조건 1 빼고) | 화면 글은 용어집과 맞는다. 코드 주석에는 "과중"이 남아 있다(`PortfolioView.tsx:101,386`, `weightSignal.ts:4`). 화면에 나오지 않으므로 참고만 |
| 문서 | 통과 | `ROADMAP.md:2040` "0.43 까지"는 맞다. 용어집 `glossary.md:39`에 "시그널 보기 아래 풀이 한 줄"이 더해졌다. `B-mutation.md`에는 M3·M4 줄이 더해졌다 |

### 직접 뮤테이션 (`revB3-mut/out.md`)

| 뮤테이션 | 결과 |
| --- | --- |
| M3 홈 범례 → "과중·미달" (재) | 잡힘 — 1 failed / 817 passed |
| M4 `hidden={narrow}` (재) | 잡힘 — 14 failed / 804 passed (참고 1) |
| N1 첫 보기를 늘 표로, 새 폰 테스트만 | 잡힘 — 1 failed / 50 skipped |
| N2 `hidden={view === 'card'}` | 잡힘 — 14 failed |
| N3 풀이 줄 비중 말 → "(과중·미달)" | **살아남음 — 818 passed** |
| N4 `hidden={view !== 'table'}` | 잡힘 — 14 failed |

## 참고

1. **새 폰 테스트가 실패하면 matchMedia 스텁이 다음 테스트로 샌다.**
   - `vi.unstubAllGlobals()`가 테스트 본문 끝(`Dashboard.test.tsx:364`)에 있다. 그래서 앞의 expect가 실패하면 그 줄까지 가지 못한다.
   - 실제로 M4 하나에 같은 파일의 13개가 더 깨진다. "카드 보기에도 AI 분석", "종목 순서" 6개, "보던 표가 입력칸으로" 등이다(`revB3-mut/m4-detail.txt`).
   - 잡기는 잡지만, 진짜 원인이 14개 실패 속에 묻힌다.
   - 이미 있는 `test/phone.ts`의 `pretendPhone()`/`forgetPhone()`을 `afterEach`와 함께 쓰거나 `try/finally`로 감싸면 된다.
   - 그 스텁은 모든 질의에 `matches: true`를 돌려준다. 그래서 줄인 움직임·다크·standalone도 함께 참이 된다. `pretendPhone`은 `NARROW_QUERY`만 참으로 한다. 조건 1을 고칠 때 같이 하면 좋다.
2. `vite.config.ts:18`이 `css: false`라서, CSS 미디어 질의로 숨기는 경우(`@media (max-width:720px){.signal-key{display:none}}`)는 어떤 단위 테스트도 잡지 못한다. 구조상 한계다. 지금은 화면 검사(360에서 보임)가 이것을 지킨다.
3. 2차 참고 5("—"가 이음표로도 쓰임)는 그대로다. B 범위의 막음은 아니다.

## 실행 기록

- 가짜 서버: 포트 8184, 데이터 `r044/revB3-data`(`--reset`), PID `r044/revB3-fs.pid`로 껐다(끈 뒤 curl `000`).
- 뮤테이션 도중 저장소 파일은 스크립트가 되돌렸고, 되돌린 내용이 같은지 assert했다.

## worktree `git status`

```
HEAD detached at origin/claude/new-session-fftcg1
nothing to commit, working tree clean
```
