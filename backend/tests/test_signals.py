import pandas as pd

from app.services.signals import compute_signals


def _row(**overrides):
    base = dict(
        close=100.0, ma50=105.0,
        minus_di=25.0, plus_di=15.0,
        disparity=-1.0, stddev20=2.0, vol_ratio=1.0, adx=25.0,
        vol_ma5=1000.0, vol_ma20=900.0,
    )
    base.update(overrides)
    return base


def _make_df(rows):
    # stddev20_prev5/adx_prev5는 shift(5)로 참조하므로, 앞에 5행 패딩을 넣어 프레임을 구성한다.
    padding = [_row(stddev20=10.0, adx=10.0) for _ in range(5)]
    return pd.DataFrame(padding + rows).reset_index(drop=True)


def test_knee_buy_v2_fires_when_all_conditions_true():
    df = _make_df([_row(minus_di=25, plus_di=15, disparity=-1, stddev20=2.0, vol_ratio=1.0, adx=25)])
    out = compute_signals(df)
    assert bool(out["knee_buy_v2"].iloc[-1]) is True


def test_knee_buy_v2_false_when_adx_exactly_20():
    df = _make_df([_row(adx=20.0)])
    out = compute_signals(df)
    assert bool(out["knee_buy_v2"].iloc[-1]) is False


def test_knee_buy_v2_false_when_disparity_exactly_zero():
    df = _make_df([_row(disparity=0.0)])
    out = compute_signals(df)
    assert bool(out["knee_buy_v2"].iloc[-1]) is False


def test_knee_buy_v2_false_when_di_not_weak():
    df = _make_df([_row(minus_di=10, plus_di=20)])
    out = compute_signals(df)
    assert bool(out["knee_buy_v2"].iloc[-1]) is False


def test_knee_buy_v2_volatility_or_condition():
    # stddev 축소는 없지만(=10.0 그대로) 거래량비율 조건만 참인 경우
    df = _make_df([_row(stddev20=10.0, vol_ratio=1.2)])
    out = compute_signals(df)
    assert bool(out["knee_buy_v2"].iloc[-1]) is True

    # 둘 다 거짓이면 최종 False
    df2 = _make_df([_row(stddev20=10.0, vol_ratio=1.05)])
    out2 = compute_signals(df2)
    assert bool(out2["knee_buy_v2"].iloc[-1]) is False


def test_shoulder_sell_ref_fires_when_all_conditions_true():
    df = _make_df([_row(close=110, ma50=105, adx=25, vol_ma5=1000, vol_ma20=900)])
    out = compute_signals(df)
    assert bool(out["shoulder_sell_ref"].iloc[-1]) is True


def test_shoulder_sell_ref_false_when_close_not_above_ma50():
    df = _make_df([_row(close=100, ma50=105)])
    out = compute_signals(df)
    assert bool(out["shoulder_sell_ref"].iloc[-1]) is False


def test_shoulder_sell_ref_false_when_adx_not_rising():
    padding = [_row(stddev20=10.0, adx=30.0) for _ in range(5)]
    df = pd.DataFrame(padding + [_row(close=110, ma50=105, adx=25, vol_ma5=1000, vol_ma20=900)]).reset_index(
        drop=True
    )
    out = compute_signals(df)
    assert bool(out["shoulder_sell_ref"].iloc[-1]) is False
