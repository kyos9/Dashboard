"""사람끼리 데이터가 섞이지 않는가 (ROADMAP 4단계 7번).

API가 40개다(표가 센다). 그중 사용자별인 것에서 `WHERE user_id` 하나만 빠져도 남의 데이터가 그대로
나간다. 눈으로 막을 수 있는 종류가 아니라서, 사람의 주의력 대신 **표**에 기댄다.

1. `ENDPOINTS` — 앱의 모든 API를 *누구 것인가*와 *누가 쓰는가*로 적은 표. 앱의 라우터
   목록과 대조해서 **표에 없는 API가 생기면 실패한다.** 새 API를 만들면서 스코프를
   잊는 것이 이 단계 이후 가장 흔한 사고인데, 이 대조가 그걸 그 자리에서 잡는다.
2. `CHECKS` — 사용자별(`MINE`) API마다 "B가 A의 것을 건드려 본다"는 확인 하나. 표에
   `MINE`으로 적고 확인을 안 붙이면 그것도 실패한다.

**남의 자원은 404다, 403이 아니다.** 403은 "그런 게 있긴 하다"를 알려준다.
(반대로 관리자(주인) 전용 동작은 403으로 잠근다 — 그 기능이 있다는 건 비밀이 아니다.)

3. *누가 쓰는가* 도 표대로인지 본다 — 관리자 전용은 사용자에게 403, 손님(로그인 전)은
   `손님` 칸만 지나가고 나머지는 401.

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
from app.models import (
    Holding,
    PriceDaily,
    RebalanceSnapshot,
    SignalDaily,
    UserSettings,
    UserStock,
)
from app.services import macro
from app.services import auth as auth_service
from app.services.users import LOCAL_USER_ID, current_user_id, require_owner, viewer_user_id
from tests.factories import make_holding, make_settings, make_stock, make_user

# ---------------------------------------------------------------------------
#  표
# ---------------------------------------------------------------------------

MINE = "사용자별"    # 응답이나 바꾸는 대상이 그 사람 것
SHARED = "공용"      # 누가 불러도 같은 값 (시세·매크로·환율·상장목록·로그)
PUBLIC = "공개"      # 로그인 전에도 열려 있다

OWNER = "주인"     # 관리자. 사용자 계정은 403
USER = "사용자"    # 로그인한 사람 누구나 (자기 것만)
GUEST = "손님"     # 로그인 전에도 읽힌다 (구글 모드). 공용이고 읽기뿐인 것만
ANYONE = "누구나"  # 로그인 화면이 쓰는 것

# (메서드, 경로) → (누구 것인가, 누가 쓰는가)
#
# 주인 전용 10개는 `require_owner` 로 잠겨 있다 — 표와 라우터가 어긋나면 아래 테스트가 잡는다.
ENDPOINTS: dict[tuple[str, str], tuple[str, str]] = {
    # 로그인
    ("GET", "/api/auth/status"): (PUBLIC, ANYONE),
    ("POST", "/api/auth/login"): (PUBLIC, ANYONE),
    ("POST", "/api/auth/logout"): (PUBLIC, ANYONE),
    ("GET", "/api/auth/google/start"): (PUBLIC, ANYONE),
    ("GET", "/api/auth/google/callback"): (PUBLIC, ANYONE),
    ("DELETE", "/api/auth/me"): (MINE, USER),  # 탈퇴 — 내 기록만 지운다
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
    # 내 포트폴리오
    ("GET", "/api/rebalance/targets"): (MINE, USER),
    ("PUT", "/api/rebalance/targets/{ticker}"): (MINE, USER),
    ("GET", "/api/rebalance/holdings"): (MINE, USER),
    ("PUT", "/api/rebalance/holdings/{ticker}"): (MINE, USER),
    ("GET", "/api/rebalance/settings"): (MINE, USER),
    ("PUT", "/api/rebalance/settings"): (MINE, USER),
    ("GET", "/api/rebalance/current"): (MINE, USER),
    ("GET", "/api/rebalance/snapshots"): (MINE, USER),
    ("POST", "/api/rebalance/snapshots"): (MINE, USER),
    ("DELETE", "/api/rebalance/snapshots/{snapshot_id}"): (MINE, USER),
    ("POST", "/api/rebalance/fx/refresh"): (SHARED, OWNER),
    # 매크로 — 지표는 공용이고, 홈에 무엇을 둘지만 그 사람 것이다
    # 손님은 즐겨찾기가 없어 기본 셋을 본다
    ("GET", "/api/macro"): (MINE, GUEST),  # 응답에 내 즐겨찾기가 들어 있다
    ("GET", "/api/macro/pinned"): (MINE, GUEST),
    ("PUT", "/api/macro/pinned"): (MINE, USER),
    ("GET", "/api/macro/{code}"): (SHARED, GUEST),
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
    # 사용자 목록·가입 승인 — 모든 사람의 이메일이 들어 있다
    ("GET", "/api/admin/users"): (SHARED, OWNER),
    ("PUT", "/api/admin/users/{user_id}/status"): (SHARED, OWNER),
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
    """주인 전용은 10개다 (ROADMAP 6-1의 8개 + 4-4b 사용자 목록·승인). 늘거나 줄면 계획과 같이 고친다."""
    owner_only = sorted(key for key, (_, who) in ENDPOINTS.items() if who == OWNER)
    assert len(owner_only) == 10, owner_only
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
    snapshots: dict  # 사용자 → 리밸런싱 기록 id
    monkeypatch: object

    def as_user(self, user_id: int):
        """이후 요청을 그 사람으로 보낸다 (로그인이 하는 일을 대신한다).

        손님에게도 열린 API는 `viewer_user_id` 로 사람을 받는다 — 둘 다 바꿔야 한다.
        하나만 바꾸면 그 API들은 문지기가 정한 1번으로 불려, B의 확인이 A를 보게 된다.
        """
        overrides = main_module.app.dependency_overrides
        overrides[current_user_id] = lambda: user_id
        overrides[viewer_user_id] = lambda: user_id
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


def _snapshot(db, user_id: int, note: str) -> int:
    """리밸런싱 기록 하나. 내용은 그 사람 것처럼 보이게 적는다."""
    row = RebalanceSnapshot(
        user_id=user_id, base_currency="KRW", total_value_base=1.0, note=note,
        data={"rows": [], "cash": {}, "fx": {}},
    )
    db.add(row)
    db.commit()
    return row.id


@pytest.fixture()
def world(api, monkeypatch) -> World:
    client, Session = api
    with Session() as db:
        make_user(db, id=B, email="b@example.com", is_owner=False)

        make_stock(db, "VOO", user_id=A, name="A의 VOO", target_weight_pct=60.0)
        make_stock(db, "QQQ", user_id=A, name="A의 QQQ", target_weight_pct=40.0, sort_order=1)
        make_stock(db, "QQQ", user_id=B, name="B의 QQQ", target_weight_pct=30.0, sort_order=1)
        make_stock(db, SAMSUNG, user_id=B, name="삼성전자", target_weight_pct=70.0, sort_order=0)

        _shared_market_data(db, "VOO", 500.0)
        _shared_market_data(db, "QQQ", 400.0)
        _shared_market_data(db, SAMSUNG, 70000.0)

        make_holding(db, "VOO", 10.0, user_id=A, avg_cost=450.0)
        make_holding(db, "QQQ", 10.0, user_id=A, avg_cost=350.0)
        make_holding(db, "QQQ", 3.0, user_id=B, avg_cost=390.0)
        make_holding(db, SAMSUNG, 5.0, user_id=B)

        make_settings(db, user_id=A, default_rebalance_band_pct=7.0, base_currency="KRW",
                      fx_overrides={"USD": 1300.0}, pinned_macro=["VIX"],
                      cash={"KRW": 1_000_000}, cash_target_pct=10.0, review_period="annual")
        make_settings(db, user_id=B, default_rebalance_band_pct=3.0, base_currency="USD",
                      pinned_macro=["DGS10"], cash={"USD": 50})

        snapshots = {A: _snapshot(db, A, "A의 기록"), B: _snapshot(db, B, "B의 기록")}
    return World(client=client, Session=Session, snapshots=snapshots, monkeypatch=monkeypatch)


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
        assert db.get(Holding, (A, "QQQ")).avg_cost == 350.0
        assert db.get(Holding, (A, "VOO")).quantity == 10.0
        settings = db.get(UserSettings, A)
        assert settings.default_rebalance_band_pct == 7.0
        assert settings.fx_overrides == {"USD": 1300.0}
        assert settings.pinned_macro == ["VIX"]
        assert settings.cash == {"KRW": 1_000_000}
        assert settings.review_period == "annual"
        assert [(r.id, r.note) for r in db.query(RebalanceSnapshot).filter_by(user_id=A)] == [
            (w.snapshots[A], "A의 기록")
        ]
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
#  맞는다 — 실제로 B만 봤을 때 보유수량 누수를 못 잡았다.


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
    # 기록은 그날의 모습이라 종목을 지워도 남는다
    assert w.get(RebalanceSnapshot, w.snapshots[B]) is not None
    _a_is_untouched(w)


def check_refresh_one(w: World):
    client = w.as_user(B)
    assert client.post("/api/stocks/VOO/refresh").status_code == 404
    assert client.post("/api/stocks/QQQ/refresh").status_code == 200


def check_dashboard(w: World):
    cards = {c["ticker"]: c for c in w.as_user(B).get("/api/dashboard").json()}
    assert set(cards) == {SAMSUNG, "QQQ"}
    assert cards["QQQ"]["name"] == "B의 QQQ"
    # 시그널은 공용이다 — 마지막 매수 시그널 날은 누구에게나 같다
    assert cards["QQQ"]["last_buy_signal_date"] == DAY.isoformat()
    theirs = {c["ticker"]: c for c in w.as_user(A).get("/api/dashboard").json()}
    assert set(theirs) == {"VOO", "QQQ"}
    assert theirs["QQQ"]["name"] == "A의 QQQ"


def check_history(w: World):
    client = w.as_user(B)
    # 시세는 공용이지만 차트는 내가 담은 종목만 열린다
    assert client.get("/api/history/VOO").status_code == 404
    res = client.get("/api/history/QQQ?range=max")
    assert res.status_code == 200
    assert len(res.json()["prices"]) == 2


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
    got = {h["ticker"]: (h["quantity"], h["avg_cost"])
           for h in w.as_user(B).get("/api/rebalance/holdings").json()}
    assert got == {SAMSUNG: (5.0, None), "QQQ": (3.0, 390.0)}
    theirs = {h["ticker"]: (h["quantity"], h["avg_cost"])
              for h in w.as_user(A).get("/api/rebalance/holdings").json()}
    assert theirs == {"VOO": (10.0, 450.0), "QQQ": (10.0, 350.0)}


def check_update_holding(w: World):
    client = w.as_user(B)
    assert client.put("/api/rebalance/holdings/VOO", json={"quantity": 1}).status_code == 404
    res = client.put("/api/rebalance/holdings/QQQ", json={"quantity": 99, "avg_cost": 1.0})
    assert res.status_code == 200
    assert (w.get(Holding, B, "QQQ").quantity, w.get(Holding, B, "QQQ").avg_cost) == (99.0, 1.0)
    _a_is_untouched(w)


def check_settings(w: World):
    got = w.as_user(B).get("/api/rebalance/settings").json()
    assert got["default_rebalance_band_pct"] == 3.0
    assert got["base_currency"] == "USD"
    assert got["cash"] == {"USD": 50.0}
    assert got["review_period"] == "quarterly"
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
        "cash": {"KRW": 5}, "cash_target_pct": 20.0, "review_period": "semiannual",
    })
    assert res.status_code == 200, res.text
    with w.Session() as db:
        mine = db.get(UserSettings, B)
        assert mine.fx_overrides == {"USD": 1111.0}
        assert mine.cash == {"USD": 50.0, "KRW": 5.0}
        assert (mine.cash_target_pct, mine.review_period) == (20.0, "semiannual")
    _a_is_untouched(w)


def check_current(w: World):
    got = w.as_user(B).get("/api/rebalance/current").json()
    assert got["base_currency"] == "USD"
    rows = {r["ticker"]: r for r in got["rows"]}
    assert set(rows) == {SAMSUNG, "QQQ"}
    assert rows["QQQ"]["quantity"] == 3.0
    assert rows["QQQ"]["avg_cost"] == 390.0
    assert got["cash"]["amounts"] == {"USD": 50.0}
    assert got["review"]["period"] == "quarterly"
    theirs = w.as_user(A).get("/api/rebalance/current").json()
    assert theirs["base_currency"] == "KRW"
    assert {r["ticker"]: r["quantity"] for r in theirs["rows"]} == {"VOO": 10.0, "QQQ": 10.0}
    assert {r["ticker"]: r["avg_cost"] for r in theirs["rows"]} == {"VOO": 450.0, "QQQ": 350.0}
    assert theirs["cash"]["amounts"] == {"KRW": 1_000_000}
    assert theirs["review"]["period"] == "annual"


def check_list_snapshots(w: World):
    got = w.as_user(B).get("/api/rebalance/snapshots").json()
    assert [(s["id"], s["note"]) for s in got] == [(w.snapshots[B], "B의 기록")]
    theirs = w.as_user(A).get("/api/rebalance/snapshots").json()
    assert [(s["id"], s["note"]) for s in theirs] == [(w.snapshots[A], "A의 기록")]


def check_create_snapshot(w: World):
    client = w.as_user(B)
    res = client.post("/api/rebalance/snapshots", json={"note": "B의 새 기록"})
    assert res.status_code == 201, res.text
    body = res.json()
    # B의 포트폴리오로 계산된다 — B의 종목, B의 기준통화
    assert body["base_currency"] == "USD"
    assert {r["ticker"] for r in body["data"]["rows"]} == {SAMSUNG, "QQQ"}
    assert {r["ticker"]: r["quantity"] for r in body["data"]["rows"]}["QQQ"] == 3.0
    assert w.get(RebalanceSnapshot, body["id"]).user_id == B
    _a_is_untouched(w)


def check_delete_snapshot(w: World):
    client = w.as_user(B)
    assert client.delete(f"/api/rebalance/snapshots/{w.snapshots[A]}").status_code == 404
    assert client.delete(f"/api/rebalance/snapshots/{w.snapshots[B]}").status_code == 204
    assert w.get(RebalanceSnapshot, w.snapshots[B]) is None
    _a_is_untouched(w)


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


def check_withdraw(w: World):
    """탈퇴는 구글 모드에서만 된다. 여기서는 **진짜 쪽지**로 부른다 — 문지기까지 지나야
    "B의 쪽지로 지운 것이 B의 것뿐인가"가 확인된다."""
    from app.models import User
    from app.services import auth as auth_service

    w.monkeypatch.setenv(auth_service.GOOGLE_CLIENT_ID_ENV, "test-client")
    main_module.app.dependency_overrides.pop(current_user_id, None)
    main_module.app.dependency_overrides.pop(viewer_user_id, None)
    with w.Session() as db:
        b = db.get(User, B)
        b.google_sub = "google-sub-b"
        db.commit()
        cookie = auth_service.issue_user_token(B, b.session_epoch, b.google_sub)

    client = w.client
    client.cookies.set(auth_service.COOKIE_NAME, cookie)
    assert client.get("/api/stocks").status_code == 200  # 쪽지가 통한다
    assert client.delete("/api/auth/me").status_code == 204

    with w.Session() as db:
        assert db.get(User, B) is None
        for model in (UserStock, Holding, RebalanceSnapshot, UserSettings):
            assert db.query(model).filter_by(user_id=B).count() == 0
        # 공용 시세는 남는다 — B만 담았던 삼성전자도
        assert db.query(PriceDaily).filter_by(ticker=SAMSUNG).count() == 2
    # 탈퇴한 사람의 쪽지는 더 이상 통하지 않는다
    client.cookies.set(auth_service.COOKIE_NAME, cookie)
    assert client.get("/api/stocks").status_code == 401
    _a_is_untouched(w)


CHECKS = {
    ("DELETE", "/api/auth/me"): check_withdraw,
    ("GET", "/api/stocks"): check_list_stocks,
    ("PUT", "/api/stocks/order"): check_order,
    ("POST", "/api/stocks"): check_create,
    ("PUT", "/api/stocks/{ticker}"): check_update_stock,
    ("DELETE", "/api/stocks/{ticker}"): check_deactivate,
    ("DELETE", "/api/stocks/{ticker}/purge"): check_purge,
    ("POST", "/api/stocks/{ticker}/refresh"): check_refresh_one,
    ("GET", "/api/dashboard"): check_dashboard,
    ("GET", "/api/history/{ticker}"): check_history,
    ("GET", "/api/rebalance/targets"): check_targets,
    ("PUT", "/api/rebalance/targets/{ticker}"): check_update_target,
    ("GET", "/api/rebalance/holdings"): check_holdings,
    ("PUT", "/api/rebalance/holdings/{ticker}"): check_update_holding,
    ("GET", "/api/rebalance/settings"): check_settings,
    ("PUT", "/api/rebalance/settings"): check_update_settings,
    ("GET", "/api/rebalance/current"): check_current,
    ("GET", "/api/rebalance/snapshots"): check_list_snapshots,
    ("POST", "/api/rebalance/snapshots"): check_create_snapshot,
    ("DELETE", "/api/rebalance/snapshots/{snapshot_id}"): check_delete_snapshot,
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


# ---------------------------------------------------------------------------
#  누가 쓰는가 — 관리자 전용과 손님
# ---------------------------------------------------------------------------


def _dependency_calls(dependant) -> set:
    """라우트가 거치는 의존성 함수 전부 (안쪽까지)."""
    calls = set()
    for sub in dependant.dependencies:
        calls.add(sub.call)
        calls |= _dependency_calls(sub)
    return calls


def test_owner_lock_matches_the_table():
    """표에 주인 전용으로 적은 것만, 전부 `require_owner` 를 거친다.

    잠금을 빠뜨리면 사용자가 전원의 시세 갱신을 돌리고 남의 오류 로그를 본다. 반대로
    사용자 API에 잘못 붙으면 친구가 자기 종목을 못 바꾼다. 둘 다 여기서 걸린다.
    """
    locked = set()
    for route in main_module.app.routes:
        if isinstance(route, APIRoute) and require_owner in _dependency_calls(route.dependant):
            locked |= {(method, route.path) for method in route.methods}
    owner_only = {key for key, (_, who) in ENDPOINTS.items() if who == OWNER}
    assert sorted(owner_only - locked) == [], "주인 전용인데 잠기지 않았습니다"
    assert sorted(locked - owner_only) == [], "표에서는 주인 전용이 아닌데 잠겼습니다"


# 주인 전용을 부를 때의 본문 — 잠금이 본문 검사보다 먼저인지도 같이 본다
OWNER_CALLS = {
    ("POST", "/api/stocks/refresh-all"): {},
    ("POST", "/api/rebalance/fx/refresh"): {},
    ("PUT", "/api/macro/{code}/forecast"): {"json": {"as_of": "2026-09-01", "value": 3.0}},
    ("DELETE", "/api/macro/{code}/forecast"): {"params": {"as_of": "2026-09-01"}},
    ("POST", "/api/macro/refresh"): {},
    ("POST", "/api/symbols/refresh-listing"): {},
    ("GET", "/api/logs"): {},
    ("GET", "/api/logs/download"): {},
    ("GET", "/api/admin/users"): {},
    ("PUT", "/api/admin/users/{user_id}/status"): {"json": {"status": "blocked"}},
}


def _url(path: str) -> str:
    return (path.replace("{ticker}", "QQQ").replace("{code}", "CPIAUCSL")
            .replace("{snapshot_id}", "1").replace("{user_id}", str(B)))


def test_user_is_refused_every_owner_api(world):
    """사용자 계정은 주인 전용 10개 모두 403. 아무것도 받아오지 않는다 (자기를 차단하지도 못한다)."""
    assert set(OWNER_CALLS) == {key for key, (_, who) in ENDPOINTS.items() if who == OWNER}
    client = world.as_user(B)
    for (method, path), kwargs in OWNER_CALLS.items():
        res = client.request(method, _url(path), **kwargs)
        assert res.status_code == 403, (method, path, res.status_code)
        assert res.json()["detail"]["hint"] == "관리자만 쓸 수 있는 기능입니다."


def test_owner_passes_the_lock(world):
    """관리자는 지나간다. 받아오는 API는 부르지 않고(네트워크), 로그·예측치로 본다."""
    client = world.as_user(A)
    assert client.get("/api/logs").status_code == 200
    assert client.get("/api/logs/download").status_code != 403
    # 없는 지표 — 잠금은 지났고, 그 다음 검사에서 404
    res = client.put("/api/macro/NOPE/forecast", json={"as_of": "2026-09-01", "value": 1.0})
    assert res.status_code == 404


def test_guest_passes_only_guest_apis(world):
    """구글 모드에서 로그인 전 손님: 표의 `손님`·`누구나` 만 지나가고 나머지는 401."""
    world.monkeypatch.setenv(auth_service.GOOGLE_CLIENT_ID_ENV, "test-client")
    overrides = main_module.app.dependency_overrides
    overrides.pop(current_user_id, None)
    overrides.pop(viewer_user_id, None)
    client = world.client
    client.cookies.clear()

    for (method, path), (_, who) in sorted(ENDPOINTS.items()):
        res = client.request(method, _url(path), follow_redirects=False)
        if who in (GUEST, ANYONE):
            assert res.status_code != 401, (method, path)
        else:
            assert res.status_code == 401, (method, path, res.status_code)


def test_guest_sees_default_pins_not_the_owners(world):
    """손님에게 1번의 즐겨찾기를 빌려주지 않는다 — 기본 셋이다. 설정 행도 안 생긴다."""
    world.monkeypatch.setenv(auth_service.GOOGLE_CLIENT_ID_ENV, "test-client")
    overrides = main_module.app.dependency_overrides
    overrides.pop(current_user_id, None)
    overrides.pop(viewer_user_id, None)
    client = world.client
    client.cookies.clear()

    assert client.get("/api/macro").json()["pinned"] == list(macro.DEFAULT_PINNED)
    assert client.get("/api/macro/pinned").json()["codes"] == list(macro.DEFAULT_PINNED)
    assert client.put("/api/macro/pinned", json={"codes": []}).status_code == 401
    with world.Session() as db:
        assert db.query(UserSettings).count() == 2  # A·B 것뿐
    _a_is_untouched(world)


def test_password_door_has_no_guests(world):
    """비밀번호 문은 한 사람의 서버다 — 문 앞에서 보여줄 것이 없다. 매크로도 401."""
    world.monkeypatch.setenv(auth_service.PASSWORD_ENV, "correct horse battery staple")
    overrides = main_module.app.dependency_overrides
    overrides.pop(current_user_id, None)
    overrides.pop(viewer_user_id, None)
    client = world.client
    client.cookies.clear()
    assert client.get("/api/macro").status_code == 401
    assert client.get("/api/macro/pinned").status_code == 401


def test_guest_door_is_read_only_by_itself(monkeypatch):
    """문지기 단계에서 이미 읽기만 연다 — 라우트 쪽 잠금(`current_user_id`·`require_owner`)과
    **둘 다** 막는다. 한쪽만 믿으면, 나중에 사람을 안 받는 쓰기 API가 `/api/macro` 아래
    생기는 날 손님이 그걸 부른다."""
    from app.routers.auth import guest_can_read

    monkeypatch.setenv(auth_service.GOOGLE_CLIENT_ID_ENV, "test-client")
    assert guest_can_read("GET", "/api/macro")
    assert guest_can_read("GET", "/api/macro/DGS10")
    for method in ("PUT", "POST", "DELETE", "PATCH"):
        assert not guest_can_read(method, "/api/macro/pinned")
    # 이름만 비슷한 주소는 아니다
    assert not guest_can_read("GET", "/api/macroeconomics")
    assert not guest_can_read("GET", "/api/stocks")
