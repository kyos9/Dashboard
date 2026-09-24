"""종목 하나를 갱신(가격→지표→시그널)하는 오케스트레이션.

수동 새로고침 버튼과 일일 스케줄러(scheduler.py)가 공통으로 사용한다.
"""

import logging

import pandas as pd
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.markets import Market
from app.models import Instrument, PriceDaily, User, UserStock
from app.services import data_ingestion, fx, limits
from app.services.users import STATUS_ACTIVE
from app.services.trading_calendar import last_closed_trading_day

logger = logging.getLogger(__name__)


def refresh_and_evaluate_stock(
    db: Session,
    stock: UserStock,
    full_backfill: bool = False,
    price_df: pd.DataFrame | None = None,
) -> dict:
    return data_ingestion.refresh_ticker(
        db, stock.ticker, full_backfill=full_backfill, price_df=price_df
    )


def watched(db: Session):
    """**누구 하나라도 보고 있는** 종목 줄 — 매일 받는 대상은 이것의 합집합이다 (ROADMAP 4-4b).

    예전에는 담긴 줄마다 돌아서, 둘이 같은 QQQ를 담으면 QQQ를 두 번 받았다. 그리고 한
    사람이 치운(비활성) 종목은 빠지되 **남이 보고 있으면 계속 받는다** — `active` 는 "내
    화면에서 치웠다"는 뜻이지 공용 수집을 끄는 스위치가 아니다.

    쓰는 중인 사람의 것만 센다. 승인 대기·거절·차단된 사람은 화면을 볼 수 없으니, 그
    사람만 담은 종목을 매일 받을 이유가 없다 (데이터는 남는다 — 다시 승인되면 그날 밤부터
    다시 받는다).
    """
    return (
        db.query(UserStock)
        .join(User, User.id == UserStock.user_id)
        .filter(UserStock.active.is_(True), User.status == STATUS_ACTIVE)
    )


def refresh_all_active_stocks(db: Session, market: Market | None = None) -> list[dict]:
    """보고 있는 종목을 **티커마다 한 번씩** 갱신한다. `market`을 주면 해당 시장 종목만.

    시세 조회는 한꺼번에(동시에) 하고 저장은 차례로 한다. 종목마다 조회→저장을 반복하면
    전체 시간이 "종목 수 x 왕복 시간"이 되는데, 그 왕복은 대부분 응답을 기다리는 시간이다.

    환율도 함께 갱신한다 — 통화가 섞인 포트폴리오에서는 환율이 낡으면 비중이 틀어지는데,
    화면에서는 시세만 갱신된 것처럼 보여 눈치채기 어렵다.
    """
    query = watched(db)
    if market is not None:
        query = query.join(UserStock.instrument).filter(Instrument.market == market.value)
    # 시세는 공용이다 — 티커 하나에 줄 하나만 남긴다 (누구의 줄이든 받는 것은 같다)
    by_ticker: dict[str, UserStock] = {}
    for stock in query.order_by(UserStock.ticker, UserStock.user_id):
        by_ticker.setdefault(stock.ticker, stock)
    stocks = list(by_ticker.values())

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
            continue
        # 방금 받았다 — 사람이 바로 새로고침을 눌러도 다시 받지 않고 "방금 받았다"고 답한다
        limits.refresh_cooldown.mark(stock.ticker, ok=True)

    try:
        fx.refresh_rates(db)
    except Exception:
        # 환율 갱신 실패가 시세 갱신 결과를 덮어써선 안 된다 (직전 환율이 그대로 쓰인다)
        logger.warning("환율 갱신 실패 — 기존 환율을 계속 사용합니다", exc_info=True)

    return results


def stale_markets(db: Session) -> list[Market]:
    """보고 있는 종목(`watched` 와 같은 기준)의 최신 시세가 마지막 거래일보다 뒤처진 시장.

    시장별로 본다 — 한국은 최신인데 미국만 밀려 있을 수 있고, 그때 전 종목을 다시
    받아올 이유는 없다.
    """
    rows = (
        db.query(Instrument.market, func.max(PriceDaily.date))
        .select_from(UserStock)
        .join(User, User.id == UserStock.user_id)
        .join(Instrument, Instrument.ticker == UserStock.ticker)
        .outerjoin(PriceDaily, PriceDaily.ticker == UserStock.ticker)
        .filter(UserStock.active.is_(True), User.status == STATUS_ACTIVE)
        .group_by(Instrument.market)
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
