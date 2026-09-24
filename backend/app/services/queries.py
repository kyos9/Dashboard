"""여러 종목의 최근 시계열 행을 한 번의 쿼리로 가져오는 헬퍼.

종목마다 따로 조회하면 대시보드 한 번 여는 데 종목 수 x 테이블 수만큼 쿼리가 나간다.
윈도우 함수(row_number)로 테이블당 한 번만 조회하도록 모아둔다.
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from typing import Sequence, TypeVar

from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from app.models import IndicatorDaily, PriceDaily, SignalDaily

T = TypeVar("T", PriceDaily, IndicatorDaily, SignalDaily)

# 최근 몇 행만 필요할 때 먼저 훑어볼 기간. 설·추석 연휴가 길어도 6거래일은 넉넉히 들어간다.
RECENT_WINDOW = dt.timedelta(days=45)


def _ranked(db: Session, model: type[T], tickers: Sequence[str], limit: int, since: dt.date | None):
    row_number = (
        func.row_number()
        .over(partition_by=model.ticker, order_by=model.date.desc())
        .label("rn")
    )
    inner = select(model, row_number).where(model.ticker.in_(list(tickers)))
    if since is not None:
        inner = inner.where(model.date >= since)
    ranked = inner.subquery()
    entity = aliased(model, ranked)
    return (
        db.execute(
            select(entity)
            .where(ranked.c.rn <= limit)
            .order_by(entity.ticker.asc(), entity.date.desc())
        )
        .scalars()
        .all()
    )


def _recent_by_ticker(
    db: Session, model: type[T], tickers: Sequence[str], limit: int
) -> dict[str, list[T]]:
    """종목별 최근 `limit`개 행을 날짜 내림차순으로. 행이 없는 종목은 키 자체가 없다.

    **최근 몇 주만 먼저 본다.** 기간 없이 순위를 매기면 30년치 전 종목을 다 줄 세운 뒤
    맨 앞 몇 개만 남기는 셈이라, 종목 15개에서 쿼리 하나가 0.2초씩 걸렸다(대시보드는 이걸
    네 번 부른다). 그 기간에 `limit`개가 안 차는 종목 — 오래 갱신이 안 됐거나 막 상장한
    종목 — 만 전체 기간에서 다시 찾는다. 결과는 기간 없이 찾은 것과 똑같다.
    """
    if not tickers or limit < 1:
        return {}

    since = dt.date.today() - RECENT_WINDOW
    grouped: dict[str, list[T]] = defaultdict(list)
    for row in _ranked(db, model, tickers, limit, since):
        grouped[row.ticker].append(row)

    short = [t for t in tickers if len(grouped.get(t, ())) < limit]
    if short:
        for ticker in short:
            grouped.pop(ticker, None)
        for row in _ranked(db, model, short, limit, None):
            grouped[row.ticker].append(row)
    return dict(grouped)


def recent_prices(db: Session, tickers: Sequence[str], limit: int = 2) -> dict[str, list[PriceDaily]]:
    return _recent_by_ticker(db, PriceDaily, tickers, limit)


def recent_indicators(
    db: Session, tickers: Sequence[str], limit: int = 6
) -> dict[str, list[IndicatorDaily]]:
    return _recent_by_ticker(db, IndicatorDaily, tickers, limit)


def recent_signals(db: Session, tickers: Sequence[str], limit: int = 1) -> dict[str, list[SignalDaily]]:
    return _recent_by_ticker(db, SignalDaily, tickers, limit)


def latest_closes(db: Session, tickers: Sequence[str]) -> dict[str, float]:
    """종목별 최신 종가만 한 번에."""
    return {
        ticker: rows[0].close
        for ticker, rows in recent_prices(db, tickers, limit=1).items()
        if rows
    }


def last_buy_signal_dates(db: Session, tickers: Sequence[str]) -> dict[str, dt.date]:
    """종목별 무릎매수(v2)가 마지막으로 뜬 날. 한 번도 안 뜬 종목은 키가 없다."""
    if not tickers:
        return {}
    rows = (
        db.query(SignalDaily.ticker, func.max(SignalDaily.date))
        .filter(SignalDaily.ticker.in_(list(tickers)), SignalDaily.knee_buy_v2.is_(True))
        .group_by(SignalDaily.ticker)
        .all()
    )
    return {ticker: date for ticker, date in rows if date is not None}
