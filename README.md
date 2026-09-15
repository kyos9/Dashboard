# 신호판 대시보드

`SIGNAL_APP_SPEC.md`의 무릎매수(v2)/어깨매도(참고) 시그널 로직을 기반으로, 종목을 자유롭게
추가·변경·제거하면서 현재 시그널 상태와 히스토리, 리밸런싱 상태를 확인하는 개인용 참고 대시보드.

## 구조

- `backend/` — FastAPI + SQLite. 지표 계산, 시그널 판정, 매수 워크플로우, 리밸런싱/비중조절 신호, yfinance 데이터 수집.
- `frontend/` — Vite + React + TypeScript. 대시보드/히스토리 차트/리밸런싱/종목 관리 4개 화면.

## 로컬 실행

### Windows — 더블클릭으로 실행

1. **`setup.bat`** — 처음 한 번만 더블클릭 (venv 생성, 백엔드/프런트엔드 패키지 설치)
2. **`start-all.bat`** — 그 다음부터는 이것만 더블클릭하면 백엔드/프런트엔드가 각자 창에서 켜지고, 잠시 후 브라우저가 자동으로 열립니다

개별 실행이 필요하면 `start-backend.bat` / `start-frontend.bat`을 따로 실행해도 됩니다.

### 백엔드 (수동 실행 / macOS·Linux)

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

최초 실행 시 `signal_dashboard.db` (SQLite)가 자동 생성됩니다. 매일 새벽(UTC 22:30, 미국 장 마감
이후) 활성 종목 전체를 자동 갱신하는 스케줄러가 함께 시작됩니다. 스케줄러 없이 띄우려면
`SIGNAL_DASHBOARD_DISABLE_SCHEDULER=1` 환경변수를 설정하세요.

### 프런트엔드

```bash
cd frontend
npm install
npm run dev
```

`http://localhost:5173`에서 접속하며, `/api/*` 요청은 `vite.config.ts`의 프록시 설정을 통해
백엔드(`http://localhost:8000`)로 전달됩니다.

## 종목 추가 흐름

종목 관리 화면에서 티커를 입력해 추가하면, 백엔드가 yfinance로 전체 히스토리를 백필하고
지표/시그널을 계산합니다. 네트워크가 막혀있거나 실패해도 종목 등록 자체는 유지되며, 이후
"새로고침" 버튼으로 재시도할 수 있습니다.

## 테스트

```bash
cd backend
source .venv/bin/activate
pytest
```

지표(MA/StdDev/ROC/이격도/Wilder DMI-ADX), 시그널 조건식, 매수 워크플로우, 리밸런싱/비중조절
신호, API 라우터까지 단위·통합 테스트로 커버되어 있습니다. yfinance 실제 호출은 네트워크가
필요하므로 테스트에서는 mock 처리됩니다.

## 알려진 제약

- 종가는 분할(split)은 반영하되 배당 재투자 조정은 하지 않은 값을 사용합니다 (`SIGNAL_APP_SPEC.md`의
  investing.com 종가 기준 백테스트와 정합성을 맞추기 위함).
- 매수 추천은 자동으로 "확정"되지 않습니다 — 대시보드에서 "매수완료 확인"을 눌러야 확정되고,
  이때 보유수량에 반영할지 선택할 수 있습니다.
- 매도(리밸런싱) 실행일은 항상 고정 리뷰 마감일이며, 비중조절 신호(밴드 초과/미달, 정기 리뷰 도래)는
  조기 참고 알림일 뿐 자동 매매를 트리거하지 않습니다.
