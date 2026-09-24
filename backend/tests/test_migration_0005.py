"""0005 — 사용자 분리. **데이터를 넣은 채로** 돌려본다.

빈 DB에 0005를 돌리는 건 `test_alembic.py`가 이미 한다. 그걸로는 아무것도 증명되지
않는다 — 옮길 게 없으면 옮기는 코드는 한 줄도 안 돈다. 여기서는 0004 모양의 DB에
실제로 쓰던 것 같은 데이터를 넣고 올린 뒤, **하나도 빠짐없이 같은 값으로 읽히는지** 본다.

**0005에서 멈춰서 본다.** 0006이 매수 기록과 적립 칸을 지우므로, 끝까지 올리면 여기서
보려는 "옮겨졌나"를 볼 수 없다. 끝까지 올린 모습은 `test_migration_0006.py`가 본다.

SQLite와 Postgres 양쪽에서 돈다 (`TEST_DATABASE_URL`). 둘이 가는 길이 다르다 —
SQLite는 표를 새로 만들어 옮겨 담고(`batch_alter_table`), Postgres는 외래키를 이름으로
떼고 붙인다. 한쪽만 돌리면 다른 쪽은 사용자의 DB에서 처음 도는 셈이다.
"""

import datetime as dt
import json
from pathlib import Path

import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import inspect, text
from sqlalchemy.orm import sessionmaker

import app.main as main_module
from app import migrate
from app.db import get_db
from app.services import backup
from tests import dbsetup
from tests.factories import make_user

# ---------------------------------------------------------------------------
#  0004 모양의 DB — 이 앱을 몇 달 쓴 사람의 것처럼
# ---------------------------------------------------------------------------

STOCKS = [
    # ticker, name, category, market, currency, active, added_at, dca_amount, dca_period,
    # rebalance_period, target, band, review_override, sort_order
    ("VOO", "S&P500", "지수", "US", "USD", True, dt.datetime(2026, 1, 5, 9, 30),
     300.0, "monthly", "quarterly", 50.0, None, None, 0),
    ("005930.KS", "삼성전자", None, "KR", "KRW", True, dt.datetime(2026, 2, 1),
     500000.0, "quarterly", "semiannual", 30.0, 4.0, dt.date(2026, 12, 15), 1),
    ("7203.T", "도요타", "알파", "JP", "JPY", False, dt.datetime(2026, 3, 1),
     0.0, "monthly", "quarterly", 20.0, None, None, 2),
]
HOLDINGS = [("VOO", 12.5, dt.datetime(2026, 9, 1)), ("005930.KS", 100.0, dt.datetime(2026, 9, 2))]
# id를 일부러 띄엄띄엄 둔다 — 화면이 id로 "매수완료"를 부르므로 그대로 옮겨져야 한다
BUYS = [
    (5, "VOO", dt.date(2026, 8, 1), dt.date(2026, 8, 31), dt.date(2026, 8, 12),
     "signal", 300.0, "confirmed", dt.datetime(2026, 8, 13)),
    (9, "005930.KS", dt.date(2026, 7, 1), dt.date(2026, 9, 30), dt.date(2026, 9, 29),
     "fallback", 500000.0, "scheduled", None),
]
SETTINGS = {"band": 6.5, "base": "USD", "fx": {"USD": 1380.5}, "pinned": ["VIX", "DGS10"]}


def _seed_0004(conn) -> None:
    for row in STOCKS:
        conn.execute(
            text(
                "INSERT INTO stocks (ticker, name, category, market, currency, active, added_at,"
                " dca_amount, dca_period, rebalance_period, target_weight_pct,"
                " rebalance_band_pct, review_date_override, sort_order) VALUES"
                " (:t, :n, :c, :m, :cur, :a, :added, :dca, :dp, :rp, :tw, :band, :rev, :so)"
            ),
            dict(zip(("t", "n", "c", "m", "cur", "a", "added", "dca", "dp", "rp", "tw", "band",
                      "rev", "so"), row)),
        )
    for ticker, qty, at in HOLDINGS:
        conn.execute(
            text("INSERT INTO holding (ticker, quantity, updated_at) VALUES (:t, :q, :at)"),
            {"t": ticker, "q": qty, "at": at},
        )
    for row in BUYS:
        conn.execute(
            text(
                "INSERT INTO buy_execution (id, ticker, period_start, period_end, exec_date,"
                " type, amount, status, confirmed_at) VALUES"
                " (:id, :t, :ps, :pe, :ed, :type, :amt, :st, :ca)"
            ),
            dict(zip(("id", "t", "ps", "pe", "ed", "type", "amt", "st", "ca"), row)),
        )
    conn.execute(
        text(
            "INSERT INTO portfolio_settings"
            " (id, default_rebalance_band_pct, base_currency, fx_overrides, pinned_macro)"
            " VALUES (1, :band, :base, :fx, :pinned)"
        ),
        {
            "band": SETTINGS["band"],
            "base": SETTINGS["base"],
            "fx": json.dumps(SETTINGS["fx"]),
            "pinned": json.dumps(SETTINGS["pinned"]),
        },
    )
    # 시세·지표·시그널 — 종목마다 이틀치
    for ticker, *_ in STOCKS:
        for day in (dt.date(2026, 9, 21), dt.date(2026, 9, 22)):
            params = {"t": ticker, "d": day}
            conn.execute(
                text(
                    "INSERT INTO price_daily (ticker, date, open, high, low, close, volume)"
                    " VALUES (:t, :d, 1, 2, 0.5, 1.5, 100)"
                ),
                params,
            )
            conn.execute(
                text("INSERT INTO indicator_daily (ticker, date, adx) VALUES (:t, :d, 25)"),
                params,
            )
            conn.execute(
                text(
                    "INSERT INTO signal_daily (ticker, date, knee_buy_v2, shoulder_sell_ref)"
                    " VALUES (:t, :d, :k, :s)"
                ),
                {**params, "k": True, "s": False},
            )


@pytest.fixture()
def at_0004(tmp_path):
    """0004까지 올리고 데이터를 채운 DB. SQLite는 파일이다 — 백업이 실제로 떠져야 한다."""
    engine = dbsetup.make_engine(f"sqlite:///{tmp_path / 'm.db'}")
    with engine.begin() as conn:
        command.upgrade(migrate._config(conn), "0004")
    with engine.begin() as conn:
        _seed_0004(conn)
    try:
        yield engine
    finally:
        dbsetup.dispose(engine)


@pytest.fixture()
def snapshots(monkeypatch):
    """마이그레이션 직전 백업을 부른 기록.

    실제 pg_dump는 부르지 않는다 — CI의 pg_dump와 서버 버전이 달라 거기서 실패하면,
    이 파일이 보려는 것(데이터가 옮겨지는가)과 무관한 이유로 빨개진다. 백업이 실제로
    떠지는지는 test_backup.py가 본다.
    """
    calls = []

    def record(bind, backup_dir=None, *, required=False):
        calls.append(required)
        return Path("fake-premigrate")

    monkeypatch.setattr(backup, "snapshot_before_migration", record)
    return calls


def to_0005(engine) -> None:
    """0005까지만 올린다 (백업은 여기서 보지 않는다 — 아래 백업 절이 본다)."""
    with engine.begin() as conn:
        command.upgrade(migrate._config(conn), "0005")


def _rows(engine, sql: str, **params):
    with engine.connect() as conn:
        return [tuple(r) for r in conn.execute(text(sql), params).fetchall()]


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


# ---------------------------------------------------------------------------
#  올리기
# ---------------------------------------------------------------------------


def test_upgrade_moves_every_value(at_0004, snapshots):
    engine = at_0004
    to_0005(engine)

    assert migrate.current_revision(engine) == "0005"

    # 주인 한 명
    assert _rows(engine, "SELECT id, is_owner, google_sub FROM users") == [(1, True, None)]

    # 종목의 공용 절반
    assert sorted(_rows(engine, "SELECT ticker, name, market, currency FROM instrument")) == sorted(
        (t, n, m, cur) for t, n, _c, m, cur, *_ in STOCKS
    )

    # 사용자별 절반 — 설정 칸이 하나도 빠짐없이 같은 값이어야 한다
    moved = _rows(
        engine,
        "SELECT ticker, name, category, active, added_at, dca_amount, dca_period,"
        " rebalance_period, target_weight_pct, rebalance_band_pct, review_date_override,"
        " sort_order FROM user_stock WHERE user_id = 1 ORDER BY sort_order",
    )
    expected = [
        (t, n, c, a, added, dca, dp, rp, tw, band, rev, so)
        for t, n, c, _m, _cur, a, added, dca, dp, rp, tw, band, rev, so in STOCKS
    ]
    assert [_normalize(r) for r in moved] == [_normalize(r) for r in expected]

    assert sorted(_rows(engine, "SELECT user_id, ticker, quantity FROM holding")) == sorted(
        (1, t, q) for t, q, _ in HOLDINGS
    )

    buys = _rows(
        engine,
        "SELECT id, user_id, ticker, period_start, period_end, exec_date, type, amount,"
        " status, confirmed_at FROM buy_execution ORDER BY id",
    )
    assert [_normalize(b) for b in buys] == [
        _normalize((i, 1, t, ps, pe, ed, ty, amt, st, ca))
        for i, t, ps, pe, ed, ty, amt, st, ca in BUYS
    ]

    (band, base, fx, pinned), = _rows(
        engine,
        "SELECT default_rebalance_band_pct, base_currency, fx_overrides, pinned_macro"
        " FROM user_settings WHERE user_id = 1",
    )
    assert (band, base, _json(fx), _json(pinned)) == (
        SETTINGS["band"], SETTINGS["base"], SETTINGS["fx"], SETTINGS["pinned"]
    )

    # 공용 시세는 한 줄도 줄지 않는다
    for table in ("price_daily", "indicator_daily", "signal_daily"):
        assert _rows(engine, f"SELECT count(*) FROM {table}") == [(6,)]


def test_old_tables_are_gone_and_prices_hang_off_instrument(at_0004, snapshots):
    engine = at_0004
    to_0005(engine)

    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    assert "stocks" not in tables
    assert "portfolio_settings" not in tables

    for table in ("price_daily", "indicator_daily", "signal_daily"):
        parents = {fk["referred_table"] for fk in inspector.get_foreign_keys(table)}
        assert parents == {"instrument"}, table
    for table in ("holding", "buy_execution"):
        fks = inspector.get_foreign_keys(table)
        assert [(fk["referred_table"], fk["constrained_columns"]) for fk in fks] == [
            ("user_stock", ["user_id", "ticker"])
        ]


def test_new_rows_do_not_collide_with_moved_ids(at_0004, snapshots):
    """id를 직접 옮겼으니 Postgres 번호표도 그 뒤로 가 있어야 한다.

    안 그러면 옮긴 직후 첫 매수 기록이나 두 번째 사용자가 이미 있는 id를 받아
    "중복 키"로 실패한다 — 업그레이드 당일에는 멀쩡하다가 며칠 뒤 터지는 종류다.
    """
    engine = at_0004
    to_0005(engine)

    Session = sessionmaker(bind=engine)
    with Session() as session:
        second = make_user(session, is_owner=False)
        assert second.id == 2
    # 매수 기록 모델은 0006에서 사라졌다 — 그때 모양대로 SQL로 넣는다
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO buy_execution (user_id, ticker, period_start, period_end,"
                " exec_date, type, amount, status) VALUES (1, 'VOO', :d, :d, :d,"
                " 'signal', 100, 'scheduled')"
            ),
            {"d": dt.date(2026, 9, 1)},
        )
    (new_id,) = _rows(engine, "SELECT max(id) FROM buy_execution")[0]
    assert new_id > max(b[0] for b in BUYS)


def test_the_app_reads_the_moved_data(at_0004, snapshots, monkeypatch):
    """화면이 부르는 API가 옮기기 전과 같은 값을 준다 (끝까지 올린 뒤 — 앱은 최신 모양만 안다)."""
    engine = at_0004
    migrate.upgrade_to_head(engine)

    monkeypatch.setenv("SIGNAL_DASHBOARD_DISABLE_SCHEDULER", "1")
    Session = sessionmaker(bind=engine)

    def override_get_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    main_module.app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(main_module.app) as client:
            stocks = client.get("/api/stocks").json()
            holdings = client.get("/api/rebalance/holdings").json()
            settings = client.get("/api/rebalance/settings").json()
            pinned = client.get("/api/macro/pinned").json()
    finally:
        main_module.app.dependency_overrides.clear()

    assert [(s["ticker"], s["name"], s["market"], s["currency"], s["active"]) for s in stocks] == [
        (t, n, m, cur, a) for t, n, _c, m, cur, a, *_ in STOCKS
    ]
    assert stocks[1]["rebalance_band_pct"] == 4.0
    assert {h["ticker"]: h["quantity"] for h in holdings} == {
        "VOO": 12.5, "005930.KS": 100.0, "7203.T": 0.0
    }
    assert settings["default_rebalance_band_pct"] == SETTINGS["band"]
    assert settings["base_currency"] == SETTINGS["base"]
    assert settings["fx_overrides"] == SETTINGS["fx"]
    assert pinned["codes"] == SETTINGS["pinned"]


# ---------------------------------------------------------------------------
#  백업 — 이 리비전만은 백업에 실패하면 시작하지 않는다
# ---------------------------------------------------------------------------


def test_this_upgrade_demands_a_backup(at_0004, snapshots):
    migrate.upgrade_to_head(at_0004)
    assert snapshots == [True]


def test_a_failed_backup_stops_the_upgrade_and_leaves_the_data(at_0004, monkeypatch):
    def broken(url=None, backup_dir=None, label=""):
        raise OSError("No space left on device")

    monkeypatch.setattr(backup, "create_backup", broken)

    with pytest.raises(backup.MigrationBackupFailed, match="No space left"):
        migrate.upgrade_to_head(at_0004)

    # 한 줄도 건드리지 않았다
    assert migrate.current_revision(at_0004) == "0004"
    assert _rows(at_0004, "SELECT count(*) FROM stocks") == [(3,)]


def test_only_irreversible_revisions_demand_a_backup():
    """되돌릴 수 없는 리비전을 지날 때만 멈춘다. 다 지난 DB는 예전처럼 경고만 한다."""
    assert migrate.IRREVERSIBLE & set(migrate.pending_revisions("0004")) == {"0005", "0006"}
    assert migrate.IRREVERSIBLE & set(migrate.pending_revisions("0005")) == {"0006"}
    assert migrate.IRREVERSIBLE & set(migrate.pending_revisions("0006")) == set()


# ---------------------------------------------------------------------------
#  내리기 — 한 사람일 때만
# ---------------------------------------------------------------------------


def test_downgrade_restores_the_old_shape_with_one_user(at_0004, snapshots):
    engine = at_0004
    before = _snapshot_0004(engine)
    to_0005(engine)

    with engine.begin() as conn:
        command.downgrade(migrate._config(conn), "0004")

    assert migrate.current_revision(engine) == "0004"
    assert _snapshot_0004(engine) == before

    # 다시 올려도 된다 (왕복)
    to_0005(engine)
    assert _rows(engine, "SELECT count(*) FROM user_stock") == [(3,)]


def test_downgrade_refuses_when_there_are_two_people(at_0004, snapshots):
    engine = at_0004
    to_0005(engine)
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO users (id, created_at, session_epoch, is_owner)"
                " VALUES (2, :now, 0, :owner)"
            ),
            {"now": dt.datetime(2026, 9, 23), "owner": False},
        )

    with pytest.raises(RuntimeError, match="되돌릴 수 없습니다"):
        with engine.begin() as conn:
            command.downgrade(migrate._config(conn), "0004")

    # 거절했으니 그대로다
    assert migrate.current_revision(engine) == "0005"
    assert _rows(engine, "SELECT count(*) FROM users") == [(2,)]


# ---------------------------------------------------------------------------
#  SQLite에서만 생길 수 있는 것 — 외래키를 검사하지 않던 시절의 흔적
# ---------------------------------------------------------------------------


@pytest.mark.skipif(dbsetup.on_postgres(), reason="Postgres는 외래키를 늘 검사해 이런 행이 없다")
def test_orphans_from_the_unchecked_days(tmp_path, snapshots, caplog):
    """종목은 지워졌는데 시세·보유가 남은 DB.

    시세(공용)는 버리지 않고 종목 행을 붙여준다. 보유·매수(사용자별)는 내 목록에 없는
    종목 것이라 새 표에 들어갈 수 없다 — 옮기지 않되 경고를 남긴다.
    """
    from sqlalchemy import create_engine

    engine = create_engine(f"sqlite:///{tmp_path / 'o.db'}")  # 외래키 검사 없음 (앱과 같다)
    with engine.begin() as conn:
        command.upgrade(migrate._config(conn), "0004")
    with engine.begin() as conn:
        _seed_0004(conn)
        conn.execute(
            text(
                "INSERT INTO price_daily (ticker, date, open, high, low, close, volume)"
                " VALUES ('GONE', '2026-09-22', 1, 1, 1, 1, 1)"
            )
        )
        conn.execute(
            text("INSERT INTO holding (ticker, quantity, updated_at) VALUES ('GONE', 3, '2026-09-22')")
        )

    with caplog.at_level("WARNING"):
        migrate.upgrade_to_head(engine)

    assert _rows(engine, "SELECT market FROM instrument WHERE ticker = 'GONE'") == [("US",)]
    assert _rows(engine, "SELECT count(*) FROM price_daily WHERE ticker = 'GONE'") == [(1,)]
    assert _rows(engine, "SELECT count(*) FROM holding WHERE ticker = 'GONE'") == [(0,)]
    assert "옮기지 않았습니다" in caplog.text
    assert "공용 종목 행을 붙였습니다" in caplog.text
    engine.dispose()


def _snapshot_0004(engine) -> dict:
    """0004 모양의 표들을 비교할 수 있게 읽어둔다."""
    stocks = _rows(
        engine,
        "SELECT ticker, name, category, market, currency, active, added_at, dca_amount,"
        " dca_period, rebalance_period, target_weight_pct, rebalance_band_pct,"
        " review_date_override, sort_order FROM stocks ORDER BY ticker",
    )
    holdings = _rows(engine, "SELECT ticker, quantity FROM holding ORDER BY ticker")
    buys = _rows(
        engine,
        "SELECT id, ticker, period_start, period_end, exec_date, type, amount, status,"
        " confirmed_at FROM buy_execution ORDER BY id",
    )
    (settings,) = _rows(
        engine,
        "SELECT id, default_rebalance_band_pct, base_currency, fx_overrides, pinned_macro"
        " FROM portfolio_settings",
    )
    return {
        "stocks": [_normalize(r) for r in stocks],
        "holdings": holdings,
        "buys": [_normalize(r) for r in buys],
        "settings": settings[:3] + (_json(settings[3]), _json(settings[4])),
        "prices": _rows(engine, "SELECT count(*) FROM price_daily"),
    }


def _normalize(row) -> tuple:
    """드라이버마다 다르게 돌려주는 것을 맞춘다 (SQLite는 날짜를 글자로, 불리언을 0/1로)."""
    out = []
    for value in row:
        if isinstance(value, bool):
            value = int(value)
        elif isinstance(value, dt.datetime):
            value = value.isoformat(sep=" ")
        elif isinstance(value, dt.date):
            value = value.isoformat()
        elif isinstance(value, str) and len(value) >= 19 and value[10] == " ":
            value = value[:19] if value.endswith(".000000") else value
        out.append(value)
    return tuple(out)
