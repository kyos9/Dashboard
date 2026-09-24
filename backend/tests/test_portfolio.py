"""포트폴리오 입력 — 종목 등록 때 수량·평단가, 현금, 리뷰 주기, 리밸런싱 기록 (API 쪽).

계산 자체(비중·손익·리뷰일)는 `test_rebalance.py`가 본다. 여기서는 화면이 보내는 모양이
그대로 저장되고, 보내지 않은 칸은 건드리지 않는지를 본다 — "평단가만 고쳤는데 수량이
0이 됐다" 같은 사고는 계산이 아니라 입력 자리에서 난다.
"""

import datetime as dt

from app.models import PriceDaily, SignalDaily


def _price(SessionLocal, ticker: str, close: float) -> None:
    db = SessionLocal()
    db.add(PriceDaily(ticker=ticker, date=dt.date.today(), open=close, high=close, low=close,
                      close=close, volume=1))
    db.commit()
    db.close()


# ---------------------------------------------------------------------------
#  종목 등록 — 이미 들고 있는 종목은 수량·평단가를 같이
# ---------------------------------------------------------------------------


def test_create_with_quantity_and_cost(api):
    client, _ = api
    res = client.post("/api/stocks", json={
        "ticker": "VOO", "target_weight_pct": 60, "quantity": 12.5, "avg_cost": 480.25,
    })
    assert res.status_code == 200, res.text
    (holding,) = client.get("/api/rebalance/holdings").json()
    assert (holding["quantity"], holding["avg_cost"]) == (12.5, 480.25)


def test_create_without_holding_starts_at_zero(api):
    client, _ = api
    client.post("/api/stocks", json={"ticker": "VOO", "target_weight_pct": 60})
    (holding,) = client.get("/api/rebalance/holdings").json()
    assert (holding["quantity"], holding["avg_cost"]) == (0.0, None)


def test_create_refuses_nonsense_numbers(api):
    client, _ = api
    for body in (
        {"ticker": "VOO", "quantity": -1},
        {"ticker": "VOO", "avg_cost": -5},
        {"ticker": "VOO", "target_weight_pct": 120},
    ):
        assert client.post("/api/stocks", json=body).status_code == 422, body
    assert client.get("/api/stocks").json() == []


def test_the_old_dca_fields_are_simply_ignored(api):
    """옛 화면(캐시된 앱)이 적립 칸을 보내도 등록은 된다 — 업데이트 직후 한동안 있는 일이다."""
    client, _ = api
    res = client.post("/api/stocks", json={"ticker": "VOO", "dca_amount": 300, "dca_period": "monthly"})
    assert res.status_code == 200
    assert "dca_amount" not in res.json()["stock"]


# ---------------------------------------------------------------------------
#  보유 — 평단가는 보냈을 때만 바뀐다
# ---------------------------------------------------------------------------


def test_holding_cost_is_kept_unless_sent(api):
    client, _ = api
    client.post("/api/stocks", json={"ticker": "VOO", "quantity": 10, "avg_cost": 400})

    body = client.put("/api/rebalance/holdings/VOO", json={"quantity": 12}).json()
    assert (body["quantity"], body["avg_cost"]) == (12.0, 400.0)

    body = client.put("/api/rebalance/holdings/VOO", json={"quantity": 12, "avg_cost": 410.5}).json()
    assert body["avg_cost"] == 410.5

    # null은 "모름"으로 되돌린다
    body = client.put("/api/rebalance/holdings/VOO", json={"quantity": 12, "avg_cost": None}).json()
    assert body["avg_cost"] is None


def test_holding_refuses_negative_quantity(api):
    client, _ = api
    client.post("/api/stocks", json={"ticker": "VOO"})
    assert client.put("/api/rebalance/holdings/VOO", json={"quantity": -1}).status_code == 422


# ---------------------------------------------------------------------------
#  설정 — 현금·현금 목표·리뷰 주기·직접 정한 리뷰일
# ---------------------------------------------------------------------------


def test_cash_is_merged_per_currency(api):
    client, _ = api
    client.put("/api/rebalance/settings", json={"cash": {"KRW": 3_000_000, "USD": 500}})
    body = client.put("/api/rebalance/settings", json={"cash": {"USD": 0}}).json()
    # 보낸 통화만 바뀐다 — 0은 지우기
    assert body["cash"] == {"KRW": 3_000_000.0}

    body = client.put("/api/rebalance/settings", json={"cash": {"jpy": 1000}}).json()
    assert body["cash"] == {"KRW": 3_000_000.0, "JPY": 1000.0}


def test_cash_refuses_unknown_currency_and_negatives(api):
    client, _ = api
    assert client.put("/api/rebalance/settings", json={"cash": {"XYZ": 1}}).status_code == 400
    assert client.put("/api/rebalance/settings", json={"cash": {"KRW": -1}}).status_code == 400
    assert client.put("/api/rebalance/settings", json={"cash_target_pct": 101}).status_code == 422
    assert client.get("/api/rebalance/settings").json()["cash"] == {}


def test_review_period_and_override(api):
    client, _ = api
    body = client.get("/api/rebalance/settings").json()
    assert (body["review_period"], body["review_date_override"]) == ("quarterly", None)

    body = client.put("/api/rebalance/settings", json={
        "review_period": "annual", "review_date_override": "2099-04-15", "cash_target_pct": 10,
    }).json()
    assert (body["review_period"], body["review_date_override"]) == ("annual", "2099-04-15")
    assert body["cash_target_pct"] == 10.0

    # 다른 칸만 보내면 그대로
    body = client.put("/api/rebalance/settings", json={"default_rebalance_band_pct": 4}).json()
    assert body["review_date_override"] == "2099-04-15"
    # null을 보내면 주기로 돌아간다
    body = client.put("/api/rebalance/settings", json={"review_date_override": None}).json()
    assert body["review_date_override"] is None

    assert client.put("/api/rebalance/settings", json={"review_period": "weekly"}).status_code == 422


def test_current_shows_the_override_as_next_review(api):
    client, _ = api
    client.put("/api/rebalance/settings", json={"review_date_override": "2099-04-15"})
    review = client.get("/api/rebalance/current").json()["review"]
    assert review == {**review, "next_date": "2099-04-15", "due": False, "override": "2099-04-15"}


# ---------------------------------------------------------------------------
#  리밸런싱 기록
# ---------------------------------------------------------------------------


def test_snapshot_round_trip(api):
    client, SessionLocal = api
    client.post("/api/stocks", json={"ticker": "VOO", "target_weight_pct": 90, "quantity": 2,
                                     "avg_cost": 400})
    _price(SessionLocal, "VOO", 500.0)
    client.put("/api/rebalance/settings", json={"base_currency": "USD", "cash": {"USD": 100},
                                                "cash_target_pct": 10})

    res = client.post("/api/rebalance/snapshots", json={"note": "3분기"})
    assert res.status_code == 201, res.text
    snap = res.json()
    assert snap["note"] == "3분기"
    assert snap["total_value_base"] == 1100.0
    assert snap["data"]["rows"][0]["return_pct"] == 25.0

    listed = client.get("/api/rebalance/snapshots").json()
    assert [s["id"] for s in listed] == [snap["id"]]
    # 기록을 남기면 화면의 "마지막 기록"이 채워진다
    assert client.get("/api/rebalance/current").json()["review"]["last_snapshot_at"] is not None

    assert client.delete(f"/api/rebalance/snapshots/{snap['id']}").status_code == 204
    assert client.get("/api/rebalance/snapshots").json() == []
    assert client.delete(f"/api/rebalance/snapshots/{snap['id']}").status_code == 404


def test_newest_snapshot_comes_first(api):
    client, _ = api
    client.put("/api/rebalance/settings", json={"cash": {"KRW": 1000}})
    first = client.post("/api/rebalance/snapshots", json={}).json()["id"]
    second = client.post("/api/rebalance/snapshots", json={"note": "두 번째"}).json()["id"]
    assert [s["id"] for s in client.get("/api/rebalance/snapshots").json()] == [second, first]


def test_snapshot_of_an_empty_portfolio_explains_why(api):
    client, _ = api
    res = client.post("/api/rebalance/snapshots", json={})
    assert res.status_code == 409
    assert "보유수량이나 현금" in res.json()["detail"]["hint"]


def test_snapshot_note_is_bounded(api):
    client, _ = api
    client.put("/api/rebalance/settings", json={"cash": {"KRW": 1000}})
    assert client.post("/api/rebalance/snapshots", json={"note": "가" * 201}).status_code == 422


# ---------------------------------------------------------------------------
#  대시보드 — 마지막 매수 시그널
# ---------------------------------------------------------------------------


def test_dashboard_shows_the_latest_buy_signal_day(api):
    client, SessionLocal = api
    client.post("/api/stocks", json={"ticker": "NVDA"})
    client.post("/api/stocks", json={"ticker": "QQQ"})
    db = SessionLocal()
    for day, knee in ((dt.date(2026, 9, 1), True), (dt.date(2026, 9, 12), True),
                      (dt.date(2026, 9, 18), False)):
        db.add(SignalDaily(ticker="NVDA", date=day, knee_buy_v2=knee, shoulder_sell_ref=not knee))
    db.add(SignalDaily(ticker="QQQ", date=dt.date(2026, 9, 18), knee_buy_v2=False,
                       shoulder_sell_ref=True))
    db.commit()
    db.close()

    cards = {c["ticker"]: c for c in client.get("/api/dashboard").json()}
    # 매도 시그널만 뜬 날(9/18)은 치지 않는다
    assert cards["NVDA"]["last_buy_signal_date"] == "2026-09-12"
    assert cards["QQQ"]["last_buy_signal_date"] is None
    assert "current_period_buy" not in cards["NVDA"]
