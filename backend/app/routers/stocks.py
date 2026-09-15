from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Stock
from app.schemas import StockCreate, StockOut, StockUpdate
from app.services import data_ingestion
from app.services.pipeline import refresh_and_evaluate_stock

router = APIRouter(prefix="/api/stocks", tags=["stocks"])


@router.get("", response_model=list[StockOut])
def list_stocks(db: Session = Depends(get_db)):
    return db.query(Stock).order_by(Stock.ticker.asc()).all()


@router.post("", response_model=StockOut)
def create_stock(payload: StockCreate, db: Session = Depends(get_db)):
    ticker = payload.ticker.upper().strip()
    if db.query(Stock).filter_by(ticker=ticker).first():
        raise HTTPException(status_code=409, detail=f"{ticker} already exists")

    stock = Stock(
        ticker=ticker,
        name=payload.name,
        dca_amount=payload.dca_amount,
        dca_period=payload.dca_period,
        rebalance_period=payload.rebalance_period,
        target_weight_pct=payload.target_weight_pct,
        rebalance_band_pct=payload.rebalance_band_pct,
        review_date_override=payload.review_date_override,
    )
    db.add(stock)
    db.commit()
    db.refresh(stock)

    try:
        refresh_and_evaluate_stock(db, stock, full_backfill=True)
    except data_ingestion.DataIngestionError:
        # 종목 등록 자체는 유지하고, 데이터 백필은 이후 수동 새로고침으로 재시도 가능
        pass

    return stock


@router.put("/{ticker}", response_model=StockOut)
def update_stock(ticker: str, payload: StockUpdate, db: Session = Depends(get_db)):
    stock = db.query(Stock).filter_by(ticker=ticker.upper()).first()
    if stock is None:
        raise HTTPException(status_code=404, detail="stock not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(stock, field, value)
    db.commit()
    db.refresh(stock)
    return stock


@router.delete("/{ticker}", response_model=StockOut)
def deactivate_stock(ticker: str, db: Session = Depends(get_db)):
    stock = db.query(Stock).filter_by(ticker=ticker.upper()).first()
    if stock is None:
        raise HTTPException(status_code=404, detail="stock not found")
    stock.active = False
    db.commit()
    db.refresh(stock)
    return stock


@router.post("/{ticker}/refresh")
def refresh_stock(ticker: str, db: Session = Depends(get_db)):
    stock = db.query(Stock).filter_by(ticker=ticker.upper()).first()
    if stock is None:
        raise HTTPException(status_code=404, detail="stock not found")
    try:
        result = refresh_and_evaluate_stock(db, stock, full_backfill=False)
    except data_ingestion.DataIngestionError as exc:
        raise HTTPException(status_code=502, detail=f"data refresh failed: {exc}") from exc
    return result
