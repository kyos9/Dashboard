"""클리블랜드 연준 나우캐스트 응답 읽기.

**실제 네트워크는 쓰지 않는다.** 여기 있는 가짜 응답은 실제 파일에서 그대로 베낀
모양이다 — 차트 한 장이 목표 달 하나이고, x축은 그 달을 예측하던 날들이며, 같은 장에
예상치 선 넷과 "Actual …" 선 넷이 나란히 들어 있다.
"""

import datetime as dt
import json

import pytest

from app.services.providers import EmptyData, ProviderUnavailable, TickerNotFound
from app.services.providers.cleveland import ClevelandNowcastProvider

MOM = "Month-over-month percent change"


def _series(name: str, values: list[str], actual: bool = False) -> dict:
    """선 하나. 실제 파일처럼 값은 문자열이고 빈 칸은 빈 문자열이다."""
    return {
        "seriesname": name,
        "color": "e03430",
        "data": [{"value": v, "tooltext": f"{name}{{br}}{v}"} for v in values],
    }


def _chart(month: str, labels: list[dict], series: list[dict], unit: str = MOM) -> dict:
    return {
        "chart": {"_comment": "2026-09-21 00:00", "caption": "Inflation Nowcasting",
                  "subcaption": month, "yaxisname": unit},
        "categories": [{"category": labels}],
        "dataset": series,
    }


def _day(label: str) -> dict:
    return {"label": label}


def _vline(label: str) -> dict:
    """발표일 표시. 날이 아니라 세로선이고, 값 쪽에는 이 자리가 없다."""
    return {"label": label, "lineposition": "0", "color": "666666", "vline": "true"}


def _parse(payload) -> list:
    return ClevelandNowcastProvider().parse_response(200, json.dumps(payload))


def _by_code(points, code):
    return [p for p in points if p.code == code]


# --- 기본 -------------------------------------------------------------------


def test_one_chart_is_one_target_month():
    points = _parse([_chart("2026-9", [_day("09/01"), _day("09/02")],
                            [_series("CPI Inflation", ["0.25", "0.36"])])])

    assert {p.as_of for p in points} == {dt.date(2026, 9, 1)}
    assert [p.forecast_date for p in points] == [dt.date(2026, 9, 1), dt.date(2026, 9, 2)]
    assert [p.value for p in points] == [0.25, 0.36]


def test_all_four_price_series_are_read():
    points = _parse([_chart("2026-9", [_day("09/01")], [
        _series("CPI Inflation", ["0.4"]),
        _series("Core CPI Inflation", ["0.2"]),
        _series("PCE Inflation", ["0.3"]),
        _series("Core PCE Inflation", ["0.27"]),
    ])])

    assert {p.code for p in points} == {"CPIAUCSL", "CPILFESL", "PCEPI", "PCEPILFE"}


def test_a_day_with_no_nowcast_yet_makes_no_point():
    """빈 칸을 0 으로 읽으면 "물가가 0% 로 예상된다" 는 날이 생긴다."""
    points = _parse([_chart("2026-9", [_day("09/01"), _day("09/02")],
                            [_series("CPI Inflation", ["", "0.36"])])])

    assert [p.forecast_date for p in points] == [dt.date(2026, 9, 2)]


# --- 이 파일에서 조용히 틀리기 쉬운 자리 --------------------------------------


def test_the_release_marker_does_not_shift_the_dates():
    """발표일 세로선이 **목록 가운데** 끼어 있는데 값 쪽에는 그 자리가 없다.

    걸러내지 않으면 그 뒤로 값이 전부 하루씩 밀린다. 밀린 예상치는 값이 없는 것보다
    나쁘다 — 틀렸는데 그럴듯해 보인다.
    """
    labels = [_day("09/10"), _day("09/11"), _vline("CPI Aug"), _day("09/14"), _day("09/15")]
    points = _parse([_chart("2026-9", labels,
                            [_series("CPI Inflation", ["0.36", "0.37", "0.38", "0.39"])])])

    assert [p.forecast_date for p in points] == [
        dt.date(2026, 9, 10), dt.date(2026, 9, 11), dt.date(2026, 9, 14), dt.date(2026, 9, 15),
    ]
    assert dict(zip((p.forecast_date for p in points), (p.value for p in points)))[
        dt.date(2026, 9, 14)
    ] == 0.38


def test_a_marker_labelled_like_a_date_is_still_not_a_day():
    """지금은 세로선 이름이 "CPI Aug" 라서 날짜로 안 읽히고 저절로 빠진다.

    그래서 세로선을 안 걸러도 **지금은** 결과가 같다. 저쪽이 표시를 날짜로 바꾸는
    순간(있을 법한 일이다) 그 자리가 날 하나로 세어져서 그 뒤가 전부 밀린다.
    걸러내는 쪽이 의도이므로 의도를 테스트한다.
    """
    # 실제 파일처럼 값은 **날 수만큼**만 온다 (세로선 자리는 값에 없다)
    labels = [_day("09/11"), _vline("09/12"), _day("09/14")]
    points = _parse([_chart("2026-9", labels,
                            [_series("CPI Inflation", ["0.36", "0.38"])])])

    assert [(p.forecast_date, p.value) for p in points] == [
        (dt.date(2026, 9, 11), 0.36),
        (dt.date(2026, 9, 14), 0.38),
    ]


def test_the_actual_line_is_not_a_forecast():
    """같은 장에 실제값이 "Actual …" 로 나란히 있다. 예상치로 읽으면 예상과 실제가
    항상 같아져서 배지가 영영 안 뜨고, 그건 화면에서 안 보인다."""
    points = _parse([_chart("2026-9", [_day("09/11")], [
        _series("CPI Inflation", ["0.37"]),
        _series("Actual CPI Inflation", ["0.31"], actual=True),
        _series("Actual Core PCE Inflation", ["0.08"], actual=True),
    ])])

    assert [(p.code, p.value) for p in points] == [("CPIAUCSL", 0.37)]


def test_a_december_nowcast_made_in_january_lands_in_the_next_year():
    """라벨에 연도가 없다. 12월분은 1월에도 예측하므로 그대로 두면 한 해 전으로 찍힌다."""
    points = _parse([_chart("2026-12", [_day("12/30"), _day("01/05")],
                            [_series("CPI Inflation", ["0.3", "0.4"])])])

    assert [p.forecast_date for p in points] == [dt.date(2026, 12, 30), dt.date(2027, 1, 5)]
    assert {p.as_of for p in points} == {dt.date(2026, 12, 1)}


def test_a_line_whose_length_does_not_match_the_days_is_dropped():
    """줄이 어긋나면 날짜가 밀린 예상치가 들어간다. 그럴 바엔 안 받는다."""
    points = _parse([_chart("2026-9", [_day("09/01"), _day("09/02")], [
        _series("CPI Inflation", ["0.25"]),          # 날은 둘인데 값은 하나
        _series("Core CPI Inflation", ["0.1", "0.2"]),
    ])])

    assert {p.code for p in points} == {"CPILFESL"}


# --- 단위 -------------------------------------------------------------------


def test_the_unit_the_file_declares_comes_along():
    """이 파일은 전월비를 낸다. 우리 카드는 전년비로 뜨므로 그대로 넣으면
    실제 3.2% 와 예상 0.44% 를 비교하게 된다 — 숫자가 둘 다 그럴듯해서 안 보인다."""
    points = _parse([_chart("2026-9", [_day("09/01")], [_series("CPI Inflation", ["0.44"])])])

    assert {p.unit for p in points} == {"mom"}


def test_a_year_over_year_file_is_marked_as_such():
    points = _parse([_chart("2026-9", [_day("09/01")], [_series("CPI Inflation", ["3.1"])],
                            unit="Year-over-year percent change")])

    assert {p.unit for p in points} == {"yoy"}


def test_a_unit_we_do_not_know_is_refused():
    """단위가 바뀌면 값이 조용히 다른 뜻이 된다. 받지 않는 편이 낫다."""
    with pytest.raises(EmptyData):
        _parse([_chart("2026-9", [_day("09/01")], [_series("CPI Inflation", ["0.44"])],
                       unit="Annualized quarterly percent change")])


# --- 응답이 이상할 때 ---------------------------------------------------------


def test_a_missing_file_says_so():
    with pytest.raises(TickerNotFound):
        ClevelandNowcastProvider().parse_response(404, "")


def test_a_server_error_is_not_empty_data():
    with pytest.raises(ProviderUnavailable):
        ClevelandNowcastProvider().parse_response(503, "")


def test_html_instead_of_json_says_what_came_back():
    with pytest.raises(ProviderUnavailable) as caught:
        ClevelandNowcastProvider().parse_response(200, "<!DOCTYPE html><html>")
    assert "JSON" in str(caught.value)


def test_a_shape_we_do_not_recognize_is_refused():
    with pytest.raises(ProviderUnavailable):
        ClevelandNowcastProvider().parse_response(200, '{"chart": {}}')


def test_a_file_with_nothing_readable_is_empty_data():
    with pytest.raises(EmptyData):
        _parse([_chart("2026-9", [_day("09/01")], [_series("Actual CPI Inflation", ["0.3"])])])


# --- 실제 파일에서 그대로 옮긴 조각 --------------------------------------------
#
# 위 가짜들은 내가 만든 모양이라 "내가 생각한 모양"만 확인한다. 이건 2026-09-21 자
# 실제 응답의 마지막 차트에서 그대로 옮긴 것이다 — 날짜 15칸(가운데 발표일 세로선
# 하나), 값 14칸. 여기서 한 칸이라도 밀리면 9/14 이후가 통째로 어긋난다.

REAL_LABELS = ["09/01", "09/02", "09/03", "09/04", "09/08", "09/09", "09/10", "09/11",
               None, "09/14", "09/15", "09/16", "09/17", "09/18", "09/21"]  # None 자리가 세로선

REAL_CPI = ["0.257934039296893", "0.366116844395547", "0.378859530573032",
            "0.382153558292383", "0.396439236401564", "0.405558492087764",
            "0.364314996266776", "0.368850154748134", "0.368850154748134",
            "0.368850154748134", "0.434980660787975", "0.434980660787975",
            "0.434980660787975", "0.434980660787975"]


def _real_chart() -> dict:
    labels = [_vline("CPI Aug") if lab is None else _day(lab) for lab in REAL_LABELS]
    return _chart("2026-9", labels, [
        _series("CPI Inflation", REAL_CPI),
        _series("Actual CPI Inflation", [""] * len(REAL_CPI), actual=True),
    ])


def test_the_real_september_chart_reads_the_way_the_website_shows_it():
    points = _parse([_real_chart()])

    assert len(points) == 14
    assert {p.code for p in points} == {"CPIAUCSL"}
    assert {p.as_of for p in points} == {dt.date(2026, 9, 1)}
    assert {p.unit for p in points} == {"mom"}

    by_day = {p.forecast_date: p.value for p in points}
    # 세로선 뒤의 날들. 밀렸다면 9/14 에 9/11 값이 아니라 그 다음 값이 들어간다.
    assert by_day[dt.date(2026, 9, 11)] == pytest.approx(0.368850154748134)
    assert by_day[dt.date(2026, 9, 14)] == pytest.approx(0.368850154748134)
    assert by_day[dt.date(2026, 9, 16)] == pytest.approx(0.434980660787975)
    # 마지막 날이 곧 "지금 예상"이다
    assert max(by_day) == dt.date(2026, 9, 21)
    assert by_day[dt.date(2026, 9, 21)] == pytest.approx(0.434980660787975)
