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

매크로 지표는 UTC 23:00 — 미국 갱신 뒤, 백업 앞이다. **하루 한 번 도는 이 작업은
조건 없이 받는다.** 하루에 한 번이라는 것이 곧 주기이므로, 거기에 다시 "받을 때가
됐는가"를 물으면 같은 것을 두 번 세는 셈이 된다 (아래 `_macro_refresh_job` 참고).

여기에 더해 국내 상장목록(네이버, 안 되면 한국거래소)도 주기적으로 받아둔다. 내장 목록은 주요 종목
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
    _send_alerts()


def _send_alerts() -> None:
    """시세를 받은 뒤 알림 (ROADMAP 6단계). 새로 뜬 시그널·비중·리뷰만 간다 (services/alerts.py).

    갱신이 시장마다 따로 도므로 여기서도 여러 번 불린다 — 미국 종목의 시그널은 미국 갱신 뒤
    (한국 아침), 한국 종목은 한국 갱신 뒤(한국 오후)에 온다. 이미 알린 것은 다시 안 간다.
    알림이 넘어져도 갱신 결과는 그대로다.
    """
    from app.services import alerts

    db = SessionLocal()
    try:
        alerts.run_daily(db)
    except Exception:
        logger.warning("알림을 보내지 못했습니다", exc_info=True)
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
        results = {}
    finally:
        db.close()
    # 받아온 게 있을 때만. 서버를 다시 띄울 때마다 알림을 판정할 이유는 없다
    if results:
        _send_alerts()


def _backup_job() -> None:
    from app.services.backup import run_backup

    run_backup()


def _startup_backup_job() -> None:
    from app.services.backup import run_backup_if_stale

    run_backup_if_stale()


def _macro_refresh_job(startup: bool = False) -> None:
    """매크로 지표 갱신. 정해진 시각에 도는 쪽과 켠 직후 도는 쪽이 **다르게 움직인다.**

    정해진 시각(하루 한 번)에는 **조건 없이 받는다.** 하루에 한 번 도는 것 자체가
    주기인데 거기에 "마지막으로 받은 지 20시간 지났나"를 또 물으면, 그 사이에 다른
    이유로 한 번 받았을 때 **정작 정기 갱신이 통째로 건너뛰어진다.**

    실제로 그 일이 있었다. 사용자가 밤 늦게 FRED 키를 넣고 앱을 다시 띄웠고(그때가
    UTC 16시), 켠 직후 작업이 그 시점의 최신값(금요일치)을 받아왔다. 일곱 시간 뒤
    23시 정기 갱신은 "아직 20시간이 안 됐다"며 건너뛰었고, 그 사이 올라온 월요일치는
    **하루를 통째로 기다렸다.** 화면에는 금요일 날짜가 그대로 떠 있었다.

    켠 직후에는 반대로 걸러야 한다 — 서버는 하루에도 몇 번 다시 뜨고, 그때마다
    20년치를 다시 받을 수는 없다. 대신 실패했던 지표는 시간과 무관하게 다시 해본다
    (다시 띄웠다는 건 보통 뭔가 고쳤다는 뜻이다).

    실패해도 조용히 넘어간다 — 매크로는 맥락이지 시그널이 아니다. 여기서 시끄럽게
    굴면 정작 시세 갱신 실패가 묻힌다. 어느 지표가 왜 막혔는지는 지표 행에 남고
    (`last_error`), 진단 화면에서 볼 수 있다.
    """
    from app.services import macro

    db = SessionLocal()
    try:
        results = (
            macro.refresh_due(db, after_restart=True) if startup else macro.refresh_all(db)
        )
        done = [r for r in results if r.get("ok") and not r.get("skipped")]
        failed = [r for r in results if not r.get("ok")]
        if done or failed:
            logger.info("매크로 갱신: 성공 %d, 실패 %d", len(done), len(failed))
        for item in failed:
            logger.warning("매크로 %s: %s", item["code"], item.get("error"))

        # 예측치는 **따로 받는다.** 지표 값과 다른 서버에서 오고, 없어도 지표는
        # 멀쩡하다 — 예상치가 없으면 "물가 상회" 배지가 안 뜰 뿐이다. 그래서 여기서
        # 실패해도 위의 갱신 결과를 건드리지 않는다.
        #
        # 켠 직후에도 부른다. 7MB 짜리 파일이지만 하루에 한 번만 실제로 받는다
        # (`forecasts_fetched_today`) — 켠 직후 한 번이 있어야 새로 띄운 서버가
        # 예상치 없이 하루를 보내지 않는다.
        forecast = macro.refresh_forecasts(db)
        if not forecast.get("ok"):
            logger.warning("예측치 갱신 실패: %s", forecast.get("error"))
    except Exception:
        logger.warning("매크로 갱신에 실패했습니다", exc_info=True)
    finally:
        db.close()


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
    # 매크로: 미국 갱신(22:30) 뒤, 백업(23:30) 앞. 그날 받은 지표까지 백업에 들어간다.
    # FRED 의 일간 금리는 미 동부 오후 4시 15분쯤 올라오므로 이 시각이면 늘 그 뒤다
    # (23:00 UTC = 18:00 EST / 19:00 EDT).
    scheduler.add_job(
        _macro_refresh_job, "cron", hour=23, minute=0, id="macro_refresh",
        misfire_grace_time=MISFIRE_GRACE_SECONDS,
    )
    # 켠 직후 한 번 — 처음 띄웠을 때 지표가 비어 있지 않게 한다. 시세(30초) 뒤,
    # 백업(60초) 앞에 둔다. 셋 다 네트워크를 쓰므로 겹치지 않게 벌려놓는다.
    scheduler.add_job(
        _macro_refresh_job, "date", run_date=_soon(45), id="macro_refresh_startup",
        args=[True],  # 켠 직후 쪽 — 방금 받은 것은 건너뛰고, 실패했던 것만 다시 해본다
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
