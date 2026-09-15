import numpy as np
import pandas as pd
import pytest

from app.services.indicators import compute_dmi_adx, compute_indicators


def _make_df(n=40, seed=0):
    rng = np.random.default_rng(seed)
    close = 100 + np.cumsum(rng.normal(0, 1, n))
    high = close + rng.uniform(0.1, 1.0, n)
    low = close - rng.uniform(0.1, 1.0, n)
    open_ = close + rng.uniform(-0.5, 0.5, n)
    volume = rng.uniform(1000, 2000, n)
    dates = pd.date_range("2024-01-01", periods=n, freq="B")
    return pd.DataFrame(
        {"date": dates, "open": open_, "high": high, "low": low, "close": close, "volume": volume}
    ).set_index("date")


def test_moving_averages_match_manual_rolling_mean():
    df = _make_df(40)
    out = compute_indicators(df)
    np.testing.assert_allclose(out["ma5"].to_numpy(), df["close"].rolling(5).mean().to_numpy(), equal_nan=True)
    np.testing.assert_allclose(out["ma20"].to_numpy(), df["close"].rolling(20).mean().to_numpy(), equal_nan=True)


def test_stddev20_is_population_stddev():
    df = _make_df(30)
    out = compute_indicators(df)
    window = df["close"].to_numpy()[10:30]
    expected = np.std(window, ddof=0)
    assert out["stddev20"].to_numpy()[29] == pytest.approx(expected)


def test_roc5_formula():
    df = _make_df(15)
    out = compute_indicators(df)
    c = df["close"].to_numpy()
    expected = (c[10] / c[5] - 1) * 100
    assert out["roc5"].to_numpy()[10] == pytest.approx(expected)


def test_disparity_formula_uses_ma20():
    df = _make_df(30)
    out = compute_indicators(df)
    row = out.iloc[25]
    expected = (row["close"] / row["ma20"] - 1) * 100
    assert row["disparity"] == pytest.approx(expected)


def _reference_dmi_adx(df: pd.DataFrame, period: int = 14):
    """벡터화 구현과는 독립적으로 작성한 순수 파이썬 참조 구현 (회귀 테스트용)."""
    high = df["high"].tolist()
    low = df["low"].tolist()
    close = df["close"].tolist()
    n = len(close)

    tr = [np.nan] * n
    plus_dm = [np.nan] * n
    minus_dm = [np.nan] * n
    for i in range(1, n):
        up_move = high[i] - high[i - 1]
        down_move = low[i - 1] - low[i]
        plus_dm[i] = up_move if (up_move > down_move and up_move > 0) else 0.0
        minus_dm[i] = down_move if (down_move > up_move and down_move > 0) else 0.0
        tr[i] = max(high[i] - low[i], abs(high[i] - close[i - 1]), abs(low[i] - close[i - 1]))

    def wilder(series):
        result = [np.nan] * n
        first_valid = next((i for i, v in enumerate(series) if not np.isnan(v)), None)
        if first_valid is None:
            return result
        seed_idx = first_valid + period - 1
        if seed_idx >= n:
            return result
        window = series[first_valid : first_valid + period]
        if any(np.isnan(v) for v in window):
            return result
        result[seed_idx] = sum(window) / period
        for i in range(seed_idx + 1, n):
            prev = result[i - 1]
            cur = series[i]
            if prev is None or np.isnan(prev) or np.isnan(cur):
                continue
            result[i] = (prev * (period - 1) + cur) / period
        return result

    smoothed_tr = wilder(tr)
    smoothed_plus = wilder(plus_dm)
    smoothed_minus = wilder(minus_dm)

    plus_di = [np.nan] * n
    minus_di = [np.nan] * n
    dx = [np.nan] * n
    for i in range(n):
        if smoothed_tr[i] and not np.isnan(smoothed_tr[i]) and smoothed_tr[i] != 0:
            plus_di[i] = 100 * smoothed_plus[i] / smoothed_tr[i]
            minus_di[i] = 100 * smoothed_minus[i] / smoothed_tr[i]
            if (plus_di[i] + minus_di[i]) != 0:
                dx[i] = 100 * abs(plus_di[i] - minus_di[i]) / (plus_di[i] + minus_di[i])

    adx = wilder(dx)
    return np.array(plus_di), np.array(minus_di), np.array(adx)


def test_dmi_adx_matches_independent_reference_implementation():
    df = _make_df(40, seed=1)
    out = compute_dmi_adx(df)
    ref_plus_di, ref_minus_di, ref_adx = _reference_dmi_adx(df)

    np.testing.assert_allclose(out["plus_di"].to_numpy(), ref_plus_di, equal_nan=True, rtol=1e-9)
    np.testing.assert_allclose(out["minus_di"].to_numpy(), ref_minus_di, equal_nan=True, rtol=1e-9)
    np.testing.assert_allclose(out["adx"].to_numpy(), ref_adx, equal_nan=True, rtol=1e-9)


def test_dmi_uptrend_plus_di_dominates():
    n = 40
    dates = pd.date_range("2024-01-01", periods=n, freq="B")
    close = 100 + np.arange(n) * 1.0
    df = pd.DataFrame(
        {
            "high": close + 0.5,
            "low": close - 0.5,
            "close": close,
            "open": close,
            "volume": np.full(n, 1000.0),
        },
        index=dates,
    )
    out = compute_dmi_adx(df)
    last = out.iloc[-1]
    assert last["plus_di"] > last["minus_di"]
    assert last["adx"] > 20
