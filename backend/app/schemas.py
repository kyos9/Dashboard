import datetime as dt
from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.models import BuyStatus, BuyType, DcaPeriod, RebalancePeriod


class StockCreate(BaseModel):
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
    active: bool
    added_at: dt.datetime
    dca_amount: float
    dca_period: DcaPeriod
    rebalance_period: RebalancePeriod
    target_weight_pct: float
    rebalance_band_pct: Optional[float]
    review_date_override: Optional[dt.date]


class StockCreateResult(BaseModel):
    """종목 등록 결과 + 최초 시세 백필이 실제로 성공했는지.

    백필에 실패해도 등록 자체는 유지하지만, 화면에서 "추가 완료"라고만 알리면 지표가 비어
    있는 이유를 알 수 없다. 실패 사유를 함께 돌려줘 다시 시도하도록 안내한다.
    """

    stock: StockOut
    data_loaded: bool
    data_error: Optional[str] = None


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
    data_stale: bool = False
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
    date: dt.date
    kind: str  # "buy_signal" | "buy_fallback" | "shoulder_ref"
    status: Optional[BuyStatus] = None


class HistoryResponse(BaseModel):
    ticker: str
    prices: list[HistoryPoint]
    markers: list[HistoryMarker]


class HoldingUpdate(BaseModel):
    quantity: float


class HoldingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    ticker: str
    quantity: float
    updated_at: dt.datetime


class SettingsUpdate(BaseModel):
    default_rebalance_band_pct: float


class SettingsOut(BaseModel):
    default_rebalance_band_pct: float


class RebalanceRow(BaseModel):
    ticker: str
    target_weight_pct: float
    actual_weight_pct: float
    excess_pct: float
    next_review_date: dt.date
    shoulder_signal_fired_in_period: bool
    rebalance_signal: RebalanceSignal
    # 주문 가이드 계산용 — 보유수량 x 최신 종가
    quantity: float = 0.0
    last_close: Optional[float] = None
    current_value: float = 0.0


class RefreshResult(BaseModel):
    ticker: str
    ok: bool
    rows_upserted: Optional[int] = None
    error: Optional[str] = None


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
