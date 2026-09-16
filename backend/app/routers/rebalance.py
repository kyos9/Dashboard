import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Holding, PortfolioSettings, Stock, stock_order
from app.schemas import (
    FxOut,
    HoldingOut,
    HoldingUpdate,
    RebalanceCurrentOut,
    RebalanceTargetOut,
    RebalanceTargetUpdate,
    SettingsOut,
    SettingsUpdate,
)
from app.services import fx as fx_service
from app.services import rebalance as rebalance_service

router = APIRouter(prefix="/api/rebalance", tags=["rebalance"])


def _get_stock_or_404(db: Session, ticker: str) -> Stock:
    stock = db.query(Stock).filter_by(ticker=ticker.upper()).first()
    if stock is None:
        raise HTTPException(status_code=404, detail="stock not found")
    return stock


@router.get("/targets", response_model=list[RebalanceTargetOut])
def list_targets(db: Session = Depends(get_db)):
    stocks = db.query(Stock).order_by(*stock_order()).all()
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
    stocks = db.query(Stock).order_by(*stock_order()).all()
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


def _settings_out(db: Session, settings: PortfolioSettings) -> SettingsOut:
    return SettingsOut(
        default_rebalance_band_pct=settings.default_rebalance_band_pct,
        base_currency=fx_service.base_currency(db),
        usd_krw_override=settings.usd_krw_override,
        fx=FxOut(**fx_service.get_usd_krw(db).to_dict()),
    )


@router.get("/settings", response_model=SettingsOut)
def get_settings(db: Session = Depends(get_db)):
    settings = db.query(PortfolioSettings).first()
    if settings is None:
        settings = PortfolioSettings(id=1, default_rebalance_band_pct=5.0)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return _settings_out(db, settings)


@router.put("/settings", response_model=SettingsOut)
def update_settings(payload: SettingsUpdate, db: Session = Depends(get_db)):
    settings = db.query(PortfolioSettings).first()
    if settings is None:
        settings = PortfolioSettings(id=1)
        db.add(settings)

    # 보낸 필드만 반영한다 — 밴드만 바꾸려다 기준통화가 초기화되면 안 되므로.
    changes = payload.model_dump(exclude_unset=True)
    if "default_rebalance_band_pct" in changes and changes["default_rebalance_band_pct"] is not None:
        settings.default_rebalance_band_pct = changes["default_rebalance_band_pct"]
    if "base_currency" in changes and changes["base_currency"] is not None:
        settings.base_currency = changes["base_currency"].value
    if "usd_krw_override" in changes:
        # null을 명시하면 수동 환율 해제 (자동 조회값으로 복귀)
        value = changes["usd_krw_override"]
        settings.usd_krw_override = float(value) if value else None

    db.commit()
    db.refresh(settings)
    return _settings_out(db, settings)


@router.post("/fx/refresh", response_model=FxOut)
def refresh_fx(db: Session = Depends(get_db)):
    """원/달러 환율을 지금 다시 조회한다. 실패하면 기존 값을 유지한 채 그대로 돌려준다."""
    return FxOut(**fx_service.refresh_usd_krw(db, force=True).to_dict())


@router.get("/current", response_model=RebalanceCurrentOut)
def get_current(db: Session = Depends(get_db)):
    return RebalanceCurrentOut(**rebalance_service.compute_rebalance_current(db))
