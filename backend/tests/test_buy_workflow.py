import datetime as dt

from app.models import BuyExecution, BuyStatus, BuyType, DcaPeriod, Holding, PriceDaily, SignalDaily, Stock
from app.services import buy_workflow
from app.services.trading_calendar import period_trading_bounds, trading_days


def _make_stock(db, ticker="TST", dca_period=DcaPeriod.monthly, dca_amount=100.0, added_at=None):
    """기본은 **오래전에 등록한 종목**. 대부분의 상황이 그렇다.

    등록일이 중요한 이유: 매수 판정은 등록일 이전으로 거슬러 올라가지 않는다. 기본값을
    "지금"으로 두면 이번 기간의 과거 날짜가 전부 등록 전이 되어, 정작 보려는 것과
    상관없는 이유로 테스트가 통과하거나 실패한다.
    """
    stock = Stock(
        ticker=ticker,
        dca_period=dca_period,
        dca_amount=dca_amount,
        target_weight_pct=0.0,
        added_at=added_at or (dt.datetime.utcnow() - dt.timedelta(days=365)),
    )
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
    assert record.status == BuyStatus.scheduled
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
    assert record.status == BuyStatus.scheduled


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
            status=BuyStatus.scheduled,
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
        status=BuyStatus.scheduled,
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
        status=BuyStatus.scheduled,
    )
    db_session.add(buy)
    db_session.commit()

    buy_workflow.confirm_buy_execution(db_session, buy, apply_to_holding=False)
    assert db_session.query(Holding).filter_by(ticker=stock.ticker).first() is None


def test_signal_is_caught_even_if_refresh_was_days_late(db_session):
    """갱신이 며칠 밀려도 그 사이에 뜬 시그널을 잡아야 한다.

    예전에는 "마지막 시그널 날짜" 하루만 봤다. PC가 꺼져 있어 갱신을 건너뛰면 그 사이에
    뜬 무릎매수가 **영영** 기록되지 않았다 — 나중에 켜서 새로고침해도 마찬가지였다.
    개인 PC에서 도는 도구라 드문 일이 아니다.
    """
    stock = _make_stock(db_session)
    today = dt.date.today()
    period_start, period_end = period_trading_bounds(today, "monthly")
    days = trading_days(period_start, period_end)
    if len(days) < 4:
        return

    fired_on = days[1]
    # 시그널이 뜬 날 이후로 며칠치가 한꺼번에 들어왔고, 그 뒤로는 조건이 안 맞는다
    for day in days[:5]:
        db_session.add(
            SignalDaily(
                ticker=stock.ticker, date=day,
                knee_buy_v2=(day == fired_on), shoulder_sell_ref=False,
            )
        )
    db_session.commit()

    record = buy_workflow.evaluate_buy_workflow(db_session, stock)
    assert record is not None
    assert record.type == BuyType.signal
    assert record.exec_date == fired_on


def test_first_signal_of_the_period_wins(db_session):
    """한 기간에 여러 번 떴으면 **처음** 뜬 날이 매수일이다 (스펙 5장)."""
    stock = _make_stock(db_session)
    today = dt.date.today()
    period_start, period_end = period_trading_bounds(today, "monthly")
    days = trading_days(period_start, period_end)
    if len(days) < 4:
        return

    for day in days[:4]:
        db_session.add(
            SignalDaily(
                ticker=stock.ticker, date=day,
                knee_buy_v2=day in (days[1], days[3]), shoulder_sell_ref=False,
            )
        )
    db_session.commit()

    record = buy_workflow.evaluate_buy_workflow(db_session, stock)
    assert record is not None
    assert record.exec_date == days[1]


def test_signals_from_before_the_stock_was_added_are_ignored(db_session):
    """등록 전 날짜까지 거슬러 올라가면 안 된다.

    종목을 새로 넣으면 전체 히스토리를 백필하므로 이번 기간의 과거 시그널도 함께
    들어온다. 그걸 매수 예정으로 잡으면, 그때는 알 수도 없었고 사지도 않은 거래가
    "예정"으로 올라오고 사용자가 "매수완료"를 누르면 보유수량까지 틀어진다.
    """
    today = dt.date.today()
    period_start, period_end = period_trading_bounds(today, "monthly")
    days = trading_days(period_start, period_end)
    if len(days) < 4:
        return

    # 기간 중간에 등록했고, 시그널은 그 전에 떴다
    added_on = days[2]
    stock = _make_stock(db_session, added_at=dt.datetime.combine(added_on, dt.time(12, 0)))

    for day in days[:4]:
        db_session.add(
            SignalDaily(
                ticker=stock.ticker, date=day,
                knee_buy_v2=(day == days[0]), shoulder_sell_ref=False,
            )
        )
    db_session.commit()

    assert buy_workflow.evaluate_buy_workflow(db_session, stock) is None
    assert db_session.query(BuyExecution).count() == 0
