"""시세 제공자 계층 테스트.

실제 네트워크는 쓰지 않는다. 대신 (a) 응답 파싱, (b) 실패 원인 분류, (c) 폴백 동작을
검증한다 — 야후가 막히는 환경에서 앱이 어떻게 행동해야 하는지가 핵심이다.
"""

import datetime as dt

import pandas as pd
import pytest

from app.markets import Market
from app.services import providers
from app.services.providers.base import (
    EmptyData,
    ProviderError,
    ProviderUnavailable,
    TickerNotFound,
    normalize_frame,
    period_start_date,
)
from app.services.providers.stooq import StooqProvider, to_stooq_symbol

STOOQ_CSV = """Date,Open,High,Low,Close,Volume
2026-09-10,520.10,522.40,519.00,521.90,4200000
2026-09-11,521.90,524.00,520.50,523.10,3900000
2026-09-12,523.00,523.80,518.20,519.40,5100000
"""


# ── Stooq 심볼 변환 ──────────────────────────────────────────────────

@pytest.mark.parametrize(
    "ticker,expected",
    [
        ("VOO", "voo.us"),
        ("voo", "voo.us"),
        ("  NVDA  ", "nvda.us"),
        ("BMW.DE", "bmw.de"),  # 접미사가 이미 있으면 그대로
        ("^SPX", "^spx"),  # 지수도 그대로
    ],
)
def test_to_stooq_symbol(ticker, expected):
    assert to_stooq_symbol(ticker) == expected


def test_stooq_does_not_claim_korean_tickers():
    provider = StooqProvider()
    assert provider.supports("VOO") is True
    assert provider.supports("005930.KS") is False
    assert provider.supports("247540.KQ") is False


# ── Stooq CSV 파싱 ───────────────────────────────────────────────────

def test_stooq_parses_csv_into_common_shape():
    df = StooqProvider().parse_csv(STOOQ_CSV, "VOO")

    assert list(df.columns) == ["open", "high", "low", "close", "adj_close", "volume"]
    assert df.index.name == "date"
    assert isinstance(df.index[0], dt.date)
    assert len(df) == 3
    assert df["close"].iloc[-1] == pytest.approx(519.40)
    # Adj Close를 안 주므로 종가로 채워져야 한다 (지표 계산에는 쓰지 않는 참고 필드)
    assert df["adj_close"].iloc[-1] == pytest.approx(519.40)


def test_stooq_fills_missing_volume_column():
    csv = "Date,Open,High,Low,Close\n2026-09-12,1,2,0.5,1.5\n"
    df = StooqProvider().parse_csv(csv, "VOO")
    assert df["volume"].iloc[0] == 0.0


def test_stooq_unknown_symbol_is_ticker_not_found():
    with pytest.raises(TickerNotFound):
        StooqProvider().parse_csv("No data", "ZZZZ")


def test_stooq_html_response_is_ticker_not_found():
    with pytest.raises(TickerNotFound):
        StooqProvider().parse_csv("<!DOCTYPE html><html>...", "ZZZZ")


def test_stooq_header_only_is_empty_data():
    with pytest.raises(EmptyData):
        StooqProvider().parse_csv("Date,Open,High,Low,Close,Volume\n", "VOO")


def test_stooq_garbage_response_is_provider_unavailable():
    with pytest.raises(ProviderUnavailable):
        StooqProvider().parse_csv("503 Service Unavailable", "VOO")


class _FakeResponse:
    def __init__(self, text, status_code=200):
        self.text = text
        self.status_code = status_code


def test_stooq_fetch_builds_request_and_returns_frame(monkeypatch):
    """HTTP 호출부까지 포함한 성공 경로 — 파라미터 구성과 결과 변환을 함께 본다."""
    captured = {}

    def fake_get(url, params=None, headers=None, timeout=None):
        captured.update(url=url, params=params, headers=headers, timeout=timeout)
        return _FakeResponse(STOOQ_CSV)

    import requests

    monkeypatch.setattr(requests, "get", fake_get)

    df = StooqProvider(timeout=17).fetch("VOO", "1y")

    assert captured["params"]["s"] == "voo.us"
    assert captured["params"]["i"] == "d"
    assert "d1" in captured["params"] and "d2" in captured["params"]  # 기간 조회
    assert captured["timeout"] == 17
    assert "Mozilla" in captured["headers"]["User-Agent"]  # 기본 UA는 거절당하곤 한다
    assert len(df) == 3


def test_stooq_fetch_max_period_omits_date_range(monkeypatch):
    captured = {}

    def fake_get(url, params=None, headers=None, timeout=None):
        captured.update(params=params)
        return _FakeResponse(STOOQ_CSV)

    import requests

    monkeypatch.setattr(requests, "get", fake_get)
    StooqProvider().fetch("VOO", "max")

    assert "d1" not in captured["params"]  # 전체 기간은 날짜 범위를 주지 않는다


def test_stooq_http_error_is_provider_unavailable(monkeypatch):
    import requests

    monkeypatch.setattr(
        requests, "get", lambda *a, **k: _FakeResponse("Service Unavailable", status_code=503)
    )
    with pytest.raises(ProviderUnavailable) as excinfo:
        StooqProvider().fetch("VOO", "1y")
    assert "503" in str(excinfo.value)


def test_stooq_network_exception_is_provider_unavailable(monkeypatch):
    import requests

    def boom(*args, **kwargs):
        raise OSError("Tunnel connection failed: 403 Forbidden")

    monkeypatch.setattr(requests, "get", boom)
    with pytest.raises(ProviderUnavailable) as excinfo:
        StooqProvider().fetch("VOO", "1y")
    # 원인이 메시지에 남아야 사용자가 방화벽 문제임을 알 수 있다
    assert "403" in str(excinfo.value)


# ── 공통 정규화 ──────────────────────────────────────────────────────

def test_normalize_drops_rows_without_close_and_sorts():
    raw = pd.DataFrame(
        {
            "Open": [1.0, 2.0, 3.0],
            "High": [1.0, 2.0, 3.0],
            "Low": [1.0, 2.0, 3.0],
            "Close": [1.0, None, 3.0],
            "Volume": [10, 20, 30],
        },
        index=pd.to_datetime(["2026-09-12", "2026-09-11", "2026-09-10"]),
    )
    df = normalize_frame(raw, "test", "VOO")
    assert len(df) == 2
    assert df.index[0] < df.index[1]  # 오름차순 정렬


def test_normalize_flattens_multiindex_columns():
    raw = pd.DataFrame(
        [[1.0, 1.0, 1.0, 1.0, 10]],
        index=pd.to_datetime(["2026-09-12"]),
        columns=pd.MultiIndex.from_tuples(
            [("Open", "VOO"), ("High", "VOO"), ("Low", "VOO"), ("Close", "VOO"), ("Volume", "VOO")]
        ),
    )
    df = normalize_frame(raw, "test", "VOO")
    assert list(df.columns) == ["open", "high", "low", "close", "adj_close", "volume"]


def test_normalize_missing_column_raises_with_detail():
    raw = pd.DataFrame({"Open": [1.0], "Close": [1.0]}, index=pd.to_datetime(["2026-09-12"]))
    with pytest.raises(ProviderError) as excinfo:
        normalize_frame(raw, "test", "VOO")
    assert "high" in str(excinfo.value)


def test_period_start_date():
    today = dt.date(2026, 9, 15)
    assert period_start_date("max", today) is None
    assert period_start_date("ytd", today) == dt.date(2026, 1, 1)
    assert period_start_date("1y", today) == dt.date(2025, 9, 14)


# ── 폴백 동작 ────────────────────────────────────────────────────────

class _FakeProvider:
    def __init__(self, name, result=None, error=None):
        self.name = name
        self._result = result
        self._error = error
        self.calls = 0

    def supports(self, ticker):
        return True

    def fetch(self, ticker, period):
        self.calls += 1
        if self._error:
            raise self._error
        return self._result


def _frame():
    return pd.DataFrame(
        {"open": [1.0], "high": [1.0], "low": [1.0], "close": [1.0], "adj_close": [1.0], "volume": [1.0]},
        index=pd.Index([dt.date(2026, 9, 12)], name="date"),
    )


def test_falls_back_to_second_provider_when_first_is_blocked(monkeypatch):
    """야후가 막혀도 Stooq로 조회되면 앱은 정상 동작해야 한다."""
    blocked = _FakeProvider("yahoo", error=ProviderUnavailable("yahoo", "CONNECT tunnel failed, 403"))
    working = _FakeProvider("stooq", result=_frame())
    monkeypatch.setattr(providers, "build_providers", lambda ticker, prefer=None: [blocked, working])

    df = providers.fetch_price_history("VOO", "6mo")
    assert len(df) == 1
    assert blocked.calls == 1 and working.calls == 1
    # 폴백으로 받았다는 사실이 저장까지 따라가야 한다 — 나중에 기준이 섞였는지 알 수 있게
    assert df.attrs["provider"] == "stooq"


def test_first_success_short_circuits(monkeypatch):
    first = _FakeProvider("yahoo", result=_frame())
    second = _FakeProvider("stooq", result=_frame())
    monkeypatch.setattr(providers, "build_providers", lambda ticker, prefer=None: [first, second])

    providers.fetch_price_history("VOO", "6mo")
    assert second.calls == 0


def test_all_failures_report_every_provider_reason(monkeypatch):
    """전부 실패하면 "데이터 없음"이 아니라 제공자별 실제 원인이 담겨야 한다."""
    monkeypatch.setattr(
        providers,
        "build_providers",
        lambda ticker, prefer=None: [
            _FakeProvider("yahoo", error=ProviderUnavailable("yahoo", "타임아웃")),
            _FakeProvider("stooq", error=ProviderUnavailable("stooq", "HTTP 503")),
        ],
    )

    with pytest.raises(providers.AllProvidersFailed) as excinfo:
        providers.fetch_price_history("VOO", "6mo")

    message = str(excinfo.value)
    assert "yahoo" in message and "타임아웃" in message
    assert "stooq" in message and "503" in message
    assert "네트워크" in excinfo.value.hint()


def test_hint_points_at_ticker_typo_when_all_say_not_found(monkeypatch):
    monkeypatch.setattr(
        providers,
        "build_providers",
        lambda ticker, prefer=None: [
            _FakeProvider("yahoo", error=TickerNotFound("yahoo", "없는 티커")),
            _FakeProvider("stooq", error=TickerNotFound("stooq", "없는 심볼")),
        ],
    )

    with pytest.raises(providers.AllProvidersFailed) as excinfo:
        providers.fetch_price_history("VOOO", "6mo")

    assert excinfo.value.looks_like_bad_ticker
    assert "철자" in excinfo.value.hint()


def test_provider_crash_does_not_block_next_provider(monkeypatch):
    """한 제공자 구현이 터져도 다음 제공자는 시도돼야 한다."""
    crashing = _FakeProvider("yahoo", error=RuntimeError("예상치 못한 버그"))
    working = _FakeProvider("stooq", result=_frame())
    monkeypatch.setattr(providers, "build_providers", lambda ticker, prefer=None: [crashing, working])

    assert len(providers.fetch_price_history("VOO", "6mo")) == 1


# ── 설정 ─────────────────────────────────────────────────────────────

def test_provider_order_is_configurable(monkeypatch):
    monkeypatch.setenv("SIGNAL_DASHBOARD_PROVIDERS", "stooq,yahoo")
    assert providers.configured_order(Market.US) == ["stooq", "yahoo"]


def test_unknown_provider_names_fall_back_to_default(monkeypatch):
    monkeypatch.setenv("SIGNAL_DASHBOARD_PROVIDERS", "bloomberg")
    assert providers.configured_order(Market.US) == providers.DEFAULT_ORDER[Market.US]


def test_market_specific_order_beats_common_setting(monkeypatch):
    """국내/해외 제공자를 따로 지정할 수 있어야 한다."""
    monkeypatch.setenv("SIGNAL_DASHBOARD_PROVIDERS", "stooq")
    monkeypatch.setenv("SIGNAL_DASHBOARD_PROVIDERS_KR", "yahoo,naver")
    assert providers.configured_order(Market.KR) == ["yahoo", "naver"]
    assert providers.configured_order(Market.US) == ["stooq"]


# ── 시장별 제공자 라우팅 ─────────────────────────────────────────────

def test_korean_ticker_skips_stooq_entirely(monkeypatch):
    """Stooq는 한국거래소를 다루지 않는다 — 시도조차 하지 않아야 한다.

    시도하면 "그런 심볼 없음"이 돌아오는데, 그게 실패 사유로 올라가면 사용자가
    종목코드 오타로 오해하게 된다.
    """
    monkeypatch.delenv("SIGNAL_DASHBOARD_PROVIDERS", raising=False)
    monkeypatch.delenv("SIGNAL_DASHBOARD_PROVIDERS_KR", raising=False)
    names = [p.name for p in providers.build_providers("005930.KS")]
    assert "stooq" not in names
    assert names == ["naver", "yahoo"]


def test_us_ticker_skips_naver(monkeypatch):
    monkeypatch.delenv("SIGNAL_DASHBOARD_PROVIDERS", raising=False)
    monkeypatch.delenv("SIGNAL_DASHBOARD_PROVIDERS_US", raising=False)
    names = [p.name for p in providers.build_providers("VOO")]
    assert names == ["yahoo", "stooq"]


def test_korean_ticker_hint_mentions_code_format(monkeypatch):
    monkeypatch.setattr(
        providers,
        "build_providers",
        lambda ticker, prefer=None: [_FakeProvider("naver", error=TickerNotFound("naver", "없는 종목코드"))],
    )
    with pytest.raises(providers.AllProvidersFailed) as excinfo:
        providers.fetch_price_history("999999.KS", "6mo")
    # 미국 티커 안내(VOO/QQQ)가 아니라 국내 종목 안내가 나와야 한다
    assert "종목명" in excinfo.value.hint()
    assert "VOO" not in excinfo.value.hint()
