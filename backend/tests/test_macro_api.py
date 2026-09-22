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
    for code in ("VIX", "DGS10", "DGS2", "FEARGREED"):
        _fill(SessionLocal, _series(code=code), [(dt.date(2026, 9, 21), 1.0)])

    body = client.get("/api/macro/pinned").json()

    assert body["codes"] == ["VIX", "TERM_SPREAD", "FEARGREED"]
    assert [card["code"] for card in body["series"]] == ["VIX", "TERM_SPREAD", "FEARGREED"]


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
    assert client.get("/api/macro/pinned").json()["codes"] == ["VIX", "TERM_SPREAD", "FEARGREED"]


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


# --- 홈에 올린 장단기 금리차 ------------------------------------------------


def test_the_spread_can_sit_on_the_home_row_like_any_indicator(api):
    """받아오는 지표가 아니라 계산값이지만, 홈에서는 지표 하나처럼 보여야 한다."""
    client, SessionLocal = api
    _fill(SessionLocal, _series(code="DGS10"), [
        (dt.date(2026, 9, 18), 4.05),
        (dt.date(2026, 9, 21), 4.11),
    ])
    _fill(SessionLocal, _series(code="DGS2"), [
        (dt.date(2026, 9, 18), 4.20),
        (dt.date(2026, 9, 21), 4.36),
    ])

    card = client.put("/api/macro/pinned", json={"codes": ["TERM_SPREAD"]}).json()["series"][0]

    assert card["code"] == "TERM_SPREAD"
    assert card["name"] == "장단기 금리차"
    assert card["unit"] == "percent"
    assert card["value"] == pytest.approx(-0.25)
    # 직전 값과의 차이도 온다 (-0.15 -> -0.25)
    assert card["change"] == pytest.approx(-0.10)
    assert card["as_of"] == "2026-09-21"
    # 계산값이라 발표일이 없다. 있는 척하면 "이 날 발표된 숫자"로 읽힌다
    assert card["released_at"] is None


def test_the_spread_only_subtracts_values_from_the_same_day(api):
    """어제 10년물과 그제 2년물을 뺀 것은 금리차가 아니라 아무 뜻 없는 숫자다."""
    client, SessionLocal = api
    _fill(SessionLocal, _series(code="DGS10"), [
        (dt.date(2026, 9, 18), 4.05),
        (dt.date(2026, 9, 21), 4.11),
    ])
    _fill(SessionLocal, _series(code="DGS2"), [(dt.date(2026, 9, 21), 4.36)])

    card = client.put("/api/macro/pinned", json={"codes": ["TERM_SPREAD"]}).json()["series"][0]

    assert card["value"] == pytest.approx(-0.25)
    assert card["change"] is None, "짝이 없는 날로 변화를 만들면 안 된다"


def test_the_spread_drops_out_when_one_leg_is_missing(api):
    """두 금리 중 하나가 없으면 금리차도 없다 — 0으로 보이면 안 된다."""
    client, SessionLocal = api
    _fill(SessionLocal, _series(code="DGS10"), [(dt.date(2026, 9, 21), 4.11)])

    body = client.put("/api/macro/pinned", json={"codes": ["TERM_SPREAD"]}).json()

    assert body["codes"] == ["TERM_SPREAD"], "고른 것 자체는 남는다"
    assert body["series"] == []


def test_the_spread_is_not_rejected_as_an_unknown_code(api):
    """`macro_series` 에 행이 없다고 400 을 주면 ☆ 를 누를 수가 없다."""
    client, _ = api
    assert client.put("/api/macro/pinned", json={"codes": ["TERM_SPREAD"]}).status_code == 200


# --- 홈에도 뜨는 국면 배지 ---------------------------------------------------


def test_the_home_row_carries_the_badges_too(api):
    client, SessionLocal = api
    _fill(SessionLocal, _series(code="VIX", unit="level"), [(dt.date(2026, 9, 21), 32.4)])

    body = client.get("/api/macro/pinned").json()

    assert [b["key"] for b in body["badges"]] == ["vix_fear"]


def test_badges_do_not_disappear_when_you_unpin_the_indicator(api):
    """VIX 를 홈에서 내렸다고 공포 구간 배지가 사라지면, 화면이 "조용하다"고 거짓말을 한다."""
    client, SessionLocal = api
    _fill(SessionLocal, _series(code="VIX", unit="level"), [(dt.date(2026, 9, 21), 32.4)])
    _fill(SessionLocal, _series(code="DFF"), [(dt.date(2026, 9, 21), 4.3)])

    body = client.put("/api/macro/pinned", json={"codes": ["DFF"]}).json()

    assert [card["code"] for card in body["series"]] == ["DFF"]
    assert [b["key"] for b in body["badges"]] == ["vix_fear"]


def test_turning_every_indicator_off_still_leaves_the_badges(api):
    """다 끈 것은 "숫자를 늘 보진 않겠다"이지 "이상한 일이 생겨도 알리지 말라"가 아니다."""
    client, SessionLocal = api
    _fill(SessionLocal, _series(code="VIX", unit="level"), [(dt.date(2026, 9, 21), 32.4)])

    body = client.put("/api/macro/pinned", json={"codes": []}).json()

    assert body["series"] == []
    assert [b["key"] for b in body["badges"]] == ["vix_fear"]


def test_home_and_the_macro_tab_say_the_same_badges(api):
    """둘은 읽는 범위가 다르다 — 매크로 탭은 전 지표, 홈은 규칙이 보는 것만
    (`regime.WATCHED_CODES`). 규칙을 늘리면서 그 목록을 잊으면 홈만 조용해진다."""
    client, SessionLocal = api
    _fill(SessionLocal, _series(code="VIX", unit="level"), [(dt.date(2026, 9, 21), 41.0)])
    _fill(SessionLocal, _series(code="FEARGREED", unit="level"), [(dt.date(2026, 9, 21), 8.0)])
    _fill(SessionLocal, _series(code="DGS10"), [(dt.date(2026, 9, 21), 4.11)])
    _fill(SessionLocal, _series(code="DGS2"), [(dt.date(2026, 9, 21), 4.46)])

    tab = client.get("/api/macro").json()["badges"]
    home = client.get("/api/macro/pinned").json()["badges"]

    assert [b["key"] for b in tab] == ["inverted_curve", "vix_fear", "fear_greed_extreme"]
    assert home == tab


# ---------------------------------------------------------------------------
#  예측치 (3a-4)
# ---------------------------------------------------------------------------
#
#  화면에서 "예상치 입력"을 눌렀을 때 실제로 오가는 것들. 저장되는 단위가 원본 지수가
#  아니라 **화면에 뜨는 전년비**라는 점이 여기서 한 번 더 확인된다.

AUG = dt.date(2026, 8, 1)


def _cpi_series(code="CPIAUCSL", name="CPI", order=70) -> MacroSeries:
    return MacroSeries(code=code, name=name, source="fred", source_code=code,
                       unit="index", transform="yoy", frequency="monthly",
                       display_order=order, active=True)


def _cpi_months(pct: float) -> list[tuple[dt.date, float]]:
    """전년비가 정확히 `pct` 가 되는 두 달치 지수."""
    return [(dt.date(2025, 8, 1), 100.0), (AUG, 100.0 * (1.0 + pct / 100.0))]


def test_typing_a_forecast_comes_back_on_the_card(api):
    client, SessionLocal = api
    _fill(SessionLocal, _cpi_series(), _cpi_months(3.2))

    card = client.put(
        "/api/macro/CPIAUCSL/forecast", json={"as_of": "2026-08-01", "value": 3.0}
    ).json()

    assert card["code"] == "CPIAUCSL"
    assert card["forecastable"] is True
    assert card["forecast"]["value"] == 3.0
    assert card["forecast"]["source_label"] == "직접 입력"
    assert card["forecast"]["surprise"] == pytest.approx(0.2)


def test_a_forecast_the_release_beat_raises_the_badge(api):
    client, SessionLocal = api
    _fill(SessionLocal, _cpi_series(), _cpi_months(3.2))
    client.put("/api/macro/CPIAUCSL/forecast", json={"as_of": "2026-08-01", "value": 3.0})

    badges = client.get("/api/macro").json()["badges"]

    assert [b["label"] for b in badges] == ["물가 상회"]
    assert "예상 3.0%" in badges[0]["detail"]


def test_the_badge_reaches_the_home_screen_too(api):
    """홈은 고른 지표만 읽는다. 물가를 안 골라도 이 배지는 떠야 한다."""
    client, SessionLocal = api
    _fill(SessionLocal, _cpi_series(), _cpi_months(3.2))
    client.put("/api/macro/CPIAUCSL/forecast", json={"as_of": "2026-08-01", "value": 3.0})
    client.put("/api/macro/pinned", json={"codes": []})

    home = client.get("/api/macro/pinned").json()

    assert home["series"] == []
    assert [b["label"] for b in home["badges"]] == ["물가 상회"]


def test_home_and_the_macro_tab_agree_about_the_price_badge(api):
    client, SessionLocal = api
    _fill(SessionLocal, _cpi_series(), _cpi_months(3.2))
    client.put("/api/macro/CPIAUCSL/forecast", json={"as_of": "2026-08-01", "value": 3.0})

    tab = client.get("/api/macro").json()["badges"]
    home = client.get("/api/macro/pinned").json()["badges"]

    assert [b["key"] for b in tab] == [b["key"] for b in home]
    assert [b["detail"] for b in tab] == [b["detail"] for b in home]


def test_erasing_the_forecast_turns_the_badge_off(api):
    """잘못 넣은 예상치 때문에 배지가 계속 떠 있으면 사용자가 끌 방법이 없다."""
    client, SessionLocal = api
    _fill(SessionLocal, _cpi_series(), _cpi_months(3.2))
    client.put("/api/macro/CPIAUCSL/forecast", json={"as_of": "2026-08-01", "value": 3.0})

    card = client.delete("/api/macro/CPIAUCSL/forecast?as_of=2026-08-01").json()

    assert card["forecast"] is None
    assert client.get("/api/macro").json()["badges"] == []


def test_a_daily_indicator_refuses_a_forecast(api):
    """VIX 에 "예상치"를 넣을 수 있게 두면 그 숫자가 무엇과 비교되는지 아무도 모른다."""
    client, SessionLocal = api
    _fill(SessionLocal, _series(), [(dt.date(2026, 9, 21), 4.11)])

    response = client.put("/api/macro/DGS10/forecast", json={"as_of": "2026-09-01", "value": 4.0})

    assert response.status_code == 400
    assert "예상치" in response.json()["detail"]


def test_a_code_that_does_not_exist_is_a_404(api):
    client, _ = api
    response = client.put("/api/macro/NOPE/forecast", json={"as_of": "2026-08-01", "value": 3.0})
    assert response.status_code == 404


def test_a_year_typed_wrong_is_refused(api):
    """2062 년 예상치는 지우기 전까지 "다음 발표 예상"으로 계속 떠 있게 된다."""
    client, SessionLocal = api
    _fill(SessionLocal, _cpi_series(), _cpi_months(3.2))

    response = client.put(
        "/api/macro/CPIAUCSL/forecast", json={"as_of": "2062-08-01", "value": 3.0}
    )

    assert response.status_code == 400


def test_a_value_with_the_decimal_point_lost_is_refused(api):
    """2.7 대신 270 을 넣는 실수. 27 은 못 막지만 그건 화면에 그대로 보인다."""
    client, SessionLocal = api
    _fill(SessionLocal, _cpi_series(), _cpi_months(3.2))

    response = client.put(
        "/api/macro/CPIAUCSL/forecast", json={"as_of": "2026-08-01", "value": 270.0}
    )

    assert response.status_code == 422


def test_next_months_forecast_is_kept_apart_from_this_months_result(api):
    client, SessionLocal = api
    _fill(SessionLocal, _cpi_series(), _cpi_months(3.2))
    client.put("/api/macro/CPIAUCSL/forecast", json={"as_of": "2026-08-01", "value": 3.0})
    card = client.put(
        "/api/macro/CPIAUCSL/forecast", json={"as_of": "2026-09-01", "value": 2.9}
    ).json()

    assert card["forecast"]["as_of"] == "2026-08-01"
    assert card["pending_forecast"]["as_of"] == "2026-09-01"
    assert card["pending_forecast"]["surprise"] is None
    # 아직 안 나온 달의 예상치로 배지를 띄우면 그건 예측이지 사실이 아니다
    assert len(client.get("/api/macro").json()["badges"]) == 1


def test_a_daily_card_says_it_takes_no_forecast(api):
    client, SessionLocal = api
    _fill(SessionLocal, _series(), [(dt.date(2026, 9, 21), 4.11)])

    card = client.get("/api/macro").json()["series"][0]

    assert card["forecastable"] is False
    assert card["forecast"] is None
    assert card["pending_forecast"] is None


def test_pressing_refresh_also_asks_for_the_forecast(api):
    """사람이 보기에 "지금 받아오기"는 이 화면에 뜨는 것 전부를 뜻한다.

    테스트에서는 바깥이 막혀 있으므로 예측치 쪽이 실패한다 — 그때 **지표 결과는
    그대로 가고** 예측치만 한 줄로 따로 온다. 하나가 다른 하나를 오류로 만들면 안 된다.
    """
    client, SessionLocal = api
    _fill(SessionLocal, _cpi_series(), _cpi_months(3.2))

    results = client.post("/api/macro/refresh").json()

    indicators = [r for r in results if r["code"] == "CPIAUCSL"]
    forecast = [r for r in results if r["code"] == "예측치"]
    assert len(indicators) == 1
    assert len(forecast) == 1 and forecast[0]["ok"] is False
    assert "직접 넣을 수 있습니다" in forecast[0]["hint"]
