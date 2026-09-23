"""사람끼리 데이터가 섞이지 않는가 (ROADMAP 4단계 7번).

API가 34개다. 그중 사용자별인 것에서 `WHERE user_id` 하나만 빠져도 남의 데이터가 그대로
나간다. 눈으로 막을 수 있는 종류가 아니라서, 사람의 주의력 대신 **표**에 기댄다.

1. `ENDPOINTS` — 앱의 모든 API를 *누구 것인가*와 *누가 쓰는가*로 적은 표. 앱의 라우터
   목록과 대조해서 **표에 없는 API가 생기면 실패한다.** 새 API를 만들면서 스코프를
   잊는 것이 이 단계 이후 가장 흔한 사고인데, 이 대조가 그걸 그 자리에서 잡는다.
2. `CHECKS` — 사용자별(`MINE`) API마다 "B가 A의 것을 건드려 본다"는 확인 하나. 표에
   `MINE`으로 적고 확인을 안 붙이면 그것도 실패한다.

**남의 자원은 404다, 403이 아니다.** 403은 "그런 게 있긴 하다"를 알려준다.
(반대로 주인 전용 동작은 4-4에서 403으로 잠근다 — 그 기능이 있다는 건 비밀이 아니다.)

두 사람은 이렇게 둔다.

- A(1번, 주인): VOO, QQQ
- B(2번): 삼성전자, QQQ

**둘 다 QQQ를 담은 것이 핵심이다.** 티커로만 거르는 실수(`Holding.ticker == "QQQ"`)는
서로 다른 종목끼리는 드러나지 않는다 — 같은 종목을 둘이 담았을 때만 남의 수량이 섞인다.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

import pytest
from fastapi.routing import APIRoute

import app.main as main_module
from app.markets import Market
from app.models import BuyExecution, BuyStatus, Holding, PriceDaily, SignalDaily, UserSettings, UserStock
from app.services import macro
from app.services.trading_calendar import period_trading_bounds
from app.services.users import LOCAL_USER_ID, current_user_id
from tests.factories import make_buy, make_holding, make_settings, make_stock, make_user

# ---------------------------------------------------------------------------
#  표
# ---------------------------------------------------------------------------

MINE = "사용자별"    # 응답이나 바꾸는 대상이 그 사람 것
SHARED = "공용"      # 누가 불러도 같은 값 (시세·매크로·환율·상장목록·로그)
PUBLIC = "공개"      # 로그인 전에도 열려 있다

OWNER = "주인"
USER = "사용자"
ANYONE = "누구나"

# (메서드, 경로) → (누구 것인가, 누가 쓰는가)
#
# "누가 쓰는가"의 주인 전용 8개는 4-4에서 실제로 잠근다. 지금은 표에 적어만 둔다 —
# 적어두지 않으면 4-4에서 무엇을 잠가야 하는지를 다시 찾아야 한다.
ENDPOINTS: dict[tuple[str, str], tuple[str, str]] = {
    # 로그인
    ("GET", "/api/auth/status"): (PUBLIC, ANYONE),
    ("POST", "/api/auth/login"): (PUBLIC, ANYONE),
    ("POST", "/api/auth/logout"): (PUBLIC, ANYONE),
    ("GET", "/api/health"): (PUBLIC, ANYONE),
    # 내 종목
    ("GET", "/api/stocks"): (MINE, USER),
    ("PUT", "/api/stocks/order"): (MINE, USER),
    ("POST", "/api/stocks"): (MINE, USER),
    ("PUT", "/api/stocks/{ticker}"): (MINE, USER),
    ("DELETE", "/api/stocks/{ticker}"): (MINE, USER),
    ("DELETE", "/api/stocks/{ticker}/purge"): (MINE, USER),
    ("POST", "/api/stocks/{ticker}/refresh"): (MINE, USER),
    ("POST", "/api/stocks/refresh-all"): (SHARED, OWNER),
    # 화면
    ("GET", "/api/dashboard"): (MINE, USER),
    ("GET", "/api/history/{ticker}"): (MINE, USER),
    ("POST", "/api/buy-executions/{buy_id}/confirm"): (MINE, USER),
    # 내 포트폴리오
    ("GET", "/api/rebalance/targets"): (MINE, USER),
    ("PUT", "/api/rebalance/targets/{ticker}"): (MINE, USER),
    ("GET", "/api/rebalance/holdings"): (MINE, USER),
    ("PUT", "/api/rebalance/holdings/{ticker}"): (MINE, USER),
    ("GET", "/api/rebalance/settings"): (MINE, USER),
    ("PUT", "/api/rebalance/settings"): (MINE, USER),
    ("GET", "/api/rebalance/current"): (MINE, USER),
    ("POST", "/api/rebalance/fx/refresh"): (SHARED, OWNER),
    # 매크로 — 지표는 공용이고, 홈에 무엇을 둘지만 그 사람 것이다
    ("GET", "/api/macro"): (MINE, USER),  # 응답에 내 즐겨찾기가 들어 있다
    ("GET", "/api/macro/pinned"): (MINE, USER),
    ("PUT", "/api/macro/pinned"): (MINE, USER),
    ("GET", "/api/macro/{code}"): (SHARED, USER),
    ("PUT", "/api/macro/{code}/forecast"): (SHARED, OWNER),
    ("DELETE", "/api/macro/{code}/forecast"): (SHARED, OWNER),
    ("POST", "/api/macro/refresh"): (SHARED, OWNER),
    # 종목 검색
    ("GET", "/api/symbols/search"): (SHARED, USER),
    ("GET", "/api/symbols/listing-status"): (SHARED, USER),
    ("POST", "/api/symbols/refresh-listing"): (SHARED, OWNER),
    # 로그·진단 — 남의 종목과 오류가 찍혀 있다
    ("GET", "/api/logs"): (SHARED, OWNER),
    ("GET", "/api/logs/download"): (SHARED, OWNER),
}


def app_endpoints() -> set[tuple[str, str]]:
    """앱이 실제로 여는 API. 화면 파일을 내주는 마지막 경로(`/{full_path:path}`)는 뺀다."""
    found = set()
    for route in main_module.app.routes:
        if isinstance(route, APIRoute) and route.path.startswith("/api/"):
            for method in route.methods:
                found.add((method, route.path))
    return found


def test_every_api_is_in_the_table():
    """새 API를 만들었으면 표에 *누구 것인가*와 *누가 쓰는가*를 적어야 한다."""
    missing = sorted(app_endpoints() - set(ENDPOINTS))
    assert not missing, (
        "표(ENDPOINTS)에 없는 API가 있습니다. 누구 것인지(사용자별/공용)와 누가 쓰는지"
        "(주인/사용자)를 정해 적고, 사용자별이면 CHECKS에 확인도 붙이세요:\n"
        + "\n".join(f"  {m} {p}" for m, p in missing)
    )


def test_the_table_has_no_api_that_is_gone():
    """지운 API가 표에 남아 있으면 표를 믿을 수 없게 된다."""
    stale = sorted(set(ENDPOINTS) - app_endpoints())
    assert not stale, "앱에 없는 API가 표에 남아 있습니다:\n" + "\n".join(
        f"  {m} {p}" for m, p in stale
    )


def test_owner_only_list_matches_the_plan():
    """주인 전용은 8개다 (ROADMAP 6-1). 늘거나 줄면 계획과 같이 고친다."""
    owner_only = sorted(key for key, (_, who) in ENDPOINTS.items() if who == OWNER)
    assert len(owner_only) == 8, owner_only
    # 주인 전용은 전부 공용 자원을 건드린다. 사용자별 자원을 주인만 쓰게 할 이유는 없다.
    assert all(ENDPOINTS[key][0] == SHARED for key in owner_only)


# ---------------------------------------------------------------------------
#  두 사람
# ---------------------------------------------------------------------------

A = LOCAL_USER_ID
B = 2
DAY = dt.date(2026, 9, 21)  # 월요일 — 한국·미국 모두 거래일
SAMSUNG = "005930.KS"


@dataclass
class World:
    client: object
    Session: object
    buys: dict  # (사용자, 티커) → 매수 기록 id

    def as_user(self, user_id: int):
        """이후 요청을 그 사람으로 보낸다 (4-3 전까지 로그인이 하는 일을 대신한다)."""
        main_module.app.dependency_overrides[current_user_id] = lambda: user_id
        return self.client

    def get(self, model, *key):
        with self.Session() as db:
            row = db.get(model, key if len(key) > 1 else key[0])
            if row is not None:
                db.expunge(row)
            return row


def _shared_market_data(db, ticker: str, close: float) -> None:
    """시세·시그널 — 공용이라 사람 수와 상관없이 한 벌이다."""
    db.add(PriceDaily(ticker=ticker, date=DAY - dt.timedelta(days=1), open=1, high=1, low=1,
                      close=close * 0.99, volume=1))
    db.add(PriceDaily(ticker=ticker, date=DAY, open=1, high=1, low=1, close=close, volume=1))
    db.add(SignalDaily(ticker=ticker, date=DAY, knee_buy_v2=True, shoulder_sell_ref=False))


def _this_period_buy(db, stock: UserStock, market: Market, amount: float) -> int:
    """대시보드가 "이번 기간"으로 읽을 매수 기록 하나."""
    start, end = period_trading_bounds(DAY, stock.dca_period.value, market)
    return make_buy(
        db, stock.ticker, user_id=stock.user_id, period_start=start, period_end=end,
        exec_date=DAY, amount=amount,
    ).id


@pytest.fixture()
def world(api) -> World:
    client, Session = api
    buys = {}
    with Session() as db:
        make_user(db, id=B, email="b@example.com", is_owner=False)

        voo = make_stock(db, "VOO", user_id=A, name="A의 VOO", target_weight_pct=60.0)
        qqq_a = make_stock(db, "QQQ", user_id=A, name="A의 QQQ", target_weight_pct=40.0,
                           sort_order=1)
        qqq_b = make_stock(db, "QQQ", user_id=B, name="B의 QQQ", target_weight_pct=30.0,
                           sort_order=1)
        samsung = make_stock(db, SAMSUNG, user_id=B, name="삼성전자", target_weight_pct=70.0,
                             sort_order=0)

        _shared_market_data(db, "VOO", 500.0)
        _shared_market_data(db, "QQQ", 400.0)
        _shared_market_data(db, SAMSUNG, 70000.0)

        make_holding(db, "VOO", 10.0, user_id=A)
        make_holding(db, "QQQ", 10.0, user_id=A)
        make_holding(db, "QQQ", 3.0, user_id=B)
        make_holding(db, SAMSUNG, 5.0, user_id=B)

        make_settings(db, user_id=A, default_rebalance_band_pct=7.0, base_currency="KRW",
                      fx_overrides={"USD": 1300.0}, pinned_macro=["VIX"])
        make_settings(db, user_id=B, default_rebalance_band_pct=3.0, base_currency="USD",
                      pinned_macro=["DGS10"])

        buys[(A, "VOO")] = _this_period_buy(db, voo, Market.US, 111.0)
        buys[(A, "QQQ")] = _this_period_buy(db, qqq_a, Market.US, 222.0)
        buys[(B, "QQQ")] = _this_period_buy(db, qqq_b, Market.US, 333.0)
        buys[(B, SAMSUNG)] = _this_period_buy(db, samsung, Market.KR, 444.0)
    return World(client=client, Session=Session, buys=buys)


def _a_is_untouched(w: World) -> None:
    """B가 무엇을 했든 A의 것은 그대로여야 한다. 확인마다 끝에 부른다."""
    with w.Session() as db:
        mine = {s.ticker: s for s in db.query(UserStock).filter_by(user_id=A)}
        assert set(mine) == {"VOO", "QQQ"}
        assert mine["QQQ"].name == "A의 QQQ"
        assert mine["QQQ"].active is True
        assert mine["QQQ"].target_weight_pct == 40.0
        assert mine["QQQ"].sort_order == 1
        assert db.get(Holding, (A, "QQQ")).quantity == 10.0
        assert db.get(Holding, (A, "VOO")).quantity == 10.0
        settings = db.get(UserSettings, A)
        assert settings.default_rebalance_band_pct == 7.0
        assert settings.fx_overrides == {"USD": 1300.0}
        assert settings.pinned_macro == ["VIX"]
        buy = db.get(BuyExecution, w.buys[(A, "QQQ")])
        assert buy.status == BuyStatus.scheduled
        # 공용 시세도 그대로 — A가 아직 QQQ를 담고 있다
        assert db.query(PriceDaily).filter_by(ticker="QQQ").count() == 2


# ---------------------------------------------------------------------------
#  사용자별 API마다 확인 하나
# ---------------------------------------------------------------------------
#
#  각 확인은 **B로** 부른다. 두 가지를 본다 — B가 A의 것에 손대면 404(또는 A의 것이
#  안 보이고), B가 자기 것을 바꿔도 A의 같은 종목(QQQ)은 그대로다. 그리고 B의 결과가
#  비어 있지 않은지도 본다 — 전부 404를 돌려주는 망가진 앱도 "안 섞인다"는 통과한다.
#
#  **읽는 확인은 A와 B 둘 다 본다.** 사용자로 안 거른 코드는 대개 `{티커: 행}` 으로
#  모으는데, 그러면 둘이 담은 QQQ는 **나중에 읽힌 행이 이긴다.** 한쪽만 보면 반은 우연히
#  맞는다 — 실제로 B만 봤을 때 보유수량·매수 기록 누수 셋을 못 잡았다.


def check_list_stocks(w: World):
    got = w.as_user(B).get("/api/stocks").json()
    assert [s["ticker"] for s in got] == [SAMSUNG, "QQQ"]
    assert got[1]["name"] == "B의 QQQ"
    assert {s["ticker"] for s in w.as_user(A).get("/api/stocks").json()} == {"VOO", "QQQ"}


def check_order(w: World):
    client = w.as_user(B)
    assert client.put("/api/stocks/order", json={"tickers": ["VOO"]}).status_code == 404
    assert client.put("/api/stocks/order", json={"tickers": ["QQQ", SAMSUNG]}).status_code == 200
    assert [s["ticker"] for s in client.get("/api/stocks").json()] == ["QQQ", SAMSUNG]
    _a_is_untouched(w)


def check_create(w: World):
    client = w.as_user(B)
    # 남이 담은 종목을 내가 담는 것은 된다 — "이미 있다"는 내 목록 기준이다
    res = client.post("/api/stocks", json={"ticker": "VOO"})
    assert res.status_code == 200, res.text
    assert client.post("/api/stocks", json={"ticker": "QQQ"}).status_code == 409
    with w.Session() as db:
        assert db.query(UserStock).filter_by(user_id=B, ticker="VOO").count() == 1
        assert db.get(UserStock, (A, "VOO")).name == "A의 VOO"
    _a_is_untouched(w)


def check_update_stock(w: World):
    client = w.as_user(B)
    assert client.put("/api/stocks/VOO", json={"name": "뺏기"}).status_code == 404
    assert client.put("/api/stocks/QQQ", json={"name": "B가 고친 이름"}).status_code == 200
    assert w.get(UserStock, B, "QQQ").name == "B가 고친 이름"
    _a_is_untouched(w)


def check_deactivate(w: World):
    client = w.as_user(B)
    assert client.delete("/api/stocks/VOO").status_code == 404
    assert client.delete("/api/stocks/QQQ").status_code == 200
    assert w.get(UserStock, B, "QQQ").active is False
    _a_is_untouched(w)


def check_purge(w: World):
    client = w.as_user(B)
    assert client.delete("/api/stocks/VOO/purge").status_code == 404
    assert w.get(UserStock, A, "VOO") is not None
    # B가 QQQ를 치워도 A가 담고 있으니 공용 시세는 남는다
    assert client.delete("/api/stocks/QQQ/purge").status_code == 204
    assert w.get(UserStock, B, "QQQ") is None
    assert w.get(Holding, B, "QQQ") is None
    assert w.get(BuyExecution, w.buys[(B, "QQQ")]) is None
    _a_is_untouched(w)


def check_refresh_one(w: World):
    client = w.as_user(B)
    assert client.post("/api/stocks/VOO/refresh").status_code == 404
    assert client.post("/api/stocks/QQQ/refresh").status_code == 200


def check_dashboard(w: World):
    cards = {c["ticker"]: c for c in w.as_user(B).get("/api/dashboard").json()}
    assert set(cards) == {SAMSUNG, "QQQ"}
    # 같은 QQQ라도 이번 기간 매수 기록은 B의 것이어야 한다
    assert cards["QQQ"]["current_period_buy"]["id"] == w.buys[(B, "QQQ")]
    assert cards["QQQ"]["current_period_buy"]["amount"] == 333.0
    assert cards["QQQ"]["name"] == "B의 QQQ"
    theirs = {c["ticker"]: c for c in w.as_user(A).get("/api/dashboard").json()}
    assert set(theirs) == {"VOO", "QQQ"}
    assert theirs["QQQ"]["current_period_buy"]["id"] == w.buys[(A, "QQQ")]


def check_history(w: World):
    client = w.as_user(B)
    # 시세는 공용이지만 차트는 내가 담은 종목만 열린다
    assert client.get("/api/history/VOO").status_code == 404
    res = client.get("/api/history/QQQ?range=max")
    assert res.status_code == 200
    assert len(res.json()["prices"]) == 2


def check_confirm(w: World):
    client = w.as_user(B)
    res = client.post(f"/api/buy-executions/{w.buys[(A, 'QQQ')]}/confirm",
                      json={"apply_to_holding": True})
    assert res.status_code == 404
    res = client.post(f"/api/buy-executions/{w.buys[(B, 'QQQ')]}/confirm",
                      json={"apply_to_holding": True})
    assert res.status_code == 200
    # 확정한 수량은 **B의** 보유에 더해진다: 333 / 400 = 0.8325주
    assert w.get(Holding, B, "QQQ").quantity == pytest.approx(3.0 + 333.0 / 400.0)
    _a_is_untouched(w)


def check_targets(w: World):
    got = {t["ticker"]: t for t in w.as_user(B).get("/api/rebalance/targets").json()}
    assert set(got) == {SAMSUNG, "QQQ"}
    assert got["QQQ"]["target_weight_pct"] == 30.0
    theirs = {t["ticker"]: t for t in w.as_user(A).get("/api/rebalance/targets").json()}
    assert theirs["QQQ"]["target_weight_pct"] == 40.0


def check_update_target(w: World):
    client = w.as_user(B)
    assert client.put("/api/rebalance/targets/VOO", json={"target_weight_pct": 1}).status_code == 404
    assert client.put("/api/rebalance/targets/QQQ", json={"target_weight_pct": 5}).status_code == 200
    assert w.get(UserStock, B, "QQQ").target_weight_pct == 5.0
    _a_is_untouched(w)


def check_holdings(w: World):
    got = {h["ticker"]: h["quantity"] for h in w.as_user(B).get("/api/rebalance/holdings").json()}
    assert got == {SAMSUNG: 5.0, "QQQ": 3.0}
    theirs = {h["ticker"]: h["quantity"] for h in w.as_user(A).get("/api/rebalance/holdings").json()}
    assert theirs == {"VOO": 10.0, "QQQ": 10.0}


def check_update_holding(w: World):
    client = w.as_user(B)
    assert client.put("/api/rebalance/holdings/VOO", json={"quantity": 1}).status_code == 404
    assert client.put("/api/rebalance/holdings/QQQ", json={"quantity": 99}).status_code == 200
    assert w.get(Holding, B, "QQQ").quantity == 99.0
    _a_is_untouched(w)


def check_settings(w: World):
    got = w.as_user(B).get("/api/rebalance/settings").json()
    assert got["default_rebalance_band_pct"] == 3.0
    assert got["base_currency"] == "USD"
    # A가 직접 넣은 달러 환율은 B의 화면에 얹히지 않는다
    assert got["fx_overrides"] == {}
    assert got["fx"]["rates"]["USD"]["source"] != "override"
    # A의 화면에는 그대로 얹혀 있다 — 위 확인이 "원래 안 얹히는 앱"을 통과시키지 않게
    theirs = w.as_user(A).get("/api/rebalance/settings").json()
    assert theirs["fx"]["rates"]["USD"] == {**theirs["fx"]["rates"]["USD"],
                                            "source": "override", "krw_rate": 1300.0}


def check_update_settings(w: World):
    client = w.as_user(B)
    res = client.put("/api/rebalance/settings", json={
        "default_rebalance_band_pct": 9.0, "fx_overrides": {"USD": 1111.0},
    })
    assert res.status_code == 200, res.text
    with w.Session() as db:
        assert db.get(UserSettings, B).fx_overrides == {"USD": 1111.0}
    _a_is_untouched(w)


def check_current(w: World):
    got = w.as_user(B).get("/api/rebalance/current").json()
    assert got["base_currency"] == "USD"
    rows = {r["ticker"]: r for r in got["rows"]}
    assert set(rows) == {SAMSUNG, "QQQ"}
    assert rows["QQQ"]["quantity"] == 3.0
    theirs = w.as_user(A).get("/api/rebalance/current").json()
    assert theirs["base_currency"] == "KRW"
    assert {r["ticker"]: r["quantity"] for r in theirs["rows"]} == {"VOO": 10.0, "QQQ": 10.0}


def check_macro_overview(w: World):
    assert w.as_user(B).get("/api/macro").json()["pinned"] == ["DGS10"]
    assert w.as_user(A).get("/api/macro").json()["pinned"] == ["VIX"]


def check_pinned(w: World):
    assert w.as_user(B).get("/api/macro/pinned").json()["codes"] == ["DGS10"]
    assert w.as_user(A).get("/api/macro/pinned").json()["codes"] == ["VIX"]


def check_update_pinned(w: World):
    client = w.as_user(B)
    res = client.put("/api/macro/pinned", json={"codes": [macro.TERM_SPREAD_CODE]})
    assert res.status_code == 200, res.text
    assert client.get("/api/macro/pinned").json()["codes"] == [macro.TERM_SPREAD_CODE]
    _a_is_untouched(w)


CHECKS = {
    ("GET", "/api/stocks"): check_list_stocks,
    ("PUT", "/api/stocks/order"): check_order,
    ("POST", "/api/stocks"): check_create,
    ("PUT", "/api/stocks/{ticker}"): check_update_stock,
    ("DELETE", "/api/stocks/{ticker}"): check_deactivate,
    ("DELETE", "/api/stocks/{ticker}/purge"): check_purge,
    ("POST", "/api/stocks/{ticker}/refresh"): check_refresh_one,
    ("GET", "/api/dashboard"): check_dashboard,
    ("GET", "/api/history/{ticker}"): check_history,
    ("POST", "/api/buy-executions/{buy_id}/confirm"): check_confirm,
    ("GET", "/api/rebalance/targets"): check_targets,
    ("PUT", "/api/rebalance/targets/{ticker}"): check_update_target,
    ("GET", "/api/rebalance/holdings"): check_holdings,
    ("PUT", "/api/rebalance/holdings/{ticker}"): check_update_holding,
    ("GET", "/api/rebalance/settings"): check_settings,
    ("PUT", "/api/rebalance/settings"): check_update_settings,
    ("GET", "/api/rebalance/current"): check_current,
    ("GET", "/api/macro"): check_macro_overview,
    ("GET", "/api/macro/pinned"): check_pinned,
    ("PUT", "/api/macro/pinned"): check_update_pinned,
}


def test_every_per_user_api_has_a_check():
    """표에 사용자별로 적었으면 확인이 있어야 한다. 적기만 하고 안 보면 표가 거짓말한다."""
    mine = {key for key, (whose, _) in ENDPOINTS.items() if whose == MINE}
    assert sorted(mine - set(CHECKS)) == [], "사용자별 API인데 CHECKS에 확인이 없습니다"
    assert sorted(set(CHECKS) - mine) == [], "CHECKS에 있는데 표에서는 사용자별이 아닙니다"


@pytest.mark.parametrize("endpoint", sorted(CHECKS), ids=lambda e: f"{e[0]} {e[1]}")
def test_b_cannot_see_or_touch_what_is_a(world, endpoint):
    CHECKS[endpoint](world)
