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


# ---------------------------------------------------------------------------
#  없는 기간을 묻지 않는다
# ---------------------------------------------------------------------------


def asked_url(provider, start, status=200, payload=None) -> str:
    """`fetch` 가 실제로 부른 주소. (네트워크는 가짜로 막는다.)"""
    seen = {}

    class FakeResponse:
        status_code = status
        text = payload if payload is not None else body(
            historical=[{"x": day("2026-09-18"), "y": 41.2}]
        )

    def fake_get(url, **kwargs):
        seen["url"] = url
        return FakeResponse()

    import requests

    original = requests.get
    requests.get = fake_get
    try:
        provider.fetch(CODE, start=start)
    finally:
        requests.get = original
    return seen["url"]


def test_it_does_not_ask_for_years_this_index_does_not_have():
    """**실제로 서버에서 지표가 통째로 안 들어왔던 이유다.**

    앱은 지표를 처음 받을 때 20년치를 달라고 하는데(`BACKFILL_YEARS`), 이 지수는
    그만큼 오래되지 않았다. 없는 기간을 물었더니 "그 기간은 없다"가 아니라 **HTTP 500**
    이 왔고 화면에는 아무것도 안 떴다. 60일치를 물은 진단은 성공해서 더 헷갈렸다.
    """
    from app.services.providers.cnn import EARLIEST

    url = asked_url(FearGreedProvider(), start=dt.date(2006, 9, 27))

    assert url.endswith(EARLIEST.isoformat()), f"20년 전을 그대로 물었다: {url}"


def test_a_range_this_index_does_have_is_asked_as_is():
    """무조건 자르면 안 된다 — 있는 기간까지 못 받게 된다."""
    url = asked_url(FearGreedProvider(), start=dt.date(2026, 7, 24))
    assert url.endswith("2026-07-24")


def test_a_five_hundred_says_what_it_usually_means():
    """그냥 "HTTP 500" 만 뜨면 저쪽 고장인 줄 알고 기다리게 된다. 실제로는 우리가
    없는 기간을 물어서 그랬다."""
    provider = FearGreedProvider()
    with pytest.raises(ProviderUnavailable, match="없는 기간"):
        provider.parse_response(500, "", CODE)


def test_the_advice_names_the_place_that_actually_failed():
    """**실제로 엉뚱한 안내를 했다.** 공포·탐욕 지수(CNN)가 실패했는데 "FRED 로 나가지
    못하고 있습니다" 라고 했다 — FRED 는 멀쩡했고, 사용자는 방화벽에서 엉뚱한 주소를
    찾게 된다. 지표마다 출처가 다른데 안내에 한 곳 이름을 박아둔 탓이었다."""
    from app.services.providers import AllMacroProvidersFailed
    from app.services.providers.base import ProviderUnavailable as Unavailable

    failed = AllMacroProvidersFailed("FEARGREED", [Unavailable("cnn", "HTTP 500")])

    assert failed.providers == ["cnn"]
    assert "cnn" in failed.hint()
    assert "FRED" not in failed.hint()
