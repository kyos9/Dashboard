"""느린 요청 기록 (ROADMAP 8-5).

지키려는 것은 둘이다.

1. **개인 정보가 없다.** 적는 것은 경로의 틀 · 방법 · 상태 코드 · 걸린 시간뿐이다. 실제
   주소(누가 무슨 종목을 담았는지), 쿼리 문자열, 사람은 적지 않는다.
2. **주인이 볼 수 있다.** 로그 파일에 경고로 한 줄, 진단 화면이 읽는 모음에 한 건.

느린 요청을 진짜로 만들 수는 없으니 문턱을 0 으로 낮춰 모든 요청이 느린 것으로 잡히게 한다.
"""

import logging

import pytest

from app import slow_requests
from app.services.users import LOCAL_USER_ID


@pytest.fixture(autouse=True)
def fresh_stats():
    slow_requests.reset()
    yield
    slow_requests.reset()


@pytest.fixture()
def everything_is_slow(monkeypatch):
    monkeypatch.setattr(slow_requests, "threshold_ms", lambda: 0)


def _slow_lines(caplog) -> list[str]:
    return [r.getMessage() for r in caplog.records if r.name == "app.slow"]


def test_records_route_template_not_the_real_address(api, everything_is_slow, caplog):
    client, _ = api
    caplog.set_level(logging.WARNING, logger="app.slow")

    client.get("/api/history/SECRETX9", params={"range": "1y", "memo": "private-note"})

    lines = _slow_lines(caplog)
    assert len(lines) == 1
    line = lines[0]
    assert "GET /api/history/{ticker}" in line
    assert "ms" in line
    # 누가 무엇을 담았는지·쿼리는 남지 않는다
    assert "SECRETX9" not in line
    assert "private-note" not in line
    assert "range" not in line

    _, items = slow_requests.snapshot()
    assert [(i.method, i.route) for i in items] == [("GET", "/api/history/{ticker}")]
    assert "SECRETX9" not in repr(items)


def test_no_person_in_the_record(api, everything_is_slow, caplog):
    """세션·이메일·요청 내용은 적지 않는다 — 기록에 사람을 가리킬 것이 없다."""
    client, Session = api
    from app.models import User

    with Session() as db:
        email = db.get(User, LOCAL_USER_ID).email
    caplog.set_level(logging.WARNING, logger="app.slow")

    client.put("/api/stocks/SECRETX9", json={"name": "내 비밀 종목"})

    text = "\n".join(_slow_lines(caplog)) + repr(slow_requests.snapshot())
    assert "PUT /api/stocks/{ticker}" in text
    assert "내 비밀 종목" not in text
    if email:
        assert email not in text
    assert "cookie" not in text.lower()


def test_unrouted_requests_are_bucketed_without_the_address(api, everything_is_slow, caplog):
    """라우터에 닿지 않은 요청(없는 주소·문지기의 401·화면 파일)은 큰 갈래만 — 주소를 그대로 쓰지 않는다."""
    client, _ = api
    caplog.set_level(logging.WARNING, logger="app.slow")

    client.get("/api/nope/SECRETX9")
    client.get("/assets/SECRETX9-abc123.js")
    client.get("/SECRETX9/page")

    text = "\n".join(_slow_lines(caplog))
    assert "SECRETX9" not in text
    routes = {i.route for i in slow_requests.snapshot()[1]}
    assert slow_requests.UNKNOWN_API in routes
    assert slow_requests.ASSETS in routes
    assert slow_requests.OTHER in routes
    assert not any(":path}" in r for r in routes)


def test_fast_requests_are_not_recorded(api, caplog):
    """문턱(1초) 아래는 적지 않는다 — 매 요청을 적으면 경고가 묻힌다."""
    client, _ = api
    caplog.set_level(logging.WARNING, logger="app.slow")
    client.get("/api/health")
    assert _slow_lines(caplog) == []
    assert slow_requests.snapshot()[1] == []


def test_ai_requests_are_skipped(api, everything_is_slow, caplog):
    """AI 에 걸린 시간은 바깥 AI 회사의 시간이다 — 우리 서버의 느린 곳을 가린다."""
    client, _ = api
    caplog.set_level(logging.WARNING, logger="app.slow")
    client.get("/api/ai/context/VOO")
    assert _slow_lines(caplog) == []


def test_collects_count_max_and_last(api, everything_is_slow):
    client, _ = api
    for _ in range(3):
        client.get("/api/health")
    client.get("/api/history/VOO")

    _, items = slow_requests.snapshot()
    by_route = {(i.method, i.route): i for i in items}
    health = by_route[("GET", "/api/health")]
    assert health.count == 3
    assert health.last_status == 200
    assert health.max_ms >= health.last_ms >= 0
    assert health.last_at is not None
    # 자주 느렸던 것이 앞
    assert items[0].route == "/api/health"


def test_owner_reads_the_collection(api, everything_is_slow):
    client, _ = api
    client.get("/api/history/VOO")

    body = client.get("/api/logs/slow").json()
    assert body["threshold_ms"] == 0
    assert body["since"]
    routes = [(i["method"], i["route"]) for i in body["items"]]
    assert ("GET", "/api/history/{ticker}") in routes
    assert set(body["items"][0]) == {"method", "route", "count", "max_ms", "last_ms", "last_status", "last_at"}


def test_a_broken_record_never_breaks_the_response(api, everything_is_slow, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("기록 실패")

    monkeypatch.setattr(slow_requests, "record", boom)
    client, _ = api
    assert client.get("/api/health").status_code == 200


@pytest.mark.parametrize(
    ("raw", "expected"),
    [(None, 1000), ("", 1000), ("2500", 2500), ("abc", 1000), ("0", 1000), ("-5", 1000)],
)
def test_threshold_from_environment(monkeypatch, raw, expected):
    if raw is None:
        monkeypatch.delenv("SIGNAL_DASHBOARD_SLOW_MS", raising=False)
    else:
        monkeypatch.setenv("SIGNAL_DASHBOARD_SLOW_MS", raw)
    assert slow_requests.threshold_ms() == expected
