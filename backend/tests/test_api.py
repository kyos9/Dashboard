import datetime as dt

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.main as main_module
from app.db import Base, get_db
from app.models import IndicatorDaily, PriceDaily, SignalDaily, Stock


@pytest.fixture()
def api(monkeypatch):
    monkeypatch.setenv("SIGNAL_DASHBOARD_DISABLE_SCHEDULER", "1")
    # 리프레시(yfinance) 호출은 네트워크가 필요하므로 종목 생성 시 자동 백필은 막아둔다.
    monkeypatch.setattr(
        "app.routers.stocks.refresh_and_evaluate_stock", lambda db, stock, full_backfill=False: {}
    )

    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    main_module.app.dependency_overrides[get_db] = override_get_db
    with TestClient(main_module.app) as client:
        yield client, TestingSessionLocal
    main_module.app.dependency_overrides.clear()


def test_health(api):
    client, _ = api
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_create_list_stock(api):
    client, _ = api
    r = client.post("/api/stocks", json={"ticker": "voo", "dca_amount": 300, "target_weight_pct": 40})
    assert r.status_code == 200
    body = r.json()
    assert body["ticker"] == "VOO"
    assert body["active"] is True

    r2 = client.get("/api/stocks")
    assert r2.status_code == 200
    assert len(r2.json()) == 1


def test_create_duplicate_conflict(api):
    client, _ = api
    client.post("/api/stocks", json={"ticker": "VOO", "target_weight_pct": 10})
    r = client.post("/api/stocks", json={"ticker": "VOO", "target_weight_pct": 10})
    assert r.status_code == 409


def test_update_and_deactivate_stock(api):
    client, _ = api
    client.post("/api/stocks", json={"ticker": "QQQ", "target_weight_pct": 10})

    r = client.put("/api/stocks/QQQ", json={"target_weight_pct": 25.0})
    assert r.status_code == 200
    assert r.json()["target_weight_pct"] == 25.0

    r2 = client.delete("/api/stocks/QQQ")
    assert r2.status_code == 200
    assert r2.json()["active"] is False


def test_dashboard_empty(api):
    client, _ = api
    r = client.get("/api/dashboard")
    assert r.status_code == 200
    assert r.json() == []


def test_dashboard_with_data(api):
    client, SessionLocal = api
    client.post("/api/stocks", json={"ticker": "NVDA", "target_weight_pct": 20})

    db = SessionLocal()
    today = dt.date.today()
    db.add(PriceDaily(ticker="NVDA", date=today, open=100, high=101, low=99, close=100.0, volume=1000))
    db.add(IndicatorDaily(ticker="NVDA", date=today, ma5=99.0, ma20=98.0, adx=25.0, disparity=-2.0))
    db.add(SignalDaily(ticker="NVDA", date=today, knee_buy_v2=True, shoulder_sell_ref=False))
    db.commit()
    db.close()

    r = client.get("/api/dashboard")
    assert r.status_code == 200
    cards = r.json()
    assert len(cards) == 1
    assert cards[0]["ticker"] == "NVDA"
    assert cards[0]["knee_buy_v2"] is True
    assert cards[0]["data_stale"] is False
    assert cards[0]["indicators"]["close"] == 100.0


def test_history_endpoint(api):
    client, SessionLocal = api
    client.post("/api/stocks", json={"ticker": "NVDA", "target_weight_pct": 20})
    db = SessionLocal()
    today = dt.date.today()
    db.add(PriceDaily(ticker="NVDA", date=today, open=100, high=101, low=99, close=123.0, volume=1000))
    db.commit()
    db.close()

    r = client.get("/api/history/NVDA?range=1y")
    assert r.status_code == 200
    body = r.json()
    assert body["ticker"] == "NVDA"
    assert body["prices"][0]["close"] == 123.0


def test_history_unknown_ticker_404(api):
    client, _ = api
    r = client.get("/api/history/ZZZZ")
    assert r.status_code == 404


def test_rebalance_settings_and_targets(api):
    client, _ = api
    client.post("/api/stocks", json={"ticker": "VOO", "target_weight_pct": 40})

    r = client.get("/api/rebalance/settings")
    assert r.status_code == 200
    assert r.json()["default_rebalance_band_pct"] == 5.0

    r2 = client.put("/api/rebalance/settings", json={"default_rebalance_band_pct": 8.0})
    assert r2.json()["default_rebalance_band_pct"] == 8.0

    r3 = client.put("/api/rebalance/targets/VOO", json={"rebalance_band_pct": 3.0})
    assert r3.status_code == 200
    assert r3.json()["rebalance_band_pct"] == 3.0

    r4 = client.get("/api/rebalance/targets")
    assert r4.json()[0]["rebalance_band_pct"] == 3.0


def test_rebalance_holdings_and_current(api):
    client, SessionLocal = api
    client.post("/api/stocks", json={"ticker": "VOO", "target_weight_pct": 50})

    db = SessionLocal()
    db.add(PriceDaily(ticker="VOO", date=dt.date.today(), open=1, high=1, low=1, close=100.0, volume=1))
    db.commit()
    db.close()

    r = client.put("/api/rebalance/holdings/VOO", json={"quantity": 10})
    assert r.status_code == 200
    assert r.json()["quantity"] == 10.0

    r2 = client.get("/api/rebalance/current")
    assert r2.status_code == 200
    row = r2.json()[0]
    assert row["actual_weight_pct"] == 100.0
    assert row["excess_pct"] == 50.0


def test_confirm_buy_execution(api):
    client, SessionLocal = api
    client.post("/api/stocks", json={"ticker": "VOO", "target_weight_pct": 50, "dca_amount": 500})

    db = SessionLocal()
    today = dt.date.today()
    db.add(PriceDaily(ticker="VOO", date=today, open=100, high=101, low=99, close=100.0, volume=1000))
    from app.models import BuyExecution, BuyStatus, BuyType

    buy = BuyExecution(
        ticker="VOO",
        period_start=today,
        period_end=today,
        exec_date=today,
        type=BuyType.signal,
        amount=500.0,
        status=BuyStatus.recommended,
    )
    db.add(buy)
    db.commit()
    buy_id = buy.id
    db.close()

    r = client.post(f"/api/buy-executions/{buy_id}/confirm", json={"apply_to_holding": True})
    assert r.status_code == 200
    assert r.json()["status"] == "confirmed"

    r2 = client.get("/api/rebalance/holdings")
    voo = next(h for h in r2.json() if h["ticker"] == "VOO")
    assert voo["quantity"] == 5.0
