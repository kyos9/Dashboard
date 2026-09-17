"""무릎매수 실행 워크플로우 (SIGNAL_APP_SPEC.md 5장).

기간(월/분기, 공통 거래일 캘린더 기준) 내 첫 무릎매수(v2) 발동일 → "예정(시그널)" 기록.
기간 마지막 거래일까지 미발동 → 마지막 날 "예정(폴백)" 기록.

여기서 하는 일은 **권하는 게 아니라 잡아두는 것**이다. 종목도 금액도 주기도 사용자가
정해둔 값이고, 이 코드는 그 조건이 맞아떨어진 날을 기록할 뿐이다. 실제로 샀는지는
사용자가 대시보드에서 확인해야 "확정(confirmed)"으로 바뀐다.

(신규 종목은 추가 시점 이후 열린 기간부터만 추적 — 과거 기간 소급 없음, 이 함수는 항상
"가장 최근 시그널 날짜"만 평가하므로 자연히 그렇게 동작한다.)
"""

import datetime as dt

from sqlalchemy.orm import Session

from app.markets import market_of_stock
from app.models import BuyExecution, BuyStatus, BuyType, Holding, SignalDaily, Stock
from app.services.trading_calendar import period_trading_bounds


def latest_signal_date(db: Session, ticker: str) -> dt.date | None:
    row = (
        db.query(SignalDaily)
        .filter(SignalDaily.ticker == ticker)
        .order_by(SignalDaily.date.desc())
        .first()
    )
    return row.date if row else None


def evaluate_buy_workflow(db: Session, stock: Stock) -> BuyExecution | None:
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
        .filter_by(ticker=stock.ticker, period_start=period_start, period_end=period_end)
        .first()
    )
    if existing is not None:
        return None

    today_signal = (
        db.query(SignalDaily).filter_by(ticker=stock.ticker, date=latest).first()
    )

    record = None
    if today_signal is not None and today_signal.knee_buy_v2:
        record = BuyExecution(
            ticker=stock.ticker,
            period_start=period_start,
            period_end=period_end,
            exec_date=latest,
            type=BuyType.signal,
            amount=stock.dca_amount,
            status=BuyStatus.scheduled,
        )
    elif latest >= period_end:
        record = BuyExecution(
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
            holding = db.query(Holding).filter_by(ticker=buy_execution.ticker).first()
            if holding is None:
                holding = Holding(ticker=buy_execution.ticker, quantity=0.0)
                db.add(holding)
            holding.quantity += added_qty
            holding.updated_at = dt.datetime.utcnow()

    db.commit()
    db.refresh(buy_execution)
    return buy_execution
