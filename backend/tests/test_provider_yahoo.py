"""야후 제공자의 조회·재시도·실패 분류.

이 경로가 사용자가 실제로 마주치는 에러 메시지를 만든다. 원인을 잘못 분류하면
"티커 오타"와 "네트워크 차단"을 구분할 수 없어 사용자가 고칠 방법이 없어진다.

실제 네트워크는 쓰지 않는다 — yfinance의 Ticker를 가짜로 바꿔 끼운다.
"""

import datetime as dt

import pandas as pd
import pytest
import yfinance

from app.services.providers.base import EmptyData, ProviderUnavailable, TickerNotFound
from app.services.providers.yahoo import YahooProvider


def _raw_frame():
    """yfinance가 돌려주는 모양 (컬럼 첫 글자 대문자, DatetimeIndex)."""
    return pd.DataFrame(
        {
            "Open": [520.1, 521.9],
            "High": [522.4, 524.0],
            "Low": [519.0, 520.5],
            "Close": [521.9, 523.1],
            "Adj Close": [521.9, 523.1],
            "Volume": [4_200_000, 3_900_000],
        },
        index=pd.to_datetime(["2026-09-10", "2026-09-11"]),
    )


class _FakeTicker:
    """호출 인자를 기록하고 정해진 결과/예외를 돌려주는 가짜 Ticker."""

    calls: list[dict] = []
    results: list = []

    def __init__(self, ticker):
        self.ticker = ticker

    def history(self, **kwargs):
        _FakeTicker.calls.append({"ticker": self.ticker, **kwargs})
        outcome = _FakeTicker.results.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


@pytest.fixture()
def fake_yf(monkeypatch):
    _FakeTicker.calls = []
    _FakeTicker.results = []
    monkeypatch.setattr(yfinance, "Ticker", _FakeTicker)
    return _FakeTicker


# 재시도 대기 때문에 테스트가 느려지지 않도록 0으로 둔다
def _provider(**kwargs):
    kwargs.setdefault("retry_wait", 0)
    return YahooProvider(**kwargs)


def test_successful_fetch_normalizes_frame(fake_yf):
    fake_yf.results = [_raw_frame()]

    df = _provider().fetch("VOO", "1y")

    assert list(df.columns) == ["open", "high", "low", "close", "adj_close", "volume"]
    assert df.index.name == "date"
    assert isinstance(df.index[0], dt.date)
    assert df["close"].iloc[-1] == pytest.approx(523.1)


def test_request_uses_unadjusted_close_and_raises_errors(fake_yf):
    """스펙 정합성과 진단 가능성이 이 두 인자에 달려 있다.

    - auto_adjust=False: 배당 재투자 조정을 하지 않은 종가를 써야 백테스트와 맞는다
    - raise_errors=True: 이게 없으면 실패해도 빈 결과만 돌아와 원인을 알 수 없다
    """
    fake_yf.results = [_raw_frame()]
    _provider().fetch("005930.KS", "2y")

    call = fake_yf.calls[0]
    assert call["ticker"] == "005930.KS"
    assert call["auto_adjust"] is False
    assert call["raise_errors"] is True
    assert call["interval"] == "1d"
    assert call["period"] == "2y"


@pytest.mark.parametrize(
    "message",
    [
        "VOOO: No data found, symbol may be delisted",
        "$ZZZZ: possibly delisted; no price data found",
        "Symbol not found",
    ],
)
def test_unknown_ticker_is_classified_without_retry(fake_yf, message):
    """티커가 없는 건 재시도해도 소용없고, 네트워크 문제로 오해시켜서도 안 된다."""
    fake_yf.results = [Exception(message)]

    with pytest.raises(TickerNotFound):
        _provider().fetch("ZZZZ", "1y")

    assert len(fake_yf.calls) == 1  # 재시도하지 않았다


def test_network_failure_retries_then_reports_real_cause(fake_yf):
    fake_yf.results = [
        ConnectionError("CONNECT tunnel failed, response 403"),
        ConnectionError("CONNECT tunnel failed, response 403"),
        ConnectionError("CONNECT tunnel failed, response 403"),
    ]

    with pytest.raises(ProviderUnavailable) as excinfo:
        _provider(retries=2).fetch("VOO", "1y")

    assert len(fake_yf.calls) == 3  # 최초 1회 + 재시도 2회
    message = str(excinfo.value)
    # "데이터 없음"이 아니라 예외 종류와 내용이 그대로 올라와야 고칠 수 있다
    assert "ConnectionError" in message
    assert "403" in message


def test_transient_failure_recovers_on_retry(fake_yf):
    fake_yf.results = [TimeoutError("read timed out"), _raw_frame()]

    df = _provider(retries=2).fetch("VOO", "1y")

    assert len(df) == 2
    assert len(fake_yf.calls) == 2


def test_empty_response_is_not_retried(fake_yf):
    """빈 응답은 다시 물어봐도 같으므로 재시도 없이 바로 올린다."""
    fake_yf.results = [pd.DataFrame()]

    with pytest.raises(EmptyData):
        _provider(retries=2).fetch("VOO", "1y")

    assert len(fake_yf.calls) == 1


def test_supports_every_market():
    provider = _provider()
    assert provider.supports("VOO") is True
    assert provider.supports("005930.KS") is True
