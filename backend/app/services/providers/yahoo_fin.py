"""야후 재무 — 일본 종목 (ROADMAP 3b-3).

일본의 공식 공시(EDINET)는 XBRL 해석이 무거워서 야후로 받는다. 키가 없다.

SEC·DART 와 다른 점:

- **공시일을 주지 않는다.** 대신 야후가 아는 **실적 발표일**을 쓴다 — 일본은 실적 발표
  (決算短信)가 거래소 공시 그 자체라서, 결산일 뒤 처음 온 발표일이 곧 공시일이다. 발표일
  목록에 없는 옛 기간은 **결산일 + 45일로 추정**하고 화면에 "(추정)"을 붙인다(일본 거래소는
  결산 뒤 45일 안에 발표하라고 한다).
- **분기 값이 최근 5~6분기뿐이다.** 그 앞은 연간 값(4년)만 있어서 PER 5년 위치는 연간 EPS 로
  그린다 — 거칠고, 대개 4년이 안 된다.
- 분기 값이 곧 3개월 값이다 (누적이 아니다). 값이 빈 분기가 섞여 온다 → 빈 칸은 뺀다.
- **주당 값은 이미 지금 주식 기준(분할 반영)으로 온다**고 본다. 그래서 이 출처의 값은
  `StockSplit` 으로 다시 나누지 않는다 (`fundamentals._facts_by_ticker`). 서버 진단의
  "분할 기준" 줄로 확인한다.
- 재무를 엔이 아닌 통화로 내는 회사는 주가(엔)와 나눌 수 없어 읽지 않는다.
"""

from __future__ import annotations

import calendar
import datetime as dt
import logging
import math
from dataclasses import dataclass, field

from app.services.providers.sec import ParsedFacts

logger = logging.getLogger(__name__)

SOURCE = "yahoo"
# 발표일을 모를 때의 추정 (일본 거래소의 45일 규칙)
ESTIMATE_DAYS = 45
# 결산일 뒤 이 안에 온 발표일만 그 기간의 것으로 본다
MATCH_DAYS = 100
EARNINGS_LIMIT = 24

# 항목 → (어느 표, 줄 이름(앞이 먼저), 기간값인가)
ROWS: dict[str, tuple[str, list[str], bool]] = {
    "revenue": ("income", ["Total Revenue", "Operating Revenue"], True),
    "operating_income": ("income", ["Operating Income"], True),
    "net_income": ("income", ["Net Income Common Stockholders", "Net Income"], True),
    "eps_diluted": ("income", ["Diluted EPS", "Basic EPS"], True),
    "equity": ("balance", ["Stockholders Equity", "Common Stock Equity"], False),
    "liabilities": ("balance", ["Total Liabilities Net Minority Interest"], False),
    "shares": ("balance", ["Ordinary Shares Number", "Share Issued"], False),
    "operating_cf": ("cashflow", ["Operating Cash Flow"], True),
    # 나가는 돈이라 음수로 온다 — 크기만
    "capex": ("cashflow", ["Capital Expenditure"], True),
}
# (분기 표, 연간 표) 의 yfinance 속성 이름
FRAMES = {
    "income": ("quarterly_income_stmt", "income_stmt"),
    "balance": ("quarterly_balance_sheet", "balance_sheet"),
    "cashflow": ("quarterly_cashflow", "cashflow"),
}
REPORTED_METRICS = ("revenue", "operating_income", "net_income", "eps_diluted", "equity",
                    "operating_cf", "capex")


class YahooError(Exception):
    """야후에서 받지 못했다."""


class NotListed(YahooError):
    """재무제표가 없는 종목 (ETF 등)."""


@dataclass
class Handle:
    """테스트가 가짜로 바꿔 끼우는 자리 — yfinance.Ticker 에서 쓰는 것만."""

    info: dict
    frames: dict[str, object] = field(default_factory=dict)
    earnings: list[dt.date] = field(default_factory=list)
    dividends: list[tuple[dt.date, float]] = field(default_factory=list)


def fetch(ticker: str) -> Handle:
    """야후에 묻는다. 표 하나가 실패해도 나머지로 간다 — 종류(info)를 못 받으면 오류."""
    import yfinance as yf

    handle = yf.Ticker(ticker)
    try:
        info = handle.get_info() or {}
    except Exception as exc:
        raise YahooError(f"야후 종목 정보를 받지 못했습니다 ({type(exc).__name__})") from None
    frames = {}
    for quarterly, annual in FRAMES.values():
        for attr in (quarterly, annual):
            try:
                frames[attr] = getattr(handle, attr)
            except Exception as exc:
                logger.info("야후 %s %s: %s", ticker, attr, type(exc).__name__)
    earnings: list[dt.date] = []
    try:
        table = handle.get_earnings_dates(limit=EARNINGS_LIMIT)
        if table is not None and not table.empty:
            earnings = sorted({stamp.date() for stamp in table.index})
    except Exception as exc:
        logger.info("야후 %s 실적 발표일: %s", ticker, type(exc).__name__)
    dividends: list[tuple[dt.date, float]] = []
    try:
        dividends = [(stamp.date(), float(value)) for stamp, value in handle.dividends.items()]
    except Exception as exc:
        logger.info("야후 %s 배당: %s", ticker, type(exc).__name__)
    return Handle(info=info, frames=frames, earnings=earnings, dividends=dividends)


# --- 해석 -----------------------------------------------------------------------

def period_start(end: dt.date, months: int) -> dt.date:
    """`end` 로 끝나는 `months` 개월의 첫날. 월말로 끝나면 그 달부터 거꾸로 센 달의 1일."""
    month = end.month - months + 1
    year = end.year
    while month <= 0:
        month += 12
        year -= 1
    if end.day == calendar.monthrange(end.year, end.month)[1]:
        return dt.date(year, month, 1)
    # 월말이 아닌 결산(드물다) — 같은 날짜의 다음 날
    month -= 1
    if month <= 0:
        month += 12
        year -= 1
    day = min(end.day, calendar.monthrange(year, month)[1])
    return dt.date(year, month, day) + dt.timedelta(days=1)


def filed_for(end: dt.date, earnings: list[dt.date]) -> tuple[dt.date, bool]:
    """결산일 뒤 처음 온 실적 발표일. 없으면 결산일 + 45일 (추정)."""
    for day in earnings:
        if end < day <= end + dt.timedelta(days=MATCH_DAYS):
            return day, False
    return end + dt.timedelta(days=ESTIMATE_DAYS), True


def _value(raw) -> float | None:
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(value) or math.isinf(value) else value


def _columns(frame) -> list[tuple[dt.date, object]]:
    out = []
    for column in getattr(frame, "columns", []):
        try:
            out.append((column.date() if hasattr(column, "date") else dt.date.fromisoformat(str(column)[:10]),
                        column))
        except ValueError:
            continue
    return out


def parse(handle: Handle, today: dt.date | None = None) -> ParsedFacts:
    today = today or dt.date.today()
    parsed = ParsedFacts()
    info = handle.info or {}
    kind = str(info.get("quoteType") or "").upper()
    if kind and kind != "EQUITY":
        raise NotListed(f"재무제표가 없는 종목입니다 ({kind})")
    currency = str(info.get("financialCurrency") or "JPY").upper()
    if currency != "JPY":
        parsed.unsupported = f"재무를 {currency} 로 공시해 엔화 주가와 나눌 수 없습니다"
        return parsed

    seen: set[tuple] = set()
    for metric, (table, names, is_duration) in ROWS.items():
        for attr, months in zip(FRAMES[table], (3, 12)):
            frame = handle.frames.get(attr)
            if frame is None or getattr(frame, "empty", True):
                continue
            name = next((n for n in names if n in frame.index), None)
            if name is None:
                continue
            for end, column in _columns(frame):
                value = _value(frame.at[name, column])
                if value is None:
                    continue
                start = period_start(end, months) if is_duration else end
                if (metric, start, end) in seen:
                    continue  # 분기 표와 연간 표에 같은 재무상태 날짜가 둘 다 온다
                seen.add((metric, start, end))
                filed, estimated = filed_for(end, handle.earnings)
                if filed > today:
                    continue
                parsed.rows.append(_row(metric, start, end, abs(value) if metric == "capex" else value,
                                        filed, estimated, "분기" if months == 3 else "연간", name))

    # 배당 — 연간 표의 회계연도마다 그 안에 배당락이 있었던 주당 배당을 더한다.
    # 배당 이력을 못 받았으면 0 으로 적지 않고 비운다 (배당수익률 0% 로 보이면 틀린 말이다).
    years = sorted({(r["period_start"], r["period_end"], r["filed_at"], r["filed_estimated"])
                    for r in parsed.rows if r["metric"] == "revenue" and r["form"] == "연간"})
    for start, end, filed, estimated in years if handle.dividends else []:
        total = sum(value for day, value in handle.dividends if start <= day <= end)
        parsed.rows.append(_row("dps", start, end, total, filed, estimated, "연간", "Dividends"))

    have = {r["metric"] for r in parsed.rows}
    if not have & {"revenue", "net_income", "eps_diluted"}:
        parsed.rows = []
        parsed.empty = True
        return parsed
    parsed.missing = [m for m in REPORTED_METRICS if m not in have]
    return parsed


def _row(metric, start, end, value, filed, estimated, form, tag) -> dict:
    unit = "JPY/shares" if metric in ("eps_diluted", "dps") else "shares" if metric == "shares" else "JPY"
    return {
        "metric": metric, "period_start": start, "period_end": end, "value": value, "unit": unit,
        "filed_at": filed, "filed_estimated": estimated, "source": SOURCE, "form": form, "tag": tag,
    }
