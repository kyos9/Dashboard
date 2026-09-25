"""테스트가 쓰는 행을 한 곳에서 만든다.

**왜 모으나.** 4단계에서 종목·보유·매수기록·설정에 *사용자*가 붙는다. 그때
`Stock(ticker=...)` 가 테스트 파일 여덟 군데에 흩어져 있으면 서른 몇 군데를 한꺼번에
고쳐야 하고, 그 커밋은 아무도 읽을 수 없다 — 진짜 바뀐 것(사용자 분리)이 기계적인
치환에 묻힌다. 여기 한 파일만 바꾸면 되게 해둔다.

**규칙: 이 파일은 지금 동작을 그대로 만든다.** 기본값을 바꾸고 싶어지면 그건 다른
커밋이다. 여기가 조용히 테스트의 의미를 바꾸는 자리가 되면, 테스트가 무엇을 지키고
있는지 아무도 모르게 된다.

시세(`PriceDaily`)·지표·시그널은 여기 없다. 그건 **모든 사용자가 같이 쓰는** 데이터라
사용자가 붙지 않는다 — 4단계에서 바뀌지 않는 것을 미리 감쌀 이유가 없다.

**4-1에서 실제로 바뀐 곳이 여기다.** 종목은 공용 행(`Instrument`)과 내 행(`UserStock`)
두 줄이 됐고, 보유·매수·설정에는 `user_id`가 붙었다. 사용자를 안 주면 1번 사용자다 —
앱이 로그인 전까지 모든 요청을 1번으로 받는 것과 같다.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy.orm import Session

from app.markets import normalize_ticker
from app.models import (
    Holding,
    Instrument,
    PushState,
    PushSubscription,
    User,
    UserSettings,
    UserStock,
)
from app.services import push
from app.services.users import LOCAL_USER_ID


def _ensure_user(db: Session, user_id: int) -> None:
    """그 사용자 행이 없으면 넣는다.

    앱에서는 마이그레이션이 1번을 만들어두지만, 테스트는 `create_all`로 표만 만든다.
    종목·보유·설정이 전부 사용자를 가리키므로 여기서 채워준다.
    """
    if db.get(User, user_id) is None:
        db.add(User(id=user_id, is_owner=user_id == LOCAL_USER_ID))
        db.flush()


def make_user(db: Session, *, commit: bool = True, **fields) -> User:
    """사용자 한 명. `id`를 안 주면 DB가 번호를 매긴다 (번호표가 제자리인지 볼 때 쓴다)."""
    user = User(**fields)
    db.add(user)
    if commit:
        db.commit()
    return user


def make_stock(
    db: Session,
    ticker: str = "TST",
    *,
    user_id: int = LOCAL_USER_ID,
    commit: bool = True,
    **fields,
) -> UserStock:
    """종목 하나를 만들어 DB에 넣는다 — 공용 행(`Instrument`)과 내 행(`UserStock`) 둘 다.

    나머지 칸(`target_weight_pct`, `rebalance_band_pct`, `added_at` …)은 부르는 쪽이 필요한
    것만 넘긴다. 여기서 기본값을 따로 정하지 않는 이유는 모델의 기본값과 다른 값을
    숨겨두면, 테스트가 왜 그렇게 도는지 이 파일을 열어봐야만 알 수 있기 때문이다.

    `name`은 두 행에 같이 넣는다. 마이그레이션이 옛 `stocks.name`을 옮기는 방식과 같다.
    """
    _ensure_user(db, user_id)
    ticker = normalize_ticker(ticker)
    instrument = db.get(Instrument, ticker)
    if instrument is None:
        instrument = Instrument(ticker=ticker, name=fields.get("name"))
        db.add(instrument)
    stock = UserStock(user_id=user_id, ticker=ticker, instrument=instrument, **fields)
    db.add(stock)
    if commit:
        db.commit()
    return stock


def make_holding(
    db: Session,
    ticker: str,
    quantity: float,
    *,
    avg_cost: float | None = None,
    user_id: int = LOCAL_USER_ID,
    commit: bool = True,
) -> Holding:
    """보유수량 한 줄. 평단가는 안 주면 모름(None)."""
    holding = Holding(user_id=user_id, ticker=ticker, quantity=quantity, avg_cost=avg_cost)
    db.add(holding)
    if commit:
        db.commit()
    return holding


def build_settings(**fields) -> UserSettings:
    """DB에 넣지 않는 설정 객체 — 순수 함수를 검증할 때 쓴다."""
    return UserSettings(**fields)


def make_settings(
    db: Session, *, user_id: int = LOCAL_USER_ID, commit: bool = True, **fields
) -> UserSettings:
    """그 사용자의 포트폴리오 설정(사람마다 한 줄)을 DB에 넣는다."""
    _ensure_user(db, user_id)
    settings = UserSettings(user_id=user_id, **fields)
    db.add(settings)
    if commit:
        db.commit()
    return settings


@dataclass
class Device:
    """알림을 받는 가짜 기기 — 브라우저가 구독할 때 만드는 열쇠 한 벌.

    진짜 열쇠라서 서버가 싸서 보낸 것을 **여기서 풀어볼 수 있다** (`open`). 그래야 "보냈다"가
    아니라 "그 기기가 받아서 읽었다"를 확인할 수 있다.
    """

    endpoint: str
    key: ec.EllipticCurvePrivateKey
    secret: bytes

    @property
    def p256dh(self) -> str:
        return push._b64url(push._point(self.key.public_key()))

    @property
    def auth(self) -> str:
        return push._b64url(self.secret)

    def as_json(self) -> dict:
        """브라우저의 `PushSubscription.toJSON()` 모양."""
        return {"endpoint": self.endpoint, "keys": {"p256dh": self.p256dh, "auth": self.auth}}

    def open(self, body: bytes) -> dict:
        """서버가 보낸 암호문을 이 기기의 열쇠로 푼다 (RFC 8291 의 받는 쪽)."""
        salt, record_size, id_len = body[:16], int.from_bytes(body[16:20], "big"), body[20]
        as_public = body[21 : 21 + id_len]
        assert record_size == push.RECORD_SIZE
        peer = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_public)
        shared = self.key.exchange(ec.ECDH(), peer)
        ua_public = push._point(self.key.public_key())
        prk_key = push._hmac(self.secret, shared)
        ikm = push._hmac(prk_key, b"WebPush: info\x00" + ua_public + as_public + b"\x01")
        prk = push._hmac(salt, ikm)
        cek = push._hmac(prk, b"Content-Encoding: aes128gcm\x00\x01")[:16]
        nonce = push._hmac(prk, b"Content-Encoding: nonce\x00\x01")[:12]
        plain = AESGCM(cek).decrypt(nonce, body[21 + id_len :], None)
        assert plain.endswith(b"\x02")
        return json.loads(plain[:-1].decode("utf-8"))


def new_device(name: str = "a") -> Device:
    """구글(FCM) 주소를 가진 가짜 기기. 이름이 곧 주소의 끝이라 기기마다 주소가 다르다."""
    return Device(
        endpoint=f"https://fcm.googleapis.com/fcm/send/test-{name}",
        key=ec.generate_private_key(ec.SECP256R1()),
        secret=os.urandom(16),
    )


def make_push_subscription(
    db: Session, device: Device, *, user_id: int = LOCAL_USER_ID, commit: bool = True, **fields
) -> PushSubscription:
    """그 사람의 알림 받는 기기 하나."""
    _ensure_user(db, user_id)
    row = PushSubscription(
        user_id=user_id, endpoint=device.endpoint, p256dh=device.p256dh, auth=device.auth, **fields
    )
    db.add(row)
    if commit:
        db.commit()
    return row


def make_push_state(
    db: Session, subject: str, value: str, *, user_id: int = LOCAL_USER_ID, commit: bool = True
) -> PushState:
    """"이미 이것을 알렸다"는 기록 한 줄."""
    _ensure_user(db, user_id)
    row = PushState(user_id=user_id, subject=subject, value=value)
    db.add(row)
    if commit:
        db.commit()
    return row
