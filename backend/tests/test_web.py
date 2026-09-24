"""백엔드가 화면을 직접 내보내는 경로.

프로세스를 하나로 합치면서 생긴 위험은 둘이다. (1) 모든 주소를 받아내는 SPA 폴백이
API를 삼키는 것, (2) 경로에 `../`를 넣어 서버 파일을 읽어가는 것. 둘 다 여기서 막는다.
"""

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import web


@pytest.fixture()
def served(tmp_path, monkeypatch):
    """가짜 빌드 결과를 만들어 마운트한 앱."""
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>신호판</title>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
    (dist / "favicon.svg").write_text("<svg/>", encoding="utf-8")
    (dist / "sw.js").write_text("self.addEventListener('fetch', () => {})", encoding="utf-8")
    (dist / "manifest.webmanifest").write_text('{"name": "신호판"}', encoding="utf-8")
    (tmp_path / "secret.txt").write_text("남의 파일", encoding="utf-8")

    monkeypatch.setattr(web, "DIST", dist)

    app = FastAPI()

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    assert web.mount_frontend(app) is True
    return TestClient(app)


def test_api_still_wins(served):
    assert served.get("/api/health").json() == {"status": "ok"}


def test_unknown_api_path_is_404_not_html(served):
    """없는 API에 HTML이 돌아오면 "JSON인 줄 알았는데 <!doctype html>"을 쫓게 된다."""
    res = served.get("/api/nope")
    assert res.status_code == 404
    assert "text/html" not in res.headers["content-type"]


def test_client_routes_fall_back_to_index(served):
    """/history는 서버에 그런 파일이 없고 브라우저 안에서만 뜻이 있다."""
    res = served.get("/history")
    assert res.status_code == 200
    assert "신호판" in res.text


def test_static_files_are_served(served):
    assert served.get("/favicon.svg").status_code == 200
    assert served.get("/assets/app.js").text == "console.log(1)"


def test_hashed_assets_are_cached_for_good(served):
    assert served.get("/assets/app.js").headers["cache-control"] == "public, max-age=31536000, immutable"
    # 없는 파일의 404까지 1년 캐시되면, 배포 직후 잠깐 없던 파일이 영영 없는 것으로 남는다
    missing = served.get("/assets/nope.js")
    assert missing.status_code == 404
    assert "immutable" not in missing.headers.get("cache-control", "")


def test_index_is_not_cached(served):
    """index.html이 캐시되면 새 버전을 올려도 옛 화면이 뜬다."""
    assert served.get("/").headers.get("cache-control") == "no-cache"


@pytest.mark.parametrize("path", ["/sw.js", "/manifest.webmanifest"])
def test_pwa_files_are_not_cached(served, path):
    """서비스 워커가 캐시되면 새 버전이 영영 안 내려간다.

    브라우저는 sw.js를 다시 받아 **내용이 달라졌을 때만** 갱신을 시작한다. 캐시가 옛
    내용을 돌려주면 달라진 적이 없는 상태로 굳고, 사람이 브라우저 설정에서 손으로
    지우기 전까지 배포가 반영되지 않는다.
    """
    assert served.get(path).headers.get("cache-control") == "no-cache"


def test_service_worker_is_served_as_javascript(served):
    """HTML로 나가면 브라우저가 등록을 거부한다 (SPA 폴백에 먹히지 않는지도 같이 본다)."""
    res = served.get("/sw.js")
    assert res.status_code == 200
    assert "javascript" in res.headers["content-type"]
    assert "addEventListener" in res.text


def test_manifest_has_its_own_content_type(served):
    """text/html로 나가면 크롬이 manifest를 읽지 않아 설치 버튼이 뜨지 않는다."""
    res = served.get("/manifest.webmanifest")
    assert res.status_code == 200
    assert "manifest+json" in res.headers["content-type"]


@pytest.mark.parametrize("path", ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt"])
def test_cannot_escape_dist(served, path):
    """경로 조작으로 dist 바깥을 읽지 못한다."""
    assert "남의 파일" not in served.get(path).text


def test_traversal_guard_runs_even_if_client_does_not_normalize(served, tmp_path):
    """위 요청은 http 클라이언트가 경로를 정리해버릴 수 있다 — 핸들러를 직접 불러 확인한다.

    정리해주는 클라이언트만 믿으면, 정리하지 않는 클라이언트 앞에서 그대로 뚫린다.
    """
    app = served.app
    spa = next(r.endpoint for r in app.routes if getattr(r, "name", "") == "spa")
    assert "남의 파일" not in (tmp_path / "dist" / "index.html").read_text(encoding="utf-8")
    # 바깥 파일이 아니라 index.html로 되돌아와야 한다
    assert Path(spa("../secret.txt").path) == tmp_path / "dist" / "index.html"


def test_no_build_means_no_mount(tmp_path, monkeypatch):
    """빌드 전에는 아무것도 붙이지 않는다 — 개발 중에는 vite로 접속한다."""
    monkeypatch.setattr(web, "DIST", tmp_path / "없음")
    app = FastAPI()
    assert web.mount_frontend(app) is False
    assert TestClient(app).get("/history").status_code == 404
