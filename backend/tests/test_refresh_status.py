"""시세 받기가 막히면 관리자가 안다 (0.46.0 C, 제로베이스 점검 10번)."""

from __future__ import annotations

import datetime as dt

import pytest

from app.models import PriceDaily, User
from app.services import alerts, app_settings, refresh_status
from tests.factories import make_push_subscription, make_stock, new_device

TODAY = dt.date(2026, 10, 30)  # 금요일 — 미국 마지막 거래일은 목요일 10-29
NOW = dt.datetime(2026, 10, 30, 7, 31, tzinfo=dt.timezone.utc)


def _price(db, ticker: str, day: dt.date) -> None:
    db.add(PriceDaily(ticker=ticker, date=day, open=1, high=1, low=1, close=1, adj_close=1, volume=1, source="yahoo"))
    db.commit()


def _us(db, count: int, latest: dt.date = dt.date(2026, 10, 29)) -> list[str]:
    tickers = [f"T{i:02d}" for i in range(count)]
    for t in tickers:
        make_stock(db, t)
        _price(db, t, latest)
    return tickers


def _ok(t):
    return {"ticker": t, "rows": 1}


def _bad(t, providers=("yahoo", "stooq"), not_found=False):
    return {"ticker": t, "error": "SENTINEL-오류글 https://x?key=SENTINEL", "hint": "", "providers": list(providers),
            "not_found": not_found}


def _run(db, results, **kw):
    return refresh_status.record_run(db, results, now=kw.pop("now", NOW), today=kw.pop("today", TODAY))


def test_half_failed_is_blocked_and_less_is_not(db_session):
    tickers = _us(db_session, 10)
    four = [_bad(t) for t in tickers[:4]] + [_ok(t) for t in tickers[4:]]
    assert _run(db_session, four) == []
    state = refresh_status.read(db_session, refresh_status.Market.US)
    assert state["blocked"] is False and state["failed"] == 4 and state["failed_tickers"] == tickers[:4]
    five = [_bad(t) for t in tickers[:5]] + [_ok(t) for t in tickers[5:]]
    blocked = _run(db_session, five)
    assert [b["market"] for b in blocked] == ["US"] and blocked[0]["reason"] == "failed"
    assert blocked[0]["providers"] == ["stooq", "yahoo"]


def test_error_text_is_never_kept(db_session):
    tickers = _us(db_session, 2)
    _run(db_session, [_bad(t) for t in tickers])
    raw = app_settings.get_value(db_session, "refresh_status:US")
    assert "SENTINEL" not in raw


def test_blocked_only_once_until_it_clears(db_session):
    tickers = _us(db_session, 2)
    all_bad = [_bad(t) for t in tickers]
    assert len(_run(db_session, all_bad)) == 1
    assert _run(db_session, all_bad, now=NOW + dt.timedelta(days=1)) == []  # 이튿날도 막힘 — 다시 울리지 않는다
    assert _run(db_session, [_ok(t) for t in tickers]) == []  # 풀림 — 조용히
    assert refresh_status.read(db_session, refresh_status.Market.US)["blocked"] is False
    assert len(_run(db_session, all_bad)) == 1  # 다시 막힘 — 또 한 번


def test_last_ok_is_kept_while_blocked(db_session):
    tickers = _us(db_session, 1)
    _run(db_session, [_ok(tickers[0])], now=NOW - dt.timedelta(days=2))
    _run(db_session, [_bad(tickers[0])])
    state = refresh_status.read(db_session, refresh_status.Market.US)
    assert state["last_ok_at"] == (NOW - dt.timedelta(days=2)).isoformat() and state["at"] == NOW.isoformat()


@pytest.mark.parametrize("latest, blocked", [(dt.date(2026, 10, 27), False), (dt.date(2026, 10, 26), True)])
def test_stale_prices_without_errors_are_blocked_at_three_trading_days(db_session, latest, blocked):
    """제공자가 오류 없이 묵은 값을 준다 — 2거래일 뒤는 아직, 3거래일 뒤부터 막힘."""
    tickers = _us(db_session, 3, latest=latest)
    out = _run(db_session, [_ok(t) for t in tickers])
    assert bool(out) is blocked
    if blocked:
        assert out[0]["reason"] == "stale" and out[0]["failed"] == 0 and out[0]["latest_date"] == "2026-10-26"


def test_catch_up_with_stale_prices_does_not_clear_and_ring_twice(db_session):
    """켤 때 따라잡기가 묵은 값으로 "풀림"을 적으면 다음 갱신에 다시 막혀 푸시가 또 간다 (계획 다시 보기)."""
    tickers = _us(db_session, 2, latest=dt.date(2026, 10, 20))
    assert len(_run(db_session, [_bad(t) for t in tickers])) == 1
    assert _run(db_session, [_ok(t) for t in tickers]) == []  # 따라잡기: 오류는 없지만 묵음 — 여전히 막힘
    assert refresh_status.read(db_session, refresh_status.Market.US)["blocked"] is True
    assert _run(db_session, [_bad(t) for t in tickers]) == []


def test_runs_with_nothing_to_count_are_not_written(db_session):
    tickers = _us(db_session, 2)
    _run(db_session, [_bad(t) for t in tickers])
    assert _run(db_session, []) == []
    assert _run(db_session, [_bad(tickers[0], not_found=True)]) == []  # 오타뿐 — 세지 않는다
    assert refresh_status.read(db_session, refresh_status.Market.US)["blocked"] is True


def test_typos_are_not_counted(db_session):
    tickers = _us(db_session, 3)
    rows = [_bad(tickers[0], not_found=True), _bad(tickers[1], not_found=True), _ok(tickers[2])]
    assert _run(db_session, rows) == []
    assert refresh_status.read(db_session, refresh_status.Market.US)["total"] == 1


def test_markets_are_written_separately(db_session):
    """22:30 갱신은 전 시장을 한꺼번에 받는다 — 시장마다 나눠 적는다."""
    us = _us(db_session, 1)
    make_stock(db_session, "005930.KS")
    _price(db_session, "005930.KS", dt.date(2026, 10, 29))
    out = _run(db_session, [_ok(us[0]), _bad("005930.KS", providers=("naver",))])
    assert [b["market"] for b in out] == ["KR"]
    assert [s["market"] for s in refresh_status.overview(db_session)] == ["US", "KR"]
    assert refresh_status.attention(db_session) is True


def test_failed_tickers_are_capped(db_session):
    tickers = _us(db_session, 14)
    _run(db_session, [_bad(t) for t in tickers])
    assert len(refresh_status.read(db_session, refresh_status.Market.US)["failed_tickers"]) == 10


def test_a_broken_value_reads_as_nothing(db_session):
    app_settings.set_value(db_session, "refresh_status:US", "{망가짐")
    assert refresh_status.read(db_session, refresh_status.Market.US) is None
    assert refresh_status.attention(db_session) is False


# ---------------------------------------------------------------------------
#  푸시
# ---------------------------------------------------------------------------


def _owner_with_device(db, monkeypatch):
    sent = []
    monkeypatch.setattr(alerts.push, "send", lambda endpoint, p256dh, auth, message, **kw: sent.append((endpoint, message)) or alerts.push.SENT)
    make_push_subscription(db, new_device("owner"), user_id=1)
    friend = User(id=2, google_sub="s2", email="f@example.com", status="active", is_owner=False)
    db.add(friend)
    db.commit()
    make_push_subscription(db, new_device("friend"), user_id=2)
    return sent


def test_push_goes_to_owners_only_once(db_session, monkeypatch):
    sent = _owner_with_device(db_session, monkeypatch)
    blocked = [{"market": "US", "total": 20, "failed": 18, "reason": "failed", "latest_date": "2026-10-28"}]
    alerts.notify_refresh_blocked(db_session, blocked)
    assert len(sent) == 1
    body = sent[0][1]["body"]
    assert body == "미국 20종목 중 18개. 진단에서 볼 수 있습니다. (관리자에게만 가는 알림)"
    assert sent[0][1]["title"] == "시세를 받지 못했습니다"


def test_stale_push_says_where_it_stopped(db_session, monkeypatch):
    sent = _owner_with_device(db_session, monkeypatch)
    alerts.notify_refresh_blocked(db_session, [{"market": "JP", "total": 3, "failed": 0, "reason": "stale", "latest_date": "2026-10-26"}])
    assert sent[0][1]["body"].startswith("일본은 시세가 2026-10-26에 멈춰 있습니다")


def test_push_ignores_slots_and_kinds_but_obeys_the_switch(db_session, monkeypatch):
    from tests.factories import make_settings

    sent = _owner_with_device(db_session, monkeypatch)
    make_settings(db_session, user_id=1, push_kinds=[], push_prefs={"slots": ["afternoon"], "muted": []})
    blocked = [{"market": "US", "total": 1, "failed": 1, "reason": "failed"}]
    alerts.notify_refresh_blocked(db_session, blocked)
    assert len(sent) == 1  # 가입 신청처럼 바로 — 알림 종류·받을 때를 따르지 않는다
    monkeypatch.setenv(alerts.REFRESH_ALERT_SWITCH, "off")
    alerts.notify_refresh_blocked(db_session, blocked)
    assert len(sent) == 1


def test_scheduler_records_and_pushes(monkeypatch):
    """정해진 시각의 갱신 → 적기 → 막힘이면 푸시. 적다가 넘어져도 갱신은 그대로."""
    from app.services import scheduler

    calls = []
    monkeypatch.setattr(refresh_status, "record_run", lambda db, results: calls.append(("record", results)) or [{"market": "US"}])
    monkeypatch.setattr(alerts, "notify_refresh_blocked", lambda db, blocked: calls.append(("push", blocked)))
    monkeypatch.setattr(scheduler, "SessionLocal", lambda: _Closable())
    scheduler._record_refresh([{"ticker": "A"}])
    assert calls == [("record", [{"ticker": "A"}]), ("push", [{"market": "US"}])]

    def boom(db, results):
        raise RuntimeError("x")

    monkeypatch.setattr(refresh_status, "record_run", boom)
    scheduler._record_refresh([{"ticker": "A"}])  # 넘어지지 않는다


class _Closable:
    def close(self):
        pass


# ---------------------------------------------------------------------------
#  실패 줄의 제공자 이름 · 스케줄러의 두 길 · 관리자 응답
# ---------------------------------------------------------------------------


def test_failure_rows_carry_provider_names_but_old_fields_stay(db_session, monkeypatch):
    from app.services import pipeline
    from app.services.providers import AllProvidersFailed
    from app.services.providers.base import ProviderUnavailable, TickerNotFound

    make_stock(db_session, "VOO")
    make_stock(db_session, "ZZZZ")

    def fetch(requests, period="2y"):
        out = {}
        for ticker, _ in requests:
            if ticker == "VOO":
                cause = AllProvidersFailed(ticker, [ProviderUnavailable("yahoo", "차단"), ProviderUnavailable("stooq", "차단")])
            else:
                cause = AllProvidersFailed(ticker, [TickerNotFound("yahoo", "없음")])
            try:
                raise pipeline.data_ingestion.DataIngestionError(str(cause), hint=cause.hint()) from cause
            except pipeline.data_ingestion.DataIngestionError as exc:
                out[ticker] = exc
        return out

    monkeypatch.setattr(pipeline.data_ingestion, "fetch_many", fetch)
    monkeypatch.setattr(pipeline.fx, "refresh_rates", lambda db: None)
    rows = {r["ticker"]: r for r in pipeline.refresh_all_active_stocks(db_session)}
    assert rows["VOO"]["providers"] == ["yahoo", "stooq"] and rows["VOO"]["not_found"] is False
    assert rows["ZZZZ"]["not_found"] is True
    assert {"ticker", "error", "hint"} <= rows["VOO"].keys()  # 새로고침 응답의 옛 칸 그대로


def test_scheduled_refresh_and_catch_up_both_record(monkeypatch):
    from app.services import pipeline, scheduler

    recorded = []
    monkeypatch.setattr(scheduler, "_record_refresh", lambda results: recorded.append(results))
    monkeypatch.setattr(scheduler, "_send_alerts", lambda: None)
    monkeypatch.setattr(scheduler, "_record_values", lambda: None)
    monkeypatch.setattr(scheduler, "_recompute_if_rules_changed", lambda: None)
    monkeypatch.setattr(scheduler, "SessionLocal", lambda: _Closable())
    monkeypatch.setattr(scheduler, "refresh_all_active_stocks", lambda db, market=None: [{"ticker": "A"}])
    scheduler._korea_refresh_job()
    monkeypatch.setattr(pipeline, "refresh_stale_markets", lambda db: {"US": [{"ticker": "B"}], "JP": [{"ticker": "C"}]})
    scheduler._startup_refresh_job()
    monkeypatch.setattr(pipeline, "refresh_stale_markets", lambda db: {})
    scheduler._startup_refresh_job()  # 따라잡을 게 없으면 적지 않는다
    assert recorded == [[{"ticker": "A"}], [{"ticker": "B"}, {"ticker": "C"}]]


def test_owner_sees_it_in_records_and_status(api, monkeypatch):
    from app.services import auth as auth_service

    client, Session = api
    with Session() as db:
        app_settings.set_value(db, "refresh_status:JP", '{"at": "2026-10-30T07:01:00+00:00", "blocked": true, "total": 3, '
                               '"failed": 3, "failed_tickers": ["7203.T"], "providers": ["yahoo"], "reason": "failed"}')
    records = client.get("/api/admin/records").json()
    assert [r["market"] for r in records["refresh"]] == ["JP"] and records["refresh"][0]["blocked"] is True

    monkeypatch.setenv(auth_service.GOOGLE_CLIENT_ID_ENV, "test-client")
    with Session() as db:
        owner = db.get(User, 1)
        owner.google_sub, owner.status = "sub-1", "active"
        db.commit()
        token = auth_service.issue_user_token(1, owner.session_epoch, "sub-1")
    client.cookies.set(auth_service.COOKIE_NAME, token)
    assert client.get("/api/auth/status").json()["refresh_attention"] is True


def test_a_broken_refresh_state_never_breaks_login(api, monkeypatch):
    from app.services import auth as auth_service

    client, Session = api
    monkeypatch.setenv(auth_service.GOOGLE_CLIENT_ID_ENV, "test-client")
    with Session() as db:
        owner = db.get(User, 1)
        owner.google_sub, owner.status = "sub-1", "active"
        db.commit()
        token = auth_service.issue_user_token(1, owner.session_epoch, "sub-1")
    client.cookies.set(auth_service.COOKIE_NAME, token)

    def boom(db):
        raise RuntimeError("깨짐")

    monkeypatch.setattr(refresh_status, "attention", boom)
    body = client.get("/api/auth/status").json()
    assert body["authenticated"] is True and "refresh_attention" not in body
