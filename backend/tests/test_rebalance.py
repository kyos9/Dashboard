import datetime as dt

import pytest

from app.markets import Market
from app.models import Holding, PortfolioSettings, PriceDaily, RebalancePeriod, SignalDaily, Stock
from app.services import rebalance
from app.services.trading_calendar import period_trading_bounds


def _make_stock(db, ticker, target_weight_pct, band=None, override=None, rebalance_period=RebalancePeriod.quarterly):
    stock = Stock(
        ticker=ticker,
        target_weight_pct=target_weight_pct,
        rebalance_band_pct=band,
        review_date_override=override,
        rebalance_period=rebalance_period,
    )
    db.add(stock)
    db.commit()
    return stock


def _set_price_and_holding(db, ticker, close, quantity):
    db.add(PriceDaily(ticker=ticker, date=dt.date.today(), open=close, high=close, low=close, close=close, volume=1))
    db.add(Holding(ticker=ticker, quantity=quantity))
    db.commit()


def test_actual_weight_computation(db_session):
    a = _make_stock(db_session, "AAA", target_weight_pct=50.0)
    b = _make_stock(db_session, "BBB", target_weight_pct=50.0)
    _set_price_and_holding(db_session, "AAA", close=100.0, quantity=3)  # value 300
    _set_price_and_holding(db_session, "BBB", close=100.0, quantity=1)  # value 100

    weights = rebalance.compute_actual_weights(db_session, [a, b])
    assert weights["AAA"] == 75.0
    assert weights["BBB"] == 25.0


def test_no_holdings_returns_zero_weights(db_session):
    a = _make_stock(db_session, "AAA", target_weight_pct=50.0)
    weights = rebalance.compute_actual_weights(db_session, [a])
    assert weights["AAA"] == 0.0


def test_band_overweight_triggers_sell_review():
    active, reasons = rebalance.compute_rebalance_signal(
        excess_pct=10.0, band_pct=5.0, today=dt.date(2024, 1, 1), review_date=dt.date(2024, 12, 31)
    )
    assert active is True
    assert "밴드 초과(매도 검토)" in reasons


def test_band_underweight_triggers_buy_review():
    active, reasons = rebalance.compute_rebalance_signal(
        excess_pct=-10.0, band_pct=5.0, today=dt.date(2024, 1, 1), review_date=dt.date(2024, 12, 31)
    )
    assert active is True
    assert "밴드 미달(매수 검토)" in reasons


def test_within_band_and_before_review_no_signal():
    active, reasons = rebalance.compute_rebalance_signal(
        excess_pct=2.0, band_pct=5.0, today=dt.date(2024, 1, 1), review_date=dt.date(2024, 12, 31)
    )
    assert active is False
    assert reasons == []


def test_review_date_reached_triggers_signal_even_within_band():
    active, reasons = rebalance.compute_rebalance_signal(
        excess_pct=1.0, band_pct=5.0, today=dt.date(2024, 12, 31), review_date=dt.date(2024, 12, 31)
    )
    assert active is True
    assert "정기 리뷰 도래" in reasons


def test_review_date_override_takes_precedence(db_session):
    override_date = dt.date(2099, 1, 15)
    stock = _make_stock(db_session, "AAA", target_weight_pct=50.0, override=override_date)
    result = rebalance.next_review_date(stock, dt.date.today())
    assert result == override_date


def test_review_date_auto_computed_when_no_override(db_session):
    stock = _make_stock(db_session, "AAA", target_weight_pct=50.0)
    today = dt.date.today()
    expected_start, expected_end = period_trading_bounds(today, "quarterly")
    result = rebalance.next_review_date(stock, today)
    assert result == expected_end


def test_band_falls_back_to_global_default(db_session):
    db_session.add(PortfolioSettings(id=1, default_rebalance_band_pct=7.5))
    db_session.commit()
    stock = _make_stock(db_session, "AAA", target_weight_pct=50.0, band=None)
    default_band = rebalance.get_default_band_pct(db_session)
    assert rebalance.band_for_stock(stock, default_band) == 7.5


def test_band_uses_per_stock_override_when_set(db_session):
    db_session.add(PortfolioSettings(id=1, default_rebalance_band_pct=7.5))
    stock = _make_stock(db_session, "AAA", target_weight_pct=50.0, band=2.0)
    assert rebalance.band_for_stock(stock, 7.5) == 2.0


def test_shoulder_signal_detection_within_period(db_session):
    stock = _make_stock(db_session, "AAA", target_weight_pct=50.0)
    today = dt.date.today()
    start, end = period_trading_bounds(today, "quarterly")
    db_session.add(SignalDaily(ticker="AAA", date=start, knee_buy_v2=False, shoulder_sell_ref=True))
    db_session.commit()
    assert rebalance.shoulder_fired_in_current_period(db_session, stock, today) is True


def test_shoulder_signal_false_when_not_fired(db_session):
    stock = _make_stock(db_session, "AAA", target_weight_pct=50.0)
    today = dt.date.today()
    assert rebalance.shoulder_fired_in_current_period(db_session, stock, today) is False


def test_mixed_currency_weights_are_converted_to_base(db_session):
    """원화 종목과 달러 종목을 환산 없이 더하면 비중이 완전히 틀어진다.

    삼성전자 800,000원 + VOO 1,000달러(= 1,300,000원, 환율 1300) = 2,100,000원.
    환산을 빠뜨리면 800,000 대 1,000이 되어 삼성전자가 99.9%로 잡힌다.
    """
    db_session.add(PortfolioSettings(id=1, base_currency="KRW", usd_krw_override=1300.0))
    db_session.commit()

    kr = _make_stock(db_session, "005930.KS", target_weight_pct=40.0)
    us = _make_stock(db_session, "VOO", target_weight_pct=60.0)
    _set_price_and_holding(db_session, "005930.KS", close=80_000.0, quantity=10)  # 800,000원
    _set_price_and_holding(db_session, "VOO", close=500.0, quantity=2)  # 1,000달러

    weights = rebalance.compute_actual_weights(db_session, [kr, us])
    assert weights["005930.KS"] == pytest.approx(800_000 / 2_100_000 * 100)
    assert weights["VOO"] == pytest.approx(1_300_000 / 2_100_000 * 100)
    assert weights["005930.KS"] + weights["VOO"] == pytest.approx(100.0)


def test_rows_keep_native_currency_amounts_alongside_converted(db_session):
    """주문은 현지 통화로 내야 하므로 평가금액은 양쪽 다 필요하다."""
    db_session.add(PortfolioSettings(id=1, base_currency="KRW", usd_krw_override=1300.0))
    db_session.commit()
    _make_stock(db_session, "VOO", target_weight_pct=100.0)
    _set_price_and_holding(db_session, "VOO", close=500.0, quantity=2)

    result = rebalance.compute_rebalance_current(db_session)
    row = result["rows"][0]
    assert row["currency"] == "USD"
    assert row["current_value"] == pytest.approx(1_000.0)  # 달러 그대로
    assert row["current_value_base"] == pytest.approx(1_300_000.0)  # 원화 환산
    assert result["base_currency"] == "KRW"
    assert result["fx"]["source"] == "override"


def test_base_currency_usd_converts_the_other_way(db_session):
    db_session.add(PortfolioSettings(id=1, base_currency="USD", usd_krw_override=1300.0))
    db_session.commit()
    _make_stock(db_session, "005930.KS", target_weight_pct=100.0)
    _set_price_and_holding(db_session, "005930.KS", close=65_000.0, quantity=2)  # 130,000원

    result = rebalance.compute_rebalance_current(db_session)
    row = result["rows"][0]
    assert row["current_value"] == pytest.approx(130_000.0)
    assert row["current_value_base"] == pytest.approx(100.0)  # 130,000 / 1300


def test_korean_review_date_uses_korean_trading_calendar(db_session):
    """국내 종목의 분기 마감일은 한국 거래일이어야 한다 (12/31은 한국 휴장)."""
    stock = _make_stock(db_session, "005930.KS", target_weight_pct=50.0)
    review = rebalance.next_review_date(stock, dt.date(2025, 11, 10))

    expected_start, expected_end = period_trading_bounds(
        dt.date(2025, 11, 10), "quarterly", Market.KR
    )
    assert review == expected_end
    # 한국거래소는 연말 마지막 영업일이 휴장이라 12/31이 될 수 없다
    assert review != dt.date(2025, 12, 31)


def test_compute_rebalance_current_end_to_end(db_session):
    _make_stock(db_session, "AAA", target_weight_pct=50.0, band=1.0)
    _set_price_and_holding(db_session, "AAA", close=100.0, quantity=10)
    result = rebalance.compute_rebalance_current(db_session)
    assert len(result["rows"]) == 1
    row = result["rows"][0]
    assert row["ticker"] == "AAA"
    assert row["actual_weight_pct"] == 100.0
    assert row["excess_pct"] == 50.0
    assert row["rebalance_signal"]["active"] is True
