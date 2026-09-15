import datetime as dt

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import IndicatorDaily, PriceDaily, SignalDaily, Stock
from app.schemas import DashboardCard, LatestIndicators, PendingBuy, RebalanceSignal
from app.services import buy_workflow, rebalance

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

STALE_AFTER_DAYS = 5


@router.get("", response_model=list[DashboardCard])
def get_dashboard(db: Session = Depends(get_db)):
    stocks = db.query(Stock).filter(Stock.active.is_(True)).order_by(Stock.ticker.asc()).all()
    rebalance_rows = {row["ticker"]: row for row in rebalance.compute_rebalance_current(db)}

    cards = []
    for stock in stocks:
        price = (
            db.query(PriceDaily)
            .filter_by(ticker=stock.ticker)
            .order_by(PriceDaily.date.desc())
            .first()
        )
        indicator = (
            db.query(IndicatorDaily)
            .filter_by(ticker=stock.ticker)
            .order_by(IndicatorDaily.date.desc())
            .first()
        )
        signal = (
            db.query(SignalDaily)
            .filter_by(ticker=stock.ticker)
            .order_by(SignalDaily.date.desc())
            .first()
        )

        data_stale = True
        if price is not None:
            data_stale = (dt.date.today() - price.date).days > STALE_AFTER_DAYS

        indicators = LatestIndicators(
            date=indicator.date if indicator else None,
            close=price.close if price else None,
            ma5=indicator.ma5 if indicator else None,
            ma20=indicator.ma20 if indicator else None,
            ma50=indicator.ma50 if indicator else None,
            ma200=indicator.ma200 if indicator else None,
            stddev20=indicator.stddev20 if indicator else None,
            vol_ratio=indicator.vol_ratio if indicator else None,
            roc5=indicator.roc5 if indicator else None,
            disparity=indicator.disparity if indicator else None,
            plus_di=indicator.plus_di if indicator else None,
            minus_di=indicator.minus_di if indicator else None,
            adx=indicator.adx if indicator else None,
        )

        current_buy = buy_workflow.get_current_period_buy(db, stock)
        pending_buy = (
            PendingBuy(
                id=current_buy.id,
                type=current_buy.type,
                status=current_buy.status,
                exec_date=current_buy.exec_date,
                amount=current_buy.amount,
            )
            if current_buy
            else None
        )

        rb = rebalance_rows.get(stock.ticker)
        rebalance_signal = (
            RebalanceSignal(active=rb["rebalance_signal"]["active"], reasons=rb["rebalance_signal"]["reasons"])
            if rb
            else RebalanceSignal(active=False, reasons=[])
        )

        cards.append(
            DashboardCard(
                ticker=stock.ticker,
                name=stock.name,
                data_stale=data_stale,
                indicators=indicators,
                knee_buy_v2=bool(signal.knee_buy_v2) if signal else False,
                shoulder_sell_ref=bool(signal.shoulder_sell_ref) if signal else False,
                current_period_buy=pending_buy,
                rebalance_signal=rebalance_signal,
            )
        )

    return cards
