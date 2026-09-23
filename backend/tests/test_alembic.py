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
            r[0]
            for r in conn.execute(text("SELECT ticker FROM user_stock ORDER BY ticker")).fetchall()
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
        assert conn.execute(text("SELECT count(*) FROM user_stock")).scalar() == 3
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


# ---------------------------------------------------------------------------
#  한국어 윈도우에서 앱이 안 뜨던 자리
# ---------------------------------------------------------------------------
#
#  Alembic은 ini 파일을 **시스템 로케일 인코딩**으로 읽는다. 한국어 윈도우에서는
#  그게 cp949라, UTF-8로 저장된 한글 주석 한 줄이 UnicodeDecodeError가 되고
#  서버가 기동하다 죽는다. 리눅스와 CI는 UTF-8이라 **여기서는 영원히 안 잡힌다** —
#  실제로 그렇게 지나갔고 사용자 PC에서 처음 터졌다. 그래서 로케일을 흉내 낸다.


def _force_locale_encoding(monkeypatch, encoding: str) -> None:
    """Alembic이 ini를 읽을 때 쓰는 인코딩을 바꿔치기한다 (로케일 흉내)."""
    from alembic.util import compat

    real = compat.read_config_parser

    def read(file_config, file_argument):
        for name in file_argument:
            # 실제로 로케일 인코딩으로 읽어본다 — 못 읽으면 여기서 터진다
            with open(name, encoding=encoding) as fh:
                fh.read()
        return real(file_config, file_argument)

    monkeypatch.setattr(compat, "read_config_parser", read)


def test_startup_survives_a_korean_windows_locale(tmp_path, monkeypatch):
    """cp949 로케일에서도 DB가 최신 스키마로 올라가야 한다.

    앱이 ini를 아예 안 읽으므로 이 상황 자체가 생기지 않는다. 다시 읽기 시작하면
    여기서 걸린다 — 그때 증상은 "서버가 안 뜬다"이고, 원인은 주석 한 줄이다.
    """
    _force_locale_encoding(monkeypatch, "cp949")

    engine = create_engine(f"sqlite:///{tmp_path / 'korean.db'}")
    try:
        assert migrate.upgrade_to_head(engine) == _head()
    finally:
        engine.dispose()


def test_a_hand_entered_rate_survives_the_move_to_per_currency():
    """직접 넣은 환율은 다시 만들 수 없는 값이라 반드시 따라와야 한다 (0002).

    조회해온 시세는 잃어버려도 다시 받아오면 되지만, "내가 환전한 환율"은 사용자만
    아는 값이다. 옮기다 흘리면 비중이 조용히 달라진다.
    """
    import json

    from alembic import command

    engine = create_engine("sqlite://")  # 메모리
    with engine.begin() as conn:
        command.upgrade(migrate._config(conn), "0001")
        conn.execute(
            text(
                "INSERT INTO portfolio_settings"
                " (id, default_rebalance_band_pct, base_currency,"
                "  usd_krw_override, usd_krw_rate, usd_krw_updated_at)"
                " VALUES (1, 5.0, 'KRW', 1380.5, 1375.0, '2026-09-01 00:00:00')"
            )
        )

    migrate.upgrade_to_head(engine)

    with engine.connect() as conn:
        # 0005 이후 설정은 사용자별 표에 있다
        raw = conn.execute(text("SELECT fx_overrides FROM user_settings")).scalar()
        stored = conn.execute(
            text("SELECT krw_rate FROM fx_rate WHERE currency = 'USD'")
        ).scalar()
    engine.dispose()

    overrides = json.loads(raw) if isinstance(raw, str) else raw
    assert overrides == {"USD": 1380.5}
    # 조회해뒀던 값도 새 자리로 옮겨온다 (다음 갱신까지 그대로 쓸 수 있게)
    assert stored == 1375.0


def test_the_app_builds_its_migration_config_without_a_file():
    """설정을 코드에서 만든다 — 파일을 읽는 순간 위 문제가 돌아온다."""
    assert migrate._config(None).config_file_name is None


def test_the_ini_stays_ascii_for_the_command_line():
    """`alembic revision -m ...` 는 여전히 이 파일을 로케일로 읽는다.

    앱은 안 읽지만 명령줄은 읽으므로, 여기에 한글 주석을 넣으면 **한국어 윈도우에서
    새 리비전을 만들 수 없게 된다.** 설명은 app/migrate.py 에 한국어로 둔다.
    """
    migrate.ALEMBIC_INI.read_bytes().decode("ascii")
