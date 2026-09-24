"""로그인 · 로그아웃 · 잠금 상태, 그리고 나머지 API를 막아서는 문지기.

문지기(`guard`)가 `/api/` 전부를 지키고, 아래 `PUBLIC_PATHS` 만 통과시킨다 — 구글
모드에서는 공용 매크로 읽기도 손님에게 열어둔다(`guest_can_read`). 그리고
**누가 보냈는지를 정해 `request.state.user_id` 에 둔다** — 라우터는 거기서 사용자를 받는다
(`services.users.current_user_id`).

화면 파일(HTML·JS)은 막지 않는다 — 막아도 얻는 게 없고(그 안에 데이터가 없다),
막으면 로그인 화면 자체를 띄울 수 없다.
"""

import hmac
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.db import get_db
from app.models import Holding, RebalanceSnapshot, User, UserSettings, UserStock
from app.services import auth
from app.services import google_login as google
from app.services.users import LOCAL_USER_ID, STATUS_ACTIVE, STATUS_PENDING, current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# 문지기가 통과시키는 주소. 로그인 화면이 쓰는 것과, 살아있는지 보는 것뿐이다.
#
# 구글 로그인의 두 주소가 **여기 없으면 로그인 자체가 401로 막힌다** — 아직 쪽지가 없는
# 사람만 지나는 길이기 때문이다.
PUBLIC_PATHS = frozenset(
    {
        "/api/auth/status",
        "/api/auth/login",
        "/api/auth/logout",
        "/api/auth/google/start",
        "/api/auth/google/callback",
        "/api/health",
    }
)


# 로그인 전 손님이 볼 수 있는 것 (구글 모드만). **공용이고 읽기뿐인 것**만 둔다.
#
# 페이지에 먼저 들어와 둘러보고, 자기 포트폴리오를 만들 때 로그인한다. 손님에게 보여줄
# 수 있는 건 누구 것도 아닌 데이터 — 매크로 지표뿐이다. 시세·시그널은 공용이어도 "누가
# 어떤 종목을 담았나"가 드러나므로 열지 않는다.
GUEST_PREFIX = "/api/macro"


def guest_can_read(method: str, path: str) -> bool:
    """손님(로그인 전)에게 열린 요청인가.

    비밀번호 문은 해당 없다 — 그 서버는 한 사람 것이고, 문 앞에서 보여줄 것이 없다.
    """
    return (
        auth.mode() == auth.MODE_GOOGLE
        and method == "GET"
        and (path == GUEST_PREFIX or path.startswith(GUEST_PREFIX + "/"))
    )


class LoginRequest(BaseModel):
    password: str


# ---------------------------------------------------------------------------
#  누가 보냈나
# ---------------------------------------------------------------------------


def _session_user(db: Session, token: str | None) -> User | None:
    """구글 모드의 쪽지 → 사용자. 서명이 그 사람의 지금 상태와 맞아야 한다.

    **승인 여부는 여기서 보지 않는다** — 승인 대기인 사람도 "누구인지"는 안다 (화면이
    "신청을 받았습니다"를 띄운다). 들여보낼지는 `resolve_user_id` 가 정한다.
    """
    user_id = auth.user_id_in_token(token)
    if user_id is None:
        return None
    user = db.get(User, user_id)
    if user is None or not auth.user_token_matches(token, user.session_epoch, user.google_sub):
        return None
    return user


def resolve_user_id(db_factory, token: str | None) -> int | None:
    """이 요청의 사용자 번호. 들어올 수 없으면 None.

    잠금 없는 PC와 비밀번호 문은 누구든 1번이다. 구글 모드만 DB를 본다.
    """
    current = auth.mode()
    if current == auth.MODE_OPEN:
        return LOCAL_USER_ID
    if current == auth.MODE_PASSWORD:
        return LOCAL_USER_ID if auth.token_is_valid(token) else None

    generator = db_factory()
    db = next(generator)
    try:
        user = _session_user(db, token)
        # 승인 대기·거절·차단은 손님과 같다 — 쪽지가 맞아도 들여보내지 않는다
        return user.id if user is not None and user.status == STATUS_ACTIVE else None
    finally:
        generator.close()


def _db_factory(request: Request):
    """라우터와 **같은 DB** 를 여는 함수. 테스트가 `get_db` 를 바꿔 끼우면 그것을 따른다."""
    return request.app.dependency_overrides.get(get_db, get_db)


def is_authenticated(request: Request) -> bool:
    """문지기가 이미 판정해 뒀다. 문지기 밖에서 불리면 직접 판정한다."""
    if hasattr(request.state, "user_id"):
        return request.state.user_id is not None
    token = request.cookies.get(auth.COOKIE_NAME)
    return resolve_user_id(_db_factory(request), token) is not None


def client_key(request: Request) -> str:
    """무차별 대입을 셀 때 쓰는 구분자.

    앞에 웹서버를 두면 모든 요청이 그 서버 주소로 보인다. 그대로 세면 공격자 한 명이
    **주인까지 같이 잠가버리므로**, 웹서버가 붙여주는 원래 주소를 먼저 본다.
    (이 값은 꾸며낼 수 있다. 그래서 이 지연은 보조 수단이고, 진짜 방어는 긴 비밀번호다.)
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _https(request: Request) -> bool:
    """이 요청이 HTTPS로 왔는지 — 쿠키에 Secure를 붙일지 정한다.

    앞에 웹서버를 두면 앱까지는 평문 http로 들어오므로 `url.scheme`만 보면 영원히
    Secure가 안 붙는다. 웹서버가 붙여주는 표시를 먼저 본다.
    """
    return request.headers.get("x-forwarded-proto", request.url.scheme) == "https"


def _base_url(request: Request) -> str:
    """바깥에서 본 이 앱의 주소 (`https://내이름.duckdns.org`)."""
    scheme = "https" if _https(request) else "http"
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or "localhost"
    return f"{scheme}://{host}"


def _set_session(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        auth.COOKIE_NAME,
        token,
        max_age=auth.SESSION_SECONDS,
        httponly=True,  # 자바스크립트가 못 읽는다 (화면이 뚫려도 쪽지는 안 샌다)
        samesite="lax",
        secure=_https(request),
        path="/",
    )


# ---------------------------------------------------------------------------
#  상태
# ---------------------------------------------------------------------------


@router.get("/status")
def status(request: Request, db: Session = Depends(get_db)) -> dict:
    """잠겨 있는지, 어떤 문인지, 나는 누구로 들어와 있는지. 화면이 제일 먼저 묻는다."""
    authenticated = is_authenticated(request)
    body = {"locked": auth.lock_enabled(), "authenticated": authenticated, "mode": auth.mode()}
    if auth.mode() == auth.MODE_GOOGLE:
        # 승인 대기인 사람도 보여준다 — 누구로 신청했는지, 아직 기다리는 중인지 알아야 한다
        user = _session_user(db, request.cookies.get(auth.COOKIE_NAME))
        body["user"] = (
            {"email": user.email, "name": user.name, "is_owner": user.is_owner, "status": user.status}
            if user is not None and user.status in (STATUS_ACTIVE, STATUS_PENDING)
            else None
        )
        # 관리자에게는 기다리는 신청이 몇 건인지 — 헤더의 사용자 버튼에 숫자로 뜬다
        if user is not None and user.is_owner and authenticated:
            body["pending_count"] = db.query(User).filter(User.status == STATUS_PENDING).count()
        # 설정이 덜 됐으면 로그인 버튼을 누르기 **전에** 알려준다 — 누르고 나서야 안 되는
        # 것을 알면 구글 쪽 문제로 보인다.
        body["config_problem"] = google.config_problem()
        # 문의처 — 신청이 거절·차단된 사람과 방침 화면이 "누구에게 묻나"를 보여준다.
        # 적은 것만 내보낸다 (이메일이든 오픈채팅 주소든 주인이 공개하기로 한 것)
        contact = google.operator_contact()
        if contact:
            body["contact"] = contact
    return body


# ---------------------------------------------------------------------------
#  비밀번호 문
# ---------------------------------------------------------------------------


@router.post("/login")
def login(payload: LoginRequest, request: Request, response: Response) -> dict:
    current = auth.mode()
    if current == auth.MODE_OPEN:
        return {"locked": False, "authenticated": True}
    if current == auth.MODE_GOOGLE:
        # 구글을 켜면 비밀번호 문은 닫힌다. 열어두면 비밀번호를 아는 사람이 언제든
        # 1번(주인)으로 들어와, 계정을 나눈 의미가 없어진다.
        return JSONResponse(
            status_code=400,
            content={
                "detail": {
                    "hint": "구글 계정으로 로그인해 주세요.",
                    "message": "password login is closed while Google login is on",
                }
            },
        )

    client = client_key(request)
    waiting = auth.seconds_until_retry(client)
    if waiting > 0:
        return JSONResponse(
            status_code=429,
            content={
                "detail": {
                    "hint": f"비밀번호를 여러 번 틀렸습니다. {waiting}초 뒤에 다시 시도해 주세요.",
                    "message": "too many attempts",
                }
            },
        )

    if not auth.password_matches(payload.password):
        auth.record_failure(client)
        return JSONResponse(
            status_code=401,
            content={
                "detail": {"hint": "비밀번호가 맞지 않습니다.", "message": "invalid password"}
            },
        )

    auth.record_success(client)
    _set_session(response, request, auth.issue_token())
    return {"locked": True, "authenticated": True}


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(auth.COOKIE_NAME, path="/")
    return {"locked": auth.lock_enabled(), "authenticated": False}


# ---------------------------------------------------------------------------
#  구글
# ---------------------------------------------------------------------------


def _back_to_screen(reason: str | None = None) -> RedirectResponse:
    """화면으로 돌려보낸다. 실패했으면 이유 한 단어를 붙인다 (화면이 안내문을 고른다)."""
    target = "/" if reason is None else f"/?login_error={reason}"
    response = RedirectResponse(target, status_code=302)
    response.delete_cookie(google.FLOW_COOKIE, path=google.FLOW_COOKIE_PATH)
    return response


@router.get("/google/start")
def google_start(request: Request):
    if auth.mode() != auth.MODE_GOOGLE:
        raise HTTPException(status_code=404, detail="google login is off")
    problem = google.config_problem()
    if problem:
        logger.warning("구글 로그인 설정이 덜 됐습니다: %s", problem)
        return _back_to_screen(google.REASON_CONFIG)

    url, flow_cookie = google.begin(google.redirect_uri(_base_url(request)))
    response = RedirectResponse(url, status_code=302)
    response.set_cookie(
        google.FLOW_COOKIE,
        flow_cookie,
        max_age=google.FLOW_SECONDS,
        httponly=True,
        # 구글에서 돌아오는 것은 바깥 사이트에서 오는 **최상위 이동**이라 Lax 쿠키가 실린다.
        # Strict 로 두면 이 쿠키가 안 와서 로그인이 늘 "만료"로 끝난다.
        samesite="lax",
        secure=_https(request),
        path=google.FLOW_COOKIE_PATH,
    )
    return response


@router.get("/google/callback")
def google_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    if auth.mode() != auth.MODE_GOOGLE:
        raise HTTPException(status_code=404, detail="google login is off")
    if error:
        # 구글 화면에서 취소했거나 동의하지 않았다
        return _back_to_screen(google.REASON_CANCELLED)

    flow = google.unpack_flow(request.cookies.get(google.FLOW_COOKIE))
    if flow is None or not state or not code:
        return _back_to_screen(google.REASON_EXPIRED)
    # 남이 만든 로그인 링크로 들어온 것이면 여기서 끊긴다
    if not hmac.compare_digest(state, flow.state):
        logger.warning("구글 로그인: state 불일치")
        return _back_to_screen(google.REASON_EXPIRED)

    try:
        callback_uri = google.redirect_uri(_base_url(request))
        token = google.exchange_code(code, callback_uri, flow.verifier)
        claims = google.verify_id_token(token, flow.nonce)
        user = google.resolve_user(db, claims)
    except google.LoginFailed as exc:
        # 이메일은 로그에 남기지 않는다 — 누가 거절됐는지는 이유 한 줄이면 충분하다
        logger.warning("구글 로그인 실패 (%s): %s", exc.reason, exc)
        return _back_to_screen(exc.reason)

    response = _back_to_screen()
    _set_session(
        response, request, auth.issue_user_token(user.id, user.session_epoch, user.google_sub)
    )
    logger.info("구글 로그인: 사용자 %s", user.id)
    return response


# ---------------------------------------------------------------------------
#  탈퇴
# ---------------------------------------------------------------------------


@router.delete("/me", status_code=204)
def withdraw(
    response: Response,
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
):
    """내 계정과 내 기록을 지운다. 되돌릴 수 없다.

    지우는 것: 내 종목 목록·보유수량·리밸런싱 기록·설정, 그리고 계정 행. 공용 데이터(시세·
    지표·매크로)는 남는다 — 거기엔 나를 가리키는 게 없다.

    **주인은 탈퇴할 수 없다.** 주인이 사라지면 공용 데이터를 돌볼 사람이 없어진다.
    """
    if auth.mode() != auth.MODE_GOOGLE:
        raise HTTPException(
            status_code=400,
            detail={"hint": "구글 로그인을 쓸 때만 탈퇴할 수 있습니다.", "message": "no accounts"},
        )
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="user not found")
    if user.is_owner:
        raise HTTPException(
            status_code=403,
            detail={"hint": "관리자 계정은 탈퇴할 수 없습니다.", "message": "owner cannot withdraw"},
        )

    # 보유가 내 종목 행을, 기록·설정이 계정 행을 가리키므로 그 순서로 지운다
    for model in (Holding, UserStock, RebalanceSnapshot, UserSettings):
        db.query(model).filter(model.user_id == user_id).delete(synchronize_session=False)
    db.delete(user)
    db.commit()
    response.delete_cookie(auth.COOKIE_NAME, path="/")
    logger.info("사용자 %s 탈퇴", user_id)


# ---------------------------------------------------------------------------
#  문지기
# ---------------------------------------------------------------------------


async def guard(request: Request, call_next):
    """누가 보냈는지 정하고, 열쇠 없는 사람의 `/api/` 요청은 401로 돌려보낸다.

    손님에게 열린 요청(`guest_can_read`)은 `user_id = None` 인 채로 지나간다.
    """
    path = request.url.path
    if path.startswith("/api/"):
        token = request.cookies.get(auth.COOKIE_NAME)
        # 구글 모드에서는 DB를 본다. 이벤트 루프를 붙잡지 않게 스레드로 넘긴다.
        request.state.user_id = await run_in_threadpool(
            resolve_user_id, _db_factory(request), token
        )
        if (
            request.state.user_id is None
            and path not in PUBLIC_PATHS
            and not guest_can_read(request.method, path)
        ):
            return JSONResponse(
                status_code=401,
                content={
                    "detail": {
                        "hint": "로그인이 필요합니다.",
                        "message": "authentication required",
                    }
                },
            )
    return await call_next(request)
