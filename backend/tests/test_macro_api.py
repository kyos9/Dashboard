"""매크로 API — 화면이 실제로 부르는 주소들."""

import datetime as dt

import pytest

from app.models import MacroSeries, MacroValue


def _series(**kwargs) -> MacroSeries:
    base = dict(code="DGS10", name="미 10년물 금리", source="fred", source_code="DGS10",
                unit="percent", transform="none", frequency="daily",
                display_order=10, active=True)
    return MacroSeries(**{**base, **kwargs})


def _fill(SessionLocal, series: MacroSeries, values: list[tuple[dt.date, float]]):
    with SessionLocal() as db:
        db.add(series)
        for as_of, value in values:
            db.add(MacroValue(code=series.code, as_of=as_of, value=value, source="fred_api"))
        db.commit()


def test_the_list_carries_everything_one_card_needs(api):
    client, SessionLocal = api
    _fill(SessionLocal, _series(note="장기 금리의 기준"), [
        (dt.date(2026, 9, 18), 4.05),
        (dt.date(2026, 9, 21), 4.11),
    ])

    body = client.get("/api/macro").json()

    assert len(body["series"]) == 1
    card = body["series"][0]
    assert card["code"] == "DGS10"
    assert card["name"] == "미 10년물 금리"
    assert card["note"] == "장기 금리의 기준"
    assert card["value"] == 4.11
    assert card["change"] == pytest.approx(0.06)
    assert card["as_of"] == "2026-09-21"
    assert card["source"] == "fred_api"
    assert card["unit"] == "percent"


def test_an_indicator_that_failed_says_why_on_the_card(api):
    """화면이 "값 없음"만 띄우면 사용자는 다음에 뭘 할지 모른다."""
    client, SessionLocal = api
    _fill(SessionLocal, _series(code="DGS2", last_error="FRED 가 막혔습니다"), [])

    card = client.get("/api/macro").json()["series"][0]

    assert card["value"] is None
    assert card["last_error"] == "FRED 가 막혔습니다"
    assert card["stale"] is True


def test_the_spread_comes_down_separately(api):
    client, SessionLocal = api
    _fill(SessionLocal, _series(code="DGS10"), [(dt.date(2026, 9, 21), 4.11)])
    _fill(SessionLocal, _series(code="DGS2", name="미 2년물 금리"), [(dt.date(2026, 9, 21), 4.36)])

    body = client.get("/api/macro").json()

    assert body["term_spread"]["value"] == -0.25
    assert body["term_spread"]["as_of"] == "2026-09-21"
    assert {card["code"] for card in body["series"]} == {"DGS10", "DGS2"}


def test_the_chart_asks_for_one_indicator(api):
    client, SessionLocal = api
    today = dt.date.today()
    _fill(SessionLocal, _series(), [
        (today - dt.timedelta(days=3), 4.05),
        (today, 4.11),
    ])

    body = client.get("/api/macro/DGS10?range=1y").json()

    assert body["code"] == "DGS10"
    assert body["unit"] == "percent"
    assert [p["value"] for p in body["points"]] == [4.05, 4.11]


def test_the_chart_cuts_at_the_range_you_picked(api):
    client, SessionLocal = api
    today = dt.date.today()
    _fill(SessionLocal, _series(), [
        (today - dt.timedelta(days=800), 3.0),
        (today, 4.11),
    ])

    points = client.get("/api/macro/DGS10?range=1y").json()["points"]

    assert [p["value"] for p in points] == [4.11]


def test_an_indicator_we_do_not_have_is_a_404_not_an_empty_chart(api):
    """빈 차트를 돌려주면 "값이 아직 안 들어왔다"로 읽힌다. 오타는 오타라고 해야 한다."""
    client, _ = api
    assert client.get("/api/macro/NOPE").status_code == 404


def test_a_range_we_do_not_know_is_refused(api):
    client, SessionLocal = api
    _fill(SessionLocal, _series(), [(dt.date.today(), 4.11)])
    assert client.get("/api/macro/DGS10?range=3000y").status_code == 400


def test_pressing_refresh_does_not_ask_whether_it_is_time(api, monkeypatch):
    """배치는 "받을 때가 됐는지"를 따지지만 사람이 누른 것은 따지지 않는다.
    눌렀는데 "아직 받을 때가 아님"만 돌아오면 그건 고장으로 보인다."""
    client, SessionLocal = api
    _fill(SessionLocal, _series(last_checked_at=dt.datetime.utcnow()), [])

    asked = {}

    def fake_fetch(code, source, source_code=None, fallback_source=None, fallback_code=None,
                   start=None, want_release_dates=False):
        asked["code"] = code
        from app.services.providers.macro_base import MacroPoint
        return [MacroPoint(as_of=dt.date(2026, 9, 21), value=4.11)], "fred_api"

    monkeypatch.setattr("app.services.macro.fetch_macro_points", fake_fetch)

    body = client.post("/api/macro/refresh").json()

    assert asked["code"] == "DGS10", "방금 받았다는 이유로 건너뛰면 안 된다"
    assert body[0]["ok"] is True
    assert body[0]["provider"] == "fred_api"
