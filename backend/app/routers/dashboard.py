from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.markets import Market, currency_of_stock, market_of_stock
from app.models import IndicatorDaily
from app.schemas import (
    DashboardCard,
    KneeConditions,
    LatestIndicators,
    RebalanceSignal,
)
from app.services import queries, rebalance
from app.services.trading_calendar import market_today
from app.services.users import current_user_id, ordered_user_stocks

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
def get_dashboard(db: Session = Depends(get_db), user_id: int = Depends(current_user_id)):
    stocks = ordered_user_stocks(db, user_id, active_only=True)
    tickers = [stock.ticker for stock in stocks]

    rebalance_rows = {
        row["ticker"]: row
        for row in rebalance.compute_rebalance_current(db, user_id)["rows"]
    }

    # 종목마다 따로 조회하면 종목 수에 비례해 쿼리가 늘어난다. 테이블당 한 번만 읽는다.
    # 등락률에 최근 2거래일, StdDev20 축소 판정에 5거래일 전 값이 필요하므로 6개까지 읽는다
    # (signals.compute_signals의 shift(5)와 같은 기준).
    prices_by_ticker = queries.recent_prices(db, tickers, limit=2)
    indicators_by_ticker = queries.recent_indicators(db, tickers, limit=6)
    signals_by_ticker = queries.recent_signals(db, tickers, limit=1)

    last_buy_signals = queries.last_buy_signal_dates(db, tickers)

    cards = []
    # "오늘"은 시장마다 다르다. 서버 시계로 재면 한국 종목은 미국이 아직 어제일 때
    # 하루 더 오래된 것처럼 보인다. 시장별로 한 번씩만 구해 재사용한다.
    today_by_market = {market: market_today(market) for market in Market}
    for stock in stocks:
        recent_prices = prices_by_ticker.get(stock.ticker, [])
        price = recent_prices[0] if recent_prices else None
        prev_price = recent_prices[1] if len(recent_prices) > 1 else None

        recent_indicators = indicators_by_ticker.get(stock.ticker, [])
        indicator = recent_indicators[0] if recent_indicators else None
        indicator_5d_ago = recent_indicators[5] if len(recent_indicators) > 5 else None

        signal_rows = signals_by_ticker.get(stock.ticker, [])
        signal = signal_rows[0] if signal_rows else None

        market = market_of_stock(stock)
        data_stale = True
        if price is not None:
            data_stale = (today_by_market[market] - price.date).days > STALE_AFTER_DAYS

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
                market=market,
                currency=currency_of_stock(stock),
                data_stale=data_stale,
                price_source=price.source if price else None,
                indicators=indicators,
                knee_buy_v2=bool(signal.knee_buy_v2) if signal else False,
                knee_conditions=knee_conditions,
                shoulder_sell_ref=bool(signal.shoulder_sell_ref) if signal else False,
                last_buy_signal_date=last_buy_signals.get(stock.ticker),
                rebalance_signal=rebalance_signal,
            )
        )

    return cards
