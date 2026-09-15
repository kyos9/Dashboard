import datetime as dt

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import IndicatorDaily, PriceDaily, SignalDaily, Stock
from app.schemas import (
    DashboardCard,
    KneeConditions,
    LatestIndicators,
    PendingBuy,
    RebalanceSignal,
)
from app.services import buy_workflow, rebalance

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

STALE_AFTER_DAYS = 5


def _knee_conditions(
    latest: IndicatorDaily | None, five_days_ago: IndicatorDaily | None
) -> KneeConditions:
    """무릎매수(v2) 네 조건의 개별 충족 여부.

    signals.compute_signals와 같은 기준을 쓰되, 어느 조건이 걸렸는지 화면에 보여주기 위해
    분해한다. 계산에 필요한 값이 없으면 해당 조건은 None(판정 불가)으로 남긴다.
    """
    if latest is None:
        return KneeConditions()

    di_bearish = (
        None
        if latest.minus_di is None or latest.plus_di is None
        else latest.minus_di > latest.plus_di
    )
    disparity_negative = None if latest.disparity is None else latest.disparity < 0
    adx_trending = None if latest.adx is None else latest.adx > 20

    # StdDev20 축소 또는 거래량비 > 1.1 — 둘 중 하나만 만족해도 참
    stddev_shrinking = (
        None
        if latest.stddev20 is None or five_days_ago is None or five_days_ago.stddev20 is None
        else latest.stddev20 < five_days_ago.stddev20
    )
    volume_expanding = None if latest.vol_ratio is None else latest.vol_ratio > 1.1
    if stddev_shrinking is True or volume_expanding is True:
        volatility_or_volume: bool | None = True
    elif stddev_shrinking is None and volume_expanding is None:
        volatility_or_volume = None
    else:
        volatility_or_volume = False

    return KneeConditions(
        di_bearish=di_bearish,
        disparity_negative=disparity_negative,
        volatility_or_volume=volatility_or_volume,
        adx_trending=adx_trending,
    )


@router.get("", response_model=list[DashboardCard])
def get_dashboard(db: Session = Depends(get_db)):
    stocks = db.query(Stock).filter(Stock.active.is_(True)).order_by(Stock.ticker.asc()).all()
    rebalance_rows = {row["ticker"]: row for row in rebalance.compute_rebalance_current(db)}

    cards = []
    for stock in stocks:
        # 등락률 계산을 위해 최근 2거래일치를 함께 읽는다.
        recent_prices = (
            db.query(PriceDaily)
            .filter_by(ticker=stock.ticker)
            .order_by(PriceDaily.date.desc())
            .limit(2)
            .all()
        )
        price = recent_prices[0] if recent_prices else None
        prev_price = recent_prices[1] if len(recent_prices) > 1 else None
        # StdDev20 축소 판정은 5거래일 전 값과 비교하므로 최근 6개를 함께 읽는다
        # (signals.compute_signals의 shift(5)와 같은 기준).
        recent_indicators = (
            db.query(IndicatorDaily)
            .filter_by(ticker=stock.ticker)
            .order_by(IndicatorDaily.date.desc())
            .limit(6)
            .all()
        )
        indicator = recent_indicators[0] if recent_indicators else None
        indicator_5d_ago = recent_indicators[5] if len(recent_indicators) > 5 else None
        signal = (
            db.query(SignalDaily)
            .filter_by(ticker=stock.ticker)
            .order_by(SignalDaily.date.desc())
            .first()
        )

        data_stale = True
        if price is not None:
            data_stale = (dt.date.today() - price.date).days > STALE_AFTER_DAYS

        prev_close = prev_price.close if prev_price else None
        change_pct = None
        if price is not None and prev_close:
            change_pct = (price.close / prev_close - 1) * 100

        indicators = LatestIndicators(
            date=indicator.date if indicator else None,
            close=price.close if price else None,
            prev_close=prev_close,
            change_pct=change_pct,
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

        knee_conditions = _knee_conditions(indicator, indicator_5d_ago)

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
                category=stock.category,
                data_stale=data_stale,
                indicators=indicators,
                knee_buy_v2=bool(signal.knee_buy_v2) if signal else False,
                knee_conditions=knee_conditions,
                shoulder_sell_ref=bool(signal.shoulder_sell_ref) if signal else False,
                current_period_buy=pending_buy,
                rebalance_signal=rebalance_signal,
            )
        )

    return cards
