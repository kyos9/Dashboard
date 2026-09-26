"""AI 정리 (ROADMAP 3c) — 키는 지나가기만 하고, 오류는 번역되고, 넘기는 것은 공용 데이터뿐이다.

제공자는 가짜다(`ai.send` 를 바꿔 끼운다). 실제 키로 부르는 확인은 서버에서 사람이 한다.
"""

from __future__ import annotations

import datetime as dt
import logging

import pytest
import requests

from app.models import IndicatorDaily, PriceDaily, SignalDaily
from app.services import ai_analysis, fundamentals, limits
from app.services.providers import ai
from tests.factories import make_holding, make_stock
from tests.test_fundamentals import NOW, _prices, fake_sec  # noqa: F401  (픽스처)

KEY = "sk-ant-api03-SECRETSECRETSECRET-abcdEFGH"
D = dt.date


class FakeProvider:
    """`ai.send` 대신. 보낸 것을 모아두고 정해 둔 답을 돌려준다."""

    def __init__(self):
        self.calls: list[dict] = []
        self.replies: list[ai.Response] = []

    def __call__(self, method, url, headers, json=None, params=None):
        self.calls.append({"method": method, "url": url, "headers": headers, "json": json, "params": params})
        return self.replies.pop(0)


@pytest.fixture()
def fake(monkeypatch):
    f = FakeProvider()
    monkeypatch.setattr(ai, "send", f)
    return f


def anthropic_ok(text="## 한눈에 보기\n- 정리", stop="end_turn"):
    return ai.Response(200, {
        "model": "claude-test", "stop_reason": stop,
        "content": [{"type": "text", "text": text}],
        "usage": {"input_tokens": 1200, "output_tokens": 800},
    })


# ---------------------------------------------------------------------------
#  제공자 — 모양 맞추기
# ---------------------------------------------------------------------------


def test_anthropic_generate_sends_key_in_header_and_reads_text(fake):
    fake.replies.append(anthropic_ok("글", stop="max_tokens"))
    reply = ai.PROVIDERS["anthropic"].generate(KEY, "claude-test", "시스템", "질문")
    call = fake.calls[0]
    assert call["url"] == "https://api.anthropic.com/v1/messages"
    assert call["headers"]["x-api-key"] == KEY
    assert call["json"]["system"] == "시스템"
    assert call["json"]["messages"] == [{"role": "user", "content": "질문"}]
    assert reply.text == "글" and reply.truncated is True
    assert (reply.input_tokens, reply.output_tokens) == (1200, 800)


def test_openai_generate_uses_completion_token_limit_and_system_message(fake):
    fake.replies.append(ai.Response(200, {
        "model": "gpt-x", "choices": [{"message": {"content": " 답 "}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 20},
    }))
    reply = ai.PROVIDERS["openai"].generate(KEY, "gpt-x", "시스템", "질문")
    call = fake.calls[0]
    assert call["headers"]["Authorization"] == f"Bearer {KEY}"
    # 추론 모델은 max_tokens·temperature 를 거절한다
    assert "max_tokens" not in call["json"] and "temperature" not in call["json"]
    assert call["json"]["max_completion_tokens"] > 0
    assert call["json"]["messages"][0] == {"role": "system", "content": "시스템"}
    assert reply.text == "답" and reply.truncated is False


def test_gemini_keeps_key_out_of_the_url_and_skips_thoughts(fake):
    fake.replies.append(ai.Response(200, {
        "modelVersion": "gemini-x",
        "candidates": [{"finishReason": "STOP", "content": {"parts": [
            {"text": "생각 중…", "thought": True}, {"text": "답"},
        ]}}],
    }))
    reply = ai.PROVIDERS["gemini"].generate(KEY, "gemini-x", "시스템", "질문")
    call = fake.calls[0]
    assert KEY not in call["url"] and call["headers"]["x-goog-api-key"] == KEY
    assert call["url"].endswith("/models/gemini-x:generateContent")
    assert call["json"]["systemInstruction"]["parts"][0]["text"] == "시스템"
    assert reply.text == "답"


def test_model_lists_keep_only_text_models(fake):
    fake.replies.append(ai.Response(200, {"data": [
        {"id": "gpt-old", "created": 1}, {"id": "gpt-new", "created": 9},
        {"id": "o3-mini", "created": 5}, {"id": "gpt-4o-audio-preview", "created": 8},
        {"id": "text-embedding-3", "created": 7}, {"id": "dall-e-3", "created": 6},
        {"id": "whisper-1", "created": 4},
    ]}))
    assert [m["id"] for m in ai.PROVIDERS["openai"].list_models(KEY)] == ["gpt-new", "o3-mini", "gpt-old"]

    fake.replies.append(ai.Response(200, {"models": [
        {"name": "models/gemini-a", "displayName": "Gemini A", "supportedGenerationMethods": ["generateContent"]},
        {"name": "models/text-embedding-004", "supportedGenerationMethods": ["embedContent"]},
        {"name": "models/gemini-embedding-exp", "supportedGenerationMethods": ["generateContent"]},
    ]}))
    assert ai.PROVIDERS["gemini"].list_models(KEY) == [{"id": "gemini-a", "label": "Gemini A"}]

    fake.replies.append(ai.Response(200, {"data": [{"id": "claude-b", "display_name": "Claude B"}]}))
    assert ai.PROVIDERS["anthropic"].list_models(KEY) == [{"id": "claude-b", "label": "Claude B"}]


# ---------------------------------------------------------------------------
#  오류 번역 — 할 일이 다른 것은 다른 말로
# ---------------------------------------------------------------------------


def err(status, **error):
    return ai.Response(status, {"error": error})


@pytest.mark.parametrize("provider, res, code", [
    ("anthropic", err(401, type="authentication_error", message="invalid x-api-key"), "key_invalid"),
    ("anthropic", err(400, type="invalid_request_error",
                      message="Your credit balance is too low to access the Anthropic API."), "no_credit"),
    ("anthropic", err(404, type="not_found_error", message="model: nope"), "model_denied"),
    ("anthropic", err(403, type="permission_error", message="no"), "forbidden"),
    ("anthropic", err(429, type="rate_limit_error", message="slow"), "rate_limited"),
    ("anthropic", err(529, type="overloaded_error", message="busy"), "overloaded"),
    ("anthropic", err(500, type="api_error", message="oops"), "provider_error"),
    ("anthropic", err(400, type="invalid_request_error", message="bad"), "bad_request"),
    ("openai", err(401, code="invalid_api_key", message="Incorrect API key provided: sk-proj-****abcd"), "key_invalid"),
    ("openai", err(429, code="insufficient_quota", type="insufficient_quota", message="quota"), "no_credit"),
    ("openai", err(429, code="rate_limit_exceeded", message="slow"), "rate_limited"),
    ("openai", err(404, code="model_not_found", message="no model"), "model_denied"),
    ("openai", err(403, code="unsupported_country_region_territory", message="region"), "forbidden"),
    ("gemini", ai.Response(400, {"error": {"code": 400, "message": "API key not valid. Please pass a valid API key.",
                                           "status": "INVALID_ARGUMENT",
                                           "details": [{"reason": "API_KEY_INVALID"}]}}), "key_invalid"),
    ("gemini", ai.Response(429, {"error": {"status": "RESOURCE_EXHAUSTED", "message": "quota"}}), "rate_limited"),
    ("gemini", ai.Response(404, {"error": {"status": "NOT_FOUND", "message": "models/x is not found"}}), "model_denied"),
    ("gemini", ai.Response(400, {"error": {"status": "FAILED_PRECONDITION",
                                           "message": "User location is not supported"}}), "forbidden"),
    ("gemini", ai.Response(503, {"error": {"status": "UNAVAILABLE", "message": "overloaded"}}), "overloaded"),
    # JSON 이 아닌 성공 응답도 조용히 넘기지 않는다
    ("anthropic", ai.Response(200, "<html>proxy</html>"), "provider_error"),
])
def test_errors_are_translated(fake, provider, res, code):
    fake.replies.append(res)
    with pytest.raises(ai.AiError) as caught:
        ai.PROVIDERS[provider].generate(KEY, "m", "s", "p")
    assert caught.value.code == code
    # 401 은 화면이 "로그인이 풀렸다"로 읽는다 — 키 오류를 401 로 돌려주면 로그아웃된다
    assert caught.value.status != 401
    assert caught.value.hint


def test_key_never_leaks_into_errors_or_logs(fake, caplog):
    caplog.set_level(logging.DEBUG)
    fake.replies.append(err(401, code="invalid_api_key", message=f"Incorrect API key provided: {KEY}. sk-proj-abcdef1234"))
    with pytest.raises(ai.AiError) as caught:
        ai.PROVIDERS["openai"].generate(KEY, "m", "s", "p")
    assert KEY not in caught.value.message and "sk-proj-abcdef1234" not in caught.value.message
    assert "[키]" in caught.value.message
    assert KEY not in caplog.text and "sk-" not in caplog.text
    assert caplog.records, "실패는 남겨야 한다 (코드와 상태만)"


def test_keys_of_any_shape_are_hidden_not_just_familiar_ones(fake):
    """모양으로 가리는 것(`sk-…`, `AIza…`)은 보조다. 받은 키 그대로를 먼저 가린다."""
    odd = "plainKEY-without-known-prefix-777"
    fake.replies.append(err(400, message=f"bad key {odd}"))
    with pytest.raises(ai.AiError) as caught:
        ai.PROVIDERS["gemini"].generate(odd, "m", "s", "p")
    assert odd not in caught.value.message and "[키]" in caught.value.message


def test_network_errors_do_not_echo_the_request(monkeypatch):
    def boom(*args, **kwargs):
        raise requests.ConnectionError(f"failed with headers {kwargs.get('headers')}")

    monkeypatch.setattr(requests, "request", boom)
    with pytest.raises(ai.AiError) as caught:
        ai.PROVIDERS["anthropic"].generate(KEY, "m", "s", "p")
    assert caught.value.code == "network" and KEY not in str(caught.value) and KEY not in caught.value.message

    monkeypatch.setattr(requests, "request", lambda *a, **k: (_ for _ in ()).throw(requests.ReadTimeout("slow")))
    with pytest.raises(ai.AiError) as caught:
        ai.PROVIDERS["anthropic"].generate(KEY, "m", "s", "p")
    assert caught.value.code == "timeout"


@pytest.mark.parametrize("key", [None, "", "short", "has space in the middle of it", "x" * 401, "키한글키한글키한글"])
def test_malformed_keys_are_refused_without_echo(key):
    with pytest.raises(ai.AiError) as caught:
        ai.check_key(key)
    assert caught.value.code == "bad_key_shape"
    if key:
        assert key not in caught.value.message


@pytest.mark.parametrize("model", ["", "../secrets", "a/b", "x" * 101, " "])
def test_malformed_models_are_refused(model):
    with pytest.raises(ai.AiError):
        ai.check_model(model)


def test_real_model_names_pass():
    for model in ("claude-x-1-20260101", "gpt-4.1-mini", "gemini-2.5-flash", "ft:gpt-4o:org::abc"):
        assert ai.check_model(model) == model


# ---------------------------------------------------------------------------
#  넘기는 것 — 공용 데이터뿐
# ---------------------------------------------------------------------------


def _market(db, ticker, close=40.0):
    """1년 넘는 시세 + 지표 6일 + 시그널."""
    day, price = D(2025, 6, 2), 30.0
    while day <= D(2026, 9, 25):
        if day.weekday() < 5:
            price = 30.0 if day < D(2025, 9, 26) else close
            if day == D(2026, 3, 2):
                price = 55.0  # 52주 최고
            db.add(PriceDaily(ticker=ticker, date=day, open=price, high=price, low=price, close=price, volume=1))
        day += dt.timedelta(days=1)
    days = [D(2026, 9, 18), D(2026, 9, 21), D(2026, 9, 22), D(2026, 9, 23), D(2026, 9, 24), D(2026, 9, 25)]
    for i, d in enumerate(days):
        db.add(IndicatorDaily(ticker=ticker, date=d, ma20=42.0, ma50=38.0, ma200=35.0, stddev20=2.0 - i * 0.1,
                              disparity=-4.76, roc5=-1.5, adx=24.0 + i, plus_di=15.0, minus_di=22.0,
                              vol_ratio=0.9))
    db.add(SignalDaily(ticker=ticker, date=D(2026, 9, 25), knee_buy_v2=True, shoulder_sell_ref=False))
    db.add(SignalDaily(ticker=ticker, date=D(2026, 5, 4), knee_buy_v2=True, shoulder_sell_ref=False))
    db.add(SignalDaily(ticker=ticker, date=D(2024, 5, 4), knee_buy_v2=True, shoulder_sell_ref=False))
    db.commit()


def test_prompt_carries_market_data_and_not_my_portfolio(db_session, fake_sec):  # noqa: F811
    stock = make_stock(db_session, "ACME", name="Acme Corp", target_weight_pct=37.5)
    make_holding(db_session, "ACME", 123.0, avg_cost=31.25)
    _market(db_session, "ACME")
    fundamentals.refresh_ticker(db_session, "ACME", NOW)

    text = ai_analysis.render_prompt(ai_analysis.build_context(db_session, stock, D(2026, 9, 26)))

    assert "Acme Corp(ACME)" in text
    assert "종가 40.00 USD" in text
    assert "1년 등락률 +33.3%" in text          # 30 → 40
    assert "52주 최고 55.00 (2026-03-02)" in text and "최고가 대비 -27.3%" in text
    assert "MA20 -4.8%" in text and "MA200 +14.3%" in text
    assert "① -DI>+DI 충족" in text and "④ ADX>20 충족" in text
    assert "매수 시그널 충족" in text
    assert "지난 1년 매수 시그널이 뜬 날: 2일" in text   # 2024년 것은 안 센다
    assert "PER: 10.0배" in text
    assert "PER 지난 5년" in text
    # 그 사람의 것은 없다
    for secret in ("123", "37.5", "31.25"):
        assert secret not in text


def test_prompt_says_plainly_when_there_is_no_financials(db_session):
    stock = make_stock(db_session, "VOO")
    _prices(db_session, "VOO", 500.0)
    text = ai_analysis.render_prompt(ai_analysis.build_context(db_session, stock))
    assert "재무 자료 없음 (아직 재무를 받지 않았다)" in text
    assert "지표 없음" in text
    # 1년치가 안 되면 1년 등락률을 만들지 않는다
    assert "1년 등락률 없음" in text


def test_system_prompt_forbids_advice_and_prediction():
    s = ai_analysis.SYSTEM_PROMPT
    for rule in ("권하거나 암시하지 않습니다", "예측하지 않고 목표가를 내지 않습니다", "지어내지", "## 스스로 확인해 볼 점"):
        assert rule in s


# ---------------------------------------------------------------------------
#  API
# ---------------------------------------------------------------------------


def _headers(key=KEY):
    return {"X-AI-Key": key}


def test_api_analyze_relays_and_returns_text(api, fake, fake_sec):  # noqa: F811
    client, Session = api
    with Session() as db:
        make_stock(db, "ACME", name="Acme Corp")
        _market(db, "ACME")
    fake.replies.append(anthropic_ok("## 한눈에 보기\n- 정리"))
    res = client.post("/api/ai/analyze/acme", json={"provider": "anthropic", "model": "claude-test"},
                      headers=_headers())
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["text"].startswith("## 한눈에 보기") and body["model"] == "claude-test"
    assert body["as_of"] == "2026-09-25" and body["input_tokens"] == 1200
    assert KEY not in res.text
    sent = fake.calls[0]["json"]
    assert sent["system"] == ai_analysis.SYSTEM_PROMPT and "Acme Corp(ACME)" in sent["messages"][0]["content"]


def test_api_context_shows_exactly_what_is_sent(api, fake, fake_sec):  # noqa: F811
    client, Session = api
    with Session() as db:
        make_stock(db, "ACME", name="Acme Corp")
        _market(db, "ACME")
    shown = client.get("/api/ai/context/ACME").json()
    fake.replies.append(anthropic_ok())
    client.post("/api/ai/analyze/ACME", json={"provider": "anthropic", "model": "m"}, headers=_headers())
    assert fake.calls[0]["json"]["messages"][0]["content"] == shown["prompt"]
    assert fake.calls[0]["json"]["system"] == shown["system"]


def test_api_refuses_stocks_i_did_not_add_before_calling_out(api, fake):
    client, _ = api
    res = client.post("/api/ai/analyze/NVDA", json={"provider": "anthropic", "model": "m"}, headers=_headers())
    assert res.status_code == 404 and fake.calls == []
    assert client.get("/api/ai/context/NVDA").status_code == 404


def test_api_translates_provider_errors_without_logging_out(api, fake):
    client, Session = api
    with Session() as db:
        make_stock(db, "ACME")
    fake.replies.append(err(401, type="authentication_error", message="invalid x-api-key"))
    res = client.post("/api/ai/analyze/ACME", json={"provider": "anthropic", "model": "m"}, headers=_headers())
    assert res.status_code == 400
    detail = res.json()["detail"]
    assert detail["code"] == "key_invalid" and "키" in detail["hint"]


def test_api_checks_the_key_shape_before_calling(api, fake):
    client, Session = api
    with Session() as db:
        make_stock(db, "ACME")
    res = client.post("/api/ai/analyze/ACME", json={"provider": "anthropic", "model": "m"})
    assert res.status_code == 400 and res.json()["detail"]["code"] == "bad_key_shape"
    res = client.post("/api/ai/analyze/ACME", json={"provider": "nope", "model": "m"}, headers=_headers())
    assert res.json()["detail"]["code"] == "unknown_provider"
    res = client.post("/api/ai/analyze/ACME", json={"provider": "openai", "model": "../x"}, headers=_headers())
    assert res.json()["detail"]["code"] == "bad_model"
    assert fake.calls == []


def test_api_empty_reply_is_an_error(api, fake):
    client, Session = api
    with Session() as db:
        make_stock(db, "ACME")
    fake.replies.append(anthropic_ok(""))
    res = client.post("/api/ai/analyze/ACME", json={"provider": "anthropic", "model": "m"}, headers=_headers())
    assert res.status_code == 502 and res.json()["detail"]["code"] == "empty"


def test_api_one_at_a_time_per_person_and_a_minute_limit(api, fake):
    client, Session = api
    with Session() as db:
        make_stock(db, "ACME")
    # 앞의 요청이 아직 도는 중
    assert limits.ai_running.enter(1) is None
    res = client.post("/api/ai/analyze/ACME", json={"provider": "anthropic", "model": "m"}, headers=_headers())
    assert res.status_code == 429 and "진행 중" in res.json()["detail"]["hint"]
    limits.ai_running.leave(1)

    for _ in range(limits.AI_ANALYSES_PER_MINUTE):
        fake.replies.append(anthropic_ok())
        assert client.post("/api/ai/analyze/ACME", json={"provider": "anthropic", "model": "m"},
                           headers=_headers()).status_code == 200
    res = client.post("/api/ai/analyze/ACME", json={"provider": "anthropic", "model": "m"}, headers=_headers())
    assert res.status_code == 429 and "1분에" in res.json()["detail"]["hint"]
    # 끝난 요청은 자리를 비운다 (실패해도)
    assert limits.ai_running.enter(1) is None


def test_server_wide_concurrency_cap():
    running = limits.InFlight(2)
    assert running.enter("a") is None and running.enter("b") is None
    assert running.enter("c") == "full"
    assert running.enter("a") == "mine"
    running.leave("a")
    assert running.enter("c") is None


def test_api_models(api, fake):
    client, _ = api
    fake.replies.append(ai.Response(200, {"data": [{"id": "claude-b", "display_name": "Claude B"}]}))
    res = client.post("/api/ai/models", json={"provider": "anthropic"}, headers=_headers())
    assert res.status_code == 200 and res.json() == {
        "provider": "anthropic", "models": [{"id": "claude-b", "label": "Claude B"}],
    }
    fake.replies.append(err(401, type="authentication_error", message="bad"))
    res = client.post("/api/ai/models", json={"provider": "anthropic"}, headers=_headers())
    assert res.status_code == 400 and res.json()["detail"]["code"] == "key_invalid"
