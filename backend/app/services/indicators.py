"""지표 계산 (SIGNAL_APP_SPEC.md 2장).

모든 함수는 날짜 오름차순으로 정렬된 pandas.DataFrame(columns: open, high, low, close, volume)을
입력받아 지표 컬럼이 추가된 DataFrame을 반환한다. 종가는 분할조정/배당미조정 기준이어야 한다
(services/data_ingestion.py 참고).
"""

import numpy as np
import pandas as pd

ADX_PERIOD = 14


def _wilder_smooth(values: np.ndarray, period: int) -> np.ndarray:
    """Wilder 방식 스무딩(RMA). 시작값은 첫 `period`개 값의 단순평균, 이후는 재귀식으로 계산."""
    n = len(values)
    out = np.full(n, np.nan)
    valid_mask = ~np.isnan(values)
    if valid_mask.sum() < period:
        return out
    first_valid_idx = int(np.argmax(valid_mask))
    seed_idx = first_valid_idx + period - 1
    if seed_idx >= n:
        return out
    window = values[first_valid_idx : first_valid_idx + period]
    if np.isnan(window).any():
        return out
    out[seed_idx] = window.mean()
    for i in range(seed_idx + 1, n):
        prev = out[i - 1]
        cur = values[i]
        if np.isnan(prev) or np.isnan(cur):
            out[i] = np.nan
            continue
        out[i] = (prev * (period - 1) + cur) / period
    return out


def compute_dmi_adx(df: pd.DataFrame, period: int = ADX_PERIOD) -> pd.DataFrame:
    """+DI / -DI / ADX, Wilder 표준 14일 스무딩."""
    high = df["high"]
    low = df["low"]
    close = df["close"]

    up_move = high.diff()
    down_move = -low.diff()

    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)

    prev_close = close.shift(1)
    tr = pd.concat(
        [
            high - low,
            (high - prev_close).abs(),
            (low - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)

    # diff()가 만드는 선행 NaN(첫 행)을 그대로 두어야 워밍업 구간이 올바르게 계산된다.
    tr.iloc[0] = np.nan
    plus_dm = pd.Series(plus_dm, index=df.index)
    minus_dm = pd.Series(minus_dm, index=df.index)
    plus_dm.iloc[0] = np.nan
    minus_dm.iloc[0] = np.nan

    smoothed_tr = _wilder_smooth(tr.to_numpy(), period)
    smoothed_plus_dm = _wilder_smooth(plus_dm.to_numpy(), period)
    smoothed_minus_dm = _wilder_smooth(minus_dm.to_numpy(), period)

    with np.errstate(divide="ignore", invalid="ignore"):
        plus_di = 100 * smoothed_plus_dm / smoothed_tr
        minus_di = 100 * smoothed_minus_dm / smoothed_tr
        dx = 100 * np.abs(plus_di - minus_di) / (plus_di + minus_di)

    adx = _wilder_smooth(dx, period)

    out = df.copy()
    out["plus_di"] = plus_di
    out["minus_di"] = minus_di
    out["adx"] = adx
    return out


def compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """스펙 2장의 모든 지표를 계산해 컬럼을 추가한 DataFrame을 반환한다.

    df는 date 오름차순 정렬, columns: open, high, low, close, volume 필요.
    """
    out = df.copy()

    out["ma5"] = out["close"].rolling(5).mean()
    out["ma20"] = out["close"].rolling(20).mean()
    out["ma50"] = out["close"].rolling(50).mean()
    out["ma200"] = out["close"].rolling(200).mean()

    # 표준편차는 모집단 표준편차(ddof=0)를 사용한다 (거래일 20일 구간 자체를 모집단으로 취급).
    out["stddev20"] = out["close"].rolling(20).std(ddof=0)

    out["vol_ma5"] = out["volume"].rolling(5).mean()
    out["vol_ma20"] = out["volume"].rolling(20).mean()
    with np.errstate(divide="ignore", invalid="ignore"):
        out["vol_ratio"] = out["vol_ma5"] / out["vol_ma20"]

    with np.errstate(divide="ignore", invalid="ignore"):
        out["roc5"] = (out["close"] / out["close"].shift(5) - 1) * 100
        out["disparity"] = (out["close"] / out["ma20"] - 1) * 100

    out = compute_dmi_adx(out)

    return out
