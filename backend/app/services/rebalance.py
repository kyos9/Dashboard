"""리밸런싱(매도) 워크플로우 + 비중조절 신호 (SIGNAL_APP_SPEC.md 6장 + 추가요구).

매도 실행일 자체는 항상 고정 리뷰 마감일이며(신호 기반 아님), 여기서 계산하는
"비중조절 신호"는 정기 리뷰 도래 또는 밴드(과중/저비중) 초과를 알려주는 조기 참고
알림일 뿐 자동 매매를 트리거하지 않는다.
"""

import datetime as dt

from sqlalchemy.orm import Session

from app.models import Holding, PortfolioSettings, PriceDaily, SignalDaily, Stock
from app.services.trading_calendar import period_trading_bounds


def get_latest_close(db: Session, ticker: str) -> float | None:
    row = (
        db.query(PriceDaily)
        .filter(PriceDaily.ticker == ticker)
        .order_by(PriceDaily.date.desc())
        .first()
    )
    return row.close if row else None


def get_default_band_pct(db: Session) -> float:
    settings = db.query(PortfolioSettings).first()
    return settings.default_rebalance_band_pct if settings else 5.0


def band_for_stock(db: Session, stock: Stock) -> float:
    if stock.rebalance_band_pct is not None:
        return stock.rebalance_band_pct
    return get_default_band_pct(db)


def next_review_date(stock: Stock, today: dt.date) -> dt.date | None:
    if stock.review_date_override is not None:
        return stock.review_date_override
    _, end = period_trading_bounds(today, stock.rebalance_period.value)
    return end


def shoulder_fired_in_current_period(db: Session, stock: Stock, today: dt.date) -> bool:
    start, end = period_trading_bounds(today, stock.rebalance_period.value)
    if start is None:
        return False
    count = (
        db.query(SignalDaily)
        .filter(
            SignalDaily.ticker == stock.ticker,
            SignalDaily.date >= start,
            SignalDaily.date <= end,
            SignalDaily.shoulder_sell_ref.is_(True),
        )
        .count()
    )
    return count > 0


def compute_positions(db: Session, stocks: list[Stock]) -> dict[str, dict]:
    """종목별 보유수량/최신 종가/평가금액을 한 번에 계산한다."""
    positions: dict[str, dict] = {}
    for stock in stocks:
        holding = db.query(Holding).filter_by(ticker=stock.ticker).first()
        close = get_latest_close(db, stock.ticker)
        qty = holding.quantity if holding else 0.0
        positions[stock.ticker] = {
            "quantity": qty,
            "last_close": close,
            "value": (qty * close) if (close is not None) else 0.0,
        }
    return positions


def compute_actual_weights(db: Session, stocks: list[Stock]) -> dict[str, float]:
    """Holding 수량 x 최신 종가 기준 실제비중(%). 보유가 전혀 없으면 전 종목 0.0."""
    positions = compute_positions(db, stocks)
    values = {ticker: pos["value"] for ticker, pos in positions.items()}

    total = sum(values.values())
    if total <= 0:
        return {ticker: 0.0 for ticker in values}
    return {ticker: (value / total) * 100 for ticker, value in values.items()}


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


def compute_rebalance_current(db: Session, today: dt.date | None = None) -> list[dict]:
    today = today or dt.date.today()
    stocks = db.query(Stock).filter(Stock.active.is_(True)).all()
    positions = compute_positions(db, stocks)
    total_value = sum(pos["value"] for pos in positions.values())
    actual_weights = (
        {ticker: (pos["value"] / total_value) * 100 for ticker, pos in positions.items()}
        if total_value > 0
        else {ticker: 0.0 for ticker in positions}
    )

    rows = []
    for stock in stocks:
        position = positions[stock.ticker]
        actual = actual_weights.get(stock.ticker, 0.0)
        excess = actual - stock.target_weight_pct
        band = band_for_stock(db, stock)
        review_date = next_review_date(stock, today)
        active, reasons = compute_rebalance_signal(excess, band, today, review_date)

        rows.append(
            {
                "ticker": stock.ticker,
                "target_weight_pct": stock.target_weight_pct,
                "actual_weight_pct": actual,
                "excess_pct": excess,
                "next_review_date": review_date,
                "shoulder_signal_fired_in_period": shoulder_fired_in_current_period(db, stock, today),
                "rebalance_signal": {"active": active, "reasons": reasons},
                "quantity": position["quantity"],
                "last_close": position["last_close"],
                "current_value": position["value"],
            }
        )
    return rows
