"""Gemini 한도 오류(429)를 할 일에 맞게 나눈다 (ROADMAP 9-14).

Gemini 의 429 문장은 늘 "plan and billing details 를 확인하라"고 적는다. 그것만 보고 "잔액 부족"으로
읽으면 무료 등급 사용자는 할 일을 모른다. 걸린 한도(`QuotaFailure`)와 기다릴 시간(`RetryInfo`)을 본다.
"""

from __future__ import annotations

import pytest

from app.services.providers import ai
from tests.test_ai import KEY, fake  # noqa: F401  (픽스처)
from tests.test_ai_stream import fake_stream  # noqa: F401  (픽스처)

MESSAGE = ("You exceeded your current quota, please check your plan and billing details. For more information on "
           "this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, "
           "head to: https://ai.dev/rate-limit. ")


def quota_error(quota_id: str | None, value, model="gemini-x-flash", retry: str | None = "34.5s", extra=""):
    details: list[dict] = []
    if quota_id:
        details.append({
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            "violations": [{
                "quotaMetric": "generativelanguage.googleapis.com/generate_content_free_tier_requests",
                "quotaId": quota_id,
                "quotaDimensions": {"location": "global", "model": model},
                "quotaValue": value,
            }],
        })
    details.append({"@type": "type.googleapis.com/google.rpc.Help", "links": [{"url": "https://ai.google.dev"}]})
    if retry:
        details.append({"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": retry})
    return ai.Response(429, {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED",
                                       "message": MESSAGE + extra, "details": details}})


@pytest.mark.parametrize("res, code", [
    # 무료 등급에 없는 모델 — 한도가 0
    (quota_error("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "0"), "free_tier_model"),
    (quota_error("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", 0), "free_tier_model"),
    # 한도 값이 details 에 없고 문장에만 있을 때
    (quota_error(None, None, extra="\n* Quota exceeded for metric: x, limit: 0, model: gemini-x-pro"), "free_tier_model"),
    # 오늘 몫을 다 썼다
    (quota_error("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "20"), "daily_limit"),
    # 1분 몫 — 요청 수든 토큰 수든
    (quota_error("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "10"), "rate_limited"),
    (quota_error("GenerateContentInputTokensPerModelPerMinute-FreeTier", "250000"), "rate_limited"),
    # 기다릴 시간만 있다
    (quota_error(None, None), "rate_limited"),
    # 아무것도 없다 — 결제 문제라고 단정하지 않는다
    (quota_error(None, None, retry=None), "quota_exceeded"),
    # "limit: 0" 은 "limit: 0.5"·"limit: 05" 와 다르다
    (quota_error(None, None, retry=None, extra="limit: 0.5"), "quota_exceeded"),
    (quota_error(None, None, retry=None, extra="limit: 05"), "quota_exceeded"),
    # 선불 크레딧이 떨어진 것은 잔액 문제다
    (ai.Response(429, {"error": {"status": "RESOURCE_EXHAUSTED",
                                 "message": "Your prepayment credits are depleted."}}), "no_credit"),
])
def test_gemini_quota_errors_say_what_to_do(fake, res, code):  # noqa: F811
    fake.replies.append(res)
    with pytest.raises(ai.AiError) as caught:
        ai.PROVIDERS["gemini"].generate(KEY, "gemini-x-flash", "s", "p")
    assert caught.value.code == code
    assert caught.value.status == ai.ERRORS[code][0] and caught.value.hint


def test_billing_wording_alone_is_not_read_as_no_credit(fake):  # noqa: F811
    """v0.38.0 까지: 문장에 "billing" 이 있으면 잔액 부족이라고 했다 — 무료 등급 사용자가 받은 그 안내."""
    fake.replies.append(quota_error("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "20"))
    with pytest.raises(ai.AiError) as caught:
        ai.PROVIDERS["gemini"].generate(KEY, "m", "s", "p")
    assert caught.value.code != "no_credit"
    assert "잔액" not in caught.value.hint and "다른 모델" in caught.value.hint


def test_the_quota_that_was_hit_is_kept_in_front_of_the_long_message(fake):  # noqa: F811
    """제공자 문장이 길어 300자에서 잘리면 어느 한도인지가 사라졌다 — 앞에 붙인다."""
    fake.replies.append(quota_error("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "20",
                                    extra="x" * 400))
    with pytest.raises(ai.AiError) as caught:
        ai.PROVIDERS["gemini"].generate(KEY, "m", "s", "p")
    message = caught.value.message
    assert message.startswith("gemini HTTP 429: [GenerateRequestsPerDayPerProjectPerModel-FreeTier "
                              "model gemini-x-flash limit 20 · retry 35s] You exceeded")
    assert len(message) <= ai.MESSAGE_LIMIT


def test_rate_limit_hint_says_how_long_to_wait(fake):  # noqa: F811
    fake.replies.append(quota_error("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "10", retry="7s"))
    with pytest.raises(ai.AiError) as caught:
        ai.PROVIDERS["gemini"].generate(KEY, "m", "s", "p")
    assert "7초쯤 뒤" in caught.value.hint
    # 기다릴 시간을 모르면 늘 하던 말
    fake.replies.append(quota_error("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "10", retry="soon"))
    with pytest.raises(ai.AiError) as caught:
        ai.PROVIDERS["gemini"].generate(KEY, "m", "s", "p")
    assert caught.value.hint == ai.ERRORS["rate_limited"][1]


def test_streaming_reports_the_same_quota_error(fake_stream):  # noqa: F811
    """흘려받기도 연결할 때 상태를 본다 — 같은 번역을 거친다."""
    res = quota_error("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "0")
    fake_stream.replies.append((429, res.body, []))
    with pytest.raises(ai.AiError) as caught:
        ai.PROVIDERS["gemini"].stream(KEY, "m", "s", "p", search=True)
    # 검색을 켠 요청이라도 한도 오류는 "검색 불가"로 바꾸지 않는다
    assert caught.value.code == "free_tier_model"
    assert "limit 0" in caught.value.message


def test_other_providers_errors_are_unchanged(fake):  # noqa: F811
    fake.replies.append(ai.Response(429, {"error": {"type": "rate_limit_error", "message": "slow " + MESSAGE}}))
    with pytest.raises(ai.AiError) as caught:
        ai.PROVIDERS["anthropic"].generate(KEY, "m", "s", "p")
    assert caught.value.code == "rate_limited" and caught.value.message.startswith("anthropic HTTP 429: slow")


def test_gemini_model_list_drops_unusable_models_and_puts_stable_ones_first(fake):  # noqa: F811
    gen = ["generateContent", "countTokens"]
    fake.replies.append(ai.Response(200, {"models": [
        {"name": "models/gemini-9-pro-preview-06", "displayName": "Gemini 9 Pro Preview", "supportedGenerationMethods": gen},
        {"name": "models/gemini-9-flash-exp", "displayName": "Gemini 9 Flash", "supportedGenerationMethods": gen},
        {"name": "models/gemini-9-flash", "displayName": "Gemini 9 Flash", "supportedGenerationMethods": gen},
        {"name": "models/gemma-4-27b-it", "displayName": "Gemma 4", "supportedGenerationMethods": gen},
        {"name": "models/gemini-robotics-er-1", "displayName": "Robotics", "supportedGenerationMethods": gen},
        {"name": "models/gemini-9-computer-use-preview", "displayName": "CU", "supportedGenerationMethods": gen},
        {"name": "models/deep-research-pro-preview", "displayName": "DR", "supportedGenerationMethods": gen},
        {"name": "models/learnlm-2.0-flash", "displayName": "LearnLM", "supportedGenerationMethods": gen},
        {"name": "models/gemini-9-flash-lite", "displayName": "Gemini 9 Flash-Lite", "supportedGenerationMethods": gen},
    ]}))
    assert ai.PROVIDERS["gemini"].list_models(KEY) == [
        {"id": "gemini-9-flash", "label": "Gemini 9 Flash"},
        {"id": "gemini-9-flash-lite", "label": "Gemini 9 Flash-Lite"},
        {"id": "gemini-9-pro-preview-06", "label": "Gemini 9 Pro Preview"},
        {"id": "gemini-9-flash-exp", "label": "Gemini 9 Flash (미리보기)"},
    ]
