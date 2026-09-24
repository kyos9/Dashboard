"""등록 뒤 시세 받기가 **정말 뒤에서** 도는지 — 스레드를 그대로 쓴다.

다른 테스트는 편하게 확인하려고 이 일을 그 자리에서 돌린다(conftest). 여기서는 받는 일을
붙잡아 두고, 그동안 등록 응답이 이미 나갔는지와 화면이 "받는 중"을 볼 수 있는지 본다.
서버에서 TSM 하나 등록에 13초가 걸리던 것이 이 구조 때문에 사라진다.
"""

import threading

import pytest

from app.services import backfill, data_ingestion


@pytest.fixture()
def held(api, monkeypatch):
    """받는 일을 `release`가 켜질 때까지 붙잡아 둔다."""
    release = threading.Event()
    entered = threading.Event()
    finished = threading.Event()
    calls: list[str] = []
    outcome: dict = {"raise": None}

    def slow(db, stock, full_backfill=False):
        calls.append(stock.ticker)
        entered.set()
        release.wait(5)
        try:
            if outcome["raise"] is not None:
                raise outcome["raise"]
            return {}
        finally:
            finished.set()

    monkeypatch.setattr("app.routers.stocks.refresh_and_evaluate_stock", slow)
    monkeypatch.setattr(backfill, "RUNNER", backfill._in_thread)  # 진짜 스레드
    return release, entered, finished, calls, outcome


def _status(client, ticker):
    return next(s for s in client.get("/api/stocks").json() if s["ticker"] == ticker)["data_status"]


def _wait_cleared(client, ticker):
    for _ in range(50):
        if _status(client, ticker) != "loading":
            return
        threading.Event().wait(0.05)


def test_registration_answers_before_the_prices_arrive(api, held):
    client, _ = api
    release, entered, finished, calls, _ = held

    body = client.post("/api/stocks", json={"ticker": "TSM"}).json()
    assert body["data_pending"] is True
    assert entered.wait(2)  # 받기는 시작됐고, 아직 안 끝났는데 응답은 이미 왔다

    assert _status(client, "TSM") == "loading"
    card = next(c for c in client.get("/api/dashboard").json() if c["ticker"] == "TSM")
    assert card["data_status"] == "loading"

    release.set()
    assert finished.wait(2)
    _wait_cleared(client, "TSM")
    assert _status(client, "TSM") is None
    assert calls == ["TSM"]


def test_a_failure_shows_up_with_its_hint(api, held):
    client, _ = api
    release, entered, finished, _, outcome = held
    outcome["raise"] = data_ingestion.DataIngestionError("no data", hint="티커를 확인해주세요.")

    client.post("/api/stocks", json={"ticker": "ZZZZ"})
    release.set()
    assert finished.wait(2)
    _wait_cleared(client, "ZZZZ")
    (row,) = client.get("/api/stocks").json()
    assert (row["data_status"], row["data_hint"]) == ("failed", "티커를 확인해주세요.")


def test_an_unexpected_error_does_not_leave_it_loading_forever(api, held):
    """받는 일이 예상 못 한 예외로 죽어도 "받는 중"이 영원히 남으면 화면이 계속 기다린다."""
    client, _ = api
    release, entered, finished, _, outcome = held
    outcome["raise"] = RuntimeError("disk full")

    client.post("/api/stocks", json={"ticker": "VOO"})
    release.set()
    assert finished.wait(2)
    _wait_cleared(client, "VOO")
    assert _status(client, "VOO") == "failed"


def test_manual_refresh_clears_an_old_failure(api, monkeypatch):
    client, _ = api
    backfill.fail("VOO", hint="예전 실패", error="x")
    client.post("/api/stocks", json={"ticker": "VOO"})  # conftest: 바로 성공
    backfill.fail("VOO", hint="예전 실패", error="x")
    assert _status(client, "VOO") == "failed"
    assert client.post("/api/stocks/VOO/refresh").status_code == 200
    assert _status(client, "VOO") is None


def test_the_same_ticker_is_not_fetched_twice_at_once():
    ran: list[int] = []
    gate = threading.Event()
    done = threading.Event()

    def work():
        ran.append(1)
        gate.wait(2)
        done.set()

    backfill.reset()
    try:
        assert backfill.start("VOO", work) is True
        assert backfill.start("VOO", work) is False  # 받는 중이면 또 시작하지 않는다
        gate.set()
        assert done.wait(2)
        assert ran == [1]
    finally:
        backfill.reset()
