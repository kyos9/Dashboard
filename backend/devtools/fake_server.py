"""가짜 로그인·시세 서버 — 화면을 고치고 확인할 때 쓴다 (디자인 작업, E2E).

진짜 앱을 그대로 띄우되 **바깥과 통하는 자리만** 바꿔 끼운다. 화면·API·계산은 진짜다.

    cd backend
    python -m devtools.fake_server            # http://127.0.0.1:8150
    python -m devtools.fake_server --reset    # 데이터를 지우고 처음부터
    python -m devtools.fake_server --demo-rule-change   # 시그널 정의를 오늘 바꾼 것처럼 (0.41.0)

| 바꿔 끼우는 것 | 무엇으로 |
| --- | --- |
| 구글 로그인 | 계정을 고르는 작은 화면(`/api/dev/google-login`). 토큰은 여기서 만든 키로 서명하고, **검증은 진짜로** 한다 |
| 시세 | 종목마다 늘 같은 합성 시세 (2022년부터 오늘까지). 몇 종목은 일부러 매수·매도 시그널이 뜨게 만든다 |
| 재무 | 12분기 합성 재무 (ETF 는 "재무 없음") |
| 환율 | 고정값 (USD 1,385원, JPY 9.31원) |
| 매크로 | 지표마다 합성 값 |
| AI | Anthropic·OpenAI·Gemini 흉내. 웹 검색·출처도 온다. Gemini 이름에 `pro` 가 든 모델은 무료 한도 429 |
| 그 밖의 인터넷 | **막는다** — 실수로 진짜 서비스에 닿지 않게 |

**데모 계정** (로그인 화면에서 고른다):

| 계정 | 모습 |
| --- | --- |
| owner@example.com | 주인(관리자). 미국·한국·일본 15종목, 보유·목표 비중, 신호 |
| friend@example.com | 승인된 사용자. 4종목 |
| new@example.com | 승인된 사용자. 종목 0개 — 처음 온 사람 |
| pending@example.com | 승인 대기 |
| 그 밖의 아무 주소 | 새 가입 신청이 된다 |

로그인하지 않고 들어가면 손님 화면이다.

**지키는 것**

- `127.0.0.1` 에만 연다. 누구나 주인으로 들어오는 서버라 바깥에 열면 안 된다.
- 데이터는 `backend/.devdata/`(또는 `--data-dir`)에만 쓴다. `DATABASE_URL` 등 바깥 설정은 무시한다.
  진짜 DB·키·`.env` 를 건드리지 않는다.
- AI 키는 아무 글자나 넣으면 된다(진짜 키를 넣지 않는다). 가짜 AI 는 키를 적지도 보내지도 않는다.

화면은 `frontend/dist` 가 있으면 같은 주소에서 열린다(`npm run build`). 화면 코드를 고치는 중이면
`frontend` 에서 `VITE_API_TARGET=http://127.0.0.1:8150 npm run dev` 로 띄우고 5173 으로 들어간다.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html
import json
import os
import shutil
import sys
import time
from pathlib import Path
from urllib.parse import urlencode, urlparse

# 경로 함수의 인자 표시가 문자열로 남으므로(위 `annotations`) FastAPI 가 찾을 수 있게 모듈에 둔다.
# fastapi 는 환경 변수를 읽지 않는다 — 앱 모듈(`app.*`)만 `configure_env` 뒤에 불러온다.
from fastapi import Request

HOST = "127.0.0.1"
DEFAULT_PORT = 8150
BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATA_DIR = BACKEND_DIR / ".devdata"
# 이 표시가 있는 폴더만 --reset 으로 지운다 — 엉뚱한 폴더를 지우지 않게
MARKER = ".devtools-data"
SEEDED = ".devtools-seeded"

DEV_LOGIN_PATH = "/api/dev/google-login"
CLIENT_ID = "devtools.apps.googleusercontent.com"

OWNER = "owner@example.com"
FRIEND = "friend@example.com"
NEWCOMER = "new@example.com"
PENDING = "pending@example.com"
ACCOUNTS = [
    (OWNER, "주인 (관리자)", "종목 15개 · 보유 · 신호"),
    (FRIEND, "승인된 사용자", "종목 4개"),
    (NEWCOMER, "승인된 사용자", "종목 0개 — 처음 온 사람"),
    (PENDING, "승인 대기", "가입 신청만 한 사람"),
]

# 바깥 설정 중 가짜 서버에 섞이면 안 되는 것 — 진짜 주소로 돌려보내거나 진짜 서비스를 부른다
DROP_ENV = (
    "DASHBOARD_PASSWORD", "PUBLIC_URL", "SIGNAL_DASHBOARD_DB", "DART_API_KEY", "FRED_API_KEY",
    "APP_REVISION", "APP_BUILT_AT",
)

FX = {"USD": 1385.2, "JPY": 9.31}

# (티커, 이름, 구분, 목표 비중 %, 수량, 평단가 = 지금 값 × 이 배수, 시세 모양)
OWNER_STOCKS = [
    ("VOO", "VOO", "지수", 18, 40, 0.82, None),
    ("QQQ", "QQQ", "지수", 10, 25, 0.78, None),
    ("SCHD", "SCHD", "지수", 6, 120, 0.95, None),
    ("AAPL", "AAPL", "알파", 5, 30, 0.85, "rally"),
    ("MSFT", "MSFT", "알파", 5, 12, 1.12, None),
    ("NVDA", "NVDA", "알파", 6, 45, 0.6, "dip"),
    ("GOOG", "GOOG", "알파", 4, 20, 1.05, None),
    ("TSLA", "TSLA", "알파", 0, 0, None, None),
    ("005930.KS", "삼성전자", "알파", 10, 1500, 1.08, "dip"),
    ("005935.KS", "삼성전자우", "알파", 4, 600, 0.9, None),
    ("069500.KS", "KODEX 200", "지수", 6, 900, 0.92, None),
    ("381180.KS", "TIGER 미국필라델피아반도체나스닥", "지수", 6, 2000, 0.88, None),
    ("000660.KS", "SK하이닉스", "알파", 4, 150, 0.7, "rally"),
    ("7203.T", "トヨタ自動車", "알파", 4, 300, 1.1, None),
    ("8766.T", "東京海上ホールディングス", "안전자산", 2, 100, 0.95, None),
]
FRIEND_STOCKS = [
    ("SCHD", None, "지수", 40, 200, 0.9, None),
    ("VOO", None, "지수", 30, 10, 0.85, None),
    ("005930.KS", "삼성전자", "알파", 20, 100, 1.02, "dip"),
    ("7203.T", None, "알파", 10, 100, 1.0, None),
]
ETFS = {"VOO", "QQQ", "SCHD", "069500.KS", "381180.KS"}
LOSS_MAKERS = {"TSLA"}
SHAPES = {ticker: shape for ticker, *_rest, shape in OWNER_STOCKS + FRIEND_STOCKS if shape}

PRICE_START = dt.date(2022, 1, 3)


# ---------------------------------------------------------------------------
#  준비
# ---------------------------------------------------------------------------


def prepare_data_dir(path: Path, reset: bool) -> Path:
    path = path.resolve()
    if reset and path.exists():
        if not (path / MARKER).exists():
            raise SystemExit(f"{path} 는 이 도구가 만든 폴더가 아니라서 지우지 않습니다 ({MARKER} 없음)")
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)
    (path / MARKER).touch()
    return path


def configure_env(data_dir: Path) -> None:
    """앱 모듈을 불러오기 **전에** 부른다 — DB 주소 등은 불러올 때 읽힌다."""
    for name in DROP_ENV:
        os.environ.pop(name, None)
    os.environ.update({
        "DATABASE_URL": f"sqlite:///{data_dir / 'app.db'}",
        "SIGNAL_DASHBOARD_DISABLE_SCHEDULER": "1",
        "SIGNAL_DASHBOARD_BACKUP_DIR": str(data_dir / "backups"),
        "SIGNAL_DASHBOARD_SECRET_FILE": str(data_dir / "session.key"),
        "SIGNAL_DASHBOARD_LOG_DIR": str(data_dir / "logs"),
        "SIGNAL_DASHBOARD_VAPID_FILE": str(data_dir / "vapid.pem"),
        "GOOGLE_CLIENT_ID": CLIENT_ID,
        "GOOGLE_CLIENT_SECRET": "devtools-secret",
        "OWNER_GOOGLE_EMAIL": OWNER,
        "ALLOWED_GOOGLE_EMAILS": f"{FRIEND},{NEWCOMER}",
        "OPERATOR_CONTACT": "dev@example.com",
    })


# ---------------------------------------------------------------------------
#  합성 데이터
# ---------------------------------------------------------------------------


def _rng(label: str):
    import numpy as np

    seed = int.from_bytes(hashlib.sha256(label.encode()).digest()[:8], "big")
    return np.random.default_rng(seed)


def _market(ticker: str) -> str:
    if ticker.endswith((".KS", ".KQ")):
        return "KR"
    if ticker.endswith(".T"):
        return "JP"
    return "US"


def fake_history(ticker: str, period: str = "max", prefer: str | None = None):
    """종목마다 늘 같은 일봉. 날짜가 같으면 값도 같다(언제 받아도 겹치는 날은 일치)."""
    import numpy as np
    import pandas as pd

    days = pd.bdate_range(PRICE_START, dt.date.today())
    n = len(days)
    rng = _rng("price:" + ticker)
    market = _market(ticker)
    base = {"KR": rng.uniform(15_000, 90_000), "JP": rng.uniform(1_500, 4_000)}.get(market, rng.uniform(40, 500))
    steps = rng.normal(0.0004, 0.016, n)
    volume = rng.uniform(0.6, 1.4, n) * 2_000_000
    shape = SHAPES.get(ticker)
    if shape == "dip":
        # 최근 25일을 끌어내리고 거래량을 늘린다 → -DI > +DI, 이격도 < 0, ADX > 20 (무릎매수)
        steps[-25:] = rng.normal(-0.011, 0.006, 25)
        volume[-6:] *= 1.8
    elif shape == "rally":
        # 최근 25일을 끌어올리고 거래량을 늘린다 → 50일선 위, ADX 상승 (어깨매도 참고)
        steps[-25:] = rng.normal(0.011, 0.006, 25)
        volume[-6:] *= 1.8
    close = base * np.exp(np.cumsum(steps))
    digits = 0 if market in ("KR", "JP") else 2
    close = np.round(close, digits)
    spread = np.abs(rng.normal(0, 0.007, n))
    frame = pd.DataFrame(
        {
            "open": np.round(np.concatenate([[close[0]], close[:-1]]), digits),
            "high": np.round(close * (1 + spread), digits),
            "low": np.round(close * (1 - spread), digits),
            "close": close,
            "adj_close": close,
            "volume": np.round(volume),
        },
        index=[d.date() for d in days],
    )
    frame["high"] = frame[["open", "high", "close"]].max(axis=1)
    frame["low"] = frame[["open", "low", "close"]].min(axis=1)
    if period != "max":
        frame = frame.iloc[-520:]
    frame.attrs["provider"] = "dev"
    return frame


def fake_fundamentals(db, ticker, market, today):
    """`fundamentals._fetch` 자리. 12분기 손익 + 분기말 자본·부채·주식수.

    지금 (가짜) 주가로 PER 8~35배, PBR 0.6~5배쯤 나오게 주식수와 자본을 맞춘다.
    `LOSS_MAKERS` 는 최근 분기가 적자라 PER 이 "적자"로 보인다.
    """
    from app.markets import Market
    from app.services.providers import dart, sec, yahoo_fin

    source = {Market.US: sec.SOURCE, Market.KR: dart.SOURCE, Market.JP: yahoo_fin.SOURCE}[market]
    if ticker in ETFS:
        return source, sec.ParsedFacts(empty=True)
    currency = {Market.US: "USD", Market.KR: "KRW", Market.JP: "JPY"}[market]
    scale = {Market.US: 1e9, Market.KR: 1e12, Market.JP: 1e11}[market]
    rng = _rng("fund:" + ticker)

    year, quarter = today.year, (today.month - 1) // 3  # 지난 분기부터 거꾸로
    periods = []
    for _ in range(14):
        if quarter == 0:
            year, quarter = year - 1, 4
        start = dt.date(year, 3 * quarter - 2, 1)
        end = dt.date(year + (quarter == 4), 1 if quarter == 4 else 3 * quarter + 1, 1) - dt.timedelta(days=1)
        if end + dt.timedelta(days=40) <= today:
            periods.append((start, end))
        quarter -= 1
    periods = sorted(periods)[-12:]

    revenue = rng.uniform(5, 30) * scale
    margin = rng.uniform(0.08, 0.32)
    flows = []
    for i, _period in enumerate(periods):
        revenue *= 1 + rng.normal(0.02, 0.04)
        operating = revenue * (margin + rng.normal(0, 0.02))
        if ticker in LOSS_MAKERS and i >= len(periods) - 3:
            operating = -abs(operating) * 0.6
        flows.append((revenue, operating, operating * 0.78))

    price = float(fake_history(ticker)["close"].iloc[-1])
    net_ttm = sum(net for *_x, net in flows[-4:])
    shares = abs(net_ttm) * rng.uniform(8, 35) / price
    equity_now = price * shares / rng.uniform(0.6, 5)
    equity = equity_now - sum(net for *_x, net in flows) * 0.6

    rows: list[dict] = []

    def add(metric, start, end, value, unit):
        rows.append({
            "metric": metric, "period_start": start, "period_end": end, "value": float(value), "unit": unit,
            "filed_at": end + dt.timedelta(days=40), "filed_estimated": market == Market.JP,
            "source": source, "form": "dev", "tag": "dev",
        })

    for (start, end), (rev, operating, net) in zip(periods, flows):
        equity += net * 0.6
        add("revenue", start, end, rev, currency)
        add("operating_income", start, end, operating, currency)
        add("net_income", start, end, net, currency)
        add("eps_diluted", start, end, net / shares, f"{currency}/shares")
        add("equity", end, end, equity, currency)
        add("liabilities", end, end, equity * 0.7, currency)
        add("shares", end, end, round(shares), "shares")
    return source, sec.ParsedFacts(rows=rows)


# 오르기만 하는 지표: (시작값, 하루·한 달 평균 변화율, 흔들림)
MACRO_TRENDS = {
    "SP500": (4700, 0.0004, 0.009),
    "KOSPI": (2600, 0.0003, 0.010),
    "PCEPILFE": (120.0, 0.0024, 0.0012),
    "PCEPI": (121.0, 0.0022, 0.0015),
    "CPILFESL": (310.0, 0.0026, 0.0012),
    "CPIAUCSL": (305.0, 0.0024, 0.0018),
}
# 제자리로 돌아오는 지표: (평소 값, 흔들림) — 마구 걷게 두면 끝에 붙어 늘 "공포"·"역전"으로 보인다
MACRO_LEVELS = {
    "VIX": (17.0, 1.2),
    "FEARGREED": (52.0, 4.0),
    "DGS10": (4.15, 0.05),
    "DGS2": (3.85, 0.05),
    "DFF": (4.33, 0.0),
    "UNRATE": (4.1, 0.08),
}


def fake_macro_points(code: str, daily: bool):
    import numpy as np
    import pandas as pd

    from app.services.providers.macro_base import MacroPoint

    rng = _rng("macro:" + code)
    today = dt.date.today()
    if daily:
        dates = [d.date() for d in pd.bdate_range(today - dt.timedelta(days=3 * 365), today)]
    else:
        dates = [d.date() for d in pd.date_range(dt.date(today.year - 6, 1, 1), today - dt.timedelta(days=40), freq="MS")]
    if code in MACRO_LEVELS:
        level, noise = MACRO_LEVELS[code]
        values, x = [], level
        for shock in rng.normal(0, noise, len(dates)):
            x = level + 0.9 * (x - level) + shock
            values.append(max(x, 0.0))
    else:
        start, drift, noise = MACRO_TRENDS.get(code, (100.0, 0.0, 0.01))
        values = start * np.exp(np.cumsum(rng.normal(drift, noise, len(dates))))
    digits = 2 if max(values) < 1000 else 1
    return [MacroPoint(as_of=d, value=float(round(v, digits))) for d, v in zip(dates, values)]


# ---------------------------------------------------------------------------
#  가짜 AI — 실제 응답과 같은 모양의 흘려받기
# ---------------------------------------------------------------------------

AI_TEXT = [
    "숫자는 앱이 모은 최신 공개 데이터 기준이며, 업계 비교는 웹 검색 결과(출처 표기)입니다.\n\n",
    "## 1. 한눈에 보기\n- 가짜 AI 가 쓴 글입니다. 화면 확인용입니다.\n- 긴 줄이 어떻게 바뀌는지 보려고 일부러 길게 쓴 문장도 하나 둡니다 — "
    "평가손익과 비중, 시그널을 한 문단에 섞어 설명하면 이런 길이가 됩니다.\n\n",
    "## 2. 핵심 지표\n| 지표 | 값 | 비교·코멘트 |\n|---|---|---|\n| PER | 18.4배 | 업계 평균 약 24배 |\n"
    "| 영업이익률 | 21.3% | 지난해보다 2.1%p 높음 |\n| 비중 | 12.5% | 목표 10% 보다 2.5%p 많음 |\n\n",
    "## 3. 판단\n- 판단: **조건부 적합** (참고용)\n",
]
SOURCES = [
    ("https://example.com/peers-valuation-2026", "Peers valuation table — a deliberately long title to check wrapping on phones"),
    ("https://news.example.org/guidance", "Example News — guidance update"),
]
GEMINI_FREE_TIER_429 = {"error": {
    "code": 429, "status": "RESOURCE_EXHAUSTED",
    "message": "You exceeded your current quota, please check your plan and billing details. "
               "* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, "
               "limit: 0, model: gemini-dev-pro\nPlease retry in 34.5s.",
    "details": [
        {"@type": "type.googleapis.com/google.rpc.QuotaFailure", "violations": [{
            "quotaMetric": "generativelanguage.googleapis.com/generate_content_free_tier_requests",
            "quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
            "quotaDimensions": {"location": "global", "model": "gemini-dev-pro"}, "quotaValue": "0"}]},
        {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "34s"},
    ],
}}


def _sse(events: list[tuple[str | None, dict | str]]) -> list[str]:
    lines: list[str] = []
    for name, data in events:
        if name:
            lines.append(f"event: {name}")
        lines.append("data: " + (data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)))
        lines.append("")
    return lines


def _anthropic_events(search: bool) -> list:
    ev: list = [("message_start", {"type": "message_start", "message": {"model": "claude-dev", "usage": {"input_tokens": 12000}}})]
    if search:
        ev.append(("content_block_start", {"type": "content_block_start", "content_block": {"type": "server_tool_use", "name": "web_search"}}))
        ev.append(("content_block_start", {"type": "content_block_start", "content_block": {
            "type": "web_search_tool_result", "content": [{"type": "web_search_result", "url": u, "title": t} for u, t in SOURCES]}}))
    for i, text in enumerate(AI_TEXT):
        ev.append(("content_block_delta", {"type": "content_block_delta", "delta": {"type": "text_delta", "text": text}}))
        if search and i < len(SOURCES):
            url, title = SOURCES[i]
            ev.append(("content_block_delta", {"type": "content_block_delta", "delta": {
                "type": "citations_delta", "citation": {"type": "web_search_result_location", "url": url, "title": title}}}))
    ev.append(("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 700}}))
    return ev


def _openai_events(search: bool) -> list:
    if search:
        ev: list = [(None, {"type": "response.created", "response": {"model": "gpt-dev"}}),
                    (None, {"type": "response.web_search_call.in_progress"})]
        for i, text in enumerate(AI_TEXT):
            ev.append((None, {"type": "response.output_text.delta", "delta": text}))
            if i < len(SOURCES):
                url, title = SOURCES[i]
                ev.append((None, {"type": "response.output_text.annotation.added",
                                  "annotation": {"type": "url_citation", "url": url, "title": title}}))
        ev.append((None, {"type": "response.completed", "response": {
            "model": "gpt-dev", "usage": {"input_tokens": 9000, "output_tokens": 600}}}))
        return ev
    ev = [(None, {"model": "gpt-dev", "choices": [{"delta": {"content": text}}]}) for text in AI_TEXT]
    ev.append((None, {"model": "gpt-dev", "choices": [{"delta": {}, "finish_reason": "stop"}],
                      "usage": {"prompt_tokens": 9000, "completion_tokens": 600}}))
    ev.append((None, "[DONE]"))
    return ev


def _gemini_events(search: bool) -> list:
    ev: list = [(None, {"candidates": [{"content": {"parts": [{"text": text}]}}], "modelVersion": "gemini-dev-flash"})
                for text in AI_TEXT]
    last: dict = {"candidates": [{"content": {"parts": [{"text": ""}]}, "finishReason": "STOP"}],
                  "usageMetadata": {"promptTokenCount": 9000, "candidatesTokenCount": 500}}
    if search:
        last["candidates"][0]["groundingMetadata"] = {
            "webSearchQueries": ["peers per"],
            "groundingChunks": [{"web": {"uri": u, "title": t}} for u, t in SOURCES],
        }
    ev.append((None, last))
    return ev


def fake_send(method, url, headers, json=None, params=None):
    from app.services.providers import ai

    if url.endswith("/models"):
        if "anthropic" in url:
            return ai.Response(200, {"data": [{"id": "claude-dev", "display_name": "Claude Dev"},
                                              {"id": "claude-dev-mini", "display_name": "Claude Dev Mini"}]})
        if "openai" in url:
            return ai.Response(200, {"data": [{"id": "gpt-dev", "created": 2}, {"id": "gpt-dev-mini", "created": 1}]})
        if "generativelanguage" in url:
            gen = ["generateContent", "countTokens"]
            return ai.Response(200, {"models": [
                {"name": "models/gemini-dev-flash", "displayName": "Gemini Dev Flash", "supportedGenerationMethods": gen},
                {"name": "models/gemini-dev-pro", "displayName": "Gemini Dev Pro (무료 한도 0)", "supportedGenerationMethods": gen},
                {"name": "models/gemini-dev-flash-lite-with-a-very-long-dated-name-2026-09-30",
                 "displayName": "Gemini Dev Flash-Lite (긴 이름이 어떻게 보이는지)", "supportedGenerationMethods": gen},
            ]})
    # 흘려받지 않는 요청(쓰이지 않지만 막아 둔다)
    return ai.Response(500, {"error": {"message": "devtools: 흘려받기만 흉내 냅니다"}})


def fake_send_stream(url, headers, body, params=None):
    from app.services.providers import ai

    if "generativelanguage" in url:
        if "-pro" in url:
            return ai.StreamResponse(429, GEMINI_FREE_TIER_429, iter(()), lambda: None)
        events = _gemini_events(bool(body.get("tools")))
    elif "openai" in url:
        events = _openai_events(url.endswith("/responses"))
    else:
        events = _anthropic_events(bool(body.get("tools")))
    lines = _sse(events)
    delay = float(os.environ.get("DEVTOOLS_AI_DELAY", "0.25"))

    def flow():
        for line in lines:
            if line == "":
                time.sleep(delay)
            yield line

    return ai.StreamResponse(200, None, flow(), lambda: None)


# ---------------------------------------------------------------------------
#  가짜 구글
# ---------------------------------------------------------------------------


class _Keys:
    """서명 키 — 실행할 때마다 새로 만든다 (파일로 남기지 않는다)."""

    private_pem: bytes = b""
    public_pem: str = ""

    @classmethod
    def make(cls) -> None:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.private_pem = key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        )
        cls.public_pem = key.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        ).decode()


class _CertResponse:
    status = 200
    headers: dict = {}

    @property
    def data(self) -> bytes:
        return json.dumps({"devtools": _Keys.public_pem}).encode()


def fake_exchange_code(code: str, callback_uri: str, verifier: str) -> str:
    """`code` 에 실려 온 "nonce|이메일" 로 구글처럼 서명한 id_token 을 만든다."""
    from google.auth import crypt, jwt

    nonce, _, email = code.partition("|")
    email = email.strip().lower()
    now = int(time.time())
    claims = {
        "iss": "https://accounts.google.com", "aud": CLIENT_ID, "sub": "dev-" + email, "email": email,
        "email_verified": True, "name": email.split("@")[0], "nonce": nonce, "iat": now, "exp": now + 3600,
    }
    signer = crypt.RSASigner.from_string(_Keys.private_pem, key_id="devtools")
    return jwt.encode(signer, claims).decode()


def _login_page(redirect_uri: str, state: str, nonce: str) -> str:
    def target(email: str) -> str:
        return redirect_uri + "?" + urlencode({"code": f"{nonce}|{email}", "state": state})

    rows = "".join(
        f'<li><a class="acct" href="{html.escape(target(email))}"><b>{html.escape(email)}</b>'
        f"<span>{html.escape(role)} · {html.escape(note)}</span></a></li>"
        for email, role, note in ACCOUNTS
    )
    hidden = "".join(
        f'<input type="hidden" name="{k}" value="{html.escape(v)}">'
        for k, v in (("redirect_uri", redirect_uri), ("state", state), ("nonce", nonce))
    )
    return f"""<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>가짜 구글 로그인</title>
<style>
:root{{color-scheme:light dark;--bg:#f4f6fa;--panel:#fff;--text:#111;--dim:#555;--line:#dde3ec}}
@media (prefers-color-scheme:dark){{:root{{--bg:#0a0e14;--panel:#131b26;--text:#e6edf3;--dim:#9fb0c3;--line:#223044}}}}
body{{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif;word-break:keep-all}}
main{{max-width:420px;margin:0 auto;padding:24px 16px}}
h1{{font-size:20px;margin:0 0 4px}} p{{color:var(--dim);margin:0 0 16px}}
ul{{list-style:none;padding:0;margin:0 0 16px;display:grid;gap:8px}}
.acct{{display:grid;gap:2px;padding:12px 14px;min-height:44px;box-sizing:border-box;border:1px solid var(--line);
border-radius:12px;background:var(--panel);color:inherit;text-decoration:none}}
.acct span{{color:var(--dim);font-size:13px}}
form{{display:flex;gap:8px}} input[type=email]{{flex:1;min-height:44px;padding:0 12px;border-radius:8px;border:1px solid var(--line);
background:var(--panel);color:inherit;font:inherit}} button{{min-height:44px;padding:0 16px;border-radius:8px;border:0;
background:#2563eb;color:#fff;font:inherit}}
</style></head><body><main>
<h1>가짜 구글 로그인</h1><p>개발용 서버입니다. 들어갈 계정을 고르세요.</p>
<ul>{rows}</ul>
<form method="get" action="{DEV_LOGIN_PATH}">{hidden}
<input type="email" name="email" placeholder="다른 주소 (새 가입 신청)" required><button>들어가기</button></form>
</main></body></html>"""


def install_login(app) -> None:
    """구글로 보내는 대신 계정 고르는 화면으로 보낸다. 앱에 경로 하나를 맨 앞에 더한다."""
    from fastapi.responses import HTMLResponse, RedirectResponse

    from app.routers import auth as auth_router
    from app.services import google_login

    google_login.AUTH_URL = DEV_LOGIN_PATH
    auth_router.PUBLIC_PATHS = auth_router.PUBLIC_PATHS | {DEV_LOGIN_PATH}

    def dev_google_login(request: Request):
        q = request.query_params
        redirect_uri, state, nonce = q.get("redirect_uri", ""), q.get("state", ""), q.get("nonce", "")
        # 이 서버의 콜백으로만 돌려보낸다 (다른 주소로 code 를 넘기지 않는다)
        target = urlparse(redirect_uri)
        here = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
        if target.path != google_login.CALLBACK_PATH or target.netloc != here or not state or not nonce:
            return HTMLResponse("잘못된 요청입니다. 앱에서 '로그인'을 다시 누르세요.", status_code=400)
        email = (q.get("email") or "").strip().lower()
        if email:
            return RedirectResponse(redirect_uri + "?" + urlencode({"code": f"{nonce}|{email}", "state": state}), 302)
        return HTMLResponse(_login_page(redirect_uri, state, nonce))

    app.add_api_route(DEV_LOGIN_PATH, dev_google_login, methods=["GET"], include_in_schema=False)
    # 화면 주소를 다 받는 경로(`/{full_path:path}`)보다 앞에 둔다
    app.router.routes.insert(0, app.router.routes.pop())


# ---------------------------------------------------------------------------
#  인터넷 막기
# ---------------------------------------------------------------------------

PUSH_HOSTS = ("fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com")


def block_network() -> None:
    """`requests` 로 나가는 바깥 요청을 막는다. 푸시만 '받았다'고 돌려준다(보내지 않는다)."""
    import requests

    real = requests.sessions.Session.request

    def guarded(self, method, url, *args, **kwargs):
        host = (urlparse(url).hostname or "").lower()
        if host in ("127.0.0.1", "localhost", "::1"):
            return real(self, method, url, *args, **kwargs)
        if host.endswith(PUSH_HOSTS):
            response = requests.Response()
            response.status_code = 201
            response._content = b""
            response.url = url
            return response
        raise requests.ConnectionError(f"devtools: 바깥 접속을 막았습니다 ({host})")

    requests.sessions.Session.request = guarded

    # yfinance 는 requests 가 아니라 curl_cffi 로 나간다 — 그쪽도 막는다
    try:
        from curl_cffi import requests as curl_requests
    except ImportError:
        return

    def curl_blocked(self, method, url, *args, **kwargs):
        host = (urlparse(str(url)).hostname or "").lower()
        raise requests.ConnectionError(f"devtools: 바깥 접속을 막았습니다 ({host})")

    curl_requests.Session.request = curl_blocked


def install_fakes() -> None:
    from app.services import data_ingestion, fundamentals, fx, google_login
    from app.services.providers import ai

    block_network()
    _Keys.make()
    google_login._transport = lambda: (lambda url, method="GET", **kw: _CertResponse())
    google_login.exchange_code = fake_exchange_code
    data_ingestion.fetch_price_history = fake_history
    fundamentals._fetch = fake_fundamentals
    fundamentals.fetch_splits = lambda ticker: []
    fx.fetch_krw_rate = lambda currency, timeout=15: FX.get(getattr(currency, "value", str(currency)))
    ai.send = fake_send
    ai.send_stream = fake_send_stream


# ---------------------------------------------------------------------------
#  데모 데이터
# ---------------------------------------------------------------------------


def _add_stocks(db, user_id: int, stocks: list) -> None:
    from app.models import Holding, UserStock
    from app.services.instruments import ensure_instrument

    for order, (ticker, name, category, target, quantity, cost_ratio, _shape) in enumerate(stocks):
        instrument = ensure_instrument(db, ticker, name=name if name and name != ticker else None)
        display = name if name and name != ticker else None
        db.add(UserStock(user_id=user_id, ticker=instrument.ticker, instrument=instrument, name=display,
                         category=category, target_weight_pct=float(target), sort_order=order))
        if quantity:
            last = float(fake_history(ticker)["close"].iloc[-1])
            fx_rate = FX.get({"US": "USD", "JP": "JPY"}.get(_market(ticker), ""), None)
            db.add(Holding(user_id=user_id, ticker=instrument.ticker, quantity=float(quantity),
                           avg_cost=round(last * cost_ratio, 2) if cost_ratio else None,
                           avg_fx=round(fx_rate * 0.97, 2) if fx_rate else None))


def seed() -> None:
    from app.db import SessionLocal
    from app.models import MacroSeries, User
    from app.services import data_ingestion, fundamentals, fx, macro
    from app.services.users import ensure_local_owner

    now = dt.datetime.utcnow()
    with SessionLocal() as db:
        owner = ensure_local_owner(db)
        # 구글 계정은 붙이지 않는다 — 처음 로그인할 때 앱이 주인 주소를 보고 1번에 붙인다(진짜와 같은 길)
        owner.email, owner.name, owner.status, owner.last_login_at = OWNER, "owner", "active", now
        users = {}
        for email, status in ((FRIEND, "active"), (NEWCOMER, "active"), (PENDING, "pending")):
            user = User(google_sub="dev-" + email, email=email, name=email.split("@")[0], status=status,
                        is_owner=False, created_at=now, last_login_at=now)
            db.add(user)
            users[email] = user
        db.flush()
        _add_stocks(db, owner.id, OWNER_STOCKS)
        _add_stocks(db, users[FRIEND].id, FRIEND_STOCKS)
        db.commit()

        tickers = sorted({row[0] for row in OWNER_STOCKS + FRIEND_STOCKS})
        for ticker in tickers:
            data_ingestion.refresh_ticker(db, ticker, price_df=fake_history(ticker))
            db.commit()
            fundamentals.refresh_ticker(db, ticker)
        fx.refresh_rates(db, force=True)

        macro.ensure_seed(db)
        for series in db.query(MacroSeries).all():
            daily = series.frequency == "daily"
            macro.upsert_values(db, series.code, fake_macro_points(series.code, daily), source="dev")
            macro.mark_checked(db, series)
        db.commit()


# ---------------------------------------------------------------------------
#  실행
# ---------------------------------------------------------------------------


def recompute_signals(demo_rule_change: bool = False) -> dict | None:
    """진짜 서버가 켠 직후 job 에서 하는 것 — 시그널 정의가 바뀌었으면 지난 판정을 다시 계산한다.

    가짜 서버는 스케줄러를 끄므로 여기서 직접 부른다. `demo_rule_change` 면 정의를 오늘 바꾼 것처럼 꾸민다:
    이력에 오늘 한 줄을 더하고(화면의 "바뀌었습니다"), 적어 둔 지문을 옛 것으로 바꿔 다시 계산이 돌게 한다
    (정의 자체는 그대로라 바뀌는 행은 0 — 진단에 재계산 한 줄이 뜨는 것까지 본다).
    """
    from app.db import SessionLocal
    from app.services import app_settings, signal_recompute, signal_rules

    db = SessionLocal()
    try:
        if demo_rule_change:
            signal_rules.CHANGES.append({
                "date": dt.date.today().isoformat(),
                "what": "(데모) 바꾼 것처럼 꾸몄을 뿐 판정은 그대로",
                "why": "가짜 서버 --demo-rule-change",
            })
            app_settings.set_value(db, signal_recompute.FINGERPRINT_KEY, "demo-old-definition")
        return signal_recompute.run_if_changed(db)
    finally:
        db.close()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="가짜 로그인·시세 서버 (개발·디자인 확인용)")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--reset", action="store_true", help="데이터를 지우고 데모 데이터부터 다시 만든다")
    parser.add_argument(
        "--demo-rule-change", action="store_true",
        help="시그널 정의를 오늘 바꾼 것처럼 — 켤 때 지난 판정을 다시 계산하고, 신호 요약에 '바뀌었습니다'가 뜬다",
    )
    args = parser.parse_args(argv)

    data_dir = prepare_data_dir(args.data_dir, args.reset)
    configure_env(data_dir)
    sys.path.insert(0, str(BACKEND_DIR))

    install_fakes()
    from app.db import init_db

    init_db()
    if not (data_dir / SEEDED).exists():
        print("데모 데이터를 만드는 중… (처음 한 번, 수십 초)", flush=True)
        seed()
        (data_dir / SEEDED).touch()
    recompute_signals(demo_rule_change=args.demo_rule_change)

    import uvicorn

    from app.main import app

    install_login(app)
    base = f"http://{HOST}:{args.port}"
    print(f"\n가짜 서버: {base}  (데이터: {data_dir})", flush=True)
    print("로그인 → 계정 고르기: " + ", ".join(email for email, *_ in ACCOUNTS), flush=True)
    uvicorn.run(app, host=HOST, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
