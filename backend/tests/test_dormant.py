"""반년 넘게 안 들어온 사람의 종목은 매일 받지 않는다 (ROADMAP 8-2 · 작은 일들).

- **데이터는 남는다.** 매일 받는 대상(`pipeline.watched`)에서만 빠진다.
- 관리자, 로그인 기록이 없는 로컬 계정, 알림 받는 기기가 남은 사람은 쓰는 사람으로 센다.
- 다시 들어오면 그 자리에서 밀린 종목만 뒤에서 받는다.
"""

from __future__ import annotations

import datetime as dt

import pandas as pd
import pytest

from app.models import PriceDaily, User
from app.services import pipeline
from app.services.users import LOCAL_USER_ID, STATUS_BLOCKED
from tests.factories import make_push_subscription, make_stock, make_user, new_device
from tests.test_google_login import FRIEND, google_on, google_says, login_as  # noqa: F401 — 픽스처

A = LOCAL_USER_ID
B = 2
NOW = dt.datetime(2026, 9, 27, 3, 0)


def _ago(days: int) -> dt.datetime:
    return NOW - dt.timedelta(days=days)


@pytest.fixture()
def fetched(monkeypatch):
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


def _b(db, last_login_days: int | None, **over) -> User:
    user = make_user(
        db, id=B, email=FRIEND, google_sub="sub-b", is_owner=False,
        last_login_at=None if last_login_days is None else _ago(last_login_days), **over,
    )
    make_stock(db, "QQQ", user_id=A)
    make_stock(db, "QQQ", user_id=B)
    make_stock(db, "SCHD", user_id=B)
    return user


def _watched(db, now=NOW) -> list[str]:
    return sorted({s.ticker for s in pipeline.watched(db, now=now)})


# ── 누구를 쓰는 사람으로 세나 ─────────────────────────────────────────


def test_half_a_year_away_stops_only_what_nobody_else_watches(db_session):
    _b(db_session, last_login_days=200)
    # B 만 담은 SCHD 는 빠지고, A 도 담은 QQQ 는 계속 받는다
    assert _watched(db_session) == ["QQQ"]


@pytest.mark.parametrize(("days", "watched"), [(179, ["QQQ", "SCHD"]), (181, ["QQQ"])])
def test_the_line_is_180_days(db_session, days, watched):
    _b(db_session, last_login_days=days)
    assert _watched(db_session) == watched


def test_a_local_account_without_a_login_record_is_in_use(db_session):
    """구글 로그인 전부터 있던 계정 — 모르는 것을 안 쓴다고 치지 않는다."""
    _b(db_session, last_login_days=None)
    assert _watched(db_session) == ["QQQ", "SCHD"]


def test_the_owner_is_always_in_use(db_session):
    """비밀번호 문으로 쓰는 관리자는 구글 로그인을 안 하므로 기록이 오래됐을 수 있다."""
    owner = db_session.get(User, A)
    owner.last_login_at = _ago(400)
    db_session.commit()
    make_stock(db_session, "VOO", user_id=A)
    assert _watched(db_session) == ["VOO"]
    assert pipeline.is_dormant(db_session, owner, now=NOW) is False


def test_someone_who_only_reads_alerts_is_in_use(db_session):
    """알림만 보고 앱은 안 여는 사람 — 기기가 남아 있으면 쓰는 사람이다. 빼면 알림이 조용히 멈춘다."""
    user = _b(db_session, last_login_days=300)
    make_push_subscription(db_session, new_device("b"), user_id=B)
    assert _watched(db_session) == ["QQQ", "SCHD"]
    assert pipeline.is_dormant(db_session, user, now=NOW) is False


def test_blocked_people_are_not_called_dormant(db_session):
    """차단된 사람은 원래 안 센다 — 관리자 화면에 "반년 미접속"으로 겹쳐 적지 않는다."""
    user = _b(db_session, last_login_days=300, status=STATUS_BLOCKED)
    assert _watched(db_session) == ["QQQ"]
    assert pipeline.is_dormant(db_session, user, now=NOW) is False


def test_dormant_people_keep_their_data(db_session):
    user = _b(db_session, last_login_days=300)
    assert pipeline.is_dormant(db_session, user, now=NOW) is True
    # 종목·보유 행은 그대로 — 빠지는 것은 매일 받기뿐이다
    from app.models import UserStock

    assert {s.ticker for s in db_session.query(UserStock).filter(UserStock.user_id == B)} == {"QQQ", "SCHD"}


def test_the_nightly_refresh_skips_them(db_session, fetched, monkeypatch):
    _b(db_session, last_login_days=300)
    # 실제 시계로 도는 경로 — 300일 전은 지금 기준으로도 반년이 넘는다
    db_session.get(User, B).last_login_at = dt.datetime.utcnow() - dt.timedelta(days=300)
    db_session.commit()
    pipeline.refresh_all_active_stocks(db_session)
    assert fetched == ["QQQ"]


def test_catching_up_on_start_ignores_them(db_session, monkeypatch):
    """켤 때 뒤처진 시장을 따라잡는 판정도 같은 기준 — 안 그러면 매번 켤 때마다 그 사람 것을 받는다."""
    user = _b(db_session, last_login_days=None)
    db_session.query(pipeline.UserStock).filter(pipeline.UserStock.user_id == A).delete()
    db_session.commit()
    monkeypatch.setattr(pipeline, "last_closed_trading_day", lambda market: dt.date(2026, 9, 25))
    assert [m.value for m in pipeline.stale_markets(db_session)] == ["US"]

    user.last_login_at = dt.datetime.utcnow() - dt.timedelta(days=300)
    db_session.commit()
    assert pipeline.stale_markets(db_session) == []


# ── 다시 들어오면 ───────────────────────────────────────────────────


def _price(db, ticker: str, day: dt.date) -> None:
    db.add(PriceDaily(ticker=ticker, date=day, open=1, high=1, low=1, close=1, volume=1))
    db.commit()


def test_catch_up_fetches_only_what_fell_behind(db_session, fetched, monkeypatch):
    _b(db_session, last_login_days=10)
    monkeypatch.setattr(pipeline, "last_closed_trading_day", lambda market: dt.date(2026, 9, 25))
    _price(db_session, "QQQ", dt.date(2026, 9, 25))  # 남이 보고 있어 최신
    _price(db_session, "SCHD", dt.date(2026, 3, 20))  # 반년 밀림

    results = pipeline.catch_up_user(db_session, B)
    assert fetched == ["SCHD"]
    assert [r["ticker"] for r in results] == ["SCHD"]


def test_catch_up_with_nothing_behind_asks_nobody(db_session, fetched, monkeypatch):
    _b(db_session, last_login_days=10)
    monkeypatch.setattr(pipeline, "last_closed_trading_day", lambda market: dt.date(2026, 9, 25))
    for ticker in ("QQQ", "SCHD"):
        _price(db_session, ticker, dt.date(2026, 9, 25))
    assert pipeline.catch_up_user(db_session, B) == []
    assert fetched == []


@pytest.fixture()
def woke(monkeypatch):
    """로그인이 뒤에서 밀린 시세를 받게 했는지 — 누구 것으로."""
    started: list[int] = []
    monkeypatch.setattr(pipeline, "RUNNER", lambda work: work())
    monkeypatch.setattr(pipeline, "catch_up_user", lambda db, user_id: started.append(user_id) or [])
    return started


def test_logging_in_after_half_a_year_catches_up_in_the_background(api, google_says, woke):
    client, Session = api
    with Session() as db:
        make_user(db, id=B, email=FRIEND, google_sub="sub-b", is_owner=False,
                  last_login_at=dt.datetime.utcnow() - dt.timedelta(days=200))

    response = login_as(client, google_says, FRIEND, "sub-b")
    assert response.status_code == 302
    assert woke == [B]
    with Session() as db:
        user = db.get(User, B)
        assert pipeline.is_dormant(db, user) is False  # 이제 다시 쓰는 사람이다


def test_a_regular_login_does_not_trigger_catching_up(api, google_says, woke):
    client, Session = api
    with Session() as db:
        make_user(db, id=B, email=FRIEND, google_sub="sub-b", is_owner=False,
                  last_login_at=dt.datetime.utcnow() - dt.timedelta(days=20))

    login_as(client, google_says, FRIEND, "sub-b")
    assert woke == []


def test_a_first_login_does_not_trigger_catching_up(api, google_says, woke):
    client, _ = api
    login_as(client, google_says, FRIEND, "sub-new")
    assert woke == []


# ── 관리자 화면 ─────────────────────────────────────────────────────


def test_the_user_list_says_who_is_dormant(api):
    client, Session = api
    with Session() as db:
        make_user(db, id=B, email=FRIEND, google_sub="sub-b", is_owner=False,
                  last_login_at=dt.datetime.utcnow() - dt.timedelta(days=200))
        make_user(db, id=3, email="c@example.com", google_sub="sub-c", is_owner=False,
                  last_login_at=dt.datetime.utcnow() - dt.timedelta(days=3))

    rows = {row["id"]: row for row in client.get("/api/admin/users").json()}
    assert rows[B]["dormant"] is True
    assert rows[3]["dormant"] is False
    assert rows[A]["dormant"] is False
