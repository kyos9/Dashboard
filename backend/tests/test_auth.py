"""비밀번호 잠금 (ROADMAP 5단계).

여기서 지키려는 건 하나다 — **서버에 올렸을 때 아무나 못 들어온다.** 그리고 그것
때문에 개인 PC에서 쓰던 방식이 망가지지 않는다.
"""

import time

import pytest

from app.services import auth

PASSWORD = "열어라-참깨-0604"


@pytest.fixture()
def locked(monkeypatch):
    monkeypatch.setenv(auth.PASSWORD_ENV, PASSWORD)
    auth.reset_throttle()


def login(client, password=PASSWORD):
    return client.post("/api/auth/login", json={"password": password})


# ---------------------------------------------------------------------------
#  잠그지 않았을 때 — 개인 PC
# ---------------------------------------------------------------------------


def test_nothing_changes_when_no_password_is_set(api):
    """비밀번호를 안 정했으면 예전과 똑같이 동작한다."""
    client, _ = api
    assert client.get("/api/stocks").status_code == 200

    health = client.get("/api/health").json()
    assert health["locked"] is False
    assert "version" in health


def test_login_is_a_no_op_when_the_door_is_open(api):
    client, _ = api
    body = login(client, "아무거나").json()
    assert body == {"locked": False, "authenticated": True}


# ---------------------------------------------------------------------------
#  잠갔을 때
# ---------------------------------------------------------------------------


def test_api_is_closed_without_logging_in(api, locked):
    client, _ = api
    assert client.get("/api/stocks").status_code == 401


def test_logs_are_closed_too(api, locked):
    """이 잠금을 만든 이유. 로그에는 종목·에러·내부 경로가 전부 찍힌다."""
    client, _ = api
    assert client.get("/api/logs").status_code == 401
    assert client.get("/api/logs/download").status_code == 401


def test_the_right_password_opens_it(api, locked):
    client, _ = api
    assert login(client).status_code == 200
    assert client.get("/api/stocks").status_code == 200
    assert client.get("/api/auth/status").json() == {"locked": True, "authenticated": True}


def test_the_wrong_password_does_not(api, locked):
    client, _ = api
    response = login(client, "틀린비밀번호")
    assert response.status_code == 401
    assert client.get("/api/stocks").status_code == 401


def test_logging_out_closes_it_again(api, locked):
    client, _ = api
    login(client)
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/stocks").status_code == 401


def test_health_stays_open_but_says_nothing(api, locked):
    """컨테이너 헬스체크가 401을 받으면 '앱이 죽었다'로 읽고 계속 다시 띄운다."""
    client, _ = api
    response = client.get("/api/health")
    assert response.status_code == 200

    body = response.json()
    assert body["locked"] is True
    # 로그인 전에는 버전도 제공자도 알려주지 않는다
    assert "version" not in body
    assert "providers_by_market" not in body

    login(client)
    assert "version" in client.get("/api/health").json()


def test_the_login_screen_itself_is_reachable(api, locked):
    """화면 파일까지 막으면 로그인할 방법이 없어진다."""
    client, _ = api
    # 빌드된 화면이 없으면 404 — 어느 쪽이든 401이면 안 된다
    assert client.get("/").status_code != 401


# ---------------------------------------------------------------------------
#  무차별 대입
# ---------------------------------------------------------------------------


def test_repeated_wrong_guesses_get_locked_out(api, locked):
    client, _ = api
    for _ in range(auth.MAX_FAILURES):
        assert login(client, "틀린비밀번호").status_code == 401

    blocked = login(client, "틀린비밀번호")
    assert blocked.status_code == 429

    # 맞는 비밀번호를 넣어도 잠긴 동안은 안 열린다
    assert login(client).status_code == 429


def test_the_lockout_ends_by_itself():
    auth.record_failure("1.2.3.4", now=1000.0)
    for _ in range(auth.MAX_FAILURES - 1):
        auth.record_failure("1.2.3.4", now=1000.0)

    assert auth.seconds_until_retry("1.2.3.4", now=1000.0) > 0
    assert auth.seconds_until_retry("1.2.3.4", now=1000.0 + auth.LOCKOUT_SECONDS + 1) == 0


def test_a_successful_login_clears_the_count():
    for _ in range(auth.MAX_FAILURES - 1):
        auth.record_failure("1.2.3.4")
    auth.record_success("1.2.3.4")

    for _ in range(auth.MAX_FAILURES - 1):
        auth.record_failure("1.2.3.4")
    assert auth.seconds_until_retry("1.2.3.4") == 0


# ---------------------------------------------------------------------------
#  쪽지(토큰)
# ---------------------------------------------------------------------------


def test_a_made_up_token_is_rejected(api, locked):
    client, _ = api
    client.cookies.set(auth.COOKIE_NAME, "v1.99999999999.notarealsignature")
    assert client.get("/api/stocks").status_code == 401


def test_a_token_expires(monkeypatch):
    monkeypatch.setenv(auth.PASSWORD_ENV, PASSWORD)
    token = auth.issue_token()
    assert auth.token_is_valid(token) is True
    assert auth.token_is_valid(token, now=time.time() + auth.SESSION_SECONDS + 1) is False


def test_changing_the_password_invalidates_tokens_that_are_already_out(monkeypatch):
    """비밀번호를 바꿨는데 들어와 있던 사람이 그대로면 바꾼 의미가 없다."""
    monkeypatch.setenv(auth.PASSWORD_ENV, PASSWORD)
    token = auth.issue_token()
    assert auth.token_is_valid(token) is True

    monkeypatch.setenv(auth.PASSWORD_ENV, "새-비밀번호-0917")
    assert auth.token_is_valid(token) is False


def test_the_signing_key_survives_a_restart(monkeypatch, tmp_path):
    """다시 띄울 때마다 로그아웃되면 배포할 때마다 폰에서 다시 로그인해야 한다."""
    monkeypatch.setenv(auth.PASSWORD_ENV, PASSWORD)
    monkeypatch.setattr(auth, "KEY_FILE", tmp_path / "session.key")
    auth.reset_key_cache()

    token = auth.issue_token()
    auth.reset_key_cache()  # 앱을 껐다 켠 셈
    assert auth.token_is_valid(token) is True


def test_the_key_file_is_not_readable_by_others(monkeypatch, tmp_path):
    monkeypatch.setattr(auth, "KEY_FILE", tmp_path / "session.key")
    auth.reset_key_cache()
    auth.signing_key()

    mode = (tmp_path / "session.key").stat().st_mode & 0o777
    assert mode == 0o600
