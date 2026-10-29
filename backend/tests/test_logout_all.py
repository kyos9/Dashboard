"""모든 기기에서 나가기 (0.45.4) — 격리는 `test_isolation.check_logout_all` 이 본다. 여기는 문과 상태."""

from __future__ import annotations

import pytest

from app.models import PushSubscription, User
from app.services import auth as auth_service
from tests.factories import make_push_subscription, make_user, new_device
from tests.test_auth import PASSWORD, locked, login  # noqa: F401  (픽스처)


def test_open_pc_has_no_accounts_so_it_is_400(api):
    client, _ = api
    res = client.post("/api/auth/logout-all")
    assert res.status_code == 400
    assert res.json()["detail"]["message"] == "no accounts"


def test_password_door_is_400_too(api, locked):  # noqa: F811
    client, _ = api
    assert login(client).status_code == 200
    assert client.post("/api/auth/logout-all").status_code == 400


@pytest.mark.parametrize("status", ["pending", "rejected", "blocked"])
def test_only_approved_people(api, monkeypatch, status):
    """승인 대기·거절·차단은 401 — 문지기가 먼저 막는다. epoch 는 그대로."""
    monkeypatch.setenv(auth_service.GOOGLE_CLIENT_ID_ENV, "test-client")
    client, Session = api
    with Session() as db:
        user = make_user(db, id=7, email="p@example.com", google_sub="sub-7", status=status, is_owner=False)
        token = auth_service.issue_user_token(7, user.session_epoch, "sub-7")
        epoch = user.session_epoch
    client.cookies.set(auth_service.COOKIE_NAME, token)
    assert client.post("/api/auth/logout-all").status_code == 401
    with Session() as db:
        assert db.get(User, 7).session_epoch == epoch


def test_guest_is_401(api, monkeypatch):
    monkeypatch.setenv(auth_service.GOOGLE_CLIENT_ID_ENV, "test-client")
    client, _ = api
    assert client.post("/api/auth/logout-all").status_code == 401


def test_owner_can_too_and_every_device_stops(api, monkeypatch):
    monkeypatch.setenv(auth_service.GOOGLE_CLIENT_ID_ENV, "test-client")
    client, Session = api
    with Session() as db:
        owner = db.get(User, 1)
        owner.google_sub = "sub-1"
        owner.status = "active"
        db.commit()
        make_push_subscription(db, new_device(), user_id=1)
        token = auth_service.issue_user_token(1, owner.session_epoch, "sub-1")
    client.cookies.set(auth_service.COOKIE_NAME, token)
    assert client.post("/api/auth/logout-all").status_code == 200
    with Session() as db:
        assert db.query(PushSubscription).filter_by(user_id=1).count() == 0
    client.cookies.set(auth_service.COOKIE_NAME, token)
    assert client.get("/api/stocks").status_code == 401
