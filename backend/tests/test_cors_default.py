"""CORS 는 기본으로 꺼져 있다 — 다른 출처가 쿠키를 들고 이 서버를 부를 수 없다."""


def test_no_cors_headers_by_default(api):
    client = api[0]
    response = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    assert "access-control-allow-origin" not in response.headers
    assert "access-control-allow-credentials" not in response.headers
