"""로그인 · 로그아웃 · 잠금 상태, 그리고 나머지 API를 막아서는 문지기.

문지기(`guard`)가 `/api/` 전부를 지키고, 아래 셋과 `/api/health`만 통과시킨다.
화면 파일(HTML·JS)은 막지 않는다 — 막아도 얻는 게 없고(그 안에 데이터가 없다),
막으면 로그인 화면 자체를 띄울 수 없다.
"""

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.services import auth

router = APIRouter(prefix="/api/auth", tags=["auth"])

# 문지기가 통과시키는 주소. 로그인 화면이 쓰는 것과, 살아있는지 보는 것뿐이다.
PUBLIC_PATHS = frozenset(
    {
        "/api/auth/status",
        "/api/auth/login",
        "/api/auth/logout",
        "/api/health",
    }
)


class LoginRequest(BaseModel):
    password: str


def is_authenticated(request: Request) -> bool:
    """잠겨 있지 않거나, 우리가 준 쪽지를 들고 있으면 참."""
    return auth.token_is_valid(request.cookies.get(auth.COOKIE_NAME))


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


@router.get("/status")
def status(request: Request) -> dict:
    """잠겨 있는지, 나는 들어와 있는지. 화면이 제일 먼저 묻는다."""
    return {"locked": auth.lock_enabled(), "authenticated": is_authenticated(request)}


@router.post("/login")
def login(payload: LoginRequest, request: Request, response: Response) -> dict:
    if not auth.lock_enabled():
        return {"locked": False, "authenticated": True}

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
    response.set_cookie(
        auth.COOKIE_NAME,
        auth.issue_token(),
        max_age=auth.SESSION_SECONDS,
        httponly=True,  # 자바스크립트가 못 읽는다 (화면이 뚫려도 쪽지는 안 샌다)
        samesite="lax",
        secure=_https(request),
        path="/",
    )
    return {"locked": True, "authenticated": True}


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(auth.COOKIE_NAME, path="/")
    return {"locked": auth.lock_enabled(), "authenticated": False}


async def guard(request: Request, call_next):
    """열쇠 없는 사람의 `/api/` 요청을 401로 돌려보낸다."""
    path = request.url.path
    if path.startswith("/api/") and path not in PUBLIC_PATHS and not is_authenticated(request):
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
