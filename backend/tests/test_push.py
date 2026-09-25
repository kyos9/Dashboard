"""푸시 알림 (ROADMAP 6단계) — 싸는 법, 보내는 곳, 무엇을 언제 알리나.

셋을 따로 본다.

1. **싸는 법** — RFC 8291 부록 A 의 공식 예제를 바이트 단위로 그대로 만들어내는가. 직접 짠
   암호화라 "대충 비슷하게 돈다"로는 안 된다. 브라우저는 한 바이트만 틀려도 조용히 버린다.
2. **보내는 곳** — 구독 주소는 화면이 보내오는 값이다. 알려진 푸시 서버가 아니면 받지 않고,
   되돌려 보내기도 따라가지 않는다 (서버가 제 안쪽을 두드리는 데 쓰이면 안 된다).
3. **무엇을 언제** — 새로 켜진 것만, 한 사람에게 하나로 묶어서. 같은 신호로 매일 울리면 사람은
   알림을 끄고, 그러면 정작 새 신호도 못 받는다.

보낸 것은 가짜 기기(`tests.factories.Device`)가 **자기 열쇠로 풀어서** 확인한다.
"""

from __future__ import annotations

import base64
import datetime as dt
import json
import os
import stat

import pytest
import requests
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

from app.models import Holding, PriceDaily, PushState, PushSubscription, SignalDaily, User, UserSettings
from app.services import alerts, push, rebalance
from app.services import google_login as google
from app.services.users import LOCAL_USER_ID, STATUS_BLOCKED, STATUS_PENDING
from tests.factories import (
    make_holding,
    make_push_state,
    make_push_subscription,
    make_settings,
    make_stock,
    make_user,
    new_device,
)

DAY = dt.date(2026, 9, 21)  # 월요일
FRIEND = 2

u = push._unb64url


# ---------------------------------------------------------------------------
#  1. 싸는 법
# ---------------------------------------------------------------------------

# RFC 8291 부록 A. 보내는 쪽 열쇠와 salt 를 고정하면 결과가 한 가지로 정해진다.
RFC_PLAINTEXT = b"When I grow up, I want to be a watermelon"
RFC_AS_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"
RFC_AS_PUBLIC = (
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"
)
RFC_UA_PRIVATE = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"
RFC_UA_PUBLIC = (
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
)
RFC_SALT = "DGv6ra1nlYgDCS1FRnbzlw"
RFC_AUTH = "BTBZMqHH6r4Tts7J_aSIgg"
RFC_MESSAGE = (
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInm"
    "YWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexS"
    "gSxsj_Qulcy4a-fN"
)


def _private(b64: str) -> ec.EllipticCurvePrivateKey:
    return ec.derive_private_key(int.from_bytes(u(b64), "big"), ec.SECP256R1())


def test_encryption_matches_the_rfc_8291_example_byte_for_byte():
    as_key = _private(RFC_AS_PRIVATE)
    assert push._b64url(push._point(as_key.public_key())) == RFC_AS_PUBLIC
    assert push._b64url(push._point(_private(RFC_UA_PRIVATE).public_key())) == RFC_UA_PUBLIC

    body = push.encrypt(
        RFC_PLAINTEXT, u(RFC_UA_PUBLIC), u(RFC_AUTH), salt=u(RFC_SALT), server_key=as_key
    )
    assert push._b64url(body) == RFC_MESSAGE


def test_every_message_is_sealed_with_fresh_randomness():
    """salt 와 보내는 쪽 열쇠를 다시 쓰면 암호가 풀린다 — 같은 내용도 매번 달라야 한다."""
    device = new_device()
    one = push.encrypt(b'"same"', u(device.p256dh), device.secret)
    two = push.encrypt(b'"same"', u(device.p256dh), device.secret)
    assert one[:16] != two[:16]  # salt
    assert one[21:86] != two[21:86]  # 보내는 쪽 공개키
    assert device.open(one) == device.open(two) == "same"


@pytest.mark.parametrize("size", [0, 1, 200, push.MAX_PAYLOAD_BYTES])
def test_the_device_can_open_what_we_send(size):
    device = new_device()
    message = {"title": "제목", "body": "가" * (size // 3)}
    body = push.encrypt(json.dumps(message).encode(), u(device.p256dh), device.secret)
    assert device.open(body) == message


def test_another_device_cannot_open_it():
    mine, theirs = new_device("mine"), new_device("theirs")
    body = push.encrypt(b'{"a": 1}', u(mine.p256dh), mine.secret)
    with pytest.raises(Exception):
        theirs.open(body)


# ---------------------------------------------------------------------------
#  서버 키 (VAPID)
# ---------------------------------------------------------------------------


def test_server_key_is_created_once_private_and_kept(tmp_path):
    first = push.public_key()
    assert len(u(first)) == 65 and u(first)[0] == 4  # 비압축 P-256 점
    assert stat.S_IMODE(os.stat(push.KEY_FILE).st_mode) == 0o600

    push.reset_key_cache()  # 서버를 다시 켠 것
    assert push.public_key() == first


def test_a_broken_key_file_is_replaced_instead_of_crashing():
    push.KEY_FILE.write_text("쓰레기", encoding="utf-8")
    push.reset_key_cache()
    assert len(u(push.public_key())) == 65


def _verify_vapid(header: str, endpoint: str) -> dict:
    """푸시 서버가 하는 검사를 그대로 한다 — 서명·대상·만료."""
    assert header.startswith("vapid t=")
    token_part, key_part = header[len("vapid "):].split(", ")
    token = token_part[len("t="):]
    key = key_part[len("k="):]
    assert key == push.public_key()

    head_b64, claims_b64, sig_b64 = token.split(".")
    head = json.loads(u(head_b64))
    assert head == {"typ": "JWT", "alg": "ES256"}
    sig = u(sig_b64)
    assert len(sig) == 64  # JWS 의 ES256 은 DER 가 아니라 r||s 다
    public = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), u(key))
    der = encode_dss_signature(int.from_bytes(sig[:32], "big"), int.from_bytes(sig[32:], "big"))
    public.verify(der, f"{head_b64}.{claims_b64}".encode(), ec.ECDSA(hashes.SHA256()))
    return json.loads(u(claims_b64))


def test_vapid_token_is_signed_by_our_key_for_that_push_server(monkeypatch):
    monkeypatch.delenv(google.PUBLIC_URL_ENV, raising=False)
    monkeypatch.delenv(google.OPERATOR_CONTACT_ENV, raising=False)
    endpoint = "https://fcm.googleapis.com/fcm/send/abc"
    claims = _verify_vapid(push.vapid_authorization(endpoint, now=1_000_000), endpoint)
    assert claims["aud"] == "https://fcm.googleapis.com"
    assert claims["exp"] == 1_000_000 + 12 * 3600  # 24시간을 넘기면 거절된다
    assert claims["sub"] == "https://github.com/kyos9/Dashboard"


def test_a_forged_vapid_token_does_not_verify():
    endpoint = "https://fcm.googleapis.com/fcm/send/abc"
    header = push.vapid_authorization(endpoint)
    head, claims, sig = header.split(", ")[0][len("vapid t="):].split(".")
    forged_claims = push._b64url(json.dumps({"aud": "https://evil.example", "exp": 1}).encode())
    forged = header.replace(f"{head}.{claims}.", f"{head}.{forged_claims}.")
    with pytest.raises(InvalidSignature):
        _verify_vapid(forged, endpoint)


@pytest.mark.parametrize(
    ("public_url", "contact", "expected"),
    [
        ("https://asset.example.org/", "me@example.org", "https://asset.example.org"),
        ("http://192.168.0.2:8000", "me@example.org", "mailto:me@example.org"),
        ("", "me@example.org", "mailto:me@example.org"),
        ("", "카톡 오픈채팅 abc", "https://github.com/kyos9/Dashboard"),
        ("", "", "https://github.com/kyos9/Dashboard"),
    ],
)
def test_vapid_subject_is_always_a_url_push_servers_accept(monkeypatch, public_url, contact, expected):
    monkeypatch.setenv(google.PUBLIC_URL_ENV, public_url)
    monkeypatch.setenv(google.OPERATOR_CONTACT_ENV, contact)
    assert push.vapid_subject() == expected


# ---------------------------------------------------------------------------
#  2. 보내는 곳
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "endpoint",
    [
        "https://fcm.googleapis.com/fcm/send/abc",
        "https://updates.push.services.mozilla.com/wpush/v2/abc",
        "https://web.push.apple.com/QGx",
        "https://wns2-bl2p.notify.windows.com/w/?token=abc",
        "https://fcm.googleapis.com:443/fcm/send/abc",
    ],
)
def test_known_push_servers_are_accepted(endpoint):
    assert push.allowed_endpoint(endpoint)


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://fcm.googleapis.com/fcm/send/abc",  # 평문
        "https://localhost/push",
        "https://127.0.0.1/push",
        "https://169.254.169.254/latest/meta-data",  # 클라우드 메타데이터
        "https://fcm.googleapis.com.evil.example/x",
        "https://evilfcm.googleapis.com/x",
        "https://evil.example/?fcm.googleapis.com",
        "https://user:pw@fcm.googleapis.com/x",
        "https://fcm.googleapis.com:8443/x",
        "https://notify.windows.com.evil.example/x",
        "https://fcm.googleapis.com/" + "a" * push.MAX_ENDPOINT_LENGTH,
        "https://fcm.googleapis.com:99999/x",  # 포트가 말이 안 된다
        "",
        "fcm.googleapis.com/x",
    ],
)
def test_anything_else_is_refused(endpoint):
    assert not push.allowed_endpoint(endpoint)


def test_a_subscription_with_broken_keys_is_refused():
    device = new_device()
    push.check_subscription(device.endpoint, device.p256dh, device.auth)
    with pytest.raises(push.PushError):
        push.check_subscription(device.endpoint, push._b64url(b"\x04" + b"\x00" * 64), device.auth)
    with pytest.raises(push.PushError):
        push.check_subscription(device.endpoint, device.p256dh, push._b64url(b"short"))
    with pytest.raises(push.PushError):
        push.check_subscription(device.endpoint, "not base64!", device.auth)
    with pytest.raises(push.PushError):
        push.check_subscription("https://evil.example/x", device.p256dh, device.auth)


class _Res:
    def __init__(self, status_code: int, text: str = ""):
        self.status_code = status_code
        self.text = text


class PushServer:
    """푸시 서버 흉내. 받은 것을 적어두고, 정해둔 답을 준다."""

    def __init__(self, monkeypatch, status: int = 201):
        self.status = status
        self.calls: list[dict] = []
        monkeypatch.setattr(requests, "post", self.post)

    def post(self, url, data=None, headers=None, timeout=None, allow_redirects=True, **kwargs):
        self.calls.append(
            {"url": url, "data": data, "headers": headers, "timeout": timeout,
             "allow_redirects": allow_redirects}
        )
        if isinstance(self.status, Exception):
            raise self.status
        return _Res(self.status, "nope")

    def opened_by(self, device) -> list[dict]:
        return [device.open(c["data"]) for c in self.calls if c["url"] == device.endpoint]


def test_send_posts_the_sealed_message_with_the_right_headers(monkeypatch):
    server = PushServer(monkeypatch)
    device = new_device()
    outcome = push.send(device.endpoint, device.p256dh, device.auth, {"title": "t", "body": "b"})
    assert outcome == push.SENT
    call = server.calls[0]
    assert call["allow_redirects"] is False  # 되돌려 보내기를 따라가지 않는다
    assert call["timeout"] == push.TIMEOUT_SECONDS
    assert call["headers"]["Content-Encoding"] == "aes128gcm"
    assert call["headers"]["TTL"] == str(push.DEFAULT_TTL)
    _verify_vapid(call["headers"]["Authorization"], device.endpoint)
    assert device.open(call["data"]) == {"title": "t", "body": "b"}


@pytest.mark.parametrize(
    ("status", "outcome"),
    [
        (201, push.SENT),
        (200, push.SENT),
        (404, push.GONE),
        (410, push.GONE),
        (403, push.GONE),  # 다른 서버 키로 받은 구독
        (413, push.FAILED),
        (429, push.FAILED),
        (500, push.FAILED),
        (301, push.FAILED),  # 되돌려 보내기 — 따라가지 않고 실패로 둔다
        (requests.ConnectionError("down"), push.FAILED),
    ],
)
def test_push_server_answers_decide_what_happens_to_the_subscription(monkeypatch, status, outcome):
    PushServer(monkeypatch, status=status)
    device = new_device()
    assert push.send(device.endpoint, device.p256dh, device.auth, {"title": "t"}) == outcome


def test_a_stored_subscription_to_an_unknown_host_is_never_contacted(monkeypatch):
    server = PushServer(monkeypatch)
    device = new_device()
    assert push.send("https://evil.example/x", device.p256dh, device.auth, {"t": 1}) == push.GONE
    assert server.calls == []


def test_a_message_too_big_for_push_servers_is_not_sent(monkeypatch):
    server = PushServer(monkeypatch)
    device = new_device()
    big = {"body": "x" * (push.MAX_PAYLOAD_BYTES + 1)}
    assert push.send(device.endpoint, device.p256dh, device.auth, big) == push.FAILED
    assert server.calls == []


# ---------------------------------------------------------------------------
#  기기마다 보내기 · 구독 받기
# ---------------------------------------------------------------------------


def test_deliver_drops_ended_subscriptions_and_keeps_the_rest(db_session, monkeypatch):
    alive, ended, flaky = new_device("alive"), new_device("ended"), new_device("flaky")
    for device in (alive, ended, flaky):
        make_push_subscription(db_session, device)

    answers = {alive.endpoint: 201, ended.endpoint: 410, flaky.endpoint: 503}
    monkeypatch.setattr(
        requests, "post", lambda url, data=None, **kw: _Res(answers[url])
    )
    assert alerts.deliver(db_session, LOCAL_USER_ID, {"title": "t"}) == {"sent": 1, "failed": 2}
    rows = {s.endpoint: s for s in db_session.query(PushSubscription)}
    assert set(rows) == {alive.endpoint, flaky.endpoint}
    assert rows[alive.endpoint].last_ok_at is not None
    assert rows[flaky.endpoint].last_ok_at is None


def test_subscribing_again_updates_keys_and_a_device_moves_to_whoever_turned_it_on(db_session):
    device = new_device()
    alerts.subscribe(db_session, LOCAL_USER_ID, device.endpoint, device.p256dh, device.auth)
    renewed = new_device()
    renewed.endpoint = device.endpoint
    alerts.subscribe(db_session, LOCAL_USER_ID, renewed.endpoint, renewed.p256dh, renewed.auth)
    rows = db_session.query(PushSubscription).all()
    assert [(r.user_id, r.p256dh) for r in rows] == [(LOCAL_USER_ID, renewed.p256dh)]

    # 같은 폰에서 다른 계정으로 다시 켰다 — 이제 그 사람 것이다
    make_user(db_session, id=FRIEND)
    alerts.subscribe(db_session, FRIEND, renewed.endpoint, renewed.p256dh, renewed.auth)
    assert [r.user_id for r in db_session.query(PushSubscription)] == [FRIEND]


def test_too_many_devices_drops_the_oldest(db_session):
    devices = [new_device(str(i)) for i in range(alerts.MAX_DEVICES + 2)]
    base = dt.datetime(2026, 9, 1)
    for i, device in enumerate(devices):
        make_push_subscription(db_session, device, created_at=base + dt.timedelta(days=i))
    newest = new_device("newest")
    alerts.subscribe(db_session, LOCAL_USER_ID, newest.endpoint, newest.p256dh, newest.auth)
    kept = {s.endpoint for s in db_session.query(PushSubscription)}
    assert len(kept) == alerts.MAX_DEVICES
    assert newest.endpoint in kept
    assert devices[0].endpoint not in kept and devices[2].endpoint not in kept
    assert devices[-1].endpoint in kept


def test_unsubscribe_only_removes_my_own_device(db_session):
    make_user(db_session, id=FRIEND)
    mine, theirs = new_device("mine"), new_device("theirs")
    make_push_subscription(db_session, mine)
    make_push_subscription(db_session, theirs, user_id=FRIEND)
    assert alerts.unsubscribe(db_session, LOCAL_USER_ID, theirs.endpoint) is False
    assert alerts.unsubscribe(db_session, LOCAL_USER_ID, mine.endpoint) is True
    assert [s.endpoint for s in db_session.query(PushSubscription)] == [theirs.endpoint]


# ---------------------------------------------------------------------------
#  API
# ---------------------------------------------------------------------------


def test_api_turns_a_device_on_tests_it_and_turns_it_off(api, monkeypatch):
    client, Session = api
    server = PushServer(monkeypatch)
    device = new_device()

    key = client.get("/api/push/key").json()["public_key"]
    assert key == push.public_key()

    assert client.post("/api/push/test").status_code == 409  # 켜진 기기가 없다
    assert client.post("/api/push/subscriptions", json=device.as_json()).status_code == 200
    assert client.get("/api/push/settings").json()["devices"] == 1

    res = client.post("/api/push/test")
    assert res.json() == {"sent": 1, "failed": 0}
    assert server.opened_by(device)[0]["title"] == "신호판"

    res = client.request("DELETE", "/api/push/subscriptions", json={"endpoint": device.endpoint})
    assert res.status_code == 204
    assert client.get("/api/push/settings").json()["devices"] == 0


def test_api_refuses_an_endpoint_that_is_not_a_push_server(api):
    client, Session = api
    device = new_device()
    body = device.as_json()
    body["endpoint"] = "https://169.254.169.254/latest/meta-data"
    res = client.post("/api/push/subscriptions", json=body)
    assert res.status_code == 400
    assert res.json()["detail"]["hint"] == "이 브라우저의 알림 서버는 지원하지 않습니다."
    with Session() as db:
        assert db.query(PushSubscription).count() == 0


def test_test_push_is_rate_limited(api, monkeypatch):
    client, Session = api
    PushServer(monkeypatch)
    with Session() as db:
        make_push_subscription(db, new_device())
    for _ in range(3):
        assert client.post("/api/push/test").status_code == 200
    res = client.post("/api/push/test")
    assert res.status_code == 429
    assert "잠시 뒤" in res.json()["detail"]["hint"]


def test_kinds_are_saved_in_a_fixed_order_and_owner_can_pick_signup(api):
    client, Session = api
    got = client.get("/api/push/settings").json()
    assert got["available"] == ["buy", "band", "review", "signup"]  # 1번은 관리자
    assert got["kinds"] == got["available"]  # 고른 적이 없으면 전부
    res = client.put("/api/push/settings", json={"kinds": ["signup", "buy", "buy"]})
    assert res.json()["kinds"] == ["buy", "signup"]
    with Session() as db:
        assert db.get(UserSettings, LOCAL_USER_ID).push_kinds == ["buy", "signup"]  # 겹침 없이, 정한 순서로
    assert client.put("/api/push/settings", json={"kinds": []}).json()["kinds"] == []
    assert client.put("/api/push/settings", json={"kinds": ["spam"]}).status_code == 400


# ---------------------------------------------------------------------------
#  3. 무엇을 언제 — 매일 알림
# ---------------------------------------------------------------------------


@pytest.fixture()
def today(monkeypatch):
    """"오늘"을 고정한다 — 시그널 신선도와 리뷰 도래가 날짜에 달려 있다."""
    monkeypatch.setattr(alerts, "market_today", lambda market: DAY)
    monkeypatch.setattr(rebalance, "market_today", lambda market: DAY)
    return DAY


def _price(db, ticker: str, day: dt.date, close: float = 100.0) -> None:
    db.add(PriceDaily(ticker=ticker, date=day, open=close, high=close, low=close, close=close, volume=1))


def _signal(db, ticker: str, day: dt.date, buy: bool) -> None:
    db.add(SignalDaily(ticker=ticker, date=day, knee_buy_v2=buy, shoulder_sell_ref=False))
    db.commit()


@pytest.fixture()
def me(db_session, today, monkeypatch):
    """알림을 켜 둔 나. VOO·QQQ 를 반씩 목표로, 보유는 비중이 맞게 넣어둔다."""
    db = db_session
    make_settings(db, base_currency="USD", default_rebalance_band_pct=5.0)
    make_stock(db, "VOO", target_weight_pct=50.0)
    make_stock(db, "QQQ", target_weight_pct=50.0, sort_order=1)
    make_stock(db, "005930.KS", name="삼성전자", target_weight_pct=0.0, sort_order=2)
    for ticker in ("VOO", "QQQ"):
        _price(db, ticker, DAY)
    db.commit()
    make_holding(db, "VOO", 10.0)
    make_holding(db, "QQQ", 10.0)
    device = new_device("me")
    make_push_subscription(db, device)
    server = PushServer(monkeypatch)
    return device, server


def _run(db, server, device) -> list[dict]:
    before = len(server.calls)
    alerts.run_daily(db)
    return [device.open(c["data"]) for c in server.calls[before:] if c["url"] == device.endpoint]


def test_a_fresh_buy_signal_is_told_once(db_session, me):
    device, server = me
    _signal(db_session, "VOO", DAY, buy=True)

    got = _run(db_session, server, device)
    assert got == [{"title": "매수 시그널", "body": "VOO", "url": "/", "tag": "daily"}]
    assert _run(db_session, server, device) == []  # 같은 시그널은 다시 안 울린다

    # 다음 거래일에도 켜져 있으면 — 새 시그널이다
    _signal(db_session, "VOO", DAY + dt.timedelta(days=1), buy=True)
    assert [m["body"] for m in _run(db_session, server, device)] == ["VOO"]


def test_signals_from_several_stocks_come_as_one_notification(db_session, me):
    device, server = me
    _signal(db_session, "VOO", DAY, buy=True)
    _signal(db_session, "QQQ", DAY, buy=True)
    _signal(db_session, "005930.KS", DAY, buy=True)
    got = _run(db_session, server, device)
    assert len(got) == 1
    # 미국은 티커, 한국은 종목명 — 화면과 같은 규칙
    assert got[0]["body"] == "VOO, QQQ, 삼성전자"


def test_an_old_signal_is_not_news(db_session, me):
    """시세가 며칠 밀렸다 따라잡은 날, 지난주 시그널이 "오늘 떴다"로 울리면 안 된다."""
    device, server = me
    _signal(db_session, "VOO", DAY - dt.timedelta(days=alerts.SIGNAL_FRESH_DAYS + 1), buy=True)
    assert _run(db_session, server, device) == []
    _signal(db_session, "QQQ", DAY - dt.timedelta(days=alerts.SIGNAL_FRESH_DAYS), buy=True)
    assert [m["body"] for m in _run(db_session, server, device)] == ["QQQ"]


def test_a_signal_that_went_off_is_not_told(db_session, me):
    device, server = me
    _signal(db_session, "VOO", DAY - dt.timedelta(days=1), buy=True)
    _signal(db_session, "VOO", DAY, buy=False)  # 오늘은 꺼졌다
    assert _run(db_session, server, device) == []


def test_band_is_told_when_it_starts_not_every_day(db_session, me):
    device, server = me
    assert _run(db_session, server, device) == []  # 50:50 — 밴드 안

    db_session.get(Holding, (LOCAL_USER_ID, "VOO")).quantity = 30.0
    db_session.commit()  # VOO 75% · QQQ 25%
    got = _run(db_session, server, device)
    assert got == [{
        "title": "신호판 알림",
        "body": "비중 과중(매도 검토): VOO\n비중 미달(매수 검토): QQQ",
        "url": "/rebalance",
        "tag": "daily",
    }]
    assert _run(db_session, server, device) == []  # 여전히 과중 — 다시 안 울린다

    db_session.get(Holding, (LOCAL_USER_ID, "VOO")).quantity = 10.0
    db_session.commit()
    assert _run(db_session, server, device) == []  # 풀렸다 — 알릴 일 아님
    db_session.get(Holding, (LOCAL_USER_ID, "VOO")).quantity = 30.0
    db_session.commit()
    assert len(_run(db_session, server, device)) == 1  # 다시 벗어났다 — 새 소식


def test_no_holdings_is_not_a_band_signal(db_session, today, monkeypatch):
    """보유수량을 안 넣은 사람은 전 종목이 0% 로 계산된다 — 그건 "미달"이 아니다."""
    make_settings(db_session, base_currency="USD")
    make_stock(db_session, "VOO", target_weight_pct=100.0)
    _price(db_session, "VOO", DAY)
    db_session.commit()
    device = new_device()
    make_push_subscription(db_session, device)
    server = PushServer(monkeypatch)
    assert _run(db_session, server, device) == []


def test_review_is_told_once_when_it_comes(db_session, me):
    device, server = me
    settings = db_session.get(UserSettings, LOCAL_USER_ID)
    settings.review_date_override = DAY
    db_session.commit()
    got = _run(db_session, server, device)
    assert got == [{
        "title": "포트폴리오 리뷰", "body": "리뷰할 때입니다 (9/21 마감)", "url": "/rebalance", "tag": "daily",
    }]
    assert _run(db_session, server, device) == []


def test_kinds_i_turned_off_are_not_sent_but_are_remembered(db_session, me):
    """꺼 둔 종류도 상태는 적는다 — 나중에 켰을 때 지난 일이 한꺼번에 쏟아지지 않게."""
    device, server = me
    db_session.get(UserSettings, LOCAL_USER_ID).push_kinds = ["review"]
    db_session.commit()
    _signal(db_session, "VOO", DAY, buy=True)
    assert _run(db_session, server, device) == []
    assert db_session.get(PushState, (LOCAL_USER_ID, "buy:VOO")).value == DAY.isoformat()

    db_session.get(UserSettings, LOCAL_USER_ID).push_kinds = None
    db_session.commit()
    assert _run(db_session, server, device) == []


def test_people_without_a_device_are_not_even_looked_at(db_session, today, monkeypatch):
    make_stock(db_session, "VOO", target_weight_pct=100.0)
    _signal(db_session, "VOO", DAY, buy=True)
    server = PushServer(monkeypatch)
    assert alerts.run_daily(db_session) == {"users": 0, "notified": 0}
    assert db_session.query(PushState).count() == 0
    assert server.calls == []


@pytest.mark.parametrize("status", [STATUS_PENDING, STATUS_BLOCKED])
def test_people_who_cannot_use_the_app_get_nothing(db_session, today, monkeypatch, status):
    make_user(db_session, id=FRIEND, status=status)
    make_stock(db_session, "VOO", user_id=FRIEND, target_weight_pct=100.0)
    _signal(db_session, "VOO", DAY, buy=True)
    make_push_subscription(db_session, new_device("friend"), user_id=FRIEND)
    server = PushServer(monkeypatch)
    alerts.run_daily(db_session)
    assert server.calls == []


def test_state_of_a_stock_i_removed_is_cleared(db_session, me):
    device, server = me
    make_push_state(db_session, "buy:NVDA", "2026-09-01")
    _run(db_session, server, device)
    assert db_session.get(PushState, (LOCAL_USER_ID, "buy:NVDA")) is None


def test_one_person_failing_does_not_stop_the_next(db_session, today, monkeypatch):
    make_user(db_session, id=FRIEND)
    for user_id in (LOCAL_USER_ID, FRIEND):
        make_stock(db_session, "VOO", user_id=user_id, target_weight_pct=0.0)
    _signal(db_session, "VOO", DAY, buy=True)
    first, second = new_device("first"), new_device("second")
    make_push_subscription(db_session, first)
    make_push_subscription(db_session, second, user_id=FRIEND)
    server = PushServer(monkeypatch)

    real = alerts.current_values

    def flaky(db, user_id):
        if user_id == LOCAL_USER_ID:
            raise RuntimeError("계산 중 넘어짐")
        return real(db, user_id)

    monkeypatch.setattr(alerts, "current_values", flaky)
    assert alerts.run_daily(db_session) == {"users": 2, "notified": 1}
    assert [m["body"] for m in server.opened_by(second)] == ["VOO"]


# ---------------------------------------------------------------------------
#  가입 신청 → 관리자
# ---------------------------------------------------------------------------


def test_owner_hears_about_a_signup_with_the_name_not_the_email(db_session, monkeypatch):
    owner_phone = new_device("owner")
    make_push_subscription(db_session, owner_phone)
    make_user(db_session, id=FRIEND)
    friend_phone = new_device("friend")
    make_push_subscription(db_session, friend_phone, user_id=FRIEND)
    server = PushServer(monkeypatch)

    alerts.notify_signup(db_session, "김친구")
    got = server.opened_by(owner_phone)
    assert got == [{
        "title": "가입 신청",
        "body": "김친구 님이 가입을 신청했습니다. 사용자 목록에서 승인할 수 있습니다.",
        "url": "/",
        "tag": "signup",
    }]
    assert server.opened_by(friend_phone) == []  # 사용자에게는 안 간다


def test_owner_who_turned_signup_off_hears_nothing(db_session, monkeypatch):
    make_settings(db_session, push_kinds=["buy"])
    make_push_subscription(db_session, new_device("owner"))
    server = PushServer(monkeypatch)
    alerts.notify_signup(db_session, "김친구")
    assert server.calls == []


def test_signup_notice_runs_in_the_background_on_its_own_session(db_session, monkeypatch):
    """로그인 요청이 푸시 서버를 기다리면 안 된다 — 뒤에서, 자기 DB 연결로."""
    owner_phone = new_device("owner")
    make_push_subscription(db_session, owner_phone)
    server = PushServer(monkeypatch)
    jobs = []
    monkeypatch.setattr(alerts, "_run_in_background", jobs.append)
    import app.db

    bind = db_session.get_bind()
    monkeypatch.setattr(app.db, "SessionLocal", lambda: type(db_session)(bind=bind))

    alerts.notify_signup_later("김친구")
    assert server.calls == []  # 아직 안 보냈다 — 뒤로 넘겼다
    jobs[0]()
    assert server.opened_by(owner_phone)[0]["title"] == "가입 신청"


def test_a_new_signup_through_google_triggers_the_notice(api, monkeypatch):
    from tests import test_google_login as gl

    names = []
    monkeypatch.setattr(alerts, "notify_signup_later", names.append)
    says = gl.GoogleSays(monkeypatch)
    for key, value in (
        (gl.auth.GOOGLE_CLIENT_ID_ENV, gl.CLIENT_ID),
        (google.CLIENT_SECRET_ENV, "s"),
        (google.OWNER_EMAIL_ENV, gl.OWNER),
        (google.ALLOWED_EMAILS_ENV, gl.FRIEND),
    ):
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(google, "_transport", lambda: gl.fake_transport)
    client, Session = api

    gl.login_as(client, says, gl.STRANGER, "sub-stranger", name="낯선 사람")
    assert names == ["낯선 사람"]
    gl.login_as(client, says, gl.STRANGER, "sub-stranger", name="낯선 사람")
    assert names == ["낯선 사람"]  # 두 번째 로그인은 새 신청이 아니다
    gl.login_as(client, says, gl.FRIEND, "sub-friend")  # 허용목록 — 신청이 아니다
    gl.login_as(client, says, gl.OWNER, "sub-owner")  # 주인 연결
    assert names == ["낯선 사람"]
    with Session() as db:
        assert db.query(User).filter_by(google_sub="sub-stranger").one().status == STATUS_PENDING


def test_two_windows_racing_on_the_first_login_notify_only_once(db_session, monkeypatch):
    """같은 사람이 두 창에서 동시에 처음 들어왔다 — 행을 먼저 넣은 창이 이미 알렸다."""
    from sqlalchemy.exc import IntegrityError

    names = []
    monkeypatch.setattr(alerts, "notify_signup_later", names.append)
    real_commit = db_session.commit
    raced = []

    def commit():
        if not raced:
            raced.append(1)
            db_session.rollback()
            # 다른 창이 한발 먼저 같은 계정을 넣었다
            make_user(db_session, google_sub="sub-race", status=STATUS_PENDING, name="낯선 사람")
            raise IntegrityError("INSERT", {}, Exception("UNIQUE google_sub"))
        return real_commit()

    monkeypatch.setattr(db_session, "commit", commit)
    user = google.resolve_user(
        db_session, {"sub": "sub-race", "email": "race@example.com", "email_verified": True, "name": "낯선 사람"}
    )
    assert user.google_sub == "sub-race"
    assert names == []


# ---------------------------------------------------------------------------
#  스케줄러
# ---------------------------------------------------------------------------


def test_scheduled_refresh_is_followed_by_alerts(monkeypatch):
    from app.services import scheduler

    order = []
    monkeypatch.setattr(scheduler, "refresh_all_active_stocks", lambda db, market=None: order.append("refresh") or [])
    monkeypatch.setattr(scheduler, "SessionLocal", lambda: _Closable())
    monkeypatch.setattr(alerts, "run_daily", lambda db: order.append("alerts"))
    scheduler._daily_refresh_job()
    scheduler._korea_refresh_job()
    assert order == ["refresh", "alerts", "refresh", "alerts"]


def test_alerts_failing_does_not_break_the_refresh_job(monkeypatch):
    from app.services import scheduler

    monkeypatch.setattr(scheduler, "refresh_all_active_stocks", lambda db, market=None: [])
    monkeypatch.setattr(scheduler, "SessionLocal", lambda: _Closable())

    def boom(db):
        raise RuntimeError("알림 서버 이상")

    monkeypatch.setattr(alerts, "run_daily", boom)
    scheduler._daily_refresh_job()  # 넘어지지 않는다


@pytest.mark.parametrize(("caught_up", "alerted"), [({}, False), ({"US": [{"ticker": "VOO"}]}, True)])
def test_startup_catch_up_alerts_only_when_something_was_fetched(monkeypatch, caught_up, alerted):
    from app.services import pipeline, scheduler

    calls = []
    monkeypatch.setattr(pipeline, "refresh_stale_markets", lambda db: caught_up)
    monkeypatch.setattr(scheduler, "SessionLocal", lambda: _Closable())
    monkeypatch.setattr(alerts, "run_daily", lambda db: calls.append(1))
    scheduler._startup_refresh_job()
    assert bool(calls) is alerted


class _Closable:
    def close(self):
        pass


def test_b64url_helpers_round_trip():
    for n in range(0, 20):
        data = os.urandom(n)
        assert u(push._b64url(data)) == data
        assert "=" not in push._b64url(data)
    assert base64.urlsafe_b64decode(push._b64url(b"ab") + "==") == b"ab"
