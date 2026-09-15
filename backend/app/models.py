import datetime as dt
import enum

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class DcaPeriod(str, enum.Enum):
    monthly = "monthly"
    quarterly = "quarterly"


class RebalancePeriod(str, enum.Enum):
    quarterly = "quarterly"
    semiannual = "semiannual"


class BuyType(str, enum.Enum):
    signal = "signal"
    fallback = "fallback"


class BuyStatus(str, enum.Enum):
    recommended = "recommended"
    confirmed = "confirmed"


class Stock(Base):
    __tablename__ = "stocks"

    ticker: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    # 포트폴리오상 역할 구분(예: 지수/알파/안전자산). 자유 입력이며 대시보드 필터로만 쓰인다.
    category: Mapped[str | None] = mapped_column(String, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    added_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, nullable=False)

    dca_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    dca_period: Mapped[DcaPeriod] = mapped_column(Enum(DcaPeriod), default=DcaPeriod.monthly, nullable=False)

    rebalance_period: Mapped[RebalancePeriod] = mapped_column(
        Enum(RebalancePeriod), default=RebalancePeriod.quarterly, nullable=False
    )
    target_weight_pct: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    rebalance_band_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    review_date_override: Mapped[dt.date | None] = mapped_column(Date, nullable=True)


class PriceDaily(Base):
    __tablename__ = "price_daily"
    __table_args__ = (UniqueConstraint("ticker", "date", name="uq_price_ticker_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticker: Mapped[str] = mapped_column(String, ForeignKey("stocks.ticker"), nullable=False, index=True)
    date: Mapped[dt.date] = mapped_column(Date, nullable=False, index=True)
    open: Mapped[float] = mapped_column(Float, nullable=False)
    high: Mapped[float] = mapped_column(Float, nullable=False)
    low: Mapped[float] = mapped_column(Float, nullable=False)
    close: Mapped[float] = mapped_column(Float, nullable=False)
    adj_close: Mapped[float | None] = mapped_column(Float, nullable=True)
    volume: Mapped[float] = mapped_column(Float, nullable=False)


class IndicatorDaily(Base):
    __tablename__ = "indicator_daily"
    __table_args__ = (UniqueConstraint("ticker", "date", name="uq_indicator_ticker_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticker: Mapped[str] = mapped_column(String, ForeignKey("stocks.ticker"), nullable=False, index=True)
    date: Mapped[dt.date] = mapped_column(Date, nullable=False, index=True)

    ma5: Mapped[float | None] = mapped_column(Float, nullable=True)
    ma20: Mapped[float | None] = mapped_column(Float, nullable=True)
    ma50: Mapped[float | None] = mapped_column(Float, nullable=True)
    ma200: Mapped[float | None] = mapped_column(Float, nullable=True)
    stddev20: Mapped[float | None] = mapped_column(Float, nullable=True)
    vol_ma5: Mapped[float | None] = mapped_column(Float, nullable=True)
    vol_ma20: Mapped[float | None] = mapped_column(Float, nullable=True)
    vol_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    roc5: Mapped[float | None] = mapped_column(Float, nullable=True)
    disparity: Mapped[float | None] = mapped_column(Float, nullable=True)
    plus_di: Mapped[float | None] = mapped_column(Float, nullable=True)
    minus_di: Mapped[float | None] = mapped_column(Float, nullable=True)
    adx: Mapped[float | None] = mapped_column(Float, nullable=True)


class SignalDaily(Base):
    __tablename__ = "signal_daily"
    __table_args__ = (UniqueConstraint("ticker", "date", name="uq_signal_ticker_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticker: Mapped[str] = mapped_column(String, ForeignKey("stocks.ticker"), nullable=False, index=True)
    date: Mapped[dt.date] = mapped_column(Date, nullable=False, index=True)
    knee_buy_v2: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    shoulder_sell_ref: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class BuyExecution(Base):
    __tablename__ = "buy_execution"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticker: Mapped[str] = mapped_column(String, ForeignKey("stocks.ticker"), nullable=False, index=True)
    period_start: Mapped[dt.date] = mapped_column(Date, nullable=False)
    period_end: Mapped[dt.date] = mapped_column(Date, nullable=False)
    exec_date: Mapped[dt.date] = mapped_column(Date, nullable=False)
    type: Mapped[BuyType] = mapped_column(Enum(BuyType), nullable=False)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[BuyStatus] = mapped_column(Enum(BuyStatus), default=BuyStatus.recommended, nullable=False)
    confirmed_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)


class RebalanceReview(Base):
    __tablename__ = "rebalance_review"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    review_date: Mapped[dt.date] = mapped_column(Date, nullable=False)
    ticker: Mapped[str] = mapped_column(String, ForeignKey("stocks.ticker"), nullable=False, index=True)
    target_weight_pct: Mapped[float] = mapped_column(Float, nullable=False)
    actual_weight_pct: Mapped[float] = mapped_column(Float, nullable=False)
    excess_pct: Mapped[float] = mapped_column(Float, nullable=False)
    shoulder_signal_fired_in_period: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class Holding(Base):
    __tablename__ = "holding"

    ticker: Mapped[str] = mapped_column(String, ForeignKey("stocks.ticker"), primary_key=True)
    quantity: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, nullable=False)


class PortfolioSettings(Base):
    __tablename__ = "portfolio_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    default_rebalance_band_pct: Mapped[float] = mapped_column(Float, default=5.0, nullable=False)
