"""0013 — 시그널 기준 내 설정(`user_settings.signal_thresholds`, 0.42.0).

- 올릴 때: 칸 하나만 생기고 **있던 설정은 그대로**, 모두 NULL(기본 기준)로 시작한다 — 지금과 똑같이 보인다.
- 내릴 때: 그 칸만 사라진다. 내린 뒤 리비전 목록이 옛 코드가 아는 자리(0012)에 있다 — 옛 이미지가 켜진다.
- 더 새 이미지가 올린 DB(모르는 리비전)를 열어도 앱이 넘어지지 않는다.
"""

from alembic import command
from sqlalchemy import inspect, text

from app import migrate
from tests import test_migration_0005 as m0005
from tests.test_migration_0005 import _rows

at_0004 = m0005.at_0004
snapshots = m0005.snapshots


def _columns(engine, table: str) -> set[str]:
    return {c["name"] for c in inspect(engine).get_columns(table)}


def _to(engine, revision: str) -> None:
    with engine.begin() as conn:
        command.upgrade(migrate._config(conn), revision)


def test_upgrade_adds_one_empty_column_and_keeps_settings(at_0004, snapshots):
    engine = at_0004
    _to(engine, "0012")
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO user_settings (user_id, default_rebalance_band_pct, base_currency,"
                          " review_period, cash_target_pct, include_fx_effect) VALUES (1, 7, 'USD', 'annual', 10, true)"
                          " ON CONFLICT DO NOTHING"))
    settings = _rows(engine, "SELECT user_id, default_rebalance_band_pct, base_currency, review_period FROM user_settings"
                             " ORDER BY user_id")
    assert settings and "signal_thresholds" not in _columns(engine, "user_settings")

    migrate.upgrade_to_head(engine)
    assert "signal_thresholds" in _columns(engine, "user_settings")
    assert _rows(engine, "SELECT user_id, default_rebalance_band_pct, base_currency, review_period FROM user_settings"
                         " ORDER BY user_id") == settings
    assert {row[0] for row in _rows(engine, "SELECT signal_thresholds FROM user_settings")} == {None}


def test_downgrade_removes_only_that_column_and_lands_where_old_code_knows(at_0004, snapshots):
    engine = at_0004
    migrate.upgrade_to_head(engine)
    with engine.begin() as conn:
        conn.execute(text("UPDATE user_settings SET signal_thresholds = '{\"adx_trend\": 25}'"))
    settings = _rows(engine, "SELECT user_id, base_currency FROM user_settings ORDER BY user_id")

    with engine.begin() as conn:
        command.downgrade(migrate._config(conn), "0012")

    assert "signal_thresholds" not in _columns(engine, "user_settings")
    assert _rows(engine, "SELECT user_id, base_currency FROM user_settings ORDER BY user_id") == settings
    # 옛 이미지(0.41.x)가 켜질 때 하는 일 — 찍힌 리비전에서 남은 리비전을 센다. 0012 면 넘어지지 않는다
    assert migrate.current_revision(engine) == "0012"
    assert migrate.pending_revisions("0012")[-1] == "0013"

    migrate.upgrade_to_head(engine)
    assert migrate.current_revision(engine) == migrate.head_revision()


def test_a_db_from_a_newer_version_still_opens(at_0004, snapshots):
    """새 이미지가 올린 DB 를 옛 이미지로 열면 모르는 리비전이 찍혀 있다. 0.42.0 부터는 경고만 하고 그대로 뜬다."""
    engine = at_0004
    migrate.upgrade_to_head(engine)
    with engine.begin() as conn:
        conn.execute(text("UPDATE alembic_version SET version_num = '0099'"))
    assert migrate.is_known("0099") is False
    assert migrate.upgrade_to_head(engine) == "0099"
    assert migrate.current_revision(engine) == "0099"


def test_downgrade_tool_goes_down_to_0012_and_refuses_irreversible_steps(at_0004, snapshots):
    """DEPLOY 9-2 의 첫 줄 — 새 이미지로 0012 까지 내린다. 0005·0006 을 건너는 내리기는 거절한다."""
    import pytest

    engine = at_0004
    migrate.upgrade_to_head(engine)
    assert migrate.downgrade_to("0012", engine) == "0012"
    assert "signal_thresholds" not in _columns(engine, "user_settings")
    with pytest.raises(ValueError, match="되돌릴 수 없습니다"):
        migrate.downgrade_to("0004", engine)
    assert migrate.current_revision(engine) == "0012"
