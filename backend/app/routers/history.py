import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import PriceDaily, SignalDaily
from app.schemas import HistoryCoverage, HistoryMarker, HistoryPoint, HistoryResponse
from app.services.users import current_user_id, find_user_stock

router = APIRouter(prefix="/api/history", tags=["history"])

RANGE_DAYS = {"6mo": 182, "1y": 365, "5y": 365 * 5, "max": None}


def _coverage(db: Session, ticker: str) -> HistoryCoverage:
    """저장된 시세가 언제부터 언제까지인지.

    "5년을 눌렀는데 1년만 보인다"는 대개 차트가 아니라 받아둔 데이터의 문제다.
    화면에서 그걸 구분할 수 있어야 사용자가 다음에 뭘 할지 안다.
    """
    first, last, rows = db.query(
        func.min(PriceDaily.date), func.max(PriceDaily.date), func.count(PriceDaily.date)
    ).filter(PriceDaily.ticker == ticker).one()
    return HistoryCoverage(first_date=first, last_date=last, rows=rows or 0)


@router.get("/{ticker}", response_model=HistoryResponse)
def get_history(
    ticker: str,
    range: str = Query("1y", alias="range"),
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
):
    ticker = ticker.upper()
    if range not in RANGE_DAYS:
        raise HTTPException(status_code=400, detail=f"invalid range: {range}")
    # **내가 담은 종목의 차트만 연다.** 시세는 공용이지만 공용인 것은 저장과 수집이지
    # 열람 범위가 아니다 — 남이 담은 종목을 티커만 알면 열 수 있으면 "여기서 남들이
    # 뭘 보는지 들여다볼 수 있나"가 된다 (ROADMAP 4단계 7번).
    if find_user_stock(db, user_id, ticker) is None:
        raise HTTPException(status_code=404, detail="stock not found")

    query = db.query(PriceDaily).filter(PriceDaily.ticker == ticker)
    cutoff = None
    days = RANGE_DAYS[range]
    if days is not None:
        cutoff = dt.date.today() - dt.timedelta(days=days)
        query = query.filter(PriceDaily.date >= cutoff)
    prices = query.order_by(PriceDaily.date.asc()).all()

    # 차트에는 "시그널이 뜬 날"을 찍는다.
    #
    # 예전에는 매수 실행 기록(BuyExecution)을 찍었는데, 그 기록은 종목을 등록한 다음
    # 기간부터만 생긴다 (스펙: 과거 소급 없음). 그래서 매도 시그널은 히스토리 전체에
    # 깔리는데 매수는 한두 개뿐이거나 아예 없어, 차트만 보면 "매도밖에 없는 종목"처럼
    # 보였다. 둘 다 시그널 판정에서 가져오면 같은 기준으로 비교된다.
    signal_query = db.query(SignalDaily).filter(
        SignalDaily.ticker == ticker,
        (SignalDaily.knee_buy_v2.is_(True)) | (SignalDaily.shoulder_sell_ref.is_(True)),
    )
    if cutoff is not None:
        signal_query = signal_query.filter(SignalDaily.date >= cutoff)

    markers = []
    for row in signal_query.order_by(SignalDaily.date.asc()).all():
        if row.knee_buy_v2:
            markers.append(HistoryMarker(date=row.date, kind="buy"))
        if row.shoulder_sell_ref:
            markers.append(HistoryMarker(date=row.date, kind="sell"))

    return HistoryResponse(
        ticker=ticker,
        prices=[HistoryPoint(date=p.date, close=p.close) for p in prices],
        markers=markers,
        coverage=_coverage(db, ticker),
    )
