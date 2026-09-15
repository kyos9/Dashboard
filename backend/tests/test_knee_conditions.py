"""대시보드가 내려주는 무릎매수 조건 분해가 실제 시그널 엔진과 일치하는지 검증.

routers/dashboard.py의 _knee_conditions는 "어느 조건이 걸렸는지" 보여주기 위해 조건식을
분해한 것이라, signals.compute_signals와 갈라질 위험이 있다. 여기서 두 경로가 같은 데이터에
대해 항상 같은 결론을 내는지 확인한다.
"""

import datetime as dt

import numpy as np
import pandas as pd

from app.models import IndicatorDaily
from app.routers.dashboard import _knee_conditions
from app.services.indicators import compute_indicators
from app.services.signals import compute_signals


def _synthetic_prices(n: int = 400, seed: int = 7) -> pd.DataFrame:
    """지표가 충분히 출렁여 조건이 참/거짓을 오가도록 만든 일봉 시계열."""
    rng = np.random.default_rng(seed)
    returns = rng.normal(0.0004, 0.018, n)
    close = 100 * np.exp(np.cumsum(returns))
    spread = np.abs(rng.normal(0, 0.01, n)) + 0.002
    dates = pd.bdate_range(end=dt.date.today(), periods=n).date
    return pd.DataFrame(
        {
            "open": close * (1 + rng.normal(0, 0.002, n)),
            "high": close * (1 + spread),
            "low": close * (1 - spread),
            "close": close,
            "volume": rng.lognormal(14, 0.4, n),
        },
        index=pd.Index(dates, name="date"),
    )


def _as_orm(indicator_df: pd.DataFrame) -> list[IndicatorDaily]:
    """지표 프레임을 대시보드 라우터가 다루는 ORM 객체 형태로 바꾼다 (최신순)."""
    rows = []
    for date, row in indicator_df.iterrows():
        kwargs = {
            col: (None if pd.isna(row[col]) else float(row[col]))
            for col in ("stddev20", "vol_ratio", "disparity", "plus_di", "minus_di", "adx")
        }
        rows.append(IndicatorDaily(ticker="TEST", date=date, **kwargs))
    return list(reversed(rows))


def test_knee_conditions_agree_with_signal_engine():
    price_df = _synthetic_prices()
    indicator_df = compute_indicators(price_df)
    signal_df = compute_signals(indicator_df)
    desc_rows = _as_orm(indicator_df)

    checked = 0
    fired = 0
    for offset in range(len(desc_rows) - 6):
        latest = desc_rows[offset]
        five_days_ago = desc_rows[offset + 5]
        conditions = _knee_conditions(latest, five_days_ago)

        all_met = all(
            getattr(conditions, field) is True
            for field in ("di_bearish", "disparity_negative", "volatility_or_volume", "adx_trending")
        )
        expected = bool(signal_df.loc[latest.date, "knee_buy_v2"])
        assert all_met == expected, f"{latest.date}: 조건분해={all_met} 엔진={expected}"

        checked += 1
        fired += int(expected)

    # 양쪽 케이스를 실제로 지나갔는지 확인 (전부 False였다면 의미 없는 테스트)
    assert checked > 300
    assert 0 < fired < checked


def test_knee_conditions_without_data_are_unknown():
    conditions = _knee_conditions(None, None)
    assert conditions.di_bearish is None
    assert conditions.adx_trending is None


def test_volatility_clause_true_when_only_volume_expands():
    latest = IndicatorDaily(
        ticker="TEST", date=dt.date.today(), stddev20=5.0, vol_ratio=1.2, adx=25.0,
        disparity=-1.0, plus_di=10.0, minus_di=20.0,
    )
    # StdDev20은 오히려 커졌지만(축소 아님) 거래량비가 1.1을 넘으므로 절은 참이어야 한다.
    five_days_ago = IndicatorDaily(ticker="TEST", date=dt.date.today(), stddev20=3.0)
    assert _knee_conditions(latest, five_days_ago).volatility_or_volume is True


def test_volatility_clause_false_when_neither_holds():
    latest = IndicatorDaily(
        ticker="TEST", date=dt.date.today(), stddev20=5.0, vol_ratio=0.9, adx=25.0,
        disparity=-1.0, plus_di=10.0, minus_di=20.0,
    )
    five_days_ago = IndicatorDaily(ticker="TEST", date=dt.date.today(), stddev20=3.0)
    assert _knee_conditions(latest, five_days_ago).volatility_or_volume is False
