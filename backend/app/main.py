import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import version, web
from app.db import init_db
from app.logging_setup import setup_logging
from app.routers import buys, dashboard, history, logs, rebalance, stocks, symbols
from app.services import providers
from app.services.scheduler import shutdown_scheduler, start_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    init_db()
    if os.environ.get("SIGNAL_DASHBOARD_DISABLE_SCHEDULER") != "1":
        start_scheduler()
    yield
    shutdown_scheduler()


app = FastAPI(title="신호판 대시보드 API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stocks.router)
app.include_router(dashboard.router)
app.include_router(history.router)
app.include_router(rebalance.router)
app.include_router(buys.router)
app.include_router(symbols.router)
app.include_router(logs.router)


@app.get("/api/health")
def health():
    """상태 + 실행 중인 버전. 화면 헤더가 이 값을 보여준다."""
    return {
        "status": "ok",
        "version": version.version_string(),
        # 국내/해외 제공자 순서가 다르므로 시장별로 내려준다
        "providers_by_market": providers.provider_overview(),
    }


# 화면 마운트는 반드시 API 라우터를 모두 등록한 뒤에 한다. 라우트는 등록된 순서로
# 매칭되는데, SPA 폴백은 모든 주소를 받아내므로 먼저 놓으면 API를 다 삼킨다.
web.mount_frontend(app)
