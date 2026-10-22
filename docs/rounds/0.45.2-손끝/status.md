# 0.45.2 — 손끝 (키우기 6라운드, 규칙 v6)

**상태: 진행 중** — 2026-10-22

- 작업 브랜치: `claude/new-session-fftcg1` — 0.45.1 PR(kyos9/Dashboard#4)이 합쳐져 `main` 끝(d5bc80d)에서 다시 시작
- 시작 커밋(비교 기준): `d5bc80d` (2026-10-22, "Merge pull request #4")
- 서버 버전: 0.44.0 (0.45.0·0.45.1 은 합쳤지만 주인이 아직 배포 전)
- 주인 입력: "서버 올리기 전에 또 할 거 미리 완성해줘"(`PROMPT.md`) — 계획 승인도 총괄에게(총괄 해석)
- 규칙: 이 폴더의 `RULES.md`(v6 복사본)

## 다른 브랜치 (시작 때 확인)

`main` 에 없는 커밋을 가진 원격 브랜치: **없음** (ecstatic-brahmagupta·sharp-lovelace·new-session 모두 0).

## 지금 상태 (잰 값)

| | 값 |
| --- | --- |
| 버전 | 0.45.1 |
| Alembic 머리 | 0015 |
| 백엔드 pytest | 1487 passed, 3 skipped |
| 프런트 vitest | 972 passed |
| lint 경고 | 22 |
| tsc(`npm run build`) | 통과 |
| 첫 화면 JS (gzip) | 112.42 kB |
| 대시보드 응답·쿼리(20종목) | 가운데 40.1 ms · 쿼리 12 |

기준 두 가지(저장소 밖): `scratchpad/r047/baseline/` — `openapi.json`, `snap/`, 테스트 출력.

## 주인 할 일 (ROADMAP 0-1 에서 옮김)

- 0.45.0·0.45.1 배포(백업 → `git pull … up -d`) · PC 백업 처음 설정(DEPLOY 10-0) · 🔔 실기기 · 아이폰 "-0.2"
- 실제 AI 키 · 규제(3절)·시세 약관(4절) · 느린 요청 보기 — 이번 항목과 무관

## 계획

- [x] `plan-draft.md` — A 숫자 칸이 말한 뒤 · B 진단·백업이 눈에 띄게 · C 차트를 손가락으로
- [ ] 계획 검토 셋(동시에) → `plan.md`
- [ ] 주인 승인 ① — 주인이 맡김. 막음·이견·규제 영향이 남으면 묻는다

## 다음 할 일

계획 검토 셋의 의견서를 받아 `plan.md` 를 쓴다.
