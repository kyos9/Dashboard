import datetime as dt

from app.models import BuyExecution, BuyStatus, BuyType, DcaPeriod, Holding, PriceDaily, SignalDaily, Stock
from app.services import buy_workflow
from app.services.trading_calendar import period_trading_bounds, trading_days


def _make_stock(db, ticker="TST", dca_period=DcaPeriod.monthly, dca_amount=100.0):
    stock = Stock(ticker=ticker, dca_period=dca_period, dca_amount=dca_amount, target_weight_pct=0.0)
    db.add(stock)
    db.commit()
    return stock


def test_signal_buy_recorded_mid_period(db_session):
    stock = _make_stock(db_session)
    today = dt.date.today()
    period_start, period_end = period_trading_bounds(today, "monthly")
    days = trading_days(period_start, period_end)
    mid = days[len(days) // 2]

    db_session.add(SignalDaily(ticker=stock.ticker, date=mid, knee_buy_v2=True, shoulder_sell_ref=False))
    db_session.commit()

    record = buy_workflow.evaluate_buy_workflow(db_session, stock)
    assert record is not None
    assert record.type == BuyType.signal
    assert record.status == BuyStatus.recommended
    assert record.period_start == period_start
    assert record.period_end == period_end


def test_fallback_buy_recorded_on_last_trading_day_without_signal(db_session):
    stock = _make_stock(db_session)
    today = dt.date.today()
    period_start, period_end = period_trading_bounds(today, "monthly")

    db_session.add(SignalDaily(ticker=stock.ticker, date=period_end, knee_buy_v2=False, shoulder_sell_ref=False))
    db_session.commit()

    record = buy_workflow.evaluate_buy_workflow(db_session, stock)
    assert record is not None
    assert record.type == BuyType.fallback
    assert record.status == BuyStatus.recommended


def test_no_record_when_no_signal_and_not_last_day(db_session):
    stock = _make_stock(db_session)
    today = dt.date.today()
    period_start, period_end = period_trading_bounds(today, "monthly")
    days = trading_days(period_start, period_end)
    if len(days) < 2:
        return  # 극단적으로 짧은 기간이면 스킵
    not_last = days[0] if days[0] != period_end else days[-2]

    db_session.add(SignalDaily(ticker=stock.ticker, date=not_last, knee_buy_v2=False, shoulder_sell_ref=False))
    db_session.commit()

    record = buy_workflow.evaluate_buy_workflow(db_session, stock)
    assert record is None
    assert db_session.query(BuyExecution).count() == 0


def test_no_duplicate_record_for_same_period(db_session):
    stock = _make_stock(db_session)
    today = dt.date.today()
    period_start, period_end = period_trading_bounds(today, "monthly")

    db_session.add(
        BuyExecution(
            ticker=stock.ticker,
            period_start=period_start,
            period_end=period_end,
            exec_date=period_start,
            type=BuyType.signal,
            amount=100.0,
            status=BuyStatus.recommended,
        )
    )
    db_session.add(SignalDaily(ticker=stock.ticker, date=period_end, knee_buy_v2=True, shoulder_sell_ref=False))
    db_session.commit()

    record = buy_workflow.evaluate_buy_workflow(db_session, stock)
    assert record is None
    assert db_session.query(BuyExecution).count() == 1


def test_confirm_buy_execution_updates_holding(db_session):
    stock = _make_stock(db_session, dca_amount=1000.0)
    exec_date = dt.date.today()
    db_session.add(
        PriceDaily(ticker=stock.ticker, date=exec_date, open=100, high=101, low=99, close=100.0, volume=1000)
    )
    buy = BuyExecution(
        ticker=stock.ticker,
        period_start=exec_date,
        period_end=exec_date,
        exec_date=exec_date,
        type=BuyType.signal,
        amount=1000.0,
        status=BuyStatus.recommended,
    )
    db_session.add(buy)
    db_session.commit()

    confirmed = buy_workflow.confirm_buy_execution(db_session, buy, apply_to_holding=True)
    assert confirmed.status == BuyStatus.confirmed
    assert confirmed.confirmed_at is not None

    holding = db_session.query(Holding).filter_by(ticker=stock.ticker).first()
    assert holding is not None
    assert holding.quantity == 10.0  # 1000 / 100


def test_confirm_buy_execution_without_holding_update(db_session):
    stock = _make_stock(db_session, dca_amount=500.0)
    exec_date = dt.date.today()
    db_session.add(
        PriceDaily(ticker=stock.ticker, date=exec_date, open=50, high=51, low=49, close=50.0, volume=1000)
    )
    buy = BuyExecution(
        ticker=stock.ticker,
        period_start=exec_date,
        period_end=exec_date,
        exec_date=exec_date,
        type=BuyType.fallback,
        amount=500.0,
        status=BuyStatus.recommended,
    )
    db_session.add(buy)
    db_session.commit()

    buy_workflow.confirm_buy_execution(db_session, buy, apply_to_holding=False)
    assert db_session.query(Holding).filter_by(ticker=stock.ticker).first() is None
