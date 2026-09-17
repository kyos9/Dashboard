"""백업.

백업은 뜨는 것보다 **복구되는 것**이 중요하다. 그래서 여기서는 "파일이 생겼다"로
끝내지 않고, 뜬 파일을 실제로 열어 내용이 들어 있는지까지 본다.
"""

import datetime as dt
import sqlite3
import subprocess
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from app import migrate
from app.services import backup

from tests.test_migration import OLD_ROWS, OLD_SCHEMA


@pytest.fixture()
def live_db(tmp_path):
    """열려 있는 상태의 SQLite DB. (닫힌 파일만 백업할 수 있으면 쓸모가 없다.)"""
    path = tmp_path / "live.db"
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE t (k TEXT PRIMARY KEY, v TEXT)")
    con.execute("INSERT INTO t VALUES ('삼성전자', '100주')")
    con.commit()
    try:
        yield path, con
    finally:
        con.close()


def test_backup_of_a_running_database_opens_and_has_the_rows(live_db, tmp_path):
    """돌고 있는 파일을 복사하면 찢어진 파일이 나올 수 있다 — sqlite 백업 API를 쓴다."""
    path, con = live_db
    dest = backup.create_backup(url=f"sqlite:///{path}", backup_dir=tmp_path / "b")

    restored = sqlite3.connect(dest)
    try:
        assert restored.execute("SELECT v FROM t WHERE k='삼성전자'").fetchone() == ("100주",)
    finally:
        restored.close()


def test_backup_is_a_plain_database_file(live_db, tmp_path):
    """복구가 '파일을 제자리에 갖다 놓기'여야 급할 때 실제로 복구된다."""
    path, _ = live_db
    dest = backup.create_backup(url=f"sqlite:///{path}", backup_dir=tmp_path / "b")
    assert dest.suffix == ".db"
    assert dest.read_bytes()[:16] == b"SQLite format 3\x00"


def test_missing_database_says_so(tmp_path):
    with pytest.raises(FileNotFoundError):
        backup.create_backup(url=f"sqlite:///{tmp_path / '없음.db'}", backup_dir=tmp_path / "b")


def _fake_backups(directory, count, start=None):
    directory.mkdir(parents=True, exist_ok=True)
    start = start or dt.datetime(2026, 9, 10, 3, 0, 0)
    made = []
    for i in range(count):
        stamp = (start + dt.timedelta(days=i)).strftime(backup.STAMP)
        path = directory / f"{backup.PREFIX}{stamp}.db"
        path.write_bytes(b"x")
        made.append(path)
    return made


def test_prune_keeps_the_newest(tmp_path):
    made = _fake_backups(tmp_path / "b", 10)
    removed = backup.prune(keep=3, backup_dir=tmp_path / "b")

    left = {p.name for p in backup.existing_backups(tmp_path / "b")}
    assert left == {p.name for p in made[-3:]}
    assert len(removed) == 7


def test_prune_leaves_other_files_alone(tmp_path):
    """백업 폴더에 사용자가 뭘 넣어뒀을 수 있다. 우리가 만든 것만 지운다."""
    directory = tmp_path / "b"
    _fake_backups(directory, 3)
    mine = directory / "복구용-메모.txt"
    mine.write_text("여기 넣어둠", encoding="utf-8")

    backup.prune(keep=0, backup_dir=directory)
    assert mine.exists()


def test_recent_backup_means_skip(live_db, tmp_path, monkeypatch):
    """앱을 켤 때마다 뜨면 보관 7벌이 반나절치가 된다."""
    path, _ = live_db
    directory = tmp_path / "b"
    monkeypatch.setattr(backup, "BACKUP_DIR", directory)
    monkeypatch.setattr(backup, "database_url", lambda: f"sqlite:///{path}")

    first = backup.run_backup_if_stale(max_age_hours=12)
    second = backup.run_backup_if_stale(max_age_hours=12)

    assert first is not None
    assert second is None
    assert len(backup.existing_backups(directory)) == 1


def test_stale_backup_means_take_one(live_db, tmp_path, monkeypatch):
    path, _ = live_db
    directory = tmp_path / "b"
    monkeypatch.setattr(backup, "BACKUP_DIR", directory)
    monkeypatch.setattr(backup, "database_url", lambda: f"sqlite:///{path}")
    _fake_backups(directory, 1, start=dt.datetime.now() - dt.timedelta(days=3))

    assert backup.run_backup_if_stale(max_age_hours=12) is not None


def test_failure_is_loud_but_not_fatal(tmp_path, monkeypatch, caplog):
    """백업이 없는 걸 모르는 게, 백업이 없는 것보다 나쁘다."""
    monkeypatch.setattr(backup, "BACKUP_DIR", tmp_path / "b")
    monkeypatch.setattr(backup, "database_url", lambda: f"sqlite:///{tmp_path / '없음.db'}")

    with caplog.at_level("ERROR"):
        assert backup.run_backup() is None
    assert "백업에 실패" in caplog.text


# --- 마이그레이션 직전 백업 -------------------------------------------------


def _old_database(path):
    con = sqlite3.connect(path)
    con.executescript(OLD_SCHEMA)
    con.executescript(OLD_ROWS)
    con.commit()
    con.close()


def test_a_snapshot_is_taken_before_the_schema_changes(tmp_path):
    """마이그레이션이 잘못 돌면 되돌릴 자리가 여기밖에 없다."""
    path = tmp_path / "old.db"
    _old_database(path)
    directory = tmp_path / "b"

    engine = create_engine(f"sqlite:///{path}")
    try:
        backup.BACKUP_DIR  # noqa: B018  (conftest가 이미 임시 폴더로 옮겨 놨다)
        import app.migrate as migrate_module

        original = backup.snapshot_before_migration
        migrate_module.backup.snapshot_before_migration = (
            lambda bind: original(bind, backup_dir=directory)
        )
        try:
            migrate.upgrade_to_head(engine)
        finally:
            migrate_module.backup.snapshot_before_migration = original
    finally:
        engine.dispose()

    saved = backup.existing_backups(directory)
    assert len(saved) == 1
    assert "premigrate" in saved[0].name

    # 떠둔 파일은 **바꾸기 전** 모습이어야 쓸모가 있다
    con = sqlite3.connect(saved[0])
    try:
        columns = {r[1] for r in con.execute("PRAGMA table_info(stocks)").fetchall()}
        assert "market" not in columns  # 아직 안 붙은 컬럼
        assert con.execute("SELECT count(*) FROM stocks").fetchone() == (3,)
    finally:
        con.close()


def test_no_snapshot_when_there_is_nothing_to_migrate(tmp_path, monkeypatch):
    """앱을 켤 때마다 뜨면 정작 필요한 '바꾸기 직전' 백업이 밀려나 사라진다."""
    directory = tmp_path / "b"
    monkeypatch.setattr(backup, "BACKUP_DIR", directory)

    engine = create_engine(f"sqlite:///{tmp_path / 'new.db'}")
    try:
        migrate.upgrade_to_head(engine)  # 빈 DB를 처음 만든다 — 잃을 게 없다
        assert backup.existing_backups(directory) == []
        migrate.upgrade_to_head(engine)  # 이미 최신이다
        assert backup.existing_backups(directory) == []
    finally:
        engine.dispose()


def test_memory_database_is_skipped():
    """테스트가 쓰는 메모리 DB에는 뜰 것도, 잃을 것도 없다."""
    engine = create_engine("sqlite:///:memory:")
    try:
        assert backup.snapshot_before_migration(engine) is None
    finally:
        engine.dispose()


# --- Postgres -----------------------------------------------------------------


def test_postgres_backup_hides_the_password_from_the_process_list(tmp_path, monkeypatch):
    """명령줄 인자는 같은 서버의 다른 프로세스에서 `ps`로 그대로 보인다."""
    seen = {}

    def fake_run(args, **kwargs):
        seen["args"] = args
        seen["env"] = kwargs["env"]
        Path(args[args.index("--file") + 1]).write_text("-- dump", encoding="utf-8")
        return subprocess.CompletedProcess(args, 0, stdout="", stderr="")

    monkeypatch.setattr(backup.shutil, "which", lambda name: "/usr/bin/pg_dump")
    monkeypatch.setattr(backup.subprocess, "run", fake_run)

    backup.create_backup(
        url="postgresql+psycopg://signal:비밀@db:5432/signal", backup_dir=tmp_path / "b"
    )

    assert seen["env"]["PGPASSWORD"] == "비밀"
    # 주소에는 비밀번호가 없고, pg_dump가 모르는 드라이버 이름(+psycopg)도 빠져 있다
    assert seen["args"][-1] == "postgresql://signal@db:5432/signal"


def test_pg_dump_failure_says_why(tmp_path, monkeypatch):
    """`exit code 1`만 남으면 왜 백업이 안 되는지 알 수 없다."""
    monkeypatch.setattr(backup.shutil, "which", lambda name: "/usr/bin/pg_dump")
    monkeypatch.setattr(
        backup.subprocess,
        "run",
        lambda args, **kw: subprocess.CompletedProcess(args, 1, "", "could not connect to server"),
    )
    with pytest.raises(RuntimeError, match="could not connect to server"):
        backup.create_backup(url="postgresql+psycopg://u:p@h/d", backup_dir=tmp_path / "b")


def test_missing_pg_dump_says_what_to_install(tmp_path, monkeypatch):
    monkeypatch.setattr(backup.shutil, "which", lambda name: None)
    with pytest.raises(RuntimeError, match="postgresql-client"):
        backup.create_backup(url="postgresql+psycopg://u:p@h/d", backup_dir=tmp_path / "b")
