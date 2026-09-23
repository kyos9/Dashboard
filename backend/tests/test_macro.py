"""매크로 지표 — 제공자 해석, 수집, 저장, 파생 계산.

**실제 네트워크는 쓰지 않는다.** 개발 환경에서 FRED·야후가 프록시 정책에 막혀 있기도
하지만, 그게 아니어도 바깥 응답에 기대는 테스트는 남의 서버 사정에 따라 흔들린다.
여기서는 실제 응답과 같은 모양의 가짜를 주고, 실제 조회가 되는지는 `diagnose.py` 로
PC 나 서버에서 확인한다 (시세 제공자를 만들 때와 같은 방식).
"""

import datetime as dt
import json

import pytest

from app.models import MacroSeries, MacroValue
from app.services import macro
from app.services.users import LOCAL_USER_ID
from tests.factories import build_settings
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
        "VIX",
        source="yahoo",
        source_code="^VIX",
        fallback_source="fred",
        fallback_code="VIXCLS",
    )

    # 우리 이름(`VIX`)은 어느 쪽에도 나가지 않는다 — 양쪽 다 자기네 이름으로 묻는다
    assert asked == [("yahoo", "^VIX"), ("fred_csv", "VIXCLS")]
    assert provider == "fred_csv"
    assert points[0].value == 18.4


def test_the_primary_is_asked_with_its_own_name_too(monkeypatch):
    """**여기서 한 번 놓쳤다.**

    폴백 쪽 이름(`fallback_code`)만 챙기고 앞쪽은 우리 이름(`code`)을 그대로 물었다.
    지표 여덟 중 일곱은 둘이 같아서(FRED 코드를 그대로 쓴다) 아무 일도 안 일어났고,
    다른 하나가 VIX 였다 — 야후에 `^VIX` 대신 `VIX` 를 물어 "없는 티커" 가 돌아왔다.
    처음 테스트가 그 잘못된 기대(`("yahoo", "VIX")`)를 그대로 박아둬서 잡히지도 않았다.
    """
    asked = []

    class Recording:
        name = "yahoo"

        def supports(self, code):
            return True

        def fetch(self, code, start=None, want_release_dates=False):
            asked.append(code)
            return [MacroPoint(as_of=dt.date(2026, 9, 19), value=18.4)]

    monkeypatch.setattr(
        "app.services.providers._MACRO_FACTORIES", {"yahoo": lambda t: [Recording()]}
    )

    fetch_macro_points("VIX", source="yahoo", source_code="^VIX")
    assert asked == ["^VIX"]


def test_every_seeded_indicator_is_asked_by_its_provider_s_name(monkeypatch, db_session):
    """시드 전체를 훑는다 — 지표를 더할 때 같은 실수를 반복하지 않도록.

    코드에서 지표를 늘릴 수 있게 만들어둔 이상, "둘이 다른 지표"는 언제든 또 생긴다.
    """
    macro.ensure_seed(db_session)
    asked = {}

    def fake_fetch(code, source, source_code=None, **kwargs):
        asked[code] = source_code
        return [MacroPoint(dt.date(2026, 9, 18), 1.0)], source

    monkeypatch.setattr(macro, "fetch_macro_points", fake_fetch)
    macro.refresh_all(db_session)

    expected = {spec["code"]: spec["source_code"] for spec in macro.SEED_SERIES}
    assert asked == expected
    # 실제로 다른 것이 하나는 있어야 이 테스트가 의미가 있다
    assert any(code != source_code for code, source_code in expected.items())


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

    def fake_fetch(code, source, source_code=None, fallback_source=None,
                   fallback_code=None, start=None, want_release_dates=False):
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
    assert macro.pinned_codes(build_settings()) == macro.DEFAULT_PINNED
    assert macro.pinned_codes(None) == macro.DEFAULT_PINNED


def test_turning_everything_off_stays_off():
    """`[]` 와 `None` 을 합치면 "홈에서 매크로를 빼겠다"가 불가능해진다.

    껐는데 기본값이 다시 뜨는 화면은 설정이 아니라 고장으로 보인다.
    """
    assert macro.pinned_codes(build_settings(pinned_macro=[])) == []


def test_a_chosen_order_is_kept():
    settings = build_settings(pinned_macro=["DGS2", "VIX"])
    assert macro.pinned_codes(settings) == ["DGS2", "VIX"]


def test_the_defaults_all_exist():
    """가리키는 것이 없는 코드가 기본값에 있으면 홈이 조용히 빈다."""
    known = {spec["code"] for spec in macro.SEED_SERIES} | {macro.TERM_SPREAD_CODE}
    assert set(macro.DEFAULT_PINNED) <= known
    assert len(set(macro.DEFAULT_PINNED)) == len(macro.DEFAULT_PINNED)


def test_the_defaults_all_move_every_day():
    """홈에 **늘 띄워둘** 값이다. 한 달에 한 번 바뀌는 숫자는 매일 볼 이유가 없다."""
    by_code = {spec["code"]: spec for spec in macro.SEED_SERIES}
    for code in macro.DEFAULT_PINNED:
        if code == macro.TERM_SPREAD_CODE:
            continue  # 일간 금리 둘에서 계산하므로 일간이다
        assert by_code[code]["frequency"] == "daily", code


def test_the_defaults_do_not_overlap_in_meaning():
    """공포(VIX) · 금리 곡선 · 심리(공포·탐욕) — 셋이 같은 것을 말하면 셋을 둘 이유가 없다.

    VIX 와 공포·탐욕은 둘 다 "무서워하고 있나"를 보지만 **같은 것을 재지 않는다** —
    앞은 옵션 가격에서 나오는 숫자 하나, 뒤는 일곱 가지를 합친 0~100 점수다
    (`SEED_SERIES` 의 FEARGREED 주석 참고). 어긋날 때가 오히려 볼 만하다.
    """
    assert macro.DEFAULT_PINNED == ["VIX", macro.TERM_SPREAD_CODE, "FEARGREED"]


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


def test_restarting_retries_what_failed(db_session, monkeypatch):
    """**실제로 헛돈 자리다.**

    FRED 키를 `.env` 에 넣고 앱을 다시 띄웠는데 아무 일도 안 일어났다 — 직전 실패가
    2시간 안쪽이라 전부 "대기"로 걸러졌기 때문이다. 고친 사람은 고친 게 맞는지조차
    알 수 없고, 화면은 두 시간을 빈 채로 있는다.
    """
    now = dt.datetime(2026, 9, 21, 12, 0)
    just_failed = _series(last_checked_at=now - dt.timedelta(minutes=5), last_error="막힘")

    assert macro.is_due(just_failed, now=now) is False              # 평소 배치는 그대로 기다린다
    assert macro.is_due(just_failed, now=now, after_restart=True) is True


def test_restarting_does_not_refetch_what_already_worked(db_session):
    """안 그러면 앱을 열 번 띄울 때 20년치를 열 번 다시 받는다."""
    now = dt.datetime(2026, 9, 21, 12, 0)
    fine = _series(last_checked_at=now - dt.timedelta(minutes=5), last_ok_at=now)
    assert macro.is_due(fine, now=now, after_restart=True) is False


def test_the_startup_job_asks_for_the_retry(db_session, monkeypatch):
    """스케줄러가 그 신호를 실제로 넘기는지 — 안 넘기면 위 둘이 통과해도 소용없다."""
    from app.services import scheduler

    seen = {}

    def fake_refresh_due(db, now=None, after_restart=False):
        seen["after_restart"] = after_restart
        return []

    monkeypatch.setattr(macro, "refresh_due", fake_refresh_due)
    monkeypatch.setattr(macro, "refresh_all", lambda db: [])

    scheduler._macro_refresh_job(startup=True)
    assert seen["after_restart"] is True


def test_the_daily_job_does_not_skip_because_something_else_just_ran(db_session, monkeypatch):
    """**실제로 값이 하루 뒤처졌던 자리다.**

    사용자가 UTC 16시에 키를 넣고 앱을 다시 띄웠다. 켠 직후 작업이 그 시점의 최신값
    (금요일치)을 받아왔고, 일곱 시간 뒤 23시 정기 갱신이 "아직 20시간이 안 됐다"며
    통째로 건너뛰었다. 그 사이 올라온 월요일치는 하루를 더 기다렸고, 화면에는 금요일
    날짜가 그대로 떠 있었다.

    하루에 한 번 도는 것이 이미 주기다. 거기에 "받을 때가 됐나"를 또 물으면 같은 것을
    두 번 세는 셈이고, 그 대가가 이것이다.
    """
    from app.services import scheduler

    called = []
    monkeypatch.setattr(macro, "refresh_all", lambda db: called.append("all") or [])
    monkeypatch.setattr(
        macro, "refresh_due", lambda db, now=None, after_restart=False: called.append("due") or []
    )

    scheduler._macro_refresh_job()

    assert called == ["all"], "정기 갱신은 거르지 않고 받아야 한다"


def test_a_pce_that_has_not_been_published_yet_is_not_stale(db_session):
    """**실제로 틀리게 표시했던 자리다.**

    9월 21일 화면에 "7월 PCE" 가 최신으로 떠 있고 나는 그것을 "오래됨"으로 표시했다.
    그런데 8월 PCE 는 9월 26일에 나온다 — 그때 7월분이 최신인 것은 정상이다.

    월간을 한 숫자로 재서 생긴 일이다. 8월 CPI 는 9월 중순, 8월 PCE 는 9월 말에
    나오는데 둘을 같은 자로 쟀다. 발표일을 알면 그걸로 재면 된다.
    """
    today = dt.date(2026, 9, 21)
    db_session.add(_series(code="PCEPILFE", frequency="monthly"))
    db_session.commit()
    macro.upsert_values(
        db_session,
        "PCEPILFE",
        # 7월분이고, 8월 28일에 발표됐다 (다음 것은 9월 26일)
        [MacroPoint(dt.date(2026, 7, 1), 125.3, released_at=dt.date(2026, 8, 28))],
    )

    series = {s.code: s for s in macro.active_series(db_session)}["PCEPILFE"]
    assert macro.is_stale(db_session, series, today=today) is False


def test_a_pce_that_really_stopped_coming_is_stale(db_session):
    """반대쪽도 봐야 한다 — 넉넉하게 잡느라 진짜 고장을 놓치면 표시가 무의미해진다."""
    today = dt.date(2026, 9, 21)
    db_session.add(_series(code="PCEPILFE", frequency="monthly"))
    db_session.commit()
    macro.upsert_values(
        db_session,
        "PCEPILFE",
        # 넉 달 전에 발표된 것이 아직 최신이다 — 그동안 세 번은 더 나왔어야 한다
        [MacroPoint(dt.date(2026, 4, 1), 124.0, released_at=dt.date(2026, 5, 29))],
    )

    series = {s.code: s for s in macro.active_series(db_session)}["PCEPILFE"]
    assert macro.is_stale(db_session, series, today=today) is True


def test_a_delayed_publication_counts_as_fresh(db_session):
    """발표가 밀리면 `as_of` 는 아주 오래됐는데 **방금 받은 값**이 된다.

    미국 통계는 실제로 밀린다 (연방정부 셧다운 때 몇 주씩 밀린 전례가 있다). 그때
    `as_of` 로만 재면 "다섯 달 전 값"이라 고장처럼 보이지만, 실제로는 지난주에 나온
    최신 발표다. 두 자가 정반대를 가리키는 자리라 여기서 무엇을 보는지가 드러난다.
    """
    today = dt.date(2026, 9, 21)
    db_session.add(_series(code="CPIAUCSL", frequency="monthly"))
    db_session.commit()
    macro.upsert_values(
        db_session,
        "CPIAUCSL",
        # 4월분인데(143일 전) 밀려서 9월 5일에야 나왔다 — 16일 전 발표다
        [MacroPoint(dt.date(2026, 5, 1), 320.1, released_at=dt.date(2026, 9, 5))],
    )

    series = {s.code: s for s in macro.active_series(db_session)}["CPIAUCSL"]
    # as_of 기준(100일)이면 걸린다. 발표일 기준(45일)이면 안 걸린다.
    assert (today - dt.date(2026, 5, 1)).days > macro.STALE_AFTER_DAYS["monthly"]
    assert macro.is_stale(db_session, series, today=today) is False


def test_without_a_release_date_it_falls_back_to_the_looser_ruler(db_session):
    """키가 없으면 발표일이 안 온다 (CSV 는 안 준다). 그때도 멀쩡한 걸 걸면 안 된다."""
    today = dt.date(2026, 9, 21)
    db_session.add(_series(code="PCEPILFE", frequency="monthly"))
    db_session.commit()
    macro.upsert_values(db_session, "PCEPILFE", [MacroPoint(dt.date(2026, 7, 1), 125.3)])

    series = {s.code: s for s in macro.active_series(db_session)}["PCEPILFE"]
    # as_of 로부터 82일. 예전 기준(75일)이면 걸렸다.
    assert macro.is_stale(db_session, series, today=today) is False


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


def test_restarting_leaves_alone_what_was_just_fetched(db_session, monkeypatch):
    """켠 직후 쪽 얘기다 — 서버는 하루에도 몇 번 다시 뜨고, 그때마다 20년치를 다시
    받을 수는 없다. (정기 갱신은 이렇게 거르지 않는다. 위 `_macro_refresh_job` 참고.)"""
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


# ---------------------------------------------------------------------------
#  화면이 읽는 모양
# ---------------------------------------------------------------------------


def _monthly(db_session, code: str, start_year: int, months: int, first: float, step: float):
    """`start_year`-01 부터 매달 한 점씩. 값은 `first` 에서 `step` 씩 는다.

    **부르기 전에 `macro_series` 행을 먼저 넣어야 한다.** `macro_value.code` 가 그쪽을
    가리키는 외래키다.
    """
    year, month = start_year, 1
    value = first
    for _ in range(months):
        db_session.add(MacroValue(code=code, as_of=dt.date(year, month, 1), value=value))
        value += step
        month += 1
        if month > 12:
            year, month = year + 1, 1
    db_session.commit()


def test_a_one_year_chart_of_yoy_is_not_empty(db_session):
    """**12개월치를 더 읽어야 한다.**

    "1년치를 달라"를 그대로 1년치만 읽어 전년비로 바꾸면 모든 점이 자기 12개월 전 값을
    못 찾아 **차트가 통째로 빈다.** 화면에서는 "매크로 차트가 안 뜬다"로 보이고, 값은
    멀쩡히 들어와 있으니 원인을 엉뚱한 데서 찾게 된다.
    """
    series = _series(code="CPIAUCSL", unit="index", transform="yoy", frequency="monthly")
    db_session.add(series)
    _monthly(db_session, "CPIAUCSL", 2025, 21, first=100.0, step=1.0)  # 2025-01 ~ 2026-09

    points = macro.display_points(db_session, series, start=dt.date(2026, 1, 1))

    assert points, "여유분을 안 읽으면 여기가 빈다"
    assert points[0][0] == dt.date(2026, 1, 1)
    # 12개월 전은 100+12=112, 지금은 100+0... 2026-01 은 13번째 점(112.0), 1년 전은 100.0
    assert points[0][1] == pytest.approx(12.0)


def test_the_extra_year_we_read_does_not_show_up_on_the_chart(db_session):
    """여유분은 계산에만 쓴다. 돌려주면 "1년을 눌렀는데 2년이 보인다"가 된다."""
    series = _series(code="CPIAUCSL", unit="index", transform="yoy", frequency="monthly")
    db_session.add(series)
    _monthly(db_session, "CPIAUCSL", 2025, 21, first=100.0, step=1.0)

    points = macro.display_points(db_session, series, start=dt.date(2026, 1, 1))

    assert all(as_of >= dt.date(2026, 1, 1) for as_of, _ in points)


def test_a_plain_series_is_handed_over_untouched(db_session):
    series = _series(code="DGS10", unit="percent", transform="none", frequency="daily")
    db_session.add(series)
    db_session.add_all([
        MacroValue(code="DGS10", as_of=dt.date(2026, 9, 18), value=4.05),
        MacroValue(code="DGS10", as_of=dt.date(2026, 9, 21), value=4.11),
    ])
    db_session.commit()

    assert macro.display_points(db_session, series) == [
        (dt.date(2026, 9, 18), 4.05),
        (dt.date(2026, 9, 21), 4.11),
    ]


def test_an_index_turned_into_yoy_is_no_longer_an_index():
    """저장된 단위를 그대로 쓰면 CPI 가 "2.9 지수"로 뜬다 — 그건 지수가 아니라 %다."""
    assert macro.display_unit(_series(unit="index", transform="yoy")) == "percent"
    assert macro.display_unit(_series(unit="index", transform="mom")) == "percent"
    assert macro.display_unit(_series(unit="index", transform="none")) == "index"
    assert macro.display_unit(_series(unit="level", transform="none")) == "level"


def test_the_card_shows_the_transformed_number(db_session):
    series = _series(code="CPIAUCSL", unit="index", transform="yoy", frequency="monthly")
    db_session.add(series)
    _monthly(db_session, "CPIAUCSL", 2025, 14, first=100.0, step=1.0)  # 2025-01 ~ 2026-02

    card = macro.snapshot(db_session, series, today=dt.date(2026, 3, 1))

    assert card["as_of"] == dt.date(2026, 2, 1)
    assert card["value"] == pytest.approx(12.0 / 101.0 * 100.0)  # 113.0 / 101.0
    assert card["unit"] == "percent"
    assert card["transform_label"] == "전년비"


def test_the_change_is_a_difference_not_a_ratio(db_session):
    """금리가 4.05 에서 4.11 로 갔으면 +0.06 이다. %로 다시 나누면 "%의 %"가 된다."""
    series = _series(code="DGS10", unit="percent", transform="none")
    db_session.add(series)
    db_session.add_all([
        MacroValue(code="DGS10", as_of=dt.date(2026, 9, 18), value=4.05),
        MacroValue(code="DGS10", as_of=dt.date(2026, 9, 21), value=4.11),
    ])
    db_session.commit()

    card = macro.snapshot(db_session, series, today=dt.date(2026, 9, 21))

    assert card["value"] == 4.11
    assert card["previous"] == 4.05
    assert card["change"] == pytest.approx(0.06)


def test_an_indicator_with_nothing_in_it_says_so_instead_of_showing_a_zero(db_session):
    """값이 없을 때 0 을 내면 금리가 0% 인 것처럼 보인다. 없는 것은 없다고 해야 한다."""
    series = _series(code="DGS2", last_error="FRED 가 막혔습니다")
    db_session.add(series)
    db_session.commit()

    card = macro.snapshot(db_session, series, today=dt.date(2026, 9, 21))

    assert card["value"] is None
    assert card["change"] is None
    assert card["stale"] is True
    assert card["last_error"] == "FRED 가 막혔습니다"


def test_the_spread_is_not_in_the_list_of_indicators(db_session):
    """금리차는 받아온 지표가 아니라 계산한 값이다. 목록에 섞으면 "왜 갱신 상태가
    없나"가 되고, 사용자는 고장으로 읽는다."""
    for code, value in (("DGS10", 4.11), ("DGS2", 4.36)):
        db_session.add(_series(code=code, name=code))
        db_session.add(MacroValue(code=code, as_of=dt.date(2026, 9, 21), value=value))
    db_session.commit()

    view = macro.overview(db_session, LOCAL_USER_ID, today=dt.date(2026, 9, 21))

    assert [card["code"] for card in view["series"]] == ["DGS10", "DGS2"]
    assert view["term_spread"]["value"] == pytest.approx(-0.25)
    assert view["term_spread"]["as_of"] == dt.date(2026, 9, 21)


def test_no_spread_when_the_two_rates_are_not_from_the_same_day(db_session):
    db_session.add(_series(code="DGS10"))
    db_session.add(MacroValue(code="DGS10", as_of=dt.date(2026, 9, 21), value=4.11))
    db_session.commit()

    assert macro.overview(db_session, LOCAL_USER_ID)["term_spread"] is None


# ---------------------------------------------------------------------------
#  공포·탐욕 지수
# ---------------------------------------------------------------------------


def test_fear_and_greed_has_nowhere_to_fall_back_to():
    """이름이 같은 다른 지수(alternative.me)는 **암호화폐 시장** 것이다. 폴백으로
    꽂으면 값이 조용히 다른 시장의 것으로 바뀐다 — 야후 `^TNX` 와 같은 함정이다."""
    spec = next(s for s in macro.SEED_SERIES if s["code"] == "FEARGREED")
    assert spec["fallback_source"] is None
    assert spec["fallback_code"] is None
    assert spec["source"] == "cnn"


def test_nothing_else_falls_back_to_the_fear_and_greed_provider():
    """CNN 제공자는 자기 코드에만 답하므로 폴백으로 적어봐야 조용히 건너뛴다.
    그러면 폴백이 있는 줄 알았는데 없는 셈이 된다."""
    assert [s["code"] for s in macro.SEED_SERIES if s.get("fallback_source") == "cnn"] == []


def test_fear_and_greed_is_a_plain_zero_to_hundred_number():
    """전년비로 바꾸면 안 된다 — 지수 레벨이 아니라 이미 완성된 0~100 점수다."""
    spec = next(s for s in macro.SEED_SERIES if s["code"] == "FEARGREED")
    assert spec["unit"] == "level"
    assert spec["transform"] == "none"


def test_the_card_does_not_read_twenty_years_to_show_two_numbers():
    """카드에 필요한 건 최신값과 직전값 둘뿐이다. 전 구간을 읽으면 지표 아홉 개짜리
    목록을 한 번 그릴 때마다 수만 행이 올라오고, 그건 화면을 열 때마다 반복된다."""
    assert macro.snapshot_limit(_series(transform="none", frequency="daily")) == 2
    assert macro.snapshot_limit(_series(transform="none", frequency="monthly")) == 2

    # 전년비만 예외다 — 지금 값 하나를 만드는 데 12개월 전 값이 있어야 한다
    assert macro.snapshot_limit(_series(transform="yoy", frequency="monthly")) == 16
    assert macro.snapshot_limit(_series(transform="yoy", frequency="daily")) > 250


def test_a_twenty_year_indicator_still_shows_the_right_yoy(db_session):
    """적게 읽는다고 값이 달라지면 안 된다. 20년치를 넣고 **끝의 두 점**을 확인한다."""
    series = _series(code="CPIAUCSL", unit="index", transform="yoy", frequency="monthly")
    db_session.add(series)
    _monthly(db_session, "CPIAUCSL", 2006, 12 * 20 + 8, first=100.0, step=1.0)

    card = macro.snapshot(db_session, series, today=dt.date(2026, 9, 21))

    # 2006-01 부터 248개월 -> 마지막은 2026-08. 12개월 전은 2025-08.
    assert card["as_of"] == dt.date(2026, 8, 1)
    latest, base = 100.0 + 247, 100.0 + 235
    assert card["value"] == pytest.approx((latest / base - 1) * 100)
    assert card["change"] is not None, "직전 전년비까지 나와야 변화폭을 말할 수 있다"
