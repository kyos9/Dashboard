"""0014 — 날마다의 평가금액(`portfolio_value_daily`, 0.44.0).

- 올릴 때: 빈 표 하나만 생기고 있던 데이터는 그대로다.
- 내릴 때: **쌓인 기록이 사라지므로** 백업에 성공해야만 내린다(`required=True`). 0013 까지만 건너는 내리기는 지금처럼.
- 0.43 이미지(0013 까지 아는 코드)는 0014 가 찍힌 DB 로도 뜬다 — 그래서 되돌릴 때 내리지 않아도 된다.
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


def _insert_row(engine) -> None:
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO portfolio_value_daily (user_id, date, base_currency, total_value_base, stock_value_base,"
            " cash_value_base, cash, fx, positions, recorded_at) VALUES"
            " (1, '2026-10-16', 'KRW', 100, 90, 10, '{}', '{}', '[]', '2026-10-15 22:40:00')"
        ))


def test_upgrade_adds_an_empty_table_and_keeps_everything_else(at_0004, snapshots):
    engine = at_0004
    _to(engine, "0013")
    before = {t: _rows(engine, f"SELECT COUNT(*) FROM {t}") for t in ("users", "user_stock", "holding", "user_settings")}
    assert "portfolio_value_daily" not in inspect(engine).get_table_names()

    migrate.upgrade_to_head(engine)

    assert "portfolio_value_daily" in inspect(engine).get_table_names()
    assert _rows(engine, "SELECT COUNT(*) FROM portfolio_value_daily") == [(0,)]
    assert {t: _rows(engine, f"SELECT COUNT(*) FROM {t}") for t in before} == before
    # 더하는 리비전이라 백업을 못 떠도 진행한다(되돌릴 수 없는 0005·0006 과 다르다)
    assert snapshots == [False]


def test_one_row_per_person_per_day(at_0004, snapshots):
    import pytest
    from sqlalchemy.exc import IntegrityError

    engine = at_0004
    migrate.upgrade_to_head(engine)
    _insert_row(engine)
    with pytest.raises(IntegrityError):
        _insert_row(engine)


def test_downgrading_past_0014_requires_a_backup(at_0004, snapshots):
    engine = at_0004
    migrate.upgrade_to_head(engine)
    _insert_row(engine)

    assert migrate.downgrade_to("0013", engine) == "0013"

    assert snapshots[-1] is True  # 쌓인 기록이 사라지는 내리기 — 백업에 실패하면 멈춘다
    assert "portfolio_value_daily" not in inspect(engine).get_table_names()


def test_downgrade_stops_when_the_backup_fails(at_0004, monkeypatch):
    import pytest

    from app.services import backup

    engine = at_0004
    migrate.upgrade_to_head(engine)
    _insert_row(engine)

    def no_disk(bind, backup_dir=None, *, required=False):
        if required:
            raise backup.MigrationBackupFailed("디스크가 찼습니다")

    monkeypatch.setattr(backup, "snapshot_before_migration", no_disk)
    with pytest.raises(backup.MigrationBackupFailed):
        migrate.downgrade_to("0013", engine)
    assert migrate.current_revision(engine) == "0014"
    assert _rows(engine, "SELECT COUNT(*) FROM portfolio_value_daily") == [(1,)]


def test_downgrading_only_0013_does_not_require_a_backup(at_0004, snapshots):
    engine = at_0004
    migrate.upgrade_to_head(engine)
    migrate.downgrade_to("0013", engine)
    snapshots.clear()
    assert migrate.downgrade_to("0012", engine) == "0012"
    assert snapshots == [False]


def test_the_previous_image_still_opens_a_db_at_0014(at_0004, snapshots, monkeypatch):
    """0.43 이미지는 0014 를 모른다 — 경고만 하고 그대로 뜬다. 이미지만 되돌리면 기록이 산다."""
    engine = at_0004
    migrate.upgrade_to_head(engine)
    _insert_row(engine)
    monkeypatch.setattr(migrate, "is_known", lambda revision: revision != "0014")
    assert migrate.upgrade_to_head(engine) == "0014"
    assert _rows(engine, "SELECT COUNT(*) FROM portfolio_value_daily") == [(1,)]


def test_the_owner_link_cascades(at_0004, snapshots):
    """0.43 이미지(이 표를 모른다)로 되돌린 동안의 탈퇴가 Postgres 에서 넘어지지 않게 — 외래키는 CASCADE (A 검토).

    SQLite 는 운영에서 외래키를 강제하지 않는다 — 그쪽은 0.44 가 켤 때 치운다(test_value_record 의 sweep).
    """
    engine = at_0004
    migrate.upgrade_to_head(engine)
    (fk,) = inspect(engine).get_foreign_keys("portfolio_value_daily")
    assert fk["referred_table"] == "users"
    assert (fk.get("options") or {}).get("ondelete", "").upper() == "CASCADE"
