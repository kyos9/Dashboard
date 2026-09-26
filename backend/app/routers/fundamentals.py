"""재무 지표 — 상단 "재무" 화면과 차트 팝업의 "재무" 탭 (ROADMAP 3b)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import FundamentalsOut
from app.services import fundamentals
from app.services.users import current_user_id, find_user_stock, ordered_user_stocks

router = APIRouter(prefix="/api/fundamentals", tags=["fundamentals"])


@router.get("", response_model=list[FundamentalsOut])
def list_fundamentals(db: Session = Depends(get_db), user_id: int = Depends(current_user_id)):
    """담은 종목(치우지 않은 것) 전부, 대시보드와 같은 순서로."""
    return fundamentals.overview(db, ordered_user_stocks(db, user_id, active_only=True))


@router.get("/{ticker}", response_model=FundamentalsOut)
def get_fundamentals(ticker: str, db: Session = Depends(get_db), user_id: int = Depends(current_user_id)):
    # 차트와 같다 — **내가 담은 종목만 연다** (history.py 참고)
    stock = find_user_stock(db, user_id, ticker.upper())
    if stock is None:
        raise HTTPException(status_code=404, detail="stock not found")
    return {**fundamentals.detail(db, stock.ticker, stock.currency), "name": stock.name,
            "category": stock.category}
