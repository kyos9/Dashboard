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


# --- 국면 배지 --------------------------------------------------------------


def test_the_badge_row_comes_down_with_the_cards(api):
    """배지와 카드가 **같은 값**을 보고 판정한다 — 따로 읽으면 언젠가 둘이 다른 말을 한다."""
    client, SessionLocal = api
    _fill(SessionLocal, _series(code="DGS10"), [(dt.date(2026, 9, 21), 4.11)])
    _fill(SessionLocal, _series(code="DGS2"), [(dt.date(2026, 9, 21), 4.36)])

    body = client.get("/api/macro").json()

    assert [b["key"] for b in body["badges"]] == ["inverted_curve"]
    assert body["badges"][0]["as_of"] == "2026-09-21"


def test_a_quiet_market_sends_an_empty_badge_row(api):
    client, SessionLocal = api
    _fill(SessionLocal, _series(code="VIX", unit="level"), [(dt.date(2026, 9, 21), 15.0)])

    assert client.get("/api/macro").json()["badges"] == []


def test_the_card_says_which_band_the_score_is_in(api):
    """사용자가 물은 것이 이것이다 — 33.7이 어느 구간인지 화면이 말해야 한다."""
    client, SessionLocal = api
    _fill(SessionLocal, _series(code="FEARGREED", source="cnn", unit="level"),
          [(dt.date(2026, 9, 21), 33.7143)])

    card = client.get("/api/macro").json()["series"][0]

    assert card["zone"]["label"] == "공포"
    assert card["zone"]["range"] == "25~44"
    assert card["zone"]["extreme"] is False


def test_an_indicator_without_a_published_band_has_no_zone(api):
    client, SessionLocal = api
    _fill(SessionLocal, _series(), [(dt.date(2026, 9, 21), 4.11)])
    assert client.get("/api/macro").json()["series"][0]["zone"] is None


# --- 홈 즐겨찾기 ------------------------------------------------------------


def test_untouched_settings_show_the_default_three(api):
    client, SessionLocal = api
    for code in ("VIX", "DGS10", "PCEPILFE"):
        _fill(SessionLocal, _series(code=code), [(dt.date(2026, 9, 21), 1.0)])

    body = client.get("/api/macro/pinned").json()

    assert body["codes"] == ["VIX", "DGS10", "PCEPILFE"]
    assert [card["code"] for card in body["series"]] == ["VIX", "DGS10", "PCEPILFE"]


def test_pinned_cards_come_back_in_the_order_you_picked(api):
    """`IN` 질의가 돌려주는 순서에는 아무 의미가 없다."""
    client, SessionLocal = api
    for code, order in (("DGS10", 10), ("VIX", 20), ("DFF", 30)):
        _fill(SessionLocal, _series(code=code, display_order=order), [(dt.date(2026, 9, 21), 1.0)])

    body = client.put("/api/macro/pinned", json={"codes": ["DFF", "DGS10"]}).json()

    assert body["codes"] == ["DFF", "DGS10"]
    assert [card["code"] for card in body["series"]] == ["DFF", "DGS10"]


def test_turning_everything_off_stays_off(api):
    """`[]` 는 "일부러 다 껐다"이지 "기본값으로 돌려달라"가 아니다.
    껐는데 기본값이 다시 뜨는 화면은 설정이 아니라 고장으로 보인다."""
    client, SessionLocal = api
    _fill(SessionLocal, _series(code="VIX"), [(dt.date(2026, 9, 21), 15.0)])

    assert client.put("/api/macro/pinned", json={"codes": []}).json()["codes"] == []
    assert client.get("/api/macro/pinned").json()["codes"] == []


def test_a_code_that_does_not_exist_is_refused(api):
    """조용히 버리면 별을 눌렀는데 홈에 안 뜨는 이유를 알 수 없다."""
    client, SessionLocal = api
    _fill(SessionLocal, _series(code="VIX"), [(dt.date(2026, 9, 21), 15.0)])

    response = client.put("/api/macro/pinned", json={"codes": ["VIX", "NOPE"]})

    assert response.status_code == 400
    assert "NOPE" in response.json()["detail"]
    # 하나가 틀렸다고 나머지를 저장해버리면 사용자가 고른 것과 저장된 것이 달라진다
    assert client.get("/api/macro/pinned").json()["codes"] == ["VIX", "DGS10", "PCEPILFE"]


def test_the_same_code_twice_is_stored_once(api):
    client, SessionLocal = api
    _fill(SessionLocal, _series(code="VIX"), [(dt.date(2026, 9, 21), 15.0)])
    assert client.put("/api/macro/pinned", json={"codes": ["VIX", "vix"]}).json()["codes"] == ["VIX"]


def test_an_indicator_turned_off_drops_out_of_the_home_row(api):
    """지표를 끄고 나서 홈이 통째로 비는 것보다, 그것만 사라지는 쪽이 덜 놀랍다."""
    client, SessionLocal = api
    _fill(SessionLocal, _series(code="VIX"), [(dt.date(2026, 9, 21), 15.0)])
    _fill(SessionLocal, _series(code="DFF", active=False), [(dt.date(2026, 9, 21), 4.3)])

    client.put("/api/macro/pinned", json={"codes": ["VIX", "DFF"]})
    body = client.get("/api/macro/pinned").json()

    assert body["codes"] == ["VIX", "DFF"], "고른 것 자체는 남아 있어야 한다"
    assert [card["code"] for card in body["series"]] == ["VIX"]


def test_the_macro_tab_knows_which_stars_are_lit(api):
    client, SessionLocal = api
    _fill(SessionLocal, _series(code="VIX"), [(dt.date(2026, 9, 21), 15.0)])

    client.put("/api/macro/pinned", json={"codes": ["VIX"]})

    assert client.get("/api/macro").json()["pinned"] == ["VIX"]


def test_pinned_is_not_read_as_an_indicator_code(api):
    """`/{code}` 가 먼저 등록돼 있으면 `/pinned` 가 "PINNED 라는 지표"로 잡혀 404 가 된다."""
    client, _ = api
    assert client.get("/api/macro/pinned").status_code == 200
