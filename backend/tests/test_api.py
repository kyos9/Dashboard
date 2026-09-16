import datetime as dt

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.main as main_module
from app.db import Base, get_db
from app.models import IndicatorDaily, PriceDaily, SignalDaily, Stock
from app.services import data_ingestion


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
    assert r.json()["status"] == "ok"


def test_create_list_stock(api):
    client, _ = api
    r = client.post("/api/stocks", json={"ticker": "voo", "dca_amount": 300, "target_weight_pct": 40})
    assert r.status_code == 200
    body = r.json()
    assert body["stock"]["ticker"] == "VOO"
    assert body["stock"]["active"] is True
    assert body["data_loaded"] is True

    r2 = client.get("/api/stocks")
    assert r2.status_code == 200
    assert len(r2.json()) == 1


def test_create_reports_failed_backfill(api, monkeypatch):
    """시세 백필에 실패해도 등록은 유지되고, 실패 사실이 응답에 드러나야 한다."""
    client, _ = api

    def boom(db, stock, full_backfill=False):
        raise data_ingestion.DataIngestionError("no data returned for ZZZZ")

    monkeypatch.setattr("app.routers.stocks.refresh_and_evaluate_stock", boom)

    body = client.post("/api/stocks", json={"ticker": "ZZZZ"}).json()
    assert body["stock"]["ticker"] == "ZZZZ"
    assert body["data_loaded"] is False
    assert "no data returned" in body["data_error"]
    # 등록 자체는 살아 있어야 나중에 수동 갱신으로 재시도할 수 있다
    assert [s["ticker"] for s in client.get("/api/stocks").json()] == ["ZZZZ"]


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


def test_dashboard_change_pct_and_category(api):
    client, SessionLocal = api
    client.post("/api/stocks", json={"ticker": "VOO", "category": "지수", "target_weight_pct": 40})

    db = SessionLocal()
    today = dt.date.today()
    db.add(PriceDaily(ticker="VOO", date=today - dt.timedelta(days=1), open=1, high=1, low=1, close=100.0, volume=1))
    db.add(PriceDaily(ticker="VOO", date=today, open=1, high=1, low=1, close=105.0, volume=1))
    db.commit()
    db.close()

    card = client.get("/api/dashboard").json()[0]
    assert card["category"] == "지수"
    assert card["indicators"]["prev_close"] == 100.0
    assert card["indicators"]["change_pct"] == pytest.approx(5.0)


def test_dashboard_change_pct_none_without_previous_day(api):
    client, SessionLocal = api
    client.post("/api/stocks", json={"ticker": "VOO", "target_weight_pct": 40})
    db = SessionLocal()
    db.add(PriceDaily(ticker="VOO", date=dt.date.today(), open=1, high=1, low=1, close=105.0, volume=1))
    db.commit()
    db.close()

    card = client.get("/api/dashboard").json()[0]
    assert card["indicators"]["change_pct"] is None


def test_refresh_all_reports_per_ticker_result(api, monkeypatch):
    client, _ = api
    client.post("/api/stocks", json={"ticker": "VOO", "target_weight_pct": 50})
    client.post("/api/stocks", json={"ticker": "ZZZZ", "target_weight_pct": 50})

    def fake_refresh(db, stock, full_backfill=False):
        if stock.ticker == "ZZZZ":
            raise data_ingestion.DataIngestionError("no data returned for ZZZZ")
        return {"ticker": stock.ticker, "rows_upserted": 12, "as_of": "2026-01-01"}

    monkeypatch.setattr("app.services.pipeline.refresh_and_evaluate_stock", fake_refresh)

    r = client.post("/api/stocks/refresh-all")
    assert r.status_code == 200
    by_ticker = {row["ticker"]: row for row in r.json()}
    assert by_ticker["VOO"] == {
        "ticker": "VOO", "ok": True, "rows_upserted": 12, "error": None, "hint": None,
    }
    # 한 종목이 실패해도 나머지는 갱신되고, 실패 사유가 함께 돌아온다
    assert by_ticker["ZZZZ"]["ok"] is False
    assert "no data returned" in by_ticker["ZZZZ"]["error"]


def test_rebalance_current_includes_order_amounts(api):
    client, SessionLocal = api
    client.post("/api/stocks", json={"ticker": "VOO", "target_weight_pct": 100})
    db = SessionLocal()
    db.add(PriceDaily(ticker="VOO", date=dt.date.today(), open=1, high=1, low=1, close=50.0, volume=1))
    db.commit()
    db.close()
    client.put("/api/rebalance/holdings/VOO", json={"quantity": 3})

    body = client.get("/api/rebalance/current").json()
    row = body["rows"][0]
    assert row["quantity"] == 3
    assert row["last_close"] == 50.0
    assert row["current_value"] == pytest.approx(150.0)
    # 달러 종목이므로 기준통화(원) 환산액은 환율만큼 커진다
    assert row["currency"] == "USD"
    assert body["base_currency"] == "KRW"
    assert row["current_value_base"] == pytest.approx(150.0 * body["fx"]["usd_krw"])


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
    row = r2.json()["rows"][0]
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


def test_health_reports_version_and_providers(api):
    """헤더가 이 값을 보여주므로, 어느 코드가 도는지 화면에서 확인할 수 있어야 한다."""
    client, _ = api
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["version"]  # 예: "0.4.0 (abc1234)"
    assert body["providers_by_market"]["US"] == ["yahoo", "stooq"]
    # 국내/해외 제공자 순서가 다르므로 시장별로도 내려줘야 한다
    assert body["providers_by_market"]["KR"] == ["naver", "yahoo"]


# ── 국내주식: 이름으로 등록 ──────────────────────────────────────────

def test_symbol_search_finds_korean_stock_by_name(api):
    client, _ = api
    rows = client.get("/api/symbols/search", params={"q": "삼성전자"}).json()
    assert rows[0]["ticker"] == "005930.KS"
    assert rows[0]["market"] == "KR"
    assert rows[0]["board"] == "KOSPI"


def test_symbol_search_returns_candidates_for_partial_name(api):
    client, _ = api
    rows = client.get("/api/symbols/search", params={"q": "에코프로"}).json()
    tickers = {row["ticker"] for row in rows}
    assert "247540.KQ" in tickers  # 에코프로비엠
    assert "086520.KQ" in tickers  # 에코프로


def test_listing_status_reports_what_search_covers(api):
    """검색이 내장 목록만 보고 있는지, 거래소 목록까지 받았는지 화면이 알아야 한다."""
    client, Session = api

    body = client.get("/api/symbols/listing-status").json()
    assert body["cached_count"] == 0  # 아직 받지 않았다
    assert body["seed_count"] > 0
    assert body["seed_as_of"]  # 내장 목록이 언제 기준인지 밝힌다

    from app.models import KrxListing

    with Session() as session:
        session.add(KrxListing(code="005930", name="삼성전자", board="KOSPI"))
        session.commit()

    body = client.get("/api/symbols/listing-status").json()
    assert body["cached_count"] == 1
    assert body["updated_at"] is not None


def test_refresh_listing_reports_count(api, monkeypatch):
    client, _ = api
    monkeypatch.setattr(
        "app.services.symbols.refresh_krx_listing", lambda db, timeout=30: 2841
    )
    body = client.post("/api/symbols/refresh-listing").json()
    assert body == {"ok": True, "count": 2841}


def test_refresh_listing_failure_still_allows_search(api, monkeypatch):
    """목록 갱신이 실패해도 내장 목록으로 검색은 계속 되므로 500을 던지지 않는다."""
    client, _ = api

    def boom(db, timeout=30):
        raise RuntimeError("kind.krx.co.kr 연결 실패")

    monkeypatch.setattr("app.services.symbols.refresh_krx_listing", boom)

    response = client.post("/api/symbols/refresh-listing")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert "연결 실패" in body["error"]
    assert "내장 목록" in body["hint"]

    # 갱신에 실패해도 주요 종목 검색은 그대로 동작해야 한다
    rows = client.get("/api/symbols/search", params={"q": "삼성전자"}).json()
    assert rows[0]["ticker"] == "005930.KS"


def test_create_stock_by_korean_name(api):
    """"삼성전자"로 등록하면 티커/시장/통화가 알아서 채워져야 한다."""
    client, _ = api
    body = client.post("/api/stocks", json={"ticker": "삼성전자", "target_weight_pct": 30}).json()

    assert body["stock"]["ticker"] == "005930.KS"
    assert body["stock"]["name"] == "삼성전자"
    assert body["stock"]["market"] == "KR"
    assert body["stock"]["currency"] == "KRW"
    # 사용자가 무엇을 입력했는지 화면에서 확인할 수 있어야 한다
    assert body["resolved_from"] == "삼성전자"


def test_create_stock_by_six_digit_code(api):
    client, _ = api
    body = client.post("/api/stocks", json={"ticker": "005930"}).json()
    assert body["stock"]["ticker"] == "005930.KS"


def test_create_us_stock_reports_no_resolution(api):
    """티커를 그대로 넣었으면 '해석했다'고 표시할 필요가 없다."""
    client, _ = api
    body = client.post("/api/stocks", json={"ticker": "voo"}).json()
    assert body["stock"]["ticker"] == "VOO"
    assert body["stock"]["currency"] == "USD"
    assert body["resolved_from"] is None


def test_create_with_unresolvable_name_returns_candidates(api):
    """모르는 이름은 조용히 아무 종목이나 고르지 말고 400으로 알려야 한다."""
    client, _ = api
    r = client.post("/api/stocks", json={"ticker": "없는회사이름"})
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert "찾지 못했습니다" in detail["hint"]
    assert "candidates" in detail


def test_create_with_ambiguous_code_is_rejected(api):
    """모르는 6자리 코드는 코스피/코스닥을 알 수 없으므로 임의로 고르면 안 된다."""
    client, _ = api
    r = client.post("/api/stocks", json={"ticker": "999999"})
    assert r.status_code == 400
    candidates = {c["ticker"] for c in r.json()["detail"]["candidates"]}
    assert candidates == {"999999.KS", "999999.KQ"}


# ── 통화 설정 ────────────────────────────────────────────────────────

def test_settings_expose_base_currency_and_fx(api):
    client, _ = api
    body = client.get("/api/rebalance/settings").json()
    assert body["base_currency"] == "KRW"
    # 환율 출처가 드러나야 추정치인지 알 수 있다
    assert body["fx"]["source"] == "fallback"
    assert body["fx"]["is_estimate"] is True


def test_update_settings_only_touches_sent_fields(api):
    """밴드만 바꾸려다 기준통화가 초기화되면 안 된다."""
    client, _ = api
    client.put("/api/rebalance/settings", json={"base_currency": "USD", "usd_krw_override": 1300})

    body = client.put("/api/rebalance/settings", json={"default_rebalance_band_pct": 8.0}).json()
    assert body["default_rebalance_band_pct"] == 8.0
    assert body["base_currency"] == "USD"
    assert body["usd_krw_override"] == 1300.0
    assert body["fx"]["source"] == "override"


def test_clearing_fx_override_returns_to_auto(api):
    client, _ = api
    client.put("/api/rebalance/settings", json={"usd_krw_override": 1300})
    body = client.put("/api/rebalance/settings", json={"usd_krw_override": None}).json()
    assert body["usd_krw_override"] is None
    assert body["fx"]["source"] == "fallback"


def test_dashboard_reports_currency_per_stock(api):
    client, SessionLocal = api
    client.post("/api/stocks", json={"ticker": "삼성전자", "target_weight_pct": 50})
    client.post("/api/stocks", json={"ticker": "VOO", "target_weight_pct": 50})

    by_ticker = {card["ticker"]: card for card in client.get("/api/dashboard").json()}
    assert by_ticker["005930.KS"]["currency"] == "KRW"
    assert by_ticker["005930.KS"]["market"] == "KR"
    assert by_ticker["VOO"]["currency"] == "USD"


def test_dashboard_query_count_does_not_grow_with_stocks(api):
    """종목이 늘어도 쿼리 수가 종목 수에 비례해 늘면 안 된다.

    예전에는 종목마다 가격/지표/시그널/매수기록을 따로 읽어서 종목 수 x 6 정도가 나갔다.
    """
    from sqlalchemy import event

    client, SessionLocal = api

    def count_queries_for(tickers):
        for ticker in tickers:
            client.post("/api/stocks", json={"ticker": ticker})

        engine = SessionLocal.kw["bind"]
        counter = {"n": 0}

        def before_execute(conn, cursor, statement, params, context, executemany):
            counter["n"] += 1

        event.listen(engine, "before_cursor_execute", before_execute)
        try:
            assert client.get("/api/dashboard").status_code == 200
        finally:
            event.remove(engine, "before_cursor_execute", before_execute)
        return counter["n"]

    with_two = count_queries_for(["VOO", "QQQ"])
    with_six = count_queries_for(["NVDA", "AAPL", "삼성전자", "SK하이닉스"])

    # 종목이 3배가 돼도 쿼리는 거의 그대로여야 한다
    assert with_six <= with_two + 2, f"{with_two} -> {with_six} 쿼리 (종목당 추가 조회 발생)"


def test_staleness_is_judged_against_the_stocks_own_market(api, monkeypatch):
    """"오늘"은 시장마다 다르다. 서버 시계로 재면 한 쪽이 하루 더 오래돼 보인다.

    한국이 9월 17일이고 미국이 아직 9월 16일일 때, 두 종목 모두 각자 시장의
    마지막 거래일 종가를 가지고 있다면 어느 쪽도 "오래됐다"가 되면 안 된다.
    """
    import datetime as dt

    from app.markets import Market
    from app.models import PriceDaily, Stock

    client, Session = api
    korea_today = dt.date(2026, 9, 17)
    us_today = dt.date(2026, 9, 16)

    monkeypatch.setattr(
        "app.routers.dashboard.market_today",
        lambda market=Market.US: korea_today if market is Market.KR else us_today,
    )

    with Session() as session:
        session.add(Stock(ticker="005930.KS", name="삼성전자", target_weight_pct=50))
        session.add(Stock(ticker="VOO", name="S&P500", target_weight_pct=50))
        for ticker, date in (("005930.KS", korea_today), ("VOO", us_today)):
            session.add(
                PriceDaily(
                    ticker=ticker, date=date, open=1, high=1, low=1, close=1, volume=1
                )
            )
        session.commit()

    cards = {c["ticker"]: c for c in client.get("/api/dashboard").json()}
    assert cards["005930.KS"]["data_stale"] is False
    assert cards["VOO"]["data_stale"] is False
