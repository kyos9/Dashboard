"""무릎매수 실행 워크플로우 (SIGNAL_APP_SPEC.md 5장).

기간(월/분기, 공통 거래일 캘린더 기준) 내 첫 무릎매수(v2) 발동일 → "예정(시그널)" 기록.
기간 마지막 거래일까지 미발동 → 마지막 날 "예정(폴백)" 기록.

여기서 하는 일은 **권하는 게 아니라 잡아두는 것**이다. 종목도 금액도 주기도 사용자가
정해둔 값이고, 이 코드는 그 조건이 맞아떨어진 날을 기록할 뿐이다. 실제로 샀는지는
사용자가 대시보드에서 확인해야 "확정(confirmed)"으로 바뀐다.

신규 종목은 **등록한 날부터** 추적한다. 등록 전 날짜까지 거슬러 올라가 매수를 잡아내면,
그때는 알 수도 없었고 실제로 사지도 않은 거래가 "예정"으로 올라온다.
"""

import datetime as dt

from sqlalchemy.orm import Session

from app.markets import market_of_stock
from app.models import BuyExecution, BuyStatus, BuyType, Holding, SignalDaily, UserStock
from app.services.trading_calendar import market_date, period_trading_bounds


def latest_signal_date(db: Session, ticker: str) -> dt.date | None:
    row = (
        db.query(SignalDaily)
        .filter(SignalDaily.ticker == ticker)
        .order_by(SignalDaily.date.desc())
        .first()
    )
    return row.date if row else None


def first_knee_date(db: Session, ticker: str, start: dt.date, end: dt.date) -> dt.date | None:
    """[start, end] 안에서 무릎매수(v2)가 **처음** 뜬 날.

    마지막 날 하나만 보면 안 된다. 갱신은 매일 돈다는 보장이 없고(PC는 꺼진다),
    하루라도 밀리면 그 사이에 뜬 시그널이 영영 기록되지 않는다.
    """
    if start > end:
        return None
    row = (
        db.query(SignalDaily.date)
        .filter(
            SignalDaily.ticker == ticker,
            SignalDaily.date >= start,
            SignalDaily.date <= end,
            SignalDaily.knee_buy_v2.is_(True),
        )
        .order_by(SignalDaily.date.asc())
        .first()
    )
    return row[0] if row else None


def tracking_start(stock: UserStock) -> dt.date:
    """이 종목을 추적하기 시작한 날 (시장 현지 기준)."""
    if stock.added_at is None:
        return dt.date.min
    return market_date(stock.added_at, market_of_stock(stock))


def evaluate_buy_workflow(db: Session, stock: UserStock) -> BuyExecution | None:
    """현재 열려있는 기간에 대해 매수 예정일을 판정/기록한다. 이미 기록이 있으면 아무 것도 하지 않는다."""
    latest = latest_signal_date(db, stock.ticker)
    if latest is None:
        return None

    period_start, period_end = period_trading_bounds(
        latest, stock.dca_period.value, market_of_stock(stock)
    )
    if period_start is None:
        return None

    existing = (
        db.query(BuyExecution)
        .filter_by(
            user_id=stock.user_id,
            ticker=stock.ticker,
            period_start=period_start,
            period_end=period_end,
        )
        .first()
    )
    if existing is not None:
        return None

    # 기간이 열린 날과 종목을 등록한 날 중 늦은 쪽부터 본다
    signal_date = first_knee_date(
        db, stock.ticker, max(period_start, tracking_start(stock)), min(latest, period_end)
    )

    record = None
    if signal_date is not None:
        record = BuyExecution(
            user_id=stock.user_id,
            ticker=stock.ticker,
            period_start=period_start,
            period_end=period_end,
            exec_date=signal_date,
            type=BuyType.signal,
            amount=stock.dca_amount,
            status=BuyStatus.scheduled,
        )
    elif latest >= period_end:
        record = BuyExecution(
            user_id=stock.user_id,
            ticker=stock.ticker,
            period_start=period_start,
            period_end=period_end,
            exec_date=latest,
            type=BuyType.fallback,
            amount=stock.dca_amount,
            status=BuyStatus.scheduled,
        )

    if record is not None:
        db.add(record)
        db.commit()
        db.refresh(record)
    return record


def confirm_buy_execution(db: Session, buy_execution: BuyExecution, apply_to_holding: bool = True) -> BuyExecution:
    if buy_execution.status == BuyStatus.confirmed:
        return buy_execution

    buy_execution.status = BuyStatus.confirmed
    buy_execution.confirmed_at = dt.datetime.utcnow()

    if apply_to_holding:
        from app.models import PriceDaily

        price_row = (
            db.query(PriceDaily)
            .filter_by(ticker=buy_execution.ticker, date=buy_execution.exec_date)
            .first()
        )
        if price_row is not None and price_row.close:
            added_qty = buy_execution.amount / price_row.close
            # 매수 기록의 주인이 곧 보유수량의 주인이다
            holding = db.get(Holding, (buy_execution.user_id, buy_execution.ticker))
            if holding is None:
                holding = Holding(
                    user_id=buy_execution.user_id, ticker=buy_execution.ticker, quantity=0.0
                )
                db.add(holding)
            holding.quantity += added_qty
            holding.updated_at = dt.datetime.utcnow()

    db.commit()
    db.refresh(buy_execution)
    return buy_execution
