"""환율 적용 순서와 통화 환산.

환율이 틀리면 비중이 조용히 틀어지므로, "지금 어떤 환율을 왜 쓰고 있는지"가 항상
드러나야 한다 (FxRate.source).
"""

import datetime as dt

import pytest

from app.markets import Currency
from app.models import PortfolioSettings
from app.services import fx


def test_falls_back_when_nothing_is_known(db_session):
    rate = fx.get_usd_krw(db_session)
    assert rate.usd_krw == fx.FALLBACK_USD_KRW
    assert rate.source == "fallback"
    # 폴백이라는 사실이 화면까지 올라가야 한다
    assert rate.is_estimate is True


def test_stored_rate_beats_fallback(db_session):
    db_session.add(
        PortfolioSettings(id=1, usd_krw_rate=1400.0, usd_krw_updated_at=dt.datetime.utcnow())
    )
    db_session.commit()

    rate = fx.get_usd_krw(db_session)
    assert rate.usd_krw == 1400.0
    assert rate.source == "stored"
    assert rate.is_estimate is False


def test_manual_override_beats_everything(db_session):
    db_session.add(PortfolioSettings(id=1, usd_krw_rate=1400.0, usd_krw_override=1300.0))
    db_session.commit()

    rate = fx.get_usd_krw(db_session)
    assert rate.usd_krw == 1300.0
    assert rate.source == "override"


def test_refresh_does_not_overwrite_manual_override(db_session, monkeypatch):
    """사용자가 직접 넣은 환율을 자동 조회가 덮어쓰면 안 된다."""
    db_session.add(PortfolioSettings(id=1, usd_krw_override=1300.0))
    db_session.commit()
    monkeypatch.setattr(fx, "fetch_usd_krw", lambda timeout=15: 9999.0)

    rate = fx.refresh_usd_krw(db_session, force=True)
    assert rate.usd_krw == 1300.0
    assert rate.source == "override"


def test_refresh_stores_fetched_rate(db_session, monkeypatch):
    monkeypatch.setattr(fx, "fetch_usd_krw", lambda timeout=15: 1387.5)

    rate = fx.refresh_usd_krw(db_session, force=True)
    assert rate.usd_krw == 1387.5
    assert rate.source == "fetched"
    # 다음 조회부터는 저장값으로 읽힌다
    assert fx.get_usd_krw(db_session).usd_krw == 1387.5


def test_refresh_keeps_previous_rate_when_fetch_fails(db_session, monkeypatch):
    """조회 실패가 기존 환율을 날려선 안 된다."""
    db_session.add(
        PortfolioSettings(id=1, usd_krw_rate=1400.0, usd_krw_updated_at=dt.datetime.utcnow())
    )
    db_session.commit()
    monkeypatch.setattr(fx, "fetch_usd_krw", lambda timeout=15: None)

    rate = fx.refresh_usd_krw(db_session, force=True)
    assert rate.usd_krw == 1400.0
    assert rate.source == "stored"


def test_absurd_rates_are_rejected(monkeypatch):
    """단위가 잘못된 응답(1.38 같은)을 환율로 받아들이면 비중이 완전히 깨진다."""
    monkeypatch.setattr(fx, "_fetch_from_yahoo", lambda timeout: 1.38)
    monkeypatch.setattr(fx, "_fetch_from_stooq", lambda timeout: 1385.0)
    assert fx.fetch_usd_krw() == 1385.0


def test_stooq_is_used_when_yahoo_is_blocked(monkeypatch):
    monkeypatch.setattr(fx, "_fetch_from_yahoo", lambda timeout: None)
    monkeypatch.setattr(fx, "_fetch_from_stooq", lambda timeout: 1372.0)
    assert fx.fetch_usd_krw() == 1372.0


def test_returns_none_when_every_source_is_blocked(monkeypatch):
    monkeypatch.setattr(fx, "_fetch_from_yahoo", lambda timeout: None)
    monkeypatch.setattr(fx, "_fetch_from_stooq", lambda timeout: None)
    assert fx.fetch_usd_krw() is None


# ── 조회 구현 (네트워크는 가짜로) ────────────────────────────────────

def test_yahoo_fetcher_reads_last_close(monkeypatch):
    import pandas as pd
    import yfinance

    class _Ticker:
        def __init__(self, symbol):
            assert symbol == "KRW=X"

        def history(self, **kwargs):
            return pd.DataFrame({"Close": [1380.0, 1385.5]})

    monkeypatch.setattr(yfinance, "Ticker", _Ticker)
    assert fx._fetch_from_yahoo(10) == pytest.approx(1385.5)


def test_yahoo_fetcher_survives_blocked_network(monkeypatch):
    import yfinance

    def blocked(symbol):
        raise ConnectionError("CONNECT tunnel failed, 403")

    monkeypatch.setattr(yfinance, "Ticker", blocked)
    assert fx._fetch_from_yahoo(10) is None


def test_stooq_fetcher_parses_csv(monkeypatch):
    import requests

    class _Response:
        status_code = 200
        text = "Date,Open,High,Low,Close,Volume\n2026-09-15,1379,1384,1377,1381.20,0\n"

    monkeypatch.setattr(requests, "get", lambda *a, **k: _Response())
    assert fx._fetch_from_stooq(10) == pytest.approx(1381.20)


def test_stooq_fetcher_rejects_non_csv_response(monkeypatch):
    """점검 페이지(HTML)를 환율로 읽어들이면 안 된다."""
    import requests

    class _Response:
        status_code = 200
        text = "<html>service unavailable</html>"

    monkeypatch.setattr(requests, "get", lambda *a, **k: _Response())
    assert fx._fetch_from_stooq(10) is None


# ── 환산 ─────────────────────────────────────────────────────────────

def test_convert_same_currency_is_identity():
    rate = fx.FxRate(1300.0, "stored")
    assert fx.convert(500.0, Currency.USD, Currency.USD, rate) == 500.0


def test_convert_usd_to_krw():
    rate = fx.FxRate(1300.0, "stored")
    assert fx.convert(2.0, Currency.USD, Currency.KRW, rate) == pytest.approx(2600.0)


def test_convert_krw_to_usd():
    rate = fx.FxRate(1300.0, "stored")
    assert fx.convert(2600.0, Currency.KRW, Currency.USD, rate) == pytest.approx(2.0)


def test_base_currency_defaults_to_krw(db_session):
    assert fx.base_currency(db_session) == Currency.KRW
