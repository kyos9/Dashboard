"""가입 신청 → 관리자 승인 (ROADMAP 4-4b).

누구나 구글로 신청은 할 수 있고(승인 대기), 쓰는 것은 관리자가 승인한 뒤다. 여기서 볼 것:

- 승인 대기인 사람은 **손님과 똑같다** — 앱의 모든 API를 불러 손님에게 열린 것만 지나가는지
  (격리 표를 그대로 쓴다. 새 API가 생겨도 이 확인이 따라간다).
- 승인하면 **다시 로그인하지 않아도** 같은 쪽지로 바로 쓴다.
- 거절·차단은 이미 나간 쪽지까지 그 자리에서 끊고, 다시 로그인해도 막힌다.
- 기록은 지우지 않는다 — 차단을 풀면 그대로 돌아온다.
"""

import pytest

from app.models import User
from app.services import auth
from app.services import google_login as google
from app.services.users import LOCAL_USER_ID
from tests.factories import make_user
from tests import test_google_login as gl
from tests.test_google_login import FRIEND, OWNER, STRANGER, error_of, login_as
from tests.test_isolation import ANYONE, ENDPOINTS, GUEST, _url

# 구글 로그인 테스트의 픽스처(가짜 구글)를 그대로 쓴다
google_on = gl.google_on
google_says = gl.google_says


class People:
    """한 브라우저로 여러 사람을 오간다 — 로그인해서 받은 쪽지를 들고 있다가 바꿔 낀다."""

    def __init__(self, client, says):
        self.client = client
        self.says = says
        self.tokens: dict[str, str] = {}

    def login(self, email: str, sub: str) -> str | None:
        self.client.cookies.clear()
        reason = error_of(login_as(self.client, self.says, email, sub))
        token = self.client.cookies.get(auth.COOKIE_NAME)
        if token:
            self.tokens[sub] = token
        return reason

    def be(self, sub: str):
        self.client.cookies.clear()
        self.client.cookies.set(auth.COOKIE_NAME, self.tokens[sub])
        return self.client


@pytest.fixture()
def people(api, google_says):
    client, _ = api
    folks = People(client, google_says)
    assert folks.login(OWNER, "sub-owner") is None
    return folks


def _user(Session, sub: str) -> User:
    with Session() as db:
        user = db.query(User).filter_by(google_sub=sub).one()
        db.expunge(user)
        return user


def _set_status(people, sub_or_id, status: str):
    user_id = sub_or_id if isinstance(sub_or_id, int) else None
    if user_id is None:
        rows = people.be("sub-owner").get("/api/admin/users").json()
        user_id = next(r["id"] for r in rows if r["email"] == _EMAILS[sub_or_id])
    return people.be("sub-owner").put(f"/api/admin/users/{user_id}/status", json={"status": status})


_EMAILS = {"sub-x": STRANGER, "sub-friend": FRIEND}


# ---------------------------------------------------------------------------
#  승인 대기
# ---------------------------------------------------------------------------


def test_a_stranger_is_signed_in_as_pending(api, people):
    _, Session = api
    assert people.login(STRANGER, "sub-x") is None  # 거절하지 않는다 — 신청을 받는다

    status = people.be("sub-x").get("/api/auth/status").json()
    assert status["authenticated"] is False
    assert status["user"] == {"email": STRANGER, "name": "stranger", "is_owner": False, "status": "pending"}
    assert "pending_count" not in status  # 관리자에게만
    assert _user(Session, "sub-x").status == "pending"


def test_pending_is_exactly_a_guest(api, people):
    """앱의 모든 API를 승인 대기인 사람의 쪽지로 부른다. 손님에게 열린 것만 지나간다."""
    people.login(STRANGER, "sub-x")
    client = people.be("sub-x")
    for (method, path), (_, who) in sorted(ENDPOINTS.items()):
        res = client.request(method, _url(path), follow_redirects=False)
        if who in (GUEST, ANYONE):
            assert res.status_code != 401, (method, path)
        else:
            assert res.status_code == 401, (method, path, res.status_code)


def test_the_admin_sees_the_request_first_and_approving_opens_the_same_session(api, people):
    _, Session = api
    people.login(STRANGER, "sub-x")

    admin = people.be("sub-owner")
    assert admin.get("/api/auth/status").json()["pending_count"] == 1
    rows = admin.get("/api/admin/users").json()
    assert rows[0]["email"] == STRANGER and rows[0]["status"] == "pending"
    assert {r["email"] for r in rows} == {OWNER, STRANGER}
    assert next(r for r in rows if r["email"] == OWNER)["is_owner"] is True

    res = _set_status(people, "sub-x", "active")
    assert res.status_code == 200 and res.json()["status"] == "active"
    assert people.be("sub-owner").get("/api/auth/status").json()["pending_count"] == 0

    # 다시 로그인하지 않아도 — 들고 있던 쪽지 그대로
    newcomer = people.be("sub-x")
    assert newcomer.get("/api/stocks").status_code == 200
    assert newcomer.get("/api/auth/status").json()["authenticated"] is True


def test_the_allowlist_still_lets_people_straight_in(api, people):
    """이미 쓰던 설정 — 목록에 적힌 사람은 기다리지 않는다."""
    assert people.login(FRIEND, "sub-friend") is None
    assert people.be("sub-friend").get("/api/stocks").status_code == 200


def test_adding_a_waiting_person_to_the_allowlist_approves_them_at_next_login(api, people, monkeypatch):
    _, Session = api
    people.login(STRANGER, "sub-x")
    monkeypatch.setenv(google.ALLOWED_EMAILS_ENV, f"{FRIEND},{STRANGER}")
    assert people.login(STRANGER, "sub-x") is None
    assert _user(Session, "sub-x").status == "active"


def test_waiting_room_has_a_limit(api, people, monkeypatch):
    """누구나 신청할 수 있으므로, 상한이 없으면 봇 하나가 사용자 표를 끝없이 채운다."""
    _, Session = api
    monkeypatch.setattr(google, "MAX_PENDING", 2)
    with Session() as db:
        for n in range(2):
            make_user(db, google_sub=f"sub-wait-{n}", email=f"w{n}@example.com", status="pending")
    assert people.login(STRANGER, "sub-x") == google.REASON_BUSY
    with Session() as db:
        assert db.query(User).filter_by(google_sub="sub-x").count() == 0
    # 미리 승인된 사람은 자리와 상관없다
    assert people.login(FRIEND, "sub-friend") is None


# ---------------------------------------------------------------------------
#  거절 · 차단
# ---------------------------------------------------------------------------


def test_rejecting_ends_the_session_and_the_next_login(api, people):
    _, Session = api
    people.login(STRANGER, "sub-x")
    assert _set_status(people, "sub-x", "rejected").status_code == 200

    # 들고 있던 쪽지는 더 이상 그 사람이 아니다 — 손님으로 돌아간다
    assert people.be("sub-x").get("/api/auth/status").json()["user"] is None
    assert people.login(STRANGER, "sub-x") == google.REASON_REJECTED
    with Session() as db:  # 새 신청으로 다시 올라오지 않는다
        assert db.query(User).filter_by(google_sub="sub-x").count() == 1


def test_blocking_cuts_off_at_once_and_keeps_their_things(api, people):
    _, Session = api
    people.login(FRIEND, "sub-friend")
    friend = people.be("sub-friend")
    assert friend.post("/api/stocks", json={"ticker": "VOO"}).status_code in (200, 201)

    assert _set_status(people, "sub-friend", "blocked").status_code == 200
    assert people.be("sub-friend").get("/api/stocks").status_code == 401
    assert people.login(FRIEND, "sub-friend") == google.REASON_BLOCKED

    # 풀면 다시 로그인해서 그대로 쓴다 — 예전 쪽지는 되살아나지 않는다
    old_token = people.tokens["sub-friend"]
    assert _set_status(people, "sub-friend", "active").status_code == 200
    people.client.cookies.clear()
    people.client.cookies.set(auth.COOKIE_NAME, old_token)
    assert people.client.get("/api/stocks").status_code == 401
    assert people.login(FRIEND, "sub-friend") is None
    assert [s["ticker"] for s in people.be("sub-friend").get("/api/stocks").json()] == ["VOO"]


def test_the_admin_account_cannot_be_changed(api, people):
    res = _set_status(people, LOCAL_USER_ID, "blocked")
    assert res.status_code == 403
    assert res.json()["detail"]["hint"] == "관리자 계정은 바꿀 수 없습니다."
    assert people.be("sub-owner").get("/api/stocks").status_code == 200


def test_unknown_user_and_unknown_status(api, people):
    admin = people.be("sub-owner")
    assert admin.put("/api/admin/users/999/status", json={"status": "active"}).status_code == 404
    people.login(STRANGER, "sub-x")
    rows = people.be("sub-owner").get("/api/admin/users").json()
    stranger_id = next(r["id"] for r in rows if r["email"] == STRANGER)
    # 승인 대기로 되돌리는 것은 없다
    res = people.be("sub-owner").put(f"/api/admin/users/{stranger_id}/status", json={"status": "pending"})
    assert res.status_code == 422


def test_the_list_counts_each_persons_stocks(api, people):
    people.login(FRIEND, "sub-friend")
    people.be("sub-friend").post("/api/stocks", json={"ticker": "VOO"})
    rows = {r["email"]: r for r in people.be("sub-owner").get("/api/admin/users").json()}
    assert rows[FRIEND]["stock_count"] == 1
    assert rows[FRIEND]["last_login_at"] is not None


def test_status_alone_is_enough_even_if_the_session_survived(api, people):
    """쪽지를 끊는 것과 상관없이 **상태만으로도** 막힌다 — DB에서 직접 바꾼 경우처럼.

    화면은 `user` 가 있으면 "들어와 있다"고 그린다. 거절된 사람에게 `user` 를 주면 승인
    대기 안내도, 로그인 버튼도 아닌 어중간한 화면이 뜬다.
    """
    _, Session = api
    people.login(FRIEND, "sub-friend")
    with Session() as db:
        db.query(User).filter_by(google_sub="sub-friend").one().status = "rejected"
        db.commit()
    friend = people.be("sub-friend")
    assert friend.get("/api/stocks").status_code == 401
    assert friend.get("/api/auth/status").json()["user"] is None
