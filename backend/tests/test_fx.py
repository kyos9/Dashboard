"""환율 적용 순서와 통화 환산.

환율이 틀리면 비중이 **조용히** 틀어지므로, "지금 어떤 환율을 왜 쓰고 있는지"가 항상
드러나야 한다 (`Quote.source`).

통화별로 값을 따로 들고 있으므로, 달러에서 되던 것이 엔에서도 되는지 같이 본다 —
한쪽만 되면 엔화 종목의 비중만 틀어지고, 그건 알아채기 어렵다.
"""

import datetime as dt

import pytest

from app.markets import Currency
from app.models import FxRate
from app.services import fx
from tests.factories import make_settings


def store(db, currency: Currency, rate: float, updated_at: dt.datetime | None = None) -> None:
    db.add(
        FxRate(
            currency=currency.value,
            krw_rate=rate,
            source="fetched",
            updated_at=updated_at or dt.datetime.utcnow(),
        )
    )
    db.commit()


def override(db, **by_code: float) -> None:
    make_settings(db, fx_overrides=dict(by_code))


# ── 적용 순서 ────────────────────────────────────────────────────────


def test_falls_back_when_nothing_is_known(db_session):
    rates = fx.get_rates(db_session)
    assert rates.krw_rate(Currency.USD) == fx.FALLBACK_KRW[Currency.USD]
    assert rates.krw_rate(Currency.JPY) == fx.FALLBACK_KRW[Currency.JPY]
    assert rates.quote(Currency.USD).source == "fallback"
    # 폴백이라는 사실이 화면까지 올라가야 한다
    assert rates.is_estimate is True


def test_stored_rate_beats_fallback(db_session):
    store(db_session, Currency.USD, 1400.0)
    store(db_session, Currency.JPY, 9.4)

    rates = fx.get_rates(db_session)
    assert rates.krw_rate(Currency.USD) == 1400.0
    assert rates.krw_rate(Currency.JPY) == 9.4
    assert rates.quote(Currency.JPY).source == "stored"
    assert rates.is_estimate is False


def test_manual_override_beats_everything(db_session):
    store(db_session, Currency.USD, 1400.0)
    override(db_session, USD=1300.0)

    rates = fx.get_rates(db_session)
    assert rates.krw_rate(Currency.USD) == 1300.0
    assert rates.quote(Currency.USD).source == "override"


def test_one_currency_can_be_manual_while_the_other_is_automatic(db_session):
    """엔만 직접 넣고 달러는 자동으로 두는 것이 가능해야 한다."""
    store(db_session, Currency.USD, 1400.0)
    override(db_session, JPY=9.9)

    rates = fx.get_rates(db_session)
    assert rates.quote(Currency.USD).source == "stored"
    assert rates.quote(Currency.JPY).source == "override"
    assert rates.krw_rate(Currency.JPY) == 9.9


def test_a_currency_with_no_rate_still_leaves_the_others_alone(db_session):
    store(db_session, Currency.USD, 1400.0)

    rates = fx.get_rates(db_session)
    assert rates.quote(Currency.USD).source == "stored"
    assert rates.quote(Currency.JPY).source == "fallback"
    # 하나라도 추정치면 화면에 알린다
    assert rates.is_estimate is True


# ── 갱신 ─────────────────────────────────────────────────────────────


def test_refresh_does_not_overwrite_manual_override(db_session, monkeypatch):
    """사용자가 직접 넣은 환율을 자동 조회가 덮어쓰면 안 된다."""
    override(db_session, USD=1300.0)
    monkeypatch.setattr(fx, "fetch_krw_rate", lambda currency, timeout=15: 9999.0)

    rates = fx.refresh_rates(db_session, force=True)
    assert rates.krw_rate(Currency.USD) == 1300.0
    assert rates.quote(Currency.USD).source == "override"
    # 엔은 직접 넣지 않았으니 조회값이 들어온다
    assert rates.quote(Currency.JPY).source == "stored"


def test_refresh_stores_fetched_rate(db_session, monkeypatch):
    monkeypatch.setattr(
        fx, "fetch_krw_rate", lambda currency, timeout=15: 1387.5 if currency is Currency.USD else 9.3
    )

    rates = fx.refresh_rates(db_session, force=True)
    assert rates.krw_rate(Currency.USD) == 1387.5
    assert rates.krw_rate(Currency.JPY) == 9.3

    # 다음 조회부터는 저장값으로 읽힌다 (네트워크 없이)
    assert fx.get_rates(db_session).krw_rate(Currency.USD) == 1387.5


def test_refresh_keeps_previous_rate_when_fetch_fails(db_session, monkeypatch):
    """조회 실패가 기존 환율을 날려선 안 된다."""
    store(db_session, Currency.USD, 1400.0)
    monkeypatch.setattr(fx, "fetch_krw_rate", lambda currency, timeout=15: None)

    rates = fx.refresh_rates(db_session, force=True)
    assert rates.krw_rate(Currency.USD) == 1400.0
    assert rates.quote(Currency.USD).source == "stored"


def test_a_fresh_rate_is_not_refetched(db_session, monkeypatch):
    store(db_session, Currency.USD, 1400.0)
    store(db_session, Currency.JPY, 9.4)
    called = []

    def counting(currency, timeout=15):
        called.append(currency)
        return 1.0

    monkeypatch.setattr(fx, "fetch_krw_rate", counting)
    fx.refresh_rates(db_session)
    assert called == []


def test_setting_an_override_then_clearing_it(db_session):
    store(db_session, Currency.JPY, 9.4)

    fx.set_override(db_session, Currency.JPY, 10.0)
    assert fx.get_rates(db_session).quote(Currency.JPY).source == "override"

    fx.set_override(db_session, Currency.JPY, None)
    assert fx.get_rates(db_session).quote(Currency.JPY).source == "stored"


# ── 조회 구현 (네트워크는 가짜로) ────────────────────────────────────


def test_absurd_rates_are_rejected(monkeypatch):
    """단위가 잘못된 응답(1.38 같은)을 환율로 받아들이면 비중이 완전히 깨진다."""
    monkeypatch.setattr(fx, "_fetch_from_yahoo", lambda currency, timeout: 1.38)
    monkeypatch.setattr(fx, "_fetch_from_stooq", lambda currency, timeout: 1385.0)
    assert fx.fetch_krw_rate(Currency.USD) == 1385.0


def test_the_absurd_range_is_per_currency(monkeypatch):
    """1엔 = 1385원을 그대로 받으면 엔화 종목 평가금액이 150배가 된다."""
    monkeypatch.setattr(fx, "_fetch_from_yahoo", lambda currency, timeout: 1385.0)
    monkeypatch.setattr(fx, "_fetch_from_stooq", lambda currency, timeout: 9.3)
    assert fx.fetch_krw_rate(Currency.JPY) == 9.3


def test_stooq_is_used_when_yahoo_is_blocked(monkeypatch):
    monkeypatch.setattr(fx, "_fetch_from_yahoo", lambda currency, timeout: None)
    monkeypatch.setattr(fx, "_fetch_from_stooq", lambda currency, timeout: 1372.0)
    assert fx.fetch_krw_rate(Currency.USD) == 1372.0


def test_returns_none_when_every_source_is_blocked(monkeypatch):
    monkeypatch.setattr(fx, "_fetch_from_yahoo", lambda currency, timeout: None)
    monkeypatch.setattr(fx, "_fetch_from_stooq", lambda currency, timeout: None)
    assert fx.fetch_krw_rate(Currency.USD) is None


def test_yahoo_fetcher_asks_for_the_right_symbol(monkeypatch):
    import pandas as pd
    import yfinance

    seen = {}

    class _Ticker:
        def __init__(self, symbol):
            seen["symbol"] = symbol

        def history(self, **kwargs):
            return pd.DataFrame({"Close": [9.2, 9.35]})

    monkeypatch.setattr(yfinance, "Ticker", _Ticker)
    assert fx._fetch_from_yahoo(Currency.JPY, 10) == pytest.approx(9.35)
    assert seen["symbol"] == "JPYKRW=X"


def test_yahoo_fetcher_survives_blocked_network(monkeypatch):
    import yfinance

    def blocked(symbol):
        raise ConnectionError("CONNECT tunnel failed, 403")

    monkeypatch.setattr(yfinance, "Ticker", blocked)
    assert fx._fetch_from_yahoo(Currency.USD, 10) is None


def test_stooq_fetcher_parses_csv(monkeypatch):
    import requests

    class _Response:
        status_code = 200
        text = "Date,Open,High,Low,Close,Volume\n2026-09-15,1379,1384,1377,1381.20,0\n"

    monkeypatch.setattr(requests, "get", lambda *a, **k: _Response())
    assert fx._fetch_from_stooq(Currency.USD, 10) == pytest.approx(1381.20)


def test_stooq_fetcher_rejects_non_csv_response(monkeypatch):
    """점검 페이지(HTML)를 환율로 읽어들이면 안 된다."""
    import requests

    class _Response:
        status_code = 200
        text = "<html>service unavailable</html>"

    monkeypatch.setattr(requests, "get", lambda *a, **k: _Response())
    assert fx._fetch_from_stooq(Currency.USD, 10) is None


# ── 환산 ─────────────────────────────────────────────────────────────


def rates(**by_code: float) -> fx.FxRates:
    return fx.FxRates(
        {
            Currency(code): fx.Quote(Currency(code), rate, "stored")
            for code, rate in by_code.items()
        }
    )


def test_convert_same_currency_is_identity():
    assert fx.convert(500.0, Currency.USD, Currency.USD, rates(USD=1300.0)) == 500.0


def test_convert_usd_to_krw():
    assert fx.convert(2.0, Currency.USD, Currency.KRW, rates(USD=1300.0)) == pytest.approx(2600.0)


def test_convert_krw_to_usd():
    assert fx.convert(2600.0, Currency.KRW, Currency.USD, rates(USD=1300.0)) == pytest.approx(2.0)


def test_convert_jpy_to_krw():
    assert fx.convert(10000.0, Currency.JPY, Currency.KRW, rates(JPY=9.3)) == pytest.approx(93000.0)


def test_convert_between_two_foreign_currencies_goes_through_krw():
    """엔↔달러 환율을 따로 들고 있지 않아도 환산은 돼야 한다."""
    r = rates(USD=1300.0, JPY=9.1)
    assert fx.convert(13000.0, Currency.JPY, Currency.USD, r) == pytest.approx(91.0)


def test_base_currency_defaults_to_krw(db_session):
    assert fx.base_currency(db_session) == Currency.KRW
