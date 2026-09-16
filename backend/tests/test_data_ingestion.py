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
    monkeypatch.setattr(data_ingestion, "fetch_price_history", lambda ticker, period="max", prefer=None: df)

    result = data_ingestion.refresh_ticker(db_session, "TST", full_backfill=True)
    assert result["rows_upserted"] == 300
    assert db_session.query(PriceDaily).filter_by(ticker="TST").count() == 300
    assert db_session.query(IndicatorDaily).filter_by(ticker="TST").count() == 300


def _stooq_csv(n=320, start="2025-01-02"):
    """Stooq 형식의 CSV 본문을 만든다 (Adj Close 없음, 헤더 대문자)."""
    rng = np.random.default_rng(7)
    dates = pd.bdate_range(start, periods=n)
    close = 500 * np.exp(np.cumsum(rng.normal(0.0003, 0.012, n)))
    lines = ["Date,Open,High,Low,Close,Volume"]
    for d, c in zip(dates, close):
        lines.append(f"{d.date()},{c*0.998:.2f},{c*1.006:.2f},{c*0.993:.2f},{c:.2f},{int(rng.uniform(2e6, 6e6))}")
    return "\n".join(lines) + "\n"


def test_yahoo_blocked_falls_back_to_stooq_end_to_end(db_session, monkeypatch):
    """야후가 막힌 환경에서도 Stooq로 받아 지표·시그널까지 정상 산출되어야 한다.

    사용자가 겪은 상황(야후 차단)이 실제로 구제되는지 전 구간으로 확인한다.
    """
    import requests

    from app.services.providers.yahoo import YahooProvider
    from app.services.providers.base import ProviderUnavailable

    def yahoo_blocked(self, ticker, period):
        raise ProviderUnavailable("yahoo", f"{ticker}: CONNECT tunnel failed, response 403")

    monkeypatch.setattr(YahooProvider, "fetch", yahoo_blocked)

    class _Resp:
        status_code = 200
        text = _stooq_csv()

    monkeypatch.setattr(requests, "get", lambda *a, **k: _Resp())

    db_session.add(Stock(ticker="VOO", target_weight_pct=100.0))
    db_session.commit()

    result = data_ingestion.refresh_ticker(db_session, "VOO", full_backfill=True)

    assert result["rows_upserted"] == 320
    assert db_session.query(PriceDaily).filter_by(ticker="VOO").count() == 320

    # MA200까지 채워졌는지 = 지표 파이프라인이 끝까지 돌았다는 뜻
    latest = (
        db_session.query(IndicatorDaily)
        .filter_by(ticker="VOO")
        .order_by(IndicatorDaily.date.desc())
        .first()
    )
    assert latest.ma200 is not None
    assert latest.adx is not None


def test_all_providers_blocked_reports_real_cause_and_hint(db_session, monkeypatch):
    """전부 막히면 "no data returned"가 아니라 제공자별 원인과 다음 조치가 나와야 한다."""
    import requests

    from app.services.providers.base import ProviderUnavailable
    from app.services.providers.yahoo import YahooProvider

    monkeypatch.setattr(
        YahooProvider,
        "fetch",
        lambda self, t, p: (_ for _ in ()).throw(ProviderUnavailable("yahoo", f"{t}: 403 Forbidden")),
    )

    def blocked(*args, **kwargs):
        raise OSError("Tunnel connection failed: 403 Forbidden")

    monkeypatch.setattr(requests, "get", blocked)

    db_session.add(Stock(ticker="VOO", target_weight_pct=100.0))
    db_session.commit()

    try:
        data_ingestion.refresh_ticker(db_session, "VOO", full_backfill=False)
        raise AssertionError("실패해야 한다")
    except data_ingestion.DataIngestionError as exc:
        message = str(exc)
        assert "yahoo" in message and "403" in message
        assert "stooq" in message
        assert "no data returned" not in message  # 예전의 원인 없는 메시지
        assert "방화벽" in exc.hint


def test_upsert_records_which_provider_supplied_the_prices(db_session):
    """제공자마다 종가 기준이 다를 수 있으므로 어디서 온 값인지 남겨야 한다."""
    db_session.add(Stock(ticker="005930.KS", target_weight_pct=0.0))
    db_session.commit()

    df = _fake_price_df(5)
    df.attrs["provider"] = "naver"
    data_ingestion.upsert_prices(db_session, "005930.KS", df)

    sources = {row.source for row in db_session.query(PriceDaily).filter_by(ticker="005930.KS")}
    assert sources == {"naver"}


def test_upsert_warns_when_provider_changes(db_session, caplog):
    """백필은 네이버, 갱신은 야후로 붙으면 한 시계열에 다른 기준이 섞인다.

    조용히 섞이는 게 가장 나쁘다 — 나중에 지표가 튀어도 원인을 짚을 수 없다.
    """
    db_session.add(Stock(ticker="005930.KS", target_weight_pct=0.0))
    db_session.commit()

    first = _fake_price_df(5)
    first.attrs["provider"] = "naver"
    data_ingestion.upsert_prices(db_session, "005930.KS", first)

    second = _fake_price_df(5, start="2024-02-01")
    second.attrs["provider"] = "yahoo"
    with caplog.at_level("WARNING"):
        data_ingestion.upsert_prices(db_session, "005930.KS", second)

    assert "시세 출처가 바뀌었습니다" in caplog.text


def test_upsert_without_provider_keeps_existing_source(db_session):
    """출처를 모르는 경로로 다시 저장해도 이미 아는 출처를 지우지 않는다."""
    db_session.add(Stock(ticker="TST", target_weight_pct=0.0))
    db_session.commit()

    df = _fake_price_df(3)
    df.attrs["provider"] = "yahoo"
    data_ingestion.upsert_prices(db_session, "TST", df)

    plain = _fake_price_df(3)  # attrs 없음
    data_ingestion.upsert_prices(db_session, "TST", plain)

    assert {row.source for row in db_session.query(PriceDaily).filter_by(ticker="TST")} == {"yahoo"}


def test_refresh_prefers_the_provider_that_already_filled_this_ticker(db_session, monkeypatch):
    """갱신할 때는 지금까지 이 종목을 받아온 곳을 먼저 시도한다."""
    db_session.add(Stock(ticker="005930.KS", target_weight_pct=0.0))
    db_session.commit()

    first = _fake_price_df(5)
    first.attrs["provider"] = "naver"
    data_ingestion.upsert_prices(db_session, "005930.KS", first)

    seen = {}

    def fake_fetch(ticker, period="max", prefer=None):
        seen["prefer"] = prefer
        df = _fake_price_df(5)
        df.attrs["provider"] = prefer or "yahoo"
        return df

    monkeypatch.setattr(data_ingestion, "fetch_price_history", fake_fetch)
    data_ingestion.refresh_ticker(db_session, "005930.KS")
    assert seen["prefer"] == "naver"


def test_full_backfill_does_not_pin_the_old_provider(db_session, monkeypatch):
    """전체 백필은 처음부터 다시 받는 것이므로 평소 순서를 그대로 쓴다."""
    db_session.add(Stock(ticker="005930.KS", target_weight_pct=0.0))
    db_session.commit()

    first = _fake_price_df(5)
    first.attrs["provider"] = "yahoo"
    data_ingestion.upsert_prices(db_session, "005930.KS", first)

    seen = {}

    def fake_fetch(ticker, period="max", prefer=None):
        seen["prefer"] = prefer
        return _fake_price_df(5)

    monkeypatch.setattr(data_ingestion, "fetch_price_history", fake_fetch)
    data_ingestion.refresh_ticker(db_session, "005930.KS", full_backfill=True)
    assert seen["prefer"] is None


def test_mixed_history_has_no_single_preference(db_session):
    """이미 섞여 있으면 어느 쪽을 선호할지 정할 수 없다 — 억지로 하나를 고르지 않는다."""
    db_session.add(Stock(ticker="005930.KS", target_weight_pct=0.0))
    db_session.commit()

    for provider, start in (("naver", "2024-01-02"), ("yahoo", "2024-03-01")):
        df = _fake_price_df(5, start=start)
        df.attrs["provider"] = provider
        data_ingestion.upsert_prices(db_session, "005930.KS", df)

    assert data_ingestion.stored_source(db_session, "005930.KS") is None
