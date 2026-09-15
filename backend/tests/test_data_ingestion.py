import datetime as dt

import numpy as np
import pandas as pd

from app.models import IndicatorDaily, PriceDaily, Stock
from app.services import data_ingestion


def _fake_price_df(n=30, start="2024-01-02"):
    rng = np.random.default_rng(42)
    dates = pd.bdate_range(start, periods=n)
    close = 100 + np.cumsum(rng.normal(0, 1, n))
    high = close + 0.5
    low = close - 0.5
    open_ = close
    volume = rng.uniform(1000, 2000, n)
    adj_close = close * 0.99
    df = pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "adj_close": adj_close, "volume": volume},
        index=[d.date() for d in dates],
    )
    df.index.name = "date"
    return df


def test_upsert_prices_inserts_and_updates(db_session):
    stock = Stock(ticker="TST", target_weight_pct=0.0)
    db_session.add(stock)
    db_session.commit()

    df = _fake_price_df(10)
    n = data_ingestion.upsert_prices(db_session, "TST", df)
    assert n == 10
    assert db_session.query(PriceDaily).filter_by(ticker="TST").count() == 10

    # 같은 날짜로 다시 upsert하면 행 수는 그대로, 값만 갱신되어야 함
    df2 = df.copy()
    df2["close"] = df2["close"] + 1.0
    data_ingestion.upsert_prices(db_session, "TST", df2)
    assert db_session.query(PriceDaily).filter_by(ticker="TST").count() == 10
    row = db_session.query(PriceDaily).filter_by(ticker="TST", date=df.index[0]).first()
    assert row.close == df2["close"].iloc[0]


def test_recompute_indicators_populates_table(db_session):
    stock = Stock(ticker="TST", target_weight_pct=0.0)
    db_session.add(stock)
    db_session.commit()

    df = _fake_price_df(30)
    data_ingestion.upsert_prices(db_session, "TST", df)
    indicator_df = data_ingestion.recompute_indicators(db_session, "TST")

    assert not indicator_df.empty
    count = db_session.query(IndicatorDaily).filter_by(ticker="TST").count()
    assert count == 30

    last_date = df.index[-1]
    rec = db_session.query(IndicatorDaily).filter_by(ticker="TST", date=last_date).first()
    assert rec.ma5 is not None


def test_refresh_ticker_uses_mocked_fetch(db_session, monkeypatch):
    stock = Stock(ticker="TST", target_weight_pct=0.0)
    db_session.add(stock)
    db_session.commit()

    df = _fake_price_df(300)
    monkeypatch.setattr(data_ingestion, "fetch_price_history", lambda ticker, period="max": df)

    result = data_ingestion.refresh_ticker(db_session, "TST", full_backfill=True)
    assert result["rows_upserted"] == 300
    assert db_session.query(PriceDaily).filter_by(ticker="TST").count() == 300
    assert db_session.query(IndicatorDaily).filter_by(ticker="TST").count() == 300
