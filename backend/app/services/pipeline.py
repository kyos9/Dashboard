"""종목 하나를 갱신(가격→지표→시그널)하고 매수 워크플로우까지 평가하는 오케스트레이션.

수동 새로고침 버튼과 일일 스케줄러(scheduler.py)가 공통으로 사용한다.
"""

import logging

from sqlalchemy.orm import Session

from app.markets import Market
from app.models import Stock
from app.services import buy_workflow, data_ingestion, fx

logger = logging.getLogger(__name__)


def refresh_and_evaluate_stock(db: Session, stock: Stock, full_backfill: bool = False) -> dict:
    result = data_ingestion.refresh_ticker(db, stock.ticker, full_backfill=full_backfill)
    buy_workflow.evaluate_buy_workflow(db, stock)
    return result


def refresh_all_active_stocks(db: Session, market: Market | None = None) -> list[dict]:
    """활성 종목을 갱신한다. `market`을 주면 해당 시장 종목만.

    환율도 함께 갱신한다 — 통화가 섞인 포트폴리오에서는 환율이 낡으면 비중이 틀어지는데,
    화면에서는 시세만 갱신된 것처럼 보여 눈치채기 어렵다.
    """
    query = db.query(Stock).filter(Stock.active.is_(True))
    if market is not None:
        query = query.filter(Stock.market == market.value)

    results = []
    for stock in query.all():
        try:
            results.append(refresh_and_evaluate_stock(db, stock, full_backfill=False))
        except data_ingestion.DataIngestionError as exc:
            logger.warning("skip refresh for %s: %s", stock.ticker, exc)
            results.append({"ticker": stock.ticker, "error": str(exc), "hint": exc.hint})

    try:
        fx.refresh_usd_krw(db)
    except Exception:
        # 환율 갱신 실패가 시세 갱신 결과를 덮어써선 안 된다 (직전 환율이 그대로 쓰인다)
        logger.warning("환율 갱신 실패 — 기존 환율을 계속 사용합니다", exc_info=True)

    return results
