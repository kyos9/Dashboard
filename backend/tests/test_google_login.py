"""구글 로그인 (ROADMAP 4단계 5·6번, 4-3).

**검증은 흉내 내지 않는다.** RSA 키를 하나 만들어 진짜로 서명한 `id_token` 을 쓰고, 구글
공개키 주소만 가짜로 바꿔 그 키를 돌려준다. 그러면 서명·발급자·대상·만료 검증은
`google-auth` 가 실제로 한다 — 이 파일이 확인하는 것은 **우리가 그 검증을 제대로 부르고,
그 결과를 제대로 쓰는가**다. 검증 함수를 통째로 가짜로 바꾸면 "대상(aud)을 안 넘겼다"
같은 실수가 테스트를 그대로 통과한다.
"""

from __future__ import annotations

import base64
import hashlib
import json
import time
from urllib.parse import parse_qs, urlparse

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from google.auth import crypt, jwt

from app.models import User, UserStock
from app.services import auth
from app.services import google_login as google
from app.services.users import LOCAL_USER_ID
from tests.factories import make_stock, make_user

CLIENT_ID = "test-client.apps.googleusercontent.com"
OWNER = "owner@example.com"
FRIEND = "friend@example.com"
STRANGER = "stranger@example.com"
HTTPS = {"x-forwarded-proto": "https", "host": "board.example.org"}
# 로그인 흐름은 평문으로 돈다. 테스트 클라이언트는 http 라서 Secure 쿠키를 돌려보내지
# 않는다 — 진짜 서버(https)에서는 실린다. Secure 가 붙는지는 첫 테스트가 따로 본다.
PLAIN: dict = {}


def _key():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    public_pem = private.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    return private_pem, public_pem


GOOGLE_KEY = _key()   # 구글이 서명한 것으로 칠 키
OTHER_KEY = _key()    # 남이 서명한 것


class _FakeCertsResponse:
    status = 200

    def __init__(self, body: dict):
        self.data = json.dumps(body).encode()


def fake_transport(url, method="GET", **kwargs):
    """구글 공개키 주소 대신 우리 키를 돌려준다."""
    assert "googleapis.com" in url, url  # 엉뚱한 곳에서 키를 받아오면 안 된다
    return _FakeCertsResponse({"k1": GOOGLE_KEY[1].decode()})


def sign(claims: dict, key=GOOGLE_KEY) -> str:
    signer = crypt.RSASigner.from_string(key[0], key_id="k1")
    return jwt.encode(signer, claims).decode()


def claims_for(email: str, sub: str, nonce: str, **over) -> dict:
    now = int(time.time())
    base = {
        "iss": "https://accounts.google.com",
        "aud": CLIENT_ID,
        "sub": sub,
        "email": email,
        "email_verified": True,
        "name": email.split("@")[0],
        "nonce": nonce,
        "iat": now,
        "exp": now + 3600,
    }
    base.update(over)
    return base


@pytest.fixture()
def google_on(monkeypatch):
    monkeypatch.setenv(auth.GOOGLE_CLIENT_ID_ENV, CLIENT_ID)
    monkeypatch.setenv(google.CLIENT_SECRET_ENV, "test-secret")
    monkeypatch.setenv(google.OWNER_EMAIL_ENV, OWNER)
    monkeypatch.setenv(google.ALLOWED_EMAILS_ENV, FRIEND)
    monkeypatch.delenv(google.PUBLIC_URL_ENV, raising=False)
    monkeypatch.setattr(google, "_transport", lambda: fake_transport)


class GoogleSays:
    """토큰 교환 창구를 흉내 낸다. 무엇을 받았는지 적어두고, 정해둔 id_token 을 준다."""

    def __init__(self, monkeypatch):
        self.received: dict | None = None
        self.make_token = None  # nonce → id_token
        import requests

        def post(url, data=None, timeout=None, **kwargs):
            assert url == google.TOKEN_URL
            self.received = dict(data)
            return _Resp(200, {"id_token": self.make_token(self.nonce)})

        monkeypatch.setattr(requests, "post", post)
        self.nonce = None


class _Resp:
    def __init__(self, status_code, body):
        self.status_code = status_code
        self._body = body

    def json(self):
        return self._body


@pytest.fixture()
def google_says(monkeypatch, google_on):
    return GoogleSays(monkeypatch)


def start(client, headers=PLAIN):
    """로그인 버튼을 누른다 → (구글로 가는 주소의 쿼리, 흐름 쿠키)."""
    response = client.get("/api/auth/google/start", headers=headers, follow_redirects=False)
    assert response.status_code == 302, response.text
    query = parse_qs(urlparse(response.headers["location"]).query)
    return {k: v[0] for k, v in query.items()}, response


def login_as(client, says: GoogleSays, email: str, sub: str, nonce: str | None = None, **over):
    """구글에서 그 계정을 골라 돌아온 것까지. 콜백 응답을 돌려준다.

    `nonce` 를 주면 우리가 보낸 것 대신 그 값을 토큰에 넣는다 (다른 로그인의 토큰).
    """
    params, _ = start(client)
    says.nonce = params["nonce"]
    says.make_token = lambda sent: sign(claims_for(email, sub, nonce or sent, **over))
    return client.get(
        "/api/auth/google/callback",
        params={"code": "the-code", "state": params["state"]},
        follow_redirects=False,
    )


def error_of(response) -> str | None:
    assert response.status_code == 302, response.text
    query = parse_qs(urlparse(response.headers["location"]).query)
    return query.get("login_error", [None])[0]


# ---------------------------------------------------------------------------
#  구글로 보내기
# ---------------------------------------------------------------------------


def test_start_sends_the_browser_to_google_with_state_nonce_and_pkce(api, google_on):
    client, _ = api
    params, response = start(client, headers=HTTPS)

    assert response.headers["location"].startswith(google.AUTH_URL)
    assert params["client_id"] == CLIENT_ID
    assert params["redirect_uri"] == "https://board.example.org/api/auth/google/callback"
    assert params["scope"] == "openid email profile"
    assert params["code_challenge_method"] == "S256"
    assert len(params["state"]) >= 40 and len(params["nonce"]) >= 40

    cookie = response.headers["set-cookie"]
    assert google.FLOW_COOKIE in cookie
    assert "HttpOnly" in cookie and "Secure" in cookie
    assert "samesite=lax" in cookie.lower()
    assert f"Path={google.FLOW_COOKIE_PATH}" in cookie


def test_public_url_overrides_the_request_host(api, google_on, monkeypatch):
    """앞의 웹서버가 Host 를 바꿔 넘기는 구성에서도 콘솔에 적은 주소와 맞춘다."""
    monkeypatch.setenv(google.PUBLIC_URL_ENV, "https://me.duckdns.org/")
    params, _ = start(api[0])
    assert params["redirect_uri"] == "https://me.duckdns.org/api/auth/google/callback"


def test_start_is_404_when_google_is_off(api):
    assert api[0].get("/api/auth/google/start", follow_redirects=False).status_code == 404


def test_missing_owner_email_is_refused_before_going_to_google(api, google_on, monkeypatch):
    """주인 이메일이 없으면 "처음 들어온 사람이 주인"이 된다. 그 기본값으로는 안 연다."""
    monkeypatch.delenv(google.OWNER_EMAIL_ENV)
    client, _ = api
    response = client.get("/api/auth/google/start", follow_redirects=False)
    assert error_of(response) == google.REASON_CONFIG
    assert "OWNER_GOOGLE_EMAIL" in client.get("/api/auth/status").json()["config_problem"]


# ---------------------------------------------------------------------------
#  돌아왔을 때 — 되는 경우
# ---------------------------------------------------------------------------


def test_owner_login_attaches_to_user_1_and_sees_existing_data(api, google_says):
    """**전환 당일에 반드시 겪는 일.** 내 구글 계정이 새 사용자가 되면 내 종목이 사라진 것처럼 보인다."""
    client, Session = api
    with Session() as db:
        make_stock(db, "VOO", user_id=LOCAL_USER_ID, name="원래 있던 종목")

    response = login_as(client, google_says, OWNER, "sub-owner")
    assert error_of(response) is None
    assert response.headers["location"] == "/"

    with Session() as db:
        assert db.query(User).count() == 1  # 새 사람을 만들지 않았다
        owner = db.get(User, LOCAL_USER_ID)
        assert owner.google_sub == "sub-owner"
        assert owner.email == OWNER
        assert owner.last_login_at is not None

    assert [s["ticker"] for s in client.get("/api/stocks").json()] == ["VOO"]
    status = client.get("/api/auth/status").json()
    assert status["mode"] == "google" and status["authenticated"] is True
    assert status["user"] == {"email": OWNER, "name": "owner", "is_owner": True}


def test_the_code_is_exchanged_with_the_matching_pkce_verifier(api, google_says):
    client, _ = api
    params, _ = start(client)
    google_says.nonce = params["nonce"]
    google_says.make_token = lambda nonce: sign(claims_for(OWNER, "sub-owner", nonce))
    client.get(
        "/api/auth/google/callback",
        params={"code": "the-code", "state": params["state"]}, follow_redirects=False,
    )

    sent = google_says.received
    assert sent["code"] == "the-code"
    assert sent["grant_type"] == "authorization_code"
    assert sent["redirect_uri"] == params["redirect_uri"]  # 한 글자라도 다르면 구글이 거절한다
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(sent["code_verifier"].encode()).digest()
    ).rstrip(b"=").decode()
    assert challenge == params["code_challenge"]


def test_a_friend_on_the_list_gets_their_own_empty_account(api, google_says):
    client, Session = api
    with Session() as db:
        make_stock(db, "VOO", user_id=LOCAL_USER_ID)

    assert error_of(login_as(client, google_says, FRIEND, "sub-friend")) is None
    assert client.get("/api/stocks").json() == []  # 주인 것이 안 보인다

    with Session() as db:
        friend = db.query(User).filter_by(google_sub="sub-friend").one()
        assert friend.id != LOCAL_USER_ID and friend.is_owner is False
    status = client.get("/api/auth/status").json()
    assert status["user"]["is_owner"] is False


def test_logging_in_again_is_the_same_person(api, google_says):
    client, Session = api
    login_as(client, google_says, FRIEND, "sub-friend")
    client.cookies.clear()
    login_as(client, google_says, FRIEND, "sub-friend")
    with Session() as db:
        assert db.query(User).filter_by(google_sub="sub-friend").count() == 1


def test_email_case_does_not_matter(api, google_says):
    client, Session = api
    assert error_of(login_as(client, google_says, "Owner@Example.com", "sub-owner")) is None
    with Session() as db:
        assert db.get(User, LOCAL_USER_ID).google_sub == "sub-owner"


# ---------------------------------------------------------------------------
#  돌아왔을 때 — 막아야 하는 경우
# ---------------------------------------------------------------------------


def _no_session(client, Session, users_before: int):
    client.cookies.delete(google.FLOW_COOKIE)
    assert client.get("/api/stocks").status_code == 401
    with Session() as db:
        assert db.query(User).count() == users_before


def test_someone_not_on_the_list_is_turned_away(api, google_says):
    client, Session = api
    assert error_of(login_as(client, google_says, STRANGER, "sub-x")) == google.REASON_NOT_ALLOWED
    _no_session(client, Session, 1)


def test_an_unverified_email_does_not_pass_the_list(api, google_says):
    """확인 안 된 이메일은 남의 주소를 적어 넣은 계정일 수 있다."""
    client, Session = api
    response = login_as(client, google_says, OWNER, "sub-fake", email_verified=False)
    assert error_of(response) == google.REASON_NOT_ALLOWED
    with Session() as db:
        assert db.get(User, LOCAL_USER_ID).google_sub is None  # 주인 자리가 안 넘어갔다


def test_removing_a_friend_from_the_list_stops_their_next_login(api, google_says, monkeypatch):
    client, _ = api
    assert error_of(login_as(client, google_says, FRIEND, "sub-friend")) is None
    monkeypatch.setenv(google.ALLOWED_EMAILS_ENV, "")
    client.cookies.clear()
    assert error_of(login_as(client, google_says, FRIEND, "sub-friend")) == google.REASON_NOT_ALLOWED


@pytest.mark.parametrize(
    "tamper",
    [
        pytest.param({"aud": "someone-elses-app"}, id="다른 앱에 발급된 토큰"),
        pytest.param({"iss": "https://evil.example.com"}, id="구글이 아닌 발급자"),
        pytest.param({"exp": int(time.time()) - 3600, "iat": int(time.time()) - 7200}, id="만료"),
    ],
)
def test_a_token_that_is_not_for_this_login_is_rejected(api, google_says, tamper):
    client, Session = api
    assert error_of(login_as(client, google_says, OWNER, "sub-owner", **tamper)) == google.REASON_FAILED
    _no_session(client, Session, 1)


def test_a_token_from_another_login_is_rejected(api, google_says):
    """가로챈 id_token 을 다른 로그인에 끼워 넣기 — 서명·대상은 멀쩡하고 nonce 만 다르다."""
    client, Session = api
    response = login_as(client, google_says, OWNER, "sub-owner", nonce="nonce-of-another-login")
    assert error_of(response) == google.REASON_FAILED
    _no_session(client, Session, 1)


def test_a_token_signed_by_someone_else_is_rejected(api, google_says):
    client, Session = api
    params, _ = start(client)
    google_says.nonce = params["nonce"]
    google_says.make_token = lambda nonce: sign(claims_for(OWNER, "sub-owner", nonce), key=OTHER_KEY)
    response = client.get(
        "/api/auth/google/callback",
        params={"code": "c", "state": params["state"]}, follow_redirects=False,
    )
    assert error_of(response) == google.REASON_FAILED
    _no_session(client, Session, 1)


def test_a_state_that_we_did_not_issue_is_rejected(api, google_says):
    """남이 만든 로그인 링크 — 내 브라우저에 남의 구글 계정이 붙는 공격이다."""
    client, Session = api
    params, _ = start(client)
    google_says.nonce = params["nonce"]
    google_says.make_token = lambda nonce: sign(claims_for(OWNER, "sub-owner", nonce))
    response = client.get(
        "/api/auth/google/callback",
        params={"code": "c", "state": "attackers-state"}, follow_redirects=False,
    )
    assert error_of(response) == google.REASON_EXPIRED
    assert google_says.received is None  # 토큰 교환까지 가지도 않았다
    _no_session(client, Session, 1)


def test_coming_back_without_the_flow_cookie_is_rejected(api, google_says):
    client, _ = api
    params, _ = start(client)
    client.cookies.clear()
    response = client.get(
        "/api/auth/google/callback",
        params={"code": "c", "state": params["state"]}, follow_redirects=False,
    )
    assert error_of(response) == google.REASON_EXPIRED


def test_a_forged_flow_cookie_is_rejected(api, google_says):
    """쿠키를 직접 만들어 넣어도 우리 서명이 없으면 안 된다."""
    client, _ = api
    forged = "s.n.v.9999999999.0000"
    client.cookies.set(google.FLOW_COOKIE, forged, path=google.FLOW_COOKIE_PATH)
    response = client.get(
        "/api/auth/google/callback",
        params={"code": "c", "state": "s"}, follow_redirects=False,
    )
    assert error_of(response) == google.REASON_EXPIRED


def test_an_old_flow_cookie_is_rejected():
    flow = google.Flow(state="s", nonce="n", verifier="v", expires_at=100)
    assert google.unpack_flow(google.pack_flow(flow), now=50) == flow
    assert google.unpack_flow(google.pack_flow(flow), now=101) is None


def test_cancelling_on_google_comes_back_quietly(api, google_on):
    client, _ = api
    start(client)
    response = client.get(
        "/api/auth/google/callback", params={"error": "access_denied"}, follow_redirects=False
    )
    assert error_of(response) == google.REASON_CANCELLED


# ---------------------------------------------------------------------------
#  쪽지
# ---------------------------------------------------------------------------


def test_the_password_door_is_closed_when_google_is_on(api, google_on, monkeypatch):
    """둘 다 열어두면 비밀번호를 아는 사람이 언제든 주인으로 들어온다."""
    monkeypatch.setenv(auth.PASSWORD_ENV, "pw")
    client, _ = api
    assert client.post("/api/auth/login", json={"password": "pw"}).status_code == 400
    # 예전 비밀번호 쪽지(v1)를 들고 있어도 안 열린다
    old_ticket = auth.issue_token()
    assert auth.token_is_valid(old_ticket) is False
    client.cookies.set(auth.COOKIE_NAME, old_ticket)
    assert client.get("/api/stocks").status_code == 401


def test_raising_the_epoch_logs_that_person_out_everywhere(api, google_says):
    client, Session = api
    login_as(client, google_says, FRIEND, "sub-friend")
    assert client.get("/api/stocks").status_code == 200
    with Session() as db:
        db.query(User).filter_by(google_sub="sub-friend").one().session_epoch += 1
        db.commit()
    assert client.get("/api/stocks").status_code == 401


def test_a_token_cannot_be_moved_to_another_user_id(api, google_says):
    """번호만 바꿔 끼운 쪽지 — 서명에 번호가 들어 있어 안 맞는다."""
    client, Session = api
    login_as(client, google_says, FRIEND, "sub-friend")
    token = client.cookies.get(auth.COOKIE_NAME)
    parts = token.split(".")
    parts[1] = str(LOCAL_USER_ID)
    client.cookies.set(auth.COOKIE_NAME, ".".join(parts))
    assert client.get("/api/stocks").status_code == 401


def test_a_withdrawn_persons_token_does_not_open_whoever_gets_their_number(api, google_says):
    """SQLite 는 지운 번호를 다음 사람에게 다시 줄 수 있다. 서명에 구글 계정을 섞은 이유."""
    client, Session = api
    login_as(client, google_says, FRIEND, "sub-friend")
    old = client.cookies.get(auth.COOKIE_NAME)
    friend_id = int(old.split(".")[1])
    assert client.delete("/api/auth/me").status_code == 204

    with Session() as db:
        make_user(db, id=friend_id, google_sub="sub-someone-new", email="new@example.com")
    client.cookies.set(auth.COOKIE_NAME, old)
    assert client.get("/api/stocks").status_code == 401


def test_the_owner_cannot_withdraw(api, google_says):
    """주인이 사라지면 공용 데이터를 돌볼 사람이 없다."""
    client, Session = api
    login_as(client, google_says, OWNER, "sub-owner")
    assert client.delete("/api/auth/me").status_code == 403
    with Session() as db:
        assert db.get(User, LOCAL_USER_ID) is not None


def test_withdrawing_needs_google_mode(api):
    assert api[0].delete("/api/auth/me").status_code == 400


def test_a_withdrawn_friend_can_come_back_as_a_fresh_account(api, google_says):
    client, Session = api
    login_as(client, google_says, FRIEND, "sub-friend")
    client.post("/api/stocks", json={"ticker": "VOO"})
    client.delete("/api/auth/me")
    client.cookies.clear()

    assert error_of(login_as(client, google_says, FRIEND, "sub-friend")) is None
    assert client.get("/api/stocks").json() == []
    with Session() as db:
        assert db.query(UserStock).filter(UserStock.user_id != LOCAL_USER_ID).count() == 0
