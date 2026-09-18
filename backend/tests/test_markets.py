"""시장/통화 판별 + 번들 시드 데이터 무결성."""

import json

import pytest

from app.markets import (
    Board,
    Currency,
    Market,
    board_of,
    build_krx_ticker,
    currency_of,
    currency_of_stock,
    is_krx_ticker,
    is_tse_ticker,
    krx_code,
    market_of,
    market_of_stock,
    parse_krx_ticker,
    parse_tse_ticker,
)
from app.services.symbols import SEED_PATH


@pytest.mark.parametrize(
    "ticker,market,currency",
    [
        ("VOO", Market.US, Currency.USD),
        ("NVDA", Market.US, Currency.USD),
        ("BRK-B", Market.US, Currency.USD),
        ("^GSPC", Market.US, Currency.USD),
        ("005930.KS", Market.KR, Currency.KRW),
        ("247540.KQ", Market.KR, Currency.KRW),
        ("005930.ks", Market.KR, Currency.KRW),  # 소문자 접미사도 한국 종목
        ("7203.T", Market.JP, Currency.JPY),  # 도요타
        ("7203.t", Market.JP, Currency.JPY),
        ("130A.T", Market.JP, Currency.JPY),  # 2024년부터 나온 영문 섞인 코드
    ],
)
def test_market_and_currency_from_ticker(ticker, market, currency):
    assert market_of(ticker) == market
    assert currency_of(ticker) == currency


def test_tse_helpers():
    assert parse_tse_ticker("7203.T") == "7203"
    assert parse_tse_ticker("130a.t") == "130A"
    assert is_tse_ticker("7203.T") is True

    # 미국 티커에 우연히 걸리면 안 된다 — 세 글자 이하이거나 접미사가 다르다
    assert parse_tse_ticker("T") is None
    assert parse_tse_ticker("AT.T") is None
    assert parse_tse_ticker("005930.KS") is None
    assert is_tse_ticker("VOO") is False


def test_parse_krx_ticker():
    assert parse_krx_ticker("005930.KS") == ("005930", Board.KOSPI)
    assert parse_krx_ticker("247540.KQ") == ("247540", Board.KOSDAQ)
    assert parse_krx_ticker("VOO") is None
    # 6자리가 아니면 한국 티커로 보지 않는다
    assert parse_krx_ticker("5930.KS") is None


def test_krx_helpers():
    assert is_krx_ticker("005930.KS") is True
    assert is_krx_ticker("VOO") is False
    assert krx_code("005930.KS") == "005930"
    assert krx_code("VOO") is None
    assert board_of("247540.KQ") == Board.KOSDAQ
    assert build_krx_ticker("005930", Board.KOSPI) == "005930.KS"


class _Stock:
    def __init__(self, ticker, market=None, currency=None):
        self.ticker = ticker
        self.market = market
        self.currency = currency


def test_stock_market_falls_back_to_ticker_when_column_is_stale():
    """옛 DB에서 올라온 행은 market 값이 비어 있거나 틀릴 수 있다 — 티커가 정답이다."""
    assert market_of_stock(_Stock("005930.KS", market=None)) == Market.KR
    assert currency_of_stock(_Stock("005930.KS", currency=None)) == Currency.KRW
    assert market_of_stock(_Stock("005930.KS", market="쓰레기값")) == Market.KR
    # 저장값이 멀쩡하면 그대로 쓴다
    assert market_of_stock(_Stock("VOO", market="US")) == Market.US


# ── 번들 시드 무결성 ─────────────────────────────────────────────────
# 손으로 적은 데이터라 형식이 깨지면 엉뚱한 종목이 등록될 수 있다.

def test_seed_entries_are_well_formed():
    entries = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    assert len(entries) > 50

    codes = set()
    for entry in entries:
        code = entry["code"]
        assert code.isdigit() and len(code) == 6, f"잘못된 종목코드: {entry}"
        assert code not in codes, f"종목코드 중복: {code}"
        codes.add(code)

        assert entry["name"].strip(), f"이름이 비었다: {entry}"
        assert entry["board"] in {b.value for b in Board}, f"알 수 없는 시장: {entry}"
        assert isinstance(entry.get("aliases", []), list)


def test_seed_names_are_unique_per_board():
    """같은 시장에 같은 이름이 둘이면 사용자가 어느 쪽인지 고를 수 없다."""
    entries = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    seen: set[tuple[str, str]] = set()
    for entry in entries:
        key = (entry["name"].strip().lower(), entry["board"])
        assert key not in seen, f"이름 중복: {entry['name']}"
        seen.add(key)
