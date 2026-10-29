# 0.45.4 계획 검토 — 개발자 입장

읽은 것: `plan-draft.md`, `RULES.md`, 관련 코드와 시험(fe14358). 해 본 것: 스크래치 venv 두 벌(파이썬 3.13, 3.14)에 fastapi 0.120.4와 starlette 0.49.3을 깔고 worktree에서 전체 pytest를 돌렸다. 두 벌 다 **1492 통과 · 3 건너뜀**으로 지금과 같았다. `app.openapi()` 출력도 바이트까지 같았다. 본 작업 트리는 건드리지 않았다.

## A. 방침 맞추기 + 지인 중립 틀
**찬성**: 바뀌는 것은 지시문 글뿐이라 작다. 열린 모드와 비밀번호 모드의 1번 사용자는 `is_owner=True`다(`services/users.py:143`). 그래서 "주인이면 지금 틀"로 가르면 PC 동작이 그대로다.

**걱정**
- **고쳐야 함** — 화면 글에 주인 전략이 남는다. `AiPanel.tsx:50`의 종목 분석 소개가 "…**알파 버킷 편입 판단**을 돕는 리포트"이고, 이 글은 지인에게도 보인다. 초안은 "따로 고칠 것이 없다"고 했다. `ChartModal.test.tsx:490`은 **친구 계정**에서 이 문구를 기대한다(`:431`도 같은 문구다). 소개 글을 `isAdmin`에 따라 둘로 나눠야 한다.
- **참고** — 두 기능이 보내는 것이 서로 다르다. 종목 분석은 `actual·target·held`만 보내고 수익률은 보내지 않는다(`ai_portfolio.py:333-336`). 수익률은 진단만 보낸다(`:171`, `:217`). 방침도, 방침 시험이 보는 열쇠도 기능마다 따로 적어야 한다.
- **참고** — grep 시험은 **system 글에만** 걸어야 한다. prompt 글에는 사용자가 붙인 분류 "알파"가 그대로 들어간다(`CATEGORY_SUGGESTIONS`, `stockEdit.ts:46`). 지금 글에는 "동일 비중"과 "동일비중"이 둘 다 있으므로 `동일 ?비중`으로 찾는다.
- **참고** — `research_job(db, user_id, …)`은 지금 User 행을 보지 않는다(`:411`). `db.get(User, …)`을 하나 더한다. 주인 틀 시험(`test_ai_owner.py:206-215`, `:267`)은 그대로 두고, 중립 틀 시험을 새로 더한다.

**제안**: `RESEARCH_PROMPTS = {"owner": …, "user": …}`로 두 틀을 나란히 둔다. 소개 글은 `research`와 `researchUser` 두 키로 둔다. 캐시된 옛 화면은 새로 고칠 때까지 옛 소개 글을 보인다. 서버가 보내는 지시문은 바로 바뀌므로 해는 없다.

## B. 웹 보안 기본값
**찬성**: 바깥 스크립트·글꼴·이미지가 없다. 글꼴은 `index.css:26`의 자체 woff2다. 구글 로그인은 폼이 아니라 `location.assign`으로 넘어간다(`AuthGate.tsx:127`). 그래서 `form-action 'self'`에 걸리지 않는다.
- 가짜 로그인 페이지에는 인라인 `<style>`이 있지만 이것은 unsafe-inline으로 통과한다. 그 폼은 자기 주소로 GET을 보내고, 302로 다시 자기 주소의 콜백으로 간다(`fake_server.py:531-573`). 위반이 없다.
- 서비스 워커는 같은 출처만 만진다. Vite dev 화면은 Vite가 내주므로 백엔드 CSP가 닿지 않는다.
- openapi URL을 부르는 곳은 저장소 안에 없다. 기준선은 `app.openapi()` 호출이고 URL을 쓰지 않는다. openapi 경로는 스키마에 들지 않으므로 "빼고 비교"할 것도 없다.
- 0.118부터 yield 의존성이 스트림이 끝난 뒤 닫힌다. 그래도 AI 스트림은 `_prepare`가 DB를 먼저 닫으므로(`ai_analysis.py:667`) 연결을 붙잡지 않는다. 실험으로 순서를 확인했다.

**걱정**
- **고쳐야 함** — fastapi만 올리면 starlette가 그대로다. 0.120.4를 깔아도 starlette는 **0.41.3에 남는다**. 0.120.1~0.120.4의 요구 범위는 `starlette>=0.40,<0.50`이고, **0.120.0은 `<0.49`라 0.49.1을 받을 수조차 없다**. `starlette==0.49.3`을 requirements에 따로 고정해야 완료 조건이 선다.
- **고쳐야 함** — 해시 재는 법. git에 `.gitattributes`가 없다. 윈도 PC가 CRLF로 받아 빌드하면 dist 안의 스크립트도 CRLF다. 브라우저는 줄바꿈을 LF로 바꾼 **뒤** 해시를 잰다. 그래서 원본 바이트를 그대로 재면 PC에서만 테마 스크립트가 막힌다. `\r\n`·`\r`를 `\n`으로 바꾼 뒤 잰다. CRLF 시험도 하나 둔다. 또 `update.bat`은 서버가 켜져 있는 동안 빌드한다(`update.bat:50`). 켤 때 한 번만 재지 말고, 파일의 mtime이 바뀌면 다시 잰다.
- **고쳐야 함** — 완료 조건 "`/docs`·`/openapi.json`이 404"는 지킬 수 없다. dist가 있으면 SPA 폴백이 두 주소에 index.html을 200으로 준다(`web.py:69-89`). 조건을 "스키마 JSON이 나오지 않는다"로 바꾼다.
- **고쳐야 함** — 순서 목록의 한도를 "이미 있는 종목 수 한도"로 잡으면 주인이 깨진다. 그 값은 `MAX_STOCKS_PER_USER = 30`인데 **주인은 세지 않는다**(`stocks.py:36-39`, `:160`). 30을 쓰면 종목이 30개 넘는 주인의 순서 저장이 422가 된다. 500으로 둔다.
- **고쳐야 함** — "고칠 때만 한도가 걸린다"는 실제 동작과 다르다. 화면은 다른 칸만 고쳐도 `name`·`category`를 **늘 다시 보낸다**(`StockEditModal.tsx:139-140`, `Dashboard.tsx:389`). 그래서 옛 긴 값이 있으면 목표만 바꿔도 422가 난다. 한도를 넉넉히 잡는다(name 200, category 60). 아니면 주인이 서버에서 최대 길이를 먼저 잰다.
- **고쳐야 함** — logout-all 세 가지.
  - ① PC 넓은 화면의 일반 사용자에게는 ⋯ 메뉴가 없다. 관리자 항목이 있을 때만 생긴다(`AppHeader.tsx:313`). "나가기"는 헤더 버튼이다(`:299`). PC에서 둘 자리를 정한다.
  - ② 승인 대기인 사람에게는 "나가기"가 보인다(`:96`). 그런데 문지기가 401을 내므로 logout-all은 숨긴다.
  - ③ **다른 기기의 알림 구독이 남는다.** 잃어버린 폰에 계속 알림이 간다. 서버가 그 사람의 `PushSubscription`을 같이 지우거나, 확인 문구에 그렇다고 적는다. 그 기기의 AI 키는 지울 수 없으니 문구에 밝힌다. 구글 모드가 아니면 400을 낸다. `withdraw`(`auth.py:373`)와 같게 한다.
- **참고** — 미들웨어는 순수 ASGI로 짠다(`SlowRequestLog`처럼). SSE 스트림과 "읽으며 세기"를 다루려면 그래야 한다. 맨 바깥에 두어 401과 413에도 헤더가 붙게 한다. 500 응답은 ServerErrorMiddleware가 바깥이라 헤더가 붙지 않으니 시험에서 뺀다.
- **참고** — 1MB 한도는 걸릴 곳이 없다. 업로드 엔드포인트가 없다. 백업·로그 내려받기는 GET이고, AI 키는 헤더(`X-AI-Key`)로 온다. 413 본문은 `{"detail":{"hint","message"}}` 모양으로 준다. 그러면 지금 오류 길(`client.ts:148`)로 보인다.
- **참고** — 한도 대상은 실제로 이렇다.
  - 새로 거는 것: `StockCreate.ticker/name/category`, `StockUpdate.name/category`, `StockOrderUpdate.tickers`(개수와 각 길이), `MacroPinnedUpdate.codes`, `SettingsUpdate`의 dict 열쇠, `LoginRequest.password`, `AiModelsIn/AiAnalyzeIn.provider·model`.
  - 이미 있는 것: 리밸런싱 기록 note 200, push, question.
  - "표시 이름·메모"라는 칸은 따로 없다.
  - `client.ts:87` `FIELD_LABEL`에 ticker·name·category를 더한다. 목록 길이 오류는 지금 "N**자** 이하"로 나오니 단위를 고친다.
- **참고** — 그 밖에 짚을 것.
  - unsafe-inline이 필요한 진짜 까닭은 lightweight-charts가 `<style>`을 만들기 때문이다. React의 `style=`은 CSSOM이라 CSP에 걸리지 않는다.
  - requirements-dev로 옮기면 바뀌는 곳은 requirements 두 파일과 `tests.yml:68`이다. Dockerfile·setup.bat·update.bat은 그대로다.
  - `cryptography`의 "지금 깔린 판"은 깔 때마다 다르다. 여기서는 50.0.1이었고 새로 받으니 50.0.2였다. 판 숫자를 적어 정한다.

## C. 목표 0% 팔기 알림
**찬성**: 화면만 바뀐다. `OrderLine`을 바꿀 필요가 없다. 표와 카드가 이미 그 줄의 `row`를 알고 있으니 `order.action === 'sell' && row.target_weight_pct === 0`로 충분하다. `buyOnlyPlan`은 'sell'을 만들지 않으니(`orderPlan.ts:215`) "매수만 보기"에서는 저절로 꼬리가 없다.

**걱정**
- **참고** — 보유량이 잡음 기준 아래인 줄은 action이 `hold`라 꼬리가 없다. 시험의 "보유·목표 0"을 "팔기로 계산된 줄"로 정의한다.
- **참고** — 추가 알림은 지금 티커로 말한다(`StockManager.tsx:286`). 이름으로 바꿀 때는 `stockLabel(result.stock)`을 쓴다. 미국 종목은 이름이 비어 있을 수 있다.

**제안**: `orderPlan.ts`에 `zeroTargetSells(orders, rows)`를 두고 단위 시험으로 고정한다. `OrderLine`은 그대로 둔다.
