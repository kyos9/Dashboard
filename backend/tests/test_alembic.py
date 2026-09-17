"""마이그레이션 자체를 검사한다.

여기서 지키려는 건 둘이다.

1. **쓰던 DB가 그대로 열린다.** Alembic을 모르는 파일이 도착해도 데이터를 잃지 않고
   이어받아야 한다. 이게 깨지면 사용자는 복구할 방법이 없다.
2. **모델과 마이그레이션이 벌어지지 않는다.** 모델에 컬럼을 추가하고 리비전을 안 만들면
   내 PC(테스트는 create_all로 만든다)에서는 멀쩡한데 서버에서만 터진다. 가장 늦게,
   가장 나쁜 자리에서 발견되는 종류라 자동으로 잡는다.
"""

import sqlite3

import pytest
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text

import app.models  # noqa: F401  (모든 테이블이 Base.metadata에 등록되도록)
from app import migrate
from app.db import Base

from tests import dbsetup
from tests.test_migration import OLD_ROWS, OLD_SCHEMA


@pytest.fixture()
def fresh(tmp_path):
    """비어 있는 DB를 마이그레이션으로 만들어 준다.

    **Postgres에서도 돈다** (`TEST_DATABASE_URL`). 여기가 이 파일에서 가장 중요한
    자리다 — `0001_initial.py`가 서버에서 쓸 DB에 실제로 적용되는지, 그리고 모델이
    그 DB가 보는 스키마와 같은지를 확인하는 곳이기 때문이다. SQLite만 돌리면 둘 다
    서버에서 처음 알게 된다.
    """
    engine = dbsetup.make_engine(f"sqlite:///{tmp_path / 'new.db'}")
    migrate.upgrade_to_head(engine)
    try:
        yield engine
    finally:
        dbsetup.dispose(engine)


@pytest.fixture()
def adopted(tmp_path):
    """Alembic을 모르는 옛 DB 파일을 이어받게 한 뒤 돌려준다.

    이쪽은 Postgres로 돌리지 않는다 — 일부러다. 이어받아야 하는 "옛 파일"은 언제나
    사용자 PC의 SQLite 파일이다. Postgres는 이 앱에서 서버용으로 새로 만드는 DB라
    Alembic 이전 상태가 존재할 수 없다.
    """
    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.executescript(OLD_SCHEMA)
    con.executescript(OLD_ROWS)
    con.commit()
    con.close()

    engine = create_engine(f"sqlite:///{path}")
    migrate.upgrade_to_head(engine)
    try:
        yield engine
    finally:
        engine.dispose()


def test_models_and_migrations_do_not_drift(fresh):
    """모델을 고치고 리비전을 안 만들면 여기서 걸린다.

    걸렸다면 답은 하나다 — `alembic revision --autogenerate -m "설명"`으로 리비전을
    만들고, 생성된 내용이 의도와 맞는지 눈으로 확인한 뒤 커밋한다.
    """
    with fresh.connect() as conn:
        context = MigrationContext.configure(conn)
        diff = compare_metadata(context, Base.metadata)

    assert diff == [], f"모델과 마이그레이션이 다릅니다: {diff}"


def test_fresh_database_lands_on_head(fresh):
    assert migrate.current_revision(fresh) == _head()


def test_old_database_is_adopted_not_rebuilt(adopted):
    """이미 테이블이 있는 파일에 0001을 실행하면 '이미 있다'에서 멈춘다 — 도장만 찍어야 한다."""
    assert migrate.current_revision(adopted) == _head()

    with adopted.connect() as conn:
        tickers = [
            r[0] for r in conn.execute(text("SELECT ticker FROM stocks ORDER BY ticker")).fetchall()
        ]
    assert tickers == ["005930.KS", "247540.KQ", "VOO"]


def test_adopted_database_gets_the_tables_it_never_had(adopted):
    """옛 파일에는 없던 테이블도 생겨야 한다 — 0001을 건너뛰기 때문에 놓치기 쉽다."""
    tables = set(inspect(adopted).get_table_names())
    assert {"krx_listing", "alembic_version"} <= tables


def test_running_again_is_a_no_op(adopted):
    """앱을 켤 때마다 도는 경로다. 두 번째부터는 아무 일도 일어나지 않아야 한다."""
    before = migrate.current_revision(adopted)
    for _ in range(3):
        migrate.upgrade_to_head(adopted)
    assert migrate.current_revision(adopted) == before

    with adopted.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM stocks")).scalar() == 3
        assert conn.execute(text("SELECT count(*) FROM holding")).scalar() == 2


def test_adoption_runs_only_once(adopted, monkeypatch):
    """`alembic_version`이 남은 뒤에는 옛 경로를 다시 타면 안 된다.

    다시 탄다고 당장 깨지지는 않지만, 끝난 코드가 매번 도는 건 나중에 그 코드를 지울 때
    무엇이 안전한지 알 수 없게 만든다.
    """
    called = []
    monkeypatch.setattr(migrate, "adopt_pre_alembic_database", lambda bind: called.append(bind))
    migrate.upgrade_to_head(adopted)
    assert called == []


def _head() -> str:
    from alembic.script import ScriptDirectory

    return ScriptDirectory(str(migrate.SCRIPT_LOCATION)).get_current_head()
