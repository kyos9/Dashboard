# 0.46.0 데이터 안전 — 상태

**상태: 진행 중**

## 시작 때 잰 것 (2026-10-30, 시작 커밋 65001de = main)
- 버전 0.45.4 · Alembic 머리 0015 · 서버 0.44.0(0.45.0~0.45.4 배포 전)
- (재는 중 — pytest · vitest · lint · tsc · 대시보드 · JS 크기, 기준 두 가지는 스크래치 `r050/baseline/`)
- 다른 브랜치: ecstatic-brahmagupta-gvr506(10-13)·sharp-lovelace-2gm6pf(10-15) — main 에 다 들어감.
  dependabot 열넷(10-29, 의존성 올리기 PR 후보 — 남의 브랜치, 읽기만). 겹칠 수 있는 것: `requirements.txt`·`package-lock.json`·
  `.github/workflows/*`(actions 판). 이 라운드는 workflows 를 고친다 — 합칠 때 판 줄만 부딪힐 수 있다.

## 주인 결정
- (계획 승인 전)

## 항목
- [ ] A 백업 — 복구 시험(7) · pg_dump 시간 한도(8) · 세는 법(12) · PC 사본(13)
- [ ] B 헬스체크가 DB 를 본다(9)
- [ ] C 시세 받기 실패를 관리자가 안다(10)
- [ ] D 승인 대기·거절·차단 계정 지우기(11)

## 다음 할 일
계획 검토 셋(plan-dev · plan-review · plan-user)을 받아 plan.md → 주인 승인 ①.
