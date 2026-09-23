"""리밸런싱(매도) 워크플로우 + 비중조절 신호 (SIGNAL_APP_SPEC.md 6장 + 추가요구).

매도 실행일 자체는 항상 고정 리뷰 마감일이며(신호 기반 아님), 여기서 계산하는
"비중조절 신호"는 정기 리뷰 도래 또는 밴드(과중/저비중) 초과를 알려주는 조기 참고
알림일 뿐 자동 매매를 트리거하지 않는다.

통화: 종목마다 거래 통화가 다르므로(원화/달러) 비중은 반드시 기준통화로 환산한 뒤
계산한다. 주문 금액은 반대로 실제 거래하는 통화로 보여줘야 쓸모가 있어서, 양쪽을
모두 돌려준다 (`current_value`는 현지 통화, `current_value_base`는 기준통화).
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy.orm import Session

from app.markets import Currency, currency_of_stock, market_of_stock
from app.models import Holding, SignalDaily, UserSettings, UserStock, stock_order
from app.services import fx, queries
from app.services.trading_calendar import market_today, period_trading_bounds
from app.services.users import LOCAL_USER_ID


def get_default_band_pct(db: Session, user_id: int = LOCAL_USER_ID) -> float:
    settings = db.get(UserSettings, user_id)
    return settings.default_rebalance_band_pct if settings else 5.0


def band_for_stock(stock: UserStock, default_band_pct: float) -> float:
    if stock.rebalance_band_pct is not None:
        return stock.rebalance_band_pct
    return default_band_pct


def next_review_date(stock: UserStock, today: dt.date) -> dt.date | None:
    if stock.review_date_override is not None:
        return stock.review_date_override
    _, end = period_trading_bounds(today, stock.rebalance_period.value, market_of_stock(stock))
    return end


def _shoulder_flags(db: Session, stocks: list[UserStock], today_by_ticker: dict[str, dt.date]) -> dict[str, bool]:
    """종목별 "현재 리뷰 기간 안에 어깨매도가 떴는가"를 한 번의 쿼리로 판정한다."""
    if not stocks:
        return {}

    ranges: dict[str, tuple[dt.date, dt.date]] = {}
    for stock in stocks:
        today = today_by_ticker[stock.ticker]
        start, end = period_trading_bounds(
            today, stock.rebalance_period.value, market_of_stock(stock)
        )
        if start is not None and end is not None:
            ranges[stock.ticker] = (start, end)

    if not ranges:
        return {stock.ticker: False for stock in stocks}

    earliest = min(start for start, _ in ranges.values())
    rows = (
        db.query(SignalDaily.ticker, SignalDaily.date)
        .filter(
            SignalDaily.ticker.in_(list(ranges)),
            SignalDaily.date >= earliest,
            SignalDaily.shoulder_sell_ref.is_(True),
        )
        .all()
    )

    flags = {stock.ticker: False for stock in stocks}
    for ticker, date in rows:
        start, end = ranges[ticker]
        if start <= date <= end:
            flags[ticker] = True
    return flags


def shoulder_fired_in_current_period(db: Session, stock: UserStock, today: dt.date) -> bool:
    """이 종목의 현재 리뷰 기간 안에 어깨매도(참고)가 떴는지."""
    return _shoulder_flags(db, [stock], {stock.ticker: today}).get(stock.ticker, False)


def compute_positions(
    db: Session,
    stocks: list[UserStock],
    rate: fx.FxRates | None = None,
    base: Currency | None = None,
) -> dict[str, dict]:
    """종목별 보유수량/최신 종가/평가금액을 한 번에 계산한다.

    `value`는 종목의 거래 통화 기준, `value_base`는 기준통화로 환산한 값이다.
    비중 계산에는 반드시 `value_base`를 써야 한다.
    """
    if rate is None:
        rate = fx.get_rates(db)
    if base is None:
        base = fx.base_currency(db)

    tickers = [stock.ticker for stock in stocks]
    closes = queries.latest_closes(db, tickers)
    quantities = {
        holding.ticker: holding.quantity
        for holding in db.query(Holding).filter(Holding.ticker.in_(tickers)).all()
    }

    positions: dict[str, dict] = {}
    for stock in stocks:
        currency = currency_of_stock(stock)
        close = closes.get(stock.ticker)
        qty = quantities.get(stock.ticker, 0.0)
        value = (qty * close) if close is not None else 0.0
        positions[stock.ticker] = {
            "quantity": qty,
            "last_close": close,
            "currency": currency,
            "value": value,
            "value_base": fx.convert(value, currency, base, rate),
        }
    return positions


def compute_actual_weights(db: Session, stocks: list[UserStock]) -> dict[str, float]:
    """기준통화로 환산한 평가금액 기준 실제비중(%). 보유가 전혀 없으면 전 종목 0.0."""
    positions = compute_positions(db, stocks)
    total = sum(pos["value_base"] for pos in positions.values())
    if total <= 0:
        return {ticker: 0.0 for ticker in positions}
    return {ticker: (pos["value_base"] / total) * 100 for ticker, pos in positions.items()}


def compute_rebalance_signal(
    excess_pct: float, band_pct: float, today: dt.date, review_date: dt.date | None
) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    if review_date is not None and today >= review_date:
        reasons.append("정기 리뷰 도래")
    if excess_pct > band_pct:
        reasons.append("밴드 초과(매도 검토)")
    elif excess_pct < -band_pct:
        reasons.append("밴드 미달(매수 검토)")
    return (len(reasons) > 0, reasons)


def compute_rebalance_current(db: Session, today: dt.date | None = None) -> dict:
    """리밸런싱 현황 전체. 기준통화·환율과 종목별 행을 함께 돌려준다."""
    stocks = db.query(UserStock).filter(UserStock.active.is_(True)).order_by(*stock_order()).all()

    rate = fx.get_rates(db)
    base = fx.base_currency(db)
    default_band = get_default_band_pct(db)

    # "오늘"은 시장 현지 기준으로 판단한다 (호출자가 명시하면 그 값을 그대로 쓴다)
    today_by_ticker = {
        stock.ticker: today or market_today(market_of_stock(stock)) for stock in stocks
    }

    positions = compute_positions(db, stocks, rate=rate, base=base)
    shoulder_flags = _shoulder_flags(db, stocks, today_by_ticker)

    total_base = sum(pos["value_base"] for pos in positions.values())

    rows = []
    for stock in stocks:
        position = positions[stock.ticker]
        stock_today = today_by_ticker[stock.ticker]
        actual = (position["value_base"] / total_base * 100) if total_base > 0 else 0.0
        excess = actual - stock.target_weight_pct
        band = band_for_stock(stock, default_band)
        review_date = next_review_date(stock, stock_today)
        active, reasons = compute_rebalance_signal(excess, band, stock_today, review_date)

        rows.append(
            {
                "ticker": stock.ticker,
                "name": stock.name,
                "currency": position["currency"].value,
                "target_weight_pct": stock.target_weight_pct,
                "actual_weight_pct": actual,
                "excess_pct": excess,
                "next_review_date": review_date,
                "shoulder_signal_fired_in_period": shoulder_flags.get(stock.ticker, False),
                "rebalance_signal": {"active": active, "reasons": reasons},
                "quantity": position["quantity"],
                "last_close": position["last_close"],
                "current_value": position["value"],
                "current_value_base": position["value_base"],
            }
        )

    return {
        "base_currency": base.value,
        "fx": rate.to_dict(),
        "total_value_base": total_base,
        "rows": rows,
    }
