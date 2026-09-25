"""웹 푸시 — 앱을 열어두지 않아도 폰에 알림이 온다 (ROADMAP 6단계).

흐름은 표준 그대로다.

1. 화면이 브라우저에게 구독을 받는다 (`pushManager.subscribe`). 브라우저 회사의 푸시 서버
   주소(`endpoint`)와 그 기기의 공개키(`p256dh`)·비밀값(`auth`)이 나온다. 그걸 서버에 맡긴다.
2. 알릴 일이 생기면 서버가 내용을 **그 기기만 풀 수 있게 암호화해서**(RFC 8291) 그 주소로
   보낸다. 누가 보냈는지는 서버 키로 서명한 쪽지(VAPID, RFC 8292)로 밝힌다.
3. 브라우저 회사가 기기에 전달하고, 서비스 워커(`sw.js`)가 알림을 띄운다.

**구글·애플·모질라의 푸시 서버를 거치지만 내용은 못 읽는다.** 2번의 암호화가 그 뜻이다.
그들이 아는 것은 "이 주소로 뭔가 왔다"뿐이다.

**라이브러리 대신 직접 쓴 이유.** 흔히 쓰는 `pywebpush` 는 비동기 HTTP 라이브러리를 통째로
끌고 오고, 그 밑의 `http-ece` 는 요즘 빌드 도구에서 설치가 깨진다(설치 스크립트가 없어진
옵션을 쓴다). 서버 이미지를 만들다 멈추는 쪽이 더 위험했다. 대신 쓰는 것은 이미 있는
`cryptography`(구글 로그인이 쓴다)의 표준 부품뿐이고 — ECDH, HKDF 의 HMAC 단계, AES-GCM —
**RFC 8291 부록의 공식 예제를 바이트 단위로 그대로 만들어내는지** 테스트가 대조한다
(`tests/test_push.py`). 서명(ES256)도 직접 짜지 않고 `google-auth` 의 것을 쓴다.

**보낼 주소는 아무 데나 받지 않는다.** 구독 주소는 화면이 보내오는 값이라 사실상 사용자
입력이다. 거르지 않으면 서버가 그 주소로 요청을 보내 주는 셈이라, 서버 안쪽(클라우드
메타데이터 주소 같은 곳)을 두드리는 데 쓰일 수 있다. 알려진 푸시 서버만 받고, 되돌려 보내기
(redirect)도 따라가지 않는다.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import time
from pathlib import Path
from urllib.parse import urlsplit

import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from google.auth import jwt as google_jwt
from google.auth.crypt import es256

logger = logging.getLogger(__name__)

# 서버의 서명 키. 세션 키처럼 **볼륨에 둔다** (Dockerfile 이 /data 로 가리킨다). 이 키가 바뀌면
# 전에 받은 구독이 전부 무효가 된다 — 브라우저는 구독할 때 받은 공개키로 온 것만 받는다.
# 그때는 화면이 열릴 때 다시 구독한다 (`frontend/src/lib/push.ts` 의 `syncPush`).
KEY_FILE = Path(
    os.environ.get("SIGNAL_DASHBOARD_VAPID_FILE")
    or Path(__file__).resolve().parents[2] / "vapid.pem"
)

# 알려진 푸시 서버. 여기 없는 주소는 구독으로 받지 않는다 (위 설명의 셋째 문단).
PUSH_HOSTS = frozenset(
    {
        "fcm.googleapis.com",  # 크롬·엣지(안드로이드)·삼성 인터넷
        "android.googleapis.com",  # 예전 크롬
        "updates.push.services.mozilla.com",  # 파이어폭스
        "web.push.apple.com",  # 사파리 (아이폰은 홈 화면에 추가한 경우)
    }
)
PUSH_HOST_SUFFIXES = (
    ".notify.windows.com",  # 윈도우의 엣지
    ".push.apple.com",
)

# 브라우저가 주는 값의 모양. 공개키는 65바이트(비압축 점), 비밀값은 16바이트다.
_B64URL = re.compile(r"^[A-Za-z0-9_-]+={0,2}$")
MAX_ENDPOINT_LENGTH = 1024

# 알림이 기기에 닿을 때까지 푸시 서버가 들고 있을 시간. 폰이 꺼져 있다 켜져도 하루 안이면 온다.
DEFAULT_TTL = 24 * 3600
# 한 번 보내고 기다리는 시간. 푸시 서버는 받자마자 답한다 — 오래 걸리면 뭔가 잘못된 것이다.
TIMEOUT_SECONDS = 10

# 암호문 한 덩어리의 크기 (RFC 8188). 알림은 이보다 훨씬 작아 늘 한 덩어리다.
RECORD_SIZE = 4096
# 푸시 서버가 받아주는 크기는 대개 4KB 까지다. 넘기면 조용히 버려지는 대신 여기서 멈춘다.
MAX_PAYLOAD_BYTES = 3000


class PushError(Exception):
    """보낼 수 없는 구독 (모양이 틀렸거나 허용되지 않은 주소)."""


# ---------------------------------------------------------------------------
#  서버 키 (VAPID)
# ---------------------------------------------------------------------------

_cached_key: ec.EllipticCurvePrivateKey | None = None


def reset_key_cache() -> None:
    """키 파일을 바꿔 끼울 때 (테스트) 쓴다."""
    global _cached_key
    _cached_key = None


def _private_key() -> ec.EllipticCurvePrivateKey:
    global _cached_key
    if _cached_key is None:
        _cached_key = _load_or_create_key()
    return _cached_key


def _load_or_create_key() -> ec.EllipticCurvePrivateKey:
    try:
        if KEY_FILE.is_file():
            key = serialization.load_pem_private_key(KEY_FILE.read_bytes(), password=None)
            if isinstance(key, ec.EllipticCurvePrivateKey) and isinstance(key.curve, ec.SECP256R1):
                return key
            logger.warning("푸시 키 파일의 형식이 달라 새로 만듭니다: %s", KEY_FILE)
    except (OSError, ValueError):
        logger.warning("푸시 키 파일을 읽지 못했습니다: %s", KEY_FILE, exc_info=True)

    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    try:
        KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
        # 만들면서 바로 600으로 연다 (세션 키와 같은 이유 — services/auth.py)
        fd = os.open(KEY_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(pem)
        logger.info("푸시 알림용 서버 키를 새로 만들었습니다: %s", KEY_FILE)
    except OSError:
        logger.warning(
            "푸시 키를 %s 에 저장하지 못했습니다 — 서버를 다시 켜면 알림을 다시 켜야 합니다",
            KEY_FILE,
            exc_info=True,
        )
    return key


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64url(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _point(key: ec.EllipticCurvePublicKey) -> bytes:
    return key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def public_key() -> str:
    """화면이 구독할 때 넘기는 서버 공개키 (`applicationServerKey`)."""
    return _b64url(_point(_private_key().public_key()))


def vapid_subject() -> str:
    """서명 쪽지의 `sub` — 푸시 서버가 문제가 생기면 연락할 곳.

    `mailto:` 나 `https:` 여야 한다 (애플은 아니면 거절한다). 이 서버의 주소를 먼저 쓰고,
    없으면 운영자가 공개하기로 한 문의처(이메일일 때), 그것도 없으면 이 앱의 저장소 주소.
    """
    from app.services import google_login

    public_url = os.environ.get(google_login.PUBLIC_URL_ENV, "").strip().rstrip("/")
    if public_url.startswith("https://"):
        return public_url
    contact = google_login.operator_contact() or ""
    if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", contact):
        return f"mailto:{contact}"
    return "https://github.com/kyos9/Dashboard"


def vapid_authorization(endpoint: str, now: float | None = None) -> str:
    """`Authorization: vapid t=<서명 쪽지>, k=<서버 공개키>` (RFC 8292)."""
    parts = urlsplit(endpoint)
    now = time.time() if now is None else now
    claims = {
        "aud": f"{parts.scheme}://{parts.netloc}",
        # 24시간을 넘기면 안 된다. 시계가 조금 어긋나도 받히도록 12시간으로 둔다.
        "exp": int(now) + 12 * 3600,
        "sub": vapid_subject(),
    }
    pem = _private_key().private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    token = google_jwt.encode(es256.ES256Signer.from_string(pem), claims).decode("ascii")
    return f"vapid t={token}, k={public_key()}"


# ---------------------------------------------------------------------------
#  내용 암호화 (RFC 8291, aes128gcm)
# ---------------------------------------------------------------------------


def _hmac(key: bytes, data: bytes) -> bytes:
    return hmac.new(key, data, hashlib.sha256).digest()


def encrypt(
    plaintext: bytes,
    ua_public: bytes,
    auth_secret: bytes,
    *,
    salt: bytes | None = None,
    server_key: ec.EllipticCurvePrivateKey | None = None,
) -> bytes:
    """그 기기만 풀 수 있게 싼다. `salt`·`server_key` 는 테스트가 RFC 예제를 재현할 때만 준다.

    평소에는 둘 다 **매번 새로** 만든다 — 같은 값을 다시 쓰면 암호가 풀린다.
    """
    salt = os.urandom(16) if salt is None else salt
    server_key = ec.generate_private_key(ec.SECP256R1()) if server_key is None else server_key
    as_public = _point(server_key.public_key())
    peer = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public)
    shared = server_key.exchange(ec.ECDH(), peer)

    # HKDF(SHA-256)를 두 번. 출력이 32바이트 이하라 확장 단계는 HMAC 한 번이다 (RFC 5869).
    prk_key = _hmac(auth_secret, shared)
    ikm = _hmac(prk_key, b"WebPush: info\x00" + ua_public + as_public + b"\x01")
    prk = _hmac(salt, ikm)
    cek = _hmac(prk, b"Content-Encoding: aes128gcm\x00\x01")[:16]
    nonce = _hmac(prk, b"Content-Encoding: nonce\x00\x01")[:12]

    # 마지막(이자 유일한) 덩어리라는 표시 0x02 를 붙여 싼다
    ciphertext = AESGCM(cek).encrypt(nonce, plaintext + b"\x02", None)
    header = salt + RECORD_SIZE.to_bytes(4, "big") + bytes([len(as_public)]) + as_public
    return header + ciphertext


# ---------------------------------------------------------------------------
#  구독 받기
# ---------------------------------------------------------------------------


def allowed_endpoint(endpoint: str) -> bool:
    """알려진 푸시 서버의 https 주소인가."""
    if not endpoint or len(endpoint) > MAX_ENDPOINT_LENGTH:
        return False
    try:
        parts = urlsplit(endpoint)
        port = parts.port
    except ValueError:
        return False
    if parts.scheme != "https" or parts.username or parts.password:
        return False
    if port not in (None, 443):
        return False
    host = (parts.hostname or "").lower()
    return host in PUSH_HOSTS or any(host.endswith(suffix) for suffix in PUSH_HOST_SUFFIXES)


def check_subscription(endpoint: str, p256dh: str, auth: str) -> None:
    """받아도 되는 구독인가. 아니면 `PushError` (화면에 보여줄 말)."""
    if not allowed_endpoint(endpoint):
        raise PushError("이 브라우저의 알림 서버는 지원하지 않습니다.")
    try:
        if not (_B64URL.match(p256dh) and _B64URL.match(auth)):
            raise ValueError
        key = _unb64url(p256dh)
        secret = _unb64url(auth)
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), key)
    except ValueError:
        raise PushError("브라우저가 준 구독 정보가 올바르지 않습니다.") from None
    if len(secret) != 16:
        raise PushError("브라우저가 준 구독 정보가 올바르지 않습니다.")


# ---------------------------------------------------------------------------
#  보내기
# ---------------------------------------------------------------------------

# 보낸 결과. 부르는 쪽이 구독을 어떻게 할지 정한다.
SENT = "sent"
GONE = "gone"  # 구독이 끝났다 (앱 삭제·알림 끔·키 바뀜) — 지운다
FAILED = "failed"  # 이번만 안 됐다 — 남겨둔다


def send(endpoint: str, p256dh: str, auth: str, message: dict, *, ttl: int = DEFAULT_TTL) -> str:
    """한 기기에 하나 보낸다. 결과는 `SENT`/`GONE`/`FAILED`. 예외를 위로 던지지 않는다."""
    if not allowed_endpoint(endpoint):
        # 받을 때 걸렀지만, 허용 목록이 줄어든 뒤 남아 있던 구독일 수 있다
        return GONE
    body = json.dumps(message, ensure_ascii=False).encode("utf-8")
    if len(body) > MAX_PAYLOAD_BYTES:
        logger.warning("알림 내용이 너무 깁니다 (%d바이트) — 보내지 않습니다", len(body))
        return FAILED
    try:
        payload = encrypt(body, _unb64url(p256dh), _unb64url(auth))
    except ValueError:
        return GONE
    headers = {
        "Authorization": vapid_authorization(endpoint),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": str(ttl),
        "Urgency": "normal",
    }
    try:
        res = requests.post(
            endpoint, data=payload, headers=headers, timeout=TIMEOUT_SECONDS, allow_redirects=False
        )
    except requests.RequestException as exc:
        logger.warning("푸시 서버에 닿지 못했습니다 (%s): %s", urlsplit(endpoint).hostname, exc)
        return FAILED
    if 200 <= res.status_code < 300:
        return SENT
    # 404·410: 구독이 끝났다. 403: 다른 서버 키로 받은 구독이다 (키 파일이 바뀌었다).
    if res.status_code in (403, 404, 410):
        return GONE
    logger.warning(
        "푸시 서버가 거절했습니다 (%s %s): %s",
        urlsplit(endpoint).hostname,
        res.status_code,
        (res.text or "")[:200],
    )
    return FAILED
