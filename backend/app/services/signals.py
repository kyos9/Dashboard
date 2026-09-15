"""무릎매수(v2) / 어깨매도(참고) 시그널 판정 (SIGNAL_APP_SPEC.md 3~4장).

입력 DataFrame은 services.indicators.compute_indicators()의 출력(원본 가격 컬럼 +
지표 컬럼을 모두 포함)이어야 한다.
"""

import pandas as pd


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
