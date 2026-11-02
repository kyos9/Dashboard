# 0.46.0 데이터 안전 — 다시 보기 검토 (ABCD-review.md 의 조건 셋 + 1b42df3 문구)

# 판정: 조건부 합격

대상: `claude/new-session-fftcg1` HEAD **21fa2fc**. worktree 를 detached 21fa2fc 로 바꿔서 봤다. 앞 판정(d74d5c5) 뒤 커밋 둘: 1b42df3(사용자 확인 문구), 21fa2fc(검토 조건).
환경: fastapi 0.162.0·SQLAlchemy 2.1.6(requirements 와 같다. 스크래치 venv `r050/rv/venv`). 로컬 Postgres 는 띄우지 못했다 → **Postgres 갈래는 CI 에서 확인**(21fa2fc 의 CI 기록은 이 환경에서 보지 못했다).

## 조건 (합격으로 바꾸려면) — 하나, 작음

1. **말: 진단 화면에 "벌"이 새로 들어왔다.** 1b42df3 이 진단의 PC 사본 줄을 `밖에 꺼낸 것: 마지막 … (관리자 PC — 최근 4벌까지 남김)`로 바꿨다
   (`frontend/src/components/DiagnosticsModal.tsx:234`, 시험 `DiagnosticsModal.test.tsx:498`). 그런데 용어집은 진단의 백업 개수에 "벌"을 쓰지 않는다고 정해 두었다.
   - `docs/design/glossary.md:34`: "벌"은 대신 쓰지 않는 말이다. "*(0.45.2)* 진단의 백업 개수. '벌'이 낯설었다".
   - `glossary.md:45`: 0.46.0 진단 백업 줄에서도 "벌"은 대신 쓰지 않는 말이다.
   - 같은 파일의 주석 `DiagnosticsModal.tsx:178` 도 "화면 말은 0.45.2 부터 '벌' 대신 '개'"라고 적혀 있다.

   같은 커밋에서 바로 윗줄 매일 백업은 "최근 7개까지 남김"으로 썼다. 그래서 한 칸 안에 "7개"와 "4벌"이 섞인다.
   용어집도 반만 고쳐졌다. `glossary.md:45` 의 "하나로" 말은 아직 옛 꼴 "매일 백업 N개 보관"이고, `:24` 는 "밖에 꺼낸 것: 마지막 …(관리자 PC)"로 남았다.
   → 화면 "최근 4개까지 남김"으로 바꾸고 시험 한 줄과 용어집 `:24`·`:45` 를 지금 화면 말에 맞춘다. 사용자 확인 확인창(`UsersModal.tsx:256` "4벌")과 방침의 "4벌"은 0.46.0 전부터 있었다. 진단이 아니어서 조건에 넣지 않았다(참고).

참고(조건 아님)
- 방침 `Policy.tsx:165` 를 "화면 위 메뉴(폰은 ⋯)의 **탈퇴**"로 바꿨다. 폰은 맞다(⋯ 메뉴 안, `AppHeader.phone.test.tsx:103`). PC 는 메뉴가 아니라 머리줄에 바로 있는 단추다(`AppHeader.tsx:350-354`).
  "화면 위"라서 찾을 수는 있다. 다만 더 정확한 말은 "화면 위(폰은 ⋯ 메뉴)의 탈퇴"다.
- 시행일: `POLICY_EFFECTIVE='2026-10-31'`(`lib/policy.ts:11`)는 그대로이고 방침 글은 바뀌었다. 10-31 판은 0.46.0 에서 처음 생겼고 아직 배포 전이다(서버 0.45.4). 그래서 공개된 방침과 어긋나지는 않는다.
  바뀐 것은 탈퇴 단추의 위치 안내뿐이고 권리·보관 내용은 그대로다. 다만 lib/policy.ts:10 의 "방침을 고치면 이 날짜도 바꾼다"를 글자 그대로 따르면 배포 날짜로 올리는 편이 맞다.
- 진단 경고 "PC 의 Dashboard 폴더"는 PC 에 저장소를 `Dashboard` 이름으로 받았다고 가정한 말이다(DEPLOY 10-0 은 "저장소 맨 위"). 보통은 맞다.
- 앞 판정의 참고 중 DEPLOY "서버 안 7벌"(`DEPLOY.md:489·514·516`)은 그대로다. ROADMAP 11-9 의 "판정문 없음" 문장은 고쳐졌다.

---

## 앞 판정의 조건 셋

| 조건 | 판정 | 증거 |
| --- | --- | --- |
| 1 알림 창이 모르는 종류에 넘어지지 않음 | **통과** | `lib/pushText.ts:16-18` `kindText(kind)` → `KIND_TEXT[kind] ?? { label: kind, hint: '서버가 새로 더한 알림' }`. `PushModal.tsx:221` 이 그것을 쓴다. 화면 코드에 `KIND_TEXT[` 를 바로 쓰는 다른 곳은 없다(`grep -rn "KIND_TEXT\|kindText" frontend/src` → pushText 정의·PushModal 두 줄뿐). 시험 `PushModal.test.tsx:155-164`. **직접 뮤테이션 2개 모두 잡힘**: ① `kindText` 의 `?? 기본 풀이` 빼기 → `1 failed \| 28 passed`, `TypeError: Cannot read properties of undefined (reading 'label')` ② PushModal 을 `KIND_TEXT[kind]` 로 되돌리기 → 같은 시험 실패. 둘 다 `git checkout --` 으로 되돌렸다. plan.md:75 의 "반영"이 이제 참이다 |
| 2 SIGNAL_DASHBOARD_REFRESH_ALERT 끄는 말 | **통과** | `services/alerts.py:153` `("off","0","false","no")`. 시험 `test_refresh_status.py:180-190`(끄는 7값·켜진 채 6값, "offf" 포함). **별칭을 하나씩 지움**: `"0"` 지움 → `FAILED …[0]` · `"false"` 지움 → `FAILED …[false]`·`[False]` · `"no"` 지움 → `FAILED …[no]` · 더해서 `.strip().lower()` 빼기 → `[OFF]`·`[ off ]`·`[False]` 3 실패. 넷 다 잡혔고 매번 되돌렸다 |
| 3 범위 밖 사용자 번호 | **통과** | `routers/admin.py:74-84` `_user_or_error`: `1 <= id <= 2**31-1` 이 아니면 400 `{"hint":"사용자 번호가 범위를 벗어났습니다."}`, 지우기(`:126`)·상태 바꾸기(`:98`)가 같이 쓴다. 관리자 검사는 라우터 의존성이 먼저 해서 지인 403·손님 401 이 그대로다. 시험 `test_signup_approval.py:322-328`(0·-1·2**31·10**30 × DELETE·PUT). **가짜 서버 8185**(`rv2/ids_check.out`): 0·-1·2147483648·10**30·99999999999999999999999 → DELETE·PUT 모두 **400** · 2**31-1(범위 끝, 없음) → 404·404 · `abc` → 422 · 나쁜 본문 → 422 · 관리자 DELETE/PUT → **403** · 쓰는 중(friend) DELETE → **409** "먼저 차단한 뒤 지우세요" · 지인이 DELETE → 403 · 손님 → 401 · new 차단 PUT → 200 → DELETE **204** · pending DELETE **204** → 다시 404. 서버 로그 `Traceback\|OverflowError` 0. **뮤테이션 3개 모두 잡힘**: 범위 검사 `if False` → 4 실패 · 상한 `2**31` → `[2147483648]` 실패 · PUT 만 `db.get` 으로 되돌림 → 5 실패. **API 모양**: `apidiff baseline/openapi.json rv2/openapi.json` → `빠짐 0 · 타입 바뀜 0 · 더해짐 3`(앞 판정과 같은 셋). d74d5c5 때 뜬 것(`rv/now`)과 견주면 `빠짐 0 · 바뀜 0 · 더해짐 0`. 범위는 handler 안에서 보므로 스키마는 바뀌지 않았다 |

## §3 표 (이번 차이 d74d5c5..21fa2fc 기준. 나머지는 앞 판정을 이어받는다)

| 검사 | 판정 | 증거 |
| --- | --- | --- |
| 완료 조건 | **통과** | 앞 판정 그대로. 이번 커밋은 A~D 의 동작을 바꾸지 않는다(문구·방어선·400 갈래) |
| 계획 때 걱정 | **통과** | 앞 판정에서 빠졌던 plan.md:75 `KIND_TEXT[kind] ?? 기본 풀이`가 반영됐다(조건 1). 막음 0 |
| 회귀 | **통과** | pytest(SQLite) **1608 통과 · 5 건너뜀**(`r050/pytest-r2.txt` 끝줄 `1608 passed, 5 skipped … in 134.12s`. 앞 판정 1591 → +17 = 끄는 말 13 + 범위 4). vitest **1065 passed (63 파일)**(앞 1064 → +1). `npx tsc -b` 종료 0. `npx oxlint` warning **22**(앞과 같다). Postgres 갈래: **CI 에서 확인**(로컬 PG 없음). 응답 사진은 다시 뜨지 않았다. 바뀐 백엔드는 admin 두 경로의 범위 밖 갈래뿐이고 사진의 5경로에 들지 않는다 |
| 격리 | **통과** | 새 경로 없음. 범위 검사가 의존성 뒤에 있어 지인 DELETE 0 → 403, 손님 → 401(가짜 서버) |
| 마이그레이션 | **해당 없음** | `git diff d74d5c5..21fa2fc -- backend/migrations backend/app/models.py` 비어 있음 |
| 호환 | **통과** | API 빠짐 0(위). 새 400 은 옛 화면에 정상 id 로는 오지 않는다. 화면은 400 의 `detail.hint` 를 그대로 보여 주는 공용 오류 길을 쓴다. 옛 화면·새 서버 쪽은 이번에 `kindText` 로 오히려 좋아졌다 |
| 입력 한도 | **통과** | 조건 3 위. 0·음수·2**31·10**30 → 400, 글자 → 422 |
| 뮤테이션 | **통과** | 직접 **9줄**, 모두 잡힘(화면 2 · 끄는 말 4 · 범위 3). 바꾼 파일은 매번 `git checkout -- <파일>` 으로 되돌렸고 그 뒤 `git status --short` 는 빈 줄이었다. 앞 판정의 "동작이 같은" 살아남음 셋은 그대로다(조건 아님) |
| 비밀 | **해당 없음** | 새 오류 글은 고정 문자열 `"사용자 번호가 범위를 벗어났습니다."`/`"user id out of range"` 뿐이고 입력값을 되돌려 주지 않는다 |
| 규제 | **통과** | `git diff d74d5c5..21fa2fc -- frontend/src backend/app README.md docs/design \| grep '^+' \| grep -cE "추천\|사세요\|팔라\|팔아\|저평가\|예측\|수익률\|매수하세요\|매도하세요"` → **0** |
| 데이터 경계 | **해당 없음** | 새 표·공용 값 없음 |
| 외부 호출 | **해당 없음** | 새 호출 없음 |
| 화면 | **통과** | `npm run build`(index gzip 115.24 kB) → 가짜 서버 8185 `--demo-backup-warning`. `rv2/look.js`: 1400·390·360 × light·dark 여섯 판 `PROBLEMS []`(콘솔 오류 0 · 가로 넘침 0 · 모달 넘침 0 · Tab 으로 "지우기"→Enter→확인 창, 초점 안, Esc 는 확인 창만). 지인·승인 대기 새는 말 0. `rv2/look2.js`(1400·390): 방침·사용자 목록 안내·차단 확인 창 새 문구가 화면에 그대로 나오고 오류 0. 스크린샷 `r050/rv2/shots/` |
| 말 | **실패(작음, 조건 1)** | 화면에 나온 실제 문구: 시세 `일본: 막힘 — 마지막으로 받은 때 10월 31일 05:31 · 11월 2일 05:31에 받으려 했으나 2종목 중 2개 실패 (시세 출처 Stooq·Yahoo)`. 이 꼴은 용어집 `:43`·README `:137`·시험 `DiagnosticsModal.test.tsx:346`(`$` 로 끝까지 맞춤)과 같다. 매일 백업 `매일 백업 지금 1개 · 최근 7개까지 남김`은 용어집 `:34`·README·ROADMAP·시험 `:374` 와 같다. 허용목록 말("관리자가 서버 설정에 미리 넣어 둔 이메일이면 승인 없이 바로 들어옵니다")은 `UsersModal.test.tsx:235` 와 같다. 옛 말 검색(`보관(최대`·`PC 에서 server-backup-pull`·`허용목록에 있는 이메일이면 바로`·`실패.*— 마지막으로`·`DEST 를 OneDrive`) → 화면 코드에는 옛 서버 갈래 `DiagnosticsModal.tsx:219`(일부러 둔 것)와 그 시험 `:407` 만 남았다. **어긋남**: 진단 `(관리자 PC — 최근 4벌까지 남김)`(`DiagnosticsModal.tsx:234`)이 용어집 `:34`·`:45` 의 "벌 쓰지 않음"을 어긴다. 용어집 `:45`·`:24` 의 "하나로" 말은 옛 꼴로 남았다 |
| 성능 | **통과** | 백엔드 대시보드 경로는 바뀌지 않았다. 첫 화면 JS gzip 115.23 → **115.24 kB**(`kindText` 함수 하나) |
| 가짜 서버 | **통과** | `test_devtools.py` 는 전체 pytest 안에서 통과. 데모 일본 막힘·OneDrive 경고에 새 문구가 나온다 |
| 문서 | **통과(조건 1 의 용어집 제외)** | README `:137-140` 새 시세·백업 문구. ROADMAP 11-9·0-1 은 판정문이 생긴 것과 새 문구를 반영했다. status.md 판정 표. 방침 5절 문구(위 참고 둘: PC 탈퇴 위치, 시행일) |

## git status (끝)

검토는 detached 21fa2fc 에서 했다. 끝난 뒤 worktree 를 원래 가지(worktree-agent-a232659034030a2c2)로 되돌렸다. 뮤테이션 9줄은 모두 `git checkout -- <파일>` 으로 되돌렸다.
가짜 서버(PID 16287 은 데이터 폴더 문제로 바로 끝났다. 그 뒤 띄운 것들, 마지막 PID 16880)는 PID 파일로만 껐다(`kill $(cat r050/rv2/fake.pid)`).
frontend/node_modules·dist·backend `__pycache__`·`logs/` 는 .gitignore 대상이다.

```
$ git status
On branch worktree-agent-a232659034030a2c2
nothing to commit, working tree clean
```
