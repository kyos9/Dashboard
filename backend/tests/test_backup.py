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
            lambda bind, **kw: original(bind, backup_dir=directory, **kw)
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


# --- 진단의 백업 상태 (0.44.0 D0) ---------------------------------------------


def test_status_tells_when_how_big_and_how_many_without_names(tmp_path, monkeypatch):
    made = _fake_backups(tmp_path / "b", 3)
    made[-1].write_bytes(b"x" * 1234)

    status = backup.status(backup_dir=tmp_path / "b")

    assert status["count"] == 3 and status["keep"] == backup.KEEP
    assert status["last_size"] == 1234
    # 이름에 찍힌 서버 시각(가장 최근)을 UTC 로
    newest = dt.datetime(2026, 9, 12, 3, 0, 0).astimezone(dt.timezone.utc)
    assert status["last_at"] == newest.isoformat()
    assert status["last_failure"] is None
    # 파일 이름·경로는 담지 않는다
    text = repr(status)
    assert backup.PREFIX not in text and str(tmp_path) not in text


def test_status_with_no_backups(tmp_path, monkeypatch):
    assert backup.status(backup_dir=tmp_path / "없음") == {
        "count": 0, "keep": backup.KEEP, "last_at": None, "last_size": None, "last_failure": None,
        "premigrate": {"count": 0, "last_at": None},
    }


def test_a_failure_is_remembered_as_a_kind_and_cleared_by_the_next_success(live_db, tmp_path, monkeypatch):
    """사유는 갈래 이름만 — 예외 글에 든 DB 경로가 화면으로 나가지 않는다."""
    monkeypatch.setattr(backup, "BACKUP_DIR", tmp_path / "b")
    missing = tmp_path / "아무도모르는경로" / "없음.db"
    monkeypatch.setattr(backup, "database_url", lambda: f"sqlite:///{missing}")

    assert backup.run_backup() is None
    failure = backup.status()["last_failure"]
    assert failure["reason"] == "DB 파일을 찾지 못했습니다"
    assert dt.datetime.fromisoformat(failure["at"]).tzinfo is not None
    assert "아무도모르는경로" not in repr(backup.status())

    monkeypatch.setattr(backup, "database_url", lambda: f"sqlite:///{live_db[0]}")
    assert backup.run_backup() is not None
    assert backup.status()["last_failure"] is None


@pytest.mark.parametrize(
    "exc, kind",
    [
        (RuntimeError("pg_dump 를 찾을 수 없습니다. postgresql-client 를 설치해야 백업할 수 있습니다."), "pg_dump 가 없습니다"),
        (RuntimeError("pg_dump 실패 (코드 1): connection to postgresql://u:secret@db/x failed"), "pg_dump 가 실패했습니다"),
        (PermissionError(13, "Permission denied", "/srv/backups/x.db"), "백업 폴더에 쓸 수 없습니다"),
        (OSError(28, "No space left on device"), "디스크가 찼습니다"),
        (OSError(5, "I/O error"), "파일을 쓰지 못했습니다"),
        (ValueError("뭔가"), "알 수 없는 오류 — 서버 로그를 보세요"),
    ],
)
def test_failure_kinds_never_carry_the_message(exc, kind):
    assert backup._failure_kind(exc) == kind


def test_an_upgrade_backup_does_not_hide_a_stalled_daily_backup(tmp_path):
    """업그레이드 직전 백업은 따로 센다 — 섞으면 0014 업그레이드 한 번이 매일 백업이 멈춘 것을 가린다 (D0 검토)."""
    directory = tmp_path / "b"
    _fake_backups(directory, 1, start=dt.datetime(2026, 10, 16, 3, 0, 0))
    upgrade = directory / f"{backup.PREFIX}20261019-093000-premigrate.db"
    upgrade.write_bytes(b"y" * 5000)

    status = backup.status(backup_dir=directory)

    assert status["last_at"] == dt.datetime(2026, 10, 16, 3, 0, 0).astimezone(dt.timezone.utc).isoformat()
    assert status["last_size"] == 1
    assert status["count"] == 2
    assert status["premigrate"] == {
        "count": 1, "last_at": dt.datetime(2026, 10, 19, 9, 30, 0).astimezone(dt.timezone.utc).isoformat(),
    }


def test_the_last_failure_lives_in_the_backup_folder(live_db, tmp_path, monkeypatch):
    """다시 켜도, 다른 워커가 읽어도 같다 — 프로세스 메모리가 아니라 백업 폴더의 작은 파일 (D0 검토)."""
    directory = tmp_path / "b"
    monkeypatch.setattr(backup, "BACKUP_DIR", directory)
    monkeypatch.setattr(backup, "database_url", lambda: f"sqlite:///{tmp_path / '없음.db'}")
    assert backup.run_backup() is None

    import json

    saved = json.loads((directory / backup.STATUS_FILE).read_text(encoding="utf-8"))
    assert saved["last_failure"]["reason"] == "DB 파일을 찾지 못했습니다"
    # 메모리에 두지 않는다 — 파일을 지우면 실패도 사라진다(다시 켠 프로세스·다른 워커는 파일만 본다)
    assert backup.status(backup_dir=directory)["last_failure"]["reason"] == "DB 파일을 찾지 못했습니다"
    assert backup.status(backup_dir=directory)["count"] == 0  # 상태 파일은 백업으로 세지 않는다
    (directory / backup.STATUS_FILE).unlink()
    assert backup.status(backup_dir=directory)["last_failure"] is None


def test_a_broken_status_file_reads_as_no_failure(tmp_path):
    directory = tmp_path / "b"
    directory.mkdir()
    (directory / backup.STATUS_FILE).write_text("{망가짐", encoding="utf-8")
    assert backup.status(backup_dir=directory)["last_failure"] is None
    (directory / backup.STATUS_FILE).write_text('{"last_failure": {"at": 1}}', encoding="utf-8")
    assert backup.status(backup_dir=directory)["last_failure"] is None


def test_times_are_converted_from_the_server_clock_not_relabelled(tmp_path, monkeypatch):
    """집 PC 는 한국 시간으로 돈다 — 이름의 시각에 UTC 꼬리표만 붙이면 9시간 어긋난다 (D0 검토: 테스트 환경이 UTC 라 못 잡았다)."""
    import time

    monkeypatch.setenv("TZ", "Asia/Seoul")
    time.tzset()
    try:
        _fake_backups(tmp_path / "b", 1, start=dt.datetime(2026, 10, 16, 9, 0, 0))
        assert backup.status(backup_dir=tmp_path / "b")["last_at"] == "2026-10-16T00:00:00+00:00"
    finally:
        monkeypatch.delenv("TZ")
        time.tzset()
