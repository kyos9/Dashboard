import datetime as dt

import pytest

from app.markets import Currency, Market
from app.models import PriceDaily, RebalanceSnapshot, ReviewPeriod, SignalDaily
from app.services import rebalance
from app.services.users import LOCAL_USER_ID
from app.services.trading_calendar import period_trading_bounds
from tests.factories import make_holding, make_settings, make_stock


def _make_stock(db, ticker, target_weight_pct, band=None):
    return make_stock(db, ticker, target_weight_pct=target_weight_pct, rebalance_band_pct=band)


def _set_price_and_holding(db, ticker, close, quantity, avg_cost=None):
    db.add(PriceDaily(ticker=ticker, date=dt.date.today(), open=close, high=close, low=close, close=close, volume=1))
    make_holding(db, ticker, quantity, avg_cost=avg_cost)


def test_actual_weight_computation(db_session):
    a = _make_stock(db_session, "AAA", target_weight_pct=50.0)
    b = _make_stock(db_session, "BBB", target_weight_pct=50.0)
    _set_price_and_holding(db_session, "AAA", close=100.0, quantity=3)  # value 300
    _set_price_and_holding(db_session, "BBB", close=100.0, quantity=1)  # value 100

    weights = rebalance.compute_actual_weights(db_session, LOCAL_USER_ID, [a, b])
    assert weights["AAA"] == 75.0
    assert weights["BBB"] == 25.0


def test_no_holdings_returns_zero_weights(db_session):
    a = _make_stock(db_session, "AAA", target_weight_pct=50.0)
    weights = rebalance.compute_actual_weights(db_session, LOCAL_USER_ID, [a])
    assert weights["AAA"] == 0.0


def test_band_overweight_triggers_sell_review():
    active, reasons = rebalance.compute_rebalance_signal(
        excess_pct=10.0, band_pct=5.0, review_due=False
    )
    assert active is True
    assert "밴드 초과(매도 검토)" in reasons


def test_band_underweight_triggers_buy_review():
    active, reasons = rebalance.compute_rebalance_signal(
        excess_pct=-10.0, band_pct=5.0, review_due=False
    )
    assert active is True
    assert "밴드 미달(매수 검토)" in reasons


def test_within_band_and_before_review_no_signal():
    active, reasons = rebalance.compute_rebalance_signal(
        excess_pct=2.0, band_pct=5.0, review_due=False
    )
    assert active is False
    assert reasons == []


def test_review_date_reached_triggers_signal_even_within_band():
    active, reasons = rebalance.compute_rebalance_signal(
        excess_pct=1.0, band_pct=5.0, review_due=True
    )
    assert active is True
    assert "정기 리뷰 도래" in reasons


def test_band_falls_back_to_global_default(db_session):
    make_settings(db_session, default_rebalance_band_pct=7.5)
    stock = _make_stock(db_session, "AAA", target_weight_pct=50.0, band=None)
    default_band = rebalance.get_default_band_pct(db_session, LOCAL_USER_ID)
    assert rebalance.band_for_stock(stock, default_band) == 7.5


def test_band_uses_per_stock_override_when_set(db_session):
    make_settings(db_session, default_rebalance_band_pct=7.5)
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
    make_settings(db_session, base_currency="KRW", fx_overrides={"USD": 1300.0})

    kr = _make_stock(db_session, "005930.KS", target_weight_pct=40.0)
    us = _make_stock(db_session, "VOO", target_weight_pct=60.0)
    _set_price_and_holding(db_session, "005930.KS", close=80_000.0, quantity=10)  # 800,000원
    _set_price_and_holding(db_session, "VOO", close=500.0, quantity=2)  # 1,000달러

    weights = rebalance.compute_actual_weights(db_session, LOCAL_USER_ID, [kr, us])
    assert weights["005930.KS"] == pytest.approx(800_000 / 2_100_000 * 100)
    assert weights["VOO"] == pytest.approx(1_300_000 / 2_100_000 * 100)
    assert weights["005930.KS"] + weights["VOO"] == pytest.approx(100.0)


def test_three_currencies_add_up_to_a_hundred_percent(db_session):
    """원·달러·엔이 섞여도 비중 합은 100%여야 한다.

    엔은 자릿수가 원과 가까워(1엔 ≈ 9원) 환산을 빠뜨려도 값이 그럴듯해 보인다.
    달러처럼 1300배 어긋나지 않으니 **틀린 줄 모르고 쓰게 되는 쪽**이라 더 위험하다.
    """
    make_settings(db_session, base_currency="KRW", fx_overrides={"USD": 1300.0, "JPY": 9.0})

    kr = _make_stock(db_session, "005930.KS", target_weight_pct=40.0)
    us = _make_stock(db_session, "VOO", target_weight_pct=30.0)
    jp = _make_stock(db_session, "7203.T", target_weight_pct=30.0)
    _set_price_and_holding(db_session, "005930.KS", close=80_000.0, quantity=10)  # 800,000원
    _set_price_and_holding(db_session, "VOO", close=500.0, quantity=2)  # 1,300,000원
    _set_price_and_holding(db_session, "7203.T", close=3_000.0, quantity=100)  # 2,700,000원

    weights = rebalance.compute_actual_weights(db_session, LOCAL_USER_ID, [kr, us, jp])
    total = 800_000 + 1_300_000 + 2_700_000
    assert weights["7203.T"] == pytest.approx(2_700_000 / total * 100)
    assert sum(weights.values()) == pytest.approx(100.0)


def test_japanese_rows_keep_yen_amounts(db_session):
    """주문은 엔으로 내므로 평가금액은 엔 그대로도 있어야 한다."""
    make_settings(db_session, base_currency="KRW", fx_overrides={"JPY": 9.0})
    _make_stock(db_session, "7203.T", target_weight_pct=100.0)
    _set_price_and_holding(db_session, "7203.T", close=3_000.0, quantity=100)

    result = rebalance.compute_rebalance_current(db_session, LOCAL_USER_ID)
    row = result["rows"][0]
    assert row["currency"] == "JPY"
    assert row["current_value"] == pytest.approx(300_000.0)  # 엔 그대로
    assert row["current_value_base"] == pytest.approx(2_700_000.0)  # 원화 환산


def test_rows_keep_native_currency_amounts_alongside_converted(db_session):
    """주문은 현지 통화로 내야 하므로 평가금액은 양쪽 다 필요하다."""
    make_settings(db_session, base_currency="KRW", fx_overrides={"USD": 1300.0})
    _make_stock(db_session, "VOO", target_weight_pct=100.0)
    _set_price_and_holding(db_session, "VOO", close=500.0, quantity=2)

    result = rebalance.compute_rebalance_current(db_session, LOCAL_USER_ID)
    row = result["rows"][0]
    assert row["currency"] == "USD"
    assert row["current_value"] == pytest.approx(1_000.0)  # 달러 그대로
    assert row["current_value_base"] == pytest.approx(1_300_000.0)  # 원화 환산
    assert result["base_currency"] == "KRW"
    assert result["fx"]["rates"]["USD"]["source"] == "override"


def test_base_currency_usd_converts_the_other_way(db_session):
    make_settings(db_session, base_currency="USD", fx_overrides={"USD": 1300.0})
    _make_stock(db_session, "005930.KS", target_weight_pct=100.0)
    _set_price_and_holding(db_session, "005930.KS", close=65_000.0, quantity=2)  # 130,000원

    result = rebalance.compute_rebalance_current(db_session, LOCAL_USER_ID)
    row = result["rows"][0]
    assert row["current_value"] == pytest.approx(130_000.0)
    assert row["current_value_base"] == pytest.approx(100.0)  # 130,000 / 1300


def test_compute_rebalance_current_end_to_end(db_session):
    _make_stock(db_session, "AAA", target_weight_pct=50.0, band=1.0)
    _set_price_and_holding(db_session, "AAA", close=100.0, quantity=10)
    result = rebalance.compute_rebalance_current(db_session, LOCAL_USER_ID)
    assert len(result["rows"]) == 1
    row = result["rows"][0]
    assert row["ticker"] == "AAA"
    assert row["actual_weight_pct"] == 100.0
    assert row["excess_pct"] == 50.0
    assert row["rebalance_signal"]["active"] is True


# ---------------------------------------------------------------------------
#  리뷰 일정 — 포트폴리오에 하나, 기록을 남기면 다음 기간으로
# ---------------------------------------------------------------------------

Q = ReviewPeriod.quarterly
US = Market.US
# 2026년 NYSE 분기 마지막 거래일: 6/30(화), 9/30(수), 12/31(목)
Q2_END, Q3_END, Q4_END = dt.date(2026, 6, 30), dt.date(2026, 9, 30), dt.date(2026, 12, 31)


def test_review_is_the_end_of_the_current_period():
    assert rebalance.next_review_date(Q, dt.date(2026, 9, 24), US) == Q3_END


def test_review_is_due_on_the_last_trading_day():
    today = Q3_END
    assert today >= rebalance.next_review_date(Q, today, US)


def test_a_snapshot_near_the_deadline_moves_the_review_to_the_next_period():
    """마감 2주 안에 남긴 기록은 그 리뷰로 친다 — 하루 일찍 정리했다고 "안 했다"가 되면 안 된다."""
    assert rebalance.next_review_date(Q, dt.date(2026, 9, 25), US, dt.date(2026, 9, 18)) == Q4_END
    assert rebalance.next_review_date(Q, dt.date(2026, 10, 2), US, Q3_END) == Q4_END


def test_a_snapshot_early_in_the_period_does_not_count_as_its_review():
    assert rebalance.next_review_date(Q, dt.date(2026, 9, 24), US, dt.date(2026, 7, 10)) == Q3_END


def test_a_missed_review_stays_due_into_the_next_period():
    """지난 분기 리뷰를 안 남겼으면 새 분기가 시작돼도 "도래"가 꺼지지 않는다."""
    today = dt.date(2026, 8, 10)
    review = rebalance.next_review_date(Q, today, US, dt.date(2026, 5, 1))
    assert review == Q2_END
    assert today >= review


def test_no_nagging_about_the_past_before_the_first_record():
    """기록을 한 번도 안 남긴 사람에게 지난 분기를 탓하지 않는다 (기능을 처음 켠 날)."""
    assert rebalance.next_review_date(Q, dt.date(2026, 8, 10), US) == Q3_END


def test_an_override_wins_until_its_review_is_recorded():
    override = dt.date(2026, 11, 15)
    assert rebalance.next_review_date(Q, dt.date(2026, 9, 24), US, None, override) == override
    # 그 무렵 기록을 남기면 다시 주기로 돌아간다
    after = rebalance.next_review_date(Q, dt.date(2026, 11, 12), US, dt.date(2026, 11, 10), override)
    assert after == Q4_END


@pytest.mark.parametrize(
    ("period", "expected"),
    [
        (ReviewPeriod.quarterly, dt.date(2026, 3, 31)),
        (ReviewPeriod.semiannual, dt.date(2026, 6, 30)),
        (ReviewPeriod.annual, dt.date(2026, 12, 31)),
    ],
)
def test_review_periods(period, expected):
    assert rebalance.next_review_date(period, dt.date(2026, 3, 10), US) == expected


def test_korean_review_date_uses_korean_trading_calendar():
    """원화 포트폴리오의 분기 마감일은 한국 거래일이어야 한다 (12/31은 한국 휴장)."""
    review = rebalance.next_review_date(Q, dt.date(2025, 11, 10), Market.KR)
    _, expected = period_trading_bounds(dt.date(2025, 11, 10), "quarterly", Market.KR)
    assert review == expected
    assert review != dt.date(2025, 12, 31)


def test_review_market_follows_the_base_currency():
    from app.markets import Currency

    assert rebalance.review_market(Currency.KRW) is Market.KR
    assert rebalance.review_market(Currency.USD) is Market.US
    assert rebalance.review_market(Currency.JPY) is Market.JP


def test_review_status_reads_the_period_from_settings(db_session):
    make_settings(db_session, base_currency="USD", review_period="annual")
    status = rebalance.review_status(db_session, LOCAL_USER_ID, today=dt.date(2026, 3, 10))
    assert status["period"] == "annual"
    assert status["next_date"] == dt.date(2026, 12, 31)
    assert status["due"] is False
    assert status["last_snapshot_at"] is None


def test_review_due_raises_the_signal_on_every_row(db_session):
    make_settings(db_session, base_currency="USD")
    _make_stock(db_session, "AAA", target_weight_pct=100.0)
    _set_price_and_holding(db_session, "AAA", close=100.0, quantity=1)
    result = rebalance.compute_rebalance_current(db_session, LOCAL_USER_ID, today=Q3_END)
    assert result["review"]["due"] is True
    assert result["rows"][0]["rebalance_signal"]["reasons"] == ["정기 리뷰 도래"]


# ---------------------------------------------------------------------------
#  현금 — 목표비중은 전체 자금 중의 비중이다
# ---------------------------------------------------------------------------


def test_cash_counts_toward_the_total(db_session):
    """주식 700만 + 현금 300만이면 주식은 70%다. 현금을 빼면 100%로 보여 전부 과중이 된다."""
    make_settings(db_session, base_currency="KRW", cash={"KRW": 3_000_000}, cash_target_pct=30.0)
    kr = _make_stock(db_session, "005930.KS", target_weight_pct=70.0)
    _set_price_and_holding(db_session, "005930.KS", close=70_000.0, quantity=100)

    assert rebalance.compute_actual_weights(db_session, LOCAL_USER_ID, [kr]) == {
        "005930.KS": pytest.approx(70.0)
    }
    result = rebalance.compute_rebalance_current(db_session, LOCAL_USER_ID)
    assert result["total_value_base"] == pytest.approx(10_000_000)
    assert result["holdings_value_base"] == pytest.approx(7_000_000)
    assert result["cash"]["value_base"] == pytest.approx(3_000_000)
    assert result["cash"]["actual_pct"] == pytest.approx(30.0)
    assert result["cash"]["excess_pct"] == pytest.approx(0.0)
    assert result["target_sum_pct"] == pytest.approx(100.0)
    assert result["rows"][0]["excess_pct"] == pytest.approx(0.0)


def test_cash_in_dollars_is_converted(db_session):
    make_settings(
        db_session, base_currency="KRW", fx_overrides={"USD": 1300.0}, cash={"USD": 1000, "KRW": 700_000}
    )
    result = rebalance.compute_rebalance_current(db_session, LOCAL_USER_ID)
    assert result["cash"]["value_base"] == pytest.approx(2_000_000)
    assert result["cash"]["amounts"] == {"USD": 1000.0, "KRW": 700_000.0}
    assert result["cash"]["actual_pct"] == pytest.approx(100.0)


def test_unknown_or_empty_cash_entries_are_ignored(db_session):
    settings = make_settings(db_session, cash={"XYZ": 5, "KRW": 0, "usd": 10})
    assert rebalance.cash_amounts(settings) == {Currency.USD: 10.0}


# ---------------------------------------------------------------------------
#  평단가 — 손익만 보여주고 비중에는 안 끼어든다
# ---------------------------------------------------------------------------


def test_profit_is_measured_in_the_trading_currency(db_session):
    make_settings(db_session, base_currency="KRW", fx_overrides={"USD": 1300.0})
    _make_stock(db_session, "VOO", target_weight_pct=100.0)
    _set_price_and_holding(db_session, "VOO", close=500.0, quantity=2, avg_cost=400.0)

    result = rebalance.compute_rebalance_current(db_session, LOCAL_USER_ID)
    row = result["rows"][0]
    assert row["avg_cost"] == 400.0
    assert row["cost_value"] == pytest.approx(800.0)
    assert row["unrealized_pnl"] == pytest.approx(200.0)  # 달러
    assert row["return_pct"] == pytest.approx(25.0)
    assert result["cost_value_base"] == pytest.approx(1_040_000)
    assert result["unrealized_pnl_base"] == pytest.approx(260_000)


def test_unknown_cost_leaves_profit_empty_not_zero(db_session):
    """평단가를 모르는 종목의 손익은 0원이 아니라 "모름"이다 — 0으로 보이면 거짓말이다."""
    make_settings(db_session, base_currency="USD")
    _make_stock(db_session, "AAA", target_weight_pct=50.0)
    _make_stock(db_session, "BBB", target_weight_pct=50.0)
    _set_price_and_holding(db_session, "AAA", close=100.0, quantity=1)
    _set_price_and_holding(db_session, "BBB", close=100.0, quantity=1, avg_cost=50.0)

    result = rebalance.compute_rebalance_current(db_session, LOCAL_USER_ID)
    rows = {r["ticker"]: r for r in result["rows"]}
    assert rows["AAA"]["unrealized_pnl"] is None
    assert rows["AAA"]["return_pct"] is None
    # 합계는 평단가를 아는 종목끼리만
    assert result["unrealized_pnl_base"] == pytest.approx(50.0)
    # 비중은 평단가와 무관하다
    assert rows["AAA"]["actual_weight_pct"] == rows["BBB"]["actual_weight_pct"] == 50.0


def test_no_costs_at_all_means_no_totals(db_session):
    _make_stock(db_session, "AAA", target_weight_pct=100.0)
    _set_price_and_holding(db_session, "AAA", close=100.0, quantity=1)
    result = rebalance.compute_rebalance_current(db_session, LOCAL_USER_ID)
    assert result["cost_value_base"] is None
    assert result["unrealized_pnl_base"] is None


# ---------------------------------------------------------------------------
#  리밸런싱 기록
# ---------------------------------------------------------------------------


def test_snapshot_freezes_the_current_numbers(db_session):
    make_settings(db_session, base_currency="USD", cash={"USD": 100}, cash_target_pct=10.0)
    _make_stock(db_session, "AAA", target_weight_pct=90.0)
    _set_price_and_holding(db_session, "AAA", close=100.0, quantity=9, avg_cost=80.0)

    snapshot = rebalance.take_snapshot(db_session, LOCAL_USER_ID, note="  3분기 리뷰  ")
    assert snapshot.note == "3분기 리뷰"
    assert snapshot.base_currency == "USD"
    assert snapshot.total_value_base == pytest.approx(1000.0)
    (row,) = snapshot.data["rows"]
    assert (row["ticker"], row["quantity"], row["avg_cost"], row["last_close"]) == ("AAA", 9, 80.0, 100.0)
    assert row["actual_weight_pct"] == pytest.approx(90.0)
    assert snapshot.data["cash"]["actual_pct"] == pytest.approx(10.0)

    # 나중에 목표를 바꿔도 기록은 그날 모습 그대로다
    stock = db_session.query(rebalance.UserStock).one()
    stock.target_weight_pct = 50.0
    db_session.commit()
    db_session.expire_all()
    frozen = db_session.get(RebalanceSnapshot, snapshot.id)
    assert frozen.data["rows"][0]["target_weight_pct"] == 90.0


def test_snapshot_moves_the_next_review(db_session):
    make_settings(db_session, base_currency="USD")
    _make_stock(db_session, "AAA", target_weight_pct=100.0)
    _set_price_and_holding(db_session, "AAA", close=100.0, quantity=1)

    before = rebalance.review_status(db_session, LOCAL_USER_ID)
    rebalance.take_snapshot(db_session, LOCAL_USER_ID)
    after = rebalance.review_status(db_session, LOCAL_USER_ID)
    assert after["last_snapshot_at"] is not None
    # 마감 2주 안이면 다음 기간으로, 아니면 그대로 — 어느 쪽이든 뒤로 가지는 않는다
    assert after["next_date"] >= before["next_date"]


def test_snapshot_of_nothing_is_refused(db_session):
    _make_stock(db_session, "AAA", target_weight_pct=100.0)
    with pytest.raises(rebalance.SnapshotRefused) as refused:
        rebalance.take_snapshot(db_session, LOCAL_USER_ID)
    assert "기록할 자산이 없습니다" in refused.value.hint


def test_snapshot_count_is_capped(db_session, monkeypatch):
    monkeypatch.setattr(rebalance, "MAX_SNAPSHOTS", 2)
    make_settings(db_session, cash={"KRW": 1000})
    rebalance.take_snapshot(db_session, LOCAL_USER_ID)
    rebalance.take_snapshot(db_session, LOCAL_USER_ID)
    with pytest.raises(rebalance.SnapshotRefused) as refused:
        rebalance.take_snapshot(db_session, LOCAL_USER_ID)
    assert "2개까지" in refused.value.hint
