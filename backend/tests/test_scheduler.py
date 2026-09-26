"""자동 갱신 스케줄러 배선.

한국과 미국은 마감 시각이 다르므로 갱신 job도 나뉜다. 국내 job이 시장 필터 없이 돌면
미국 종목까지 한국 마감 시각에 갱신해 의미 없는 호출이 나가고, 반대로 국내 job이 아예
없으면 한국 거래일 낮 내내 전날 종가가 걸려 있게 된다.

백업 job도 여기 붙어 있다. 실제로 무엇을 뜨는지는 test_backup.py가 보고, 여기서는
**배선**만 본다 — 갱신 뒤에 도는지, 개인 PC를 위한 시작 시 job이 있는지.
"""

import pandas as pd

from app.markets import Market
from app.services import pipeline, scheduler
from tests.factories import make_stock


def test_jobs_cover_both_market_closes():
    sched = scheduler.start_scheduler()
    try:
        jobs = {job.id: job for job in sched.get_jobs()}
        assert set(jobs) == {
            "daily_refresh",
            "korea_refresh",
            "japan_refresh",
            "listing_refresh",
            "listing_refresh_startup",
            "refresh_startup",
            "macro_refresh",
            "macro_refresh_startup",
            "fundamentals_refresh",
            "fundamentals_refresh_startup",
            "backup",
            "backup_startup",
        }

        # 미국: UTC 22:30 (마감 후), 한국: UTC 07:30 = KST 16:30 (마감 후)
        daily = str(jobs["daily_refresh"].trigger)
        korea = str(jobs["korea_refresh"].trigger)
        assert "hour='22'" in daily and "minute='30'" in daily
        assert "hour='7'" in korea and "minute='30'" in korea

        # 도쿄는 15:00 JST 마감 — 한국(15:30 KST)보다 30분 이르다
        japan = str(jobs["japan_refresh"].trigger)
        assert "hour='7'" in japan and "minute='0'" in japan

        # 매크로: 미국 갱신(22:30)과 백업(23:30) 사이. 순서가 뒤집히면 그날 받은
        # 지표가 백업에 안 들어가고, 하루 늦은 것만 남는다.
        macro_job = str(jobs["macro_refresh"].trigger)
        assert "hour='23'" in macro_job and "minute='0'" in macro_job

        # 재무: 매크로(23:00) 뒤, 백업(23:30) 앞 — 그날 받은 공시가 그날 백업에 든다
        fundamentals_job = str(jobs["fundamentals_refresh"].trigger)
        assert "hour='23'" in fundamentals_job and "minute='15'" in fundamentals_job
    finally:
        scheduler.shutdown_scheduler()


def test_start_is_idempotent():
    """두 번 켜도 job이 중복 등록되면 안 된다 (같은 시각에 두 번 갱신)."""
    first = scheduler.start_scheduler()
    try:
        assert scheduler.start_scheduler() is first
        assert len(first.get_jobs()) == 12
    finally:
        scheduler.shutdown_scheduler()


def _stub_fetch(monkeypatch):
    """시세 조회만 가짜로 — 갱신은 이제 전 종목을 한꺼번에 조회한 뒤 차례로 저장한다."""
    monkeypatch.setattr(
        pipeline.data_ingestion,
        "fetch_many",
        lambda requests, period="2y": {ticker: pd.DataFrame() for ticker, _ in requests},
    )


def test_korea_job_only_refreshes_korean_stocks(db_session, monkeypatch):
    make_stock(db_session, "005930.KS", target_weight_pct=50)
    make_stock(db_session, "VOO", target_weight_pct=50)

    refreshed = []
    monkeypatch.setattr(
        pipeline,
        "refresh_and_evaluate_stock",
        lambda db, stock, full_backfill=False, price_df=None: refreshed.append(stock.ticker)
        or {"ticker": stock.ticker},
    )
    _stub_fetch(monkeypatch)
    monkeypatch.setattr(pipeline.fx, "refresh_rates", lambda db: None)

    pipeline.refresh_all_active_stocks(db_session, market=Market.KR)
    assert refreshed == ["005930.KS"]

    refreshed.clear()
    pipeline.refresh_all_active_stocks(db_session)
    assert sorted(refreshed) == ["005930.KS", "VOO"]


def test_fx_failure_does_not_lose_price_results(db_session, monkeypatch):
    """환율 조회가 실패해도 시세 갱신 결과는 그대로 돌아와야 한다."""
    make_stock(db_session, "VOO", target_weight_pct=100)

    monkeypatch.setattr(
        pipeline,
        "refresh_and_evaluate_stock",
        lambda db, stock, full_backfill=False, price_df=None: {
            "ticker": stock.ticker,
            "rows_upserted": 5,
        },
    )
    _stub_fetch(monkeypatch)

    def boom(db):
        raise RuntimeError("환율 서버 연결 실패")

    monkeypatch.setattr(pipeline.fx, "refresh_rates", boom)

    results = pipeline.refresh_all_active_stocks(db_session)
    assert results == [{"ticker": "VOO", "rows_upserted": 5}]


def test_listing_cache_is_filled_on_startup():
    """내장 목록은 주요 종목뿐이라, 앱이 켜지면 전체 상장목록을 한 번 채워야 한다.

    사용자가 "거래소 목록 갱신" 버튼의 존재를 알아야만 중소형주가 검색되는 상태였다.
    """
    sched = scheduler.start_scheduler()
    try:
        jobs = {job.id: job for job in sched.get_jobs()}
        # 시작을 붙잡지 않도록 즉시가 아니라 잠깐 뒤에 한 번 돈다
        assert "listing_refresh_startup" in jobs
        assert "date" in str(type(jobs["listing_refresh_startup"].trigger)).lower()
        # 이후에는 주 1회
        assert "day_of_week='sun'" in str(jobs["listing_refresh"].trigger)
    finally:
        scheduler.shutdown_scheduler()


def test_backup_runs_after_the_day_is_refreshed():
    """백업이 갱신보다 먼저 돌면 그날 받은 시세가 빠진 걸 백업하게 된다."""
    sched = scheduler.start_scheduler()
    try:
        jobs = {job.id: job for job in sched.get_jobs()}
        daily = str(jobs["daily_refresh"].trigger)
        backup_job = str(jobs["backup"].trigger)
        assert "hour='22'" in daily
        assert "hour='23'" in backup_job and "minute='30'" in backup_job
    finally:
        scheduler.shutdown_scheduler()


def test_backup_also_runs_when_the_pc_is_turned_on():
    """개인 PC는 정해진 시각에 켜져 있으리라는 보장이 없다.

    다만 켤 때마다 뜨면 보관분이 반나절치가 되므로, 실제로 뜰지는
    `run_backup_if_stale`이 판단한다 (test_backup.py).
    """
    sched = scheduler.start_scheduler()
    try:
        jobs = {job.id: job for job in sched.get_jobs()}
        assert "date" in str(type(jobs["backup_startup"].trigger)).lower()
    finally:
        scheduler.shutdown_scheduler()


def test_backup_failure_does_not_kill_the_scheduler(monkeypatch, caplog):
    """백업이 실패했다고 다음날 시세 갱신까지 멈추면 안 된다."""
    from app.services import backup

    monkeypatch.setattr(backup, "create_backup", lambda *a, **k: (_ for _ in ()).throw(OSError("디스크 꽉 참")))

    with caplog.at_level("ERROR"):
        scheduler._backup_job()  # 예외가 새어 나오면 실패

    assert "백업에 실패" in caplog.text


def test_listing_job_survives_blocked_network(monkeypatch, caplog):
    """상장목록을 못 받아도 앱은 내장 목록으로 계속 동작한다 — 죽으면 안 된다."""
    from app.services import symbols

    def blocked(db, timeout=30):
        raise RuntimeError("CONNECT tunnel failed, 403")

    monkeypatch.setattr(symbols, "refresh_krx_listing_if_stale", blocked)

    with caplog.at_level("INFO"):
        scheduler._listing_refresh_job()  # 예외가 새어 나오면 실패

    assert "내장 목록으로 검색됩니다" in caplog.text


def test_one_failed_fetch_does_not_stop_the_rest(db_session, monkeypatch):
    """한 종목의 시세 조회가 실패해도 나머지 종목은 갱신된다.

    전 종목을 한꺼번에 조회하게 바뀌면서, 한 종목의 실패가 묶음 전체를 무너뜨리지
    않는지가 새로 중요해졌다.
    """
    make_stock(db_session, "VOO", target_weight_pct=50)
    make_stock(db_session, "ZZZZ", target_weight_pct=50)

    monkeypatch.setattr(
        pipeline.data_ingestion,
        "fetch_many",
        lambda requests, period="2y": {
            ticker: (
                pipeline.data_ingestion.DataIngestionError("no data", hint="티커를 확인해주세요")
                if ticker == "ZZZZ"
                else pd.DataFrame()
            )
            for ticker, _ in requests
        },
    )
    monkeypatch.setattr(
        pipeline,
        "refresh_and_evaluate_stock",
        lambda db, stock, full_backfill=False, price_df=None: {"ticker": stock.ticker},
    )
    monkeypatch.setattr(pipeline.fx, "refresh_rates", lambda db: None)

    results = {row["ticker"]: row for row in pipeline.refresh_all_active_stocks(db_session)}
    assert results["VOO"] == {"ticker": "VOO"}
    assert results["ZZZZ"]["hint"] == "티커를 확인해주세요"


def test_startup_jobs_are_scheduled_in_seconds_not_hours():
    """켤 때 도는 job들이 **정말로** 곧 도는지.

    스케줄러는 UTC로 도는데 시간대 없는 `datetime.now()`를 주면 APScheduler가 그 값을
    UTC로 읽는다. 한국(UTC+9)에서는 "15초 뒤"가 9시간 뒤가 되어, 앱을 그만큼 켜두지
    않으면 켤 때 하는 일이 하나도 돌지 않는다. 실제로 그 상태였다.
    """
    import datetime as dt

    # 핵심은 이것 하나다. 시간대가 붙어 있지 않으면 APScheduler가 로컬 시각을 UTC로
    # 읽는다. (이 검사는 테스트를 돌리는 PC의 시간대와 무관하게 성립해야 하므로
    # `_soon` 자체를 본다 — CI는 UTC라 job의 예정 시각만 보면 버그가 숨는다.)
    soon = scheduler._soon(15)
    assert soon.tzinfo is not None, "_soon()이 시간대 없는 값을 돌려준다"
    assert 0 < (soon - dt.datetime.now(dt.timezone.utc)).total_seconds() < 60

    sched = scheduler.start_scheduler()
    try:
        now = dt.datetime.now(dt.timezone.utc)
        jobs = {job.id: job for job in sched.get_jobs()}
        for job_id in ("listing_refresh_startup", "refresh_startup", "backup_startup",
                       "fundamentals_refresh_startup"):
            delay = (jobs[job_id].trigger.run_date - now).total_seconds()
            assert 0 < delay < 300, f"{job_id}: {delay:.0f}초 뒤에 돈다"
    finally:
        scheduler.shutdown_scheduler()


def test_prices_are_caught_up_when_the_pc_is_turned_on():
    """cron은 놓친 실행을 되돌려주지 않는다. 개인 PC는 갱신 시각 대부분에 꺼져 있다.

    백업에는 이 장치가 있었는데(backup_startup) 시세에는 없었다. 그래서 며칠 꺼뒀다
    켜면 시세가 그대로였고, 그 사이 기간의 매수 판정도 일어나지 않았다.
    """
    sched = scheduler.start_scheduler()
    try:
        jobs = {job.id: job for job in sched.get_jobs()}
        assert "refresh_startup" in jobs
        assert "date" in str(type(jobs["refresh_startup"].trigger)).lower()
    finally:
        scheduler.shutdown_scheduler()


def test_catch_up_only_refreshes_markets_that_fell_behind(db_session, monkeypatch):
    """미국만 밀렸으면 미국만 받아온다 — 멀쩡한 시장까지 다시 받을 이유가 없다."""
    import datetime as dt

    from app.models import PriceDaily

    make_stock(db_session, "VOO", target_weight_pct=50)
    make_stock(db_session, "005930.KS", target_weight_pct=50)

    us_last = pipeline.last_closed_trading_day(Market.US)
    kr_last = pipeline.last_closed_trading_day(Market.KR)

    # 한국은 최신, 미국은 한 달 뒤처져 있다
    db_session.add(PriceDaily(ticker="005930.KS", date=kr_last, open=1, high=1, low=1, close=1, volume=1))
    db_session.add(
        PriceDaily(
            ticker="VOO", date=us_last - dt.timedelta(days=30),
            open=1, high=1, low=1, close=1, volume=1,
        )
    )
    db_session.commit()

    assert pipeline.stale_markets(db_session) == [Market.US]

    refreshed = []
    monkeypatch.setattr(
        pipeline, "refresh_all_active_stocks",
        lambda db, market=None: refreshed.append(market) or [],
    )
    pipeline.refresh_stale_markets(db_session)
    assert refreshed == [Market.US]


def test_catch_up_does_nothing_when_prices_are_current(db_session, monkeypatch):
    """켤 때마다 다시 받아오면 그것대로 못 쓴다."""
    from app.models import PriceDaily

    make_stock(db_session, "VOO", target_weight_pct=100)
    db_session.add(
        PriceDaily(
            ticker="VOO", date=pipeline.last_closed_trading_day(Market.US),
            open=1, high=1, low=1, close=1, volume=1,
        )
    )
    db_session.commit()

    assert pipeline.stale_markets(db_session) == []

    monkeypatch.setattr(
        pipeline, "refresh_all_active_stocks",
        lambda db, market=None: (_ for _ in ()).throw(AssertionError("갱신하면 안 된다")),
    )
    assert pipeline.refresh_stale_markets(db_session) == {}


def test_a_second_process_does_not_start_a_second_scheduler(monkeypatch):
    """자물쇠를 못 잡으면 조용히 안 띄운다 (leader.py).

    이게 없으면 워커를 늘리는 순간 같은 시각에 같은 종목을 여러 번 받아온다.
    """

    class Taken:
        def acquire(self):
            return False

        def release(self):
            pass

    monkeypatch.setattr(scheduler, "_lock", Taken())
    assert scheduler.start_scheduler() is None


def test_fundamentals_job_covers_watched_tickers_once(db_session, monkeypatch):
    """재무는 보고 있는 종목의 합집합으로 — 둘이 같은 종목을 담아도 한 번."""
    from app.services import fundamentals
    from tests.factories import make_user

    make_stock(db_session, "NVDA")
    make_user(db_session, id=2, status="active")
    make_stock(db_session, "NVDA", user_id=2)
    make_stock(db_session, "LLY", user_id=2)
    from sqlalchemy.orm import sessionmaker

    seen = []
    # 작업은 자기 세션을 열고 닫는다 — 테스트 세션을 넘겨 close 를 막으면 Postgres 에서
    # 트랜잭션이 열린 채 남아 정리(DROP SCHEMA)가 영영 기다린다.
    monkeypatch.setattr(scheduler, "SessionLocal", sessionmaker(bind=db_session.get_bind()))
    monkeypatch.setattr(fundamentals, "refresh_due", lambda db, tickers: seen.append(tickers) or [])
    scheduler._fundamentals_job()
    assert seen == [["LLY", "NVDA"]]
