# 0.45.1 — 정교화 (키우기 5라운드, 규칙 v6)

**상태: 진행 중** — 2026-10-22 시작

- 작업 브랜치: `claude/new-session-fftcg1` — 0.45.0 PR(kyos9/Dashboard#3)이 합쳐져 `main` 끝(baa6048)에서 다시 시작
- 시작 커밋(비교 기준): `baa6048` (2026-10-22, "Merge pull request #3")
- 서버 버전: 0.44.0 (0.45.0 은 합쳤지만 주인이 아직 배포 전)
- 주인 입력: ① 숫자 칸 + ② 0.45 확인에서 나온 자잘한 것, "알아서 해줘"(`PROMPT.md`)
- 규칙: 이 폴더의 `RULES.md`(v6 복사본)

## 다른 브랜치 (시작 때 확인)

`git fetch --prune` 뒤 `main` 에 없는 커밋을 가진 원격 브랜치: **없음** (ecstatic-brahmagupta·sharp-lovelace·new-session 모두 0).

## 지금 상태 (잰 값)

| | 값 |
| --- | --- |
| 버전 | 0.45.0 |
| Alembic 머리 | 0015 |
| 백엔드 pytest | 1484 passed, 3 skipped |
| 프런트 vitest | 944 passed |
| lint 경고 | 22 |
| tsc(`npm run build`) | 통과 |
| 첫 화면 JS (gzip) | 111.71 kB |
| 대시보드 응답·쿼리(20종목) | 가운데 42.8 ms · 쿼리 12 |

기준 두 가지(저장소 밖): `scratchpad/r046/baseline/` — `openapi.json`, `snap/`(2026-10-22, 주인·친구 × 5 경로), 테스트 출력.

## 주인 할 일 (ROADMAP 0-1 에서 옮김)

- 0.45.0 배포(백업 → `git pull … up -d`) · 배포 뒤 PC 백업 처음 설정(DEPLOY 10-0) · 🔔 아침/오후·종목별 알림 실기기 확인
- 실제 AI 키 · 규제(3절)·시세 약관(4절) · 느린 요청 보기 — 이번 항목과 무관

## 계획

- [x] `plan-draft.md` — A 숫자 칸이 버린 글자를 말하기 · B 차트 두 번 탭·없는 종목 주소 · C 진단 요약·백업 꺼내기 문장 · D 알림 설정 셋
- [ ] 계획 검토 셋(동시에) → `plan.md`
- [ ] 주인 승인 ① — 주인이 "알아서"로 맡김. 막음·이견이 나오면만 묻는다

## 다음 할 일

계획 검토 셋의 의견서(`plan-dev.md`·`plan-review.md`·`plan-user.md`)를 받아 `plan.md` 를 쓴다.
