"""종목별 최근 몇 행 — 최근 기간만 먼저 보는 지름길이 전체를 훑은 결과와 같은지.

지름길은 속도 때문에 넣었다(대시보드가 전 종목 30년치를 줄 세우고 있었다). 빨라진 대신
결과가 달라지면 안 되므로, 기간 안에 행이 모자란 종목들 — 오래 갱신이 안 된 종목,
연휴를 낀 종목, 막 상장한 종목 — 을 일부러 섞어서 기간 없는 조회와 비교한다.
"""

import datetime as dt

from app.models import IndicatorDaily, PriceDaily, SignalDaily
from app.services import queries
from app.services.instruments import ensure_instrument

TODAY = dt.date.today()


def _days_back(start_days_ago: int, count: int, step: int = 1) -> list[dt.date]:
    return [TODAY - dt.timedelta(days=start_days_ago + i * step) for i in range(count)]


def _seed(db) -> dict[str, list[dt.date]]:
    dates = {
        # 매일 갱신되는 평범한 종목 (10년치)
        "FRESH": _days_back(0, 2500),
        # 석 달 전에 갱신이 멈춘 종목 — 최근 기간 안에 한 행도 없다
        "STALE": _days_back(90, 400),
        # 최근 기간에 두 행만 있고 나머지는 한참 전 — 6개를 달라면 모자란다
        "GAPPY": _days_back(1, 2, step=10) + _days_back(200, 50),
        # 막 상장해서 행이 셋뿐
        "NEW": _days_back(0, 3),
    }
    for ticker, days in dates.items():
        ensure_instrument(db, ticker)
        for i, day in enumerate(days):
            db.add(PriceDaily(ticker=ticker, date=day, open=1, high=1, low=1, close=100 + i, volume=1))
            db.add(IndicatorDaily(ticker=ticker, date=day, ma5=float(i)))
            db.add(SignalDaily(ticker=ticker, date=day, knee_buy_v2=i % 7 == 0, shoulder_sell_ref=False))
    db.commit()
    return dates


def _full_scan(db, model, tickers, limit):
    """지름길 없이 — 종목마다 날짜 내림차순 앞에서 `limit`개."""
    out = {}
    for ticker in tickers:
        rows = (
            db.query(model).filter(model.ticker == ticker).order_by(model.date.desc()).limit(limit).all()
        )
        if rows:
            out[ticker] = [row.date for row in rows]
    return out


def test_shortcut_matches_a_full_scan(db_session):
    _seed(db_session)
    tickers = ["FRESH", "STALE", "GAPPY", "NEW", "NOTHING"]
    for model, fetch in (
        (PriceDaily, queries.recent_prices),
        (IndicatorDaily, queries.recent_indicators),
        (SignalDaily, queries.recent_signals),
    ):
        for limit in (1, 2, 6):
            got = {t: [r.date for r in rows] for t, rows in fetch(db_session, tickers, limit=limit).items()}
            assert got == _full_scan(db_session, model, tickers, limit), (model.__name__, limit)


def test_stale_and_short_tickers_still_get_their_rows(db_session):
    dates = _seed(db_session)
    got = queries.recent_indicators(db_session, ["STALE", "GAPPY", "NEW"], limit=6)
    assert [r.date for r in got["STALE"]] == dates["STALE"][:6]
    # 최근 두 행 + 한참 전 네 행 — 기간 안의 것만 돌려주면 5일 전 비교(shift 5)가 빈다
    assert [r.date for r in got["GAPPY"]] == dates["GAPPY"][:6]
    assert len(got["NEW"]) == 3
    assert "NOTHING" not in queries.recent_indicators(db_session, ["NOTHING"], limit=6)


def test_latest_close_of_a_stale_ticker(db_session):
    """갱신이 멈춘 종목도 비중 계산에서 빠지면 안 된다 (마지막으로 받은 종가를 쓴다)."""
    _seed(db_session)
    closes = queries.latest_closes(db_session, ["FRESH", "STALE"])
    assert closes == {"FRESH": 100.0, "STALE": 100.0}


def test_fresh_tickers_are_answered_in_one_query(db_session):
    """지름길이 실제로 쓰이는지 — 매일 갱신되는 종목만 있으면 두 번째(전체 기간) 조회가 없어야 한다.

    결과만 비교하면 지름길이 매번 빗나가 전체 조회로 떨어져도 통과한다. 느린 서버에서
    대시보드가 다시 몇 초씩 걸리게 되는 바로 그 상황이라 따로 센다.
    """
    from sqlalchemy import event

    _seed(db_session)
    statements: list[str] = []

    def count(conn, cursor, statement, *args):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    engine = db_session.get_bind()
    event.listen(engine, "before_cursor_execute", count)
    try:
        rows = queries.recent_indicators(db_session, ["FRESH"], limit=6)
    finally:
        event.remove(engine, "before_cursor_execute", count)
    assert len(rows["FRESH"]) == 6
    assert len(statements) == 1
