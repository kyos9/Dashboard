import datetime as dt
from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.markets import Currency, Market
from app.models import BuyStatus, BuyType, DcaPeriod, RebalancePeriod


class SymbolMatchOut(BaseModel):
    """종목 검색 결과 한 건.

    `confident=False`면 시장(코스피/코스닥)이 확정되지 않은 추정이라는 뜻 —
    화면에서 사용자가 직접 골라야 한다.
    """

    ticker: str
    name: str
    market: Market
    board: Optional[str] = None
    instrument: str = "STOCK"
    source: str
    confident: bool = True


class StockCreate(BaseModel):
    # 티커(`VOO`, `005930.KS`)뿐 아니라 종목명("삼성전자")이나 6자리 코드도 받는다.
    # 티커가 아니면 서버가 해석하며, 해석 결과는 응답의 `resolved_from`으로 확인할 수 있다.
    ticker: str
    name: Optional[str] = None
    category: Optional[str] = None
    dca_amount: float = 0.0
    dca_period: DcaPeriod = DcaPeriod.monthly
    rebalance_period: RebalancePeriod = RebalancePeriod.quarterly
    target_weight_pct: float = 0.0
    rebalance_band_pct: Optional[float] = None
    review_date_override: Optional[dt.date] = None


class StockUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    active: Optional[bool] = None
    dca_amount: Optional[float] = None
    dca_period: Optional[DcaPeriod] = None
    rebalance_period: Optional[RebalancePeriod] = None
    target_weight_pct: Optional[float] = None
    rebalance_band_pct: Optional[float] = None
    review_date_override: Optional[dt.date] = None


class StockOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    ticker: str
    name: Optional[str]
    category: Optional[str]
    market: Market = Market.US
    currency: Currency = Currency.USD
    active: bool
    added_at: dt.datetime
    dca_amount: float
    dca_period: DcaPeriod
    rebalance_period: RebalancePeriod
    target_weight_pct: float
    rebalance_band_pct: Optional[float]
    review_date_override: Optional[dt.date]
    sort_order: int = 0


class StockOrderUpdate(BaseModel):
    """화면에 보여줄 순서. 받은 목록의 차례가 곧 순서다."""

    tickers: list[str]


class StockCreateResult(BaseModel):
    """종목 등록 결과 + 최초 시세 백필이 실제로 성공했는지.

    백필에 실패해도 등록 자체는 유지하지만, 화면에서 "추가 완료"라고만 알리면 지표가 비어
    있는 이유를 알 수 없다. 실패 사유를 함께 돌려줘 다시 시도하도록 안내한다.
    """

    stock: StockOut
    data_loaded: bool
    data_error: Optional[str] = None  # 제공자별 기술적 원인
    data_hint: Optional[str] = None  # 사용자가 다음에 할 일
    # 이름으로 등록했을 때 사용자가 입력한 원문 (예: "삼성전자" -> 005930.KS)
    resolved_from: Optional[str] = None


class LatestIndicators(BaseModel):
    date: Optional[dt.date] = None
    close: Optional[float] = None
    prev_close: Optional[float] = None
    change_pct: Optional[float] = None
    ma5: Optional[float] = None
    ma20: Optional[float] = None
    ma50: Optional[float] = None
    ma200: Optional[float] = None
    stddev20: Optional[float] = None
    vol_ratio: Optional[float] = None
    roc5: Optional[float] = None
    disparity: Optional[float] = None
    plus_di: Optional[float] = None
    minus_di: Optional[float] = None
    adx: Optional[float] = None


class PendingBuy(BaseModel):
    id: int
    type: BuyType
    status: BuyStatus
    exec_date: dt.date
    amount: float


class RebalanceSignal(BaseModel):
    active: bool
    reasons: list[str] = []


class KneeConditions(BaseModel):
    """무릎매수(v2)를 이루는 네 조건의 개별 충족 여부.

    시그널이 왜 떴는지/왜 안 떴는지를 화면에서 바로 알 수 있게 분해해서 내려준다.
    (SIGNAL_APP_SPEC.md 3장의 조건식과 1:1 대응)
    """

    di_bearish: Optional[bool] = None  # -DI > +DI
    disparity_negative: Optional[bool] = None  # 이격도 < 0
    volatility_or_volume: Optional[bool] = None  # StdDev20 축소 또는 거래량비 > 1.1
    adx_trending: Optional[bool] = None  # ADX > 20


class DashboardCard(BaseModel):
    ticker: str
    name: Optional[str]
    category: Optional[str] = None
    market: Market = Market.US
    currency: Currency = Currency.USD
    data_stale: bool = False
    # 최신 종가를 어느 제공자가 줬는지. 값이 이상할 때 어디를 볼지 알려준다.
    price_source: Optional[str] = None
    indicators: LatestIndicators
    knee_buy_v2: bool = False
    knee_conditions: KneeConditions = KneeConditions()
    shoulder_sell_ref: bool = False
    current_period_buy: Optional[PendingBuy] = None
    rebalance_signal: RebalanceSignal = RebalanceSignal(active=False, reasons=[])


class HistoryPoint(BaseModel):
    date: dt.date
    close: float


class HistoryMarker(BaseModel):
    """시그널이 뜬 날. 차트에 점 하나로 찍힌다."""

    date: dt.date
    kind: str  # "buy" | "sell"


class HistoryCoverage(BaseModel):
    """이 종목에 대해 실제로 저장돼 있는 시세 구간 (요청한 범위와 무관한 전체 기준)."""

    first_date: Optional[dt.date] = None
    last_date: Optional[dt.date] = None
    rows: int = 0


class HistoryResponse(BaseModel):
    ticker: str
    prices: list[HistoryPoint]
    markers: list[HistoryMarker]
    coverage: HistoryCoverage


class HoldingUpdate(BaseModel):
    quantity: float


class HoldingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    ticker: str
    quantity: float
    updated_at: dt.datetime


class QuoteOut(BaseModel):
    """한 통화의 원화 환산값과 그 출처."""

    currency: Currency
    krw_rate: float
    source: str  # override | stored | fetched | fallback
    updated_at: Optional[str] = None
    is_estimate: bool = False


class FxOut(BaseModel):
    """적용 중인 환율 묶음.

    `is_estimate=True`면 어느 통화든 조회에 실패하고 저장된 값도 없어 폴백 상수를 쓰는
    중이라는 뜻 — 화면에서 추정치임을 반드시 알려야 한다.
    """

    rates: dict[str, QuoteOut] = {}
    is_estimate: bool = False


class SettingsUpdate(BaseModel):
    default_rebalance_band_pct: Optional[float] = None
    base_currency: Optional[Currency] = None
    # 통화코드 -> 직접 입력한 환율. 값에 null을 주면 그 통화만 자동 조회로 돌아간다
    # (`{"USD": 1380, "JPY": null}`). 보내지 않은 통화는 건드리지 않는다.
    fx_overrides: Optional[dict[str, Optional[float]]] = None


class SettingsOut(BaseModel):
    default_rebalance_band_pct: float
    base_currency: Currency = Currency.KRW
    fx_overrides: dict[str, float] = {}
    fx: FxOut


class RebalanceRow(BaseModel):
    ticker: str
    name: Optional[str] = None
    currency: Currency = Currency.USD
    target_weight_pct: float
    actual_weight_pct: float
    excess_pct: float
    next_review_date: dt.date
    shoulder_signal_fired_in_period: bool
    rebalance_signal: RebalanceSignal
    # 주문 가이드 계산용 — 보유수량 x 최신 종가 (해당 종목의 거래 통화 기준)
    quantity: float = 0.0
    last_close: Optional[float] = None
    current_value: float = 0.0
    # 비중 계산에 쓰이는 기준통화 환산 평가금액
    current_value_base: float = 0.0


class RebalanceCurrentOut(BaseModel):
    """리밸런싱 현황 전체.

    통화가 섞인 포트폴리오에서는 "얼마짜리 포트폴리오인지"가 기준통화와 환율에 달려
    있으므로, 행만 주지 않고 그 전제까지 함께 내려준다.
    """

    base_currency: Currency
    fx: FxOut
    total_value_base: float
    rows: list[RebalanceRow]


class RefreshResult(BaseModel):
    ticker: str
    ok: bool
    rows_upserted: Optional[int] = None
    error: Optional[str] = None  # 제공자별 기술적 원인
    hint: Optional[str] = None  # 사용자가 다음에 할 일


class ConfirmBuyRequest(BaseModel):
    apply_to_holding: bool = True


class RebalanceTargetOut(BaseModel):
    ticker: str
    target_weight_pct: float
    rebalance_band_pct: Optional[float]
    rebalance_period: RebalancePeriod
    review_date_override: Optional[dt.date]


class RebalanceTargetUpdate(BaseModel):
    target_weight_pct: Optional[float] = None
    rebalance_band_pct: Optional[float] = None
    rebalance_period: Optional[RebalancePeriod] = None
    review_date_override: Optional[dt.date] = None


class LogEntry(BaseModel):
    time: str
    level: str
    logger: str
    message: str


class LogsOut(BaseModel):
    available: bool  # 파일이 있고 읽혔는지
    path: str
    size_bytes: int
    modified_at: Optional[dt.datetime]
    level: str  # 걸러낸 기준 (warning | all)
    entries: list[LogEntry]  # 최신이 앞
    counts: dict[str, int]  # 읽어들인 구간의 레벨별 건수


# --- 매크로 지표 -----------------------------------------------------------


class MacroPointOut(BaseModel):
    """차트에 찍을 점 하나. **변환까지 끝난 값**이다 (CPI 라면 지수가 아니라 전년비)."""

    as_of: dt.date
    value: float


class MacroZoneOut(BaseModel):
    """값이 어느 구간인가. **구간을 정해서 발표하는 지표에만** 붙는다.

    금리 4.2%가 어느 구간인지는 아무도 정해놓지 않았고, 우리가 정하면 그건 출처 없는
    판정이 된다. 지금은 공포·탐욕 지수 하나뿐이다 (`services/regime.py`).
    """

    label: str
    # 화면에 같이 적는 범위 ("25~44"). 이름만 적으면 33.7이 왜 공포인지 알 수 없다
    range: str
    # 양 끝 구간인가 — 국면 배지로 올릴지를 이걸로 고른다
    extreme: bool = False


class MacroBadgeOut(BaseModel):
    """국면 배지 하나. 규칙 하나가 배지 하나다 — **합성 점수는 만들지 않는다.**"""

    key: str
    label: str
    # 왜 떴는지. 배지 이름만으로는 "얼마나"가 안 보인다
    detail: str
    tone: str
    as_of: Optional[dt.date] = None


class MacroSeriesOut(BaseModel):
    """카드 한 장에 필요한 것 전부.

    "값이 왜 없는지"를 화면이 말할 수 있어야 해서 상태 세 칸(`last_*`)이 같이 간다.
    받아본 적이 없는 것과, 받아봤는데 막힌 것과, 받았는데 새 발표가 없는 것은 사용자가
    할 일이 각각 다르다.
    """

    code: str
    name: str
    note: Optional[str] = None
    # 변환을 거친 **뒤**의 단위 (percent | index | level)
    unit: str
    transform: str
    # "전년비" 같은 꼬리표. 없으면 원본 그대로라는 뜻
    transform_label: Optional[str] = None
    frequency: str

    as_of: Optional[dt.date] = None
    value: Optional[float] = None
    previous: Optional[float] = None
    # 직전 값과의 **차이**다 (변화율이 아니다 — 원래 값이 이미 %인 경우가 많다)
    change: Optional[float] = None
    released_at: Optional[dt.date] = None
    source: Optional[str] = None
    zone: Optional[MacroZoneOut] = None

    stale: bool = False
    last_checked_at: Optional[dt.datetime] = None
    last_ok_at: Optional[dt.datetime] = None
    last_error: Optional[str] = None


class TermSpreadOut(BaseModel):
    """장단기 금리차. 받아온 지표가 아니라 두 금리에서 계산한 값이다."""

    as_of: dt.date
    value: float
    long_code: str
    short_code: str


class MacroOverviewOut(BaseModel):
    series: list[MacroSeriesOut]
    term_spread: Optional[TermSpreadOut] = None
    # 지금 걸리는 규칙들. 아무것도 안 걸리면 빈 목록이다 (그것도 정보다)
    badges: list[MacroBadgeOut] = []
    # 홈 화면에 띄우기로 고른 코드. 카드의 ☆ 가 켜졌는지를 이걸로 판단한다
    pinned: list[str] = []


class MacroPinnedOut(BaseModel):
    """홈 화면 한 줄. 고른 코드와, 그 중 실제로 살아있는 지표들."""

    codes: list[str]
    series: list[MacroSeriesOut]


class MacroPinnedUpdate(BaseModel):
    """**빈 목록은 "다 껐다"는 뜻이다** — 기본값으로 되돌리라는 말이 아니다
    (`models.PortfolioSettings.pinned_macro` 참고)."""

    codes: list[str]


class MacroHistoryOut(BaseModel):
    code: str
    name: str
    unit: str
    transform: str
    transform_label: Optional[str] = None
    points: list[MacroPointOut]


class MacroRefreshResult(BaseModel):
    code: str
    ok: bool
    provider: Optional[str] = None
    as_of: Optional[str] = None
    inserted: Optional[int] = None
    revised: Optional[int] = None
    error: Optional[str] = None
    hint: Optional[str] = None
    skipped: Optional[str] = None
