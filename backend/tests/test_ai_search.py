"""종목 분석의 웹 검색 (ROADMAP 9-13) — 세 제공자가 저마다의 검색을 켜고, 찾아본 곳을 모으고,
검색 전 머리말을 버리고, 검색을 못 쓰는 모델이면 그렇다고 알린다.

제공자는 가짜다(`ai.send` · `ai.send_stream` 을 바꿔 끼운다).
"""

from __future__ import annotations

import pytest

from app.services import ai_analysis
from app.services.providers import ai
from tests.test_ai import KEY, fake  # noqa: F401  (픽스처)
from tests.test_ai_stream import events, fake_stream, sse  # noqa: F401  (픽스처)


def _anthropic_search_lines() -> list[str]:
    """머리말 → 검색 → 결과 → 인용 붙은 리포트. 실제 흘려받기와 같은 순서."""
    return sse(
        ("message_start", {"type": "message_start", "message": {"model": "claude-s", "usage": {"input_tokens": 9000}}}),
        ("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 0,
                                 "delta": {"type": "text_delta", "text": "업종 평균을 검색해 보겠습니다."}}),
        ("content_block_start", {"type": "content_block_start", "index": 1, "content_block": {
            "type": "server_tool_use", "id": "srvtoolu_1", "name": "web_search", "input": {}}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 1,
                                 "delta": {"type": "input_json_delta", "partial_json": "{\"query\": \"ACME peers PER\"}"}}),
        ("content_block_start", {"type": "content_block_start", "index": 2, "content_block": {
            "type": "web_search_tool_result", "tool_use_id": "srvtoolu_1", "content": [
                {"type": "web_search_result", "url": "https://example.com/peers", "title": "Peers  table"},
                {"type": "web_search_result", "url": "javascript:alert(1)", "title": "나쁜 주소"},
                {"type": "web_search_result", "url": "https://example.com/peers", "title": "같은 주소"},
            ]}}),
        ("content_block_start", {"type": "content_block_start", "index": 3, "content_block": {"type": "text", "text": ""}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 3,
                                 "delta": {"type": "text_delta", "text": "## 1. 기업 개요\n- 업종 평균 PER 24배"}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 3, "delta": {
            "type": "citations_delta", "citation": {"type": "web_search_result_location",
                                                    "url": "https://news.example.org/a", "title": "기사 A",
                                                    "cited_text": "..."}}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 3,
                                 "delta": {"type": "text_delta", "text": " (예시, 2026년 9월)"}}),
        ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn"},
                           "usage": {"output_tokens": 900, "server_tool_use": {"web_search_requests": 1}}}),
        ("message_stop", {"type": "message_stop"}),
    )


# ---------------------------------------------------------------------------
#  Claude — web_search 도구
# ---------------------------------------------------------------------------


def test_anthropic_search_turns_the_tool_on_drops_the_preamble_and_keeps_citations(fake_stream):  # noqa: F811
    fake_stream.replies.append((200, None, _anthropic_search_lines()))
    got = ai.PROVIDERS["anthropic"].stream(KEY, "claude-s", "시스템", "질문", search=True)
    pieces = list(got)
    tool = fake_stream.calls[0]["json"]["tools"]
    assert tool == [{"type": "web_search_20250305", "name": "web_search", "max_uses": ai.SEARCH_MAX_USES}]
    # 머리말 → 검색 표시(머리말 버림) → 리포트
    assert pieces[0] == "업종 평균을 검색해 보겠습니다."
    assert pieces[1] == ai.Searching(1, True)
    r = got.reply
    assert r.text == "## 1. 기업 개요\n- 업종 평균 PER 24배 (예시, 2026년 9월)"
    assert r.searches == 1 and r.truncated is False
    # 글이 인용한 곳이 있으면 그것만
    assert r.sources == [{"url": "https://news.example.org/a", "title": "기사 A"}]


def test_anthropic_without_citations_lists_what_it_looked_at(fake_stream):  # noqa: F811
    lines = [line for line in _anthropic_search_lines() if "citations_delta" not in line]
    fake_stream.replies.append((200, None, lines))
    got = ai.PROVIDERS["anthropic"].stream(KEY, "claude-s", "s", "p", search=True)
    list(got)
    # 자바스크립트 주소는 버리고, 같은 주소는 한 번, 제목의 공백은 하나로
    assert got.reply.sources == [{"url": "https://example.com/peers", "title": "Peers table"}]


def test_anthropic_keeps_report_text_when_it_searches_midway(fake_stream):  # noqa: F811
    lines = sse(
        ("content_block_delta", {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "## 1. 개요\n앞"}}),
        ("content_block_start", {"type": "content_block_start", "content_block": {"type": "server_tool_use"}}),
        ("content_block_delta", {"type": "content_block_delta", "delta": {"type": "text_delta", "text": " 뒤"}}),
        ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "pause_turn"}, "usage": {}}),
    )
    fake_stream.replies.append((200, None, lines))
    got = ai.PROVIDERS["anthropic"].stream(KEY, "m", "s", "p", search=True)
    assert ai.Searching(1, False) in list(got)
    # 제목이 있으면 리포트를 쓰던 중 — 버리지 않는다. 검색이 길어 멈춘 것(pause_turn)은 끝나지 않은 글
    assert got.reply.text == "## 1. 개요\n앞 뒤" and got.reply.truncated is True


def test_anthropic_generate_reads_blocks_in_order(fake):  # noqa: F811
    fake.replies.append(ai.Response(200, {
        "model": "claude-s", "stop_reason": "end_turn", "usage": {"input_tokens": 5, "output_tokens": 6},
        "content": [
            {"type": "text", "text": "찾아보겠습니다."},
            {"type": "server_tool_use", "id": "x", "name": "web_search", "input": {"query": "q"}},
            {"type": "web_search_tool_result", "content": {"type": "web_search_tool_result_error",
                                                           "error_code": "unavailable"}},
            {"type": "text", "text": "## 1. 개요\n본문", "citations": [
                {"type": "web_search_result_location", "url": "https://a.example/x", "title": "A"}]},
        ],
    }))
    reply = ai.PROVIDERS["anthropic"].generate(KEY, "claude-s", "s", "p", search=True)
    assert "tools" in fake.calls[0]["json"]
    assert reply.text == "## 1. 개요\n본문" and reply.searches == 1
    assert reply.sources == [{"url": "https://a.example/x", "title": "A"}]


def test_without_search_nothing_changes(fake, fake_stream):  # noqa: F811
    fake.replies.append(ai.Response(200, {"model": "m", "content": [{"type": "text", "text": "글"}], "usage": {}}))
    ai.PROVIDERS["anthropic"].generate(KEY, "m", "s", "p")
    assert "tools" not in fake.calls[0]["json"]
    fake_stream.replies.append((200, None, sse((None, {"candidates": [{"content": {"parts": [{"text": "글"}]}}]}))))
    list(ai.PROVIDERS["gemini"].stream(KEY, "g", "s", "p"))
    assert "tools" not in fake_stream.calls[0]["json"]


# ---------------------------------------------------------------------------
#  OpenAI — Responses API 의 web_search
# ---------------------------------------------------------------------------


def test_openai_search_goes_to_responses_api(fake_stream):  # noqa: F811
    fake_stream.replies.append((200, None, sse(
        ("response.created", {"type": "response.created", "response": {"model": "gpt-s", "status": "in_progress"}}),
        ("response.web_search_call.in_progress", {"type": "response.web_search_call.in_progress", "item_id": "ws_1"}),
        ("response.web_search_call.completed", {"type": "response.web_search_call.completed", "item_id": "ws_1"}),
        ("response.output_text.delta", {"type": "response.output_text.delta", "delta": "## 1. 개요\n"}),
        ("response.output_text.annotation.added", {"type": "response.output_text.annotation.added", "annotation": {
            "type": "url_citation", "url": "https://b.example/y", "title": "B"}}),
        ("response.output_text.delta", {"type": "response.output_text.delta", "delta": "본문"}),
        ("response.incomplete", {"type": "response.incomplete", "response": {
            "model": "gpt-s-2026", "status": "incomplete", "incomplete_details": {"reason": "max_output_tokens"},
            "usage": {"input_tokens": 30, "output_tokens": 40}}}),
    )))
    got = ai.PROVIDERS["openai"].stream(KEY, "gpt-s", "시스템", "질문", search=True)
    pieces = list(got)
    call = fake_stream.calls[0]
    assert call["url"] == "https://api.openai.com/v1/responses"
    body = call["json"]
    assert body["instructions"] == "시스템" and body["input"] == "질문" and body["stream"] is True
    assert body["tools"] == [{"type": "web_search"}] and body["max_output_tokens"] > 0
    assert "messages" not in body
    assert pieces == [ai.Searching(1, False), "## 1. 개요\n", "본문"]
    r = got.reply
    assert r.text == "## 1. 개요\n본문" and r.model == "gpt-s-2026" and r.truncated is True
    assert (r.input_tokens, r.output_tokens) == (30, 40) and r.searches == 1
    assert r.sources == [{"url": "https://b.example/y", "title": "B"}]


def test_openai_search_failure_events_are_translated_and_scrubbed(fake_stream):  # noqa: F811
    fake_stream.replies.append((200, None, sse(("response.failed", {"type": "response.failed", "response": {
        "error": {"code": "server_error", "message": f"broke with {KEY}"}}}))))
    with pytest.raises(ai.AiError) as caught:
        list(ai.PROVIDERS["openai"].stream(KEY, "gpt-s", "s", "p", search=True))
    assert caught.value.code == "provider_error" and KEY not in caught.value.message
    fake_stream.replies.append((200, None, sse(("error", {"type": "error", "code": "x", "message": "rate limit hit"}))))
    with pytest.raises(ai.AiError) as caught:
        list(ai.PROVIDERS["openai"].stream(KEY, "gpt-s", "s", "p", search=True))
    assert "rate limit hit" in caught.value.message


def test_openai_search_generate_reads_output_items(fake):  # noqa: F811
    fake.replies.append(ai.Response(200, {
        "model": "gpt-s", "status": "completed", "usage": {"input_tokens": 1, "output_tokens": 2},
        "output": [
            {"type": "web_search_call", "status": "completed"},
            {"type": "message", "content": [{"type": "output_text", "text": "## 답", "annotations": [
                {"type": "url_citation", "url": "https://c.example", "title": "C"}]}]},
        ],
    }))
    reply = ai.PROVIDERS["openai"].generate(KEY, "gpt-s", "s", "p", search=True)
    assert fake.calls[0]["url"].endswith("/responses")
    assert reply.text == "## 답" and reply.searches == 1 and reply.truncated is False
    assert reply.sources == [{"url": "https://c.example", "title": "C"}]


# ---------------------------------------------------------------------------
#  Gemini — google_search
# ---------------------------------------------------------------------------


def test_gemini_search_turns_on_google_search_and_reads_grounding(fake_stream):  # noqa: F811
    fake_stream.replies.append((200, None, sse(
        (None, {"candidates": [{"content": {"parts": [{"text": "## 1. 개요"}]}}]}),
        (None, {"candidates": [{"content": {"parts": [{"text": "\n본문"}]}, "finishReason": "STOP",
                                "groundingMetadata": {
                                    "webSearchQueries": ["acme peers per", "acme guidance"],
                                    "groundingChunks": [{"web": {"uri": "https://vertexaisearch.example/r1",
                                                                 "title": "reuters.com"}}, {"retrievedContext": {}}]}}]}),
    )))
    got = ai.PROVIDERS["gemini"].stream(KEY, "gemini-s", "s", "p", search=True)
    assert list(got) == ["## 1. 개요", "\n본문"]
    assert fake_stream.calls[0]["json"]["tools"] == [{"google_search": {}}]
    assert got.reply.searches == 2
    assert got.reply.sources == [{"url": "https://vertexaisearch.example/r1", "title": "reuters.com"}]


# ---------------------------------------------------------------------------
#  검색을 못 쓰는 모델 · 계정
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("name", ["anthropic", "openai", "gemini"])
def test_a_refused_search_request_says_search_is_the_problem(fake_stream, name):  # noqa: F811
    body = {"error": {"type": "invalid_request_error", "message": "tool not supported", "status": "INVALID_ARGUMENT"}}
    fake_stream.replies.append((400, body, []))
    with pytest.raises(ai.AiError) as caught:
        ai.PROVIDERS[name].stream(KEY, "m", "s", "p", search=True)
    assert caught.value.code == "search_unavailable" and "웹 검색" in caught.value.hint
    # 검색을 켜지 않은 요청이면 전과 같다
    fake_stream.replies.append((400, body, []))
    with pytest.raises(ai.AiError) as caught:
        ai.PROVIDERS[name].stream(KEY, "m", "s", "p")
    assert caught.value.code == "bad_request"


def test_a_wrong_key_is_still_a_wrong_key_with_search(fake):  # noqa: F811
    fake.replies.append(ai.Response(401, {"error": {"type": "authentication_error", "message": "invalid x-api-key"}}))
    with pytest.raises(ai.AiError) as caught:
        ai.PROVIDERS["anthropic"].generate(KEY, "m", "s", "p", search=True)
    assert caught.value.code == "key_invalid"


def test_sources_are_capped():
    sources: list[dict] = []
    for i in range(ai.SOURCES_MAX + 5):
        ai._add_source(sources, f"https://s.example/{i}", "t" * 500)
    assert len(sources) == ai.SOURCES_MAX and len(sources[0]["title"]) == 200
    ai._add_source(sources := [], "https://x.example", "  ")
    assert sources == [{"url": "https://x.example", "title": "https://x.example"}]


# ---------------------------------------------------------------------------
#  화면으로 — search 이벤트, 결과의 검색 횟수·출처
# ---------------------------------------------------------------------------


def _job(search: bool) -> ai_analysis.Job:
    return ai_analysis.Job("research" if search else "stock", "ACME", "s", "p", None, search=search)


def test_sse_body_tells_the_screen_about_searches_and_sources(fake_stream):  # noqa: F811
    fake_stream.replies.append((200, None, _anthropic_search_lines()))
    provider = ai.PROVIDERS["anthropic"]
    started = ai_analysis.Started(_job(True), None, provider, provider.stream(KEY, "m", "s", "p", search=True))
    out = events("".join(ai_analysis.sse_body(started, lambda: None)))
    names = [name for name, _ in out]
    assert names[:3] == ["start", "delta", "search"]
    assert out[2][1] == {"count": 1, "reset": True}
    done = out[-1][1]
    assert names[-1] == "done" and done["web_searches"] == 1
    assert done["sources"] == [{"url": "https://news.example.org/a", "title": "기사 A"}]
    assert done["text"].startswith("## 1. 기업 개요") and "검색해 보겠습니다" not in done["text"]


def test_summaries_without_search_report_no_searches(fake_stream):  # noqa: F811
    fake_stream.replies.append((200, None, sse((None, {"candidates": [{"content": {"parts": [{"text": "글"}]}}]}))))
    provider = ai.PROVIDERS["gemini"]
    started = ai_analysis.Started(_job(False), None, provider, provider.stream(KEY, "m", "s", "p"))
    done = events("".join(ai_analysis.sse_body(started, lambda: None)))[-1][1]
    assert done["web_searches"] is None and done["sources"] == []


def test_analyze_in_one_go_also_searches_when_the_job_asks(fake, db_session):  # noqa: F811
    fake.replies.append(ai.Response(200, {
        "model": "claude-s", "stop_reason": "end_turn", "usage": {},
        "content": [{"type": "server_tool_use"}, {"type": "text", "text": "## 답"}],
    }))
    got = ai_analysis.analyze(db_session, lambda q: _job(True), "anthropic", "claude-s", KEY)
    assert "tools" in fake.calls[0]["json"]
    assert got["web_searches"] == 1 and got["text"] == "## 답"
