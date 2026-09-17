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
from sqlalchemy.orm import Mapped, mapped_column, validates

from app.db import Base
from app.markets import Currency, Market, currency_of, market_of, normalize_ticker


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
    # 이 앱은 종목을 고르지도, 사라고 권하지도 않는다. 사용자가 정해둔 금액·주기와
    # 사용자가 정한 조건이 맞아떨어진 날을 잡아둘 뿐이라 "예정(scheduled)"이라 부른다.
    # (예전 이름은 recommended였다 — db._rename_buy_status가 옛 DB 값을 바꿔준다.)
    scheduled = "scheduled"
    confirmed = "confirmed"


class Stock(Base):
    __tablename__ = "stocks"

    ticker: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    # 포트폴리오상 역할 구분(예: 지수/알파/안전자산). 자유 입력이며 대시보드 필터로만 쓰인다.
    category: Mapped[str | None] = mapped_column(String, nullable=True)
    # 시장/통화는 티커에서 유도되지만(app.markets), 조회할 때마다 파싱하지 않도록 저장해둔다.
    # Enum이 아니라 String인 이유: 기존 DB 파일에 ALTER TABLE ADD COLUMN으로 붙여야 해서
    # CHECK 제약이 따라붙지 않는 단순 타입이 필요하다.
    market: Mapped[str] = mapped_column(String, default=Market.US.value, nullable=False)
    currency: Mapped[str] = mapped_column(String, default=Currency.USD.value, nullable=False)
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

    # 화면에 보여줄 순서. 사용자가 직접 정한다 — 티커 알파벳순은 "무엇을 먼저 보는가"와
    # 아무 상관이 없다. 값이 같으면 티커순으로 떨어지므로 새 종목은 뒤에 붙는다.
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    @validates("ticker")
    def _sync_market_and_currency(self, key: str, value: str) -> str:
        """티커가 정해지면 시장/통화도 함께 정한다.

        둘을 따로 세팅하게 두면 언젠가 한쪽만 채워진 행이 생기고, 그러면 원화 종목이
        달러로 잡혀 비중이 조용히 틀어진다. 티커가 유일한 진실이므로 여기서 묶어둔다.
        """
        ticker = normalize_ticker(value)
        self.market = market_of(ticker).value
        self.currency = currency_of(ticker).value
        return ticker


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
    # 이 행을 어느 제공자가 줬는지. 제공자마다 종가 기준이 다를 수 있어서, 한 종목의
    # 히스토리에 여러 출처가 섞이면 이어붙인 지점에서 지표가 튄다. 기록해두지 않으면
    # 값이 이상할 때 그게 원인인지 사후에 알아낼 방법이 없다.
    # 이 컬럼이 생기기 전에 저장된 행은 None이다.
    source: Mapped[str | None] = mapped_column(String, nullable=True)


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
    status: Mapped[BuyStatus] = mapped_column(Enum(BuyStatus), default=BuyStatus.scheduled, nullable=False)
    confirmed_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)


class Holding(Base):
    __tablename__ = "holding"

    ticker: Mapped[str] = mapped_column(String, ForeignKey("stocks.ticker"), primary_key=True)
    quantity: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, nullable=False)


class PortfolioSettings(Base):
    __tablename__ = "portfolio_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    default_rebalance_band_pct: Mapped[float] = mapped_column(Float, default=5.0, nullable=False)

    # 통화가 섞인 포트폴리오의 비중을 계산할 기준통화. 평가금액은 모두 이 통화로 환산한 뒤
    # 합산한다 (환산 없이 더하면 비중이 완전히 틀어진다).
    base_currency: Mapped[str] = mapped_column(String, default=Currency.KRW.value, nullable=False)
    # 사용자가 직접 지정한 환율. 있으면 자동 조회값보다 우선한다.
    usd_krw_override: Mapped[float | None] = mapped_column(Float, nullable=True)
    # 마지막으로 조회에 성공한 환율과 그 시각
    usd_krw_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    usd_krw_updated_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)


class KrxListing(Base):
    """한국거래소 상장 종목 캐시 (종목명 -> 티커 해석용).

    KRX에서 받아온 목록을 저장해두면 다음부터는 네트워크 없이도 이름으로 찾을 수 있다.
    번들 시드(`app/data/krx_seed.json`)와 합쳐서 검색한다.
    """

    __tablename__ = "krx_listing"

    code: Mapped[str] = mapped_column(String, primary_key=True)  # 6자리 종목코드
    name: Mapped[str] = mapped_column(String, nullable=False, index=True)
    board: Mapped[str] = mapped_column(String, nullable=False)  # KOSPI / KOSDAQ / KONEX
    instrument: Mapped[str] = mapped_column(String, default="STOCK", nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, nullable=False)


def stock_order():
    """종목을 화면에 보여줄 순서.

    사용자가 정한 순서를 먼저 쓰고, 같은 값이면 티커순으로 떨어뜨린다. 정렬 기준을
    한 곳에 모아두지 않으면 화면마다 순서가 달라져 같은 포트폴리오가 다르게 보인다.
    """
    return (Stock.sort_order.asc(), Stock.ticker.asc())
