"""접속 주소를 어떻게 읽는지.

로컬은 SQLite 파일, 서버는 Postgres다. 둘 사이를 환경변수 하나로 오갈 수 있어야 하고,
**쓰던 설정이 조용히 무시되면 안 된다** — 빈 DB가 열리면 사용자는 데이터가 사라진 줄 안다.
"""

from pathlib import Path

from app import db


def test_default_is_the_file_it_has_always_been(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("SIGNAL_DASHBOARD_DB", raising=False)
    assert db.database_url() == f"sqlite:///{db.DEFAULT_DB_PATH}"


def test_old_path_variable_still_works(monkeypatch, tmp_path):
    """예전부터 쓰던 변수다. 이걸 버리면 남의 DB를 못 찾는다."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("SIGNAL_DASHBOARD_DB", str(tmp_path / "여기.db"))
    assert db.database_url() == f"sqlite:///{tmp_path / '여기.db'}"


def test_database_url_wins(monkeypatch, tmp_path):
    monkeypatch.setenv("SIGNAL_DASHBOARD_DB", str(tmp_path / "무시될.db"))
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@db/signal")
    assert db.database_url() == "postgresql+psycopg://u:p@db/signal"


def test_blank_database_url_falls_back(monkeypatch):
    """compose에서 변수를 안 채우면 빈 문자열이 온다. 빈 주소로 접속을 시도하면 안 된다."""
    monkeypatch.delenv("SIGNAL_DASHBOARD_DB", raising=False)
    monkeypatch.setenv("DATABASE_URL", "   ")
    assert db.database_url() == f"sqlite:///{db.DEFAULT_DB_PATH}"


def test_hosted_postgres_url_is_accepted_as_given(monkeypatch):
    """많은 호스팅이 `postgres://`를 준다. SQLAlchemy 2.0은 이걸 모른다고 거절한다.

    사용자가 받은 주소를 그대로 붙여넣을 수 있어야 한다.
    """
    monkeypatch.setenv("DATABASE_URL", "postgres://u:p@host:5432/signal")
    assert db.database_url() == "postgresql+psycopg://u:p@host:5432/signal"


def test_driverless_postgres_url_gets_psycopg(monkeypatch):
    """드라이버를 안 적으면 SQLAlchemy는 psycopg2를 찾는다 — 설치하지 않은 물건이다."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@host/signal")
    assert db.database_url() == "postgresql+psycopg://u:p@host/signal"


def test_sqlite_needs_the_thread_option():
    """스케줄러 스레드와 요청 스레드가 같은 연결을 쓴다."""
    assert db.engine_options("sqlite:///x.db")["connect_args"]["check_same_thread"] is False


def test_server_database_pings_before_use():
    """유휴 연결이 끊긴 뒤에도 풀에 남아 있다 — 안 찔러보면 첫 요청이 항상 실패한다."""
    assert db.engine_options("postgresql+psycopg://u:p@h/d") == {"pool_pre_ping": True}


def test_sqlite_file_points_at_the_actual_file(tmp_path):
    assert db.sqlite_file(f"sqlite:///{tmp_path / 'a.db'}") == Path(tmp_path / "a.db")


def test_no_sqlite_file_for_a_server_database():
    """백업이 파일 복사를 쓸지 pg_dump를 쓸지 여기서 갈린다."""
    assert db.sqlite_file("postgresql+psycopg://u:p@h/d") is None
    assert db.sqlite_file("sqlite:///:memory:") is None
