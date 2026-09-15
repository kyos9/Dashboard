from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import BuyExecution
from app.schemas import ConfirmBuyRequest
from app.services.buy_workflow import confirm_buy_execution

router = APIRouter(prefix="/api/buy-executions", tags=["buy-executions"])


@router.post("/{buy_id}/confirm")
def confirm(buy_id: int, payload: ConfirmBuyRequest, db: Session = Depends(get_db)):
    buy = db.query(BuyExecution).filter_by(id=buy_id).first()
    if buy is None:
        raise HTTPException(status_code=404, detail="buy execution not found")
    confirmed = confirm_buy_execution(db, buy, apply_to_holding=payload.apply_to_holding)
    return {
        "id": confirmed.id,
        "ticker": confirmed.ticker,
        "status": confirmed.status,
        "confirmed_at": confirmed.confirmed_at,
    }
