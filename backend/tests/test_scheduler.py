"""자동 갱신 스케줄러 배선.

한국과 미국은 마감 시각이 다르므로 갱신 job도 나뉜다. 국내 job이 시장 필터 없이 돌면
미국 종목까지 한국 마감 시각에 갱신해 의미 없는 호출이 나가고, 반대로 국내 job이 아예
없으면 한국 거래일 낮 내내 전날 종가가 걸려 있게 된다.
"""

from app.markets import Market
from app.models import Stock
from app.services import pipeline, scheduler


def test_jobs_cover_both_market_closes():
    sched = scheduler.start_scheduler()
    try:
        jobs = {job.id: job for job in sched.get_jobs()}
        assert set(jobs) == {"daily_refresh", "korea_refresh"}

        # 미국: UTC 22:30 (마감 후), 한국: UTC 07:30 = KST 16:30 (마감 후)
        daily = str(jobs["daily_refresh"].trigger)
        korea = str(jobs["korea_refresh"].trigger)
        assert "hour='22'" in daily and "minute='30'" in daily
        assert "hour='7'" in korea and "minute='30'" in korea
    finally:
        scheduler.shutdown_scheduler()


def test_start_is_idempotent():
    """두 번 켜도 job이 중복 등록되면 안 된다 (같은 시각에 두 번 갱신)."""
    first = scheduler.start_scheduler()
    try:
        assert scheduler.start_scheduler() is first
        assert len(first.get_jobs()) == 2
    finally:
        scheduler.shutdown_scheduler()


def test_korea_job_only_refreshes_korean_stocks(db_session, monkeypatch):
    db_session.add(Stock(ticker="005930.KS", target_weight_pct=50))
    db_session.add(Stock(ticker="VOO", target_weight_pct=50))
    db_session.commit()

    refreshed = []
    monkeypatch.setattr(
        pipeline,
        "refresh_and_evaluate_stock",
        lambda db, stock, full_backfill=False: refreshed.append(stock.ticker) or {"ticker": stock.ticker},
    )
    monkeypatch.setattr(pipeline.fx, "refresh_usd_krw", lambda db: None)

    pipeline.refresh_all_active_stocks(db_session, market=Market.KR)
    assert refreshed == ["005930.KS"]

    refreshed.clear()
    pipeline.refresh_all_active_stocks(db_session)
    assert sorted(refreshed) == ["005930.KS", "VOO"]


def test_fx_failure_does_not_lose_price_results(db_session, monkeypatch):
    """환율 조회가 실패해도 시세 갱신 결과는 그대로 돌아와야 한다."""
    db_session.add(Stock(ticker="VOO", target_weight_pct=100))
    db_session.commit()

    monkeypatch.setattr(
        pipeline,
        "refresh_and_evaluate_stock",
        lambda db, stock, full_backfill=False: {"ticker": stock.ticker, "rows_upserted": 5},
    )

    def boom(db):
        raise RuntimeError("환율 서버 연결 실패")

    monkeypatch.setattr(pipeline.fx, "refresh_usd_krw", boom)

    results = pipeline.refresh_all_active_stocks(db_session)
    assert results == [{"ticker": "VOO", "rows_upserted": 5}]
