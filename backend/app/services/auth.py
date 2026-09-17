"""비밀번호 하나로 문을 잠근다 (ROADMAP 5단계).

공개된 주소에 그냥 올리면 **아무나 진단 화면과 로그를 본다** — 종목·에러·내부 경로가
전부 찍힌다. 그래서 서버에 올리는 순간 문이 하나 필요하다.

**이건 사용자 분리가 아니다.** 비밀번호를 아는 사람은 전부 같은 데이터를 본다. 혼자
쓰는 동안 필요한 건 "아무나 못 들어온다"이지 내 것과 남의 것을 나누는 게 아니다.
두 번째 사람이 들어오는 시점에 계정으로 바꾼다 (4단계).

동작 방식:

- `DASHBOARD_PASSWORD`가 비어 있으면 **잠그지 않는다.** 개인 PC에서 start-all.bat으로
  띄울 때마다 비밀번호를 묻는 건 방해일 뿐이고, 그 주소는 바깥에서 닿지도 않는다.
  값을 넣는 순간(서버) 잠긴다.
- 맞으면 서명된 쪽지를 쿠키에 담아준다. 서버는 그 쪽지가 **우리가 준 것인지**만
  확인할 뿐 세션 목록을 들고 있지 않는다 — 그래서 서버를 다시 켜도, 컨테이너를
  갈아끼워도 로그인이 유지된다 (서명 키는 파일로 남는다).
- 비밀번호를 바꾸면 **이미 나간 쪽지가 전부 무효**가 된다. 서명에 비밀번호 지문이
  섞여 있기 때문이다. "비밀번호를 바꿨는데 들어와 있던 사람은 그대로"는 사고다.
"""

import hashlib
import hmac
import logging
import os
import secrets
import time
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

PASSWORD_ENV = "DASHBOARD_PASSWORD"
COOKIE_NAME = "signalboard_session"

# 30일. 폰에 설치해 쓰는 도구라 며칠마다 로그인을 다시 시키면 실제로는 안 쓰게 된다.
SESSION_SECONDS = 30 * 24 * 3600

# 서명 키. 이미지 안이 아니라 **볼륨에 둔다** — 이미지에 두면 다시 올릴 때마다
# 모두 로그아웃된다 (Dockerfile에서 /data 로 가리킨다).
KEY_FILE = Path(
    os.environ.get("SIGNAL_DASHBOARD_SECRET_FILE")
    or Path(__file__).resolve().parents[2] / "session.key"
)

# 비밀번호 하나짜리 문은 무차별 대입에 약하다. 다섯 번 틀리면 5분 쉰다.
MAX_FAILURES = 5
LOCKOUT_SECONDS = 300
# 주소를 바꿔가며 두드리면 아래 표가 무한히 커진다. 적당한 선에서 지나간 것을 버린다.
MAX_TRACKED_CLIENTS = 1024


def configured_password() -> str | None:
    """이번 실행이 쓸 비밀번호. 없으면 None (= 잠그지 않음)."""
    return os.environ.get(PASSWORD_ENV, "").strip() or None


def lock_enabled() -> bool:
    return configured_password() is not None


# ---------------------------------------------------------------------------
#  서명 키
# ---------------------------------------------------------------------------

_cached_key: bytes | None = None


def reset_key_cache() -> None:
    """키 파일을 바꿔 끼울 때 (테스트) 쓴다."""
    global _cached_key
    _cached_key = None


def signing_key() -> bytes:
    global _cached_key
    if _cached_key is None:
        _cached_key = _load_or_create_key()
    return _cached_key


def _load_or_create_key() -> bytes:
    try:
        if KEY_FILE.is_file():
            saved = KEY_FILE.read_text().strip()
            if len(saved) >= 32:
                return saved.encode()
    except OSError:
        logger.warning("세션 키 파일을 읽지 못했습니다: %s", KEY_FILE, exc_info=True)

    key = secrets.token_hex(32)
    try:
        KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
        # 만들면서 바로 600으로 연다. write_text 뒤에 chmod 하면 그 사이에 남이 읽을 수 있다.
        fd = os.open(KEY_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as handle:
            handle.write(key)
    except OSError:
        logger.warning(
            "세션 키를 %s 에 저장하지 못했습니다 — 이번 실행 동안만 쓰는 키로 갑니다"
            " (서버를 다시 켜면 다시 로그인해야 합니다)",
            KEY_FILE,
            exc_info=True,
        )
    return key.encode()


# ---------------------------------------------------------------------------
#  비밀번호 확인 · 쪽지(토큰)
# ---------------------------------------------------------------------------


def _digest(value: str) -> bytes:
    return hashlib.sha256(value.encode()).digest()


def password_matches(candidate: str) -> bool:
    """입력한 비밀번호가 맞는지.

    길이가 다르면 비교가 일찍 끝나 길이가 새어나가므로, 양쪽을 해시로 만들어
    **항상 같은 길이**를 비교한다.
    """
    password = configured_password()
    if password is None:
        return True
    return hmac.compare_digest(_digest(candidate), _digest(password))


def _signature(expires_at: int, password: str) -> str:
    message = f"v1.{expires_at}.{hashlib.sha256(password.encode()).hexdigest()}".encode()
    return hmac.new(signing_key(), message, hashlib.sha256).hexdigest()


def issue_token(now: float | None = None) -> str:
    """로그인에 성공한 사람에게 줄 쪽지."""
    expires_at = int((time.time() if now is None else now) + SESSION_SECONDS)
    return f"v1.{expires_at}.{_signature(expires_at, configured_password() or '')}"


def token_is_valid(token: str | None, now: float | None = None) -> bool:
    if not lock_enabled():
        return True
    if not token:
        return False
    parts = token.split(".")
    if len(parts) != 3 or parts[0] != "v1":
        return False
    try:
        expires_at = int(parts[1])
    except ValueError:
        return False
    if expires_at <= (time.time() if now is None else now):
        return False
    return hmac.compare_digest(parts[2], _signature(expires_at, configured_password() or ""))


# ---------------------------------------------------------------------------
#  무차별 대입 지연
# ---------------------------------------------------------------------------


@dataclass
class _Attempts:
    failures: int = 0
    blocked_until: float = 0.0


_attempts: dict[str, _Attempts] = {}


def reset_throttle() -> None:
    _attempts.clear()


def seconds_until_retry(client: str, now: float | None = None) -> int:
    """지금 이 주소가 잠겨 있으면 남은 초, 아니면 0."""
    record = _attempts.get(client)
    if record is None:
        return 0
    remaining = record.blocked_until - (time.time() if now is None else now)
    return int(remaining) + 1 if remaining > 0 else 0


def record_failure(client: str, now: float | None = None) -> None:
    moment = time.time() if now is None else now
    _forget_stale(moment)
    record = _attempts.setdefault(client, _Attempts())
    record.failures += 1
    if record.failures >= MAX_FAILURES:
        record.failures = 0
        record.blocked_until = moment + LOCKOUT_SECONDS
        logger.warning("비밀번호를 %d번 틀려 %s 를 잠시 막습니다", MAX_FAILURES, client)


def record_success(client: str) -> None:
    _attempts.pop(client, None)


def _forget_stale(now: float) -> None:
    if len(_attempts) < MAX_TRACKED_CLIENTS:
        return
    for key, record in list(_attempts.items()):
        if record.blocked_until <= now:
            del _attempts[key]
