"""재무 지표 — 차트 팝업의 "재무" 탭 (ROADMAP 3b)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import FundamentalsOut
from app.services import fundamentals
from app.services.users import current_user_id, find_user_stock

router = APIRouter(prefix="/api/fundamentals", tags=["fundamentals"])


@router.get("/{ticker}", response_model=FundamentalsOut)
def get_fundamentals(ticker: str, db: Session = Depends(get_db), user_id: int = Depends(current_user_id)):
    # 차트와 같다 — **내가 담은 종목만 연다** (history.py 참고)
    stock = find_user_stock(db, user_id, ticker.upper())
    if stock is None:
        raise HTTPException(status_code=404, detail="stock not found")
    return fundamentals.detail(db, stock.ticker, stock.currency)
