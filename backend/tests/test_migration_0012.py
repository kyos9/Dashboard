"""0012 — 앱 설정 표(`app_setting`, 9-15). 새 표 하나라 있던 데이터는 그대로이고, 줄이 없으면 기본값이다."""

import pytest
from alembic import command
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app import migrate
from app.services import app_settings
from tests import test_migration_0005 as m0005
from tests.test_migration_0005 import _rows

at_0004 = m0005.at_0004
snapshots = m0005.snapshots


def test_upgrade_adds_the_table_and_starts_with_defaults(at_0004, snapshots):
    engine = at_0004
    with engine.begin() as conn:
        command.upgrade(migrate._config(conn), "0011")
    holdings = _rows(engine, "SELECT user_id, ticker, quantity FROM holding ORDER BY ticker")
    assert "app_setting" not in inspect(engine).get_table_names()

    migrate.upgrade_to_head(engine)
    assert "app_setting" in inspect(engine).get_table_names()
    assert _rows(engine, "SELECT user_id, ticker, quantity FROM holding ORDER BY ticker") == holdings
    with Session(engine) as db:
        assert app_settings.ai_advice_open(db) is True  # 줄이 없으면 기본값 (연다)
        app_settings.set_flag(db, app_settings.AI_ADVICE_FOR_USERS, False)
        assert app_settings.ai_advice_open(db) is False
        app_settings.set_flag(db, app_settings.AI_ADVICE_FOR_USERS, True)
        assert app_settings.ai_advice_open(db) is True
    assert _rows(engine, "SELECT key, value FROM app_setting") == [("ai_advice_for_users", "1")]


def test_downgrade_drops_only_the_table(at_0004, snapshots):
    engine = at_0004
    migrate.upgrade_to_head(engine)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO app_setting (key, value, updated_at) VALUES ('ai_advice_for_users', '0', "
                          "CURRENT_TIMESTAMP)"))
    holdings = _rows(engine, "SELECT user_id, ticker, quantity FROM holding ORDER BY ticker")
    with engine.begin() as conn:
        command.downgrade(migrate._config(conn), "0011")
    assert "app_setting" not in inspect(engine).get_table_names()
    assert _rows(engine, "SELECT user_id, ticker, quantity FROM holding ORDER BY ticker") == holdings


def test_unknown_setting_is_refused(at_0004, snapshots):
    migrate.upgrade_to_head(at_0004)
    with Session(at_0004) as db, pytest.raises(KeyError):
        app_settings.set_flag(db, "no_such_setting", True)
