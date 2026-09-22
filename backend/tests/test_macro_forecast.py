"""예측치 — 넣고, 고르고, 화면에 붙이는 길.

예상치가 없으면 "CPI 3.1%" 가 좋은 숫자인지 나쁜 숫자인지 알 수 없다. 여기서 확인하는
것은 **어느 예상치를 쓰느냐**다 — 같은 달에 여러 줄이 쌓이고(나우캐스트는 매일 바뀐다),
사람이 넣은 것과 받아온 것이 섞이며, 아직 안 나온 달의 예상치도 같이 들어 있다.
"""

import datetime as dt

import pytest
from sqlalchemy import event, select

from app.models import MacroForecast, MacroSeries, MacroValue
from app.services import macro

AUG = dt.date(2026, 8, 1)
SEP = dt.date(2026, 9, 1)
OCT = dt.date(2026, 10, 1)


def _cpi(**kwargs) -> MacroSeries:
    """월간 물가 지표 하나. 저장은 지수, 화면은 전년비다."""
    base = dict(code="CPIAUCSL", name="CPI", source="fred", source_code="CPIAUCSL",
                unit="index", transform="yoy", frequency="monthly",
                display_order=70, active=True)
    return MacroSeries(**{**base, **kwargs})


def _rate() -> MacroSeries:
    return MacroSeries(code="DGS10", name="미 10년물 금리", source="fred", source_code="DGS10",
                       unit="percent", transform="none", frequency="daily",
                       display_order=10, active=True)


def _fill_cpi(db, series: MacroSeries, months: dict[dt.date, float]):
    db.add(series)
    for as_of, value in months.items():
        db.add(MacroValue(code=series.code, as_of=as_of, value=value, source="fred_api"))
    db.commit()


def _cpi_at(pct: float) -> dict:
    """전년비가 정확히 `pct` 가 되는 두 달치 지수. 100 -> 100*(1+pct/100)."""
    return {dt.date(2025, 8, 1): 100.0, AUG: 100.0 * (1.0 + pct / 100.0)}


def _card(db, code="CPIAUCSL") -> dict:
    series = db.get(MacroSeries, code)
    return macro.attach_forecasts(db, [macro.snapshot(db, series)])[0]


# ---------------------------------------------------------------------------
#  어느 달의 예상치인가
# ---------------------------------------------------------------------------


def test_any_day_of_the_month_lands_on_the_month(api):
    """값은 그 달 1일로 저장된다. 정규화하지 않으면 영영 짝이 안 맞는다."""
    _, SessionLocal = api
    with SessionLocal() as db:
        _fill_cpi(db, _cpi(), _cpi_at(3.2))
        macro.set_forecast(db, "CPIAUCSL", dt.date(2026, 8, 15), 3.0)

        row = db.scalars(select(MacroForecast)).one()
        assert row.as_of == AUG
        assert _card(db)["forecast"]["value"] == 3.0


def test_entering_it_again_the_same_day_overwrites(api):
    """오타를 고치는 길이 그것뿐이다."""
    _, SessionLocal = api
    with SessionLocal() as db:
        _fill_cpi(db, _cpi(), _cpi_at(3.2))
        macro.set_forecast(db, "CPIAUCSL", AUG, 30.0, forecast_date=dt.date(2026, 9, 10))
        macro.set_forecast(db, "CPIAUCSL", AUG, 3.0, forecast_date=dt.date(2026, 9, 10))

        assert len(db.scalars(select(MacroForecast)).all()) == 1
        assert _card(db)["forecast"]["value"] == 3.0


def test_a_new_day_stacks_a_new_row_and_the_newest_wins(api):
    """나우캐스트는 매일 바뀐다. 덮어쓰면 발표 직전에 무엇을 예상했는지가 사라진다."""
    _, SessionLocal = api
    with SessionLocal() as db:
        _fill_cpi(db, _cpi(), _cpi_at(3.2))
        macro.set_forecast(db, "CPIAUCSL", AUG, 2.8, forecast_date=dt.date(2026, 9, 5))
        macro.set_forecast(db, "CPIAUCSL", AUG, 3.0, forecast_date=dt.date(2026, 9, 10))

        assert len(db.scalars(select(MacroForecast)).all()) == 2
        forecast = _card(db)["forecast"]
        assert forecast["value"] == 3.0
        assert forecast["forecast_date"] == dt.date(2026, 9, 10)


def test_what_a_person_typed_beats_what_we_fetched(api):
    """직접 넣었다는 건 자동값이 마음에 안 들었다는 뜻이다. 다음 배치가 덮으면 안 된다."""
    _, SessionLocal = api
    with SessionLocal() as db:
        _fill_cpi(db, _cpi(), _cpi_at(3.2))
        same_day = dt.date(2026, 9, 10)
        macro.set_forecast(db, "CPIAUCSL", AUG, 2.5, source=macro.FORECAST_CLEVELAND,
                           forecast_date=same_day)
        macro.set_forecast(db, "CPIAUCSL", AUG, 3.0, forecast_date=same_day)

        forecast = _card(db)["forecast"]
        assert forecast["value"] == 3.0
        assert forecast["source"] == macro.FORECAST_MANUAL
        assert forecast["source_label"] == "직접 입력"


def test_a_fetched_forecast_is_used_when_nobody_typed_one(api):
    _, SessionLocal = api
    with SessionLocal() as db:
        _fill_cpi(db, _cpi(), _cpi_at(3.2))
        macro.set_forecast(db, "CPIAUCSL", AUG, 2.5, source=macro.FORECAST_CLEVELAND)

        forecast = _card(db)["forecast"]
        assert forecast["value"] == 2.5
        assert forecast["source_label"] == "클리블랜드 연준"


# ---------------------------------------------------------------------------
#  나온 값 / 아직 안 나온 값
# ---------------------------------------------------------------------------


def test_the_surprise_is_actual_minus_forecast(api):
    _, SessionLocal = api
    with SessionLocal() as db:
        _fill_cpi(db, _cpi(), _cpi_at(3.2))
        macro.set_forecast(db, "CPIAUCSL", AUG, 3.0)

        assert _card(db)["forecast"]["surprise"] == pytest.approx(0.2)


def test_next_months_forecast_waits_in_its_own_slot(api):
    """한 칸에 합치면 9월 예상치를 넣는 순간 8월 결과가 화면에서 사라진다."""
    _, SessionLocal = api
    with SessionLocal() as db:
        _fill_cpi(db, _cpi(), _cpi_at(3.2))
        macro.set_forecast(db, "CPIAUCSL", AUG, 3.0)
        macro.set_forecast(db, "CPIAUCSL", SEP, 2.9)

        card = _card(db)
        assert card["forecast"]["as_of"] == AUG
        assert card["pending_forecast"]["as_of"] == SEP
        assert card["pending_forecast"]["surprise"] is None


def test_the_nearest_unreleased_month_is_the_one_shown(api):
    """두 달 뒤 예상치가 다음 달 것을 가리면 화면이 엉뚱한 달을 말한다."""
    _, SessionLocal = api
    with SessionLocal() as db:
        _fill_cpi(db, _cpi(), _cpi_at(3.2))
        macro.set_forecast(db, "CPIAUCSL", OCT, 2.5)
        macro.set_forecast(db, "CPIAUCSL", SEP, 2.9)

        assert _card(db)["pending_forecast"]["as_of"] == SEP


def test_a_forecast_entered_before_any_value_exists_still_shows(api):
    """저장은 됐는데 화면에 안 뜨면 사용자는 저장이 안 된 줄 안다."""
    _, SessionLocal = api
    with SessionLocal() as db:
        db.add(_cpi())
        db.commit()
        macro.set_forecast(db, "CPIAUCSL", SEP, 2.9)

        card = _card(db)
        assert card["forecast"] is None
        assert card["pending_forecast"]["value"] == 2.9


def test_a_forecast_for_a_month_already_behind_us_is_not_shown(api):
    """지난달 예상치는 이미 끝난 이야기다. 화면에 두면 이번 발표 얘기로 읽힌다."""
    _, SessionLocal = api
    with SessionLocal() as db:
        _fill_cpi(db, _cpi(), _cpi_at(3.2))
        macro.set_forecast(db, "CPIAUCSL", dt.date(2026, 7, 1), 2.4)

        card = _card(db)
        assert card["forecast"] is None
        assert card["pending_forecast"] is None


# ---------------------------------------------------------------------------
#  예상치가 없는 지표
# ---------------------------------------------------------------------------


def test_a_daily_indicator_has_no_such_thing_as_a_consensus(api):
    """VIX·금리는 시장에서 매일 나오는 값이다 — 발표일도 컨센서스도 없다."""
    _, SessionLocal = api
    with SessionLocal() as db:
        db.add(_rate())
        db.add(MacroValue(code="DGS10", as_of=dt.date(2026, 9, 21), value=4.11))
        db.commit()

        card = _card(db, code="DGS10")
        assert card["forecastable"] is False
        assert card["forecast"] is None


def test_the_spread_card_says_it_takes_no_forecast(api):
    """계산값이라 컨센서스가 없다. 홈의 칩과 카드가 같은 모양이어야 해서 칸은 있다."""
    _, SessionLocal = api
    with SessionLocal() as db:
        db.add(_rate())
        db.add(MacroSeries(code="DGS2", name="미 2년물 금리", source="fred", source_code="DGS2",
                           unit="percent", transform="none", frequency="daily",
                           display_order=30, active=True))
        for code, value in (("DGS10", 4.11), ("DGS2", 4.38)):
            db.add(MacroValue(code=code, as_of=dt.date(2026, 9, 21), value=value))
        db.commit()

        card = macro.term_spread_snapshot(db)
        assert card["forecastable"] is False
        assert card["forecast"] is None


# ---------------------------------------------------------------------------
#  지우기
# ---------------------------------------------------------------------------


def test_clearing_removes_every_row_a_person_typed_for_that_month(api):
    """어제 넣은 줄이 남아 있으면 지워도 잘못된 배지가 다시 뜬다."""
    _, SessionLocal = api
    with SessionLocal() as db:
        _fill_cpi(db, _cpi(), _cpi_at(3.2))
        macro.set_forecast(db, "CPIAUCSL", AUG, 2.0, forecast_date=dt.date(2026, 9, 5))
        macro.set_forecast(db, "CPIAUCSL", AUG, 2.1, forecast_date=dt.date(2026, 9, 10))

        assert macro.clear_forecast(db, "CPIAUCSL", AUG) == 2
        assert _card(db)["forecast"] is None


def test_clearing_leaves_what_we_fetched_alone(api):
    """받아온 값을 지워도 다음 배치가 다시 받아온다. 지우는 건 사람이 넣은 것뿐이다."""
    _, SessionLocal = api
    with SessionLocal() as db:
        _fill_cpi(db, _cpi(), _cpi_at(3.2))
        macro.set_forecast(db, "CPIAUCSL", AUG, 2.5, source=macro.FORECAST_CLEVELAND)
        macro.set_forecast(db, "CPIAUCSL", AUG, 3.0)

        macro.clear_forecast(db, "CPIAUCSL", AUG)

        forecast = _card(db)["forecast"]
        assert forecast["value"] == 2.5
        assert forecast["source"] == macro.FORECAST_CLEVELAND


def test_clearing_a_month_with_nothing_in_it_is_not_an_error(api):
    _, SessionLocal = api
    with SessionLocal() as db:
        _fill_cpi(db, _cpi(), _cpi_at(3.2))
        assert macro.clear_forecast(db, "CPIAUCSL", AUG) == 0


# ---------------------------------------------------------------------------
#  질의 수
# ---------------------------------------------------------------------------


def test_forecasts_for_every_card_are_read_in_one_query(api):
    """카드마다 따로 읽으면 매크로 탭 한 장에 질의가 아홉 개 는다."""
    _, SessionLocal = api
    with SessionLocal() as db:
        for code, order in (("CPIAUCSL", 70), ("CPILFESL", 60), ("PCEPI", 50), ("PCEPILFE", 40)):
            _fill_cpi(db, _cpi(code=code, name=code, display_order=order), _cpi_at(3.2))
            macro.set_forecast(db, code, AUG, 3.0)

        snapshots = [macro.snapshot(db, s) for s in macro.active_series(db)]

        seen = []
        def count(conn, cursor, statement, parameters, context, executemany):
            seen.append(statement)

        event.listen(db.get_bind(), "after_cursor_execute", count)
        try:
            macro.attach_forecasts(db, snapshots)
        finally:
            event.remove(db.get_bind(), "after_cursor_execute", count)

        assert len(seen) == 1, seen
        assert all(item["forecast"]["value"] == 3.0 for item in snapshots)


def test_months_already_behind_us_are_left_in_the_database(api):
    """나우캐스트는 매일 한 줄씩 쌓인다 — 몇 해 지나면 한 지표에 수천 줄이다.

    지나간 달 예상치는 화면에 쓸 데가 없으므로 애초에 안 읽는다. 파이썬에서 걸러도
    결과는 같지만, 그러면 카드 한 장 그리려고 그 수천 줄을 매번 올리게 된다.
    """
    _, SessionLocal = api
    with SessionLocal() as db:
        _fill_cpi(db, _cpi(), _cpi_at(3.2))
        macro.set_forecast(db, "CPIAUCSL", dt.date(2024, 1, 1), 2.4)

        bound = []
        def capture(conn, cursor, statement, parameters, context, executemany):
            if "macro_forecast" in statement:
                bound.append(parameters)

        event.listen(db.get_bind(), "after_cursor_execute", capture)
        try:
            macro.attach_forecasts(db, [macro.snapshot(db, db.get(MacroSeries, "CPIAUCSL"))])
        finally:
            event.remove(db.get_bind(), "after_cursor_execute", capture)

        assert len(bound) == 1
        # 드라이버마다 파라미터를 다른 모양으로 준다 — sqlite3 는 자리순 튜플,
        # psycopg 는 이름을 붙인 사전이다. 사전을 그냥 돌면 값이 아니라 이름이 나온다.
        raw = bound[0]
        given = raw.values() if isinstance(raw, dict) else raw
        # sqlite 는 날짜를 문자열로, psycopg 는 date 객체로 넘긴다. 둘 다 str() 이 같다.
        assert AUG.isoformat() in {str(value) for value in given}, bound


def test_hitting_the_forecast_exactly_shows_no_movement(api):
    """전년비는 지수를 나눈 값이라 예상과 같은 달에도 차이가 -8.4e-15 로 나온다.

    그대로 두면 화면에 "−0.00%p" 라는 있지도 않은 하락이 뜬다.
    """
    _, SessionLocal = api
    with SessionLocal() as db:
        _fill_cpi(db, _cpi(), _cpi_at(2.9))
        macro.set_forecast(db, "CPIAUCSL", AUG, 2.9)

        surprise = _card(db)["forecast"]["surprise"]
        assert surprise == 0
        assert not surprise < 0


# ---------------------------------------------------------------------------
#  나우캐스트 자동 수집
# ---------------------------------------------------------------------------
#
#  여기서 확인하는 것은 **단위**다. 나우캐스트는 전월비를 내는데 카드는 전년비로 뜨므로,
#  그대로 넣으면 실제 3.2% 와 예상 0.44% 를 비교하게 된다. 숫자가 둘 다 그럴듯해서
#  화면에서는 안 보이고, 증상은 "매달 물가 상회 배지가 뜬다"로만 나타난다.

from app.services.providers.cleveland import ForecastPoint  # noqa: E402

SEP = dt.date(2026, 9, 1)


def _point(code="CPIAUCSL", as_of=SEP, value=0.4, unit="mom", on=dt.date(2026, 9, 21)):
    return ForecastPoint(code=code, as_of=as_of, forecast_date=on, value=value, unit=unit)


class _FakeNowcast:
    name = "cleveland_fed"

    def __init__(self, points=None, error=None):
        self.points = points or []
        self.error = error
        self.calls = 0

    def fetch(self):
        self.calls += 1
        if self.error:
            raise self.error
        return self.points


def _index_months(db, code, months: dict[dt.date, float]):
    for as_of, value in months.items():
        db.add(MacroValue(code=code, as_of=as_of, value=value, source="fred_api"))
    db.commit()


def test_shifting_months_crosses_the_year_boundary():
    assert macro.shift_month(dt.date(2026, 1, 1), -1) == dt.date(2025, 12, 1)
    assert macro.shift_month(dt.date(2026, 12, 1), 1) == dt.date(2027, 1, 1)
    assert macro.shift_month(SEP, -12) == dt.date(2025, 9, 1)


def test_a_month_over_month_nowcast_becomes_a_year_over_year_forecast(api):
    """카드의 3.2% 를 만드는 계산과 한 글자도 다르지 않아야 한다."""
    _, SessionLocal = api
    with SessionLocal() as db:
        db.add(_cpi())
        _index_months(db, "CPIAUCSL", {dt.date(2025, 9, 1): 100.0, dt.date(2026, 8, 1): 103.0})

        # 9월 지수는 8월(103.0)보다 0.4% 오를 것 -> 103.412, 작년 9월(100.0) 대비 3.412%
        assert macro.forecast_from_mom(db, "CPIAUCSL", SEP, 0.4) == pytest.approx(3.412)


def test_without_last_months_index_there_is_no_forecast(api):
    """매달 열흘쯤 생기는 상황이다 — 9월분을 예측 중인데 8월분이 아직 발표 전."""
    _, SessionLocal = api
    with SessionLocal() as db:
        db.add(_cpi())
        _index_months(db, "CPIAUCSL", {dt.date(2025, 9, 1): 100.0})

        assert macro.forecast_from_mom(db, "CPIAUCSL", SEP, 0.4) is None


def test_without_the_year_ago_index_there_is_no_forecast(api):
    _, SessionLocal = api
    with SessionLocal() as db:
        db.add(_cpi())
        _index_months(db, "CPIAUCSL", {dt.date(2026, 8, 1): 103.0})

        assert macro.forecast_from_mom(db, "CPIAUCSL", SEP, 0.4) is None


def test_only_the_last_nowcast_of_each_month_is_kept():
    """파일에는 한 달을 예측한 날들이 전부 들어 있다. 지난달은 마지막 하나면 된다 —
    그게 "발표 직전의 예상"이다."""
    best = macro.latest_per_month([
        _point(value=0.30, on=dt.date(2026, 9, 10)),
        _point(value=0.44, on=dt.date(2026, 9, 21)),
        _point(value=0.20, on=dt.date(2026, 9, 15)),
        _point(code="PCEPI", value=0.36, on=dt.date(2026, 9, 21)),
    ])

    assert len(best) == 2
    assert best[("CPIAUCSL", SEP)].value == 0.44
    assert best[("CPIAUCSL", SEP)].forecast_date == dt.date(2026, 9, 21)


def test_a_fetched_nowcast_lands_on_the_card_in_screen_units(api):
    _, SessionLocal = api
    with SessionLocal() as db:
        _fill_cpi(db, _cpi(), {dt.date(2025, 8, 1): 100.0, AUG: 103.2})
        _index_months(db, "CPIAUCSL", {dt.date(2025, 9, 1): 100.5})

        result = macro.refresh_forecasts(
            db, provider=_FakeNowcast([_point(as_of=SEP, value=0.4)]), today=dt.date(2026, 9, 21)
        )

        assert result["ok"] and result["stored"] == 1
        pending = _card(db)["pending_forecast"]
        # 103.2 * 1.004 = 103.6128, 작년 9월(100.5) 대비 3.097% — **0.4 가 아니다**
        assert pending["value"] == pytest.approx(3.0973, abs=1e-3)
        assert pending["source_label"] == "클리블랜드 연준"


def test_a_year_over_year_file_needs_no_conversion(api):
    """나중에 전년비를 내는 파일로 옮겨가도 같은 길로 들어와야 한다."""
    _, SessionLocal = api
    with SessionLocal() as db:
        _fill_cpi(db, _cpi(), _cpi_at(3.2))

        macro.refresh_forecasts(
            db, provider=_FakeNowcast([_point(as_of=AUG, value=3.0, unit="yoy")]),
            today=dt.date(2026, 9, 21),
        )

        assert _card(db)["forecast"]["value"] == 3.0


def test_a_month_we_cannot_convert_is_left_empty_not_invented(api):
    _, SessionLocal = api
    with SessionLocal() as db:
        db.add(_cpi())
        db.commit()

        result = macro.refresh_forecasts(
            db, provider=_FakeNowcast([_point(as_of=SEP, value=0.4)]), today=dt.date(2026, 9, 21)
        )

        assert result["stored"] == 0 and result["skipped"] == 1
        assert db.scalars(select(MacroForecast)).all() == []


def test_months_far_in_the_past_are_not_stored(api):
    """파일에는 2013년부터 들어 있다. 다 넣으면 첫 실행에 수천 줄이 된다."""
    _, SessionLocal = api
    with SessionLocal() as db:
        _fill_cpi(db, _cpi(), {dt.date(2013, 6, 1): 100.0, dt.date(2013, 7, 1): 100.5,
                               dt.date(2012, 8, 1): 99.0})

        result = macro.refresh_forecasts(
            db, provider=_FakeNowcast([_point(as_of=dt.date(2013, 8, 1), value=0.4)]),
            today=dt.date(2026, 9, 21),
        )

        assert result["stored"] == 0


def test_what_a_person_typed_still_wins_over_the_nowcast(api):
    """직접 넣었다는 건 자동값이 마음에 안 들었다는 뜻이다. 배치가 덮으면 안 된다."""
    _, SessionLocal = api
    with SessionLocal() as db:
        _fill_cpi(db, _cpi(), _cpi_at(3.2))
        macro.set_forecast(db, "CPIAUCSL", AUG, 2.5, forecast_date=dt.date(2026, 9, 21))

        macro.refresh_forecasts(
            db, provider=_FakeNowcast([_point(as_of=AUG, value=3.0, unit="yoy")]),
            today=dt.date(2026, 9, 21),
        )

        assert _card(db)["forecast"]["value"] == 2.5


def test_the_file_is_not_downloaded_twice_in_a_day(api):
    """7MB 짜리 파일이다. 앱을 다시 띄울 때마다 받을 이유가 없다."""
    _, SessionLocal = api
    with SessionLocal() as db:
        _fill_cpi(db, _cpi(), _cpi_at(3.2))
        provider = _FakeNowcast([_point(as_of=AUG, value=3.0, unit="yoy")])

        macro.refresh_forecasts(db, provider=provider, today=dt.date(2026, 9, 21))
        again = macro.refresh_forecasts(db, provider=provider, today=dt.date(2026, 9, 21))

        assert provider.calls == 1
        assert again["skipped"] == "오늘 이미 받았음"


def test_pressing_refresh_asks_again_anyway(api):
    """사람이 눌렀는데 아무 일도 안 일어나면 그건 고장으로 보인다."""
    _, SessionLocal = api
    with SessionLocal() as db:
        _fill_cpi(db, _cpi(), _cpi_at(3.2))
        provider = _FakeNowcast([_point(as_of=AUG, value=3.0, unit="yoy")])

        macro.refresh_forecasts(db, provider=provider, today=dt.date(2026, 9, 21))
        macro.refresh_forecasts(db, provider=provider, today=dt.date(2026, 9, 21), force=True)

        assert provider.calls == 2


def test_a_failed_nowcast_does_not_touch_the_indicator(api):
    """예상치를 못 받은 것과 CPI 를 못 받은 것은 사용자가 할 일이 완전히 다르다."""
    _, SessionLocal = api
    with SessionLocal() as db:
        _fill_cpi(db, _cpi(), _cpi_at(3.2))

        result = macro.refresh_forecasts(
            db, provider=_FakeNowcast(error=RuntimeError("막혔습니다")),
            today=dt.date(2026, 9, 21),
        )

        assert result["ok"] is False and "막혔습니다" in result["error"]
        assert db.get(MacroSeries, "CPIAUCSL").last_error is None
        # 값 자체는 그대로 있다
        assert _card(db)["value"] == pytest.approx(3.2)
