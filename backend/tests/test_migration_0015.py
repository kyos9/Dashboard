"""0015 — 알림을 받을 때·종목별로 끈 알림(`user_settings.push_prefs`, 0.45.0 B).

- 올릴 때: 칸 하나만 생기고 있던 설정은 그대로, 모두 NULL(아침·오후 둘 다, 끈 것 없음)로 시작한다 — 지금과 같다.
- 내릴 때: 그 칸만 사라진다(설정이라 백업을 조건으로 걸지 않는다). 평가금액 기록(0014)은 그대로 남는다.
- 0.44 이미지(0015 를 모르는 코드)도 그대로 뜬다 — 되돌릴 때 내리지 않아도 된다.
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


def _record(engine) -> None:
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO portfolio_value_daily (user_id, date, base_currency, total_value_base, stock_value_base,"
            " cash_value_base, cash, fx, positions, recorded_at) VALUES"
            " (1, '2026-10-20', 'KRW', 100, 90, 10, '{}', '{}', '[]', '2026-10-19 22:40:00')"
        ))


def test_upgrade_adds_one_empty_column_and_keeps_everything(at_0004, snapshots):
    engine = at_0004
    _to(engine, "0014")
    _record(engine)
    with engine.begin() as conn:
        conn.execute(text("UPDATE user_settings SET push_kinds = '[\"buy\"]', signal_thresholds = '{\"adx_trend\": 25}'"))
    before = _rows(engine, "SELECT user_id, push_kinds, signal_thresholds, base_currency FROM user_settings ORDER BY user_id")
    assert before and "push_prefs" not in _columns(engine, "user_settings")

    migrate.upgrade_to_head(engine)
    assert migrate.current_revision(engine) == "0015"
    assert "push_prefs" in _columns(engine, "user_settings")
    assert _rows(engine, "SELECT user_id, push_kinds, signal_thresholds, base_currency FROM user_settings ORDER BY user_id") == before
    assert {row[0] for row in _rows(engine, "SELECT push_prefs FROM user_settings")} == {None}
    assert _rows(engine, "SELECT COUNT(*) FROM portfolio_value_daily") == [(1,)]
    # 설정 칸을 더할 뿐 — 직전 백업은 떠 보되 실패해도 막지 않는다
    assert snapshots[-1] is False


def test_downgrade_to_0014_removes_only_that_column_without_requiring_a_backup(at_0004, snapshots):
    engine = at_0004
    migrate.upgrade_to_head(engine)
    _record(engine)
    with engine.begin() as conn:
        conn.execute(text("UPDATE user_settings SET push_prefs = '{\"slots\": [\"afternoon\"], \"muted\": []}'"))
    snapshots.clear()

    assert migrate.downgrade_to("0014", engine) == "0014"
    assert snapshots == [False]  # 설정만 잃는다 — 백업에 실패해도 내린다
    assert "push_prefs" not in _columns(engine, "user_settings")
    assert _rows(engine, "SELECT COUNT(*) FROM portfolio_value_daily") == [(1,)]

    migrate.upgrade_to_head(engine)
    assert migrate.current_revision(engine) == "0015"


def test_the_previous_image_still_opens_a_db_at_0015(at_0004, snapshots, monkeypatch):
    """0.44 이미지는 0015 를 모른다 — 경고만 하고 그대로 뜬다."""
    engine = at_0004
    migrate.upgrade_to_head(engine)
    monkeypatch.setattr(migrate, "is_known", lambda revision: revision != "0015")
    assert migrate.upgrade_to_head(engine) == "0015"
