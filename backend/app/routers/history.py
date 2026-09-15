import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import BuyExecution, BuyType, PriceDaily, SignalDaily, Stock
from app.schemas import HistoryMarker, HistoryPoint, HistoryResponse

router = APIRouter(prefix="/api/history", tags=["history"])

RANGE_DAYS = {"6mo": 182, "1y": 365, "5y": 365 * 5, "max": None}


@router.get("/{ticker}", response_model=HistoryResponse)
def get_history(ticker: str, range: str = Query("1y", alias="range"), db: Session = Depends(get_db)):
    ticker = ticker.upper()
    if range not in RANGE_DAYS:
        raise HTTPException(status_code=400, detail=f"invalid range: {range}")
    if not db.query(Stock).filter_by(ticker=ticker).first():
        raise HTTPException(status_code=404, detail="stock not found")

    query = db.query(PriceDaily).filter(PriceDaily.ticker == ticker)
    cutoff = None
    days = RANGE_DAYS[range]
    if days is not None:
        cutoff = dt.date.today() - dt.timedelta(days=days)
        query = query.filter(PriceDaily.date >= cutoff)
    prices = query.order_by(PriceDaily.date.asc()).all()

    buy_query = db.query(BuyExecution).filter(BuyExecution.ticker == ticker)
    if cutoff is not None:
        buy_query = buy_query.filter(BuyExecution.exec_date >= cutoff)
    buys = buy_query.all()

    signal_query = db.query(SignalDaily).filter(
        SignalDaily.ticker == ticker, SignalDaily.shoulder_sell_ref.is_(True)
    )
    if cutoff is not None:
        signal_query = signal_query.filter(SignalDaily.date >= cutoff)
    shoulder_signals = signal_query.all()

    markers = [
        HistoryMarker(
            date=b.exec_date,
            kind="buy_signal" if b.type == BuyType.signal else "buy_fallback",
            status=b.status,
        )
        for b in buys
    ] + [HistoryMarker(date=s.date, kind="shoulder_ref") for s in shoulder_signals]

    return HistoryResponse(
        ticker=ticker,
        prices=[HistoryPoint(date=p.date, close=p.close) for p in prices],
        markers=markers,
    )
