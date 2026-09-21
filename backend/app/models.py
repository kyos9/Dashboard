import datetime as dt
import enum

from sqlalchemy import (
    JSON,
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

    # 사용자가 직접 지정한 환율. 통화코드 -> 원화 환율 (`{"USD": 1380, "JPY": 9.3}`).
    # 있으면 자동 조회값보다 우선한다.
    #
    # **조회해온 시세(FxRate 테이블)와 여기를 나눠 둔 이유**: 시세는 누구에게나 같은
    # 공용 값이고 다시 받아오면 되지만, "내가 환전한 환율로 계산하겠다"는 사용자별
    # 선택이다. 사용자를 나누는 날(ROADMAP 4단계) 이 열만 따라가면 된다.
    fx_overrides: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # 홈 화면에 띄울 매크로 지표 코드 목록 (순서 있음). `MacroSeries.code` 를 가리킨다.
    #
    # **`None` 과 `[]` 는 다른 뜻이다.**
    #   None -> 아직 안 건드렸다  -> 기본값(macro.DEFAULT_PINNED)을 보여준다
    #   []   -> 일부러 다 껐다    -> 아무것도 안 보여준다
    #   [..] -> 고른 것을 그 순서대로
    # 둘을 합치면 "홈에서 매크로를 빼겠다"는 선택이 불가능해진다 — 껐는데 기본값이
    # 다시 뜨는 화면은 설정이 아니라 고장으로 보인다.
    #
    # 자리가 여기인 이유는 `fx_overrides` 와 같다. 어떤 지표가 존재하는지(MacroSeries)는
    # 누구에게나 같은 공용 데이터지만, 그 중 무엇을 홈에 둘지는 사용자별 선택이다.
    # 공용 테이블에 사용자별 상태를 섞는 것이 ROADMAP 1절이 지적한 `stocks` 의 실수다.
    pinned_macro: Mapped[list | None] = mapped_column(JSON, nullable=True)


class FxRate(Base):
    """통화별 "1단위 = 몇 원". **공용 데이터다.**

    사용자가 백 명이어도 어제 달러 환율은 하나다. 그리고 잃어버려도 다시 받아오면
    되는 값이라, 사용자를 나눌 때 옮겨야 할 것이 없다 (ROADMAP 1절의 두 번째 질문).

    원을 축으로 두는 이유: 통화가 셋만 돼도 짝은 여섯이 된다. 전부 저장하는 대신
    "각 통화의 원화 환산값" 하나씩만 두고, 엔→달러 같은 것은 원을 거쳐 계산한다.
    """

    __tablename__ = "fx_rate"

    currency: Mapped[str] = mapped_column(String, primary_key=True)
    krw_rate: Mapped[float] = mapped_column(Float, nullable=False)
    # 어디서 온 값인지 — fetched(조회 성공) 뿐이지만, 나중에 출처가 늘 수 있다
    source: Mapped[str] = mapped_column(String, default="fetched", nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime, default=dt.datetime.utcnow, nullable=False
    )


class MacroFrequency(str, enum.Enum):
    """지표가 얼마나 자주 갱신되는가. 매일 도는 배치가 "받을 때가 됐는지"를 이걸 보고 고른다."""

    daily = "daily"
    weekly = "weekly"
    monthly = "monthly"
    quarterly = "quarterly"


class MacroUnit(str, enum.Enum):
    """값을 화면에 어떻게 읽어야 하는가."""

    percent = "percent"  # 이미 % 단위 (금리)
    index = "index"      # 지수 레벨 (CPI 320.541) — 보여줄 때는 보통 전년비로 바꾼다
    level = "level"      # 그냥 숫자 (VIX 18.4)


class MacroTransform(str, enum.Enum):
    """저장된 원본을 화면에 올릴 때 거치는 변환.

    **원본을 저장하고 변환은 우리가 한다.** FRED API 에 전년비로 바꿔주는 옵션이 있지만
    쓰지 않는다 — 원본을 쥐고 있으면 나중에 다른 계산(3개월 연율 같은 것)이 필요할 때
    데이터를 다시 안 받아도 되고, 제공자가 바뀌어도 저장된 값의 의미가 안 변한다.
    시세를 배당 미조정 종가로 저장하는 것과 같은 이유다.
    """

    none = "none"
    yoy = "yoy"  # 전년 대비 %
    mom = "mom"  # 전월 대비 %


class MacroSeries(Base):
    """어떤 지표가 있는지. **공용 데이터다** — 사용자가 백 명이어도 CPI 는 하나다.

    지표를 늘릴 때 **코드를 고치지 않고 이 표에 행만 추가**하면 되도록 쪼갰다.
    프런트도 이 표를 읽어 화면을 만든다. 그래서 "어떻게 보여줄지"(`note`, `unit`,
    `transform`, `display_order`)까지 여기 들어 있다.
    """

    __tablename__ = "macro_series"

    # 우리가 부르는 이름. 제공자 코드(`source_code`)와 일부러 분리했다 — 출처가 바뀌어도
    # 설정(`pinned_macro`)과 화면이 가리키는 이름은 그대로여야 한다.
    code: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    # 카드에 이름 옆에 붙는 한 줄 설명 ("연준이 보는 물가"). 없으면 안 붙는다.
    note: Mapped[str | None] = mapped_column(String, nullable=True)

    # 먼저 시도할 제공자와 그쪽에서 부르는 코드.
    source: Mapped[str] = mapped_column(String, nullable=False)
    source_code: Mapped[str] = mapped_column(String, nullable=False)
    # 거기가 막혔을 때 갈 곳. 없으면 None.
    #
    # 아무 데나 넣으면 안 된다 — 야후의 `^TNX` 는 10년물 금리를 **10배로** 들고 있어서
    # (4.2% -> 42.0) 그대로 폴백으로 쓰면 값이 조용히 열 배가 된다. 같은 단위·같은
    # 정의라고 확인한 짝만 넣는다.
    fallback_source: Mapped[str | None] = mapped_column(String, nullable=True)
    fallback_code: Mapped[str | None] = mapped_column(String, nullable=True)

    unit: Mapped[str] = mapped_column(String, default=MacroUnit.level.value, nullable=False)
    transform: Mapped[str] = mapped_column(String, default=MacroTransform.none.value, nullable=False)
    frequency: Mapped[str] = mapped_column(
        String, default=MacroFrequency.daily.value, nullable=False
    )

    display_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # --- 마지막 갱신이 어떻게 됐는지 -------------------------------------
    #
    # 같은 표에 두는 이유: 지표 하나에 상태도 하나라 1:1 이고, 따로 표를 만들면 화면을
    # 그릴 때마다 조인이 하나 는다. (사용자별 상태였다면 얘기가 다르다 — 그건 공용
    # 표에 섞으면 안 되고, 그래서 `pinned_macro` 는 `portfolio_settings` 로 갔다.)
    #
    # **`MacroValue.fetched_at` 으로는 이걸 대신할 수 없다.** 그쪽은 값이 실제로
    # 바뀌었을 때만 갱신된다 — 값이 그대로면 아무 흔적이 안 남아서, "받아봤는데 새 게
    # 없었다"와 "아예 못 받았다"가 구분되지 않는다. 그 둘은 사용자가 할 일이 다르다.
    last_checked_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    last_ok_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    # 마지막 실패 사유. 성공하면 지운다 — 남겨두면 이미 해결된 문제를 화면이 계속 띄운다.
    last_error: Mapped[str | None] = mapped_column(String, nullable=True)


class MacroValue(Base):
    """실제로 발표된 값. **공용 데이터다.**

    `as_of` 와 `released_at` 을 **둘 다** 둔다. CPI·PCE 는 발표된 뒤에도 수정된다 —
    8월 PCE 가 9월에 2.8% 로 나왔다가 10월에 2.9% 로 고쳐지는 일이 흔하다.

    지금은 "현재 상황 파악"이 목적이라 최신값이면 되고 이 컬럼은 아무 데도 안 쓰인다.
    문제는 나중에 "매크로가 나빴을 때 무릎매수 성적이 어땠나"를 볼 때다. 수정된 값으로
    과거를 판단하면 *그 시점에 알 수 없던 정보로 판단한 셈*이 되어 결과가 실제보다 좋게
    나온다. 나중에 컬럼을 추가하면 데이터를 전부 다시 받아야 하는데, 컬럼 하나는 지금
    넣으면 공짜다.
    """

    __tablename__ = "macro_value"
    __table_args__ = (UniqueConstraint("code", "as_of", name="uq_macro_value_code_as_of"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(
        String, ForeignKey("macro_series.code"), nullable=False, index=True
    )
    # 언제를 가리키는 값인가 (2026년 8월 CPI -> 2026-08-01)
    as_of: Mapped[dt.date] = mapped_column(Date, nullable=False, index=True)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    # 그 값이 세상에 공개된 날. 제공자가 알려줄 때만 채워진다 (FRED CSV 는 안 준다).
    released_at: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    # 우리가 받아온 시각. 수정본으로 덮어썼을 때 언제 덮었는지가 여기 남는다.
    fetched_at: Mapped[dt.datetime] = mapped_column(
        DateTime, default=dt.datetime.utcnow, nullable=False
    )
    source: Mapped[str | None] = mapped_column(String, nullable=True)


class MacroForecast(Base):
    """예측치. **공용 데이터다.**

    예상치가 없으면 "CPI 3.1%" 가 좋은 숫자인지 나쁜 숫자인지 알 수 없다. 시장이
    움직이는 건 예상 대비 어긋난 폭이다.

    `forecast_date`(언제 한 예측인가)를 따로 두는 이유: 나우캐스트는 **매일 바뀐다.**
    한 칸에 덮어쓰면 "발표 직전에 시장이 뭘 예상하고 있었나"가 사라진다. 날짜별로 쌓으면
    예상이 어떻게 움직였는지도 볼 수 있고, 저장 비용은 거의 없다.
    """

    __tablename__ = "macro_forecast"
    __table_args__ = (
        UniqueConstraint(
            "code", "as_of", "source", "forecast_date", name="uq_macro_forecast_key"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(
        String, ForeignKey("macro_series.code"), nullable=False, index=True
    )
    # 어느 시점의 값을 예측한 것인가 (MacroValue.as_of 와 같은 축)
    as_of: Mapped[dt.date] = mapped_column(Date, nullable=False, index=True)
    # 누가 한 예측인가: cleveland_fed(자동) / manual(직접 입력) / ...
    source: Mapped[str] = mapped_column(String, nullable=False)
    # 언제 시점의 예측인가
    forecast_date: Mapped[dt.date] = mapped_column(Date, nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, default=dt.datetime.utcnow, nullable=False
    )


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
