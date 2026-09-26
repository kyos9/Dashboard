"""무릎매수(v2) / 어깨매도(참고) 시그널 판정 (SIGNAL_APP_SPEC.md 3~4장).

입력 DataFrame은 services.indicators.compute_indicators()의 출력(원본 가격 컬럼 +
지표 컬럼을 모두 포함)이어야 한다.
"""

import pandas as pd

from app.models import IndicatorDaily
from app.schemas import KneeConditions


def compute_signals(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()

    stddev20_prev5 = out["stddev20"].shift(5)
    adx_prev5 = out["adx"].shift(5)

    di_weak = out["minus_di"] > out["plus_di"]
    disparity_cond = out["disparity"] < 0
    vol_or_volatility_cond = (out["stddev20"] < stddev20_prev5) | (out["vol_ratio"] > 1.1)
    trend_filter = out["adx"] > 20

    out["knee_buy_v2"] = (di_weak & disparity_cond & vol_or_volatility_cond & trend_filter).fillna(False)

    high_position = out["close"] > out["ma50"]
    adx_rising = out["adx"] > adx_prev5
    volume_strong = out["vol_ma5"] > out["vol_ma20"]

    out["shoulder_sell_ref"] = (high_position & adx_rising & volume_strong).fillna(False)

    return out


def knee_conditions(
    latest: IndicatorDaily | None, five_days_ago: IndicatorDaily | None
) -> KneeConditions:
    """무릎매수(v2) 네 조건의 개별 충족 여부.

    signals.compute_signals와 같은 기준을 쓰되, 어느 조건이 걸렸는지 화면에 보여주기 위해
    분해한다. 계산에 필요한 값이 없으면 해당 조건은 None(판정 불가)으로 남긴다.
    """
    if latest is None:
        return KneeConditions()

    di_bearish = (
        None
        if latest.minus_di is None or latest.plus_di is None
        else latest.minus_di > latest.plus_di
    )
    disparity_negative = None if latest.disparity is None else latest.disparity < 0
    adx_trending = None if latest.adx is None else latest.adx > 20

    # StdDev20 축소 또는 거래량비 > 1.1 — 둘 중 하나만 만족해도 참
    stddev_shrinking = (
        None
        if latest.stddev20 is None or five_days_ago is None or five_days_ago.stddev20 is None
        else latest.stddev20 < five_days_ago.stddev20
    )
    volume_expanding = None if latest.vol_ratio is None else latest.vol_ratio > 1.1
    if stddev_shrinking is True or volume_expanding is True:
        volatility_or_volume: bool | None = True
    elif stddev_shrinking is None and volume_expanding is None:
        volatility_or_volume = None
    else:
        volatility_or_volume = False

    return KneeConditions(
        di_bearish=di_bearish,
        disparity_negative=disparity_negative,
        volatility_or_volume=volatility_or_volume,
        adx_trending=adx_trending,
    )
