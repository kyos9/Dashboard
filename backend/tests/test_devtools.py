"""가짜 로그인·시세 서버(`devtools/fake_server.py`)가 지금 앱과 맞물려 도는지.

디자인 작업·E2E 가 이 서버로 화면을 띄운다. 앱이 바뀌어(로그인 흐름, 시세 저장, AI 응답 모양) 가짜가
어긋나면 화면을 못 띄운 채로 한참을 헤맨다 — 여기서 먼저 잡는다. 진짜 프로세스로 띄워서 본다.
"""

from __future__ import annotations

import html
import re
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest
import requests

from devtools import fake_server

BACKEND = Path(__file__).resolve().parent.parent


def test_reset_refuses_a_folder_it_did_not_make(tmp_path):
    (tmp_path / "keep.txt").write_text("내 파일")
    with pytest.raises(SystemExit):
        fake_server.prepare_data_dir(tmp_path, reset=True)
    assert (tmp_path / "keep.txt").exists()

    made = fake_server.prepare_data_dir(tmp_path / "dev", reset=False)
    (made / "app.db").write_text("x")
    fake_server.prepare_data_dir(made, reset=True)
    assert not (made / "app.db").exists()


def test_prices_are_the_same_whenever_they_are_fetched():
    full = fake_server.fake_history("NVDA", "max")
    recent = fake_server.fake_history("NVDA", "2y")
    assert recent.index[-1] == full.index[-1]
    assert (recent["close"] == full["close"].loc[recent.index]).all()
    assert (full["low"] <= full["close"]).all() and (full["close"] <= full["high"]).all()
    # 원화·엔화는 정수 가격
    assert (fake_server.fake_history("005930.KS")["close"] % 1 == 0).all()


def test_outside_requests_are_blocked_and_push_is_swallowed(monkeypatch):
    """진짜 서비스에 닿지 않게 — 실수로 진짜 키·주소가 섞여도 바깥으로 나가지 않는다."""
    # 끝나면 원래대로 (monkeypatch 가 지금 값을 기억했다가 되돌린다)
    monkeypatch.setattr(requests.sessions.Session, "request", requests.sessions.Session.request)
    fake_server.block_network()
    with pytest.raises(requests.ConnectionError, match="devtools"):
        requests.Session().get("https://query1.finance.yahoo.com/v8/finance/chart/AAPL")
    curl = pytest.importorskip("curl_cffi.requests")  # yfinance 가 쓰는 길
    monkeypatch.setattr(curl.Session, "request", curl.Session.request)
    fake_server.block_network()
    with pytest.raises(requests.ConnectionError, match="devtools"):
        curl.Session().get("https://query1.finance.yahoo.com/v8/finance/chart/AAPL")
    pushed = requests.Session().post("https://fcm.googleapis.com/fcm/send/abc", data=b"x")
    assert pushed.status_code == 201


def test_it_only_listens_on_this_machine():
    assert fake_server.HOST == "127.0.0.1"


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    port = _free_port()
    data = tmp_path_factory.mktemp("devdata")
    proc = subprocess.Popen(
        [sys.executable, "-m", "devtools.fake_server", "--port", str(port), "--data-dir", str(data)],
        cwd=BACKEND, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.time() + 120
        while time.time() < deadline:
            if proc.poll() is not None:
                pytest.fail("가짜 서버가 바로 꺼졌습니다:\n" + proc.stdout.read())
            try:
                if requests.Session().get(base + "/api/health", timeout=2).ok:
                    break
            except requests.ConnectionError:
                time.sleep(0.5)
        else:
            pytest.fail("가짜 서버가 120초 안에 뜨지 않았습니다")
        yield base
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


def login(base: str, email: str) -> requests.Session:
    """화면에서 '로그인' → 계정 고르기와 같은 길."""
    s = requests.Session()
    start = s.get(base + "/api/auth/google/start", allow_redirects=False)
    assert start.status_code in (302, 307)
    page_url = start.headers["location"]
    assert page_url.startswith(fake_server.DEV_LOGIN_PATH)
    page = s.get(base + page_url)
    links = [html.unescape(h) for h in re.findall(r'href="([^"]+)"', page.text)]
    mine = [link for link in links if email.replace("@", "%40") in link]
    if mine:
        callback = mine[0]
    else:  # 목록에 없는 주소는 입력칸으로
        callback = s.get(base + page_url, params={"email": email}, allow_redirects=False).headers["location"]
    done = s.get(callback, allow_redirects=False)
    assert done.status_code in (302, 303, 307), done.text
    return s


def test_demo_accounts_land_where_they_should(server):
    owner = login(server, fake_server.OWNER)
    status = owner.get(server + "/api/auth/status").json()
    assert status["user"]["is_owner"] is True
    assert status["pending_count"] == 1  # pending@example.com
    assert len(owner.get(server + "/api/dashboard").json()) == len(fake_server.OWNER_STOCKS)

    friend = login(server, fake_server.FRIEND)
    assert friend.get(server + "/api/auth/status").json()["user"]["status"] == "active"
    assert len(friend.get(server + "/api/dashboard").json()) == len(fake_server.FRIEND_STOCKS)

    newcomer = login(server, fake_server.NEWCOMER)
    assert newcomer.get(server + "/api/dashboard").json() == []

    for email in (fake_server.PENDING, "someone-new@example.com"):
        waiting = login(server, email)
        assert waiting.get(server + "/api/auth/status").json()["user"]["status"] == "pending"
        assert waiting.get(server + "/api/dashboard").status_code in (401, 403)


def test_login_page_sends_codes_only_back_to_this_server(server):
    s = requests.Session()
    bad = s.get(server + fake_server.DEV_LOGIN_PATH, params={
        "redirect_uri": "https://elsewhere.example/api/auth/google/callback", "state": "s", "nonce": "n",
    }, allow_redirects=False)
    assert bad.status_code == 400


def test_demo_data_shows_every_state_a_screen_needs(server):
    owner = login(server, fake_server.OWNER)
    rows = owner.get(server + "/api/dashboard").json()
    by_ticker = {r["ticker"]: r for r in rows}
    # 일부러 모양을 만든 종목 — 난수에 기대지 않는다
    assert by_ticker["NVDA"]["knee_buy_v2"] and by_ticker["005930.KS"]["knee_buy_v2"], "오늘 매수 시그널"
    assert by_ticker["AAPL"]["shoulder_sell_ref"] and by_ticker["000660.KS"]["shoulder_sell_ref"], "매도(참고) 시그널"
    assert any(r["rebalance_signal"]["active"] for r in rows), "비중조절 신호가 있어야 한다"
    assert not any(r["data_stale"] for r in rows)

    fundamentals = {r["ticker"]: r for r in owner.get(server + "/api/fundamentals").json()}
    assert fundamentals["VOO"]["state"] == "none"  # ETF
    per = {m["key"]: m for m in fundamentals["TSLA"]["metrics"]}["per"]
    assert per["value"] is None and per["note"] == "적자"
    assert {m["key"]: m for m in fundamentals["AAPL"]["metrics"]}["per"]["value"] > 0

    macro = owner.get(server + "/api/macro").json()["series"]
    assert macro and all(s["value"] is not None and not s["stale"] for s in macro)

    rebalance = owner.get(server + "/api/rebalance/current").json()
    assert rebalance["total_value_base"] > 100_000_000  # 억 단위 금액
    rates = rebalance["fx"]["rates"]
    assert rates["USD"]["krw_rate"] == fake_server.FX["USD"] and rates["JPY"]["krw_rate"] == fake_server.FX["JPY"]


def test_fake_ai_answers_like_each_provider(server):
    owner = login(server, fake_server.OWNER)
    key = {"X-AI-Key": "dev-key-not-real"}
    models = owner.post(server + "/api/ai/models", json={"provider": "gemini"}, headers=key).json()["models"]
    assert "gemini-dev-flash" in [m["id"] for m in models]
    for provider, model in (("anthropic", "claude-dev"), ("openai", "gpt-dev"), ("gemini", "gemini-dev-flash")):
        res = owner.post(server + "/api/ai/research/NVDA/stream", json={"provider": provider, "model": model}, headers=key)
        assert res.status_code == 200, (provider, res.text)
        assert "event: delta" in res.text and "example.com" in res.text  # 글과 출처
    limited = owner.post(server + "/api/ai/research/NVDA/stream",
                         json={"provider": "gemini", "model": "gemini-dev-pro"}, headers=key)
    assert limited.status_code == 429 and limited.json()["detail"]["code"] == "free_tier_model"


def test_adding_a_stock_uses_fake_prices_not_the_internet(server):
    owner = login(server, fake_server.OWNER)
    added = owner.post(server + "/api/stocks", json={"ticker": "AMZN"})
    assert added.status_code in (200, 201), added.text
    deadline = time.time() + 30
    while time.time() < deadline:
        rows = {r["ticker"]: r for r in owner.get(server + "/api/dashboard").json()}
        if rows.get("AMZN", {}).get("price_source"):  # 뒤에서 받는다 — 들어올 때까지
            break
        time.sleep(0.5)
    assert rows["AMZN"]["price_source"] == "dev"
