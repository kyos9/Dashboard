import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Holding, PortfolioSettings, Stock
from app.schemas import (
    HoldingOut,
    HoldingUpdate,
    RebalanceRow,
    RebalanceTargetOut,
    RebalanceTargetUpdate,
    SettingsOut,
    SettingsUpdate,
)
from app.services import rebalance as rebalance_service

router = APIRouter(prefix="/api/rebalance", tags=["rebalance"])


def _get_stock_or_404(db: Session, ticker: str) -> Stock:
    stock = db.query(Stock).filter_by(ticker=ticker.upper()).first()
    if stock is None:
        raise HTTPException(status_code=404, detail="stock not found")
    return stock


@router.get("/targets", response_model=list[RebalanceTargetOut])
def list_targets(db: Session = Depends(get_db)):
    stocks = db.query(Stock).order_by(Stock.ticker.asc()).all()
    return [
        RebalanceTargetOut(
            ticker=s.ticker,
            target_weight_pct=s.target_weight_pct,
            rebalance_band_pct=s.rebalance_band_pct,
            rebalance_period=s.rebalance_period,
            review_date_override=s.review_date_override,
        )
        for s in stocks
    ]


@router.put("/targets/{ticker}", response_model=RebalanceTargetOut)
def update_target(ticker: str, payload: RebalanceTargetUpdate, db: Session = Depends(get_db)):
    stock = _get_stock_or_404(db, ticker)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(stock, field, value)
    db.commit()
    db.refresh(stock)
    return RebalanceTargetOut(
        ticker=stock.ticker,
        target_weight_pct=stock.target_weight_pct,
        rebalance_band_pct=stock.rebalance_band_pct,
        rebalance_period=stock.rebalance_period,
        review_date_override=stock.review_date_override,
    )


@router.get("/holdings", response_model=list[HoldingOut])
def list_holdings(db: Session = Depends(get_db)):
    stocks = db.query(Stock).order_by(Stock.ticker.asc()).all()
    holdings_by_ticker = {h.ticker: h for h in db.query(Holding).all()}
    out = []
    for s in stocks:
        h = holdings_by_ticker.get(s.ticker)
        if h:
            out.append(HoldingOut(ticker=h.ticker, quantity=h.quantity, updated_at=h.updated_at))
        else:
            out.append(HoldingOut(ticker=s.ticker, quantity=0.0, updated_at=dt.datetime.utcnow()))
    return out


@router.put("/holdings/{ticker}", response_model=HoldingOut)
def update_holding(ticker: str, payload: HoldingUpdate, db: Session = Depends(get_db)):
    stock = _get_stock_or_404(db, ticker)
    holding = db.query(Holding).filter_by(ticker=stock.ticker).first()
    if holding is None:
        holding = Holding(ticker=stock.ticker, quantity=payload.quantity)
        db.add(holding)
    else:
        holding.quantity = payload.quantity
    holding.updated_at = dt.datetime.utcnow()
    db.commit()
    db.refresh(holding)
    return HoldingOut(ticker=holding.ticker, quantity=holding.quantity, updated_at=holding.updated_at)


@router.get("/settings", response_model=SettingsOut)
def get_settings(db: Session = Depends(get_db)):
    settings = db.query(PortfolioSettings).first()
    if settings is None:
        settings = PortfolioSettings(id=1, default_rebalance_band_pct=5.0)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return SettingsOut(default_rebalance_band_pct=settings.default_rebalance_band_pct)


@router.put("/settings", response_model=SettingsOut)
def update_settings(payload: SettingsUpdate, db: Session = Depends(get_db)):
    settings = db.query(PortfolioSettings).first()
    if settings is None:
        settings = PortfolioSettings(id=1)
        db.add(settings)
    settings.default_rebalance_band_pct = payload.default_rebalance_band_pct
    db.commit()
    db.refresh(settings)
    return SettingsOut(default_rebalance_band_pct=settings.default_rebalance_band_pct)


@router.get("/current", response_model=list[RebalanceRow])
def get_current(db: Session = Depends(get_db)):
    rows = rebalance_service.compute_rebalance_current(db)
    return [RebalanceRow(**row) for row in rows]
