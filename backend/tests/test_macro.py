"""매크로 지표 — 제공자 해석, 수집, 저장, 파생 계산.

**실제 네트워크는 쓰지 않는다.** 개발 환경에서 FRED·야후가 프록시 정책에 막혀 있기도
하지만, 그게 아니어도 바깥 응답에 기대는 테스트는 남의 서버 사정에 따라 흔들린다.
여기서는 실제 응답과 같은 모양의 가짜를 주고, 실제 조회가 되는지는 `diagnose.py` 로
PC 나 서버에서 확인한다 (시세 제공자를 만들 때와 같은 방식).
"""

import datetime as dt
import json

import pytest

from app.models import MacroSeries, MacroValue, PortfolioSettings
from app.services import macro
from app.services.providers import (
    AllMacroProvidersFailed,
    EmptyData,
    ProviderUnavailable,
    TickerNotFound,
    build_macro_providers,
    fetch_macro_points,
)
from app.services.providers.fred import FredApiProvider, FredCsvProvider
from app.services.providers.macro_base import MacroPoint, parse_value


# ---------------------------------------------------------------------------
#  값 한 칸 읽기
# ---------------------------------------------------------------------------


def test_a_missing_value_is_not_zero():
    """FRED 는 "값 없음"을 점 하나로 준다. 0 으로 읽으면 금리가 0% 인 날이 생긴다."""
    assert parse_value(".") is None
    assert parse_value("") is None
    assert parse_value("  4.21 ") == 4.21
    assert parse_value(0.0) == 0.0  # 진짜 0 은 0 이다


# ---------------------------------------------------------------------------
#  FRED CSV (키 없이 받는 경로)
# ---------------------------------------------------------------------------

CSV_NEW = "observation_date,DGS10\n2026-09-17,4.05\n2026-09-18,.\n2026-09-19,4.11\n"
# 헤더 첫 칸이 DATE 였던 시절의 형식. 실제로 바뀐 적이 있어 둘 다 받아야 한다.
CSV_OLD = "DATE,DGS10\n2026-09-17,4.05\n2026-09-19,4.11\n"


@pytest.mark.parametrize("body", [CSV_NEW, CSV_OLD])
def test_csv_reads_both_header_shapes(body):
    points = FredCsvProvider().parse_csv(body, "DGS10")
    assert [(p.as_of, p.value) for p in points] == [
        (dt.date(2026, 9, 17), 4.05),
        (dt.date(2026, 9, 19), 4.11),
    ]
    # CSV 는 발표일을 주지 않는다 — 없는 걸 지어내지 않는다
    assert all(p.released_at is None for p in points)


def test_csv_says_the_code_is_wrong_rather_than_empty():
    """없는 코드에 안내 HTML 이 돌아오는 경우. "데이터 없음"이라고 하면 사용자가 못 고친다."""
    with pytest.raises(TickerNotFound):
        FredCsvProvider().parse_csv("<!DOCTYPE html><html>...", "NOPE")


def test_csv_with_an_unexpected_header_is_a_provider_problem():
    """형식이 바뀌면 조용히 빈 값을 쓰는 대신 시끄럽게 실패해야 한다 (공식 API 가 아니다)."""
    with pytest.raises(ProviderUnavailable):
        FredCsvProvider().parse_csv("foo,bar\n1,2\n", "DGS10")


def test_csv_with_only_missing_values_is_empty():
    with pytest.raises(EmptyData):
        FredCsvProvider().parse_csv("observation_date,DGS10\n2026-09-17,.\n", "DGS10")


# ---------------------------------------------------------------------------
#  FRED API (키가 있을 때)
# ---------------------------------------------------------------------------


def test_api_without_a_key_does_not_pretend_to_work():
    provider = FredApiProvider(key=None)
    assert provider.supports("DGS10") is False


def test_api_translates_a_wrong_code():
    body = json.dumps({"error_code": 400, "error_message": "Bad Request.  The series does not exist."})
    with pytest.raises(TickerNotFound):
        FredApiProvider(key="k").parse_response(400, body, "NOPE")


def test_api_says_it_is_the_key_when_it_is_the_key():
    """키가 거절당한 것과 지표가 없는 것은 사용자가 할 일이 전혀 다르다."""
    body = json.dumps({"error_message": "The value for variable api_key is not registered."})
    with pytest.raises(ProviderUnavailable) as exc:
        FredApiProvider(key="k").parse_response(400, body, "DGS10")
    assert "FRED_API_KEY" in str(exc.value)


def test_api_fetch_merges_release_dates(monkeypatch):
    """값은 최신(수정 반영)본, 발표일은 최초 공개일 — 요청 두 번을 합친다."""
    calls = []

    def fake_get(url, params=None, headers=None, timeout=None):
        calls.append(params.get("output_type"))
        if params.get("output_type") == "4":
            payload = {
                "observations": [
                    {"date": "2026-08-01", "realtime_start": "2026-09-26", "value": "125.1"}
                ]
            }
        else:
            payload = {
                "observations": [
                    {"date": "2026-07-01", "realtime_start": "2026-09-21", "value": "124.6"},
                    {"date": "2026-08-01", "realtime_start": "2026-09-21", "value": "125.3"},
                ]
            }
        return _Response(200, json.dumps(payload))

    monkeypatch.setattr("requests.get", fake_get)

    points = FredApiProvider(key="k").fetch("PCEPILFE", want_release_dates=True)

    assert calls == [None, "4"]
    # 최초 발표값(125.1)이 아니라 지금 맞는 값(125.3)을 쓴다 — 화면에 띄울 것은 현재값이다
    assert points[-1].value == 125.3
    assert points[-1].released_at == dt.date(2026, 9, 26)
    # 발표일을 못 받은 시점은 그냥 비어 있다
    assert points[0].released_at is None


def test_release_dates_are_a_bonus_not_a_requirement(monkeypatch):
    """발표일 조회가 실패해도 값은 나와야 한다. 있으면 좋은 것 하나에 지표가 통째로 걸리면 안 된다."""

    def fake_get(url, params=None, headers=None, timeout=None):
        if params.get("output_type") == "4":
            raise ConnectionError("끊김")
        payload = {"observations": [{"date": "2026-08-01", "value": "125.3"}]}
        return _Response(200, json.dumps(payload))

    monkeypatch.setattr("requests.get", fake_get)

    points = FredApiProvider(key="k").fetch("PCEPILFE", want_release_dates=True)
    assert [(p.as_of, p.value, p.released_at) for p in points] == [
        (dt.date(2026, 8, 1), 125.3, None)
    ]


# ---------------------------------------------------------------------------
#  야후를 매크로 제공자로 쓰는 어댑터 (VIX)
# ---------------------------------------------------------------------------


def test_yahoo_adapter_reads_the_close_as_the_day_s_value(monkeypatch):
    import pandas as pd

    from app.services.providers.base import normalize_frame
    from app.services.providers.yahoo import YahooMacroProvider

    raw = pd.DataFrame(
        {
            "Open": [17.0, 18.0],
            "High": [19.0, 19.5],
            "Low": [16.5, 17.2],
            "Close": [18.1, 18.4],
            "Volume": [0, 0],
        },
        index=pd.to_datetime(["2026-09-18", "2026-09-19"]),
    )

    provider = YahooMacroProvider()
    monkeypatch.setattr(
        provider._prices, "fetch", lambda ticker, period: normalize_frame(raw, "yahoo", ticker)
    )

    points = provider.fetch("^VIX")
    assert [(p.as_of, p.value) for p in points] == [
        (dt.date(2026, 9, 18), 18.1),
        (dt.date(2026, 9, 19), 18.4),
    ]


def test_yahoo_adapter_respects_the_start_date(monkeypatch):
    """제공자가 달라는 것보다 더 준다 — 기간이 period 단위라 딱 맞게 잘리지 않는다."""
    import pandas as pd

    from app.services.providers.base import normalize_frame
    from app.services.providers.yahoo import YahooMacroProvider

    raw = pd.DataFrame(
        {"Open": [1.0, 2.0], "High": [1.0, 2.0], "Low": [1.0, 2.0],
         "Close": [18.1, 18.4], "Volume": [0, 0]},
        index=pd.to_datetime(["2026-09-18", "2026-09-19"]),
    )
    provider = YahooMacroProvider()
    monkeypatch.setattr(
        provider._prices, "fetch", lambda ticker, period: normalize_frame(raw, "yahoo", ticker)
    )

    points = provider.fetch("^VIX", start=dt.date(2026, 9, 19))
    assert [p.as_of for p in points] == [dt.date(2026, 9, 19)]


def test_period_for_covers_the_requested_window():
    """너무 짧은 period 를 고르면 시작일 이전이 통째로 빠진다."""
    from app.services.providers.macro_base import period_for

    today = dt.date(2026, 9, 21)
    assert period_for(None) == "max"
    assert period_for(dt.date(2026, 9, 11), today=today) == "1mo"
    assert period_for(dt.date(2025, 9, 21), today=today) == "1y"
    assert period_for(dt.date(1990, 1, 1), today=today) == "max"


# ---------------------------------------------------------------------------
#  폴백 사슬
# ---------------------------------------------------------------------------


def test_fred_without_a_key_still_has_a_path():
    """키 발급은 진입 장벽이다. 키가 없어도 CSV 로 값이 나와야 한다."""
    names = [p.name for p in build_macro_providers("fred")]
    assert names == ["fred_api", "fred_csv"]


def test_no_key_at_all_still_gets_a_value(monkeypatch):
    """키 발급은 진입 장벽이다 — `FRED_API_KEY` 가 없어도 매크로 탭이 비면 안 된다.

    키 없는 API 제공자는 `supports()` 가 False 라 아예 시도되지 않고, CSV 로 넘어간다.
    (시도했다가 실패하게 두면 매번 쓸모없는 요청이 한 번씩 나가고, 로그에는 고칠 것도
    없는 실패가 쌓인다.)
    """
    monkeypatch.delenv("FRED_API_KEY", raising=False)

    requested = []

    def fake_get(url, params=None, headers=None, timeout=None):
        requested.append(url)
        return _Response(200, CSV_NEW)

    monkeypatch.setattr("requests.get", fake_get)

    points, provider = fetch_macro_points("DGS10", source="fred")

    assert provider == "fred_csv"
    assert [r for r in requested if "api.stlouisfed.org" in r] == []
    assert points[-1].value == 4.11


def test_fallback_asks_with_the_other_place_s_code(monkeypatch):
    """VIX 는 야후에서 `^VIX`, FRED 에서 `VIXCLS` 다. 앞 코드를 뒤에 그대로 물으면 "없는 지표"가 된다."""
    asked = []

    class Failing:
        name = "yahoo"

        def supports(self, code):
            return True

        def fetch(self, code, start=None, want_release_dates=False):
            asked.append(("yahoo", code))
            raise ProviderUnavailable("yahoo", f"{code}: 막힘")

    class Working:
        name = "fred_csv"

        def supports(self, code):
            return True

        def fetch(self, code, start=None, want_release_dates=False):
            asked.append(("fred_csv", code))
            return [MacroPoint(as_of=dt.date(2026, 9, 19), value=18.4)]

    monkeypatch.setattr(
        "app.services.providers._MACRO_FACTORIES",
        {"yahoo": lambda t: [Failing()], "fred": lambda t: [Working()]},
    )

    points, provider = fetch_macro_points(
        "VIX", source="yahoo", fallback_source="fred", fallback_code="VIXCLS"
    )

    assert asked == [("yahoo", "VIX"), ("fred_csv", "VIXCLS")]
    assert provider == "fred_csv"
    assert points[0].value == 18.4


def test_every_failure_is_reported_together(monkeypatch):
    """전부 실패했을 때 "데이터 없음"이 아니라 어디서 왜 막혔는지가 남아야 고칠 수 있다."""
    monkeypatch.setattr("app.services.providers._MACRO_FACTORIES", {})
    with pytest.raises(AllMacroProvidersFailed) as exc:
        fetch_macro_points("DGS10", source="fred")
    assert "DGS10" in str(exc.value)


# ---------------------------------------------------------------------------
#  저장
# ---------------------------------------------------------------------------


def test_seed_does_not_resurrect_what_the_user_turned_off(db_session):
    """시드를 덮어쓰면 꺼둔 지표가 되살아나고 바꿔둔 순서가 돌아간다."""
    assert macro.ensure_seed(db_session) == len(macro.SEED_SERIES)

    series = db_session.get(MacroSeries, "CPIAUCSL")
    series.active = False
    series.display_order = 999
    db_session.commit()

    assert macro.ensure_seed(db_session) == 0  # 두 번째부터는 아무 일도 없다

    series = db_session.get(MacroSeries, "CPIAUCSL")
    assert series.active is False
    assert series.display_order == 999
    assert "CPIAUCSL" not in [s.code for s in macro.active_series(db_session)]


def test_a_revised_value_overwrites_and_is_counted(db_session):
    """CPI·PCE 는 발표 뒤에도 수정된다. 덮어쓴 것을 세어두지 않으면 나중에 왜 달라졌는지 모른다."""
    macro.ensure_seed(db_session)

    first = macro.upsert_values(
        db_session,
        "PCEPILFE",
        [MacroPoint(dt.date(2026, 8, 1), 125.1, released_at=dt.date(2026, 9, 26))],
        source="fred_api",
    )
    assert first == {"inserted": 1, "revised": 0}

    second = macro.upsert_values(
        db_session, "PCEPILFE", [MacroPoint(dt.date(2026, 8, 1), 125.3)], source="fred_csv"
    )
    assert second == {"inserted": 0, "revised": 1}

    row = db_session.query(MacroValue).filter_by(code="PCEPILFE").one()
    assert row.value == 125.3
    # 발표일을 안 주는 제공자로 폴백했다고 이미 아는 발표일을 지우면 안 된다
    assert row.released_at == dt.date(2026, 9, 26)


def test_an_unchanged_value_is_not_counted_as_a_revision(db_session):
    macro.ensure_seed(db_session)
    point = [MacroPoint(dt.date(2026, 8, 1), 125.1)]
    macro.upsert_values(db_session, "PCEPILFE", point)
    assert macro.upsert_values(db_session, "PCEPILFE", point) == {"inserted": 0, "revised": 0}


def test_monthly_series_always_refetch_everything(db_session):
    """월간 지표는 몇 년 전 값까지 소급 수정된다. 최근 며칠만 받으면 그 수정이 영영 안 들어온다."""
    macro.ensure_seed(db_session)
    today = dt.date(2026, 9, 21)

    macro.upsert_values(db_session, "PCEPILFE", [MacroPoint(dt.date(2026, 8, 1), 125.3)])
    monthly = db_session.get(MacroSeries, "PCEPILFE")
    assert macro.fetch_start(db_session, monthly, today=today).year == today.year - macro.BACKFILL_YEARS

    macro.upsert_values(db_session, "DGS10", [MacroPoint(dt.date(2026, 9, 19), 4.11)])
    daily = db_session.get(MacroSeries, "DGS10")
    assert macro.fetch_start(db_session, daily, today=today) == dt.date(2026, 9, 9)


def test_one_broken_indicator_does_not_stop_the_rest(db_session, monkeypatch):
    """시세 배치와 같은 원칙 — 하나가 막혀도 나머지는 갱신돼야 한다."""
    macro.ensure_seed(db_session)

    def fake_fetch(code, source, fallback_source=None, fallback_code=None, start=None, want_release_dates=False):
        if code == "DGS10":
            raise AllMacroProvidersFailed("DGS10", [ProviderUnavailable("fred_csv", "막힘")])
        return [MacroPoint(dt.date(2026, 9, 19), 1.0)], "fred_csv"

    monkeypatch.setattr(macro, "fetch_macro_points", fake_fetch)

    results = {r["code"]: r for r in macro.refresh_all(db_session)}

    assert results["DGS10"]["ok"] is False
    assert results["DGS10"]["hint"]
    assert all(results[code]["ok"] for code in results if code != "DGS10")
    # 실패한 지표에는 아무것도 안 들어갔고, 나머지는 들어갔다
    assert db_session.query(MacroValue).filter_by(code="DGS10").count() == 0
    assert db_session.query(MacroValue).filter_by(code="VIX").count() == 1


# ---------------------------------------------------------------------------
#  파생 계산 (원본을 저장하고 변환은 우리가 한다)
# ---------------------------------------------------------------------------


def test_year_over_year_is_computed_from_the_raw_index():
    points = [(dt.date(2025, 8, 1), 100.0), (dt.date(2026, 8, 1), 102.8)]
    assert macro.year_over_year(points) == [(dt.date(2026, 8, 1), pytest.approx(2.8))]


def test_year_over_year_uses_the_calendar_not_the_row_count():
    """한 달이 빠져 있을 때 칸 수로 세면 13개월 전과 비교하게 되고, 화면에서는 안 보인다."""
    points = [
        (dt.date(2025, 7, 1), 100.0),
        (dt.date(2025, 8, 1), 200.0),  # 2026-08 의 진짜 기준
        (dt.date(2025, 9, 1), 300.0),
        (dt.date(2026, 8, 1), 202.0),
    ]
    assert macro.year_over_year(points) == [(dt.date(2026, 8, 1), pytest.approx(1.0))]


def test_month_over_month_crosses_the_year_boundary():
    points = [(dt.date(2025, 12, 1), 100.0), (dt.date(2026, 1, 1), 100.5)]
    assert macro.month_over_month(points) == [(dt.date(2026, 1, 1), pytest.approx(0.5))]


def test_a_level_series_is_left_alone():
    points = [(dt.date(2026, 9, 19), 18.4)]
    assert macro.apply_transform("none", points) == points


def test_term_spread_only_subtracts_the_same_day(db_session):
    """어제 10년물에서 그제 2년물을 빼면 그건 금리차가 아니다."""
    macro.ensure_seed(db_session)
    macro.upsert_values(db_session, "DGS10", [MacroPoint(dt.date(2026, 9, 19), 4.10)])
    macro.upsert_values(db_session, "DGS2", [MacroPoint(dt.date(2026, 9, 18), 4.30)])
    assert macro.term_spread(db_session) is None

    macro.upsert_values(db_session, "DGS2", [MacroPoint(dt.date(2026, 9, 19), 4.35)])
    assert macro.term_spread(db_session) == pytest.approx(-0.25)


# ---------------------------------------------------------------------------
#  홈 화면 즐겨찾기
# ---------------------------------------------------------------------------


def test_never_chosen_shows_the_defaults():
    assert macro.pinned_codes(PortfolioSettings()) == macro.DEFAULT_PINNED
    assert macro.pinned_codes(None) == macro.DEFAULT_PINNED


def test_turning_everything_off_stays_off():
    """`[]` 와 `None` 을 합치면 "홈에서 매크로를 빼겠다"가 불가능해진다.

    껐는데 기본값이 다시 뜨는 화면은 설정이 아니라 고장으로 보인다.
    """
    assert macro.pinned_codes(PortfolioSettings(pinned_macro=[])) == []


def test_a_chosen_order_is_kept():
    settings = PortfolioSettings(pinned_macro=["DGS2", "VIX"])
    assert macro.pinned_codes(settings) == ["DGS2", "VIX"]


def test_the_defaults_do_not_overlap_in_meaning():
    """공포 · 금리 · 물가 — 셋이 같은 것을 말하면 홈에 셋을 둘 이유가 없다."""
    by_code = {spec["code"]: spec for spec in macro.SEED_SERIES}
    assert set(macro.DEFAULT_PINNED) <= set(by_code)
    units = [by_code[code]["unit"] for code in macro.DEFAULT_PINNED]
    assert len(set(units)) == len(units)


# ---------------------------------------------------------------------------
#  언제 받을 것인가 (주기별 갱신)
# ---------------------------------------------------------------------------


def _series(**kwargs) -> MacroSeries:
    base = dict(code="DGS10", name="10년물", source="fred", source_code="DGS10",
                unit="percent", transform="none", frequency="daily",
                display_order=10, active=True)
    return MacroSeries(**{**base, **kwargs})


def test_an_indicator_we_never_tried_is_due():
    assert macro.is_due(_series(), now=dt.datetime(2026, 9, 21, 12, 0)) is True


def test_we_do_not_refetch_twenty_years_every_time_the_app_starts():
    """앱을 다시 띄울 때마다 전 구간을 다시 받으면 안 된다 — 서버는 하루에도 몇 번 뜬다."""
    now = dt.datetime(2026, 9, 21, 12, 0)
    series = _series(last_checked_at=now - dt.timedelta(hours=1))
    assert macro.is_due(series, now=now) is False


def test_a_cron_that_slips_a_few_minutes_still_refreshes_today():
    """기준이 24시간이면 cron 이 조금만 밀려도 **하루 걸러** 받게 된다.

    증상은 "지표가 가끔 하루 늦는다"라서 원인을 짚기 어렵다. 그래서 여유를 뒀고,
    누가 24로 되돌리면 여기서 걸린다.
    """
    now = dt.datetime(2026, 9, 21, 23, 0, 30)
    series = _series(last_checked_at=now - dt.timedelta(hours=23, minutes=59))
    assert macro.is_due(series, now=now) is True


def test_a_failed_indicator_is_tried_again_sooner():
    """키를 넣고 앱을 다시 띄웠는데 내일까지 기다려야 한다면 고쳤는지 알 수 없다."""
    now = dt.datetime(2026, 9, 21, 12, 0)
    three_hours_ago = now - dt.timedelta(hours=3)

    assert macro.is_due(_series(last_checked_at=three_hours_ago, last_error="막힘"), now=now) is True
    # 같은 시각이라도 성공했던 지표는 아직 아니다
    assert macro.is_due(_series(last_checked_at=three_hours_ago), now=now) is False


def test_staleness_is_judged_by_the_indicator_s_own_rhythm(db_session):
    """월간 지표가 한 달 반 전 값인 건 정상이다. 일간 금리가 그러면 고장이다.

    한 기준으로 판정하면 둘 중 하나는 반드시 틀린다 — 멀쩡한데 빨간 표시가 뜨면
    사람은 곧 그 표시를 안 믿게 된다.
    """
    today = dt.date(2026, 9, 21)
    fifty_days_ago = today - dt.timedelta(days=50)

    db_session.add(_series(code="DAILY", frequency="daily"))
    db_session.add(_series(code="MONTHLY", frequency="monthly"))
    db_session.commit()
    for code in ("DAILY", "MONTHLY"):
        macro.upsert_values(db_session, code, [MacroPoint(fifty_days_ago, 1.0)])

    by_code = {s.code: s for s in macro.active_series(db_session)}
    assert macro.is_stale(db_session, by_code["DAILY"], today=today) is True
    assert macro.is_stale(db_session, by_code["MONTHLY"], today=today) is False


# ---------------------------------------------------------------------------
#  결과를 남긴다 (실패 처리)
# ---------------------------------------------------------------------------


def test_a_failure_is_written_down_where_the_screen_can_see_it(db_session, monkeypatch):
    macro.ensure_seed(db_session)

    def fake_fetch(code, **kwargs):
        raise AllMacroProvidersFailed(code, [ProviderUnavailable("fred_csv", "막힘")])

    monkeypatch.setattr(macro, "fetch_macro_points", fake_fetch)
    series = {s.code: s for s in macro.active_series(db_session)}["DGS10"]
    macro.refresh_series(db_session, series)

    assert series.last_checked_at is not None
    assert series.last_ok_at is None
    assert "막힘" in series.last_error


def test_success_wipes_the_old_failure(db_session, monkeypatch):
    """안 지우면 이미 해결된 문제를 화면이 계속 띄운다."""
    macro.ensure_seed(db_session)
    series = {s.code: s for s in macro.active_series(db_session)}["DGS10"]
    macro.mark_checked(db_session, series, error="어제는 막혔다")
    assert series.last_error

    monkeypatch.setattr(
        macro, "fetch_macro_points",
        lambda code, **kwargs: ([MacroPoint(dt.date(2026, 9, 18), 4.2)], "fred_csv"),
    )
    macro.refresh_series(db_session, series)

    assert series.last_error is None
    assert series.last_ok_at is not None


def test_an_unexpected_crash_is_recorded_too(db_session, monkeypatch):
    """제공자 구현 자체의 버그도 흔적을 남겨야 한다 — 롤백 뒤에도 기록은 되어야 한다."""
    macro.ensure_seed(db_session)

    def boom(code, **kwargs):
        raise ValueError("있을 수 없는 일")

    monkeypatch.setattr(macro, "fetch_macro_points", boom)
    macro.refresh_all(db_session, codes=["DGS10"])

    series = {s.code: s for s in macro.active_series(db_session)}["DGS10"]
    assert "있을 수 없는 일" in series.last_error


def test_the_batch_leaves_alone_what_is_not_due_yet(db_session, monkeypatch):
    """CPI 는 한 달에 한 번 나온다 — 날마다 20년치를 다시 받을 이유가 없다."""
    macro.ensure_seed(db_session)
    by_code = {s.code: s for s in macro.active_series(db_session)}
    macro.mark_checked(db_session, by_code["PCEPILFE"])  # 방금 받아봤다

    asked = []

    def fake_fetch(code, **kwargs):
        asked.append(code)
        return [MacroPoint(dt.date(2026, 9, 18), 1.0)], "fred_csv"

    monkeypatch.setattr(macro, "fetch_macro_points", fake_fetch)
    results = {r["code"]: r for r in macro.refresh_due(db_session)}

    assert "PCEPILFE" not in asked
    assert results["PCEPILFE"]["skipped"]
    assert "DGS10" in asked


def test_pressing_refresh_by_hand_always_does_something(db_session, monkeypatch):
    """눌렀는데 아무 일도 안 일어나면 그건 설정이 아니라 고장으로 보인다."""
    macro.ensure_seed(db_session)
    by_code = {s.code: s for s in macro.active_series(db_session)}
    macro.mark_checked(db_session, by_code["DGS10"])

    asked = []

    def fake_fetch(code, **kwargs):
        asked.append(code)
        return [MacroPoint(dt.date(2026, 9, 18), 1.0)], "fred_csv"

    monkeypatch.setattr(macro, "fetch_macro_points", fake_fetch)
    macro.refresh_all(db_session, codes=["DGS10"])  # only_due 없이

    assert asked == ["DGS10"]


class _Response:
    def __init__(self, status_code: int, text: str):
        self.status_code = status_code
        self.text = text
