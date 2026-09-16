"""국내주식 시세 제공자(네이버) 파싱 및 폴백 동작. 실제 네트워크는 쓰지 않는다."""

import datetime as dt

import pytest

from app.services import providers
from app.services.providers.base import EmptyData, ProviderUnavailable, TickerNotFound
from app.services.providers.naver import NaverProvider

# 네이버가 실제로 내려주는 모양 — JSON이 아니라 작은따옴표를 쓰는 파이썬 리터럴이다
NAVER_PAYLOAD = """[['날짜', '시가', '고가', '저가', '종가', '거래량', '외국인소진율'],
['20260910', 79600, 79800, 78200, 79600, 17142523, 54.16],
['20260911', 79700, 80500, 79500, 80300, 12045110, 54.21],
['20260912', 80300, 81000, 80000, 80900, 9887654, 54.30]]
"""


def test_supports_only_korean_tickers():
    provider = NaverProvider()
    assert provider.supports("005930.KS") is True
    assert provider.supports("247540.KQ") is True
    assert provider.supports("VOO") is False


def test_parses_payload_into_common_shape():
    df = NaverProvider().parse_payload(NAVER_PAYLOAD, "005930.KS")

    assert list(df.columns) == ["open", "high", "low", "close", "adj_close", "volume"]
    assert df.index.name == "date"
    assert isinstance(df.index[0], dt.date)
    assert len(df) == 3
    assert df.index[0] == dt.date(2026, 9, 10)
    assert df["close"].iloc[-1] == pytest.approx(80900)
    assert df["volume"].iloc[0] == pytest.approx(17142523)
    # 배당 조정 종가를 따로 주지 않으므로 종가로 채운다
    assert df["adj_close"].iloc[-1] == pytest.approx(80900)


def test_header_only_payload_means_unknown_code():
    """없는 종목코드는 헤더만 돌아온다 — 네트워크 문제가 아니라 코드 문제로 분류해야 한다."""
    payload = "[['날짜', '시가', '고가', '저가', '종가', '거래량', '외국인소진율']]"
    with pytest.raises(TickerNotFound):
        NaverProvider().parse_payload(payload, "999999.KS")


def test_empty_response_is_empty_data():
    with pytest.raises(EmptyData):
        NaverProvider().parse_payload("   ", "005930.KS")


def test_html_error_page_is_provider_problem():
    """점검 페이지가 오면 티커 오타로 오해시키지 말고 제공자 문제로 분류한다."""
    with pytest.raises(ProviderUnavailable):
        NaverProvider().parse_payload("<html>서비스 점검 중</html>", "005930.KS")


def test_malformed_payload_is_provider_problem():
    with pytest.raises(ProviderUnavailable):
        NaverProvider().parse_payload("[[이건 파싱이 안 되는 내용", "005930.KS")


def test_missing_columns_are_reported():
    payload = "[['날짜', '종가'], ['20260910', 79600]]"
    with pytest.raises(ProviderUnavailable) as excinfo:
        NaverProvider().parse_payload(payload, "005930.KS")
    assert "컬럼 누락" in str(excinfo.value)


def test_fetch_builds_expected_request(monkeypatch):
    """종목코드만 보내야 한다 (.KS 접미사를 그대로 보내면 404)."""
    captured = {}

    class _Response:
        status_code = 200
        text = NAVER_PAYLOAD

    def fake_get(url, params=None, headers=None, timeout=None):
        captured["url"] = url
        captured["params"] = params
        return _Response()

    import requests

    monkeypatch.setattr(requests, "get", fake_get)

    df = NaverProvider().fetch("005930.KS", "1y")
    assert len(df) == 3
    assert captured["params"]["symbol"] == "005930"
    assert captured["params"]["timeframe"] == "day"
    # 기간이 지정되면 시작일이 들어간다
    assert len(captured["params"]["startTime"]) == 8


def test_korean_stock_falls_back_to_yahoo_when_naver_is_blocked(monkeypatch):
    """네이버가 막혀도 야후가 열려 있으면 국내주식을 받을 수 있어야 한다."""
    import pandas as pd

    frame = pd.DataFrame(
        {"open": [1.0], "high": [1.0], "low": [1.0], "close": [1.0], "adj_close": [1.0], "volume": [1.0]},
        index=pd.Index([dt.date(2026, 9, 12)], name="date"),
    )

    class _Provider:
        def __init__(self, name, error=None, result=None):
            self.name = name
            self._error = error
            self._result = result

        def supports(self, ticker):
            return True

        def fetch(self, ticker, period):
            if self._error:
                raise self._error
            return self._result

    monkeypatch.setattr(
        providers,
        "build_providers",
        lambda ticker: [
            _Provider("naver", error=ProviderUnavailable("naver", "연결 거부")),
            _Provider("yahoo", result=frame),
        ],
    )

    assert len(providers.fetch_price_history("005930.KS", "2y")) == 1
