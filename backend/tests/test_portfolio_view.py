"""대시보드 포트폴리오 보기가 쓰는 서버 계산 (ROADMAP 8-3).

1. **최근 거래일 대비** — 종목마다 *자기 시장*의 마지막 두 거래일로 잰다. 한국과 미국은 마지막
   거래일이 다르다. 전일 종가가 없는 새 종목, 보유 0 인 종목은 합계에 들어가지 않는다.
2. **환율 효과** — 산 환율(`avg_fx`)을 적은 외화 종목만 원화로 따진다. 켬·끔 × 산 환율 있음·없음 ×
   원화·달러·엔 종목의 표로 본다. 비중은 켬·끔과 무관하다. 기준통화가 달러면 켜지지 않는다.
3. **산 환율 입력** — 단위가 틀린 값(엔을 100엔 값으로)과 원화 종목의 산 환율은 받지 않는다.

대시보드와 리밸런싱은 같은 응답(`/api/rebalance/current`)을 쓴다 — 합계가 어긋날 수 없게.
"""

from __future__ import annotations

import datetime as dt

import pytest

from app.models import Holding, PriceDaily, UserSettings
from app.services import rebalance
from app.services.users import LOCAL_USER_ID
from tests.factories import make_holding, make_settings, make_stock

TODAY = dt.date.today()
D1 = TODAY - dt.timedelta(days=1)
D2 = TODAY - dt.timedelta(days=2)


def _prices(db, ticker: str, *closes: tuple[dt.date, float]) -> None:
    for date, close in closes:
        db.add(PriceDaily(ticker=ticker, date=date, open=close, high=close, low=close, close=close, volume=1))
    db.commit()


def _rows(result: dict) -> dict[str, dict]:
    return {row["ticker"]: row for row in result["rows"]}


# ---------------------------------------------------------------------------
#  최근 거래일 대비
# ---------------------------------------------------------------------------


def test_day_change_uses_each_markets_own_last_two_days(db_session):
    """미국은 어제·그제, 한국은 오늘·어제가 마지막 두 거래일인 날 — 각자 자기 두 날로 잰다."""
    make_settings(db_session, base_currency="KRW", fx_overrides={"USD": 1300.0}, cash={"KRW": 1_000_000})
    make_stock(db_session, "VOO", target_weight_pct=50.0)
    make_stock(db_session, "005930.KS", target_weight_pct=50.0)
    _prices(db_session, "VOO", (D2, 500.0), (D1, 510.0))
    _prices(db_session, "005930.KS", (D1, 70_000.0), (TODAY, 69_000.0))
    make_holding(db_session, "VOO", 2)
    make_holding(db_session, "005930.KS", 10)

    result = rebalance.compute_rebalance_current(db_session, LOCAL_USER_ID)
    rows = _rows(result)
    assert rows["VOO"]["prev_close"] == 500.0
    assert rows["VOO"]["change_pct"] == pytest.approx(2.0)
    assert rows["VOO"]["day_change"] == pytest.approx(20.0)  # 달러
    assert rows["VOO"]["day_change_base"] == pytest.approx(26_000.0)
    assert rows["005930.KS"]["prev_close"] == 70_000.0
    assert rows["005930.KS"]["day_change_base"] == pytest.approx(-10_000.0)

    # 합계 = 종목마다의 변동을 더한 것. % 는 어제의 전체 자금(현금 포함) 대비
    assert result["day_change_base"] == pytest.approx(16_000.0)
    total = 2 * 510 * 1300 + 690_000 + 1_000_000
    assert result["total_value_base"] == pytest.approx(total)
    assert result["day_change_pct"] == pytest.approx(16_000 / (total - 16_000) * 100)


def test_new_stock_without_previous_close_is_left_out(db_session):
    make_settings(db_session, base_currency="USD")
    make_stock(db_session, "AAA", target_weight_pct=50.0)
    make_stock(db_session, "NEW", target_weight_pct=50.0)
    _prices(db_session, "AAA", (D1, 100.0), (TODAY, 110.0))
    _prices(db_session, "NEW", (TODAY, 50.0))  # 막 상장 — 하루치뿐
    make_holding(db_session, "AAA", 1)
    make_holding(db_session, "NEW", 4)

    result = rebalance.compute_rebalance_current(db_session, LOCAL_USER_ID)
    rows = _rows(result)
    assert (rows["NEW"]["prev_close"], rows["NEW"]["change_pct"], rows["NEW"]["day_change_base"]) == (
        None,
        None,
        None,
    )
    assert result["day_change_base"] == pytest.approx(10.0)


def test_nothing_known_means_no_day_change_not_zero(db_session):
    """전일 종가를 아는 보유가 하나도 없으면 "모름"이다 — 0원 변동으로 보이면 거짓말이다."""
    make_stock(db_session, "NEW", target_weight_pct=100.0)
    _prices(db_session, "NEW", (TODAY, 50.0))
    make_holding(db_session, "NEW", 4)
    # 관심 종목(보유 0)의 전일 종가는 "안다"로 치지 않는다 — 들고 있지 않으니 내 돈의 변동이 아니다
    make_stock(db_session, "WATCH", target_weight_pct=0.0)
    _prices(db_session, "WATCH", (D1, 10.0), (TODAY, 11.0))
    result = rebalance.compute_rebalance_current(db_session, LOCAL_USER_ID)
    assert result["day_change_base"] is None
    assert result["day_change_pct"] is None


def test_watchlist_stock_shows_its_move_but_adds_nothing(db_session):
    """보유 0 인 종목(관심 종목)도 등락은 보인다 — 합계에는 들어가지 않는다."""
    make_settings(db_session, base_currency="USD")
    make_stock(db_session, "AAA", target_weight_pct=50.0)
    make_stock(db_session, "WATCH", target_weight_pct=0.0)
    _prices(db_session, "AAA", (D1, 100.0), (TODAY, 101.0))
    _prices(db_session, "WATCH", (D1, 10.0), (TODAY, 20.0))
    make_holding(db_session, "AAA", 1)

    result = rebalance.compute_rebalance_current(db_session, LOCAL_USER_ID)
    rows = _rows(result)
    assert rows["WATCH"]["quantity"] == 0
    assert rows["WATCH"]["change_pct"] == pytest.approx(100.0)
    assert result["day_change_base"] == pytest.approx(1.0)


def test_holdings_without_cost_are_counted_so_the_screen_can_say_so(db_session):
    make_settings(db_session, base_currency="USD")
    for ticker in ("AAA", "BBB", "CCC"):
        make_stock(db_session, ticker, target_weight_pct=30.0)
        _prices(db_session, ticker, (TODAY, 100.0))
    make_holding(db_session, "AAA", 1, avg_cost=50.0)
    make_holding(db_session, "BBB", 1)  # 평단가 모름 — 손익 합계에서 빠진다
    # CCC 는 보유 0 — 관심 종목이라 "빠졌다"고 셀 것도 없다

    result = rebalance.compute_rebalance_current(db_session, LOCAL_USER_ID)
    assert result["unpriced_count"] == 1
    assert result["unrealized_pnl_base"] == pytest.approx(50.0)


# ---------------------------------------------------------------------------
#  환율 효과
# ---------------------------------------------------------------------------

USD_NOW = 1300.0
JPY_NOW = 9.0


def _fx_world(db, *, include: bool, base: str = "KRW", avg_fx: dict[str, float | None]):
    """원화·달러·엔 종목 하나씩. 셋 다 평단가를 안다."""
    make_settings(
        db,
        base_currency=base,
        fx_overrides={"USD": USD_NOW, "JPY": JPY_NOW},
        include_fx_effect=include,
    )
    for ticker, close, qty, cost in (
        ("005930.KS", 70_000.0, 10, 50_000.0),
        ("VOO", 500.0, 2, 400.0),
        ("7203.T", 3000.0, 100, 2500.0),
    ):
        make_stock(db, ticker, target_weight_pct=30.0)
        _prices(db, ticker, (TODAY, close))
        make_holding(db, ticker, qty, avg_cost=cost, avg_fx=avg_fx.get(ticker))


@pytest.mark.parametrize("include", [False, True])
@pytest.mark.parametrize("known", [False, True])
def test_fx_effect_table(db_session, include, known):
    """켬·끔 × 산 환율 있음·없음 × 원화·달러·엔 종목."""
    avg_fx = {"VOO": 1200.0, "7203.T": 10.0} if known else {}
    _fx_world(db_session, include=include, avg_fx=avg_fx)
    result = rebalance.compute_rebalance_current(db_session, LOCAL_USER_ID)
    rows = _rows(result)
    applied = include and known

    # 원화 종목은 늘 그대로 — 환율이 없다
    kr = rows["005930.KS"]
    assert (kr["shown_currency"], kr["shown_return_pct"], kr["fx_split"], kr["fx_missing"]) == (
        "KRW",
        pytest.approx(40.0),
        None,
        False,
    )

    voo = rows["VOO"]
    # 거래 통화 손익은 켬·끔과 무관하다 (리밸런싱 기록·주문이 이 값을 쓴다)
    assert (voo["unrealized_pnl"], voo["return_pct"]) == (pytest.approx(200.0), pytest.approx(25.0))
    if applied:
        # 원화 평가금액 ÷ (수량 × 평단가 × 산 환율) − 1
        cost_krw = 2 * 400 * 1200.0
        value_krw = 2 * 500 * USD_NOW
        assert voo["shown_currency"] == "KRW"
        assert voo["shown_pnl"] == pytest.approx(value_krw - cost_krw)
        assert voo["shown_return_pct"] == pytest.approx((value_krw / cost_krw - 1) * 100)
        # 주가 +25% · 환율 +8.33% → 합계는 합이 아니라 곱
        assert voo["fx_split"] == {"price_pct": pytest.approx(25.0), "fx_pct": pytest.approx(1300 / 1200 * 100 - 100)}
        assert (1 + 0.25) * (1300 / 1200) - 1 == pytest.approx(voo["shown_return_pct"] / 100)

        jp = rows["7203.T"]
        assert jp["shown_currency"] == "KRW"
        assert jp["shown_return_pct"] == pytest.approx((300_000 * JPY_NOW / (250_000 * 10.0) - 1) * 100)
        assert jp["fx_split"]["fx_pct"] == pytest.approx(-10.0)

        # 합계도 같은 규칙 — 원화 종목은 원가 그대로, 외화는 산 환율로
        cost_base = 500_000 + cost_krw + 250_000 * 10.0
        value_base = 700_000 + value_krw + 300_000 * JPY_NOW
        assert result["cost_value_base"] == pytest.approx(cost_base)
        assert result["unrealized_pnl_base"] == pytest.approx(value_base - cost_base)
    else:
        assert (voo["shown_currency"], voo["shown_pnl"], voo["shown_return_pct"], voo["fx_split"]) == (
            "USD",
            pytest.approx(200.0),
            pytest.approx(25.0),
            None,
        )
        # 지금처럼 — 원가를 지금 환율로 환산
        assert result["cost_value_base"] == pytest.approx(500_000 + 800 * USD_NOW + 250_000 * JPY_NOW)

    # 켰는데 산 환율이 없으면 주가만으로 내고, 그렇다고 적는다
    missing = include and not known
    assert voo["fx_missing"] is missing
    assert rows["7203.T"]["fx_missing"] is missing
    assert result["fx_missing_count"] == (2 if missing else 0)
    assert result["include_fx_effect"] is include


def test_weights_do_not_move_with_the_fx_effect(db_session):
    _fx_world(db_session, include=False, avg_fx={"VOO": 1000.0, "7203.T": 5.0})
    off = {t: r["actual_weight_pct"] for t, r in _rows(rebalance.compute_rebalance_current(db_session, LOCAL_USER_ID)).items()}
    db_session.get(UserSettings, LOCAL_USER_ID).include_fx_effect = True
    db_session.commit()
    on = _rows(rebalance.compute_rebalance_current(db_session, LOCAL_USER_ID))
    assert on["VOO"]["shown_currency"] == "KRW"  # 켜진 것은 확실하다
    assert {t: r["actual_weight_pct"] for t, r in on.items()} == off


def test_dollar_base_never_applies_the_fx_effect(db_session):
    """달러 기준이면 "산 환율"의 뜻이 종목마다 달라진다 — 켜 둬도 쓰지 않는다."""
    _fx_world(db_session, include=True, base="USD", avg_fx={"VOO": 1200.0})
    result = rebalance.compute_rebalance_current(db_session, LOCAL_USER_ID)
    assert result["include_fx_effect"] is False
    assert _rows(result)["VOO"]["shown_currency"] == "USD"
    assert result["fx_missing_count"] == 0


def test_a_stray_fx_on_a_won_stock_is_ignored(db_session):
    """원화 종목에 산 환율이 남아 있어도(옛 값·직접 넣은 DB) 쓰지 않는다."""
    _fx_world(db_session, include=True, avg_fx={"005930.KS": 1300.0})
    kr = _rows(rebalance.compute_rebalance_current(db_session, LOCAL_USER_ID))["005930.KS"]
    assert (kr["avg_fx"], kr["shown_return_pct"]) == (None, pytest.approx(40.0))


# ---------------------------------------------------------------------------
#  API — 설정과 산 환율 입력
# ---------------------------------------------------------------------------


def test_fx_effect_can_only_be_turned_on_with_a_won_base(api):
    client, _ = api
    assert client.get("/api/rebalance/settings").json()["include_fx_effect"] is False

    client.put("/api/rebalance/settings", json={"base_currency": "USD"})
    res = client.put("/api/rebalance/settings", json={"include_fx_effect": True})
    assert res.status_code == 400
    assert "원" in res.json()["detail"]["hint"]
    assert client.get("/api/rebalance/settings").json()["include_fx_effect"] is False

    # 같은 요청에서 원으로 바꾸면 켜진다
    res = client.put("/api/rebalance/settings", json={"base_currency": "KRW", "include_fx_effect": True})
    assert res.status_code == 200 and res.json()["include_fx_effect"] is True

    # 달러로 옮겨도 고른 것은 남는다 (원으로 돌아오면 다시 쓴다) — 쓰지 않을 뿐
    res = client.put("/api/rebalance/settings", json={"base_currency": "USD"})
    assert res.json()["include_fx_effect"] is True
    assert client.get("/api/rebalance/current").json()["include_fx_effect"] is False

    # 끄는 것은 언제나 된다
    res = client.put("/api/rebalance/settings", json={"include_fx_effect": False})
    assert res.status_code == 200 and res.json()["include_fx_effect"] is False


def test_holding_fx_is_kept_unless_sent(api):
    client, _ = api
    client.post("/api/stocks", json={"ticker": "VOO", "quantity": 10, "avg_cost": 400})
    body = client.put("/api/rebalance/holdings/VOO", json={"quantity": 10, "avg_fx": 1350.5}).json()
    assert body["avg_fx"] == 1350.5
    body = client.put("/api/rebalance/holdings/VOO", json={"quantity": 12}).json()
    assert (body["quantity"], body["avg_cost"], body["avg_fx"]) == (12.0, 400.0, 1350.5)
    body = client.put("/api/rebalance/holdings/VOO", json={"quantity": 12, "avg_fx": None}).json()
    assert body["avg_fx"] is None


@pytest.mark.parametrize(
    "ticker, avg_fx, ok",
    [
        ("VOO", 1350.0, True),
        ("VOO", 13.5, False),  # 자릿수가 틀렸다
        ("7203.T", 9.1, True),
        ("7203.T", 910.0, False),  # 100엔 값을 그대로 보냈다
        ("005930.KS", 1300.0, False),  # 원화 종목에는 산 환율이 없다
        ("VOO", 0, False),
    ],
)
def test_holding_fx_is_checked(api, ticker, avg_fx, ok):
    client, _ = api
    client.post("/api/stocks", json={"ticker": ticker, "quantity": 1})
    res = client.put(f"/api/rebalance/holdings/{ticker}", json={"quantity": 1, "avg_fx": avg_fx})
    assert (res.status_code == 200) is ok, res.text
    if not ok:
        assert res.status_code in (400, 422)


def test_create_with_fx(api):
    client, _ = api
    res = client.post("/api/stocks", json={"ticker": "VOO", "quantity": 3, "avg_cost": 410, "avg_fx": 1320})
    assert res.status_code == 200, res.text
    (holding,) = client.get("/api/rebalance/holdings").json()
    assert (holding["quantity"], holding["avg_fx"]) == (3.0, 1320.0)


def test_create_with_wrong_fx_adds_nothing(api):
    """단위가 틀린 산 환율이면 종목도 들어가지 않는다 — 종목만 남고 보유가 빠지면 다시 적어야 한다."""
    client, SessionLocal = api
    res = client.post("/api/stocks", json={"ticker": "VOO", "quantity": 3, "avg_fx": 13})
    assert res.status_code == 400
    assert client.get("/api/stocks").json() == []
    with SessionLocal() as db:
        assert db.query(Holding).count() == 0
