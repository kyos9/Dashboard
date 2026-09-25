"""0008 — 푸시 알림 표 둘 + 받을 종류 칸.

- 올릴 때: 새 표·칸만 생기고 **이미 있는 설정은 그대로**다.
- 내릴 때: 구독이 사라질 뿐 나머지는 남는다 (다시 올리면 화면이 다시 구독한다).
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


def test_upgrade_adds_push_tables_and_keeps_settings(at_0004, snapshots):
    engine = at_0004
    _to(engine, "0007")
    before = _rows(engine, "SELECT user_id, base_currency, default_rebalance_band_pct FROM user_settings")
    assert before  # 옮길 설정이 실제로 있다

    migrate.upgrade_to_head(engine)
    assert migrate.current_revision(engine) == migrate.head_revision()
    tables = set(inspect(engine).get_table_names())
    assert {"push_subscription", "push_state"} <= tables
    assert _rows(engine, "SELECT user_id, base_currency, default_rebalance_band_pct FROM user_settings") == before
    # 고른 적이 없으면 "다 받는다"
    assert {row[0] for row in _rows(engine, "SELECT push_kinds FROM user_settings")} == {None}

    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO push_subscription (user_id, endpoint, p256dh, auth, created_at)"
            " VALUES (1, 'https://fcm.googleapis.com/fcm/send/x', 'k', 'a', CURRENT_TIMESTAMP)"
        ))
        conn.execute(text(
            "INSERT INTO push_state (user_id, subject, value, updated_at)"
            " VALUES (1, 'buy:VOO', '2026-09-21', CURRENT_TIMESTAMP)"
        ))


def test_downgrade_removes_only_push_things(at_0004, snapshots):
    engine = at_0004
    migrate.upgrade_to_head(engine)
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO push_subscription (user_id, endpoint, p256dh, auth, created_at)"
            " VALUES (1, 'https://fcm.googleapis.com/fcm/send/x', 'k', 'a', CURRENT_TIMESTAMP)"
        ))
    stocks_before = _rows(engine, "SELECT user_id, ticker FROM user_stock")

    with engine.begin() as conn:
        command.downgrade(migrate._config(conn), "0007")

    tables = set(inspect(engine).get_table_names())
    assert "push_subscription" not in tables and "push_state" not in tables
    assert "push_kinds" not in {c["name"] for c in inspect(engine).get_columns("user_settings")}
    assert _rows(engine, "SELECT user_id, ticker FROM user_stock") == stocks_before

    migrate.upgrade_to_head(engine)  # 다시 올라간다
    assert migrate.current_revision(engine) == migrate.head_revision()
