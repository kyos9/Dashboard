"""종목을 등록할 때 시세를 얼마나 받는가.

예전에는 매번 전체 기간(수십 년치)을 새로 받았다. 시세는 종목마다 공용이라, 누가 이미
담았거나 예전에 담았다 뺀 종목은 이미 다 있는데도 그랬다 — 등록이 오래 걸린 주된 이유다.
"""

import datetime as dt

import pytest

from app.markets import Market
from app.models import PriceDaily
from app.services.instruments import ensure_instrument
from app.services.trading_calendar import last_closed_trading_day


@pytest.fixture()
def downloads(api, monkeypatch):
    calls: list[bool] = []

    def record(db, stock, full_backfill=False):
        calls.append(full_backfill)
        return {}

    monkeypatch.setattr("app.routers.stocks.refresh_and_evaluate_stock", record)
    return calls


def _stored_until(SessionLocal, ticker: str, last: dt.date) -> None:
    db = SessionLocal()
    ensure_instrument(db, ticker)
    for back in range(3):
        day = last - dt.timedelta(days=back)
        db.add(PriceDaily(ticker=ticker, date=day, open=1, high=1, low=1, close=1, volume=1))
    db.commit()
    db.close()


def test_a_ticker_nobody_has_gets_its_whole_history(api, downloads):
    client, _ = api
    assert client.post("/api/stocks", json={"ticker": "VOO"}).json()["data_loaded"] is True
    assert downloads == [True]


def test_a_ticker_already_current_downloads_nothing(api, downloads):
    client, SessionLocal = api
    _stored_until(SessionLocal, "VOO", last_closed_trading_day(Market.US))
    assert client.post("/api/stocks", json={"ticker": "VOO"}).json()["data_loaded"] is True
    assert downloads == []


def test_a_ticker_with_old_prices_only_fetches_the_recent_part(api, downloads):
    client, SessionLocal = api
    _stored_until(SessionLocal, "VOO", last_closed_trading_day(Market.US) - dt.timedelta(days=30))
    client.post("/api/stocks", json={"ticker": "VOO"})
    assert downloads == [False]


def test_korean_stock_is_judged_by_the_korean_calendar(api, downloads, monkeypatch):
    """추석처럼 한국만 쉬는 날에는 두 시장의 마지막 거래일이 다르다. 미국 기준으로 재면
    한국 종목이 매번 "낡았다"로 나와 등록할 때마다 다시 받는다."""
    client, SessionLocal = api
    kr_day, us_day = dt.date(2026, 9, 23), dt.date(2026, 9, 25)
    monkeypatch.setattr(
        "app.routers.stocks.last_closed_trading_day",
        lambda market=Market.US: kr_day if market == Market.KR else us_day,
    )
    _stored_until(SessionLocal, "005930.KS", kr_day)
    client.post("/api/stocks", json={"ticker": "005930.KS"})
    assert downloads == []
