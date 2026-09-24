"""리밸런싱 현황 + 비중조절 신호 + 리뷰 일정 + 리밸런싱 기록.

**리밸런싱이 쓰는 값은 넷뿐이다** — 수량 × 현재가, 목표비중, 밴드, 리뷰일. 평단가는
손익을 보여주는 데만 쓰이고 비중에는 끼지 않는다.

**목표비중은 전체 자금 중의 비중이다.** 그래서 현금도 한 줄로 들어간다. 주식만 더하면
현금 30%를 들고 있어도 "100% 투자"로 계산돼 모든 종목이 과중으로 보인다.

**리뷰는 포트폴리오에 하나다.** 종목마다 주기를 두던 때가 있었지만, 리밸런싱은 전체 비중을
한꺼번에 맞추는 일이라 종목마다 다른 날에 할 수 없다. 리뷰일은 주기(분기/반기/연)의
마지막 거래일이고, **기록을 남기면 다음 기간으로 넘어간다** (`next_review_date`).

비중조절 신호는 리뷰 도래 또는 밴드(과중/저비중) 초과를 알려주는 참고 알림일 뿐 자동
매매를 트리거하지 않는다.

통화: 종목마다 거래 통화가 다르므로(원화/달러) 비중은 반드시 기준통화로 환산한 뒤
계산한다. 주문 금액은 반대로 실제 거래하는 통화로 보여줘야 쓸모가 있어서, 양쪽을
모두 돌려준다 (`current_value`는 현지 통화, `current_value_base`는 기준통화).
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.markets import CURRENCY_BY_MARKET, Currency, Market, currency_of_stock, market_of_stock
from app.models import Holding, RebalanceSnapshot, ReviewPeriod, SignalDaily, UserSettings, UserStock
from app.services import fx, queries
from app.services import settings as settings_service
from app.services.trading_calendar import (
    calendar_period_range,
    market_date,
    market_today,
    period_trading_bounds,
)
from app.services.users import ordered_user_stocks

# 리뷰 마감일보다 이만큼 앞서 남긴 기록도 그 리뷰로 친다. 마감일이 연휴에 걸리거나
# 며칠 먼저 정리하는 일은 흔하다 — 하루라도 이르면 "안 했다"로 보는 건 사람을 탓하는 셈이다.
REVIEW_WINDOW = dt.timedelta(days=14)

# 한 사람이 남길 수 있는 기록 수. 분기마다 한두 번이면 50년치다 — 넘는 건 실수이거나 장난이다.
MAX_SNAPSHOTS = 200

MARKET_BY_CURRENCY = {currency: market for market, currency in CURRENCY_BY_MARKET.items()}


def get_default_band_pct(db: Session, user_id: int) -> float:
    settings = db.get(UserSettings, user_id)
    return settings.default_rebalance_band_pct if settings else 5.0


def band_for_stock(stock: UserStock, default_band_pct: float) -> float:
    if stock.rebalance_band_pct is not None:
        return stock.rebalance_band_pct
    return default_band_pct


def review_period_of(settings: UserSettings | None) -> ReviewPeriod:
    try:
        return ReviewPeriod(settings.review_period) if settings else ReviewPeriod.quarterly
    except ValueError:
        return ReviewPeriod.quarterly


def review_market(base: Currency) -> Market:
    """리뷰일을 어느 시장의 달력으로 셀지. 기준통화의 시장을 따른다 (원화면 한국장)."""
    return MARKET_BY_CURRENCY.get(base, Market.US)


def period_end(d: dt.date, period: ReviewPeriod, market: Market) -> dt.date:
    """d가 속한 기간의 마지막 거래일. 거래일이 없으면(달력 밖) 달력상 마지막 날."""
    _, end = period_trading_bounds(d, period.value, market)
    return end or calendar_period_range(d, period.value)[1]


def next_review_date(
    period: ReviewPeriod,
    today: dt.date,
    market: Market,
    last_snapshot: dt.date | None = None,
    override: dt.date | None = None,
) -> dt.date:
    """다음 리뷰일. **오늘이 이 날 이후면 리뷰할 때다.**

    기간 마감일 E의 리뷰는 `E - REVIEW_WINDOW` 이후에 남긴 기록이 있으면 끝난 것으로 본다.

    1. 직접 정한 날이 있고 그 리뷰가 아직이면 → 그날
    2. 이번 기간 리뷰를 이미 남겼으면 → 다음 기간 마감일
    3. 지난 기간 리뷰를 안 남겼으면 → 지난 기간 마감일 (이미 지났으니 곧바로 "도래")
    4. 아니면 → 이번 기간 마감일

    3번은 **기록을 한 번이라도 남긴 사람에게만** 적용한다. 기능을 처음 켠 날 "지난 분기
    리뷰가 밀렸다"고 뜨면 할 수 없는 일을 하라는 말이 된다.
    """

    def done(deadline: dt.date) -> bool:
        return last_snapshot is not None and last_snapshot >= deadline - REVIEW_WINDOW

    if override is not None and not done(override):
        return override

    current = period_end(today, period, market)
    if done(current):
        _, calendar_end = calendar_period_range(today, period.value)
        return period_end(calendar_end + dt.timedelta(days=1), period, market)

    if last_snapshot is not None:
        calendar_start, _ = calendar_period_range(today, period.value)
        previous = period_end(calendar_start - dt.timedelta(days=1), period, market)
        if not done(previous):
            return previous

    return current


def last_snapshot_at(db: Session, user_id: int) -> dt.datetime | None:
    return (
        db.query(func.max(RebalanceSnapshot.taken_at))
        .filter(RebalanceSnapshot.user_id == user_id)
        .scalar()
    )


def review_status(db: Session, user_id: int, today: dt.date | None = None) -> dict:
    """그 사람의 리뷰 일정 — 주기, 다음 리뷰일, 도래 여부, 마지막 기록."""
    settings = db.get(UserSettings, user_id)
    period = review_period_of(settings)
    base = fx.base_currency(db, user_id)
    market = review_market(base)
    today = today or market_today(market)
    last_at = last_snapshot_at(db, user_id)
    last_day = market_date(last_at, market) if last_at else None
    override = settings.review_date_override if settings else None

    next_date = next_review_date(period, today, market, last_day, override)
    return {
        "period": period.value,
        "next_date": next_date,
        "due": today >= next_date,
        "override": override,
        "last_snapshot_at": last_at,
    }


def _shoulder_flags(
    db: Session, stocks: list[UserStock], today_by_ticker: dict[str, dt.date], period: ReviewPeriod
) -> dict[str, bool]:
    """종목별 "현재 리뷰 기간 안에 어깨매도가 떴는가"를 한 번의 쿼리로 판정한다."""
    if not stocks:
        return {}

    ranges: dict[str, tuple[dt.date, dt.date]] = {}
    for stock in stocks:
        today = today_by_ticker[stock.ticker]
        start, end = period_trading_bounds(today, period.value, market_of_stock(stock))
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


def shoulder_fired_in_current_period(
    db: Session, stock: UserStock, today: dt.date, period: ReviewPeriod = ReviewPeriod.quarterly
) -> bool:
    """이 종목의 현재 리뷰 기간 안에 어깨매도(참고)가 떴는지."""
    return _shoulder_flags(db, [stock], {stock.ticker: today}, period).get(stock.ticker, False)


def cash_amounts(settings: UserSettings | None) -> dict[Currency, float]:
    """설정에 적힌 현금. 모르는 통화나 0 이하는 버린다."""
    out: dict[Currency, float] = {}
    for code, amount in ((settings.cash if settings else None) or {}).items():
        try:
            currency = Currency(str(code).upper())
        except ValueError:
            continue
        if amount and float(amount) > 0:
            out[currency] = float(amount)
    return out


def compute_positions(
    db: Session,
    user_id: int,
    stocks: list[UserStock],
    rate: fx.FxRates | None = None,
    base: Currency | None = None,
) -> dict[str, dict]:
    """그 사람의 종목별 보유수량/평단가/최신 종가/평가금액/손익을 한 번에 계산한다.

    `value`는 종목의 거래 통화 기준, `value_base`는 기준통화로 환산한 값이다.
    비중 계산에는 반드시 `value_base`를 써야 한다.

    손익은 **거래 통화 기준**이다 — 달러로 산 VOO의 수익률은 달러로 재야 한다. 원화로
    환산한 손익은 환율 변동까지 섞이는데, 평단가를 달러로 받았으니 산 날의 환율을 모른다.

    종가는 공용이고 보유수량은 사람마다 다르다 — 같은 VOO라도 A와 B의 수량은 따로다.
    """
    if rate is None:
        rate = fx.get_rates(db, user_id)
    if base is None:
        base = fx.base_currency(db, user_id)

    tickers = [stock.ticker for stock in stocks]
    closes = queries.latest_closes(db, tickers)
    holdings = {
        holding.ticker: holding
        for holding in db.query(Holding)
        .filter(Holding.user_id == user_id, Holding.ticker.in_(tickers))
        .all()
    }

    positions: dict[str, dict] = {}
    for stock in stocks:
        currency = currency_of_stock(stock)
        close = closes.get(stock.ticker)
        holding = holdings.get(stock.ticker)
        qty = holding.quantity if holding else 0.0
        avg_cost = holding.avg_cost if holding else None
        value = (qty * close) if close is not None else 0.0

        cost = qty * avg_cost if avg_cost is not None and qty > 0 else None
        pnl = value - cost if cost is not None and close is not None else None
        return_pct = (pnl / cost * 100) if pnl is not None and cost else None

        positions[stock.ticker] = {
            "quantity": qty,
            "avg_cost": avg_cost,
            "last_close": close,
            "currency": currency,
            "value": value,
            "value_base": fx.convert(value, currency, base, rate),
            "cost_value": cost,
            "unrealized_pnl": pnl,
            "return_pct": return_pct,
        }
    return positions


def compute_actual_weights(db: Session, user_id: int, stocks: list[UserStock]) -> dict[str, float]:
    """기준통화로 환산한 평가금액 기준 실제비중(%). **현금까지 더한 전체 자금 대비다.**

    보유도 현금도 없으면 전 종목 0.0.
    """
    rate = fx.get_rates(db, user_id)
    base = fx.base_currency(db, user_id)
    positions = compute_positions(db, user_id, stocks, rate=rate, base=base)
    cash = sum(
        fx.convert(amount, currency, base, rate)
        for currency, amount in cash_amounts(db.get(UserSettings, user_id)).items()
    )
    total = sum(pos["value_base"] for pos in positions.values()) + cash
    if total <= 0:
        return {ticker: 0.0 for ticker in positions}
    return {ticker: (pos["value_base"] / total) * 100 for ticker, pos in positions.items()}


REASON_REVIEW = "정기 리뷰 도래"
REASON_OVER = "밴드 초과(매도 검토)"
REASON_UNDER = "밴드 미달(매수 검토)"


def compute_rebalance_signal(excess_pct: float, band_pct: float, review_due: bool) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    if review_due:
        reasons.append(REASON_REVIEW)
    if excess_pct > band_pct:
        reasons.append(REASON_OVER)
    elif excess_pct < -band_pct:
        reasons.append(REASON_UNDER)
    return (len(reasons) > 0, reasons)


def compute_rebalance_current(db: Session, user_id: int, today: dt.date | None = None) -> dict:
    """그 사람의 리밸런싱 현황 전체. 기준통화·환율·현금·리뷰 일정과 종목별 행을 함께 돌려준다."""
    stocks = ordered_user_stocks(db, user_id, active_only=True)
    settings = settings_service.get_settings(db, user_id)

    rate = fx.get_rates(db, user_id)
    base = fx.base_currency(db, user_id)
    default_band = settings.default_rebalance_band_pct
    period = review_period_of(settings)
    review = review_status(db, user_id, today=today)

    # "오늘"은 시장 현지 기준으로 판단한다 (호출자가 명시하면 그 값을 그대로 쓴다)
    today_by_ticker = {
        stock.ticker: today or market_today(market_of_stock(stock)) for stock in stocks
    }

    positions = compute_positions(db, user_id, stocks, rate=rate, base=base)
    shoulder_flags = _shoulder_flags(db, stocks, today_by_ticker, period)

    cash = cash_amounts(settings)
    cash_base = sum(fx.convert(amount, currency, base, rate) for currency, amount in cash.items())
    holdings_base = sum(pos["value_base"] for pos in positions.values())
    total_base = holdings_base + cash_base

    def weight(value: float) -> float:
        return (value / total_base * 100) if total_base > 0 else 0.0

    rows = []
    cost_base = 0.0
    priced_base = 0.0  # 평단가를 아는 종목의 평가금액 (손익 합계는 이것끼리만 비교한다)
    for stock in stocks:
        position = positions[stock.ticker]
        actual = weight(position["value_base"])
        excess = actual - stock.target_weight_pct
        band = band_for_stock(stock, default_band)
        active, reasons = compute_rebalance_signal(excess, band, review["due"])

        if position["cost_value"] is not None and position["unrealized_pnl"] is not None:
            cost_base += fx.convert(position["cost_value"], position["currency"], base, rate)
            priced_base += position["value_base"]

        rows.append(
            {
                "ticker": stock.ticker,
                "name": stock.name,
                "currency": position["currency"].value,
                "target_weight_pct": stock.target_weight_pct,
                "actual_weight_pct": actual,
                "excess_pct": excess,
                "band_pct": band,
                "shoulder_signal_fired_in_period": shoulder_flags.get(stock.ticker, False),
                "rebalance_signal": {"active": active, "reasons": reasons},
                "quantity": position["quantity"],
                "avg_cost": position["avg_cost"],
                "last_close": position["last_close"],
                "current_value": position["value"],
                "current_value_base": position["value_base"],
                "cost_value": position["cost_value"],
                "unrealized_pnl": position["unrealized_pnl"],
                "return_pct": position["return_pct"],
            }
        )

    cash_actual = weight(cash_base)
    target_sum = sum(stock.target_weight_pct for stock in stocks) + settings.cash_target_pct
    return {
        "base_currency": base.value,
        "fx": rate.to_dict(),
        "total_value_base": total_base,
        "holdings_value_base": holdings_base,
        # 평단가를 아는 종목끼리의 합계. 하나도 모르면 None (0원 손익으로 보이면 거짓말이다)
        "cost_value_base": cost_base if priced_base > 0 else None,
        "unrealized_pnl_base": (priced_base - cost_base) if priced_base > 0 else None,
        "cash": {
            "amounts": {currency.value: amount for currency, amount in cash.items()},
            "value_base": cash_base,
            "target_pct": settings.cash_target_pct,
            "actual_pct": cash_actual,
            "excess_pct": cash_actual - settings.cash_target_pct,
        },
        "target_sum_pct": target_sum,
        "review": review,
        "rows": rows,
    }


# ---------------------------------------------------------------------------
#  리밸런싱 기록
# ---------------------------------------------------------------------------


class SnapshotRefused(Exception):
    """기록을 남길 수 없는 이유. `hint`는 화면에 그대로 보여줄 말."""

    def __init__(self, hint: str, message: str):
        super().__init__(message)
        self.hint = hint


def take_snapshot(db: Session, user_id: int, note: str | None = None) -> RebalanceSnapshot:
    """지금 리밸런싱 현황을 그대로 얼려서 남긴다.

    **다시 계산하지 않고 계산 결과를 옮겨 담는다.** 나중에 종목을 지우거나 목표를 바꿔도
    이 기록은 그날 화면에 보이던 모습이어야 한다.
    """
    count = db.query(func.count(RebalanceSnapshot.id)).filter(
        RebalanceSnapshot.user_id == user_id
    ).scalar()
    if count >= MAX_SNAPSHOTS:
        raise SnapshotRefused(
            f"기록은 {MAX_SNAPSHOTS}개까지 남길 수 있습니다. 오래된 기록을 지운 뒤 다시 시도하세요.",
            "too many snapshots",
        )

    current = compute_rebalance_current(db, user_id)
    if current["total_value_base"] <= 0:
        raise SnapshotRefused(
            "기록할 자산이 없습니다. 보유수량이나 현금을 먼저 입력하세요.", "empty portfolio"
        )

    data = {
        "rows": [
            {
                key: row[key]
                for key in (
                    "ticker",
                    "name",
                    "currency",
                    "quantity",
                    "avg_cost",
                    "last_close",
                    "current_value",
                    "current_value_base",
                    "target_weight_pct",
                    "actual_weight_pct",
                    "excess_pct",
                    "return_pct",
                )
            }
            for row in current["rows"]
        ],
        "cash": current["cash"],
        "fx": {
            code: quote["krw_rate"] for code, quote in current["fx"]["rates"].items()
        },
        "holdings_value_base": current["holdings_value_base"],
        "unrealized_pnl_base": current["unrealized_pnl_base"],
    }
    snapshot = RebalanceSnapshot(
        user_id=user_id,
        taken_at=dt.datetime.utcnow(),
        review_date=current["review"]["next_date"],
        base_currency=current["base_currency"],
        total_value_base=current["total_value_base"],
        note=(note or "").strip() or None,
        data=data,
    )
    db.add(snapshot)
    db.commit()
    db.refresh(snapshot)
    return snapshot
