"""일일 자동 갱신 스케줄러.

미국 장 마감(16:00 ET) 이후 시점에 활성 종목 전체를 갱신한다. UTC 22:30으로 고정 —
EST(UTC-5)에서는 마감 후 1.5시간, EDT(UTC-4)에서는 마감 후 2.5시간 뒤라 연중 항상
마감 이후에 실행된다(한국시간 기준으로는 다음날 새벽).
"""

import logging

from apscheduler.schedulers.background import BackgroundScheduler

from app.db import SessionLocal
from app.services.pipeline import refresh_all_active_stocks

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


def _daily_refresh_job() -> None:
    db = SessionLocal()
    try:
        results = refresh_all_active_stocks(db)
        logger.info("daily refresh completed: %s", results)
    finally:
        db.close()


def start_scheduler() -> BackgroundScheduler:
    global _scheduler
    if _scheduler is not None:
        return _scheduler
    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(_daily_refresh_job, "cron", hour=22, minute=30, id="daily_refresh")
    scheduler.start()
    _scheduler = scheduler
    return scheduler


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
