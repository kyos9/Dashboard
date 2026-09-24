"""구글 계정으로 로그인 (ROADMAP 4단계 5·6번).

흐름은 표준 그대로다.

1. `/api/auth/google/start` — `state`·`nonce`·PKCE 비밀값을 만들어 **서명한 쿠키**에 담고
   구글로 보낸다.
2. 구글이 `/api/auth/google/callback?code&state` 로 돌려보낸다. 쿠키의 `state` 와 대조하고,
   `code` 를 토큰으로 바꾸고, **`id_token` 을 검증**하고, 그 안의 `nonce` 를 쿠키와 대조한다.
3. 누구인지 정한다 — 주인 계정 연결, 허용목록 — 그리고 세션 쪽지(v2)를 준다.

**직접 만들지 않는 부분이 있다.** `id_token` 의 서명·발급자·대상·만료 검증은 `google-auth`
의 `verify_oauth2_token` 이 한다 (구글 공개키 회전까지 따라간다). 이 자리는 직접 짜면 틀리고,
틀려도 화면에서는 멀쩡해 보인다.

각 장치가 막는 것:

- `state` — 남이 만든 로그인 링크로 **내 브라우저에 남의 구글 계정이 붙는 것** (CSRF).
- `nonce` — 가로챈 `id_token` 을 다른 로그인에 끼워 넣는 것 (재사용).
- PKCE — 가로챈 `code` 를 다른 곳에서 토큰으로 바꾸는 것.
- 승인 — 공개 주소에 구글 로그인만 걸면 **전 세계 누구나 가입된다.** 처음 들어온 사람은
  승인 대기로 시작하고, 관리자가 승인해야 쓸 수 있다 (허용목록에 적힌 사람은 바로 승인).
"""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import logging
import os
import secrets
import time
from dataclasses import dataclass
from urllib.parse import urlencode

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import User
from app.services import auth
from app.services.users import (
    LOCAL_USER_ID,
    STATUS_ACTIVE,
    STATUS_BLOCKED,
    STATUS_PENDING,
    STATUS_REJECTED,
)

logger = logging.getLogger(__name__)

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPES = "openid email profile"

CLIENT_SECRET_ENV = "GOOGLE_CLIENT_SECRET"
OWNER_EMAIL_ENV = "OWNER_GOOGLE_EMAIL"
ALLOWED_EMAILS_ENV = "ALLOWED_GOOGLE_EMAILS"
# 앞에 웹서버가 주소를 바꿔 전달하는 구성이면 여기 적는다 (예: https://내이름.duckdns.org).
# 비어 있으면 들어온 요청의 주소로 만든다 — 구글은 콘솔에 등록된 주소가 아니면 거절하므로
# 요청 주소를 꾸며도 엉뚱한 곳으로 가지는 않는다.
PUBLIC_URL_ENV = "PUBLIC_URL"

FLOW_COOKIE = "signalboard_google"
FLOW_COOKIE_PATH = "/api/auth/google"
# 구글 화면에서 계정을 고르는 데 10분이면 충분하다. 길수록 쿠키를 훔쳐 쓸 틈이 는다.
FLOW_SECONDS = 600
CALLBACK_PATH = "/api/auth/google/callback"


class LoginFailed(Exception):
    """로그인을 끝내지 못했다. `reason` 은 화면이 안내문을 고르는 데 쓴다."""

    def __init__(self, reason: str, detail: str = ""):
        super().__init__(detail or reason)
        self.reason = reason


# 화면에 보낼 이유. 자세한 원인은 로그에만 남긴다 — 주소창에 내부 사정을 띄우지 않는다.
REASON_CANCELLED = "cancelled"   # 구글 화면에서 취소
REASON_EXPIRED = "expired"       # 쿠키가 없거나 오래됐거나 state 가 안 맞음
REASON_FAILED = "failed"         # 토큰 교환·검증 실패
REASON_NOT_ALLOWED = "not_allowed"  # 확인 안 된 이메일
REASON_REJECTED = "rejected"     # 가입 신청이 거절됐다
REASON_BLOCKED = "blocked"       # 관리자가 이용을 멈췄다
REASON_BUSY = "busy"             # 승인 대기가 너무 많이 쌓였다
REASON_CONFIG = "config"         # 서버 설정이 덜 됐다

# 승인 대기로 쌓아 둘 최대 인원. 누구나 신청할 수 있으므로, 상한이 없으면 봇 하나가
# 사용자 표를 끝없이 채울 수 있다. 관리자가 처리하면 다시 자리가 난다.
MAX_PENDING = 50


# ---------------------------------------------------------------------------
#  설정
# ---------------------------------------------------------------------------


def client_id() -> str:
    return os.environ.get(auth.GOOGLE_CLIENT_ID_ENV, "").strip()


def client_secret() -> str:
    return os.environ.get(CLIENT_SECRET_ENV, "").strip()


def _emails(raw: str) -> set[str]:
    return {part.strip().lower() for part in raw.replace(";", ",").split(",") if part.strip()}


def owner_email() -> str | None:
    found = _emails(os.environ.get(OWNER_EMAIL_ENV, ""))
    return next(iter(found)) if len(found) == 1 else None


def allowed_emails() -> set[str]:
    """승인 없이 바로 들어오는 사람. **주인은 늘 들어 있다.**

    예전에는 이 목록이 문 자체였다. 이제 문은 관리자 승인이고, 이 목록은 "미리 승인해 둔
    사람"이다 — 이미 쓰던 설정을 그대로 두어도 그 사람들은 기다리지 않는다.
    """
    allowed = _emails(os.environ.get(ALLOWED_EMAILS_ENV, ""))
    owner = owner_email()
    if owner:
        allowed.add(owner)
    return allowed


def config_problem() -> str | None:
    """구글 로그인을 켜기엔 빠진 설정. 없으면 None.

    **주인 이메일을 필수로 둔다.** 비워두면 "처음 로그인한 사람이 1번(주인)"이 되는데,
    그건 공개 주소에서 누군가 먼저 들어오면 **내 데이터 전부가 그 사람 것**이 된다는 뜻이다.
    기본값이 위험한 쪽이면 안 된다.
    """
    missing = []
    if not client_secret():
        missing.append(CLIENT_SECRET_ENV)
    if owner_email() is None:
        missing.append(OWNER_EMAIL_ENV)
    if missing:
        return ".env 에 " + ", ".join(missing) + " 를 넣어주세요"
    return None


def redirect_uri(request_base: str) -> str:
    """구글이 돌려보낼 주소. 콘솔에 등록한 것과 **한 글자도 다르면** 구글이 거절한다."""
    base = os.environ.get(PUBLIC_URL_ENV, "").strip() or request_base
    return base.rstrip("/") + CALLBACK_PATH


# ---------------------------------------------------------------------------
#  1. 구글로 보내기
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Flow:
    state: str
    nonce: str
    verifier: str
    expires_at: int


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _flow_signature(body: str) -> str:
    return hmac.new(auth.signing_key(), f"google-flow.{body}".encode(), hashlib.sha256).hexdigest()


def pack_flow(flow: Flow) -> str:
    body = f"{flow.state}.{flow.nonce}.{flow.verifier}.{flow.expires_at}"
    return f"{body}.{_flow_signature(body)}"


def unpack_flow(value: str | None, now: float | None = None) -> Flow | None:
    """쿠키를 되읽는다. 서명이 틀리거나 오래됐으면 None."""
    if not value:
        return None
    parts = value.split(".")
    if len(parts) != 5:
        return None
    body = ".".join(parts[:4])
    if not hmac.compare_digest(parts[4], _flow_signature(body)):
        return None
    try:
        expires_at = int(parts[3])
    except ValueError:
        return None
    if expires_at <= (time.time() if now is None else now):
        return None
    return Flow(state=parts[0], nonce=parts[1], verifier=parts[2], expires_at=expires_at)


def begin(callback_uri: str, now: float | None = None) -> tuple[str, str]:
    """(구글 로그인 주소, 쿠키에 담을 값)."""
    flow = Flow(
        state=secrets.token_urlsafe(32),
        nonce=secrets.token_urlsafe(32),
        verifier=secrets.token_urlsafe(64),
        expires_at=int((time.time() if now is None else now) + FLOW_SECONDS),
    )
    params = {
        "client_id": client_id(),
        "redirect_uri": callback_uri,
        "response_type": "code",
        "scope": SCOPES,
        "state": flow.state,
        "nonce": flow.nonce,
        "code_challenge": _b64(hashlib.sha256(flow.verifier.encode()).digest()),
        "code_challenge_method": "S256",
        # 계정이 여럿인 폰에서 늘 고르게 한다 — 조용히 첫 계정으로 들어가면 "내 데이터가
        # 없어졌다"로 보인다 (다른 계정으로 들어간 것이다).
        "prompt": "select_account",
    }
    return f"{AUTH_URL}?{urlencode(params)}", pack_flow(flow)


# ---------------------------------------------------------------------------
#  2. 돌아온 것을 확인하기
# ---------------------------------------------------------------------------


def exchange_code(code: str, callback_uri: str, verifier: str) -> str:
    """`code` 를 토큰으로 바꾸고 `id_token` 을 돌려준다."""
    import requests

    try:
        response = requests.post(
            TOKEN_URL,
            data={
                "code": code,
                "client_id": client_id(),
                "client_secret": client_secret(),
                "redirect_uri": callback_uri,
                "grant_type": "authorization_code",
                "code_verifier": verifier,
            },
            timeout=10,
        )
    except Exception as exc:
        raise LoginFailed(REASON_FAILED, f"토큰 교환 요청 실패: {type(exc).__name__}") from exc
    if response.status_code != 200:
        # 본문의 error 코드만 남긴다. 응답 전체에는 토큰이 섞일 수 있다.
        try:
            code_name = response.json().get("error")
        except ValueError:
            code_name = None
        raise LoginFailed(REASON_FAILED, f"토큰 교환 거절 ({response.status_code} {code_name})")
    token = response.json().get("id_token")
    if not token:
        raise LoginFailed(REASON_FAILED, "토큰 응답에 id_token 이 없음")
    return token


def _transport():
    """구글 공개키를 받아오는 통로. 테스트가 가짜 키 서버로 바꿔 끼운다."""
    from google.auth.transport import requests as google_requests

    return google_requests.Request()


def verify_id_token(token: str, nonce: str) -> dict:
    """`id_token` 을 검증하고 안의 내용을 돌려준다.

    서명·발급자(accounts.google.com)·대상(우리 client_id)·만료는 `google-auth` 가 본다.
    여기서 더 보는 것은 둘 — 우리가 보낸 `nonce` 인지, 이메일이 확인된 것인지.
    """
    from google.oauth2 import id_token as google_id_token

    try:
        claims = google_id_token.verify_oauth2_token(
            token, _transport(), audience=client_id(), clock_skew_in_seconds=10
        )
    except Exception as exc:  # ValueError(서명·대상·만료) · 네트워크(공개키) 모두
        raise LoginFailed(REASON_FAILED, f"id_token 검증 실패: {exc}") from exc

    if not hmac.compare_digest(str(claims.get("nonce", "")), nonce):
        raise LoginFailed(REASON_FAILED, "nonce 불일치")
    if not claims.get("sub"):
        raise LoginFailed(REASON_FAILED, "sub 없음")
    # 확인 안 된 이메일로는 허용목록을 통과시키지 않는다 — 남의 주소를 적어 넣은 계정일 수 있다
    if claims.get("email_verified") is not True:
        raise LoginFailed(REASON_NOT_ALLOWED, "확인되지 않은 이메일")
    return claims


# ---------------------------------------------------------------------------
#  3. 누구인지 정하기
# ---------------------------------------------------------------------------


def resolve_user(db: Session, claims: dict) -> User:
    """구글 계정 → 우리 사용자. 들어올 수 없는 사람이면 `LoginFailed`.

    **식별 키는 `sub` 다, 이메일이 아니다.** 이메일은 바뀌고, 조직 계정은 회수돼 다른
    사람에게 간다 (models.User 참고). 이메일은 주인 연결과 미리 승인에만 쓴다.

    **주인 계정은 새로 만들지 않고 1번에 붙인다.** 마이그레이션이 만든 1번은 구글이 없는
    로컬 계정이라, 그냥 두면 내가 처음 로그인할 때 2번이 새로 생기고 내 종목·보유수량은
    전부 1번에 남는다. 화면은 비고, 그건 데이터가 사라진 것으로 보인다.

    처음 온 사람은 **승인 대기**로 만들고 로그인은 시켜준다 — 화면이 "신청을 받았습니다"를
    보여줄 수 있게. 쓰는 것은 승인된 뒤다 (`routers.auth.resolve_user_id` 가 막는다).
    거절·차단된 사람은 여기서 돌려보낸다.
    """
    sub = str(claims["sub"])
    email = str(claims.get("email", "")).strip().lower()
    owner = owner_email()
    pre_approved = email in allowed_emails()

    user = db.query(User).filter(User.google_sub == sub).first()
    if user is None:
        local = db.get(User, LOCAL_USER_ID)
        if owner and email == owner and local is not None and local.google_sub is None:
            user = local
            user.google_sub = sub
            user.status = STATUS_ACTIVE
            logger.info("주인 구글 계정을 1번 사용자에 연결했습니다")
        else:
            if not pre_approved and _pending_count(db) >= MAX_PENDING:
                raise LoginFailed(REASON_BUSY, "승인 대기가 가득 참")
            user = User(
                google_sub=sub,
                is_owner=False,
                status=STATUS_ACTIVE if pre_approved else STATUS_PENDING,
                created_at=dt.datetime.utcnow(),
            )
            db.add(user)
            if not pre_approved:
                logger.info("가입 신청이 들어왔습니다 (승인 대기)")
    elif user.status == STATUS_REJECTED:
        raise LoginFailed(REASON_REJECTED, "거절된 계정")
    elif user.status == STATUS_BLOCKED:
        raise LoginFailed(REASON_BLOCKED, "차단된 계정")
    elif user.status == STATUS_PENDING and pre_approved:
        # 기다리는 동안 관리자가 허용목록에 적었다 — 승인한 것과 같다
        user.status = STATUS_ACTIVE

    user.email = email or user.email
    user.name = claims.get("name") or user.name
    user.last_login_at = dt.datetime.utcnow()
    try:
        db.commit()
    except IntegrityError:
        # 같은 사람이 두 창에서 동시에 처음 로그인했다 — 먼저 넣은 쪽을 읽으면 된다
        db.rollback()
        user = db.query(User).filter(User.google_sub == sub).first()
        if user is None:
            raise
    db.refresh(user)
    return user


def _pending_count(db: Session) -> int:
    return db.query(User).filter(User.status == STATUS_PENDING).count()
