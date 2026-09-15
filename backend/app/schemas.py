import datetime as dt
from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.models import BuyStatus, BuyType, DcaPeriod, RebalancePeriod


class StockCreate(BaseModel):
    ticker: str
    name: Optional[str] = None
    dca_amount: float = 0.0
    dca_period: DcaPeriod = DcaPeriod.monthly
    rebalance_period: RebalancePeriod = RebalancePeriod.quarterly
    target_weight_pct: float = 0.0
    rebalance_band_pct: Optional[float] = None
    review_date_override: Optional[dt.date] = None


class StockUpdate(BaseModel):
    name: Optional[str] = None
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
    active: bool
    added_at: dt.datetime
    dca_amount: float
    dca_period: DcaPeriod
    rebalance_period: RebalancePeriod
    target_weight_pct: float
    rebalance_band_pct: Optional[float]
    review_date_override: Optional[dt.date]


class LatestIndicators(BaseModel):
    date: Optional[dt.date] = None
    close: Optional[float] = None
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


class DashboardCard(BaseModel):
    ticker: str
    name: Optional[str]
    data_stale: bool = False
    indicators: LatestIndicators
    knee_buy_v2: bool = False
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
