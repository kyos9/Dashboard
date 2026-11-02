import logging
import os
import threading
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app import version, web
from app.db import get_db, init_db
from app.logging_setup import setup_logging
from app.security_headers import BodyLimit, SecurityHeaders
from app.slow_requests import SlowRequestLog
from app.routers import (
    admin, ai, auth, dashboard, fundamentals, history, logs, macro, push, rebalance, signal_rules,
    stocks, symbols,
)
from app.services import auth as auth_service
from app.services import providers, trading_calendar
from app.services.scheduler import shutdown_scheduler, start_scheduler


logger = logging.getLogger(__name__)


def _warm_up_calendars() -> None:
    started = time.perf_counter()
    try:
        trading_calendar.warm_up()
    except Exception:
        # 미리 못 만들어도 처음 쓸 때 만들어진다 — 느릴 뿐 틀리지 않는다
        logger.warning("거래일 캘린더를 미리 만들지 못했습니다", exc_info=True)
        return
    logger.info("거래일 캘린더 준비 완료 (%.1f초)", time.perf_counter() - started)


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    init_db()
    # 뒤에서 만든다 — 기다리게 하면 그동안 서버가 아예 안 열린다
    threading.Thread(target=_warm_up_calendars, name="calendar-warm-up", daemon=True).start()
    if os.environ.get("SIGNAL_DASHBOARD_DISABLE_SCHEDULER") != "1":
        start_scheduler()
    yield
    shutdown_scheduler()


# 문서 화면(/docs·/redoc)은 끈다 — 로그인 없이 열려 공격면 전체(84KB 스키마)를 알려 줬다. 스키마는
# `/api/` 아래로 옮겨 문지기 뒤에 둔다(로그인한 사람만, 0.45.4). 개발 도구는 `app.openapi()` 를 바로 부른다.
app = FastAPI(
    title="자산관리 대시보드 API",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url="/api/openapi.json",
)

# 문지기를 CORS보다 **먼저** 등록한다. 미들웨어는 나중에 등록한 것이 바깥에 서므로,
# 이렇게 해야 CORS가 바깥이 되어 401 응답에도 CORS 헤더가 붙는다 (개발 서버에서
# "왜 401인지 모를 네트워크 오류"로 보이지 않게).
app.middleware("http")(auth.guard)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 느린 요청 기록은 바깥에 — 문지기(세션 확인)에 든 시간까지 잰다 (ROADMAP 8-5)
app.add_middleware(SlowRequestLog)

# 본문 한도와 보안 헤더(0.45.4)는 그보다 더 바깥 — 413·401 에도 헤더가 붙게. 헤더가 맨 바깥이다
app.add_middleware(BodyLimit)
app.add_middleware(SecurityHeaders)

app.include_router(auth.router)
app.include_router(stocks.router)
app.include_router(dashboard.router)
app.include_router(history.router)
app.include_router(signal_rules.router)
app.include_router(signal_rules.thresholds_router)
app.include_router(fundamentals.router)
app.include_router(rebalance.router)
app.include_router(macro.router)
app.include_router(symbols.router)
app.include_router(logs.router)
app.include_router(admin.router)
app.include_router(push.router)
app.include_router(ai.router)


def _db_answers(db: Session) -> bool:
    """DB 가 한 줄에 답하나 (0.46.0 B). Postgres 면 이 트랜잭션에만 3초 한도 — 연결된 채 매달린 DB 에서 헬스체크가
    30초마다 커넥션·스레드를 붙잡아 풀이 마르지 않게. 오류 글(접속 주소가 들 수 있다)은 로그에만."""
    try:
        if db.get_bind().dialect.name == "postgresql":
            db.execute(text("SET LOCAL statement_timeout = '3s'"))
        db.execute(text("SELECT 1"))
        return True
    except SQLAlchemyError:
        logger.warning("헬스체크: DB 가 답하지 않습니다", exc_info=True)
        return False
    finally:
        try:
            db.rollback()
        except SQLAlchemyError:
            pass


@app.get("/api/health")
def health(request: Request, db: Session = Depends(get_db)):
    """상태 + 실행 중인 버전. 화면 헤더가 이 값을 보여준다.

    이 주소만은 잠금 뒤에 두지 않는다 — 컨테이너 헬스체크(Dockerfile)와 가동 확인이
    쓰는 자리라 401을 내면 "앱이 죽었다"로 읽힌다. 대신 **잠긴 상태에서는 상태만**
    돌려주고 버전·제공자는 로그인한 뒤에 알려준다.

    **DB 도 본다** (0.46.0 B) — 전에는 DB 가 죽어도 `ok` 였다. 안 되면 503 이고 컨테이너가 unhealthy 가 된다
    (`docker compose ps` 에 보인다. 이 상태를 기다리는 서비스·자동 재시작은 없다). DB 는 `get_db` 로 연다 — 시험이 바꿔 끼운 DB 를 보게.
    """
    locked = auth_service.lock_enabled()
    if not _db_answers(db):
        return JSONResponse(status_code=503, content={"status": "error", "db": "down", "locked": locked})
    body = {"status": "ok", "db": "ok", "locked": locked}
    if not auth.is_authenticated(request):
        return body
    return {
        **body,
        **version.info(),
        # 국내/해외 제공자 순서가 다르므로 시장별로 내려준다
        "providers_by_market": providers.provider_overview(),
    }


# 화면 마운트는 반드시 API 라우터를 모두 등록한 뒤에 한다. 라우트는 등록된 순서로
# 매칭되는데, SPA 폴백은 모든 주소를 받아내므로 먼저 놓으면 API를 다 삼킨다.
web.mount_frontend(app)
