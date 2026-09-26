"""SEC EDGAR companyfacts — 미국 상장사 재무 (ROADMAP 3b-1).

키가 없다. 대신 요청마다 **누가 부르는지(User-Agent)**를 밝혀야 하고, 초당 10번을 넘기면
막힌다. 한 종목에 요청 한 번(회사 전체 공시 값 3~4MB)이라 새벽에 몇십 종목이면 충분하다.

**값마다 공시일(`filed`)이 붙어 온다** — 이 출처를 1순위로 두는 이유다. 야후는 값만 준다.

서버 진단(v0.23.2)에서 확인한 모양:

- 같은 분기가 여러 번 온다. 그 분기 10-Q, 이듬해 같은 분기 10-Q(비교 기간), 실적 발표
  8-K. 값이 같으면 **처음 공시된 날**만 남긴다.
- 손익은 3개월 값과 누적(6·9개월) 값이 같이 오지만, **현금흐름은 누적만 온다.** 분기
  값은 계산기(services/fundamentals.py)가 빼서 만든다.
- 회사마다 태그가 다르고 **중간에 바뀐다.** 엔비디아의 설비투자는 2020년까지만
  `PaymentsToAcquirePropertyPlantAndEquipment` 이고 그 뒤는 다른 태그다. 그래서 태그 하나를
  고르지 않고 **기간마다** 우선순위가 높은 태그의 값을 쓴다.
- 문의처 메일을 넣은 User-Agent 가 403 을 받고 사이트 주소만 넣은 쪽이 통한 서버가 있었다.
  둘 다 시도하고, 통한 쪽을 기억한다.
- 대만 TSMC 같은 해외 발행사(20-F)는 `ifrs-full` 태그에 대만 달러, **연간 값뿐**이다.
  분기 표와 PER 을 만들 수 없어 여기서는 읽지 않는다 (3b-3 야후 폴백).
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import re
import threading
import time
from dataclasses import dataclass, field

import requests

logger = logging.getLogger(__name__)

SOURCE = "sec"
TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"

# 초당 10번 제한 — 넉넉하게 띄운다
MIN_INTERVAL = 0.25
# 몇 년 치를 저장하나. PER 5년 위치를 그리려면 그보다 1년 앞(TTM)과 전년 비교 1년이 더 필요하다.
KEEP_YEARS = 7

# (단위, 기간값인가, [(분류, 태그) — 앞에 있을수록 먼저])
METRIC_TAGS: dict[str, tuple[str, bool, list[tuple[str, str]]]] = {
    "revenue": ("USD", True, [
        ("us-gaap", "Revenues"),
        ("us-gaap", "RevenueFromContractWithCustomerExcludingAssessedTax"),
        ("us-gaap", "SalesRevenueNet"),
        ("us-gaap", "RevenueFromContractWithCustomerIncludingAssessedTax"),
    ]),
    "operating_income": ("USD", True, [("us-gaap", "OperatingIncomeLoss")]),
    "net_income": ("USD", True, [
        ("us-gaap", "NetIncomeLoss"),
        ("us-gaap", "NetIncomeLossAvailableToCommonStockholdersBasic"),
        ("us-gaap", "ProfitLoss"),
    ]),
    "eps_diluted": ("USD/shares", True, [
        ("us-gaap", "EarningsPerShareDiluted"),
        ("us-gaap", "EarningsPerShareBasicAndDiluted"),
    ]),
    "equity": ("USD", False, [
        ("us-gaap", "StockholdersEquity"),
        ("us-gaap", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"),
    ]),
    "liabilities": ("USD", False, [("us-gaap", "Liabilities")]),
    # 부채 합계를 따로 안 내는 회사가 있다 (일라이 릴리). 그때는 "부채와 자본 합계 − 자본".
    "liabilities_and_equity": ("USD", False, [("us-gaap", "LiabilitiesAndStockholdersEquity")]),
    "operating_cf": ("USD", True, [
        ("us-gaap", "NetCashProvidedByUsedInOperatingActivities"),
        ("us-gaap", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"),
    ]),
    "capex": ("USD", True, [
        ("us-gaap", "PaymentsToAcquirePropertyPlantAndEquipment"),
        ("us-gaap", "PaymentsToAcquireProductiveAssets"),
        ("us-gaap", "PaymentsForCapitalImprovements"),
        ("us-gaap", "PaymentsToAcquireOtherPropertyPlantAndEquipment"),
    ]),
    # 표지의 발행주식수 (공시일 직전 날짜 기준). 주식 종류가 여럿인 회사(알파벳)는 종류별로만
    # 내서 여기 안 잡힌다 — 그때는 아래 희석 가중평균으로 간다.
    "shares": ("shares", False, [
        ("dei", "EntityCommonStockSharesOutstanding"),
        ("us-gaap", "CommonStockSharesOutstanding"),
    ]),
    "shares_diluted": ("shares", True, [("us-gaap", "WeightedAverageNumberOfDilutedSharesOutstanding")]),
    "dps": ("USD/shares", True, [
        ("us-gaap", "CommonStockDividendsPerShareDeclared"),
        ("us-gaap", "CommonStockDividendsPerShareCashPaid"),
    ]),
}

# 없으면 "공시에 없는 항목"으로 알려줄 것들 (보조 항목은 빼고)
REPORTED_METRICS = ("revenue", "operating_income", "net_income", "eps_diluted", "equity",
                    "operating_cf", "capex")


class SecError(Exception):
    """SEC 에서 받지 못했다. 메시지는 사람이 읽는 한 줄이다."""


class NotListed(SecError):
    """SEC 목록에 없다 — ETF 이거나 미국 상장사가 아니다."""


@dataclass
class ParsedFacts:
    # 저장할 행 (FundamentalFact 의 칸 이름 그대로)
    rows: list[dict] = field(default_factory=list)
    # 공시에 없는 항목
    missing: list[str] = field(default_factory=list)
    # 읽을 수 없는 모양이면 그 이유 (해외 발행사 등)
    unsupported: str | None = None
    # 재무제표가 아예 없으면 True (펀드·ETF)
    empty: bool = False


# --- User-Agent -----------------------------------------------------------------

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def user_agents() -> list[str]:
    """시도할 User-Agent. SEC 는 연락처를 요구한다 — 문의처가 메일이면 그걸, 아니면 사이트 주소."""
    site = (os.getenv("PUBLIC_URL") or "https://asset-hub.duckdns.org").strip()
    agents = []
    contact = (os.getenv("OPERATOR_CONTACT") or "").strip()
    if _EMAIL.match(contact):
        agents.append(f"asset-hub {contact}")
    agents.append(f"asset-hub/1.0 (+{site})")
    return agents


_lock = threading.Lock()
_last_call = 0.0
_working_agent: str | None = None


def _get(url: str, timeout: int = 30) -> requests.Response:
    """SEC 에 한 번 묻는다. 403 이면 다음 User-Agent 로, 통한 것은 기억해 다음부터 먼저 쓴다."""
    global _last_call, _working_agent
    agents = user_agents()
    if _working_agent in agents:
        agents.remove(_working_agent)
        agents.insert(0, _working_agent)

    last: requests.Response | None = None
    for agent in agents:
        with _lock:
            wait = MIN_INTERVAL - (time.monotonic() - _last_call)
            if wait > 0:
                time.sleep(wait)
            _last_call = time.monotonic()
        try:
            response = requests.get(url, headers={"User-Agent": agent}, timeout=timeout)
        except requests.RequestException as exc:
            raise SecError(f"SEC 에 연결하지 못했습니다 ({type(exc).__name__})") from exc
        if response.status_code == 403:
            last = response
            continue
        _working_agent = agent
        return response
    assert last is not None
    return last


_tickers: dict[str, int] | None = None
_tickers_at = 0.0
TICKERS_TTL = 24 * 3600


def cik_for(ticker: str) -> int:
    """티커 → SEC 회사 번호. 목록은 하루 한 번만 받는다."""
    global _tickers, _tickers_at
    if _tickers is None or time.monotonic() - _tickers_at > TICKERS_TTL:
        response = _get(TICKERS_URL)
        if response.status_code != 200:
            raise SecError(f"SEC 티커 목록 HTTP {response.status_code}")
        _tickers = parse_ticker_map(response.json())
        _tickers_at = time.monotonic()
    cik = _tickers.get(sec_ticker(ticker))
    if cik is None:
        raise NotListed("SEC 목록에 없습니다 — ETF 이거나 미국 상장사가 아닙니다")
    return cik


def sec_ticker(ticker: str) -> str:
    """우리 티커 → SEC 표기. 야후식 `BRK-B` 는 SEC 도 `BRK-B` 다."""
    return ticker.strip().upper().replace(".", "-")


def parse_ticker_map(data: dict) -> dict[str, int]:
    out: dict[str, int] = {}
    for row in (data or {}).values():
        try:
            out.setdefault(str(row["ticker"]).upper(), int(row["cik_str"]))
        except (KeyError, TypeError, ValueError):
            continue
    return out


def fetch_companyfacts(cik: int) -> dict | None:
    """회사 전체 공시 값. 없으면(404) None — 펀드처럼 재무제표를 안 내는 곳이다."""
    response = _get(FACTS_URL.format(cik=cik), timeout=60)
    if response.status_code == 404:
        return None
    if response.status_code != 200:
        raise SecError(f"SEC 재무 HTTP {response.status_code}")
    return response.json()


# --- 해석 -----------------------------------------------------------------------

def _date(text) -> dt.date | None:
    try:
        return dt.date.fromisoformat(str(text)[:10])
    except (TypeError, ValueError):
        return None


def parse_companyfacts(data: dict, today: dt.date | None = None) -> ParsedFacts:
    """companyfacts → 저장할 행.

    - 기간마다 우선순위가 가장 높은 태그 하나만 쓴다 (같은 기간을 두 태그가 다른 뜻으로
      낼 수 있다 — 매출 총액과 계약 매출).
    - 같은 기간은 **처음 공시된 날**의 값을 남기고, 뒤에 값이 바뀌었을 때만 그 날로 한 줄 더.
    """
    today = today or dt.date.today()
    facts = (data or {}).get("facts") or {}
    parsed = ParsedFacts()
    if "us-gaap" not in facts:
        if "ifrs-full" in facts:
            parsed.unsupported = (
                "해외 발행사(20-F)는 연간 값만, 자국 통화로 공시해 분기 표를 만들 수 없습니다"
            )
        else:
            parsed.empty = True
        return parsed

    cutoff = dt.date(today.year - KEEP_YEARS, 1, 1)
    for metric, (unit, is_duration, tags) in METRIC_TAGS.items():
        claimed: dict[tuple[dt.date, dt.date], str] = {}
        versions: dict[tuple[dt.date, dt.date], list[tuple[dt.date, float, str | None]]] = {}
        for taxonomy, name in tags:
            entries = (((facts.get(taxonomy) or {}).get(name) or {}).get("units") or {}).get(unit) or []
            for entry in entries:
                end = _date(entry.get("end"))
                filed = _date(entry.get("filed"))
                value = entry.get("val")
                if end is None or filed is None or not isinstance(value, (int, float)):
                    continue
                if end < cutoff:
                    continue
                if is_duration:
                    start = _date(entry.get("start"))
                    if start is None or start >= end:
                        continue
                else:
                    start = end
                key = (start, end)
                owner = claimed.get(key)
                if owner is not None and owner != name:
                    continue  # 더 앞선 태그가 이미 이 기간을 냈다
                claimed[key] = name
                versions.setdefault(key, []).append((filed, float(value), entry.get("form")))
        if not versions:
            if metric in REPORTED_METRICS:
                parsed.missing.append(metric)
            continue
        for (start, end), items in versions.items():
            items.sort(key=lambda item: item[0])
            kept_value: float | None = None
            kept_filed: set[dt.date] = set()
            for filed, value, form in items:
                if kept_value is not None and _same(value, kept_value):
                    continue
                if filed in kept_filed:
                    continue  # 같은 날 두 값 — 먼저 온 것을 믿는다
                kept_value = value
                kept_filed.add(filed)
                parsed.rows.append({
                    "metric": metric,
                    "period_start": start,
                    "period_end": end,
                    "value": value,
                    "unit": unit,
                    "filed_at": filed,
                    "filed_estimated": False,
                    "source": SOURCE,
                    "form": form,
                    "tag": claimed[(start, end)],
                })
    if not any(row["metric"] in ("revenue", "net_income", "eps_diluted") for row in parsed.rows):
        parsed.empty = True
    return parsed


def _same(a: float, b: float) -> bool:
    return abs(a - b) <= 1e-9 * max(1.0, abs(a), abs(b))
