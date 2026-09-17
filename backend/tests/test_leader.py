"""스케줄러를 누가 맡을지 (ROADMAP 5단계).

워커를 늘리거나 컨테이너를 둘 띄우면 갱신 job도 그 수만큼 생긴다. 여기서는 그게
실제로 막히는지 본다 — **Postgres에서만** 확인되는 동작이라 SQLite로만 돌리면
이 파일의 핵심 두 개는 건너뛴다.
"""

import pytest
from sqlalchemy import create_engine

from app.services.leader import SchedulerLock
from tests import dbsetup

postgres_only = pytest.mark.skipif(
    not dbsetup.on_postgres(), reason="어드바이저리 락은 Postgres에만 있다"
)


def test_sqlite_always_leads():
    """개인 PC는 파일 하나에 앱도 하나다 — 물어볼 필요가 없다."""
    engine = create_engine("sqlite:///:memory:")
    lock = SchedulerLock(engine)
    try:
        assert lock.acquire() is True
    finally:
        lock.release()
        engine.dispose()


@pytest.fixture()
def two_processes():
    """서로 다른 프로세스 둘. **엔진을 따로 만드는 게 핵심이다.**

    같은 엔진을 쓰면 커넥션 풀이 같아서, 앞사람이 돌려놓은 연결을 뒷사람이 그대로
    물려받을 수 있다. 어드바이저리 락은 연결(세션) 단위라 그 경우 "이미 내가 쥔 락"이
    되어 **무조건 성공한다** — 아무것도 검증하지 못하는 테스트가 된다.
    """
    engines = [create_engine(dbsetup.TEST_DATABASE_URL) for _ in range(2)]
    locks = [SchedulerLock(engine) for engine in engines]
    try:
        yield locks
    finally:
        for lock in locks:
            lock.release()
        for engine in engines:
            engine.dispose()


@postgres_only
def test_only_one_of_two_processes_gets_it(two_processes):
    first, second = two_processes
    assert first.acquire() is True
    assert second.acquire() is False


@postgres_only
def test_the_next_one_takes_over_when_the_holder_leaves(two_processes):
    """앞사람이 나가면 다음 사람이 이어받아야 한다.

    여기서 걸리면 자물쇠가 커넥션 풀에 돌아간 연결에 남아 있다는 뜻이고, 그 서버는
    **다시 띄운 뒤로 영영 시세를 갱신하지 않는다.**
    """
    first, second = two_processes
    assert first.acquire() is True
    first.release()
    assert second.acquire() is True


@postgres_only
def test_asking_twice_is_fine(two_processes):
    lock, _ = two_processes
    assert lock.acquire() is True
    assert lock.acquire() is True
