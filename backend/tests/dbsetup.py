"""테스트가 어느 DB에서 도는지 한 곳에서 정한다.

기본은 메모리 SQLite다 — 빠르고, 아무것도 설치하지 않아도 된다.

`TEST_DATABASE_URL`을 주면 그 DB에서 같은 테스트를 그대로 돌린다. CI가 이걸로
**Postgres에서 한 번 더** 돌린다. 서버에 올릴 때 쓰는 게 Postgres인데 여기서 한 번도
안 돌려보면, 마이그레이션이 거기서 도는지를 서버에서 처음 알게 된다 — 가장 늦고 가장
나쁜 자리다. SQLite는 타입에 느슨해서 Postgres가 거절하는 것을 조용히 받아준다.
"""

import os

from sqlalchemy import create_engine, event, text

from app.db import Base

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "").strip()


def on_postgres() -> bool:
    return TEST_DATABASE_URL.startswith("postgres")


def reset_database(engine) -> None:
    """DB를 빈 상태로 되돌린다.

    Postgres에서는 테스트마다 새 파일을 만들 수 없다 — 서버 하나를 같이 쓴다. 그래서
    매번 비우고 시작한다. `alembic_version`까지 지워야 한다. 남아 있으면 다음 테스트가
    "이미 최신"으로 보고 테이블을 하나도 만들지 않는다.
    """
    Base.metadata.drop_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS alembic_version"))


def make_engine(sqlite_url: str = "sqlite:///:memory:", **sqlite_kwargs):
    """이 실행이 쓸 엔진. Postgres면 비워서 돌려준다.

    `sqlite_url`은 SQLite로 돌 때만 쓴다 (파일이 필요한 테스트가 경로를 넘긴다).
    """
    if TEST_DATABASE_URL:
        engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
        reset_database(engine)
        return engine
    kwargs = {"connect_args": {"check_same_thread": False}}
    kwargs.update(sqlite_kwargs)
    engine = create_engine(sqlite_url, **kwargs)
    _enforce_foreign_keys(engine)
    return engine


def _enforce_foreign_keys(engine) -> None:
    """SQLite 는 외래키를 **기본적으로 안 본다.** 연결마다 켜줘야 한다.

    안 켜면 두 실행이 서로 다른 것을 검사하게 되고, 그 차이가 CI 에서만 터진다.
    실제로 그랬다 — `macro_value` 를 넣으면서 `macro_series` 행을 안 만든 테스트가
    SQLite 에서는 통과하고 Postgres 에서만 실패했다. 그러면 여기서 아무리 돌려봐도
    소용이 없고, 올려봐야 아는 상태가 된다. 두 실행이 같은 것을 봐야 한다.
    """

    @event.listens_for(engine, "connect")
    def _on_connect(dbapi_connection, _record):  # pragma: no cover - 연결 훅
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def dispose(engine) -> None:
    """뒷정리. Postgres면 다음 테스트를 위해 비우고 나간다."""
    if TEST_DATABASE_URL:
        reset_database(engine)
    engine.dispose()
