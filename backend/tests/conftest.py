import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.models  # noqa: F401  (모든 테이블이 Base.metadata에 등록되도록)
from app.db import Base


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
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()
