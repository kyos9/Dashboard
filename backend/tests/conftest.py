import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.main as main_module
import app.models  # noqa: F401  (모든 테이블이 Base.metadata에 등록되도록)
from app.db import Base, get_db
from tests import dbsetup


@pytest.fixture(autouse=True)
def isolated_backup_dir(tmp_path, monkeypatch):
    """마이그레이션 경로를 타는 테스트가 실제 backups/ 폴더를 더럽히지 않게.

    끄는 게 아니라 **옮기는 것**이 중요하다. 백업을 꺼두고 테스트하면 정작 백업이
    안 되는 상태를 못 잡는다.
    """
    from app.services import backup

    monkeypatch.setattr(backup, "BACKUP_DIR", tmp_path / "backups")


@pytest.fixture(autouse=True)
def isolated_session_key(tmp_path, monkeypatch):
    """세션 서명 키를 저장소가 아니라 임시 폴더에 만든다.

    비워두면 테스트가 backend/session.key 를 만들어놓고 간다 — 커밋될 수도 있고,
    무엇보다 테스트가 남긴 키로 실제 서버가 서명하게 된다.
    """
    from app.services import auth

    monkeypatch.setattr(auth, "KEY_FILE", tmp_path / "session.key")
    auth.reset_key_cache()
    auth.reset_throttle()
    yield
    auth.reset_key_cache()
    auth.reset_throttle()


@pytest.fixture(autouse=True)
def block_network(monkeypatch):
    """테스트가 실수로 바깥 네트워크를 쓰지 못하게 막는다.

    막지 않으면 종목 검색처럼 "로컬에 없으면 온라인 조회"로 넘어가는 경로가 조용히
    실제 요청을 보낸다. 테스트가 느려지고 네트워크 상태에 따라 결과가 흔들린다.
    바깥을 호출해야 하는 테스트는 각자 requests.get을 가짜로 바꿔 쓴다.
    """
    import requests

    def blocked(*args, **kwargs):
        raise AssertionError(
            "테스트에서 실제 네트워크를 호출했습니다. 가짜 응답을 주입하거나 "
            "allow_network=False로 호출하세요."
        )

    for name in ("get", "post", "request"):
        monkeypatch.setattr(requests, name, blocked)


@pytest.fixture()
def db_session():
    """빈 DB에 붙은 세션. 어느 DB인지는 `tests/dbsetup.py`가 정한다."""
    engine = dbsetup.make_engine()
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()
        dbsetup.dispose(engine)


@pytest.fixture()
def api(monkeypatch):
    """API를 부를 수 있는 클라이언트 + 같은 DB를 보는 세션 팩토리.

    실제 `app.main.app`을 그대로 쓴다 — 미들웨어까지 붙은 진짜 앱이어야 잠금 같은
    것이 실제로 동작하는지 확인할 수 있다.
    """
    monkeypatch.setenv("SIGNAL_DASHBOARD_DISABLE_SCHEDULER", "1")
    # 리프레시(yfinance) 호출은 네트워크가 필요하므로 종목 생성 시 자동 백필은 막아둔다.
    monkeypatch.setattr(
        "app.routers.stocks.refresh_and_evaluate_stock", lambda db, stock, full_backfill=False: {}
    )

    # 메모리 SQLite는 연결마다 DB가 따로 생기므로 StaticPool로 하나를 붙들어야 한다
    # (Postgres로 돌 때는 서버가 하나라 해당 없다).
    engine = dbsetup.make_engine(poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    main_module.app.dependency_overrides[get_db] = override_get_db
    with TestClient(main_module.app) as client:
        yield client, TestingSessionLocal
    main_module.app.dependency_overrides.clear()
    dbsetup.dispose(engine)
