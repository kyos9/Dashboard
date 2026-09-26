import datetime as dt
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.markets import Currency, Market
from app.models import ReviewPeriod


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
    target_weight_pct: float = Field(default=0.0, ge=0, le=100)
    rebalance_band_pct: Optional[float] = Field(default=None, ge=0, le=100)
    # 이미 들고 있는 종목이면 등록하면서 같이 적는다. 비우면 보유 0으로 시작한다.
    quantity: Optional[float] = Field(default=None, ge=0)
    avg_cost: Optional[float] = Field(default=None, ge=0)


class StockUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    active: Optional[bool] = None
    target_weight_pct: Optional[float] = Field(default=None, ge=0, le=100)
    rebalance_band_pct: Optional[float] = Field(default=None, ge=0, le=100)


class StockOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    ticker: str
    name: Optional[str]
    category: Optional[str]
    market: Market = Market.US
    currency: Currency = Currency.USD
    active: bool
    added_at: dt.datetime
    target_weight_pct: float
    rebalance_band_pct: Optional[float]
    sort_order: int = 0
    # 등록 직후 시세를 뒤에서 받는 중이면 "loading", 받다가 실패했으면 "failed" (+ 안내)
    data_status: Optional[Literal["loading", "failed"]] = None
    data_hint: Optional[str] = None


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
    # 시세를 뒤에서 받기 시작했다 — 화면은 종목 목록의 data_status 로 끝났는지 본다
    data_pending: bool = False
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
    # 무릎매수(v2)가 마지막으로 뜬 날 (저장된 히스토리 전체에서). 적립할 때 "이번 달에 벌써
    # 떴나"를 보는 용도 — 기간을 정해 기록을 잡아두던 매수 워크플로우를 대신한다.
    last_buy_signal_date: Optional[dt.date] = None
    rebalance_signal: RebalanceSignal = RebalanceSignal(active=False, reasons=[])
    # 등록 직후 시세를 뒤에서 받는 중("loading")이거나 받다가 실패("failed")
    data_status: Optional[Literal["loading", "failed"]] = None


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
    quantity: float = Field(ge=0)
    # 보내지 않으면 그대로 둔다. null을 보내면 지운다(모름).
    avg_cost: Optional[float] = Field(default=None, ge=0)


class HoldingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    ticker: str
    quantity: float
    avg_cost: Optional[float] = None
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
    review_period: Optional[ReviewPeriod] = None
    # null을 보내면 직접 정한 날을 지우고 주기로 돌아간다. 안 보내면 그대로.
    review_date_override: Optional[dt.date] = None
    # 통화코드 -> 금액. 값에 null이나 0을 주면 그 통화 현금을 지운다. 안 보낸 통화는 그대로.
    cash: Optional[dict[str, Optional[float]]] = None
    cash_target_pct: Optional[float] = Field(default=None, ge=0, le=100)


class SettingsOut(BaseModel):
    default_rebalance_band_pct: float
    base_currency: Currency = Currency.KRW
    fx_overrides: dict[str, float] = {}
    fx: FxOut
    review_period: ReviewPeriod = ReviewPeriod.quarterly
    review_date_override: Optional[dt.date] = None
    cash: dict[str, float] = {}
    cash_target_pct: float = 0.0


class RebalanceRow(BaseModel):
    ticker: str
    name: Optional[str] = None
    currency: Currency = Currency.USD
    target_weight_pct: float
    actual_weight_pct: float
    excess_pct: float
    band_pct: float
    shoulder_signal_fired_in_period: bool
    rebalance_signal: RebalanceSignal
    # 주문 가이드 계산용 — 보유수량 x 최신 종가 (해당 종목의 거래 통화 기준)
    quantity: float = 0.0
    avg_cost: Optional[float] = None
    last_close: Optional[float] = None
    current_value: float = 0.0
    # 비중 계산에 쓰이는 기준통화 환산 평가금액
    current_value_base: float = 0.0
    # 손익 — 거래 통화 기준. 평단가를 모르면 비어 있다.
    cost_value: Optional[float] = None
    unrealized_pnl: Optional[float] = None
    return_pct: Optional[float] = None


class CashOut(BaseModel):
    """현금 한 줄. 종목 행과 나란히 비중을 잰다."""

    amounts: dict[str, float] = {}
    value_base: float = 0.0
    target_pct: float = 0.0
    actual_pct: float = 0.0
    excess_pct: float = 0.0


class ReviewOut(BaseModel):
    """포트폴리오의 리뷰 일정. `due`면 리뷰할 때다."""

    period: ReviewPeriod
    next_date: dt.date
    due: bool
    override: Optional[dt.date] = None
    last_snapshot_at: Optional[dt.datetime] = None


class RebalanceCurrentOut(BaseModel):
    """리밸런싱 현황 전체.

    통화가 섞인 포트폴리오에서는 "얼마짜리 포트폴리오인지"가 기준통화와 환율에 달려
    있으므로, 행만 주지 않고 그 전제까지 함께 내려준다.
    """

    base_currency: Currency
    fx: FxOut
    # 현금까지 더한 전체 자금. 목표비중은 이것 대비다.
    total_value_base: float
    holdings_value_base: float = 0.0
    cost_value_base: Optional[float] = None
    unrealized_pnl_base: Optional[float] = None
    cash: CashOut = CashOut()
    # 종목 목표비중 + 현금 목표비중. 100이 아니면 화면이 알려준다.
    target_sum_pct: float = 0.0
    review: ReviewOut
    rows: list[RebalanceRow]


class SnapshotCreate(BaseModel):
    note: Optional[str] = Field(default=None, max_length=200)


class SnapshotOut(BaseModel):
    """리밸런싱 기록 한 건. `data`는 그때 모습 그대로다 (종목 행·현금·환율)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    taken_at: dt.datetime
    review_date: Optional[dt.date] = None
    base_currency: Currency
    total_value_base: float
    note: Optional[str] = None
    data: dict


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


class RebalanceTargetUpdate(BaseModel):
    target_weight_pct: Optional[float] = Field(default=None, ge=0, le=100)
    rebalance_band_pct: Optional[float] = Field(default=None, ge=0, le=100)


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


class MacroForecastOut(BaseModel):
    """예상치 한 줄.

    **값의 단위가 `MacroSeriesOut.value` 와 같다** — 저장된 원본 지수(320.541)가 아니라
    화면에 뜨는 전년비(2.7)다. 예상치를 내는 쪽이 전부 전년비로만 발표하기 때문이고,
    지수로 되돌리려면 우리가 계산을 하나 지어내야 한다 (`services/macro.py` 참고).
    """

    # 어느 달을 예측한 것인가 (그 달 1일)
    as_of: dt.date
    value: float
    # manual | cleveland_fed
    source: str
    # 화면에 그대로 적는 출처 이름 ("직접 입력")
    source_label: str
    # 언제 한 예측인가. 나우캐스트는 매일 바뀌므로 이게 있어야 "언제 기준 예상"인지 안다
    forecast_date: dt.date
    # 실제 − 예상 (%p). 아직 안 나온 달이면 None
    surprise: Optional[float] = None


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

    # 이 지표에 "예상치"라는 말이 성립하는가. 매일 시장에서 나오는 값(VIX·금리)은
    # 발표도 컨센서스도 없어서 입력란 자체를 띄우지 않는다.
    forecastable: bool = False
    # **방금 나온 값**의 예상치. 배지("물가 상회")가 보는 것이 이쪽이다
    forecast: Optional[MacroForecastOut] = None
    # 아직 안 나온 달의 예상치. 비교할 실제값이 없으니 배지도 없다 — 한 칸에 합치면
    # 다음 달 예상치를 넣는 순간 이번 달 결과가 화면에서 사라진다
    pending_forecast: Optional[MacroForecastOut] = None

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
    """홈 화면 한 줄. 고른 코드와, 그 중 실제로 살아있는 지표들.

    배지가 같이 온다. **고른 지표만 보고 만든 것이 아니다** — VIX 를 홈에서 내렸다고
    공포 구간 배지가 사라지면 화면이 "지금 조용하다"고 거짓말을 하게 된다.
    """

    codes: list[str]
    series: list[MacroSeriesOut]
    badges: list[MacroBadgeOut] = []


class MacroPinnedUpdate(BaseModel):
    """**빈 목록은 "다 껐다"는 뜻이다** — 기본값으로 되돌리라는 말이 아니다
    (`models.UserSettings.pinned_macro` 참고)."""

    codes: list[str]


class MacroForecastUpdate(BaseModel):
    """예상치 직접 입력. Investing 화면에서 본 숫자를 사람이 옮겨 적는 자리다.

    범위를 두는 것은 자릿수 실수(2.7 대신 270)를 막으려는 것이다. 27 은 못 막는다 —
    그건 화면에 그대로 보이므로 사람이 본다.
    """

    # 어느 달의 발표를 예측한 것인가. 며칠을 넣든 그 달 1일로 맞춰 저장한다
    as_of: dt.date
    value: float = Field(ge=-100.0, le=100.0)


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


class FundamentalMetric(BaseModel):
    """재무 지표 하나와 그 근거 (어느 분기까지, 언제 공시된 값으로)."""

    key: str
    value: Optional[float] = None
    period_end: Optional[dt.date] = None
    filed_at: Optional[dt.date] = None
    # 공시일을 결산일로 추정했는가 (야후 출처)
    estimated: bool = False
    # 값이 없는 이유 ("적자", "자본잠식")
    note: Optional[str] = None


class PerRange(BaseModel):
    """지난 5년 날마다의 PER (그날까지 공시된 EPS 로) 과 지금의 위치."""

    min: float
    max: float
    median: float
    current: Optional[float] = None
    # 지난 기간 중 지금 PER 이하였던 날의 비율 (%)
    position_pct: Optional[float] = None
    since: dt.date
    days: int


class FundamentalQuarter(BaseModel):
    period_end: dt.date
    # 그 분기 숫자가 처음 공시된 날
    filed_at: dt.date
    estimated: bool = False
    # 뒤에 정정 공시로 값이 바뀌었나
    revised: bool = False
    revenue: Optional[float] = None
    operating_income: Optional[float] = None
    net_income: Optional[float] = None
    eps_diluted: Optional[float] = None
    operating_cf: Optional[float] = None
    capex: Optional[float] = None
    fcf: Optional[float] = None


class FundamentalsOut(BaseModel):
    """종목 하나의 재무. "재무" 화면의 목록은 이것의 줄들이다 (분기 표만 빠진다)."""

    ticker: str
    name: Optional[str] = None
    category: Optional[str] = None
    # ok · none(재무 없음: ETF 등) · unsupported(아직 못 읽는 출처) · error · None(아직 안 받음)
    state: Optional[str] = None
    message: Optional[str] = None
    source: Optional[str] = None
    checked_at: Optional[dt.datetime] = None
    currency: Currency
    price: Optional[float] = None
    price_date: Optional[dt.date] = None
    metrics: list[FundamentalMetric] = []
    per_range: Optional[PerRange] = None
    quarters: list[FundamentalQuarter] = []
