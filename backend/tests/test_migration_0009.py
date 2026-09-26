"""0009 — 재무 표 셋 (공시 값 · 수집 상태 · 액면분할).

- 올릴 때: 새 표만 생기고 **이미 있는 것은 그대로**다.
- 내릴 때: 재무 표만 사라진다 (다시 올리면 새벽 작업이 다시 받는다).
"""

from alembic import command
from sqlalchemy import inspect, text

from app import migrate
from tests import test_migration_0005 as m0005
from tests.test_migration_0005 import _rows

at_0004 = m0005.at_0004
snapshots = m0005.snapshots

NEW = {"fundamental_fact", "fundamental_status", "stock_split"}


def _to(engine, revision: str) -> None:
    with engine.begin() as conn:
        command.upgrade(migrate._config(conn), revision)


def test_upgrade_adds_fundamental_tables_and_keeps_stocks(at_0004, snapshots):
    engine = at_0004
    _to(engine, "0008")
    before = _rows(engine, "SELECT user_id, ticker FROM user_stock")
    assert before

    migrate.upgrade_to_head(engine)
    assert NEW <= set(inspect(engine).get_table_names())
    assert _rows(engine, "SELECT user_id, ticker FROM user_stock") == before

    ticker = before[0][1]
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO fundamental_fact (ticker, metric, period_start, period_end, value, unit, filed_at,"
            " filed_estimated, source, fetched_at) VALUES (:t, 'revenue', '2026-04-01', '2026-06-30', 1, 'USD',"
            " '2026-07-23', false, 'sec', CURRENT_TIMESTAMP)"
        ), {"t": ticker})
        conn.execute(text(
            "INSERT INTO stock_split (ticker, date, ratio) VALUES (:t, '2024-06-10', 10)"
        ), {"t": ticker})
        conn.execute(text(
            "INSERT INTO fundamental_status (ticker, state) VALUES (:t, 'ok')"
        ), {"t": ticker})


def test_downgrade_removes_only_fundamental_tables(at_0004, snapshots):
    engine = at_0004
    migrate.upgrade_to_head(engine)
    stocks_before = _rows(engine, "SELECT user_id, ticker FROM user_stock")

    with engine.begin() as conn:
        command.downgrade(migrate._config(conn), "0008")

    assert not NEW & set(inspect(engine).get_table_names())
    assert _rows(engine, "SELECT user_id, ticker FROM user_stock") == stocks_before

    migrate.upgrade_to_head(engine)
    assert migrate.current_revision(engine) == migrate.head_revision()
