> 계획 전에 먼저 고친 것(PR #23 뒤의 `20db93f`·보안 `7afd3fd`)을 본 검토자(round-reviewer)의 판정문. 총괄이 손대지 않고 옮긴다.
> 이 검토는 자기 worktree 없이 공유 작업 폴더에서 돌았고, 도중에 총괄이 브랜치를 바꿨다(아래 "중요한 전제"). 다음 검토부터는 자기 worktree 로만 돈다.

판정: 조건부 합격

중요한 전제: 검토 도중 공유 작업 트리의 브랜치가 claude/mobile-modal-safe-area 에서 claude/design-3-phone-popups 로 바뀌었다. 내가 한 일이 아니다. 시작 때는 대상 브랜치였고, 끝 때는 다른 브랜치였다. 그래서 전체 pytest·vitest·화면 확인이 어느 시점의 코드였는지는 확정하지 못한다. 보정으로 7afd3fd 를 별도 worktree(저장소 밖)에 떼어 CORS·compose·env 관련 pytest 15개를 다시 돌려 통과를 확인했고, worktree 는 지웠다. 화면 캡처에는 새 머리줄(✕ 윗줄 오른쪽, 칩 아랫줄)이 보여서 최소한 20db93f 이후 코드였다. 조건부 합격이라 판정했지만, 총괄이 확정 짓기 전에 7afd3fd 로 vitest·전체 pytest 를 한 번 더 돌리면 좋다.

항목별 결과

1. 테스트
- 통과. 전체 backend pytest 는 1609 passed, 5 skipped 였다. frontend vitest 는 1065 passed (1065) 였다. `npm run build` 도 성공했다.
- docker-compose.yml·.env.example 의 일관성 검사 테스트는 깨지지 않았다. 7afd3fd worktree 의 15개 선별 테스트도 통과했다.
- backend/tests/test_cors_default.py 는 "Origin 을 보내도 CORS 응답 헤더가 없다"를 확인하고, 통과했다.

2. audit job YAML
- 통과. PyYAML 로 읽어 jobs 가 [backend, frontend, audit] 로 나오고 audit 의 키는 name, runs-on, continue-on-error, steps 였다.
- `continue-on-error: true` 는 job 수준에 있다. requirements-postgres.txt 가 있고 `frontend/package-lock` 도 있어 경로는 맞다.
- 참고용이라 실패해도 PR 을 막지 않는다. 의도와 맞다.

3. CORS
- 통과. backend/app/main.py:69-84 는 기본으로 끄고, `*` 는 걸러내며, 환경변수로만 켠다.
- Vite 프록시는 frontend/vite.config.ts:9 에 있고 README.md:466·508 은 5173 을 프록시로 쓴다고 적는다. 모순은 없다.
- DEPLOY.md·README 의 CORS 언급은 README.md:391 "프록시도 CORS도 필요 없습니다" 한 곳뿐이고, 낡지 않았다.
- 다만 새 환경변수 SIGNAL_DASHBOARD_CORS_ORIGINS 는 DEPLOY.md 에 없고 .env.example·docker-compose.yml 에만 있다. 참고 수준이다.

4. PUBLIC_URL 경고 (google_login.py:158-178)
- 통과. 프로세스당 한 번만 경고하고, 로그인은 막지 않는다. 로그인 쪽 테스트도 통과했다.

5. 폰 팝업 머리줄과 안전영역 (47px 시뮬레이션, 390×780, 가짜 서버, 주인 계정)
- 통과. 알림, 종목 한 번에 수정, 진단, 사용자, 화면 설정, AI 키, AI 분석, 매크로 차트의 가로 스크롤이 없었다(scrollWidth 가 clientWidth 와 같다).
- 제목은 모두 상태바 아래(y 약 74)이고 ✕ 는 윗줄 오른쪽(x 330)에 있다.
- 진단 팝업은 ✕ 를 윗줄에 두고 칩을 아랫줄로 보낸다. 매크로 차트도 칩이 아랫줄이다.
- 알림 창은 "종목별 알림"을 펼쳐 400px 스크롤해도 머리줄(제목·✕)이 같은 자리에 고정된다. 스크린샷으로 확인했다.
- 머리줄 안에 칩 말고 다른 요소가 있는 팝업은 찾지 못했다. UsersModal, DisplayModal, AiKeyModal, SignalThresholdsModal, IosInstallHint, AiSummaryModal, StockEditModal, ModalLoading 의 머리줄은 모두 제목+✕ 뿐이다. ChartModal 과 MacroChartModal 은 칩 줄 하나가 더 있고, DiagnosticsModal 도 칩 줄 하나가 더 있다.
- ConfirmDialog 는 ✕ 가 없는 머리줄이다. 규칙이 영향을 주지 않는다.
- ChartModal 은 이 데이터에서 자동으로 열리지 않아 직접 캡처하지 못했다. 매크로 차트와 구조가 같다. 코드로만 확인했다.

6. 조건부 사유 (발견한 문제)
- (a) 고쳐야 함 — 가운데 카드로 뜨는 확인창(ConfirmDialog, `.confirm-modal`)과 홈 화면 추가 안내(`.install-hint`)에도 위 안전영역 여백이 붙는다.
  - 근거: frontend/src/index.css:2278-2283 에서 이 둘을 `align-self:center` 카드로 두는데, 새 `.modal` 규칙(index.css:2929-2937)이 그대로 적용된다. 실측 padding-top 은 63px 이다.
  - 캡처(/tmp/claude-0/shots/confirm.png)에서 "모든 기기에서 나갈까요?" 카드 위에 제목이 안 보이는 빈 줄이 약 47px 생긴다.
  - 이 카드는 상태바 밑에 깔리지 않으므로 여백이 필요 없다. `.confirm-modal`·`.install-hint` 는 padding-top 을 16px 로 되돌리는 게 맞다.
  - 실기기에서 inset 이 0 이면 안 보이는 문제라 등급은 낮다. 노치 기기에서는 보인다.
- (b) 참고 — 좌우 안전영역은 `.modal` 에 padding 을 늘렸지만 `.stock-edit-foot`(index.css:4843-4850)은 `margin: 12px -16px -16px` 로 고정이라 가로 inset 이 0 이 아니면 어긋난다.
  - 이 foot 의 위쪽 선이 창 좌우 끝까지 닿지 않고 inset 만큼 짧아진다.
  - `.push-modal .modal-head` 는 calc 로 inset 을 같이 보정해 맞다(index.css:2967-2975).
  - 실제로는 폭 ≤640px 에서 좌우 inset 이 0 이 아닌 경우가 거의 없어(가로 모드는 보통 640 초과) 미관상 문제다. 나란히 맞추려면 foot 도 같은 calc 로 바꾸면 된다.
  - 이 항목은 내가 볼 수 없었다. 시뮬레이션은 상단만 했다.
- (c) 참고 — `.modal-head .icon-btn`(index.css:2182 이하, 전부터 있던 규칙)은 머리줄 안의 모든 `.icon-btn` 에 걸린다. 지금은 머리줄 안에 닫기 말고 다른 icon-btn 이 없다.

7. 작업 트리 상태(`git status --short` 의 마지막 출력)
`?? docs/design/safearea.mjs`
- 이 파일은 내가 만든 게 아니다. 총괄 또는 다른 작업이 만든 것으로 보이며, 현재 브랜치 claude/design-3-phone-popups 아래에 있다.
- 나는 저장소 파일을 고치지 않았다. 내 임시 파일은 모두 /tmp/claude-0 아래에 있다(venv /tmp/claude-0/v, 스크립트와 캡처 /tmp/claude-0/pw*.js·shots, 가짜 서버 데이터 /tmp/claude-0/srv). 가짜 서버(8731)는 pid 로 끝냈다.
- `npm ci` 와 `npm run build` 는 frontend/node_modules 와 frontend/dist 를 갱신했지만, 둘 다 git 이 무시하는 경로다.
