"""0010 — 미국 상장 종목 캐시 표.

- 올릴 때: 표 하나만 생기고 **이미 있는 것은 그대로**다.
- 내릴 때: 그 표만 사라진다 (다시 올리면 다음 목록 갱신이 다시 채운다).
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


def test_upgrade_adds_us_listing_and_keeps_stocks(at_0004, snapshots):
    engine = at_0004
    _to(engine, "0009")
    before = _rows(engine, "SELECT user_id, ticker FROM user_stock")
    assert before
    assert "us_listing" not in inspect(engine).get_table_names()

    migrate.upgrade_to_head(engine)
    assert "us_listing" in inspect(engine).get_table_names()
    assert _rows(engine, "SELECT user_id, ticker FROM user_stock") == before

    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO us_listing (code, name, exchange, instrument, source, updated_at)"
            " VALUES ('A', 'Agilent Technologies, Inc.', 'NYSE', 'STOCK', 'nasdaqtrader', CURRENT_TIMESTAMP)"
        ))
    assert _rows(engine, "SELECT code FROM us_listing") == [("A",)]


def test_downgrade_removes_only_us_listing(at_0004, snapshots):
    engine = at_0004
    migrate.upgrade_to_head(engine)
    stocks_before = _rows(engine, "SELECT user_id, ticker FROM user_stock")

    with engine.begin() as conn:
        command.downgrade(migrate._config(conn), "0009")

    tables = set(inspect(engine).get_table_names())
    assert "us_listing" not in tables
    assert "fundamental_fact" in tables
    assert _rows(engine, "SELECT user_id, ticker FROM user_stock") == stocks_before

    migrate.upgrade_to_head(engine)
    assert migrate.current_revision(engine) == migrate.head_revision()
