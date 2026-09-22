"""국면 배지 — 규칙 하나가 배지 하나다.

DB 를 안 쓴다. 배지는 이미 계산된 스냅샷을 보는 순수 함수라 여기서 경계값을 마음껏
밟아볼 수 있고, 그게 이 구조를 고른 이유이기도 하다.
"""

import datetime as dt

from app.services import regime


def _card(code: str, value, as_of=dt.date(2026, 9, 21)) -> dict:
    return {"code": code, "value": value, "as_of": as_of}


def _spread(value, as_of=dt.date(2026, 9, 21)) -> dict:
    return {"as_of": as_of, "value": value, "long_code": "DGS10", "short_code": "DGS2"}


# --- 구간 이름 ---------------------------------------------------------------


def test_each_band_gets_its_cnn_name():
    names = [regime.zone_of("FEARGREED", v)["label"] for v in (5, 33.7, 50, 65, 90)]
    assert names == ["극단적 공포", "공포", "중립", "탐욕", "극단적 탐욕"]


def test_the_band_carries_the_numbers_it_covers():
    """이름만 적으면 33.7이 왜 공포인지 알 수 없다."""
    assert regime.zone_of("FEARGREED", 33.7)["range"] == "25~44"


def test_only_the_two_ends_count_as_extreme():
    assert regime.zone_of("FEARGREED", 10)["extreme"] is True
    assert regime.zone_of("FEARGREED", 90)["extreme"] is True
    assert regime.zone_of("FEARGREED", 33.7)["extreme"] is False
    assert regime.zone_of("FEARGREED", 50)["extreme"] is False


def test_the_boundary_value_rounds_the_way_cnn_prints_it():
    """44.6 은 CNN 화면에 45로 뜨고, 45는 중립이다. 소수로 따지면 화면과 어긋난다."""
    assert regime.zone_of("FEARGREED", 44.4)["label"] == "공포"
    assert regime.zone_of("FEARGREED", 44.6)["label"] == "중립"
    assert regime.zone_of("FEARGREED", 55.4)["label"] == "중립"
    assert regime.zone_of("FEARGREED", 55.6)["label"] == "탐욕"


def test_an_impossible_value_does_not_fall_through():
    assert regime.zone_of("FEARGREED", 120)["label"] == "극단적 탐욕"
    assert regime.zone_of("FEARGREED", -5)["label"] == "극단적 공포"


def test_indicators_without_a_published_band_get_none():
    """금리 4.2%가 어느 "구간"인지는 아무도 정해놓지 않았다 — 우리가 정하면 출처 없는 판정이다."""
    assert regime.zone_of("DGS10", 4.2) is None
    assert regime.zone_of("VIX", 33.0) is None


def test_no_value_means_no_zone():
    assert regime.zone_of("FEARGREED", None) is None


# --- 배지 --------------------------------------------------------------------


def test_nothing_unusual_means_no_badges():
    """빈 목록도 정보다 — 화면은 "눈에 띄는 국면 없음"이라고 말할 수 있어야 한다."""
    assert regime.badges([_card("VIX", 15.0), _card("FEARGREED", 50.0)], _spread(0.4)) == []


def test_an_inverted_curve_gets_a_badge():
    found = regime.badges([], _spread(-0.12))
    assert [b["key"] for b in found] == ["inverted_curve"]
    assert found[0]["label"] == "장단기 금리 역전"
    # 얼마나 역전됐는지가 배지에 같이 있어야 한다 — 이름만으로는 −0.02와 −1.5가 같아 보인다
    assert "-0.12%p" in found[0]["detail"]
    assert found[0]["as_of"] == dt.date(2026, 9, 21)


def test_a_normal_curve_gets_nothing():
    assert regime.badges([], _spread(0.4)) == []


def test_a_flat_curve_is_not_inverted():
    """0은 역전이 아니다. 여기서 부등호가 새면 정상인 날에도 경고가 뜬다."""
    assert regime.badges([], _spread(0.0)) == []


def test_no_spread_at_all_is_not_an_inversion():
    """금리 둘 중 하나가 아직 안 들어온 것을 역전으로 읽으면 안 된다."""
    assert regime.badges([], None) == []


def test_high_vix_gets_a_badge():
    found = regime.badges([_card("VIX", 32.4)])
    assert [b["key"] for b in found] == ["vix_fear"]
    assert found[0]["label"] == "공포 구간"
    assert "32.4" in found[0]["detail"]


def test_vix_exactly_at_the_line_is_not_fear():
    assert regime.badges([_card("VIX", regime.VIX_FEAR)]) == []


def test_an_extreme_fear_greed_gets_its_own_name_as_the_badge():
    found = regime.badges([_card("FEARGREED", 12.0)])
    assert [b["key"] for b in found] == ["fear_greed_extreme"]
    assert found[0]["label"] == "극단적 공포"
    assert "12점" in found[0]["detail"]


def test_a_middling_fear_greed_stays_off_the_badge_row():
    """구간 이름은 카드에 늘 적히지만, 배지는 눈에 띌 때만 뜬다."""
    assert regime.badges([_card("FEARGREED", 33.7)]) == []


def test_rules_do_not_know_about_each_other():
    """셋이 동시에 참이면 셋 다 뜬다 — 합쳐서 한 마디로 만들지 않는다."""
    found = regime.badges(
        [_card("VIX", 41.0), _card("FEARGREED", 8.0)],
        _spread(-0.35),
    )
    assert [b["key"] for b in found] == ["inverted_curve", "vix_fear", "fear_greed_extreme"]


def test_no_badge_is_coloured_like_a_verdict():
    """빨강/초록은 "팔아라/사라"로 읽힌다. 배지가 하는 말은 "보고 가라"까지다."""
    found = regime.badges([_card("VIX", 41.0), _card("FEARGREED", 8.0)], _spread(-0.35))
    assert {b["tone"] for b in found} == {"amber"}


def test_missing_values_do_not_raise():
    """받아온 적 없는 지표(값 None)가 섞여 있어도 화면은 떠야 한다."""
    assert regime.badges([_card("VIX", None), _card("FEARGREED", None)], None) == []


# --- 물가가 예상을 상회 -------------------------------------------------------


def _inflation(value, forecast=None, pending=None, code="CPIAUCSL", name="CPI") -> dict:
    """물가 카드 한 장. `attach_forecasts` 가 붙여주는 모양 그대로."""
    def wrap(item):
        if item is None:
            return None
        as_of, number = item
        return {
            "as_of": as_of,
            "value": number,
            "source": "manual",
            "source_label": "직접 입력",
            "forecast_date": dt.date(2026, 9, 10),
            "surprise": None,
        }

    return {
        "code": code,
        "name": name,
        "value": value,
        "as_of": dt.date(2026, 8, 1),
        "forecastable": True,
        "forecast": wrap(forecast),
        "pending_forecast": wrap(pending),
    }


def test_no_forecast_means_no_badge():
    """비교할 예상치가 없으면 아무 말도 하지 않는다 — 2% 목표 같은 우리 기준을 쓰지 않는다."""
    assert regime.badges([_inflation(3.4)]) == []


def test_coming_in_above_the_forecast_raises_the_badge():
    found = regime.badges([_inflation(3.2, forecast=(dt.date(2026, 8, 1), 3.0))])

    assert [b["label"] for b in found] == ["물가 상회"]
    assert found[0]["tone"] == "amber"
    assert found[0]["as_of"] == dt.date(2026, 8, 1)


def test_the_badge_says_which_price_and_against_what():
    """이름만 있으면 어느 물가가 무엇과 비교해 얼마나 넘었는지가 전부 빠진다."""
    found = regime.badges([_inflation(3.2, forecast=(dt.date(2026, 8, 1), 3.0))])

    detail = found[0]["detail"]
    assert "CPI" in detail
    assert "3.2%" in detail
    assert "예상 3.0%" in detail
    assert "직접 입력" in detail


def test_meeting_the_forecast_is_not_beating_it():
    assert regime.badges([_inflation(3.0, forecast=(dt.date(2026, 8, 1), 3.0))]) == []


def test_coming_in_below_says_nothing():
    """예상을 밑돈 것은 이 규칙이 하는 말이 아니다."""
    assert regime.badges([_inflation(2.8, forecast=(dt.date(2026, 8, 1), 3.0))]) == []


def test_our_own_rounding_tail_is_not_a_surprise():
    """전년비는 지수에서 계산한 값이라 3.0049 처럼 나온다. 그건 상회가 아니다."""
    assert regime.badges([_inflation(3.0049, forecast=(dt.date(2026, 8, 1), 3.0))]) == []


def test_a_real_tenth_of_a_point_counts():
    found = regime.badges([_inflation(3.06, forecast=(dt.date(2026, 8, 1), 3.0))])
    assert len(found) == 1


def test_a_forecast_for_a_month_not_out_yet_decides_nothing():
    """비교할 실제값이 없는 예상치로 판정하면 그건 예측이지 사실이 아니다."""
    assert regime.badges([_inflation(3.4, pending=(dt.date(2026, 9, 1), 3.0))]) == []


def test_two_prices_beating_their_forecasts_make_two_badges():
    """합쳐서 한 마디로 만들면 어느 쪽이 얼마나 넘었는지가 사라진다."""
    found = regime.badges([
        _inflation(3.2, forecast=(dt.date(2026, 8, 1), 3.0), code="CPIAUCSL", name="CPI"),
        _inflation(2.9, forecast=(dt.date(2026, 8, 1), 2.7), code="PCEPILFE", name="근원 PCE"),
    ])

    assert len(found) == 2
    assert {b["key"] for b in found} == {
        "inflation_above_forecast:CPIAUCSL",
        "inflation_above_forecast:PCEPILFE",
    }


def test_something_that_is_not_a_price_never_says_price_above_forecast():
    """월간이라고 다 물가가 아니다 — 실업률 발표에 "물가 상회"라고 적히면 안 된다."""
    card = _inflation(4.4, forecast=(dt.date(2026, 8, 1), 4.2), code="UNRATE", name="실업률")
    assert regime.badges([card]) == []


def test_the_rules_do_not_know_about_each_other():
    found = regime.badges(
        [_card("VIX", 32.4), _inflation(3.2, forecast=(dt.date(2026, 8, 1), 3.0))],
        _spread(-0.27),
    )
    assert [b["key"] for b in found] == [
        "inverted_curve",
        "vix_fear",
        "inflation_above_forecast:CPIAUCSL",
    ]


def test_the_price_rules_read_indicators_the_home_screen_must_also_load():
    """홈은 `WATCHED_CODES` 만 더 읽는다. 물가가 빠지면 홈에서만 이 배지가 사라진다."""
    for code in regime.INFLATION_CODES:
        assert code in regime.WATCHED_CODES
