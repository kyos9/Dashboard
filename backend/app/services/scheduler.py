"""일일 자동 갱신 스케줄러.

시장마다 마감 시각이 다르므로 갱신 시점도 나눈다:

- 미국(+전체): UTC 22:30. EST(UTC-5)에서는 마감 후 1.5시간, EDT(UTC-4)에서는 2.5시간
  뒤라 연중 항상 마감 이후다(한국시간 기준 다음날 새벽).
- 한국: UTC 07:30 = KST 16:30. 코스피/코스닥 마감(15:30 KST) 직후다.
- 일본: UTC 07:00 = JST 16:00. 도쿄 마감(15:00 JST) 직후다.

한국·일본 종목을 미국 일정에만 맡기면, 그 나라 거래일 낮 내내 전날 종가가 걸려 있게
된다. 일본은 한국과 같은 UTC+9지만 마감이 30분 이르다.

**cron은 놓친 실행을 되돌려주지 않는다.** 서버는 늘 켜져 있으니 상관없지만, 개인 PC는
위 시각 대부분에 꺼져 있다. 그래서 시세·백업 둘 다 **켠 직후에 한 번 더 보되, 이미
최신이면 넘어간다.** 앱을 여닫을 때마다 다시 받아오면 그것대로 못 쓴다.

여기에 더해 한국거래소 상장목록도 주기적으로 받아둔다. 내장 목록은 주요 종목
위주라 중소형주가 이름으로 검색되지 않는데, 사용자가 "거래소 목록 갱신" 버튼의
존재를 알아야만 해결되는 상태였다.
"""

import datetime as dt
import logging

from apscheduler.schedulers.background import BackgroundScheduler

from app.db import SessionLocal
from app.markets import Market
from app.services.leader import SchedulerLock
from app.services.pipeline import refresh_all_active_stocks

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None

# 여럿이 떠도 스케줄러는 하나만 돈다 (leader.py 참고)
_lock = SchedulerLock()


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


def _japan_refresh_job() -> None:
    _refresh(Market.JP, "japan")


def _startup_refresh_job() -> None:
    """켠 직후 한 번 — 꺼져 있는 동안 지나간 갱신을 따라잡는다.

    이게 없으면 시세만 낡는 게 아니다. 매수 워크플로우는 시그널 기록을 보고 판정하므로,
    받아오지 않은 날은 판정 자체가 일어나지 않는다.
    """
    from app.services import pipeline

    db = SessionLocal()
    try:
        results = pipeline.refresh_stale_markets(db)
        if results:
            logger.info("따라잡기 갱신: %s", results)
        else:
            logger.debug("시세가 이미 최신입니다")
    except Exception:
        # 네트워크가 막혀 있을 수 있다. 앱은 계속 뜬다 — 화면의 "새로고침"이 남아 있다.
        logger.warning("따라잡기 갱신에 실패했습니다", exc_info=True)
    finally:
        db.close()


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


def _soon(seconds: int) -> dt.datetime:
    """지금부터 `seconds`초 뒤 — **시간대를 붙여서** 돌려준다.

    스케줄러는 UTC로 돈다. 여기에 시간대 없는 `datetime.now()`를 주면 APScheduler가
    그 값을 UTC로 읽는다. 한국(UTC+9)에서는 "15초 뒤"가 **9시간 뒤**가 되고, 앱을
    그만큼 켜두지 않으면 영영 돌지 않는다. 켤 때 하는 일들이 전부 여기 달려 있다.
    """
    return dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=seconds)


# 자다 깬 노트북처럼 예정 시각이 잠깐 지나버린 경우까지는 그대로 실행한다.
# (그보다 오래 꺼져 있었던 경우는 위의 "켠 직후" 작업들이 맡는다.)
MISFIRE_GRACE_SECONDS = 3600


def start_scheduler() -> BackgroundScheduler | None:
    """스케줄러를 띄운다. **다른 프로세스가 이미 맡고 있으면 띄우지 않고 None.**"""
    global _scheduler
    if _scheduler is not None:
        return _scheduler
    if not _lock.acquire():
        logger.info("다른 프로세스가 스케줄러를 맡고 있어 여기서는 띄우지 않습니다")
        return None
    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(
        _daily_refresh_job, "cron", hour=22, minute=30, id="daily_refresh",
        misfire_grace_time=MISFIRE_GRACE_SECONDS,
    )
    scheduler.add_job(
        _korea_refresh_job, "cron", hour=7, minute=30, id="korea_refresh",
        misfire_grace_time=MISFIRE_GRACE_SECONDS,
    )
    scheduler.add_job(
        _japan_refresh_job, "cron", hour=7, minute=0, id="japan_refresh",
        misfire_grace_time=MISFIRE_GRACE_SECONDS,
    )
    # 켜고 나서 잠깐 뒤에 한 번 — 시작을 붙잡지 않으면서 첫 실행에 목록을 채운다
    scheduler.add_job(
        _listing_refresh_job, "date", run_date=_soon(15), id="listing_refresh_startup",
    )
    # 꺼져 있는 동안 지나간 갱신 따라잡기. 목록 갱신 뒤에 둔다 — 둘 다 네트워크를 쓴다.
    scheduler.add_job(
        _startup_refresh_job, "date", run_date=_soon(30), id="refresh_startup",
    )
    # 이후에는 주 1회 (일요일 UTC 20:00 = 월요일 KST 05:00, 개장 전)
    scheduler.add_job(
        _listing_refresh_job, "cron", day_of_week="sun", hour=20, minute=0, id="listing_refresh"
    )
    # 백업: 미국 갱신(22:30)이 끝난 뒤. 그날 받은 시세까지 들어간다.
    scheduler.add_job(
        _backup_job, "cron", hour=23, minute=30, id="backup",
        misfire_grace_time=MISFIRE_GRACE_SECONDS,
    )
    # 켠 직후 한 번 — 다만 최근 백업이 있으면 건너뛴다. 시작을 붙잡지 않도록 뒤로 미룬다.
    scheduler.add_job(
        _startup_backup_job, "date", run_date=_soon(60), id="backup_startup",
    )
    scheduler.start()
    _scheduler = scheduler
    return scheduler


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
    _lock.release()
