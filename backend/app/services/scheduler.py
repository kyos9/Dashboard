"""일일 자동 갱신 스케줄러.

시장마다 마감 시각이 다르므로 갱신 시점도 나눈다:

- 미국(+전체): UTC 22:30. EST(UTC-5)에서는 마감 후 1.5시간, EDT(UTC-4)에서는 2.5시간
  뒤라 연중 항상 마감 이후다(한국시간 기준 다음날 새벽).
- 한국: UTC 07:30 = KST 16:30. 코스피/코스닥 마감(15:30 KST) 직후다.

한국 종목을 미국 일정에만 맡기면, 한국 거래일 낮 내내 전날 종가가 걸려 있게 된다.
"""

import logging

from apscheduler.schedulers.background import BackgroundScheduler

from app.db import SessionLocal
from app.markets import Market
from app.services.pipeline import refresh_all_active_stocks

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


def _refresh(market: Market | None, label: str) -> None:
    db = SessionLocal()
    try:
        results = refresh_all_active_stocks(db, market=market)
        logger.info("%s refresh completed: %s", label, results)
    finally:
        db.close()


def _daily_refresh_job() -> None:
    _refresh(None, "daily")


def _korea_refresh_job() -> None:
    _refresh(Market.KR, "korea")


def start_scheduler() -> BackgroundScheduler:
    global _scheduler
    if _scheduler is not None:
        return _scheduler
    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(_daily_refresh_job, "cron", hour=22, minute=30, id="daily_refresh")
    scheduler.add_job(_korea_refresh_job, "cron", hour=7, minute=30, id="korea_refresh")
    scheduler.start()
    _scheduler = scheduler
    return scheduler


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
