"""0006 — 매수 기록을 걷어내고 포트폴리오 단위로 모은다. **데이터를 넣은 채로** 돌린다.

0005 테스트가 쓰는 "몇 달 쓴 DB"를 0005까지 올린 뒤, 사람을 하나 더 넣고 0006을 태운다.
보는 것은 셋이다.

1. 남겨야 할 것(종목·보유수량·설정)은 한 줄도 안 바뀐다
2. 종목마다 흩어져 있던 리뷰 주기·리뷰일이 규칙대로 사람마다 하나로 모인다
3. 지운 것(매수 기록·적립 칸)은 정말 없어지고, 앱이 새 모양을 읽는다

SQLite와 Postgres 양쪽에서 돈다. SQLite는 열을 제자리에서 지우고(3.35+), Postgres는
Enum 타입까지 치운다 — 한쪽만 돌리면 다른 쪽은 사용자의 DB에서 처음 도는 셈이다.
"""

import datetime as dt

import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import inspect, text
from sqlalchemy.orm import sessionmaker

import app.main as main_module
from app import migrate
from app.db import get_db
from tests import dbsetup
from tests import test_migration_0005 as m0005
from tests.test_migration_0005 import BUYS, HOLDINGS, _rows, to_0005

# 0005 테스트의 "몇 달 쓴 DB"와 백업 기록 픽스처를 그대로 쓴다
at_0004 = m0005.at_0004
snapshots = m0005.snapshots

FAR_FUTURE = dt.date(2099, 3, 1)
LONG_AGO = dt.date(2000, 1, 31)
SECOND = 2


def _enum(value: str, type_name: str) -> str:
    """Postgres는 Enum 칸에 글자를 넣을 때 타입을 밝혀야 한다."""
    return f"CAST('{value}' AS {type_name})" if dbsetup.on_postgres() else f"'{value}'"


@pytest.fixture()
def at_0005(at_0004):
    """0005 모양 + 두 번째 사람. 리뷰일을 오늘과 무관한 날짜로 고정한다."""
    engine = at_0004
    to_0005(engine)
    with engine.begin() as conn:
        # 1번: 분기(VOO)·반기(삼성) 하나씩 켜져 있고 도요타(분기)는 꺼져 있다 → 동률 → 분기
        conn.execute(
            text("UPDATE user_stock SET review_date_override = :d WHERE ticker = '005930.KS'"),
            {"d": FAR_FUTURE},
        )
        conn.execute(
            text("UPDATE user_stock SET review_date_override = :d WHERE ticker = 'VOO'"),
            {"d": LONG_AGO},
        )
        # 2번: 설정 행이 없고, 켜진 종목 둘이 전부 반기
        conn.execute(
            text(
                "INSERT INTO users (id, created_at, session_epoch, is_owner)"
                " VALUES (:id, :now, 0, :owner)"
            ),
            {"id": SECOND, "now": dt.datetime(2026, 9, 1), "owner": False},
        )
        for ticker in ("VOO", "7203.T"):
            conn.execute(
                text(
                    "INSERT INTO user_stock (user_id, ticker, active, added_at, dca_amount,"
                    " dca_period, rebalance_period, target_weight_pct, sort_order)"
                    f" VALUES (:u, :t, :a, :at, 0, {_enum('monthly', 'dcaperiod')},"
                    f" {_enum('semiannual', 'rebalanceperiod')}, 50, 0)"
                ),
                {"u": SECOND, "t": ticker, "a": True, "at": dt.datetime(2026, 9, 1)},
            )
    return engine


def test_kept_values_do_not_move(at_0005, snapshots):
    engine = at_0005
    migrate.upgrade_to_head(engine)
    assert migrate.current_revision(engine) == migrate.head_revision()

    assert sorted(_rows(engine, "SELECT user_id, ticker, quantity FROM holding")) == sorted(
        (1, t, q) for t, q, _ in HOLDINGS
    )
    # 평단가는 몰랐으니 비어 있다 — 0이면 "공짜로 샀다"가 된다
    assert _rows(engine, "SELECT count(*) FROM holding WHERE avg_cost IS NOT NULL") == [(0,)]
    assert sorted(
        _rows(engine, "SELECT ticker, target_weight_pct, rebalance_band_pct FROM user_stock"
              " WHERE user_id = 1")
    ) == sorted([("VOO", 50.0, None), ("005930.KS", 30.0, 4.0), ("7203.T", 20.0, None)])
    assert _rows(engine, "SELECT count(*) FROM user_stock") == [(5,)]


def test_review_settings_are_gathered_per_person(at_0005, snapshots):
    engine = at_0005
    migrate.upgrade_to_head(engine)

    settings = dict(
        (u, (p, o))
        for u, p, o in _rows(
            engine, "SELECT user_id, review_period, review_date_override FROM user_settings"
        )
    )
    # 1번: 동률이면 분기. 지난 리뷰일(2000년)은 버리고 오지 않은 날만 옮긴다
    period, override = settings[1]
    assert period == "quarterly"
    assert str(override)[:10] == FAR_FUTURE.isoformat()
    # 2번: 설정 행이 없었지만 반기를 골랐으니 새로 만들어 준다
    period, override = settings[SECOND]
    assert (period, override) == ("semiannual", None)
    assert _rows(
        engine,
        "SELECT default_rebalance_band_pct, base_currency, cash_target_pct FROM user_settings"
        " WHERE user_id = :u",
        u=SECOND,
    ) == [(5.0, "KRW", 0.0)]


def test_buy_records_and_dca_columns_are_gone(at_0005, snapshots, caplog):
    engine = at_0005
    with caplog.at_level("WARNING"):
        migrate.upgrade_to_head(engine)

    inspector = inspect(engine)
    assert "buy_execution" not in inspector.get_table_names()
    columns = {c["name"] for c in inspector.get_columns("user_stock")}
    assert not columns & {"dca_amount", "dca_period", "rebalance_period", "review_date_override"}
    assert "rebalance_snapshot" in inspector.get_table_names()
    # 몇 건을 버렸는지 남긴다 — 백업에서 찾을 때 단서다
    assert f"매수 기록 {len(BUYS)}건을 지웁니다 (확정 1건은" in caplog.text

    if dbsetup.on_postgres():
        types = {r[0] for r in _rows(engine, "SELECT typname FROM pg_type WHERE typtype = 'e'")}
        assert not types & {"dcaperiod", "rebalanceperiod", "buytype", "buystatus"}


def test_the_upgrade_demands_a_backup(at_0005, snapshots):
    migrate.upgrade_to_head(at_0005)
    assert snapshots == [True]


def test_the_app_reads_the_new_shape(at_0005, snapshots, monkeypatch):
    engine = at_0005
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
            settings = client.get("/api/rebalance/settings").json()
            holdings = client.get("/api/rebalance/holdings").json()
            current = client.get("/api/rebalance/current")
            dashboard = client.get("/api/dashboard")
    finally:
        main_module.app.dependency_overrides.clear()

    assert settings["review_period"] == "quarterly"
    assert settings["review_date_override"] == FAR_FUTURE.isoformat()
    assert settings["cash"] == {}
    assert {h["ticker"]: h["avg_cost"] for h in holdings} == {
        "VOO": None, "005930.KS": None, "7203.T": None
    }
    assert current.status_code == 200, current.text
    assert current.json()["review"]["next_date"] == FAR_FUTURE.isoformat()
    assert dashboard.status_code == 200, dashboard.text
    # 0005 픽스처의 시그널은 전부 무릎매수 — 마지막 날이 그대로 보인다
    assert {c["last_buy_signal_date"] for c in dashboard.json()} == {"2026-09-22"}


def test_downgrade_brings_back_the_shape_but_not_the_records(at_0005, snapshots):
    engine = at_0005
    migrate.upgrade_to_head(engine)
    with engine.begin() as conn:
        conn.execute(text("UPDATE user_settings SET review_period = 'annual' WHERE user_id = :u"),
                     {"u": SECOND})

    with engine.begin() as conn:
        command.downgrade(migrate._config(conn), "0005")
    assert migrate.current_revision(engine) == "0005"

    # 연 1회는 예전에 없던 값 — 반기로 돌아간다. 1번은 분기 그대로
    periods = dict(
        ((u, t), p)
        for u, t, p in _rows(engine, "SELECT user_id, ticker, rebalance_period FROM user_stock")
    )
    assert periods[(1, "VOO")] == "quarterly"
    assert periods[(SECOND, "VOO")] == "semiannual"
    assert _rows(engine, "SELECT count(*) FROM buy_execution") == [(0,)]
    assert "avg_cost" not in {c["name"] for c in inspect(engine).get_columns("holding")}
    assert "rebalance_snapshot" not in inspect(engine).get_table_names()

    # 다시 올려도 된다 (왕복)
    migrate.upgrade_to_head(engine)
    assert migrate.current_revision(engine) == migrate.head_revision()
    assert _rows(engine, "SELECT count(*) FROM user_stock") == [(5,)]
