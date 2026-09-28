"""0011 — 산 환율(`holding.avg_fx`)과 환율 효과 켜기(`user_settings.include_fx_effect`).

- 올릴 때: 두 칸만 생기고 **있던 보유·설정은 그대로**다. 산 환율은 빈 채로, 환율 효과는 끔으로 시작한다.
- 내릴 때: 그 두 칸만 사라진다.
"""

from alembic import command
from sqlalchemy import inspect, text

from app import migrate
from tests import test_migration_0005 as m0005
from tests.test_migration_0005 import _rows

at_0004 = m0005.at_0004
snapshots = m0005.snapshots


def _to(engine, revision: str) -> None:
    with engine.begin() as conn:
        command.upgrade(migrate._config(conn), revision)


def _columns(engine, table: str) -> set[str]:
    return {c["name"] for c in inspect(engine).get_columns(table)}


def test_upgrade_adds_two_columns_and_keeps_holdings(at_0004, snapshots):
    engine = at_0004
    _to(engine, "0010")
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO user_settings (user_id, default_rebalance_band_pct, base_currency,"
                          " review_period, cash_target_pct) VALUES (1, 5, 'KRW', 'quarterly', 0)"
                          " ON CONFLICT DO NOTHING"))
    holdings = _rows(engine, "SELECT user_id, ticker, quantity, avg_cost FROM holding ORDER BY ticker")
    settings = _rows(engine, "SELECT user_id, base_currency FROM user_settings ORDER BY user_id")
    assert holdings and settings
    assert "avg_fx" not in _columns(engine, "holding")

    migrate.upgrade_to_head(engine)
    assert "avg_fx" in _columns(engine, "holding")
    assert "include_fx_effect" in _columns(engine, "user_settings")
    assert _rows(engine, "SELECT user_id, ticker, quantity, avg_cost FROM holding ORDER BY ticker") == holdings
    assert _rows(engine, "SELECT user_id, base_currency FROM user_settings ORDER BY user_id") == settings
    # 있던 것은 모름·끔으로 시작한다 — 지금 화면과 똑같이 보인다
    assert {row[0] for row in _rows(engine, "SELECT avg_fx FROM holding")} == {None}
    assert {bool(row[0]) for row in _rows(engine, "SELECT include_fx_effect FROM user_settings")} == {False}


def test_downgrade_removes_only_the_two_columns(at_0004, snapshots):
    engine = at_0004
    migrate.upgrade_to_head(engine)
    with engine.begin() as conn:
        conn.execute(text("UPDATE holding SET avg_fx = 1300"))
    holdings = _rows(engine, "SELECT user_id, ticker, quantity FROM holding ORDER BY ticker")

    with engine.begin() as conn:
        command.downgrade(migrate._config(conn), "0010")

    assert "avg_fx" not in _columns(engine, "holding")
    assert "include_fx_effect" not in _columns(engine, "user_settings")
    assert _rows(engine, "SELECT user_id, ticker, quantity FROM holding ORDER BY ticker") == holdings

    migrate.upgrade_to_head(engine)
    assert migrate.current_revision(engine) == migrate.head_revision()
