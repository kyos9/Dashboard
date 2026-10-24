"""보안 헤더 · CSP · 본문 한도 · 문서 화면 닫기 (0.45.4, 제로베이스 점검 3·4번)."""

from __future__ import annotations

import base64
import hashlib
import os
import time
from pathlib import Path

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app import security_headers as sh
from app import web
from tests.test_auth import PASSWORD, locked, login  # noqa: F401  (픽스처)

REPO = Path(__file__).resolve().parents[2]
THEME = "\n  (function () {\n    var a = 1\n  })()\n"


def _sha(text: str) -> str:
    return "'sha256-" + base64.b64encode(hashlib.sha256(text.encode()).digest()).decode() + "'"


@pytest.fixture()
def dist(tmp_path, monkeypatch):
    folder = tmp_path / "dist"
    folder.mkdir()
    (folder / "index.html").write_text(
        f"<!doctype html><script>{THEME}</script><script type=\"module\" src=\"/assets/a.js\"></script>",
        encoding="utf-8",
    )
    monkeypatch.setattr(web, "DIST", folder)
    return folder


@pytest.fixture()
def small(dist):
    """헤더·한도만 붙인 작은 앱 — 401·404·413 모양을 한 자리에서 본다."""
    app = FastAPI()

    @app.get("/api/ok")
    def ok():
        return {"ok": True}

    @app.get("/api/locked")
    def no():
        from fastapi import HTTPException

        raise HTTPException(status_code=401, detail="no")

    @app.post("/api/echo")
    async def echo(request: Request):
        return {"size": len(await request.body())}

    web.mount_frontend(app)
    app.add_middleware(sh.BodyLimit, limit=1000)
    app.add_middleware(sh.SecurityHeaders)
    return TestClient(app)


def _assert_always(res):
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["referrer-policy"] == "same-origin"
    assert res.headers["x-frame-options"] == "DENY"
    assert "camera=()" in res.headers["permissions-policy"]


@pytest.mark.parametrize("path, status", [("/api/ok", 200), ("/api/locked", 401), ("/api/nope", 404), ("/", 200),
                                          ("/history", 200)])
def test_headers_on_pages_api_and_errors(small, path, status):
    res = small.get(path)
    assert res.status_code == status
    _assert_always(res)
    csp = res.headers["content-security-policy"]
    assert "frame-ancestors 'none'" in csp and "object-src 'none'" in csp and "default-src 'self'" in csp
    # (500 은 Starlette 의 ServerErrorMiddleware 가 이보다 바깥이라 헤더가 빠질 수 있다 — 시험하지 않는다)


def test_hsts_only_over_https(small):
    assert "strict-transport-security" not in small.get("/api/ok").headers
    res = small.get("/api/ok", headers={"X-Forwarded-Proto": "https"})
    assert res.headers["strict-transport-security"] == "max-age=2592000"
    assert "includesubdomains" not in res.headers["strict-transport-security"].lower()


def test_csp_allows_the_theme_script_by_hash_and_nothing_inline_else(small):
    csp = small.get("/").headers["content-security-policy"]
    script = next(part for part in csp.split("; ") if part.startswith("script-src"))
    assert script == f"script-src 'self' {_sha(THEME)}"
    assert "unsafe-inline" not in script and "unsafe-eval" not in script


def test_crlf_index_hashes_like_the_browser(dist, small):
    """윈도에서 받은 저장소는 CRLF — 브라우저는 LF 로 바꿔 잰다 (계획 검토 개발자 2)."""
    index = dist / "index.html"
    index.write_bytes(index.read_bytes().replace(b"\n", b"\r\n"))
    os.utime(index, (time.time() + 5, time.time() + 5))
    assert _sha(THEME) in small.get("/").headers["content-security-policy"]


def test_rebuilt_index_is_measured_again(dist, small):
    """update.bat 은 서버가 켜진 채로 다시 빌드한다 — 파일이 바뀌면 해시도 바뀐다."""
    before = small.get("/").headers["content-security-policy"]
    other = "\nvar b = 2\n"
    (dist / "index.html").write_text(f"<script>{other}</script>", encoding="utf-8")
    os.utime(dist / "index.html", (time.time() + 10, time.time() + 10))
    after = small.get("/").headers["content-security-policy"]
    assert after != before and _sha(other) in after and _sha(THEME) not in after


def test_switch_drops_only_csp(small, monkeypatch):
    monkeypatch.setenv(sh.CSP_SWITCH, "off")
    res = small.get("/")
    assert "content-security-policy" not in res.headers
    _assert_always(res)


def test_body_limit(small):
    assert small.post("/api/echo", content=b"x" * 1000).json() == {"size": 1000}
    res = small.post("/api/echo", content=b"x" * 1001)
    assert res.status_code == 413
    assert res.json()["detail"]["message"] == "request body too large"
    _assert_always(res)


def test_body_limit_counts_when_length_is_not_given(small):
    def chunks():
        for _ in range(3):
            yield b"x" * 600

    res = small.post("/api/echo", content=chunks())  # chunked — Content-Length 없음
    assert res.status_code == 413


def test_real_app_index_hash_matches_the_source_theme_script():
    """`frontend/index.html` 의 테마 스크립트가 실제로 잡힌다(빌드가 인라인 스크립트를 그대로 둔다)."""
    source = (REPO / "frontend" / "index.html").read_text(encoding="utf-8")
    hashes = sh.inline_script_hashes(source)
    assert len(hashes) == 1  # 테마 스크립트 하나. 늘면 이 시험과 CSP 를 같이 본다
    built = REPO / "frontend" / "dist" / "index.html"
    if built.is_file():
        assert sh.inline_script_hashes(built.read_text(encoding="utf-8")) == hashes


# ---------------------------------------------------------------------------
#  진짜 앱 — 미들웨어 순서·문서 화면
# ---------------------------------------------------------------------------


def test_real_app_puts_headers_outside_the_guard(api, locked):  # noqa: F811
    client, _ = api
    res = client.get("/api/stocks")
    assert res.status_code == 401
    _assert_always(res)


def test_docs_are_closed_and_schema_is_behind_login(api, locked):  # noqa: F811
    """빌드가 있으면 SPA 폴백이 index.html 을 200 으로 준다 — 404 가 아니라 "스키마가 나오지 않는다"를 본다."""
    client, _ = api
    for path in ("/docs", "/redoc", "/openapi.json"):
        res = client.get(path)
        assert "openapi" not in res.text.lower() or "application/json" not in res.headers.get("content-type", ""), path
        assert "swagger" not in res.text.lower(), path
    assert client.get("/api/openapi.json").status_code == 401
    assert login(client).status_code == 200
    schema = client.get("/api/openapi.json")
    assert schema.status_code == 200 and "openapi" in schema.json()


def test_real_app_body_limit(api):
    client, _ = api
    res = client.put("/api/stocks/order", json={"tickers": ["A" * 64] * 20000})
    assert res.status_code == 413


def test_real_app_body_limit_without_length_is_413_not_a_parse_error(api):
    """FastAPI 는 본문을 읽다 생긴 오류를 400 으로 바꾼다 — 길이를 밝히지 않고 넘겨도 413 이어야 한다."""
    client, _ = api

    def chunks():
        for _ in range(3):
            yield b'{"tickers":[' + b'"AAAA",' * 60000

    res = client.put("/api/stocks/order", content=chunks(), headers={"content-type": "application/json"})
    assert res.status_code == 413
    assert res.json()["detail"]["message"] == "request body too large"


def test_compose_passes_the_csp_switch_to_the_app():
    """compose 는 적은 값만 넘긴다 — `.env` 에 off 를 적어도 여기 없으면 서버에 닿지 않는다."""
    compose = (REPO / "docker-compose.yml").read_text(encoding="utf-8")
    assert f"{sh.CSP_SWITCH}: ${{{sh.CSP_SWITCH}:-}}" in compose
    assert sh.CSP_SWITCH in (REPO / ".env.example").read_text(encoding="utf-8")
