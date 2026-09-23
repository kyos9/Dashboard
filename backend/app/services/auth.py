"""문 — 비밀번호 하나, 또는 구글 계정 (ROADMAP 5단계 · 4단계 0번).

**모드는 셋이고, 어느 모드에서도 요청에는 사용자가 있다.**

| `DASHBOARD_PASSWORD` | `GOOGLE_CLIENT_ID` | 동작 |
| --- | --- | --- |
| 없음 | 없음 | 잠금 없음. 1번 사용자 (개인 PC) |
| 있음 | 없음 | 비밀번호 한 문. 들어온 사람은 전부 1번 |
| 무관 | 있음 | 구글 로그인. 계정마다 다른 사용자 — **비밀번호 문은 닫힌다** |

구글이 설정되면 비밀번호 문을 닫는 이유: 둘 다 열어두면 비밀번호를 아는 사람이 언제든
1번(주인)으로 들어온다. 계정을 나눈 의미가 그 문 하나로 없어진다.

아래는 비밀번호 문을 처음 만들 때의 설명이다.

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
GOOGLE_CLIENT_ID_ENV = "GOOGLE_CLIENT_ID"
COOKIE_NAME = "signalboard_session"

MODE_OPEN = "open"
MODE_PASSWORD = "password"
MODE_GOOGLE = "google"

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


def google_enabled() -> bool:
    return bool(os.environ.get(GOOGLE_CLIENT_ID_ENV, "").strip())


def mode() -> str:
    """지금 어느 문인가. 구글이 설정되면 비밀번호는 보지 않는다."""
    if google_enabled():
        return MODE_GOOGLE
    if configured_password() is not None:
        return MODE_PASSWORD
    return MODE_OPEN


def lock_enabled() -> bool:
    return mode() != MODE_OPEN


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
            # 인코딩을 명시한다. 안 쓰면 시스템 로케일로 읽는데, 그건 PC마다 다르다
            # (같은 이유로 앱이 안 뜬 적이 있다 — app/migrate.py 참고).
            saved = KEY_FILE.read_text(encoding="utf-8").strip()
            if len(saved) >= 32:
                return saved.encode()
    except OSError:
        logger.warning("세션 키 파일을 읽지 못했습니다: %s", KEY_FILE, exc_info=True)

    key = secrets.token_hex(32)
    try:
        KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
        # 만들면서 바로 600으로 연다. write_text 뒤에 chmod 하면 그 사이에 남이 읽을 수 있다.
        fd = os.open(KEY_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
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
    """비밀번호 문의 쪽지(v1)가 맞는지. **구글 모드에서는 늘 거짓이다** — 문이 닫혔다."""
    current = mode()
    if current == MODE_OPEN:
        return True
    if current != MODE_PASSWORD or not token:
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
#  구글 계정 쪽지 (v2)
# ---------------------------------------------------------------------------
#
#  `v2.{user_id}.{만료}.{서명}`. 서버는 세션 목록을 들고 있지 않으므로, 이미 나간 쪽지를
#  무효로 만들 방법은 **서명에 섞인 값을 바꾸는 것뿐이다.** 그래서 둘을 섞는다.
#
#  - `session_epoch` — 올리면 그 사람의 쪽지가 전부 무효 (강제 로그아웃).
#  - `google_sub` — 탈퇴하면 행이 지워지는데, SQLite는 **지워진 번호를 다음 사람에게 다시
#    줄 수 있다.** 번호와 epoch만 섞으면 탈퇴한 사람의 쪽지가 그 번호를 받은 새 사람의
#    계정을 연다. 구글 계정 식별자까지 섞으면 번호가 같아도 사람이 다르면 안 맞는다.


def _user_signature(user_id: int, expires_at: int, epoch: int, google_sub: str) -> str:
    message = f"v2.{user_id}.{expires_at}.{epoch}.{google_sub}".encode()
    return hmac.new(signing_key(), message, hashlib.sha256).hexdigest()


def issue_user_token(user_id: int, epoch: int, google_sub: str, now: float | None = None) -> str:
    expires_at = int((time.time() if now is None else now) + SESSION_SECONDS)
    return f"v2.{user_id}.{expires_at}.{_user_signature(user_id, expires_at, epoch, google_sub)}"


def user_id_in_token(token: str | None, now: float | None = None) -> int | None:
    """쪽지가 **주장하는** 사용자 번호. 만료됐거나 모양이 틀리면 None.

    서명은 여기서 보지 않는다 — 그 사람의 epoch·sub를 DB에서 읽어와야 알 수 있다
    (`user_token_matches`). 이 값만 믿고 쓰면 안 된다.
    """
    if not token:
        return None
    parts = token.split(".")
    if len(parts) != 4 or parts[0] != "v2":
        return None
    try:
        user_id, expires_at = int(parts[1]), int(parts[2])
    except ValueError:
        return None
    if expires_at <= (time.time() if now is None else now):
        return None
    return user_id


def user_token_matches(token: str, epoch: int, google_sub: str | None) -> bool:
    """쪽지의 서명이 그 사람의 지금 상태(epoch·sub)와 맞는가."""
    if not google_sub:
        return False  # 구글 계정이 안 붙은 사람에게는 v2 쪽지를 준 적이 없다
    parts = token.split(".")
    try:
        user_id, expires_at = int(parts[1]), int(parts[2])
    except (IndexError, ValueError):
        return False
    return hmac.compare_digest(
        parts[3], _user_signature(user_id, expires_at, epoch, google_sub)
    )


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
