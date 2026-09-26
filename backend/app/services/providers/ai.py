"""AI 제공자 — 사용자 본인 키로 부른다 (ROADMAP 3c).

**키는 여기를 지나가기만 한다.** 요청마다 브라우저가 헤더로 보내고, 이 모듈은 그 키로
제공자를 한 번 부른 뒤 잊는다. 저장하지 않고, 로그에 남기지 않고, 오류 문장에 섞여
돌아오지 않게 가린다(`scrub`). 제공자가 돌려준 오류 문장에도 키 일부가 들어 있을 수 있다
(OpenAI 는 "Incorrect API key provided: sk-...abcd" 라고 적는다).

제공자마다 주소·헤더·응답 모양·오류 모양이 다르다. 시세 제공자(`providers/`)처럼 겉을
하나로 맞춘다 — `list_models(key)` 와 `generate(key, model, system, prompt)`.

**오류를 번역한다.** "안 돼요" 하나로 뭉치면 사용자가 할 일을 모른다. 키가 틀린 것,
잔액이 없는 것, 그 모델을 쓸 권한이 없는 것, 잠깐 막힌 것은 할 일이 전부 다르다.

**모델 이름을 코드에 박지 않는다.** 제공자마다 몇 달이면 새 모델이 나오고 옛 것이 내려간다.
키를 확인할 때 그 키로 쓸 수 있는 모델 목록을 제공자에게 물어 사용자가 고르게 한다.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
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
    "model_denied": (403, "이 키로는 고른 모델을 쓸 수 없습니다. 모델 목록을 다시 불러와 다른 모델을 골라 보세요."),
    "forbidden": (403, "제공자가 이 키(계정)의 요청을 허용하지 않았습니다. 계정의 권한·지역 제한을 확인하세요."),
    "rate_limited": (429, "AI 제공자가 요청이 잦다고 잠시 막았습니다. 1~2분 뒤 다시 해 보세요."),
    "overloaded": (502, "AI 제공자가 지금 바쁩니다(과부하). 잠시 뒤 다시 해 보세요."),
    "provider_error": (502, "AI 제공자 쪽에서 오류가 났습니다. 잠시 뒤 다시 해 보세요."),
    "bad_request": (400, "AI 제공자가 요청을 거절했습니다. 다른 모델로 해 보세요."),
    "empty": (502, "AI 가 빈 답을 돌려줬습니다(안전 필터나 길이 제한). 다시 해 보거나 다른 모델을 골라 보세요."),
    "timeout": (504, "AI 제공자가 제시간에 답하지 않았습니다. 잠시 뒤 다시 해 보세요."),
    "network": (502, "서버가 AI 제공자에 연결하지 못했습니다. 잠시 뒤 다시 해 보세요."),
    "bad_key_shape": (400, "AI 키 모양이 아닙니다. 공백 없이 키 전체를 넣어 주세요."),
    "bad_model": (400, "모델 이름이 올바르지 않습니다. 모델 목록에서 골라 주세요."),
    "unknown_provider": (400, "지원하지 않는 AI 제공자입니다."),
    "question_too_long": (400, "요청이 너무 깁니다. 1000자 안으로 줄여 주세요."),
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


def _provider_message(body: Any) -> str:
    """제공자 오류 본문에서 사람이 읽을 문장 하나. 세 제공자 모두 `error.message` 에 둔다."""
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

    def generate(self, key: str, model: str, system: str, prompt: str) -> Reply: ...


def _fail(provider: str, code: str, res: Response, key: str) -> AiError:
    detail = scrub(_provider_message(res.body), key)
    # 로그에는 코드와 상태만 — 본문은 가려도 남기지 않는다
    logger.warning("AI 제공자 %s 호출 실패: %s (HTTP %s)", provider, code, res.status)
    return error(code, f"{provider} HTTP {res.status}: {detail}".rstrip(": "))


def _check(provider, res: Response, key: str) -> None:
    """성공이 아니면 번역한 오류를, 성공인데 JSON 이 아니면 제공자 오류를 던진다."""
    if res.status != 200:
        raise _fail(provider.name, provider.classify(res), res, key)
    if not isinstance(res.body, dict):
        raise _fail(provider.name, "provider_error", res, key)


# ---------------------------------------------------------------------------
#  Anthropic (Claude)
# ---------------------------------------------------------------------------


class Anthropic:
    name = "anthropic"
    label = "Claude (Anthropic)"
    BASE = "https://api.anthropic.com/v1"
    VERSION = "2023-06-01"
    MAX_TOKENS = 3000

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

    def generate(self, key: str, model: str, system: str, prompt: str) -> Reply:
        body = {
            "model": model,
            "max_tokens": self.MAX_TOKENS,
            "system": system,
            "messages": [{"role": "user", "content": prompt}],
        }
        res = send("POST", f"{self.BASE}/messages", self._headers(key), json=body)
        _check(self, res, key)
        parts = [p.get("text", "") for p in res.body.get("content") or [] if p.get("type") == "text"]
        usage = res.body.get("usage") or {}
        return Reply(
            text="".join(parts).strip(),
            model=res.body.get("model") or model,
            truncated=res.body.get("stop_reason") == "max_tokens",
            input_tokens=usage.get("input_tokens"),
            output_tokens=usage.get("output_tokens"),
        )


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

    def generate(self, key: str, model: str, system: str, prompt: str) -> Reply:
        body = {
            "model": model,
            # `max_tokens` 는 추론 모델이 거절한다. 온도도 건드리지 않는다 (추론 모델이 거절한다).
            "max_completion_tokens": self.MAX_TOKENS,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
        }
        res = send("POST", f"{self.BASE}/chat/completions", self._headers(key), json=body)
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


# ---------------------------------------------------------------------------
#  Google (Gemini)
# ---------------------------------------------------------------------------

_GEMINI_SKIP = ("embedding", "aqa", "imagen", "tts", "image", "veo", "live", "audio")


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
            # 무료 할당량을 다 쓴 것도 여기로 온다 — 결제가 없으면 잔액 문제와 같다
            return "no_credit" if "billing" in text else "rate_limited"
        if res.status == 403 or status == "PERMISSION_DENIED":
            return "forbidden"
        if status == "FAILED_PRECONDITION":
            return "forbidden"
        if res.status == 503:
            return "overloaded"
        if res.status >= 500:
            return "provider_error"
        return "bad_request"

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
            out.append({"id": model_id, "label": m.get("displayName") or model_id})
        return out

    def generate(self, key: str, model: str, system: str, prompt: str) -> Reply:
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"maxOutputTokens": self.MAX_TOKENS},
        }
        res = send("POST", f"{self.BASE}/models/{model}:generateContent", self._headers(key), json=body)
        _check(self, res, key)
        candidate = (res.body.get("candidates") or [{}])[0]
        parts = (candidate.get("content") or {}).get("parts") or []
        # 생각하는 모델은 생각한 내용도 조각으로 보낸다 (`thought: true`) — 답만 모은다
        text = "".join(p.get("text", "") for p in parts if isinstance(p, dict) and not p.get("thought"))
        usage = res.body.get("usageMetadata") or {}
        return Reply(
            text=text.strip(),
            model=res.body.get("modelVersion") or model,
            truncated=candidate.get("finishReason") == "MAX_TOKENS",
            input_tokens=usage.get("promptTokenCount"),
            output_tokens=usage.get("candidatesTokenCount"),
        )


PROVIDERS: dict[str, AiProvider] = {p.name: p for p in (Anthropic(), OpenAI(), Gemini())}


def get(name: str | None) -> AiProvider:
    provider = PROVIDERS.get((name or "").strip().lower())
    if provider is None:
        raise error("unknown_provider", "unknown provider")
    return provider
