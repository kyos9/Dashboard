"""문을 열기 전의 한도 — 공용 수집과 버튼마다의 외부 호출 (ROADMAP 4-4b-2).

- 매일 받는 대상은 **보고 있는 종목의 합집합**이다. 둘이 같은 종목을 담아도 한 번.
- 삭제는 **내 목록에서** 빼는 것이다. 공용 시세는 남는다.
- 한 사람이 담을 수 있는 종목 수, 하루에 처음 받게 할 수 있는 종목 수.
- 종목 새로고침은 **종목마다** 쿨다운. 전체 기간 다시 받기는 관리자만.
- 바깥 검색은 사람마다 분당 몇 번.

A(1번)는 관리자, B(2번)는 사용자다. 한도는 사용자에게 걸린다.
"""

from __future__ import annotations

import datetime as dt

import pandas as pd
import pytest

import app.main as main_module
from app.markets import Market
from app.models import PriceDaily, User, UserStock
from app.services import backfill, limits, pipeline, symbols
from app.services.instruments import ensure_instrument
from app.services.users import (
    LOCAL_USER_ID,
    STATUS_BLOCKED,
    STATUS_PENDING,
    current_user_id,
    viewer_user_id,
)
from tests.factories import make_stock, make_user

A = LOCAL_USER_ID
B = 2
DAY = dt.date(2026, 9, 21)


# ---------------------------------------------------------------------------
#  수집 합집합
# ---------------------------------------------------------------------------


@pytest.fixture()
def fetched(monkeypatch):
    """조회에 넘어간 티커를 적는다 — 외부 호출 수가 곧 이 목록의 길이다."""
    asked: list[str] = []

    def fetch_many(requests, period="2y"):
        asked.extend(ticker for ticker, _ in requests)
        return {ticker: pd.DataFrame() for ticker, _ in requests}

    monkeypatch.setattr(pipeline.data_ingestion, "fetch_many", fetch_many)
    monkeypatch.setattr(
        pipeline, "refresh_and_evaluate_stock",
        lambda db, stock, full_backfill=False, price_df=None: {"ticker": stock.ticker},
    )
    monkeypatch.setattr(pipeline.fx, "refresh_rates", lambda db: None)
    return asked


def _two_people(db, b_status: str = "active") -> None:
    make_user(db, id=B, email="b@example.com", is_owner=False, status=b_status)
    make_stock(db, "VOO", user_id=A)
    make_stock(db, "QQQ", user_id=A)
    make_stock(db, "QQQ", user_id=B)
    make_stock(db, "005930.KS", user_id=B)


def test_a_ticker_two_people_hold_is_fetched_once(db_session, fetched):
    _two_people(db_session)
    results = pipeline.refresh_all_active_stocks(db_session)
    assert sorted(fetched) == ["005930.KS", "QQQ", "VOO"]
    assert sorted(r["ticker"] for r in results) == ["005930.KS", "QQQ", "VOO"]


def test_hiding_a_stock_does_not_stop_it_for_someone_else(db_session, fetched):
    """A가 QQQ를 치워도(비활성) B가 보고 있으면 계속 받는다. 둘 다 치우면 멈춘다."""
    _two_people(db_session)
    db_session.get(UserStock, (A, "QQQ")).active = False
    db_session.commit()
    pipeline.refresh_all_active_stocks(db_session)
    assert "QQQ" in fetched

    fetched.clear()
    db_session.get(UserStock, (B, "QQQ")).active = False
    db_session.commit()
    pipeline.refresh_all_active_stocks(db_session)
    assert sorted(fetched) == ["005930.KS", "VOO"]


@pytest.mark.parametrize("status", [STATUS_BLOCKED, STATUS_PENDING])
def test_people_who_cannot_look_are_not_collected_for(db_session, fetched, status):
    """차단·승인 대기인 사람만 담은 종목은 매일 받지 않는다 (볼 수 없는 사람이다)."""
    _two_people(db_session, b_status=status)
    pipeline.refresh_all_active_stocks(db_session)
    assert sorted(fetched) == ["QQQ", "VOO"]  # QQQ 는 A도 보고 있다


def test_catch_up_ignores_stocks_only_blocked_people_hold(db_session, monkeypatch):
    """켤 때 따라잡기도 같은 기준이다 — 안 그러면 차단된 사람의 종목 때문에 시장 전체를 다시 받는다."""
    make_user(db_session, id=B, email="b@example.com", is_owner=False, status=STATUS_BLOCKED)
    make_stock(db_session, "005930.KS", user_id=B)
    monkeypatch.setattr(pipeline, "last_closed_trading_day", lambda market: DAY)
    assert pipeline.stale_markets(db_session) == []

    db_session.get(User, B).status = "active"
    db_session.commit()
    assert pipeline.stale_markets(db_session) == [Market.KR]


def test_daily_refresh_starts_the_button_cooldown(db_session, fetched):
    """밤에 받았으면 아침에 누른 새로고침은 다시 받지 않고 "받았다"고 답한다."""
    make_stock(db_session, "VOO")
    pipeline.refresh_all_active_stocks(db_session)
    assert limits.refresh_cooldown.check("VOO") is not None


# ---------------------------------------------------------------------------
#  API — 두 사람
# ---------------------------------------------------------------------------


class People:
    def __init__(self, client, Session):
        self.client = client
        self.Session = Session

    def as_(self, user_id: int):
        overrides = main_module.app.dependency_overrides
        overrides[current_user_id] = lambda: user_id
        overrides[viewer_user_id] = lambda: user_id
        return self.client

    def prices(self, ticker: str, days: int = 1) -> None:
        with self.Session() as db:
            ensure_instrument(db, ticker)
            for back in range(days):
                db.add(PriceDaily(ticker=ticker, date=DAY - dt.timedelta(days=back),
                                  open=1, high=1, low=1, close=1, volume=1))
            db.commit()

    def count(self, model, **where) -> int:
        with self.Session() as db:
            return db.query(model).filter_by(**where).count()


@pytest.fixture()
def people(api, monkeypatch):
    # 넣어둔 시세가 최신이게 — 그래야 담을 때 받으러 가지 않고, 새로고침만 따로 센다
    # (담을 때 최근분을 받으면 그것도 쿨다운을 시작한다. 그게 맞는 동작이다)
    monkeypatch.setattr("app.routers.stocks.last_closed_trading_day", lambda market: DAY)
    client, Session = api
    with Session() as db:
        make_user(db, id=B, email="b@example.com", is_owner=False)
    yield People(client, Session)
    main_module.app.dependency_overrides.pop(current_user_id, None)
    main_module.app.dependency_overrides.pop(viewer_user_id, None)


@pytest.fixture()
def downloads(monkeypatch):
    """새로고침·등록이 실제로 받으러 간 기록 — (티커, 전체 기간이었나)."""
    calls: list[tuple[str, bool]] = []

    def record(db, stock, full_backfill=False, price_df=None):
        calls.append((stock.ticker, full_backfill))
        return {"ticker": stock.ticker, "rows_upserted": 1}

    monkeypatch.setattr("app.routers.stocks.refresh_and_evaluate_stock", record)
    return calls


# --- 삭제 -------------------------------------------------------------------


def test_purge_by_one_person_leaves_the_other_untouched(people, downloads):
    people.prices("QQQ")
    people.as_(A).post("/api/stocks", json={"ticker": "QQQ"})
    people.as_(B).post("/api/stocks", json={"ticker": "QQQ"})

    assert people.as_(A).delete("/api/stocks/QQQ/purge").status_code == 204
    assert [s["ticker"] for s in people.as_(B).get("/api/stocks").json()] == ["QQQ"]
    assert people.as_(B).get("/api/history/QQQ?range=max").status_code == 200
    assert people.count(PriceDaily, ticker="QQQ") == 1


def test_purge_keeps_the_loading_badge_someone_else_is_waiting_on(people, downloads, monkeypatch):
    """"받는 중·못 받음" 표시는 티커마다 하나다. 내가 지웠다고 남의 화면에서 지우면 안 된다."""
    people.as_(A).post("/api/stocks", json={"ticker": "QQQ"})
    people.as_(B).post("/api/stocks", json={"ticker": "QQQ"})
    backfill.fail("QQQ", hint="못 받았습니다", error="x")

    people.as_(A).delete("/api/stocks/QQQ/purge")
    assert backfill.status("QQQ") is not None

    people.as_(B).delete("/api/stocks/QQQ/purge")  # 마지막 사람이 빼면 치운다
    assert backfill.status("QQQ") is None


def test_adding_back_a_purged_stock_downloads_nothing_new(people, downloads):
    """남겨둔 시세 덕에 다시 담을 때 처음부터 받지 않는다."""
    people.prices("VOO")
    client = people.as_(B)
    client.post("/api/stocks", json={"ticker": "VOO"})
    client.delete("/api/stocks/VOO/purge")
    assert client.post("/api/stocks", json={"ticker": "VOO"}).json()["data_loaded"] is True
    assert downloads == []


# --- 종목 수 상한 -------------------------------------------------------------


def _fill(people, user_id: int, n: int) -> None:
    with people.Session() as db:
        for i in range(n):
            make_stock(db, f"T{i:03d}", user_id=user_id, commit=False)
        db.commit()


def test_a_user_can_hold_up_to_the_cap(people, downloads):
    from app.routers.stocks import MAX_STOCKS_PER_USER

    people.prices("VOO")
    _fill(people, B, MAX_STOCKS_PER_USER - 1)
    client = people.as_(B)
    assert client.post("/api/stocks", json={"ticker": "VOO"}).status_code == 200

    people.prices("QQQ")
    refused = client.post("/api/stocks", json={"ticker": "QQQ"})
    assert refused.status_code == 409
    assert f"{MAX_STOCKS_PER_USER}개까지" in refused.json()["detail"]["hint"]
    assert people.count(UserStock, user_id=B, ticker="QQQ") == 0


def test_hidden_stocks_count_toward_the_cap(people, downloads):
    """비활성도 센다 — 숨기고 새로 넣기를 되풀이하면 상한이 뜻이 없다."""
    from app.routers.stocks import MAX_STOCKS_PER_USER

    _fill(people, B, MAX_STOCKS_PER_USER)
    with people.Session() as db:
        db.query(UserStock).filter_by(user_id=B).update({"active": False})
        db.commit()
    people.prices("VOO")
    assert people.as_(B).post("/api/stocks", json={"ticker": "VOO"}).status_code == 409


def test_the_owner_has_no_cap(people, downloads):
    from app.routers.stocks import MAX_STOCKS_PER_USER

    _fill(people, A, MAX_STOCKS_PER_USER)
    people.prices("VOO")
    assert people.as_(A).post("/api/stocks", json={"ticker": "VOO"}).status_code == 200


# --- 하루에 처음 받는 종목 ------------------------------------------------------


def test_first_time_tickers_are_limited_per_day(people, downloads):
    client = people.as_(B)
    tickers = [f"N{i:02d}" for i in range(limits.NEW_TICKERS_PER_DAY)]
    for ticker in tickers:
        assert client.post("/api/stocks", json={"ticker": ticker}).status_code == 200
    assert downloads == [(t, True) for t in tickers]

    refused = client.post("/api/stocks", json={"ticker": "ONEMORE"})
    assert refused.status_code == 429
    assert "하루" in refused.json()["detail"]["hint"]
    assert people.count(UserStock, user_id=B, ticker="ONEMORE") == 0  # 행도 안 남긴다

    # 이미 누가 받아둔 종목은 외부 호출이 없으므로 한도와 상관없다
    people.prices("VOO")
    assert client.post("/api/stocks", json={"ticker": "VOO"}).status_code == 200


def test_the_limit_is_per_person_and_not_for_the_owner(people, downloads):
    client = people.as_(B)
    for i in range(limits.NEW_TICKERS_PER_DAY):
        client.post("/api/stocks", json={"ticker": f"N{i:02d}"})
    assert client.post("/api/stocks", json={"ticker": "ONEMORE"}).status_code == 429

    owner = people.as_(A)
    for i in range(limits.NEW_TICKERS_PER_DAY + 2):
        assert owner.post("/api/stocks", json={"ticker": f"M{i:02d}"}).status_code == 200


def test_the_daily_limit_frees_up_after_a_day():
    now = [1000.0]
    limit = limits.SlidingLimit(2, 24 * 60 * 60, clock=lambda: now[0])
    assert limit.allow(B) and limit.allow(B)
    assert not limit.allow(B) and not limit.has_room(B)
    assert limit.has_room(A)  # 사람마다 따로
    now[0] += 24 * 60 * 60 - 1
    assert not limit.has_room(B)
    now[0] += 1
    assert limit.has_room(B) and limit.allow(B)


# --- 종목 새로고침 --------------------------------------------------------------


@pytest.fixture()
def clock(monkeypatch):
    now = [5000.0]
    monkeypatch.setattr(limits.refresh_cooldown, "_clock", lambda: now[0])
    return now


def test_refresh_cooldown_is_per_ticker_not_per_person(people, downloads, clock):
    people.prices("QQQ")
    people.as_(A).post("/api/stocks", json={"ticker": "QQQ"})
    people.as_(B).post("/api/stocks", json={"ticker": "QQQ"})
    downloads.clear()

    first = people.as_(B).post("/api/stocks/QQQ/refresh")
    assert first.status_code == 200 and "skipped" not in first.json()

    clock[0] += 180
    again = people.as_(B).post("/api/stocks/QQQ/refresh")
    assert again.status_code == 200
    assert again.json()["skipped"] is True
    assert again.json()["hint"].startswith("3분 전에 받았습니다")
    assert downloads == [("QQQ", False)]  # 두 번째는 받으러 가지 않았다

    # 쿨다운이 지나면 다시 받는다
    clock[0] += limits.REFRESH_COOLDOWN_SECONDS
    assert "skipped" not in people.as_(B).post("/api/stocks/QQQ/refresh").json()
    assert len(downloads) == 2


def test_other_people_share_the_same_cooldown(people, downloads, clock):
    """30명이 같은 종목을 눌러도 실제 조회는 한 번이다 — 외부 호출 총량이 사람 수와 무관하다."""
    people.prices("QQQ")
    with people.Session() as db:
        make_user(db, id=3, email="c@example.com", is_owner=False)
    for user in (B, 3):
        people.as_(user).post("/api/stocks", json={"ticker": "QQQ"})
    downloads.clear()

    people.as_(B).post("/api/stocks/QQQ/refresh")
    assert people.as_(3).post("/api/stocks/QQQ/refresh").json()["skipped"] is True
    assert downloads == [("QQQ", False)]


def test_the_owner_does_not_wait(people, downloads, clock):
    people.prices("VOO")
    client = people.as_(A)
    client.post("/api/stocks", json={"ticker": "VOO"})
    client.post("/api/stocks/VOO/refresh")
    assert "skipped" not in client.post("/api/stocks/VOO/refresh").json()
    assert downloads == [("VOO", False), ("VOO", False)]


def test_a_failed_refresh_can_be_retried_after_a_minute(people, clock, monkeypatch):
    from app.services import data_ingestion

    people.prices("VOO")
    client = people.as_(B)
    client.post("/api/stocks", json={"ticker": "VOO"})

    def boom(db, stock, full_backfill=False, price_df=None):
        raise data_ingestion.DataIngestionError("VOO: 제공자 응답 없음", hint="잠시 뒤 다시")

    monkeypatch.setattr("app.routers.stocks.refresh_and_evaluate_stock", boom)
    assert client.post("/api/stocks/VOO/refresh").status_code == 502

    clock[0] += 10
    busy = client.post("/api/stocks/VOO/refresh")
    assert busy.status_code == 429
    assert "초 뒤에 다시" in busy.json()["detail"]["hint"]

    clock[0] += limits.REFRESH_RETRY_SECONDS
    assert client.post("/api/stocks/VOO/refresh").status_code == 502  # 다시 받으러 갔다


def test_full_backfill_is_owner_only(people, downloads):
    people.prices("VOO")
    people.as_(A).post("/api/stocks", json={"ticker": "VOO"})
    people.as_(B).post("/api/stocks", json={"ticker": "VOO"})

    refused = people.as_(B).post("/api/stocks/VOO/refresh?full=true")
    assert refused.status_code == 403
    assert "관리자만" in refused.json()["detail"]["hint"]
    assert downloads == []

    assert people.as_(A).post("/api/stocks/VOO/refresh?full=true").status_code == 200
    assert downloads == [("VOO", True)]


def test_a_stock_with_no_prices_yet_is_filled_whole_by_anyone(people, monkeypatch):
    """등록할 때 받지 못해 한 줄도 없는 종목 — 채울 방법이 이 버튼뿐이라 사용자에게도 연다.
    2년치만 받으면 앞부분이 영영 빈다. 그래서 묻지 않고 전체를 받는다."""
    calls = []
    monkeypatch.setattr(
        "app.routers.stocks.refresh_and_evaluate_stock",
        lambda db, stock, full_backfill=False, price_df=None: calls.append(full_backfill) or {},
    )
    client = people.as_(B)
    client.post("/api/stocks", json={"ticker": "VOO"})  # 등록 때 한 번 (전체)
    limits.refresh_cooldown.clear()
    assert client.post("/api/stocks/VOO/refresh").status_code == 200
    limits.refresh_cooldown.clear()
    assert client.post("/api/stocks/VOO/refresh?full=true").status_code == 200
    assert calls == [True, True, True]


# --- 바깥 검색 ------------------------------------------------------------------


@pytest.fixture()
def yahoo(monkeypatch):
    asked: list[str] = []

    def fake(query, limit, timeout=5):
        asked.append(query)
        return []

    monkeypatch.setattr(symbols, "_search_yahoo", fake)
    monkeypatch.setattr(symbols, "_refresh_listing_in_background", lambda: False)
    return asked


def test_outside_search_is_limited_per_person(people, yahoo):
    client = people.as_(B)
    for i in range(limits.YAHOO_SEARCHES_PER_MINUTE):
        assert client.get(f"/api/symbols/search?q=zzname{i}").status_code == 200
    assert len(yahoo) == limits.YAHOO_SEARCHES_PER_MINUTE

    # 넘치면 거절하지 않고 로컬 결과만 — 바깥에는 묻지 않는다
    assert client.get("/api/symbols/search?q=zznamemore").status_code == 200
    assert len(yahoo) == limits.YAHOO_SEARCHES_PER_MINUTE

    # 다른 사람은 따로 센다
    people.as_(A).get("/api/symbols/search?q=zznameowner")
    assert yahoo[-1] == "zznameowner"


def test_searches_found_locally_do_not_count(people, yahoo):
    client = people.as_(B)
    for _ in range(limits.YAHOO_SEARCHES_PER_MINUTE + 5):
        assert client.get("/api/symbols/search?q=삼성전자").json()
    assert yahoo == []
    assert limits.yahoo_searches.has_room(B)


def test_adding_by_name_goes_through_the_same_gate(people, yahoo, downloads):
    """등록할 때 이름을 해석하는 검색도 같은 한도를 쓴다 — 옆문이 되면 안 된다."""
    client = people.as_(B)
    for i in range(limits.YAHOO_SEARCHES_PER_MINUTE):
        client.get(f"/api/symbols/search?q=zzname{i}")
    asked = len(yahoo)
    assert client.post("/api/stocks", json={"ticker": "zz unknown name"}).status_code == 400
    assert len(yahoo) == asked


def test_registering_a_stock_starts_its_cooldown(people, downloads):
    """방금 등록하며 받은 종목을 곧바로 새로고침해도 다시 받으러 가지 않는다."""
    client = people.as_(B)
    client.post("/api/stocks", json={"ticker": "NEWONE"})
    again = client.post("/api/stocks/NEWONE/refresh")
    assert again.json()["skipped"] is True
    assert downloads == [("NEWONE", True)]
