"""모든 응답에 붙이는 보안 헤더와 요청 본문 크기 한도 (0.45.4, 제로베이스 점검 3·4번).

전에는 응답에 보안 헤더가 하나도 없었다. AI 키는 브라우저 localStorage 에 있으므로 스크립트가 하나라도
끼어들면(XSS) 키가 바로 샌다 — 그 문을 CSP 로 좁힌다. Caddy 가 아니라 **앱 안에서** 붙이는 까닭은
PC(Caddy 없음)와 서버에 같고, 시험할 수 있어서다.

- 언제나: `nosniff` · `Referrer-Policy: same-origin`(AI 출처 링크를 눌러도 이 서버 주소가 넘어가지 않게) ·
  `X-Frame-Options: DENY`(남의 페이지에 끼워 넣지 못하게) · `Permissions-Policy`(카메라·마이크·위치 끔).
- HTTPS 로 온 요청에만: `Strict-Transport-Security` 30일. **이미지 태그를 되돌려도 브라우저가 30일 기억한다**
  (DEPLOY.md). 하위 도메인은 모르므로 `includeSubDomains` 는 붙이지 않는다.
- CSP: 스크립트는 이 서버의 파일과 `index.html` 안의 테마 스크립트(해시)만. `style-src` 에 `'unsafe-inline'` 이
  있는 까닭은 차트(lightweight-charts)가 `<style>` 을 만들어서다. 바깥 글꼴·이미지·스크립트는 쓰지 않는다.
  **끄는 스위치**: `.env` 의 `SIGNAL_DASHBOARD_CSP=off` — 실기기에서 화면이 깨지면 이미지를 다시 받지 않고
  CSP 만 뺀다(다른 헤더는 남는다). 서버를 다시 띄워야 바뀐다.

**테마 스크립트 해시는 빌드한 `index.html` 에서 잰다.** 빌드가 바뀌어도 맞게, 파일이 바뀌면(mtime) 다시 잰다 —
`update.bat` 은 서버가 켜진 채로 다시 빌드한다. 재기 전에 줄바꿈을 LF 로 맞춘다: 윈도에서 받은 저장소는 CRLF 인데,
브라우저는 HTML 을 읽으며 CRLF 를 LF 로 바꾼 뒤 해시를 잰다.

둘 다 **순수 ASGI** 다 — 써지는 대로 보내는 AI 응답(SSE)을 붙잡지 않고, 본문은 읽히는 대로 센다.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import threading
from pathlib import Path

from app import web

CSP_SWITCH = "SIGNAL_DASHBOARD_CSP"

HSTS = "max-age=2592000"  # 30일

ALWAYS = (
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"same-origin"),
    (b"x-frame-options", b"DENY"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
)

# 요청 본문 한도. 이 앱에서 가장 큰 본문은 일괄 수정(30종목)으로 몇 KB 다. 올리는 파일은 없다.
MAX_BODY_BYTES = 1024 * 1024

_INLINE_SCRIPT = re.compile(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", re.S | re.I)


def csp_enabled() -> bool:
    return os.environ.get(CSP_SWITCH, "").strip().lower() not in ("off", "0", "false", "no")


def inline_script_hashes(html: str) -> list[str]:
    """`<script>…</script>`(src 없는 것)마다 CSP 해시. 줄바꿈은 브라우저처럼 LF 로 맞춘 뒤 잰다."""
    hashes = []
    for body in _INLINE_SCRIPT.findall(html):
        body = body.replace("\r\n", "\n").replace("\r", "\n")
        digest = base64.b64encode(hashlib.sha256(body.encode("utf-8")).digest()).decode()
        hashes.append(f"'sha256-{digest}'")
    return hashes


def build_csp(script_hashes: list[str]) -> str:
    script = " ".join(["'self'", *script_hashes])
    return "; ".join(
        [
            "default-src 'self'",
            f"script-src {script}",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "connect-src 'self'",
            "worker-src 'self'",
            "manifest-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
        ]
    )


class _CspCache:
    """빌드한 index.html 의 해시 — 파일이 바뀌었을 때만 다시 잰다."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._key: tuple[str, float] | None = None
        self._value = build_csp([])

    def value(self) -> str:
        dist = web.frontend_dist()
        index = (dist / "index.html") if dist is not None else None
        try:
            key = (str(index), index.stat().st_mtime) if index is not None else ("", 0.0)
        except OSError:
            key = ("", 0.0)
        with self._lock:
            if key != self._key:
                html = _read(index) if key[0] else ""
                self._value = build_csp(inline_script_hashes(html))
                self._key = key
            return self._value


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


_csp = _CspCache()


def _is_https(scope) -> bool:
    for name, value in scope.get("headers") or []:
        if name == b"x-forwarded-proto":
            return value.decode("latin-1").split(",")[0].strip() == "https"
    return scope.get("scheme") == "https"


class SecurityHeaders:
    """맨 바깥에 둔다 — 문지기의 401, 본문 한도의 413 에도 붙게."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        extra = list(ALWAYS)
        if _is_https(scope):
            extra.append((b"strict-transport-security", HSTS.encode()))
        if csp_enabled():
            extra.append((b"content-security-policy", _csp.value().encode()))
        names = {name for name, _ in extra}

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() not in names]
                message = {**message, "headers": headers + extra}
            await send(message)

        await self.app(scope, receive, send_with_headers)


def _too_large_body() -> bytes:
    return json.dumps(
        {
            "detail": {
                "hint": "보낸 내용이 너무 큽니다. 한 번에 보내는 양을 줄여 다시 시도하세요.",
                "message": "request body too large",
            }
        },
        ensure_ascii=False,
    ).encode()


class BodyLimit:
    """본문이 `MAX_BODY_BYTES` 를 넘으면 413. `Content-Length` 가 있으면 읽기 전에, 없으면 읽으며 센다."""

    def __init__(self, app, limit: int = MAX_BODY_BYTES) -> None:
        self.app = app
        self.limit = limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        for name, value in scope.get("headers") or []:
            if name == b"content-length":
                try:
                    declared = int(value)
                except ValueError:
                    declared = 0
                if declared > self.limit:
                    await _send_413(send)
                    return
                break

        seen = 0
        too_large = False
        replaced = False

        async def counting_receive():
            # 넘으면 앱에 더 주지 않고 끝을 알린다. FastAPI 는 읽다 생긴 오류를 400 으로 바꾸므로
            # 예외를 던지는 대신 표시만 하고, 나가는 응답을 413 으로 갈아 끼운다
            nonlocal seen, too_large
            if too_large:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > self.limit:
                    too_large = True
                    return {"type": "http.request", "body": b"", "more_body": False}
            return message

        async def guarded_send(message):
            nonlocal replaced
            if too_large:
                if message["type"] == "http.response.start" and not replaced:
                    replaced = True
                    await _send_413(send)
                return  # 앱이 쓰던 응답(400 등)은 버린다
            await send(message)

        await self.app(scope, counting_receive, guarded_send)
        if too_large and not replaced:
            await _send_413(send)


async def _send_413(send) -> None:
    body = _too_large_body()
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
        }
    )
    await send({"type": "http.response.body", "body": body})
