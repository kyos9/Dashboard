"""종목 하나를 갱신(가격→지표→시그널)하고 매수 워크플로우까지 평가하는 오케스트레이션.

수동 새로고침 버튼과 일일 스케줄러(scheduler.py)가 공통으로 사용한다.
"""

import logging

from sqlalchemy.orm import Session

from app.models import Stock
from app.services import buy_workflow, data_ingestion

logger = logging.getLogger(__name__)


def refresh_and_evaluate_stock(db: Session, stock: Stock, full_backfill: bool = False) -> dict:
    result = data_ingestion.refresh_ticker(db, stock.ticker, full_backfill=full_backfill)
    buy_workflow.evaluate_buy_workflow(db, stock)
    return result


def refresh_all_active_stocks(db: Session) -> list[dict]:
    results = []
    for stock in db.query(Stock).filter(Stock.active.is_(True)).all():
        try:
            results.append(refresh_and_evaluate_stock(db, stock, full_backfill=False))
        except data_ingestion.DataIngestionError as exc:
            logger.warning("skip refresh for %s: %s", stock.ticker, exc)
            results.append({"ticker": stock.ticker, "error": str(exc)})
    return results
