"""AI 글을 써지는 대로 받기 (ROADMAP 3c-2) — 세 제공자의 흘려받기, SSE 로 넘기기, 끊겼을 때 자리 비우기.

제공자는 가짜다(`ai.send_stream` 을 바꿔 끼운다).
"""

from __future__ import annotations

import json
import logging

import pytest
import requests

from app.services import ai_analysis, limits
from app.services.providers import ai
from tests.factories import make_stock
from tests.test_ai import KEY, _headers, _market, err
from tests.test_fundamentals import fake_sec  # noqa: F401  (픽스처)


def sse(*events: tuple[str | None, dict | str]) -> list[str]:
    """(이벤트 이름, 데이터) → 제공자가 보내는 SSE 줄."""
    lines: list[str] = []
    for name, data in events:
        if name:
            lines.append(f"event: {name}")
        lines.append("data: " + (data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)))
        lines.append("")
    return lines


class FakeStream:
    """`ai.send_stream` 대신. 정해 둔 줄을 흘려주고, 닫혔는지 기억한다."""

    def __init__(self):
        self.calls: list[dict] = []
        self.replies: list[tuple[int, object, list[str]]] = []
        self.closed = 0

    def __call__(self, url, headers, json, params=None):
        self.calls.append({"url": url, "headers": headers, "json": json, "params": params})
        status, body, lines = self.replies.pop(0)

        def close():
            self.closed += 1

        def flow():
            for line in lines:
                if isinstance(line, Exception):
                    raise line
                yield line

        return ai.StreamResponse(status, body, flow(), close)


@pytest.fixture()
def fake_stream(monkeypatch):
    f = FakeStream()
    monkeypatch.setattr(ai, "send_stream", f)
    return f


def anthropic_lines(*pieces: str, stop="end_turn", model="claude-test") -> list[str]:
    return sse(
        ("message_start", {"type": "message_start", "message": {"model": model, "usage": {"input_tokens": 1200}}}),
        ("ping", {"type": "ping"}),
        *[("content_block_delta", {"type": "content_block_delta", "delta": {"type": "text_delta", "text": p}})
          for p in pieces],
        ("message_delta", {"type": "message_delta", "delta": {"stop_reason": stop}, "usage": {"output_tokens": 800}}),
        ("message_stop", {"type": "message_stop"}),
    )


# ---------------------------------------------------------------------------
#  제공자 — 흘려받기의 모양 맞추기
# ---------------------------------------------------------------------------


def test_anthropic_stream_yields_pieces_and_fills_the_reply(fake_stream):
    fake_stream.replies.append((200, None, anthropic_lines("## 한눈", "에 보기\n", "- 정리  ", stop="max_tokens")))
    got = ai.PROVIDERS["anthropic"].stream(KEY, "claude-x", "시스템", "질문")
    assert list(got) == ["## 한눈", "에 보기\n", "- 정리  "]
    call = fake_stream.calls[0]
    assert call["url"] == "https://api.anthropic.com/v1/messages" and call["headers"]["x-api-key"] == KEY
    assert call["json"]["stream"] is True and call["json"]["system"] == "시스템"
    r = got.reply
    assert r.text == "## 한눈에 보기\n- 정리" and r.model == "claude-test" and r.truncated is True
    assert (r.input_tokens, r.output_tokens) == (1200, 800)
    assert fake_stream.closed == 1


def test_openai_stream_asks_for_usage_and_stops_at_done(fake_stream):
    fake_stream.replies.append((200, None, sse(
        (None, {"model": "gpt-x", "choices": [{"delta": {"role": "assistant", "content": ""}}]}),
        (None, {"model": "gpt-x", "choices": [{"delta": {"content": "답"}}]}),
        (None, {"model": "gpt-x", "choices": [{"delta": {"content": "이다"}, "finish_reason": "length"}]}),
        (None, {"model": "gpt-x", "choices": [], "usage": {"prompt_tokens": 10, "completion_tokens": 20}}),
        (None, "[DONE]"),
        (None, {"model": "gpt-x", "choices": [{"delta": {"content": "끝 뒤의 것"}}]}),
    )))
    got = ai.PROVIDERS["openai"].stream(KEY, "gpt-x", "시스템", "질문")
    assert list(got) == ["답", "이다"]
    body = fake_stream.calls[0]["json"]
    assert body["stream"] is True and body["stream_options"] == {"include_usage": True}
    assert "max_tokens" not in body and body["messages"][0] == {"role": "system", "content": "시스템"}
    assert got.reply.truncated is True and (got.reply.input_tokens, got.reply.output_tokens) == (10, 20)


def test_gemini_stream_uses_sse_and_keeps_key_out_of_url(fake_stream):
    fake_stream.replies.append((200, None, sse(
        (None, {"modelVersion": "gemini-x", "candidates": [{"content": {"parts": [
            {"text": "생각…", "thought": True}, {"text": "첫"}]}}],
            "usageMetadata": {"promptTokenCount": 5, "candidatesTokenCount": 1}}),
        (None, {"modelVersion": "gemini-x", "candidates": [{"content": {"parts": [{"text": " 조각"}]},
                                                             "finishReason": "STOP"}],
                "usageMetadata": {"promptTokenCount": 5, "candidatesTokenCount": 9}}),
    )))
    got = ai.PROVIDERS["gemini"].stream(KEY, "gemini-x", "시스템", "질문")
    assert list(got) == ["첫", " 조각"]
    call = fake_stream.calls[0]
    assert call["url"].endswith("/models/gemini-x:streamGenerateContent") and call["params"] == {"alt": "sse"}
    assert KEY not in call["url"] and call["headers"]["x-goog-api-key"] == KEY
    assert got.reply.text == "첫 조각" and got.reply.truncated is False
    assert (got.reply.input_tokens, got.reply.output_tokens) == (5, 9)


def test_refusal_is_known_before_any_text(fake_stream, caplog):
    caplog.set_level(logging.DEBUG)
    fake_stream.replies.append((401, {"error": {"code": "invalid_api_key",
                                                "message": f"Incorrect API key provided: {KEY}"}}, []))
    with pytest.raises(ai.AiError) as caught:
        ai.PROVIDERS["openai"].stream(KEY, "gpt-x", "s", "p")
    assert caught.value.code == "key_invalid" and KEY not in caught.value.message
    assert KEY not in caplog.text


def test_error_event_in_the_middle_is_translated_and_scrubbed(fake_stream):
    lines = anthropic_lines("앞부분")[:-6] + sse(("error", {"type": "error", "error": {
        "type": "overloaded_error", "message": f"Overloaded for {KEY}"}}))
    fake_stream.replies.append((200, None, lines))
    got = ai.PROVIDERS["anthropic"].stream(KEY, "m", "s", "p")
    pieces = []
    with pytest.raises(ai.AiError) as caught:
        for piece in got:
            pieces.append(piece)
    assert pieces == ["앞부분"]
    assert caught.value.code == "overloaded" and KEY not in caught.value.message
    assert fake_stream.closed == 1


def test_unknown_error_in_the_middle_is_a_provider_error_not_a_bad_request(fake_stream):
    fake_stream.replies.append((200, None, sse((None, {"error": {"message": "stream broke"}}))))
    with pytest.raises(ai.AiError) as caught:
        list(ai.PROVIDERS["openai"].stream(KEY, "m", "s", "p"))
    assert caught.value.code == "provider_error"


def test_stopping_early_closes_the_provider_connection(fake_stream):
    fake_stream.replies.append((200, None, anthropic_lines("하나", "둘", "셋")))
    got = iter(ai.PROVIDERS["anthropic"].stream(KEY, "m", "s", "p"))
    assert next(got) == "하나"
    got.close()
    assert fake_stream.closed == 1


def test_sse_parser_joins_data_lines_and_skips_comments():
    lines = [": keep-alive", "event: a", "data: 첫 줄", "data: 둘째 줄", "", "", "data:붙여 씀", "", "data: 끝"]
    assert list(ai.sse_events(lines)) == [("a", "첫 줄\n둘째 줄"), (None, "붙여 씀"), (None, "끝")]


# ---------------------------------------------------------------------------
#  send_stream — 실제 requests 를 부르는 곳
# ---------------------------------------------------------------------------


class RawResponse:
    def __init__(self, status, lines=(), body=None, fail=None):
        self.status_code = status
        self._lines = lines
        self._body = body
        self._fail = fail
        self.encoding = "ISO-8859-1"
        self.closed = False
        self.text = str(body)

    def json(self):
        if self._body is None:
            raise ValueError("not json")
        return self._body

    def iter_lines(self, chunk_size, decode_unicode):
        assert decode_unicode and self.encoding == "utf-8", "한글이 깨지지 않게 utf-8 로 읽는다"
        yield from self._lines
        if self._fail:
            raise self._fail

    def close(self):
        self.closed = True


def test_send_stream_reads_lines_as_utf8_and_hides_broken_streams(monkeypatch):
    raw = RawResponse(200, ["data: 가"], fail=requests.ConnectionError(f"reset while sending {KEY}"))
    seen = {}

    def post(url, headers, json, params, stream, timeout):
        seen.update(stream=stream)
        return raw

    monkeypatch.setattr(requests, "post", post)
    res = ai.send_stream("https://x", {"k": KEY}, {})
    assert seen["stream"] is True and res.status == 200
    got = []
    with pytest.raises(ai.AiError) as caught:
        for line in res.lines:
            got.append(line)
    assert got == ["data: 가"] and caught.value.code == "network" and KEY not in str(caught.value.message)
    res.close()
    assert raw.closed

    raw = RawResponse(200, [], fail=requests.ReadTimeout("slow"))
    monkeypatch.setattr(requests, "post", lambda *a, **k: raw)
    with pytest.raises(ai.AiError) as caught:
        list(ai.send_stream("https://x", {}, {}).lines)
    assert caught.value.code == "timeout"


def test_send_stream_returns_error_bodies_and_closes(monkeypatch):
    raw = RawResponse(429, body={"error": {"message": "slow"}})
    monkeypatch.setattr(requests, "post", lambda *a, **k: raw)
    res = ai.send_stream("https://x", {}, {})
    assert res.status == 429 and res.body == {"error": {"message": "slow"}} and raw.closed
    assert list(res.lines) == []

    monkeypatch.setattr(requests, "post", lambda *a, **k: (_ for _ in ()).throw(
        requests.ConnectionError(f"no route {KEY}")))
    with pytest.raises(ai.AiError) as caught:
        ai.send_stream("https://x", {}, {})
    assert caught.value.code == "network" and KEY not in caught.value.message


# ---------------------------------------------------------------------------
#  API — /api/ai/analyze/{ticker}/stream
# ---------------------------------------------------------------------------


def events(text: str) -> list[tuple[str, dict]]:
    return [(name, json.loads(data)) for name, data in ai.sse_events(text.split("\n"))]


def _post(client, ticker="ACME", key=KEY, **body):
    return client.post(f"/api/ai/analyze/{ticker}/stream", headers=_headers(key),
                       json={"provider": "anthropic", "model": "claude-test", **body})


def test_api_stream_sends_pieces_then_the_whole(api, fake_stream, fake_sec):  # noqa: F811
    client, Session = api
    with Session() as db:
        make_stock(db, "ACME", name="Acme Corp")
        _market(db, "ACME")
    fake_stream.replies.append((200, None, anthropic_lines("## 한눈에", " 보기\n- 정리")))
    res = _post(client, question=" 짧게 ")
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("text/event-stream")
    assert res.headers["cache-control"] == "no-cache"
    got = events(res.text)
    assert [name for name, _ in got] == ["start", "delta", "delta", "done"]
    assert got[0][1] == {"provider": "anthropic", "model": "claude-test", "as_of": "2026-09-25"}
    assert "".join(d["text"] for n, d in got if n == "delta") == "## 한눈에 보기\n- 정리"
    done = got[-1][1]
    assert done["text"] == "## 한눈에 보기\n- 정리" and done["question"] == "짧게"
    assert done["input_tokens"] == 1200 and done["output_tokens"] == 800 and done["as_of"] == "2026-09-25"
    assert KEY not in res.text
    # 보낸 것은 "보내는 내용 보기"와 같다
    shown = client.get("/api/ai/context/ACME", params={"question": "짧게"}).json()
    sent = fake_stream.calls[0]["json"]
    assert sent["messages"][0]["content"] == shown["prompt"] and sent["system"] == shown["system"]
    # 끝나면 자리를 비우고 제공자 연결을 닫는다
    assert limits.ai_running.enter(1) is None
    limits.ai_running.leave(1)
    assert fake_stream.closed >= 1


def test_api_stream_refusal_before_text_is_a_plain_json_error(api, fake_stream):
    client, Session = api
    with Session() as db:
        make_stock(db, "ACME")
    fake_stream.replies.append((401, {"error": {"type": "authentication_error", "message": "bad"}}, []))
    res = _post(client)
    assert res.status_code == 400 and res.json()["detail"]["code"] == "key_invalid"
    assert limits.ai_running.enter(1) is None, "거절돼도 자리를 비운다"
    limits.ai_running.leave(1)


def test_api_stream_error_midway_keeps_what_was_written(api, fake_stream, caplog):
    client, Session = api
    with Session() as db:
        make_stock(db, "ACME")
    caplog.set_level(logging.DEBUG)
    lines = anthropic_lines("앞부분")[:-6] + sse(("error", {"type": "error", "error": {
        "type": "overloaded_error", "message": f"busy {KEY}"}}))
    fake_stream.replies.append((200, None, lines))
    res = _post(client)
    got = events(res.text)
    assert [n for n, _ in got] == ["start", "delta", "error"]
    error = got[-1][1]
    assert error["code"] == "overloaded" and error["status"] == 502 and error["hint"]
    assert KEY not in res.text and KEY not in caplog.text
    assert limits.ai_running.enter(1) is None
    limits.ai_running.leave(1)


def test_api_stream_empty_reply_is_an_error_event(api, fake_stream):
    client, Session = api
    with Session() as db:
        make_stock(db, "ACME")
    fake_stream.replies.append((200, None, anthropic_lines("  ")))
    got = events(_post(client).text)
    assert got[-1][0] == "error" and got[-1][1]["code"] == "empty"


def test_api_stream_checks_before_calling_and_respects_limits(api, fake_stream):
    client, Session = api
    with Session() as db:
        make_stock(db, "ACME")
    assert _post(client, ticker="NVDA").status_code == 404
    assert _post(client, key="short").json()["detail"]["code"] == "bad_key_shape"
    assert _post(client, question="가" * (ai_analysis.QUESTION_MAX + 1)).json()["detail"]["code"] == "question_too_long"
    assert fake_stream.calls == []

    assert limits.ai_running.enter(1) is None
    res = _post(client)
    assert res.status_code == 429 and "진행 중" in res.json()["detail"]["hint"]
    limits.ai_running.leave(1)

    for _ in range(limits.AI_ANALYSES_PER_MINUTE):
        fake_stream.replies.append((200, None, anthropic_lines("글")))
        assert events(_post(client).text)[-1][0] == "done"
    res = _post(client)
    assert res.status_code == 429 and "1분에" in res.json()["detail"]["hint"]
    assert limits.ai_running.enter(1) is None, "한도에 걸려도 자리를 비운다"
    limits.ai_running.leave(1)


def test_leaving_midway_frees_the_slot_and_closes_upstream(fake_stream):
    """화면이 도중에 끊으면(팝업 닫기·멈추기) 흘려보내기가 닫힌다 — 그때 자리를 비우고 연결을 닫는다."""
    fake_stream.replies.append((200, None, anthropic_lines("하나", "둘", "셋")))
    stream = ai.PROVIDERS["anthropic"].stream(KEY, "m", "s", "p")
    job = ai_analysis.Job("stock", "ACME", "s", "p", None)
    started = ai_analysis.Started(job, None, ai.PROVIDERS["anthropic"], stream)
    freed = []
    body = ai_analysis.sse_body(started, lambda: freed.append(True))
    assert next(body).startswith("event: start")
    assert next(body).startswith("event: delta")
    body.close()
    assert freed == [True] and fake_stream.closed >= 1


def test_once_runs_a_single_time():
    from app.routers.ai import _once

    calls = []
    run = _once(lambda: calls.append(1))
    run()
    run()
    assert calls == [1]
