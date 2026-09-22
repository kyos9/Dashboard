"""공포·탐욕 지수 제공자.

네트워크를 타지 않고 **응답 해석만** 확인한다 (FRED 와 같은 방식). 여기서 중요한 것은
값이 맞느냐보다 **틀린 값을 안 받아들이느냐**다 — 문서 없는 주소라 모양이 바뀌면
말없이 이상한 숫자가 들어오는 게 가장 나쁜 결과다.
"""

import datetime as dt
import json

import pytest

from app.services.providers import build_macro_providers
from app.services.providers.base import EmptyData, ProviderUnavailable, TickerNotFound
from app.services.providers.cnn import CODE, FearGreedProvider


def body(historical=None, current=None) -> str:
    payload = {}
    if historical is not None:
        payload["fear_and_greed_historical"] = {"data": historical}
    if current is not None:
        payload["fear_and_greed"] = current
    return json.dumps(payload)


def day(as_of: str) -> int:
    """날짜를 CNN 이 쓰는 epoch 밀리초로."""
    when = dt.datetime.fromisoformat(as_of).replace(tzinfo=dt.timezone.utc)
    return int(when.timestamp() * 1000)


def test_reads_the_historical_series():
    provider = FearGreedProvider()
    points = provider.parse_response(
        200,
        body(historical=[
            {"x": day("2026-09-18"), "y": 41.2, "rating": "fear"},
            {"x": day("2026-09-19"), "y": 55.8, "rating": "greed"},
        ]),
        CODE,
    )
    assert [(p.as_of, p.value) for p in points] == [
        (dt.date(2026, 9, 18), 41.2),
        (dt.date(2026, 9, 19), 55.8),
    ]


def test_todays_value_is_not_always_in_the_historical_list():
    """화면에 뜨는 숫자는 `fear_and_greed` 쪽이다. 과거 목록만 읽으면 하루 뒤처진다."""
    provider = FearGreedProvider()
    points = provider.parse_response(
        200,
        body(
            historical=[{"x": day("2026-09-18"), "y": 41.2}],
            current={"score": 47.5, "timestamp": "2026-09-19T23:59:56+00:00"},
        ),
        CODE,
    )
    assert points[-1].as_of == dt.date(2026, 9, 19)
    assert points[-1].value == 47.5


def test_a_naive_timestamp_is_read_as_utc():
    """시간대를 안 달고 오면 UTC 로 본다 — 지역시로 읽으면 자정 근처가 하루 밀린다."""
    provider = FearGreedProvider()
    points = provider.parse_response(
        200, body(historical=[], current={"score": 30.0, "timestamp": "2026-09-19T23:30:00"}), CODE
    )
    assert points[0].as_of == dt.date(2026, 9, 19)


@pytest.mark.parametrize("bad", [-3.0, 101.0, 1663718400000.0])
def test_values_outside_zero_to_hundred_are_dropped(bad):
    """0~100 을 벗어난 값은 지수가 아니다. 그대로 받아들이면 차트가 조용히 망가진다."""
    provider = FearGreedProvider()
    points = provider.parse_response(
        200,
        body(historical=[
            {"x": day("2026-09-18"), "y": bad},
            {"x": day("2026-09-19"), "y": 55.8},
        ]),
        CODE,
    )
    assert [p.value for p in points] == [55.8]


def test_a_response_with_nothing_usable_is_an_error_not_an_empty_chart():
    provider = FearGreedProvider()
    with pytest.raises(EmptyData):
        provider.parse_response(200, body(historical=[{"x": None, "y": None}]), CODE)


def test_a_changed_response_shape_says_so():
    """`data` 자리가 사라지면 "값이 없다"가 아니라 "모양이 바뀌었다"로 알려야 한다."""
    provider = FearGreedProvider()
    with pytest.raises(ProviderUnavailable, match="fear_and_greed_historical"):
        provider.parse_response(200, json.dumps({"something_else": 1}), CODE)


def test_html_instead_of_json():
    provider = FearGreedProvider()
    with pytest.raises(ProviderUnavailable):
        provider.parse_response(200, "<html>nope</html>", CODE)


def test_a_missing_address_is_not_a_network_problem():
    provider = FearGreedProvider()
    with pytest.raises(TickerNotFound):
        provider.parse_response(404, "", CODE)


def test_it_only_answers_to_its_own_code():
    """**다른 지표의 폴백으로 잘못 적어도 공포지수 값이 들어가지 않게.**

    `supports` 가 아무 코드에나 참이면 CPI 자리에 0~100 짜리 숫자가 들어앉는다.
    날짜도 맞고 숫자도 그럴듯해서 화면에서는 안 보인다.
    """
    provider = FearGreedProvider()
    assert provider.supports("fearandgreed")
    assert provider.supports("FearAndGreed")  # 대소문자는 봐준다
    assert not provider.supports("CPIAUCSL")
    assert not provider.supports("^VIX")


def test_the_registry_knows_it():
    providers = build_macro_providers("cnn")
    assert [p.name for p in providers] == ["cnn"]
