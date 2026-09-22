"""포트폴리오 설정 한 줄을 만드는 자리.

처음 켠 사람만 겪는 오류였다. 대시보드는 열리면서 여러 API를 동시에 부르는데, DB가
비어 있으면 그 요청들이 전부 "설정이 없네, 만들자"에 도착한다. 먼저 넣은 하나만
성공하고 나머지는 `UNIQUE constraint failed`로 500이 난다.
"""

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import PortfolioSettings
from app.services.settings import SINGLETON_ID, get_settings
from tests.factories import make_settings


def test_creates_the_row_when_there_is_none(db_session):
    settings = get_settings(db_session)
    assert settings.id == SINGLETON_ID
    assert db_session.query(PortfolioSettings).count() == 1


def test_returns_the_same_row_next_time(db_session):
    first = get_settings(db_session)
    first.default_rebalance_band_pct = 7.5
    db_session.commit()

    assert get_settings(db_session).default_rebalance_band_pct == 7.5
    assert db_session.query(PortfolioSettings).count() == 1


def test_losing_the_race_is_not_an_error(db_session, monkeypatch):
    """다른 요청이 먼저 넣은 뒤 도착한 요청을 재현한다.

    "설정이 없다"를 보고 들어왔는데 넣으려는 순간 이미 있는 상황이다. 먼저 넣은 쪽이
    넣어준 행을 읽으면 그만이지, 사용자에게 500을 보여줄 일이 아니다.
    """
    make_settings(db_session, default_rebalance_band_pct=3.0)

    real_get = db_session.get
    seen = []

    def blind_first_look(model, pk):
        seen.append(pk)
        return None if len(seen) == 1 else real_get(model, pk)

    monkeypatch.setattr(db_session, "get", blind_first_look)

    settings = get_settings(db_session)
    assert settings.default_rebalance_band_pct == 3.0  # 먼저 넣은 쪽 값이 살아 있다
    assert db_session.query(PortfolioSettings).count() == 1


def test_other_integrity_errors_are_not_swallowed(db_session, monkeypatch):
    """중복이 아닌 문제까지 조용히 넘기면 진짜 고장을 못 보게 된다."""
    def boom():
        raise IntegrityError("NOT NULL 위반", None, Exception())

    monkeypatch.setattr(db_session, "get", lambda model, pk: None)
    monkeypatch.setattr(db_session, "commit", boom)

    with pytest.raises(IntegrityError):
        get_settings(db_session)


def test_first_screen_load_does_not_500(api):
    """빈 DB에서 화면이 부르는 API들이 모두 성공해야 한다."""
    client, _ = api
    for path in ("/api/rebalance/settings", "/api/rebalance/current", "/api/dashboard"):
        assert client.get(path).status_code == 200, path

    # 여러 번 불려도 설정은 한 줄뿐이다
    for _ in range(3):
        client.get("/api/rebalance/settings")
    assert client.get("/api/rebalance/settings").json()["default_rebalance_band_pct"] == 5.0
