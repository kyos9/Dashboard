import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import init_db
from app.routers import buys, dashboard, history, rebalance, stocks
from app.services.scheduler import shutdown_scheduler, start_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
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


@app.get("/api/health")
def health():
    return {"status": "ok"}
