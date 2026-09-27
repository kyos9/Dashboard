"""미국 상장 종목 목록 — 티커↔이름 대응표 (ROADMAP 작은 일들).

내장 목록(`us_seed.json`)은 자주 보는 140여 개에 한글 별칭을 붙여 손으로 적은 것이라, 거기
없는 종목은 이름으로 찾을 수 없었다 — 티커를 알거나 야후 검색이 받아줘야 했다. 이 목록을
받아두면 **미국 거래소에 상장된 보통주·ETF 전부**를 네트워크 없이 이름으로 찾는다.

**출처는 나스닥 트레이더의 종목 디렉터리다** (`nasdaqlisted.txt` · `otherlisted.txt`).
나스닥이 모든 미국 거래소(NYSE·NYSE Arca·Cboe…) 종목을 매일 정리해 내는 공식 파일이고,
키가 없고, **ETF 인지를 칸으로 알려준다** — 이 앱에서 가장 많이 담는 것이 ETF 다.

안 되면 SEC 의 상장사 목록(`company_tickers_exchange.json`)으로 물러선다. 재무(3b-1)가 이미
쓰는 서버라 서버에서 통하는 것을 안다. 다만 **회사만 있고 ETF 가 없다** — 그래서 두 번째다.

거르는 것: 시험 종목, 워런트·유닛·권리, 우선주·채권. 담아도 시세가 이상하거나(워런트)
이 앱이 다루는 물건이 아니다. 이름에서 " - Common Stock" 같은 꼬리를 떼고 클래스(Class A)는
남긴다 — 알파벳 A 주와 C 주는 이름이 같으면 고를 수가 없다.
"""

from __future__ import annotations

import json
import logging
import re

logger = logging.getLogger(__name__)

NASDAQ_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"
OTHER_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"
SEC_EXCHANGE_URL = "https://www.sec.gov/files/company_tickers_exchange.json"

SOURCE_NASDAQ = "nasdaqtrader"
SOURCE_SEC = "sec"

# 이보다 적게 오면 받은 것이 아니라 **잘린 것**이다 (보통 1만 개 안팎). 그대로 저장하면
# 멀쩡한 목록을 반쪽으로 덮어쓰고, 검색에서 종목이 조용히 사라진다.
MIN_ROWS = 3000

# otherlisted.txt 의 거래소 칸
OTHER_EXCHANGES = {
    "A": "NYSE American",
    "N": "NYSE",
    "P": "NYSE Arca",
    "Z": "Cboe",
    "V": "IEX",
}

# SEC 목록에서 받는 거래소. OTC 는 뺀다 — 장외 종목은 야후 시세가 드문드문하다.
SEC_EXCHANGES = {"Nasdaq": "NASDAQ", "NYSE": "NYSE", "CBOE": "Cboe"}

# 야후가 쓰는 모양으로 바꾼 뒤의 티커 (AAPL, BRK-B)
_TICKER_RE = re.compile(r"^[A-Z]{1,5}(?:-[A-Z]{1,2})?$")

# 이 앱이 다루지 않는 증권. 이름으로 가린다 — 티커 끝 글자(W·U·R)로 가리면 멀쩡한 종목
# (예: 끝이 W 인 네 글자 티커)이 같이 빠진다.
_NOT_SHARES = re.compile(r"\b(?:warrants?|units?|rights?|preferred|notes? due|debentures?)\b", re.I)

# 이름 꼬리 — "Apple Inc. Common Stock" · "... Ordinary Shares" · "... American Depositary Shares ..."
_SHARE_TAIL = re.compile(
    r"\s+(?:class [a-z]\s+)?(?:common stock|capital stock|common shares?|ordinary shares?"
    r"|subordinate voting shares|shares of beneficial interest"
    r"|american depositary shares?|american depository shares?|depositary shares?|sponsored adr|adr)\b.*$",
    re.I,
)
# 꼬리 **맨 앞의** 클래스만 이 주식의 클래스다. ADR 꼬리의 "each representing four Class A
# Ordinary Shares" 는 기초 주식 이야기라 붙이면 이름이 틀린다.
_CLASS = re.compile(r"^\s*class ([a-z])\b", re.I)


class UsListingUnavailable(Exception):
    """목록을 받지 못했다. 내장 목록과 야후 검색으로 계속 되므로 치명적이지 않다."""


def clean_name(raw: str) -> str:
    """거래소 표기를 화면에 쓸 이름으로. 클래스는 남긴다.

    "Alphabet Inc. - Class C Capital Stock" -> "Alphabet Inc. Class C"
    "Agilent Technologies, Inc. Common Stock" -> "Agilent Technologies, Inc."
    "SPDR S&P 500 ETF Trust" -> 그대로
    """
    name = re.sub(r"\s+", " ", raw).strip()
    head, sep, tail = name.partition(" - ")
    if not sep:
        match = _SHARE_TAIL.search(name)
        if match is None:
            return name
        head, tail = name[: match.start()], name[match.start():]
    head = head.strip().rstrip(",").strip()
    if not head:
        return name
    klass = _CLASS.search(tail)
    return f"{head} Class {klass.group(1).upper()}" if klass else head


def yahoo_ticker(symbol: str) -> str | None:
    """거래소 표기를 야후가 쓰는 모양으로. 이 앱이 다룰 수 없는 모양이면 None.

    클래스 주식의 점을 하이픈으로 바꾼다 (BRK.B -> BRK-B). 우선주(`$`)나 그 밖의 기호가
    섞인 것은 버린다.
    """
    ticker = symbol.strip().upper().replace(".", "-")
    return ticker if _TICKER_RE.match(ticker) else None


def _is_share(name: str, etf: bool) -> bool:
    if etf:
        # ETF 이름에는 "Rights"·"Units"가 거의 없지만, 있더라도 ETF 칸이 더 확실하다
        return True
    if _NOT_SHARES.search(name):
        return False
    # "6.375% Series A Cumulative ..." — 우선주·채권 이름에 이율이 붙는다
    return "%" not in name


def parse_symbol_directory(text: str, fixed_exchange: str | None = None) -> list[dict]:
    """나스닥 트레이더 파일 하나를 [{code, name, exchange, instrument}] 로.

    `|` 로 나뉜 표이고 첫 줄이 머리글, 마지막 줄이 "File Creation Time: ..." 이다.
    칸 이름으로 찾는다 — 두 파일의 칸 순서가 다르고, 언제 바뀔지도 모른다.
    """
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        raise UsListingUnavailable("빈 파일")
    header = [cell.strip() for cell in lines[0].split("|")]

    def col(*names: str) -> int | None:
        for name in names:
            if name in header:
                return header.index(name)
        return None

    symbol_i = col("Symbol", "ACT Symbol")
    name_i = col("Security Name")
    if symbol_i is None or name_i is None:
        raise UsListingUnavailable(f"머리글이 예상과 다릅니다: {lines[0][:120]}")
    etf_i = col("ETF")
    test_i = col("Test Issue")
    exchange_i = col("Exchange")

    out: list[dict] = []
    for line in lines[1:]:
        cells = [cell.strip() for cell in line.split("|")]
        if cells[0].startswith("File Creation Time") or len(cells) <= max(symbol_i, name_i):
            continue
        if test_i is not None and len(cells) > test_i and cells[test_i] == "Y":
            continue
        etf = etf_i is not None and len(cells) > etf_i and cells[etf_i] == "Y"
        raw_name = cells[name_i]
        ticker = yahoo_ticker(cells[symbol_i])
        if ticker is None or not raw_name or not _is_share(raw_name, etf):
            continue
        exchange = fixed_exchange
        if exchange is None and exchange_i is not None and len(cells) > exchange_i:
            exchange = OTHER_EXCHANGES.get(cells[exchange_i], cells[exchange_i] or None)
        out.append({
            "code": ticker,
            "name": clean_name(raw_name),
            "exchange": exchange,
            "instrument": "ETF" if etf else "STOCK",
        })
    return out


def parse_sec_exchange(data: dict) -> list[dict]:
    """SEC `company_tickers_exchange.json` — {"fields": [...], "data": [[cik, name, ticker, exchange], ...]}."""
    try:
        fields = [str(f).lower() for f in data["fields"]]
        name_i, ticker_i, exchange_i = fields.index("name"), fields.index("ticker"), fields.index("exchange")
        rows = data["data"]
    except (KeyError, ValueError, TypeError) as exc:
        raise UsListingUnavailable(f"SEC 목록 모양이 예상과 다릅니다: {exc}") from exc

    out: list[dict] = []
    for row in rows:
        try:
            raw_name, symbol, exchange = row[name_i], row[ticker_i], row[exchange_i]
        except (IndexError, TypeError):
            continue
        if exchange not in SEC_EXCHANGES or not raw_name or not symbol:
            continue
        ticker = yahoo_ticker(str(symbol))
        if ticker is None or not _is_share(str(raw_name), False):
            continue
        out.append({
            "code": ticker,
            "name": clean_name(str(raw_name)),
            "exchange": SEC_EXCHANGES[exchange],
            "instrument": "STOCK",
        })
    return out


def _dedupe(rows: list[dict]) -> list[dict]:
    """같은 티커가 두 번 오면 앞엣것 — 나스닥 파일을 먼저 읽는다."""
    seen: dict[str, dict] = {}
    for row in rows:
        seen.setdefault(row["code"], row)
    return list(seen.values())


def _checked(rows: list[dict], source: str) -> list[dict]:
    rows = _dedupe(rows)
    if len(rows) < MIN_ROWS:
        raise UsListingUnavailable(f"{source}: {len(rows):,}종목만 왔습니다 — 잘린 목록으로 보고 버립니다")
    return rows


def fetch_nasdaq_trader(timeout: int = 30) -> list[dict]:
    import requests

    rows: list[dict] = []
    for url, exchange in ((NASDAQ_LISTED_URL, "NASDAQ"), (OTHER_LISTED_URL, None)):
        try:
            response = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=timeout)
        except requests.RequestException as exc:
            raise UsListingUnavailable(f"나스닥 트레이더에 닿지 못했습니다: {type(exc).__name__}") from exc
        if response.status_code != 200:
            raise UsListingUnavailable(f"나스닥 트레이더 HTTP {response.status_code} ({url.rsplit('/', 1)[-1]})")
        rows.extend(parse_symbol_directory(response.text, fixed_exchange=exchange))
    return _checked(rows, SOURCE_NASDAQ)


def fetch_sec(timeout: int = 30) -> list[dict]:
    from app.services.providers import sec

    try:
        response = sec._get(SEC_EXCHANGE_URL, timeout=timeout)
    except Exception as exc:
        # SecError 는 우리가 쓴 글이라 그대로 보여준다 ("SEC 에 연결하지 못했습니다 (ProxyError)")
        raise UsListingUnavailable(f"SEC 에 닿지 못했습니다: {exc}") from exc
    if response.status_code != 200:
        raise UsListingUnavailable(f"SEC HTTP {response.status_code}")
    try:
        data = response.json()
    except (ValueError, json.JSONDecodeError) as exc:
        raise UsListingUnavailable("SEC 목록이 JSON 이 아닙니다") from exc
    return _checked(parse_sec_exchange(data), SOURCE_SEC)


def fetch_all(timeout: int = 30) -> tuple[str, list[dict]]:
    """(출처, 목록). 나스닥 트레이더가 안 되면 SEC. 둘 다 안 되면 UsListingUnavailable."""
    try:
        return SOURCE_NASDAQ, fetch_nasdaq_trader(timeout=timeout)
    except UsListingUnavailable as first:
        logger.info("미국 상장목록: %s — SEC 목록으로 대신 받습니다 (ETF 제외)", first)
        try:
            return SOURCE_SEC, fetch_sec(timeout=timeout)
        except UsListingUnavailable as second:
            raise UsListingUnavailable(f"{first} / {second}") from second
