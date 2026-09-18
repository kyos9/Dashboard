"""거래소·통화 구분.

티커 접미사로 어느 시장 종목인지 판별한다. 야후 파이낸스 표기를 따른다 —
한국은 `005930.KS`(코스피) / `247540.KQ`(코스닥), 일본은 `7203.T`(도쿄).

통화를 구분하는 이유: 원화 종목과 달러 종목을 한 포트폴리오에 담으면 평가금액을
그냥 더할 수 없다. 비중 계산은 반드시 기준통화로 환산한 뒤 해야 한다
(`app.services.fx` 참고).

이 모듈은 어디에도 의존하지 않는다 — models.py와 services 양쪽에서 쓰이므로
순환 import를 만들지 않기 위해서다.
"""

from __future__ import annotations

import enum
import re


class Market(str, enum.Enum):
    US = "US"
    KR = "KR"
    JP = "JP"


class Currency(str, enum.Enum):
    USD = "USD"
    KRW = "KRW"
    JPY = "JPY"


class Board(str, enum.Enum):
    """한국거래소 세부 시장."""

    KOSPI = "KOSPI"
    KOSDAQ = "KOSDAQ"
    KONEX = "KONEX"


BOARD_SUFFIX: dict[Board, str] = {
    Board.KOSPI: ".KS",
    Board.KOSDAQ: ".KQ",
    Board.KONEX: ".KN",
}

SUFFIX_BOARD: dict[str, Board] = {suffix: board for board, suffix in BOARD_SUFFIX.items()}

# 사람에게 보여줄 이름 (진단 스크립트·로그)
MARKET_LABEL: dict[Market, str] = {
    Market.US: "미국",
    Market.KR: "국내",
    Market.JP: "일본",
}

CURRENCY_BY_MARKET: dict[Market, Currency] = {
    Market.US: Currency.USD,
    Market.KR: Currency.KRW,
    Market.JP: Currency.JPY,
}

# 화면 표기용 메타. `decimals`는 가격/금액을 몇 자리까지 보여줄지 —
# 원화는 소수점이 의미가 없고(1주 79,600원), 달러는 센트까지 본다.
CURRENCY_META: dict[Currency, dict] = {
    Currency.USD: {"symbol": "$", "code": "USD", "label": "미국 달러", "decimals": 2},
    Currency.KRW: {"symbol": "₩", "code": "KRW", "label": "원", "decimals": 0},
    # 엔도 소수점이 의미 없다 (1주 2,850엔). 원과 같은 이유로 0자리.
    Currency.JPY: {"symbol": "¥", "code": "JPY", "label": "일본 엔", "decimals": 0},
}

# 6자리 숫자 = 한국 종목코드 (접미사 없이 입력됐을 때는 시장을 모른다)
KRX_CODE_RE = re.compile(r"^\d{6}$")
KRX_TICKER_RE = re.compile(r"^(\d{6})\.(K[SQN])$", re.IGNORECASE)

# 도쿄증권거래소. 예전에는 네 자리 숫자뿐이었지만(`7203`=도요타), 2024년부터 마지막
# 자리에 영문이 붙는 코드도 나온다(`130A`). 그래서 마지막 한 자리만 열어둔다.
TSE_TICKER_RE = re.compile(r"^(\d{3}[0-9A-Z])\.T$", re.IGNORECASE)


def normalize_ticker(raw: str) -> str:
    """입력된 티커를 저장 형태로 맞춘다 (대문자, 공백 제거)."""
    return raw.strip().upper()


def parse_krx_ticker(ticker: str) -> tuple[str, Board] | None:
    """`005930.KS` -> ("005930", Board.KOSPI). 한국 티커가 아니면 None."""
    match = KRX_TICKER_RE.match(ticker.strip())
    if match is None:
        return None
    code, suffix = match.group(1), f".{match.group(2).upper()}"
    board = SUFFIX_BOARD.get(suffix)
    if board is None:
        return None
    return code, board


def is_krx_ticker(ticker: str) -> bool:
    return parse_krx_ticker(ticker) is not None


def krx_code(ticker: str) -> str | None:
    """한국 티커에서 6자리 종목코드만 뽑는다 (네이버 등 코드만 받는 제공자용)."""
    parsed = parse_krx_ticker(ticker)
    return parsed[0] if parsed else None


def parse_tse_ticker(ticker: str) -> str | None:
    """`7203.T` -> "7203". 일본 티커가 아니면 None."""
    match = TSE_TICKER_RE.match(ticker.strip())
    return match.group(1).upper() if match else None


def is_tse_ticker(ticker: str) -> bool:
    return parse_tse_ticker(ticker) is not None


def board_of(ticker: str) -> Board | None:
    parsed = parse_krx_ticker(ticker)
    return parsed[1] if parsed else None


def market_of(ticker: str) -> Market:
    """티커가 속한 시장. 아는 접미사가 없으면 미국으로 본다.

    (홍콩 `.HK` 등을 더 붙이려면 여기와 `CURRENCY_BY_MARKET`, `CURRENCY_META`,
    거래일 캘린더(`services/trading_calendar.py`), 제공자 순서
    (`services/providers/__init__.py`)를 늘리면 된다. 일본을 그렇게 붙였다.)
    """
    if is_krx_ticker(ticker):
        return Market.KR
    if is_tse_ticker(ticker):
        return Market.JP
    return Market.US


def currency_of(ticker: str) -> Currency:
    return CURRENCY_BY_MARKET[market_of(ticker)]


def build_krx_ticker(code: str, board: Board) -> str:
    return f"{code}{BOARD_SUFFIX[board]}"


def market_of_stock(stock) -> Market:
    """Stock 레코드의 시장.

    저장된 값을 쓰되, 비어 있거나 알 수 없는 값이면 티커에서 다시 판별한다 —
    티커가 언제나 정답이므로 옛 DB에서 올라온 행도 안전하게 다룰 수 있다.
    """
    raw = getattr(stock, "market", None)
    if raw:
        try:
            return Market(raw)
        except ValueError:
            pass
    return market_of(stock.ticker)


def currency_of_stock(stock) -> Currency:
    raw = getattr(stock, "currency", None)
    if raw:
        try:
            return Currency(raw)
        except ValueError:
            pass
    return currency_of(stock.ticker)


