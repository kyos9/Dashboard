"""여러 종목의 최근 시계열 행을 한 번의 쿼리로 가져오는 헬퍼.

종목마다 따로 조회하면 대시보드 한 번 여는 데 종목 수 x 테이블 수만큼 쿼리가 나간다.
윈도우 함수(row_number)로 테이블당 한 번만 조회하도록 모아둔다.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Sequence, TypeVar

from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from app.models import IndicatorDaily, PriceDaily, SignalDaily

T = TypeVar("T", PriceDaily, IndicatorDaily, SignalDaily)


def _recent_by_ticker(
    db: Session, model: type[T], tickers: Sequence[str], limit: int
) -> dict[str, list[T]]:
    """종목별 최근 `limit`개 행을 날짜 내림차순으로. 행이 없는 종목은 키 자체가 없다."""
    if not tickers or limit < 1:
        return {}

    row_number = (
        func.row_number()
        .over(partition_by=model.ticker, order_by=model.date.desc())
        .label("rn")
    )
    ranked = select(model, row_number).where(model.ticker.in_(list(tickers))).subquery()
    entity = aliased(model, ranked)

    rows = (
        db.execute(
            select(entity)
            .where(ranked.c.rn <= limit)
            .order_by(entity.ticker.asc(), entity.date.desc())
        )
        .scalars()
        .all()
    )

    grouped: dict[str, list[T]] = defaultdict(list)
    for row in rows:
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
