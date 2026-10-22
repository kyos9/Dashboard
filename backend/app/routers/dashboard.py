from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.markets import Market, currency_of_stock, market_of_stock
from app.schemas import (
    DashboardCard,
    LatestIndicators,
    RebalanceSignal,
)
from app.services import backfill, my_signals, queries, rebalance, signal_rules
# 화면이 조건을 나눠 보여주는 판정 — AI 정리(ai_analysis)도 같은 것을 쓴다
from app.services.signals import buy_conditions_many, knee_conditions_from, sell_conditions_many
# 옛 이름 — 조건 분해가 엔진과 같은지 보는 테스트가 이 자리로 부른다
from app.services.signals import knee_conditions as _knee_conditions  # noqa: F401
from app.services.trading_calendar import market_today
from app.services.users import current_user_id, ordered_user_stocks

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

STALE_AFTER_DAYS = 5


@router.get("", response_model=list[DashboardCard])
def get_dashboard(db: Session = Depends(get_db), user_id: int = Depends(current_user_id)):
    stocks = ordered_user_stocks(db, user_id, active_only=True)
    tickers = [stock.ticker for stock in stocks]

    rebalance_rows = {
        row["ticker"]: row
        for row in rebalance.compute_rebalance_current(db, user_id)["rows"]
    }

    # 종목마다 따로 조회하면 종목 수에 비례해 쿼리가 늘어난다. 테이블당 한 번만 읽는다.
    # 등락률에 최근 2거래일, 조건의 "N거래일 전" 비교에 N+1 행이 필요하다
    # (표 전체 계산과 같은 기준 — N 은 signal_rules.LOOKBACK_DAYS).
    # 0.42.0 — 시그널은 그 사람의 기준으로. 기본이면 저장된 판정을 그대로 읽는다(쿼리 수도 그대로).
    signals = my_signals.source(db, user_id)
    t = signals.thresholds
    prices_by_ticker = queries.recent_prices(db, tickers, limit=2)
    indicators_by_ticker = queries.recent_indicators(db, tickers, limit=t.lookback_days + 1)
    signals_by_ticker = signals.today(tickers)

    last_buy_signals = signals.last_buy_dates(tickers)
    # 내 기준을 쓰는 사람의 신호 요약에 "기본 기준이면 몇 개"를 보이려고 — 저장된 판정 한 행만 더 읽는다
    default_today = queries.recent_signals(db, tickers, limit=1) if signals.custom else {}
    rules_version = signal_rules.rules_version(t)
    # 오늘 조건은 종목마다가 아니라 한 번에 (signals.buy_conditions_many)
    conditions_by_ticker = buy_conditions_many({tk: indicators_by_ticker.get(tk, []) for tk in tickers}, t)
    # 매도(참고) 조건도 같은 규칙·같은 평가로 (0.45.0 C). "MA50 위"는 종가가 필요하다 — 이미 읽은 최근 종가 중
    # **가장 새 지표 날짜와 같은 날**의 것만 쓴다(다른 날 종가로 재면 저장된 판정과 갈라진다). 쿼리는 늘지 않는다
    close_on_indicator_day = {
        tk: next((p.close for p in prices_by_ticker.get(tk, []) if p.date == rows[0].date), None)
        for tk in tickers
        if (rows := indicators_by_ticker.get(tk))
    }
    sell_by_ticker = sell_conditions_many(
        {tk: indicators_by_ticker.get(tk, []) for tk in tickers}, close_on_indicator_day, t
    )

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

        buy_conditions = conditions_by_ticker[stock.ticker]
        knee_conditions = knee_conditions_from(buy_conditions)

        rb = rebalance_rows.get(stock.ticker)
        rebalance_signal = (
            RebalanceSignal(active=rb["rebalance_signal"]["active"], reasons=rb["rebalance_signal"]["reasons"])
            if rb
            else RebalanceSignal(active=False, reasons=[])
        )

        cards.append(
            DashboardCard(
                ticker=stock.ticker,
                name=stock.shown_name,
                category=stock.category,
                market=market,
                currency=currency_of_stock(stock),
                data_stale=data_stale,
                price_source=price.source if price else None,
                indicators=indicators,
                knee_buy_v2=bool(signal.knee_buy_v2) if signal else False,
                knee_buy_v2_default=(
                    bool(rows[0].knee_buy_v2) if (rows := default_today.get(stock.ticker)) else False
                ) if signals.custom else None,
                knee_conditions=knee_conditions,
                buy_conditions=buy_conditions,
                signal_rules_version=rules_version,
                shoulder_sell_ref=bool(signal.shoulder_sell_ref) if signal else False,
                sell_conditions=(
                    sell_by_ticker[stock.ticker]
                    if signal is not None and indicator is not None and signal.date == indicator.date
                    else None
                ),
                last_buy_signal_date=last_buy_signals.get(stock.ticker),
                rebalance_signal=rebalance_signal,
                data_status=(backfill.status(stock.ticker) or {}).get("state"),
            )
        )

    return cards
