import datetime as dt
import enum

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.db import Base
from app.markets import Currency, Market, currency_of, market_of, normalize_ticker


class ReviewPeriod(str, enum.Enum):
    """포트폴리오를 다시 들여다보는 주기. **종목마다가 아니라 포트폴리오 하나에 하나다.**

    예전에는 종목마다 리밸런싱 주기(분기/반기)를 따로 뒀는데, 리밸런싱은 전체 비중을
    한꺼번에 맞추는 일이라 종목별로 다른 날에 할 수가 없다. 칸만 늘고 뜻은 없었다.
    """

    quarterly = "quarterly"
    semiannual = "semiannual"
    annual = "annual"


class User(Base):
    """이 앱을 쓰는 사람.

    **요청에는 언제나 사용자가 있다.** 로그인이 없는 개인 PC에서도 1번 사용자로
    들어온다 (ROADMAP 4단계 0번). `user_id`가 비어 있을 수 있게 두면 모든 쿼리가
    "없으면 전체"라는 분기를 갖게 되고, 그 분기 하나하나가 남의 데이터가 새는 자리다.

    표 이름이 `user`가 아닌 이유: Postgres 예약어라 쓸 때마다 따옴표로 감싸야 한다.
    """

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 구글이 주는 계정 식별자. **이메일이 아니라 이것이 키다** — 이메일은 바뀌고,
    # 조직 계정은 회수돼 다른 사람에게 간다. 로컬 계정(1번)은 비어 있다.
    google_sub: Mapped[str | None] = mapped_column(String, unique=True, nullable=True)
    # 화면에 이름을 띄우기 위해서만 둔다. 식별에 쓰지 않는다.
    email: Mapped[str | None] = mapped_column(String, nullable=True)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, nullable=False)
    last_login_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    # 올리면 그 사람에게 나간 세션 쪽지가 전부 무효가 된다 (탈퇴·강제 로그아웃).
    session_epoch: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # 공용 데이터(매크로·환율·상장목록·전체 갱신)를 고칠 수 있는 사람.
    is_owner: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # 들어와서 쓸 수 있는 사람인가 (`services.users.STATUS_*`). 처음 구글로 들어온 사람은
    # **승인 대기**로 시작하고, 관리자가 사용자 목록에서 승인해야 자기 종목을 담을 수 있다.
    # 승인 대기·거절·차단된 사람의 요청은 로그인 전 손님과 같다 (공용 매크로 보기뿐).
    status: Mapped[str] = mapped_column(String, default="active", server_default="active", nullable=False)


class Instrument(Base):
    """종목 그 자체. **공용 데이터다.**

    VOO가 어느 시장의 무슨 통화 종목인지는 누가 보든 같다. 시세·지표·시그널은 이
    표에 매달린다 — 백 명이 VOO를 담아도 시세는 한 벌만 받는다.
    """

    __tablename__ = "instrument"

    ticker: Mapped[str] = mapped_column(String, primary_key=True)
    # 처음 등록될 때 해석된 종목명. 화면에 보이는 이름은 사람마다 고쳐 쓸 수 있어서
    # `UserStock.name`에 따로 있다 — 여기는 그 사람이 이름을 안 적었을 때의 출발점이다.
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    # 시장/통화는 티커에서 유도되지만(app.markets), 조회할 때마다 파싱하지 않도록 저장해둔다.
    market: Mapped[str] = mapped_column(String, default=Market.US.value, nullable=False)
    currency: Mapped[str] = mapped_column(String, default=Currency.USD.value, nullable=False)

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


class UserStock(Base):
    """한 사람이 담아둔 종목과 그 사람의 설정.

    예전 `stocks` 표는 공용(종목이 무엇인가)과 사용자별(얼마씩, 몇 %로 담나)이 한 줄에
    섞여 있었다. 공용 절반은 `Instrument`로 가고, 여기에는 사람마다 다른 것만 남는다.
    """

    __tablename__ = "user_stock"

    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), primary_key=True)
    ticker: Mapped[str] = mapped_column(String, ForeignKey("instrument.ticker"), primary_key=True)
    # 화면에 보여줄 이름. 사용자가 고쳐 쓸 수 있다 — 야후가 주는 영문 이름 대신 한글로
    # 부르고 싶은 사람이 있고, 그건 남의 화면까지 바꿀 일이 아니다. 비우면 티커로 보인다.
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    # 포트폴리오상 역할 구분(예: 지수/알파/안전자산). 자유 입력이며 대시보드 필터로만 쓰인다.
    category: Mapped[str | None] = mapped_column(String, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    added_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, nullable=False)

    # 전체 자금(현금 포함) 중 이 종목에 두려는 비중. 리밸런싱이 맞추려는 값이다.
    target_weight_pct: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    # 이 종목만 허용 오차를 달리 두고 싶을 때. 비우면 설정의 기본 밴드를 쓴다.
    rebalance_band_pct: Mapped[float | None] = mapped_column(Float, nullable=True)

    # 화면에 보여줄 순서. 사용자가 직접 정한다 — 티커 알파벳순은 "무엇을 먼저 보는가"와
    # 아무 상관이 없다. 값이 같으면 티커순으로 떨어지므로 새 종목은 뒤에 붙는다.
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # 시장·통화를 읽을 때마다 쿼리가 하나씩 늘지 않게 같이 읽어온다.
    instrument: Mapped[Instrument] = relationship(lazy="joined", innerjoin=True)

    @validates("ticker")
    def _normalize_ticker(self, key: str, value: str) -> str:
        return normalize_ticker(value)

    @property
    def market(self) -> str:
        return self.instrument.market

    @property
    def currency(self) -> str:
        return self.instrument.currency


class PriceDaily(Base):
    __tablename__ = "price_daily"
    __table_args__ = (UniqueConstraint("ticker", "date", name="uq_price_ticker_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticker: Mapped[str] = mapped_column(String, ForeignKey("instrument.ticker"), nullable=False, index=True)
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
    ticker: Mapped[str] = mapped_column(String, ForeignKey("instrument.ticker"), nullable=False, index=True)
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
    ticker: Mapped[str] = mapped_column(String, ForeignKey("instrument.ticker"), nullable=False, index=True)
    date: Mapped[dt.date] = mapped_column(Date, nullable=False, index=True)
    knee_buy_v2: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    shoulder_sell_ref: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class Holding(Base):
    """보유수량과 평단가. **사용자별이다.**

    외래키가 `(user_id, ticker)` → `user_stock`인 이유: 내 목록에 없는 종목의 보유는
    뜻이 없다. 종목을 목록에서 빼려면 이 행을 먼저 치워야 한다.
    """

    __tablename__ = "holding"
    __table_args__ = (
        ForeignKeyConstraint(["user_id", "ticker"], ["user_stock.user_id", "user_stock.ticker"]),
    )

    user_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ticker: Mapped[str] = mapped_column(String, primary_key=True)
    quantity: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    # 평균 매입단가 (종목의 거래 통화 기준). **리밸런싱에는 쓰이지 않는다** — 비중은 수량 ×
    # 현재가로 정해진다. 평가손익·수익률을 보여주는 데만 쓴다. 모르면 비워둔다.
    avg_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, nullable=False)


class UserSettings(Base):
    """한 사람의 포트폴리오 설정. 예전 `portfolio_settings`(한 줄짜리)가 사람마다 한 줄이 됐다."""

    __tablename__ = "user_settings"

    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), primary_key=True)
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

    # 포트폴리오를 다시 들여다보는 주기 (ReviewPeriod). Enum 타입 대신 문자열로 둔다 —
    # Postgres에서 Enum은 DB에 따로 사는 타입이라, 값 하나 늘릴 때마다 리비전이 그 타입을
    # 고쳐야 한다(0005가 겪었다). 값은 스키마(pydantic)가 거른다.
    review_period: Mapped[str] = mapped_column(
        String, default=ReviewPeriod.quarterly.value, nullable=False
    )
    # 다음 리뷰일을 직접 정할 때 (세금 정산일 따위). 그날 무렵 기록을 남기면 다시 주기로 돌아간다.
    review_date_override: Mapped[dt.date | None] = mapped_column(Date, nullable=True)

    # 현금. 통화코드 -> 금액 (`{"KRW": 3000000, "USD": 1200}`). **목표비중은 전체 자금 중의
    # 비중**이라 현금이 빠지면 합계가 틀린다 — 주식만 더하면 "100% 투자"가 된다.
    cash: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # 현금으로 남겨둘 비중(%). 종목 목표비중과 합쳐 100이 되게 맞춘다.
    cash_target_pct: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    # 받을 푸시 알림의 종류 (`services.alerts.KINDS`). **`None` 은 "다 받는다"** — 켜기만 하면
    # 오게. `[]` 은 일부러 다 끈 것이다 (기기의 구독은 남는다). `pinned_macro` 와 같은 약속.
    push_kinds: Mapped[list | None] = mapped_column(JSON, nullable=True)


class RebalanceSnapshot(Base):
    """리밸런싱 기록 — 리뷰할 때 남긴 포트폴리오의 모습. **사용자별이고, 다시 만들 수 없다.**

    지금 비중은 언제나 실시간 계산이고 보유수량은 덮어쓰기라, 기록을 남기지 않으면 지난
    분기에 어땠는지 복원할 방법이 없다 (ROADMAP 2-1). 그래서 계산 결과를 **그대로 얼려서**
    둔다 — 종목·수량·가격·비중·목표·환율을 한 덩어리로. 나중에 종목을 지우거나 목표를
    바꿔도 이 기록은 그때 모습 그대로여야 하므로 다른 표를 가리키지 않는다.
    """

    __tablename__ = "rebalance_snapshot"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    taken_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, nullable=False)
    # 이 기록이 어느 리뷰(마감일)를 위한 것이었나. 그때 화면에 떠 있던 다음 리뷰일이다.
    review_date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    base_currency: Mapped[str] = mapped_column(String, nullable=False)
    total_value_base: Mapped[float] = mapped_column(Float, nullable=False)
    note: Mapped[str | None] = mapped_column(String, nullable=True)
    # 종목 행·현금·환율. 한 번 쓰고 고치지 않는다.
    data: Mapped[dict] = mapped_column(JSON, nullable=False)


class PushSubscription(Base):
    """알림을 받을 기기 하나 — 브라우저가 준 푸시 주소와 열쇠 (services/push.py).

    **주소(`endpoint`)가 곧 기기다.** 한 기기에서 계정을 바꿔 다시 켜면 같은 주소가 새 사람에게
    넘어간다 — 알림은 마지막으로 켠 사람 것만 간다. 나가기를 누르면 화면이 먼저 지운다.
    """

    __tablename__ = "push_subscription"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    endpoint: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    # 그 기기의 공개키와 비밀값. 내용을 그 기기만 풀 수 있게 싸는 데 쓴다.
    p256dh: Mapped[str] = mapped_column(String, nullable=False)
    auth: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, nullable=False)
    # 마지막으로 닿은 때. 진단에서 "켜 뒀는데 안 온다"를 가를 때 본다.
    last_ok_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)


class PushState(Base):
    """무엇을 이미 알렸나. **바뀐 순간에만 울린다** — 같은 과중 신호로 매일 아침 울리면 끈다.

    `subject` 는 알림거리 하나(`buy:VOO`, `band:VOO`, `review`), `value` 는 마지막으로 본 값
    (시그널 날짜, `over`/`under`/빈 값, 리뷰일). 값이 달라지고 새 값이 비어 있지 않을 때 알린다.
    """

    __tablename__ = "push_state"

    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), primary_key=True)
    subject: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(String, default="", nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, nullable=False)


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
    # 표에 섞으면 안 되고, 그래서 `pinned_macro` 는 `user_settings` 로 갔다.)
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
    return (UserStock.sort_order.asc(), UserStock.ticker.asc())
