"""AI 제공자 — 사용자 본인 키로 부른다 (ROADMAP 3c).

**키는 여기를 지나가기만 한다.** 요청마다 브라우저가 헤더로 보내고, 이 모듈은 그 키로
제공자를 한 번 부른 뒤 잊는다. 저장하지 않고, 로그에 남기지 않고, 오류 문장에 섞여
돌아오지 않게 가린다(`scrub`). 제공자가 돌려준 오류 문장에도 키 일부가 들어 있을 수 있다
(OpenAI 는 "Incorrect API key provided: sk-...abcd" 라고 적는다).

제공자마다 주소·헤더·응답 모양·오류 모양이 다르다. 시세 제공자(`providers/`)처럼 겉을
하나로 맞춘다 — `list_models(key)`, `generate(key, model, system, prompt)`, 그리고 글이 써지는
대로 받는 `stream(...)` (3c-2).

**오류를 번역한다.** "안 돼요" 하나로 뭉치면 사용자가 할 일을 모른다. 키가 틀린 것,
잔액이 없는 것, 그 모델을 쓸 권한이 없는 것, 잠깐 막힌 것은 할 일이 전부 다르다.

**종목 분석은 웹을 찾아본다 (9-13).** 앱이 모으지 않는 값(동종 업계 비교, 선행 PER, 최근 실적)을
"확인 필요"로 비워 두지 않게, 세 제공자가 저마다 가진 웹 검색을 켠다 — Claude 는 `web_search` 도구,
OpenAI 는 Responses API 의 `web_search`, Gemini 는 `google_search`. 찾아본 곳(출처)은 따로 모아 화면에 붙인다.
검색도 사용자의 키로, 그 제공자의 요금으로 된다.

**모델 이름을 코드에 박지 않는다.** 제공자마다 몇 달이면 새 모델이 나오고 옛 것이 내려간다.
키를 확인할 때 그 키로 쓸 수 있는 모델 목록을 제공자에게 물어 사용자가 고르게 한다.
"""

from __future__ import annotations

import logging
import math
import re
import json as jsonlib
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import Any, Protocol

import requests

logger = logging.getLogger(__name__)

# 연결은 빨리 포기하고, 답은 기다린다 — 긴 글을 쓰는 데 수십 초가 걸린다
CONNECT_TIMEOUT = 10
READ_TIMEOUT = 150

# 제공자 오류 문장을 화면에 옮길 때 이만큼만
MESSAGE_LIMIT = 300

# 모델 이름 — 주소 경로에 들어가므로(제미나이) 모양을 좁힌다. 슬래시는 받지 않는다.
MODEL_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:\-]{0,99}$")
# 키 — 제공자마다 모양이 다르지만 공백·제어문자는 없고 수백 자를 넘지 않는다
KEY_PATTERN = re.compile(r"^[\x21-\x7e]{8,400}$")

# 웹 검색 — 한 번 분석에 이만큼까지 찾는다 (Claude 만 횟수를 정할 수 있다). 출처는 이만큼까지 붙인다.
SEARCH_MAX_USES = 5
SOURCES_MAX = 12

# 오류 문장에 섞여 온 키 비슷한 것 (sk-..., sk-ant-..., sk-proj-..., AIza...)
_KEYLIKE = re.compile(r"(sk-[A-Za-z0-9_\-*.]{6,}|AIza[0-9A-Za-z_\-]{10,})")


class AiError(Exception):
    """사용자에게 보여줄 안내(`hint`)와 기술적 원인(`message`), 돌려줄 HTTP 상태.

    **401 은 쓰지 않는다.** 화면은 401 을 "로그인이 풀렸다"로 읽고 로그인 화면으로 보낸다.
    AI 키가 틀린 것은 로그인과 상관이 없다.
    """

    def __init__(self, code: str, status: int, hint: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.hint = hint
        self.message = message


# 코드 → (HTTP 상태, 안내)
ERRORS: dict[str, tuple[int, str]] = {
    "key_invalid": (400, "AI 키가 맞지 않습니다. 제공자 사이트에서 키를 다시 복사해 넣어 주세요."),
    "no_credit": (402, "AI 계정의 잔액(크레딧)이 부족하거나 결제 수단이 없습니다. 제공자 사이트의 결제 화면을 확인하세요."),
    "model_denied": (403, "이 키로는 고른 모델을 쓸 수 없습니다(없어졌거나 권한이 없습니다). 모델 목록에서 다른 모델을 골라 보세요."),
    "forbidden": (403, "제공자가 이 키(계정)의 요청을 허용하지 않았습니다. 계정의 권한·지역 제한을 확인하세요."),
    "rate_limited": (429, "AI 제공자가 요청이 잦다고 잠시 막았습니다. 1~2분 뒤 다시 해 보세요."),
    # Gemini 무료 등급 (9-14) — 한도가 모델마다 따로다. "결제를 확인하라"는 제공자 문장만 보고 잔액 문제로 읽지 않는다.
    "free_tier_model": (429, "이 모델은 무료 등급에서 쓸 수 없습니다(무료 한도 0). 모델 목록에서 다른 모델을 고르세요 — "
                             "무료로는 보통 이름에 flash 가 든 모델이 됩니다. 이 모델을 꼭 쓰려면 Google AI Studio 에서 결제를 연결해야 합니다."),
    "daily_limit": (429, "이 모델의 오늘 무료 한도를 다 썼습니다. 한도는 모델마다 따로라 다른 모델을 고르면 바로 쓸 수 있고, "
                         "이 모델은 한국 시간 오후 4~5시(미국 서부 자정)에 다시 풀립니다."),
    "quota_exceeded": (429, "이 키의 사용 한도를 넘었습니다. 무료 등급은 모델마다 1분·하루 한도가 있습니다 — 잠시 뒤 다시 하거나 "
                            "다른 모델을 골라 보세요. 결제를 연결했다면 제공자 사이트의 한도·결제 설정을 확인하세요."),
    "overloaded": (502, "AI 제공자가 지금 바쁩니다(과부하). 잠시 뒤 다시 해 보세요."),
    "provider_error": (502, "AI 제공자 쪽에서 오류가 났습니다. 잠시 뒤 다시 해 보세요."),
    "bad_request": (400, "AI 제공자가 요청을 거절했습니다. 다른 모델로 해 보세요."),
    "search_unavailable": (400, "고른 모델이나 계정에서 웹 검색을 쓸 수 없어 요청이 거절됐습니다. 다른 모델을 골라 보세요 "
                                "(Claude 는 Anthropic Console 에서 웹 검색이 켜져 있어야 합니다)."),
    "empty": (502, "AI 가 빈 답을 돌려줬습니다(안전 필터나 길이 제한). 다시 해 보거나 다른 모델을 골라 보세요."),
    "timeout": (504, "AI 제공자가 제시간에 답하지 않았습니다. 잠시 뒤 다시 해 보세요."),
    "network": (502, "서버가 AI 제공자에 연결하지 못했습니다. 잠시 뒤 다시 해 보세요."),
    "bad_key_shape": (400, "AI 키 모양이 아닙니다. 공백 없이 키 전체를 넣어 주세요."),
    "bad_model": (400, "모델 이름이 올바르지 않습니다. 모델 목록에서 골라 주세요."),
    "unknown_provider": (400, "지원하지 않는 AI 제공자입니다."),
    "question_too_long": (400, "요청이 너무 깁니다. 1000자 안으로 줄여 주세요."),
    "nothing": (400, "정리할 숫자가 아직 없습니다. 종목을 담거나 지표를 받은 뒤 다시 해 보세요."),
    "no_portfolio": (400, "진단할 포트폴리오가 없습니다. 보유 수량이나 목표 비중을 넣은 뒤 다시 해 보세요."),
}


def error(code: str, message: str) -> AiError:
    status, hint = ERRORS[code]
    return AiError(code, status, hint, message)


def scrub(text: str, key: str | None = None) -> str:
    """오류 문장에서 키를 가린다. 받은 키 그대로와, 키처럼 생긴 것 모두."""
    if key:
        text = text.replace(key, "[키]")
    text = _KEYLIKE.sub("[키]", text)
    return text[:MESSAGE_LIMIT]


def check_key(key: str | None) -> str:
    key = (key or "").strip()
    if not KEY_PATTERN.match(key):
        # 받은 것을 되돌려 적지 않는다 — 그게 키일 수 있다
        raise error("bad_key_shape", "key missing or malformed")
    return key


def check_model(model: str | None) -> str:
    model = (model or "").strip()
    if not MODEL_PATTERN.match(model):
        raise error("bad_model", "model name malformed")
    return model


@dataclass
class Reply:
    text: str
    model: str
    # 길이 제한에 걸려 끝이 잘렸는가
    truncated: bool = False
    input_tokens: int | None = None
    output_tokens: int | None = None
    # 웹 검색을 몇 번 했나, 글이 인용한 곳 (없으면 찾아본 곳)
    searches: int = 0
    sources: list[dict] = field(default_factory=list)
    found: list[dict] = field(default_factory=list)


@dataclass
class Searching:
    """글 조각이 아니라 "지금 웹을 찾는다"는 표시. `reset` 이면 그 앞에 쓴 글(머리말)은 버렸다."""

    count: int
    reset: bool


def _search_started(reply: Reply) -> Searching:
    """검색을 하나 시작했다.

    Claude 는 찾기 전에 "~를 검색해 보겠습니다" 같은 말을 먼저 쓴다. 제목("## ")이 아직 없는 글은
    리포트가 아니라 그런 머리말이므로 버린다 — 리포트를 쓰다 말고 찾는 경우(제목이 있다)는 둔다.
    """
    reply.searches += 1
    reset = bool(reply.text.strip()) and "## " not in reply.text
    if reset:
        reply.text = ""
    return Searching(reply.searches, reset)


def _add_source(sources: list[dict], url: Any, title: Any) -> None:
    """출처 하나 — http(s) 주소만, 같은 주소는 한 번, 너무 많으면 앞의 것만."""
    url = str(url or "").strip()
    if not url.startswith(("https://", "http://")) or len(url) > 2000 or len(sources) >= SOURCES_MAX:
        return
    if any(s["url"] == url for s in sources):
        return
    sources.append({"url": url, "title": " ".join(str(title or "").split())[:200] or url})


def _finish_sources(reply: Reply) -> None:
    """글이 인용한 곳이 없으면 찾아본 곳을 출처로."""
    if not reply.sources:
        reply.sources = reply.found[:SOURCES_MAX]


@dataclass
class Response:
    status: int
    body: Any  # JSON 이면 dict/list, 아니면 문자열


def send(method: str, url: str, headers: dict, json: dict | None = None,
         params: dict | None = None) -> Response:
    """제공자에 한 번 보낸다. 테스트는 이 함수를 바꿔 끼운다.

    **예외 문장을 그대로 올리지 않는다.** requests 의 예외는 요청 내용을 문장에 넣기도 한다.
    """
    try:
        res = requests.request(method, url, headers=headers, json=json, params=params,
                               timeout=(CONNECT_TIMEOUT, READ_TIMEOUT))
    except requests.Timeout:
        raise error("timeout", "provider timed out") from None
    except requests.RequestException as exc:
        raise error("network", f"connection failed ({type(exc).__name__})") from None
    try:
        body: Any = res.json()
    except ValueError:
        body = res.text
    return Response(res.status_code, body)


@dataclass
class StreamResponse:
    """흘려받는 응답. 성공(200)이면 `lines` 로 한 줄씩, 아니면 `body` 에 오류 본문."""

    status: int
    body: Any
    lines: Iterator[str]
    close: Callable[[], None]


def send_stream(url: str, headers: dict, json: dict, params: dict | None = None) -> StreamResponse:
    """제공자에 보내고 **답이 오는 대로** 한 줄씩 읽는다. 테스트는 이 함수를 바꿔 끼운다.

    상태부터 본다 — 키가 틀렸으면 글을 한 자도 받기 전에 알 수 있다. 그래야 화면에 보내는 응답도
    평소처럼 오류(JSON)로 돌려줄 수 있다. 예외 문장은 `send` 처럼 올리지 않는다.
    """
    try:
        res = requests.post(url, headers=headers, json=json, params=params, stream=True,
                            timeout=(CONNECT_TIMEOUT, READ_TIMEOUT))
    except requests.Timeout:
        raise error("timeout", "provider timed out") from None
    except requests.RequestException as exc:
        raise error("network", f"connection failed ({type(exc).__name__})") from None
    if res.status_code != 200:
        try:
            body: Any = res.json()
        except ValueError:
            body = res.text
        res.close()
        return StreamResponse(res.status_code, body, iter(()), lambda: None)
    # text/event-stream 은 charset 을 안 적어 보내기도 한다 — requests 는 그때 latin-1 로 읽어 한글이 깨진다
    res.encoding = "utf-8"

    def lines() -> Iterator[str]:
        try:
            yield from res.iter_lines(chunk_size=1024, decode_unicode=True)
        except requests.Timeout:
            raise error("timeout", "provider stopped sending") from None
        except requests.RequestException as exc:
            raise error("network", f"stream broke ({type(exc).__name__})") from None

    return StreamResponse(200, None, lines(), res.close)


def sse_events(lines) -> Iterator[tuple[str | None, str]]:
    """서버 전송 이벤트(SSE)를 (이벤트 이름, 데이터) 로. 빈 줄이 한 이벤트의 끝이다."""
    event: str | None = None
    data: list[str] = []
    for line in lines:
        if line == "":
            if data:
                yield event, "\n".join(data)
            event, data = None, []
        elif line.startswith(":"):
            continue  # 주석 (연결 유지용)
        elif line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].removeprefix(" "))
    if data:
        yield event, "\n".join(data)


def _provider_message(body: Any) -> str:
    """제공자 오류 본문에서 사람이 읽을 문장 하나. 세 제공자 모두 `error.message` 에 둔다.

    OpenAI Responses 의 흘려받기 오류만 `{"type": "error", "message": ...}` 로 온다.
    """
    if isinstance(body, dict) and body.get("type") == "error" and isinstance(body.get("message"), str):
        return body["message"]
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict):
            return str(err.get("message") or "")
        if isinstance(err, str):
            return err
    if isinstance(body, str):
        return body
    return ""


class AiProvider(Protocol):
    name: str
    label: str

    def list_models(self, key: str) -> list[dict]: ...

    def generate(self, key: str, model: str, system: str, prompt: str, search: bool = False) -> Reply: ...

    def stream(self, key: str, model: str, system: str, prompt: str, search: bool = False) -> Streamed: ...


def _fail(provider, code: str, res: Response, key: str) -> AiError:
    detail = scrub(_provider_message(res.body), key)
    # 제공자가 알려준 한도·기다릴 시간 — 긴 문장 뒤에 있으면 잘리므로 앞에 붙인다
    quota, wait = provider.quota(res.body) if hasattr(provider, "quota") else ("", None)
    if quota:
        detail = f"[{quota}] {detail}"
    # 로그에는 코드와 상태만 — 본문은 가려도 남기지 않는다
    logger.warning("AI 제공자 %s 호출 실패: %s (HTTP %s)", provider.name, code, res.status)
    err = error(code, f"{provider.name} HTTP {res.status}: {detail}".rstrip(": ")[:MESSAGE_LIMIT])
    if code == "rate_limited" and wait:
        err.hint = f"AI 제공자가 요청이 잦다고 잠시 막았습니다. {wait}초쯤 뒤 다시 해 보세요."
    return err


def _classify(provider, res: Response, search: bool) -> str:
    """웹 검색을 켠 요청이 "잘못된 요청"으로 거절되면 대개 그 모델·계정이 검색을 못 쓰는 것이다."""
    code = provider.classify(res)
    return "search_unavailable" if search and code == "bad_request" else code


def _check(provider, res: Response, key: str, search: bool = False) -> None:
    """성공이 아니면 번역한 오류를, 성공인데 JSON 이 아니면 제공자 오류를 던진다."""
    if res.status != 200:
        raise _fail(provider, _classify(provider, res, search), res, key)
    if not isinstance(res.body, dict):
        raise _fail(provider, "provider_error", res, key)


class Streamed:
    """흘려받는 중인 답. 돌리면 글 조각이 나오고, 다 돌고 나면 `reply` 가 채워져 있다.

    만들 때 이미 제공자에 연결해 상태를 봤다(틀린 키는 여기까지 오지 않는다). 도중에 끊기거나
    제공자가 오류 이벤트를 보내면 `AiError` 를 던진다 — 받는 쪽이 그때까지의 글과 함께 알린다.
    """

    def __init__(self, provider, key: str, model: str, res: StreamResponse, reader=None) -> None:
        self._provider = provider
        self._key = key
        self._res = res
        # 조각 읽는 법 — 제공자마다 (OpenAI 는 검색할 때 모양이 다른 API 를 쓴다)
        self._read = reader or provider.read_chunk
        self.reply = Reply(text="", model=model)

    def __iter__(self) -> Iterator[str | Searching]:
        try:
            for event, data in sse_events(self._res.lines):
                if data.strip() == "[DONE]":
                    break
                try:
                    body = jsonlib.loads(data)
                except ValueError:
                    continue
                if not isinstance(body, dict):
                    continue
                if event == "error" or "error" in body:
                    code = self._provider.classify(Response(200, body))
                    raise _fail(self._provider, "provider_error" if code == "bad_request" else code,
                                Response(200, body), self._key)
                piece = self._read(self.reply, body)
                if isinstance(piece, Searching):
                    yield piece
                elif piece:
                    self.reply.text += piece
                    yield piece
        finally:
            self.close()
        self.reply.text = self.reply.text.strip()
        _finish_sources(self.reply)

    def close(self) -> None:
        self._res.close()


def _open(provider, key: str, model: str, url: str, headers: dict, body: dict,
          params: dict | None = None, search: bool = False, reader=None) -> Streamed:
    res = send_stream(url, headers, body, params)
    if res.status != 200:
        raise _fail(provider, _classify(provider, Response(res.status, res.body), search), res, key)
    return Streamed(provider, key, model, res, reader)


# ---------------------------------------------------------------------------
#  Anthropic (Claude)
# ---------------------------------------------------------------------------


class Anthropic:
    name = "anthropic"
    label = "Claude (Anthropic)"
    BASE = "https://api.anthropic.com/v1"
    VERSION = "2023-06-01"
    # 담은 종목 전체 정리는 2500자까지 쓴다 — 한국어는 글자당 토큰이 많다 (쓴 만큼만 청구된다)
    MAX_TOKENS = 5000

    def _headers(self, key: str) -> dict:
        return {"x-api-key": key, "anthropic-version": self.VERSION, "content-type": "application/json"}

    def classify(self, res: Response) -> str:
        err = res.body.get("error") if isinstance(res.body, dict) else None
        kind = (err or {}).get("type", "") if isinstance(err, dict) else ""
        text = _provider_message(res.body).lower()
        if res.status == 401 or kind == "authentication_error":
            return "key_invalid"
        if "billing" in kind or "credit balance" in text or res.status == 402:
            return "no_credit"
        if res.status == 404 or kind == "not_found_error":
            return "model_denied"
        if res.status == 403 or kind == "permission_error":
            return "forbidden"
        if res.status == 429 or kind == "rate_limit_error":
            return "rate_limited"
        if res.status == 529 or kind == "overloaded_error":
            return "overloaded"
        if res.status >= 500:
            return "provider_error"
        return "bad_request"

    def list_models(self, key: str) -> list[dict]:
        res = send("GET", f"{self.BASE}/models", self._headers(key), params={"limit": 100})
        _check(self, res, key)
        # 새것부터 온다 — 그 순서 그대로
        return [
            {"id": m["id"], "label": m.get("display_name") or m["id"]}
            for m in (res.body.get("data") or [])
            if isinstance(m, dict) and m.get("id")
        ]

    # 서버가 찾아 주는 도구 — 우리가 검색을 돌리지 않는다. 조직 관리자가 Console 에서 켜 둬야 한다.
    WEB_SEARCH = {"type": "web_search_20250305", "name": "web_search", "max_uses": SEARCH_MAX_USES}

    def _body(self, model: str, system: str, prompt: str, search: bool = False) -> dict:
        body: dict = {
            "model": model,
            "max_tokens": self.MAX_TOKENS,
            "system": system,
            "messages": [{"role": "user", "content": prompt}],
        }
        if search:
            body["tools"] = [dict(self.WEB_SEARCH)]
        return body

    @staticmethod
    def _stopped(reply: Reply, stop_reason: Any) -> None:
        # pause_turn — 검색이 길어 제공자가 중간에 멈췄다. 글이 끝나지 않았다는 점에서 잘린 것과 같다
        reply.truncated = stop_reason in ("max_tokens", "pause_turn")

    @staticmethod
    def _found(reply: Reply, block: dict) -> None:
        content = block.get("content")
        if isinstance(content, list):  # 검색이 실패하면 목록 대신 오류 하나가 온다
            for r in content:
                if isinstance(r, dict) and r.get("type") == "web_search_result":
                    _add_source(reply.found, r.get("url"), r.get("title"))

    @staticmethod
    def _cited(reply: Reply, citation: Any) -> None:
        if isinstance(citation, dict) and citation.get("type") == "web_search_result_location":
            _add_source(reply.sources, citation.get("url"), citation.get("title"))

    def generate(self, key: str, model: str, system: str, prompt: str, search: bool = False) -> Reply:
        res = send("POST", f"{self.BASE}/messages", self._headers(key),
                   json=self._body(model, system, prompt, search))
        _check(self, res, key, search)
        usage = res.body.get("usage") or {}
        reply = Reply(text="", model=res.body.get("model") or model,
                      input_tokens=usage.get("input_tokens"), output_tokens=usage.get("output_tokens"))
        # 글·검색·검색 결과가 쓴 순서대로 온다 — 흘려받을 때와 같게 읽는다
        for part in res.body.get("content") or []:
            if not isinstance(part, dict):
                continue
            if part.get("type") == "server_tool_use":
                _search_started(reply)
            elif part.get("type") == "web_search_tool_result":
                self._found(reply, part)
            elif part.get("type") == "text":
                reply.text += str(part.get("text") or "")
                for citation in part.get("citations") or []:
                    self._cited(reply, citation)
        reply.text = reply.text.strip()
        self._stopped(reply, res.body.get("stop_reason"))
        _finish_sources(reply)
        return reply

    def stream(self, key: str, model: str, system: str, prompt: str, search: bool = False) -> Streamed:
        body = {**self._body(model, system, prompt, search), "stream": True}
        return _open(self, key, model, f"{self.BASE}/messages", self._headers(key), body, search=search)

    @classmethod
    def read_chunk(cls, reply: Reply, body: dict) -> str | Searching:
        kind = body.get("type")
        if kind == "message_start":
            message = body.get("message") or {}
            reply.model = message.get("model") or reply.model
            reply.input_tokens = (message.get("usage") or {}).get("input_tokens")
        elif kind == "content_block_start":
            block = body.get("content_block") or {}
            if block.get("type") == "server_tool_use":
                return _search_started(reply)
            if block.get("type") == "web_search_tool_result":
                cls._found(reply, block)
        elif kind == "content_block_delta":
            delta = body.get("delta") or {}
            if delta.get("type") == "text_delta":
                return str(delta.get("text") or "")
            if delta.get("type") == "citations_delta":
                cls._cited(reply, delta.get("citation"))
        elif kind == "message_delta":
            cls._stopped(reply, (body.get("delta") or {}).get("stop_reason"))
            reply.output_tokens = (body.get("usage") or {}).get("output_tokens", reply.output_tokens)
        return ""


# ---------------------------------------------------------------------------
#  OpenAI (ChatGPT)
# ---------------------------------------------------------------------------

# 모델 목록에는 글을 쓰지 않는 것(음성·그림·임베딩…)이 섞여 온다
_OPENAI_SKIP = ("audio", "realtime", "tts", "transcribe", "image", "search", "embedding",
                "instruct", "moderation", "dall-e", "whisper", "babbage", "davinci", "codex")


def openai_chat_model(model_id: str) -> bool:
    lowered = model_id.lower()
    if not (lowered.startswith(("gpt-", "chatgpt-")) or re.match(r"^o\d", lowered)):
        return False
    return not any(word in lowered for word in _OPENAI_SKIP)


class OpenAI:
    name = "openai"
    label = "ChatGPT (OpenAI)"
    BASE = "https://api.openai.com/v1"
    # 추론 모델은 생각하는 데도 이 한도를 쓴다 — 넉넉히 둔다 (쓴 만큼만 청구된다)
    MAX_TOKENS = 8000
    # 검색하며 쓰면 읽고 생각하는 몫이 늘어난다
    SEARCH_MAX_TOKENS = 16000

    def _headers(self, key: str) -> dict:
        return {"Authorization": f"Bearer {key}", "content-type": "application/json"}

    def classify(self, res: Response) -> str:
        err = res.body.get("error") if isinstance(res.body, dict) else None
        code = str((err or {}).get("code") or "") if isinstance(err, dict) else ""
        kind = str((err or {}).get("type") or "") if isinstance(err, dict) else ""
        if res.status == 401 or code == "invalid_api_key":
            return "key_invalid"
        if code == "insufficient_quota" or kind == "insufficient_quota" or res.status == 402:
            return "no_credit"
        if res.status == 404 or code == "model_not_found":
            return "model_denied"
        if res.status == 403:
            return "forbidden"
        if res.status == 429:
            return "rate_limited"
        if res.status == 503:
            return "overloaded"
        if res.status >= 500:
            return "provider_error"
        return "bad_request"

    def list_models(self, key: str) -> list[dict]:
        res = send("GET", f"{self.BASE}/models", self._headers(key))
        _check(self, res, key)
        rows = [
            m for m in (res.body.get("data") or [])
            if isinstance(m, dict) and m.get("id") and openai_chat_model(m["id"])
        ]
        # 순서를 주지 않는다 — 새것부터
        rows.sort(key=lambda m: m.get("created") or 0, reverse=True)
        return [{"id": m["id"], "label": m["id"]} for m in rows]

    def _body(self, model: str, system: str, prompt: str) -> dict:
        return {
            "model": model,
            # `max_tokens` 는 추론 모델이 거절한다. 온도도 건드리지 않는다 (추론 모델이 거절한다).
            "max_completion_tokens": self.MAX_TOKENS,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
        }

    def generate(self, key: str, model: str, system: str, prompt: str, search: bool = False) -> Reply:
        if search:
            return self._search_generate(key, model, system, prompt)
        res = send("POST", f"{self.BASE}/chat/completions", self._headers(key),
                   json=self._body(model, system, prompt))
        _check(self, res, key)
        choice = (res.body.get("choices") or [{}])[0]
        usage = res.body.get("usage") or {}
        return Reply(
            text=((choice.get("message") or {}).get("content") or "").strip(),
            model=res.body.get("model") or model,
            truncated=choice.get("finish_reason") == "length",
            input_tokens=usage.get("prompt_tokens"),
            output_tokens=usage.get("completion_tokens"),
        )

    def stream(self, key: str, model: str, system: str, prompt: str, search: bool = False) -> Streamed:
        if search:
            body = {**self._search_body(model, system, prompt), "stream": True}
            return _open(self, key, model, f"{self.BASE}/responses", self._headers(key), body,
                         search=True, reader=self.read_response_event)
        # 쓴 토큰 수는 따로 청해야 마지막 조각에 온다
        body = {**self._body(model, system, prompt), "stream": True, "stream_options": {"include_usage": True}}
        return _open(self, key, model, f"{self.BASE}/chat/completions", self._headers(key), body)

    @staticmethod
    def read_chunk(reply: Reply, body: dict) -> str:
        reply.model = body.get("model") or reply.model
        usage = body.get("usage") or {}
        if usage:
            reply.input_tokens = usage.get("prompt_tokens")
            reply.output_tokens = usage.get("completion_tokens")
        choice = (body.get("choices") or [{}])[0]
        if choice.get("finish_reason"):
            reply.truncated = choice["finish_reason"] == "length"
        return str((choice.get("delta") or {}).get("content") or "")

    # --- 웹 검색 (9-13) — Chat Completions 에는 검색이 없다(검색 전용 모델만). Responses API 로 간다.

    def _search_body(self, model: str, system: str, prompt: str) -> dict:
        return {
            "model": model,
            "instructions": system,
            "input": prompt,
            "max_output_tokens": self.SEARCH_MAX_TOKENS,
            "tools": [{"type": "web_search"}],
        }

    @staticmethod
    def _response_meta(reply: Reply, response: dict) -> None:
        reply.model = response.get("model") or reply.model
        usage = response.get("usage") or {}
        if usage:
            reply.input_tokens = usage.get("input_tokens")
            reply.output_tokens = usage.get("output_tokens")
        reason = (response.get("incomplete_details") or {}).get("reason")
        reply.truncated = response.get("status") == "incomplete" and reason == "max_output_tokens"

    @staticmethod
    def _cited(reply: Reply, annotation: Any) -> None:
        if isinstance(annotation, dict) and annotation.get("type") == "url_citation":
            _add_source(reply.sources, annotation.get("url"), annotation.get("title"))

    def _search_generate(self, key: str, model: str, system: str, prompt: str) -> Reply:
        res = send("POST", f"{self.BASE}/responses", self._headers(key), json=self._search_body(model, system, prompt))
        _check(self, res, key, search=True)
        reply = Reply(text="", model=model)
        for item in res.body.get("output") or []:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "web_search_call":
                _search_started(reply)
            elif item.get("type") == "message":
                for part in item.get("content") or []:
                    if isinstance(part, dict) and part.get("type") == "output_text":
                        reply.text += str(part.get("text") or "")
                        for annotation in part.get("annotations") or []:
                            self._cited(reply, annotation)
        reply.text = reply.text.strip()
        self._response_meta(reply, res.body)
        _finish_sources(reply)
        return reply

    @classmethod
    def read_response_event(cls, reply: Reply, body: dict) -> str | Searching:
        kind = str(body.get("type") or "")
        if kind == "response.output_text.delta":
            return str(body.get("delta") or "")
        if kind == "response.web_search_call.in_progress":
            return _search_started(reply)
        if kind == "response.output_text.annotation.added":
            cls._cited(reply, body.get("annotation"))
        elif kind in ("response.created", "response.completed", "response.incomplete"):
            cls._response_meta(reply, body.get("response") or {})
        elif kind == "response.failed":
            err = (body.get("response") or {}).get("error") or {}
            message = scrub(str(err.get("message") or "") if isinstance(err, dict) else "")
            logger.warning("AI 제공자 openai 응답 실패 (response.failed)")
            raise error("provider_error", f"openai response failed: {message}".rstrip(": "))
        return ""


# ---------------------------------------------------------------------------
#  Google (Gemini)
# ---------------------------------------------------------------------------

# 글을 쓰지 않거나(그림·소리·임베딩), 시스템 지시를 받지 않거나(gemma), 특별한 도구가 있어야 하는 모델은 목록에서 뺀다
_GEMINI_SKIP = ("embedding", "aqa", "imagen", "tts", "image", "veo", "live", "audio", "gemma", "learnlm",
                "robotics", "computer-use", "deep-research")
# 미리보기·실험 모델 — 자주 내려가고 무료 한도가 없을 때가 많다. 목록 뒤로 보낸다.
_GEMINI_PREVIEW = ("preview", "exp")
# 무료 등급에서 쓸 수 없는 모델은 한도가 0 으로 온다
_LIMIT_ZERO = re.compile(r"limit:\s*0(?![\d.])")
_RETRY_DELAY = re.compile(r"^(\d+(?:\.\d+)?)s$")


def _gemini_details(body: Any) -> tuple[list[dict], int | None]:
    """한도 오류(429)의 `details` — 걸린 한도들(QuotaFailure)과 기다릴 초(RetryInfo)."""
    err = body.get("error") if isinstance(body, dict) else None
    violations: list[dict] = []
    wait: int | None = None
    if isinstance(err, dict):
        for d in err.get("details") or []:
            if not isinstance(d, dict):
                continue
            kind = str(d.get("@type") or "")
            if kind.endswith("QuotaFailure"):
                violations += [v for v in d.get("violations") or [] if isinstance(v, dict)]
            elif kind.endswith("RetryInfo"):
                found = _RETRY_DELAY.match(str(d.get("retryDelay") or ""))
                if found:
                    wait = max(1, math.ceil(float(found.group(1))))
    return violations, wait


class Gemini:
    name = "gemini"
    label = "Gemini (Google)"
    BASE = "https://generativelanguage.googleapis.com/v1beta"
    MAX_TOKENS = 8192

    def _headers(self, key: str) -> dict:
        # 키를 주소(?key=)에 넣지 않는다 — 주소는 여기저기 기록된다
        return {"x-goog-api-key": key, "content-type": "application/json"}

    def classify(self, res: Response) -> str:
        err = res.body.get("error") if isinstance(res.body, dict) else None
        status = str((err or {}).get("status") or "") if isinstance(err, dict) else ""
        reasons = []
        if isinstance(err, dict):
            for d in err.get("details") or []:
                if isinstance(d, dict) and d.get("reason"):
                    reasons.append(str(d["reason"]))
        text = _provider_message(res.body).lower()
        if res.status == 401 or "API_KEY_INVALID" in reasons or "api key not valid" in text:
            return "key_invalid"
        if res.status == 404 or status == "NOT_FOUND":
            return "model_denied"
        if res.status == 429 or status == "RESOURCE_EXHAUSTED":
            return self._quota_code(res.body, text)
        if res.status == 403 or status == "PERMISSION_DENIED":
            return "forbidden"
        if status == "FAILED_PRECONDITION":
            return "forbidden"
        if res.status == 503:
            return "overloaded"
        if res.status >= 500:
            return "provider_error"
        return "bad_request"

    @staticmethod
    def _quota_code(body: Any, text: str) -> str:
        """한도에 걸렸다 — 어느 한도인지에 따라 할 일이 다르다.

        제공자 문장은 늘 "plan and billing details 를 확인하라"고 적는다. 그 말만 보고 잔액 문제로 읽으면
        무료 등급 사용자는 할 일을 모른다(9-14). 걸린 한도(`quotaId`)와 한도 값(`quotaValue`)을 본다.
        """
        violations, wait = _gemini_details(body)
        if any(str(v.get("quotaValue")) == "0" for v in violations) or _LIMIT_ZERO.search(text):
            return "free_tier_model"
        quota_ids = " ".join(str(v.get("quotaId") or "") for v in violations)
        if "PerDay" in quota_ids:
            return "daily_limit"
        if violations or wait:
            return "rate_limited"
        if "prepayment" in text or "credits are depleted" in text:
            return "no_credit"
        return "quota_exceeded"

    @staticmethod
    def quota(body: Any) -> tuple[str, int | None]:
        """기술적 원인에 붙일 한 줄 — 어느 한도에 몇으로 걸렸고, 몇 초 기다리라는지."""
        violations, wait = _gemini_details(body)
        parts = []
        for v in violations[:2]:
            model = str((v.get("quotaDimensions") or {}).get("model") or "") if isinstance(
                v.get("quotaDimensions"), dict) else ""
            bits = [str(v.get("quotaId") or v.get("quotaMetric") or "quota")]
            if model:
                bits.append(f"model {model}")
            if v.get("quotaValue") is not None:
                bits.append(f"limit {v.get('quotaValue')}")
            parts.append(" ".join(bits))
        if wait:
            parts.append(f"retry {wait}s")
        return " · ".join(parts)[:200], wait

    def list_models(self, key: str) -> list[dict]:
        res = send("GET", f"{self.BASE}/models", self._headers(key), params={"pageSize": 1000})
        _check(self, res, key)
        out = []
        for m in res.body.get("models") or []:
            if not isinstance(m, dict):
                continue
            model_id = str(m.get("name") or "").removeprefix("models/")
            if not model_id or "generateContent" not in (m.get("supportedGenerationMethods") or []):
                continue
            if any(word in model_id.lower() for word in _GEMINI_SKIP):
                continue
            preview = any(word in model_id.lower() for word in _GEMINI_PREVIEW)
            label = str(m.get("displayName") or model_id)
            out.append({"id": model_id, "label": f"{label} (미리보기)" if preview and "preview" not in label.lower()
                        and "exp" not in label.lower() else label, "_preview": preview})
        # 정식 모델 먼저 (그 안에서는 제공자가 준 순서대로) — 처음 고르는 모델이 오래 쓸 수 있는 것이게
        out.sort(key=lambda m: m["_preview"])
        return [{"id": m["id"], "label": m["label"]} for m in out]

    def _body(self, system: str, prompt: str, search: bool = False) -> dict:
        body: dict = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"maxOutputTokens": self.MAX_TOKENS},
        }
        if search:
            body["tools"] = [{"google_search": {}}]
        return body

    @staticmethod
    def _grounding(reply: Reply, candidate: dict) -> None:
        """구글 검색으로 찾아본 것 — 검색어 수와 찾아본 곳. 조각마다 지금까지의 것이 온다."""
        grounding = candidate.get("groundingMetadata") or {}
        queries = grounding.get("webSearchQueries") or []
        if isinstance(queries, list):
            reply.searches = max(reply.searches, len(queries))
        for chunk in grounding.get("groundingChunks") or []:
            web = (chunk or {}).get("web") if isinstance(chunk, dict) else None
            if isinstance(web, dict):
                _add_source(reply.sources, web.get("uri"), web.get("title"))

    def generate(self, key: str, model: str, system: str, prompt: str, search: bool = False) -> Reply:
        res = send("POST", f"{self.BASE}/models/{model}:generateContent", self._headers(key),
                   json=self._body(system, prompt, search))
        _check(self, res, key, search)
        candidate = (res.body.get("candidates") or [{}])[0]
        parts = (candidate.get("content") or {}).get("parts") or []
        # 생각하는 모델은 생각한 내용도 조각으로 보낸다 (`thought: true`) — 답만 모은다
        text = "".join(p.get("text", "") for p in parts if isinstance(p, dict) and not p.get("thought"))
        usage = res.body.get("usageMetadata") or {}
        reply = Reply(
            text=text.strip(),
            model=res.body.get("modelVersion") or model,
            truncated=candidate.get("finishReason") == "MAX_TOKENS",
            input_tokens=usage.get("promptTokenCount"),
            output_tokens=usage.get("candidatesTokenCount"),
        )
        self._grounding(reply, candidate)
        return reply

    def stream(self, key: str, model: str, system: str, prompt: str, search: bool = False) -> Streamed:
        # alt=sse — 조각을 SSE 로 (기본은 JSON 배열 하나를 조금씩)
        return _open(self, key, model, f"{self.BASE}/models/{model}:streamGenerateContent", self._headers(key),
                     self._body(system, prompt, search), params={"alt": "sse"}, search=search)

    @classmethod
    def read_chunk(cls, reply: Reply, body: dict) -> str:
        reply.model = body.get("modelVersion") or reply.model
        usage = body.get("usageMetadata") or {}
        if usage:
            # 조각마다 지금까지의 합이 온다 — 마지막 것이 전체
            reply.input_tokens = usage.get("promptTokenCount", reply.input_tokens)
            reply.output_tokens = usage.get("candidatesTokenCount", reply.output_tokens)
        candidate = (body.get("candidates") or [{}])[0]
        if candidate.get("finishReason"):
            reply.truncated = candidate["finishReason"] == "MAX_TOKENS"
        cls._grounding(reply, candidate)
        parts = (candidate.get("content") or {}).get("parts") or []
        return "".join(p.get("text", "") for p in parts if isinstance(p, dict) and not p.get("thought"))


PROVIDERS: dict[str, AiProvider] = {p.name: p for p in (Anthropic(), OpenAI(), Gemini())}


def get(name: str | None) -> AiProvider:
    provider = PROVIDERS.get((name or "").strip().lower())
    if provider is None:
        raise error("unknown_provider", "unknown provider")
    return provider
