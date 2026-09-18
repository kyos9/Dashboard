"""종목 하나를 갱신(가격→지표→시그널)하고 매수 워크플로우까지 평가하는 오케스트레이션.

수동 새로고침 버튼과 일일 스케줄러(scheduler.py)가 공통으로 사용한다.
"""

import logging

import pandas as pd
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.markets import Market
from app.models import PriceDaily, Stock
from app.services import buy_workflow, data_ingestion, fx
from app.services.trading_calendar import last_closed_trading_day

logger = logging.getLogger(__name__)


def refresh_and_evaluate_stock(
    db: Session,
    stock: Stock,
    full_backfill: bool = False,
    price_df: pd.DataFrame | None = None,
) -> dict:
    result = data_ingestion.refresh_ticker(
        db, stock.ticker, full_backfill=full_backfill, price_df=price_df
    )
    buy_workflow.evaluate_buy_workflow(db, stock)
    return result


def refresh_all_active_stocks(db: Session, market: Market | None = None) -> list[dict]:
    """활성 종목을 갱신한다. `market`을 주면 해당 시장 종목만.

    시세 조회는 한꺼번에(동시에) 하고 저장은 차례로 한다. 종목마다 조회→저장을 반복하면
    전체 시간이 "종목 수 x 왕복 시간"이 되는데, 그 왕복은 대부분 응답을 기다리는 시간이다.

    환율도 함께 갱신한다 — 통화가 섞인 포트폴리오에서는 환율이 낡으면 비중이 틀어지는데,
    화면에서는 시세만 갱신된 것처럼 보여 눈치채기 어렵다.
    """
    query = db.query(Stock).filter(Stock.active.is_(True))
    if market is not None:
        query = query.filter(Stock.market == market.value)
    stocks = query.all()

    # 지금까지 이 종목을 받아온 제공자를 먼저 시도한다 (여러 곳에서 받아 섞이지 않게)
    fetched = data_ingestion.fetch_many(
        [(stock.ticker, data_ingestion.stored_source(db, stock.ticker)) for stock in stocks]
    )

    results = []
    for stock in stocks:
        outcome = fetched.get(stock.ticker)
        if isinstance(outcome, data_ingestion.DataIngestionError):
            logger.warning("skip refresh for %s: %s", stock.ticker, outcome)
            results.append({"ticker": stock.ticker, "error": str(outcome), "hint": outcome.hint})
            continue
        try:
            results.append(refresh_and_evaluate_stock(db, stock, price_df=outcome))
        except data_ingestion.DataIngestionError as exc:
            logger.warning("skip refresh for %s: %s", stock.ticker, exc)
            results.append({"ticker": stock.ticker, "error": str(exc), "hint": exc.hint})

    try:
        fx.refresh_rates(db)
    except Exception:
        # 환율 갱신 실패가 시세 갱신 결과를 덮어써선 안 된다 (직전 환율이 그대로 쓰인다)
        logger.warning("환율 갱신 실패 — 기존 환율을 계속 사용합니다", exc_info=True)

    return results


def stale_markets(db: Session) -> list[Market]:
    """활성 종목의 최신 시세가 마지막 거래일보다 뒤처진 시장.

    시장별로 본다 — 한국은 최신인데 미국만 밀려 있을 수 있고, 그때 전 종목을 다시
    받아올 이유는 없다.
    """
    rows = (
        db.query(Stock.market, func.max(PriceDaily.date))
        .select_from(Stock)
        .outerjoin(PriceDaily, PriceDaily.ticker == Stock.ticker)
        .filter(Stock.active.is_(True))
        .group_by(Stock.market)
        .all()
    )

    stale: list[Market] = []
    for market_value, latest in rows:
        try:
            market = Market(market_value)
        except ValueError:
            logger.warning("모르는 시장 값이라 건너뜁니다: %s", market_value)
            continue
        expected = last_closed_trading_day(market)
        if expected is None:
            continue
        if latest is None or latest < expected:
            stale.append(market)
    return stale


def refresh_stale_markets(db: Session) -> dict[str, list[dict]]:
    """뒤처진 시장만 갱신한다. 켤 때 놓친 갱신을 따라잡는 용도.

    스케줄러의 cron은 **놓친 실행을 되돌려주지 않는다.** 서버는 늘 켜져 있으니 상관없지만
    개인 PC는 갱신 시각 대부분에 꺼져 있다. 그대로 두면 켜도 시세가 며칠 전 그대로다.
    """
    results: dict[str, list[dict]] = {}
    for market in stale_markets(db):
        logger.info("%s 시세가 마지막 거래일보다 뒤처져 있어 따라잡습니다", market.value)
        results[market.value] = refresh_all_active_stocks(db, market=market)
    return results
