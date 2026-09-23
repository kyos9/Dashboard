import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.markets import Currency
from app.models import Holding, UserSettings, UserStock
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
from app.services import settings as settings_service
from app.services.users import current_user_id, find_user_stock, ordered_user_stocks

router = APIRouter(prefix="/api/rebalance", tags=["rebalance"])


def _get_stock_or_404(db: Session, user_id: int, ticker: str) -> UserStock:
    stock = find_user_stock(db, user_id, ticker.upper())
    if stock is None:
        raise HTTPException(status_code=404, detail="stock not found")
    return stock


@router.get("/targets", response_model=list[RebalanceTargetOut])
def list_targets(db: Session = Depends(get_db), user_id: int = Depends(current_user_id)):
    stocks = ordered_user_stocks(db, user_id)
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
def update_target(
    ticker: str,
    payload: RebalanceTargetUpdate,
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
):
    stock = _get_stock_or_404(db, user_id, ticker)
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
def list_holdings(db: Session = Depends(get_db), user_id: int = Depends(current_user_id)):
    stocks = ordered_user_stocks(db, user_id)
    holdings_by_ticker = {
        h.ticker: h for h in db.query(Holding).filter(Holding.user_id == user_id).all()
    }
    out = []
    for s in stocks:
        h = holdings_by_ticker.get(s.ticker)
        if h:
            out.append(HoldingOut(ticker=h.ticker, quantity=h.quantity, updated_at=h.updated_at))
        else:
            out.append(HoldingOut(ticker=s.ticker, quantity=0.0, updated_at=dt.datetime.utcnow()))
    return out


@router.put("/holdings/{ticker}", response_model=HoldingOut)
def update_holding(
    ticker: str,
    payload: HoldingUpdate,
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
):
    stock = _get_stock_or_404(db, user_id, ticker)
    holding = db.get(Holding, (stock.user_id, stock.ticker))
    if holding is None:
        holding = Holding(user_id=stock.user_id, ticker=stock.ticker, quantity=payload.quantity)
        db.add(holding)
    else:
        holding.quantity = payload.quantity
    holding.updated_at = dt.datetime.utcnow()
    db.commit()
    db.refresh(holding)
    return HoldingOut(ticker=holding.ticker, quantity=holding.quantity, updated_at=holding.updated_at)


def _settings_out(db: Session, settings: UserSettings) -> SettingsOut:
    return SettingsOut(
        default_rebalance_band_pct=settings.default_rebalance_band_pct,
        base_currency=fx_service.base_currency(db, settings.user_id),
        fx_overrides=settings.fx_overrides or {},
        fx=FxOut(**fx_service.get_rates(db, settings.user_id).to_dict()),
    )


@router.get("/settings", response_model=SettingsOut)
def get_settings(db: Session = Depends(get_db), user_id: int = Depends(current_user_id)):
    return _settings_out(db, settings_service.get_settings(db, user_id))


@router.put("/settings", response_model=SettingsOut)
def update_settings(
    payload: SettingsUpdate,
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
):
    settings = settings_service.get_settings(db, user_id)

    # 보낸 필드만 반영한다 — 밴드만 바꾸려다 기준통화가 초기화되면 안 되므로.
    changes = payload.model_dump(exclude_unset=True)
    if "default_rebalance_band_pct" in changes and changes["default_rebalance_band_pct"] is not None:
        settings.default_rebalance_band_pct = changes["default_rebalance_band_pct"]
    if "base_currency" in changes and changes["base_currency"] is not None:
        settings.base_currency = changes["base_currency"].value
    if "fx_overrides" in changes and changes["fx_overrides"] is not None:
        # 보낸 통화만 반영한다. 값이 null이면 그 통화만 자동 조회로 복귀.
        for code, value in changes["fx_overrides"].items():
            try:
                currency = Currency(str(code).upper())
            except ValueError:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "hint": f"{code} 는 다루지 않는 통화입니다.",
                        "message": f"unknown currency: {code}",
                    },
                )
            fx_service.set_override(db, user_id, currency, float(value) if value else None)

    db.commit()
    db.refresh(settings)
    return _settings_out(db, settings)


@router.post("/fx/refresh", response_model=FxOut)
def refresh_fx(db: Session = Depends(get_db), user_id: int = Depends(current_user_id)):
    """환율을 지금 다시 조회한다. 실패한 통화는 기존 값을 유지한 채 그대로 돌려준다.

    받아오는 것은 공용 환율이고, 돌려주는 것은 **누른 사람의 화면**이다 — 직접 넣은
    환율이 있으면 그게 그대로 얹혀 있어야 화면이 누르기 전과 같은 말을 한다.
    """
    fx_service.refresh_rates(db, force=True)
    return FxOut(**fx_service.get_rates(db, user_id).to_dict())


@router.get("/current", response_model=RebalanceCurrentOut)
def get_current(db: Session = Depends(get_db), user_id: int = Depends(current_user_id)):
    return RebalanceCurrentOut(**rebalance_service.compute_rebalance_current(db, user_id))
