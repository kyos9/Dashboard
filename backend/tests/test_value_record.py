"""날마다의 평가금액 기록 (0.44.0, services/value_record.py).

다시 만들 수 없는 기록이라 잘못 쌓이면 고칠 길도 없다. 그래서 보는 것:

- 화면(리밸런싱 현황)의 총액과 **같은 숫자**를 남긴다 — 둘이 갈라지면 나중의 성과가 화면과 다르다.
- 날짜는 **한국 날짜**, 같은 날 다시 돌면 한 줄을 고쳐 쓴다.
- 누구를 남기나 — 쓰는 중인 사람만, 아무것도 없는 사람은 빼되 전날 기록이 있으면 0 줄.
- 한 사람이 넘어져도 다음 사람은 남는다. 끄면 아무것도 하지 않는다.
"""

from __future__ import annotations

import datetime as dt

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import PortfolioValueDaily, PriceDaily, User, UserSettings
from app.services import rebalance, value_record
from app.services.users import LOCAL_USER_ID
from tests.factories import make_holding, make_settings, make_stock, make_user

# UTC 22:40 = 한국 다음날 07:40 — 미국 갱신 바로 뒤
MORNING = dt.datetime(2026, 10, 15, 22, 40)
KOREA_DAY = dt.date(2026, 10, 16)


def _prices(db, ticker: str, *closes: float, last: dt.date = dt.date(2026, 10, 15)) -> None:
    for i, close in enumerate(reversed(closes)):
        db.add(PriceDaily(ticker=ticker, date=last - dt.timedelta(days=i), open=close, high=close, low=close,
                          close=close, volume=1))
    db.commit()


def _rows(db, user_id: int = LOCAL_USER_ID) -> list[PortfolioValueDaily]:
    return db.query(PortfolioValueDaily).filter_by(user_id=user_id).order_by(PortfolioValueDaily.date).all()


@pytest.fixture()
def portfolio(db_session):
    """원화 기준, 미국 종목 하나 + 한국 종목 하나 + 현금 둘. 들고 있지 않은 종목도 하나."""
    db = db_session
    make_settings(db, base_currency="KRW", fx_overrides={"USD": 1400.0}, cash={"KRW": 1_000_000, "USD": 100})
    make_stock(db, "VOO", target_weight_pct=50.0)
    make_stock(db, "005930.KS", target_weight_pct=30.0, sort_order=1)
    make_stock(db, "QQQ", target_weight_pct=0.0, sort_order=2)
    make_holding(db, "VOO", 2.0, avg_cost=400.0)
    make_holding(db, "005930.KS", 10.0)
    _prices(db, "VOO", 490.0, 500.0)
    _prices(db, "005930.KS", 70_000.0, last=dt.date(2026, 10, 14))
    _prices(db, "QQQ", 400.0)
    return db


def test_record_date_is_the_korean_date():
    assert value_record.record_date(MORNING) == KOREA_DAY
    # 한국 자정 직전(UTC 14:59)은 아직 그날, 자정(UTC 15:00)부터 다음날
    assert value_record.record_date(dt.datetime(2026, 10, 15, 14, 59)) == dt.date(2026, 10, 15)
    assert value_record.record_date(dt.datetime(2026, 10, 15, 15, 0)) == KOREA_DAY


def test_records_the_same_total_as_the_rebalance_screen(portfolio):
    db = portfolio
    screen = rebalance.compute_rebalance_current(db, LOCAL_USER_ID)

    result = value_record.record_day(db, now=MORNING)

    assert result == {"date": "2026-10-16", "users": 1, "written": 1, "failed": 0}
    (row,) = _rows(db)
    assert row.date == KOREA_DAY
    assert row.total_value_base == pytest.approx(screen["total_value_base"])
    assert row.stock_value_base == pytest.approx(screen["holdings_value_base"])
    assert row.cash_value_base == pytest.approx(screen["cash"]["value_base"])
    # 2주 × 500달러 × 1400 + 10주 × 70,000원 + 1,000,000원 + 100달러 × 1400
    assert row.total_value_base == pytest.approx(1_400_000 + 700_000 + 1_000_000 + 140_000)
    assert row.cash == {"KRW": 1_000_000, "USD": 100}
    assert row.base_currency == "KRW"
    assert row.fx["rates"]["USD"]["krw_rate"] == 1400.0
    assert row.recorded_at == MORNING


def test_positions_keep_quantity_price_and_the_date_of_that_price(portfolio):
    db = portfolio
    value_record.record_day(db, now=MORNING)
    (row,) = _rows(db)
    by_ticker = {p["ticker"]: p for p in row.positions}
    # 들고 있지 않은 QQQ 는 남기지 않는다
    assert set(by_ticker) == {"VOO", "005930.KS"}
    assert by_ticker["VOO"] == {
        "ticker": "VOO", "currency": "USD", "quantity": 2.0, "avg_cost": 400.0, "close": 500.0,
        "close_date": "2026-10-15", "value": 1000.0, "value_base": pytest.approx(1_400_000),
    }
    # 한국 종목은 종가 날짜가 다르다 — 나중에 맞출 수 있게 그대로 남긴다
    assert by_ticker["005930.KS"]["close_date"] == "2026-10-14"
    assert by_ticker["005930.KS"]["avg_cost"] is None


def test_running_again_the_same_day_rewrites_that_one_row(portfolio):
    db = portfolio
    value_record.record_day(db, now=MORNING)
    make_holding_qty = db.query(rebalance.Holding).filter_by(user_id=LOCAL_USER_ID, ticker="VOO").one()
    make_holding_qty.quantity = 3.0
    db.commit()

    later = MORNING + dt.timedelta(hours=9)  # 한국 16:40 — 같은 날
    value_record.record_day(db, now=later)

    (row,) = _rows(db)
    assert {p["ticker"]: p["quantity"] for p in row.positions}["VOO"] == 3.0
    assert row.recorded_at == later

    value_record.record_day(db, now=MORNING + dt.timedelta(days=1))
    assert [r.date for r in _rows(db)] == [KOREA_DAY, KOREA_DAY + dt.timedelta(days=1)]


def test_someone_with_nothing_gets_no_row_and_no_settings_row(db_session):
    db = db_session
    make_stock(db, "VOO")
    _prices(db, "VOO", 500.0)
    assert db.get(UserSettings, LOCAL_USER_ID) is None

    assert value_record.record_day(db, now=MORNING)["written"] == 0
    assert _rows(db) == []
    # 평가 계산은 설정 행이 없으면 만든다 — 아무것도 없는 사람에게 매일 빈 행을 만들지 않는다
    assert db.get(UserSettings, LOCAL_USER_ID) is None


def test_after_selling_everything_a_zero_row_is_kept(portfolio):
    """전날까지 기록이 있던 사람이 다 팔면 0 줄 — "0원"과 "기록 없음"이 갈린다."""
    db = portfolio
    value_record.record_day(db, now=MORNING)
    for holding in db.query(rebalance.Holding).filter_by(user_id=LOCAL_USER_ID):
        holding.quantity = 0.0
    db.get(UserSettings, LOCAL_USER_ID).cash = {}
    db.commit()

    value_record.record_day(db, now=MORNING + dt.timedelta(days=1))

    rows = _rows(db)
    assert len(rows) == 2
    assert (rows[1].total_value_base, rows[1].positions, rows[1].cash) == (0.0, [], {})


def test_cash_only_is_recorded(db_session):
    db = db_session
    make_settings(db, base_currency="KRW", cash={"KRW": 500_000})
    value_record.record_day(db, now=MORNING)
    (row,) = _rows(db)
    assert (row.total_value_base, row.stock_value_base, row.positions) == (500_000, 0.0, [])


def test_only_people_in_use_are_recorded(db_session):
    """승인 대기·막힌 사람, 반년 넘게 안 들어온 사람(시세가 낡는다)은 남기지 않는다."""
    db = db_session
    make_stock(db, "VOO")
    _prices(db, "VOO", 500.0)
    long_ago = MORNING - dt.timedelta(days=400)
    people = {
        2: dict(status="active", last_login_at=MORNING - dt.timedelta(days=3)),
        3: dict(status="pending"),
        4: dict(status="active", last_login_at=long_ago),
    }
    for uid, fields in people.items():
        make_user(db, id=uid, email=f"u{uid}@example.com", is_owner=False, **fields)
        make_stock(db, "VOO", user_id=uid)
        make_holding(db, "VOO", 1.0, user_id=uid)
        make_settings(db, user_id=uid, base_currency="USD")
    make_holding(db, "VOO", 1.0)

    result = value_record.record_day(db, now=MORNING)

    recorded = {r.user_id for r in db.query(PortfolioValueDaily)}
    assert recorded == {LOCAL_USER_ID, 2}
    assert (result["users"], result["written"]) == (2, 2)


def test_one_person_failing_does_not_stop_the_next(portfolio, monkeypatch):
    db = portfolio
    make_user(db, id=2, email="b@example.com", is_owner=False, status="active")
    make_stock(db, "VOO", user_id=2)
    make_holding(db, "VOO", 1.0, user_id=2)
    make_settings(db, user_id=2, base_currency="USD")
    real = rebalance.portfolio_valuation

    def flaky(db, user_id):
        if user_id == LOCAL_USER_ID:
            raise RuntimeError("계산 이상")
        return real(db, user_id)

    monkeypatch.setattr(rebalance, "portfolio_valuation", flaky)
    result = value_record.record_day(db, now=MORNING)

    assert (result["written"], result["failed"]) == (1, 1)
    assert [r.user_id for r in db.query(PortfolioValueDaily)] == [2]


def test_a_row_written_meanwhile_by_another_scheduler_is_rewritten(portfolio, monkeypatch):
    """스케줄러가 잠깐 둘 도는 틈(leader.py)에 다른 쪽이 먼저 쓰면 유일키에 걸린다 — 그 줄을 고쳐 쓴다."""
    db = portfolio
    real_commit = db.commit
    calls = {"n": 0}

    def first_commit_loses_the_race():
        calls["n"] += 1
        if calls["n"] == 1:
            raise IntegrityError("INSERT", {}, Exception("unique"))
        real_commit()

    monkeypatch.setattr(db, "commit", first_commit_loses_the_race)
    assert value_record.record_user(db, LOCAL_USER_ID, KOREA_DAY, now=MORNING) is True
    monkeypatch.setattr(db, "commit", real_commit)
    assert len(_rows(db)) == 1


@pytest.mark.parametrize("value", ["0", "false", "off"])
def test_switched_off_does_nothing(portfolio, monkeypatch, value):
    monkeypatch.setenv(value_record.ENV_SWITCH, value)
    assert value_record.record_day(portfolio, now=MORNING) is None
    assert _rows(portfolio) == []
    assert value_record.status(portfolio)["enabled"] is False


def test_status_and_my_days(portfolio):
    db = portfolio
    assert value_record.status(db) == {"enabled": True, "last_date": None, "users": 0, "rows": 0}
    assert value_record.my_days(db, LOCAL_USER_ID) == {"days": 0, "since": None}
    value_record.record_day(db, now=MORNING)
    value_record.record_day(db, now=MORNING + dt.timedelta(days=1))
    assert value_record.status(db) == {"enabled": True, "last_date": "2026-10-17", "users": 1, "rows": 2}
    assert value_record.my_days(db, LOCAL_USER_ID) == {"days": 2, "since": "2026-10-16"}
    assert db.get(User, LOCAL_USER_ID) is not None


# ---------------------------------------------------------------------------
#  언제 도나 — 스케줄러
# ---------------------------------------------------------------------------


class _Closable:
    def close(self):
        pass


def test_daily_job_records_after_the_refresh_even_when_the_refresh_fails(monkeypatch):
    from app.services import scheduler

    order = []

    def broken_refresh(db, market=None):
        order.append("refresh")
        raise RuntimeError("시세 서버 이상")

    monkeypatch.setattr(scheduler, "refresh_all_active_stocks", broken_refresh)
    monkeypatch.setattr(scheduler, "SessionLocal", lambda: _Closable())
    monkeypatch.setattr(value_record, "record_day", lambda db: order.append("record"))
    with pytest.raises(RuntimeError):
        scheduler._daily_refresh_job()
    assert order == ["refresh", "record"]


def test_korea_and_japan_jobs_do_not_record(monkeypatch):
    """하루 한 번, 미국 갱신 뒤에만 — 한국·일본 갱신마다 쓰면 '그날 마지막 값'이 오후 값이 된다."""
    from app.services import alerts, scheduler

    calls = []
    monkeypatch.setattr(scheduler, "refresh_all_active_stocks", lambda db, market=None: [])
    monkeypatch.setattr(scheduler, "SessionLocal", lambda: _Closable())
    monkeypatch.setattr(alerts, "run_daily", lambda db: None)
    monkeypatch.setattr(value_record, "record_day", lambda db: calls.append(1))
    scheduler._korea_refresh_job()
    scheduler._japan_refresh_job()
    assert calls == []
    scheduler._daily_refresh_job()
    assert calls == [1]


@pytest.mark.parametrize("caught_up", [{}, {"US": [{"ticker": "VOO"}]}])
def test_startup_records_whether_or_not_anything_was_fetched(monkeypatch, caught_up):
    from app.services import alerts, pipeline, scheduler

    calls = []
    monkeypatch.setattr(pipeline, "refresh_stale_markets", lambda db: caught_up)
    monkeypatch.setattr(scheduler, "SessionLocal", lambda: _Closable())
    monkeypatch.setattr(scheduler, "_recompute_if_rules_changed", lambda: None)
    monkeypatch.setattr(alerts, "run_daily", lambda db: None)
    monkeypatch.setattr(value_record, "record_day", lambda db: calls.append(1))
    scheduler._startup_refresh_job()
    assert calls == [1]


def test_startup_records_even_when_the_catch_up_fails(monkeypatch):
    from app.services import pipeline, scheduler

    calls = []

    def offline(db):
        raise OSError("네트워크 없음")

    monkeypatch.setattr(pipeline, "refresh_stale_markets", offline)
    monkeypatch.setattr(scheduler, "SessionLocal", lambda: _Closable())
    monkeypatch.setattr(scheduler, "_recompute_if_rules_changed", lambda: None)
    monkeypatch.setattr(value_record, "record_day", lambda db: calls.append(1))
    scheduler._startup_refresh_job()
    assert calls == [1]


def test_a_failing_record_does_not_break_the_job(monkeypatch):
    from app.services import alerts, scheduler

    def boom(db):
        raise RuntimeError("기록 이상")

    monkeypatch.setattr(scheduler, "refresh_all_active_stocks", lambda db, market=None: [])
    monkeypatch.setattr(scheduler, "SessionLocal", lambda: _Closable())
    monkeypatch.setattr(alerts, "run_daily", lambda db: None)
    monkeypatch.setattr(value_record, "record_day", boom)
    scheduler._daily_refresh_job()  # 넘어지지 않는다


@pytest.mark.parametrize("case", ["zero quantity", "hidden stock"])
def test_holding_nothing_that_counts_gets_no_row_and_no_settings_row(db_session, case):
    """평가 계산이 세는 것과 같은 것을 본다 — 수량 0 행, 숨긴(비활성) 종목에만 있는 보유는 0 이다 (A 검토 조건 2)."""
    db = db_session
    if case == "zero quantity":
        make_stock(db, "VOO")
        make_holding(db, "VOO", 0.0)
    else:
        # 활성 종목은 있지만 들고 있지 않고, 보유는 숨긴 종목에만 — 보유와 종목은 같은 종목끼리 짝짓는다
        make_stock(db, "QQQ", sort_order=1)
        make_stock(db, "VOO", active=False)
        make_holding(db, "VOO", 3.0)
        _prices(db, "QQQ", 400.0)
    _prices(db, "VOO", 500.0)

    assert value_record.record_day(db, now=MORNING)["written"] == 0
    assert _rows(db) == []
    assert db.get(UserSettings, LOCAL_USER_ID) is None


def _row(db, user_id: int, day: dt.date, recorded_at: dt.datetime) -> None:
    db.add(PortfolioValueDaily(user_id=user_id, date=day, base_currency="KRW", total_value_base=1.0,
                               stock_value_base=1.0, cash_value_base=0.0, cash={}, fx={}, positions=[],
                               recorded_at=recorded_at))
    db.commit()


def test_sweep_removes_rows_whose_person_is_gone_or_came_later(db_session):
    """0.43 으로 이미지만 되돌린 동안의 탈퇴는 이 표를 모른다 (A 검토 조건 1).

    SQLite 는 외래키를 강제하지 않아 줄이 남고, `users.id` 는 다시 쓰인다 — 다음 가입자가 남의 기록을 받는다.
    """
    db = db_session
    joined = dt.datetime(2026, 10, 1)
    make_user(db, id=2, email="kept@example.com", is_owner=False, status="active", created_at=joined)
    make_user(db, id=3, email="reused@example.com", is_owner=False, status="active", created_at=dt.datetime(2026, 10, 14))
    _row(db, 2, dt.date(2026, 10, 2), joined + dt.timedelta(days=1))  # 제 줄 — 남는다
    _row(db, 3, dt.date(2026, 10, 10), dt.datetime(2026, 10, 9, 22, 40))  # 3번이 가입하기 전 — 앞사람의 줄
    _row(db, 3, dt.date(2026, 10, 15), dt.datetime(2026, 10, 14, 22, 40))  # 가입한 뒤 — 남는다
    _row(db, 2, dt.date(2026, 10, 1), joined)  # 가입한 그 순간에 쓴 줄 — 제 줄이다
    gone = db.bind.dialect.name == "sqlite"
    if gone:
        # 운영 SQLite 처럼 외래키를 끄고 — 사람이 사라진 줄(Postgres 는 CASCADE 가 지우므로 생기지 않는다)
        db.connection().exec_driver_sql("PRAGMA foreign_keys=OFF")
        _row(db, 99, dt.date(2026, 10, 3), dt.datetime(2026, 10, 2, 22, 40))
        db.connection().exec_driver_sql("PRAGMA foreign_keys=ON")

    assert value_record.sweep_orphans(db) == (2 if gone else 1)

    db.rollback()  # 지운 것이 저장됐는지 — 켤 때 한 번 돌고 끝나는 세션이다
    left = sorted((r.user_id, r.date.isoformat()) for r in db.query(PortfolioValueDaily))
    assert left == [(2, "2026-10-01"), (2, "2026-10-02"), (3, "2026-10-15")]
    assert value_record.sweep_orphans(db) == 0


def test_init_db_sweeps_before_any_request(tmp_path, monkeypatch):
    """치우기는 앱이 요청을 받기 전(`init_db`) — 스케줄러에 두면 그 사이 같은 번호의 새 사람에게 앞사람의 날 수가 보인다."""
    from app import db as app_db

    calls = []
    monkeypatch.setattr(value_record, "sweep_orphans", lambda session: calls.append("sweep") or 0)
    from tests import dbsetup

    engine = dbsetup.make_engine(f"sqlite:///{tmp_path / 'i.db'}")
    try:
        app_db.init_db(bind=engine)
    finally:
        dbsetup.dispose(engine)
    assert calls == ["sweep"]


def test_init_db_still_starts_when_the_sweep_fails(tmp_path, monkeypatch):
    from app import db as app_db
    from tests import dbsetup

    def broken(session):
        raise RuntimeError("치우기 이상")

    monkeypatch.setattr(value_record, "sweep_orphans", broken)
    engine = dbsetup.make_engine(f"sqlite:///{tmp_path / 'j.db'}")
    try:
        app_db.init_db(bind=engine)  # 넘어지지 않는다
    finally:
        dbsetup.dispose(engine)


def test_the_scheduler_does_not_sweep(monkeypatch):
    """스케줄러의 켤 때·아침 길은 치우지 않는다 — 치우기는 init_db 한 곳."""
    from app.services import alerts, pipeline, scheduler

    calls = []
    monkeypatch.setattr(scheduler, "refresh_all_active_stocks", lambda db, market=None: [])
    monkeypatch.setattr(pipeline, "refresh_stale_markets", lambda db: {})
    monkeypatch.setattr(scheduler, "SessionLocal", lambda: _Closable())
    monkeypatch.setattr(scheduler, "_recompute_if_rules_changed", lambda: None)
    monkeypatch.setattr(alerts, "run_daily", lambda db: None)
    monkeypatch.setattr(value_record, "sweep_orphans", lambda db: calls.append("sweep"))
    monkeypatch.setattr(value_record, "record_day", lambda db: calls.append(1))
    scheduler._daily_refresh_job()
    scheduler._startup_refresh_job()
    assert calls == [1, 1]
