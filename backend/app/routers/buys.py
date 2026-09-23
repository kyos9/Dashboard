from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import BuyExecution
from app.schemas import ConfirmBuyRequest
from app.services.buy_workflow import confirm_buy_execution
from app.services.users import current_user_id

router = APIRouter(prefix="/api/buy-executions", tags=["buy-executions"])


@router.post("/{buy_id}/confirm")
def confirm(
    buy_id: int,
    payload: ConfirmBuyRequest,
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
):
    # 번호는 전원이 같이 쓰는 일련번호라 짐작할 수 있다. 번호만으로 찾으면 남의 매수를
    # 내가 확정하고, 그 수량이 **남의 보유수량에** 더해진다.
    buy = db.query(BuyExecution).filter_by(id=buy_id, user_id=user_id).first()
    if buy is None:
        raise HTTPException(status_code=404, detail="buy execution not found")
    confirmed = confirm_buy_execution(db, buy, apply_to_holding=payload.apply_to_holding)
    return {
        "id": confirmed.id,
        "ticker": confirmed.ticker,
        "status": confirmed.status,
        "confirmed_at": confirmed.confirmed_at,
    }
