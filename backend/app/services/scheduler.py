"""일일 자동 갱신 스케줄러.

시장마다 마감 시각이 다르므로 갱신 시점도 나눈다:

- 미국(+전체): UTC 22:30. EST(UTC-5)에서는 마감 후 1.5시간, EDT(UTC-4)에서는 2.5시간
  뒤라 연중 항상 마감 이후다(한국시간 기준 다음날 새벽).
- 한국: UTC 07:30 = KST 16:30. 코스피/코스닥 마감(15:30 KST) 직후다.

한국 종목을 미국 일정에만 맡기면, 한국 거래일 낮 내내 전날 종가가 걸려 있게 된다.

백업도 여기서 돈다. 서버는 늘 켜져 있으니 정해진 시각에 돌면 되지만, 개인 PC는
**켜져 있을 때만** 스케줄러가 산다. 그래서 켠 직후에도 한 번 보되, 최근 것이 있으면
넘어간다 (안 그러면 앱을 여닫을 때마다 쌓여 보관분이 반나절치가 된다).

여기에 더해 한국거래소 상장목록도 주기적으로 받아둔다. 내장 목록은 주요 종목
위주라 중소형주가 이름으로 검색되지 않는데, 사용자가 "거래소 목록 갱신" 버튼의
존재를 알아야만 해결되는 상태였다.
"""

import datetime as dt
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


def _backup_job() -> None:
    from app.services.backup import run_backup

    run_backup()


def _startup_backup_job() -> None:
    from app.services.backup import run_backup_if_stale

    run_backup_if_stale()


def _listing_refresh_job() -> None:
    """상장목록 캐시 채우기. 실패해도 앱은 내장 목록으로 계속 검색된다."""
    from app.services import symbols

    db = SessionLocal()
    try:
        count = symbols.refresh_krx_listing_if_stale(db)
        if count is None:
            logger.debug("상장목록 캐시가 아직 최신입니다")
        else:
            logger.info("상장목록 %s종목을 받았습니다", count)
    except Exception as exc:
        # 네트워크가 막혀 있어도 정상 동작이다. 로그를 시끄럽게 만들지 않는다.
        logger.info("상장목록을 받지 못했습니다 (내장 목록으로 검색됩니다): %s", exc)
    finally:
        db.close()


def start_scheduler() -> BackgroundScheduler:
    global _scheduler
    if _scheduler is not None:
        return _scheduler
    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(_daily_refresh_job, "cron", hour=22, minute=30, id="daily_refresh")
    scheduler.add_job(_korea_refresh_job, "cron", hour=7, minute=30, id="korea_refresh")
    # 켜고 나서 잠깐 뒤에 한 번 — 시작을 붙잡지 않으면서 첫 실행에 목록을 채운다
    scheduler.add_job(
        _listing_refresh_job,
        "date",
        run_date=dt.datetime.now() + dt.timedelta(seconds=15),
        id="listing_refresh_startup",
    )
    # 이후에는 주 1회 (일요일 UTC 20:00 = 월요일 KST 05:00, 개장 전)
    scheduler.add_job(
        _listing_refresh_job, "cron", day_of_week="sun", hour=20, minute=0, id="listing_refresh"
    )
    # 백업: 미국 갱신(22:30)이 끝난 뒤. 그날 받은 시세까지 들어간다.
    scheduler.add_job(_backup_job, "cron", hour=23, minute=30, id="backup")
    # 켠 직후 한 번 — 다만 최근 백업이 있으면 건너뛴다. 시작을 붙잡지 않도록 뒤로 미룬다.
    scheduler.add_job(
        _startup_backup_job,
        "date",
        run_date=dt.datetime.now() + dt.timedelta(seconds=60),
        id="backup_startup",
    )
    scheduler.start()
    _scheduler = scheduler
    return scheduler


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
