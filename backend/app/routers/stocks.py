from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.markets import normalize_ticker
from app.models import Stock
from app.schemas import RefreshResult, StockCreate, StockCreateResult, StockOut, StockUpdate
from app.services import data_ingestion, symbols
from app.services.pipeline import refresh_all_active_stocks, refresh_and_evaluate_stock

router = APIRouter(prefix="/api/stocks", tags=["stocks"])


def _failure_detail(exc: data_ingestion.DataIngestionError) -> dict:
    """실패 원인과 다음에 할 일을 나눠서 돌려준다.

    예전에는 "no data returned for VOO"만 줘서 네트워크 문제인지 티커 오타인지 구분할 수
    없었다. `hint`는 사용자가 바로 읽을 안내, `message`는 제공자별 기술적 원인이라
    화면에서 접어둘 수 있다.
    """
    return {
        "hint": getattr(exc, "hint", "") or "잠시 후 다시 시도해주세요.",
        "message": str(exc),
    }


@router.get("", response_model=list[StockOut])
def list_stocks(db: Session = Depends(get_db)):
    return db.query(Stock).order_by(Stock.ticker.asc()).all()


def _resolve_ticker(db: Session, raw: str) -> tuple[str, str | None, str | None]:
    """입력을 티커로 해석한다 -> (티커, 종목명, 원래 입력한 말).

    이미 티커면 그대로 쓰고, "삼성전자"처럼 이름이면 찾아준다. 확정할 수 없으면
    후보를 함께 담아 400으로 돌려보내 화면에서 고르게 한다 — 엉뚱한 종목코드를
    조용히 고르면 다른 회사의 시세를 받게 되므로 실패하는 편이 낫다.
    """
    typed = raw.strip()
    if not typed:
        raise HTTPException(status_code=400, detail={"hint": "종목명이나 티커를 입력해주세요.", "message": "empty ticker"})

    match = symbols.resolve(typed, db=db)
    if match is None:
        candidates = [m.to_dict() for m in symbols.search(typed, db=db, limit=5)]
        raise HTTPException(
            status_code=400,
            detail={
                "hint": (
                    f"'{typed}'에 해당하는 종목을 찾지 못했습니다. "
                    "국내주식은 종목명(삼성전자)이나 종목코드(005930), "
                    "해외주식은 티커(VOO)로 입력해주세요."
                ),
                "message": f"could not resolve {typed!r}",
                "candidates": candidates,
            },
        )

    resolved_from = None if normalize_ticker(typed) == match.ticker else typed
    return match.ticker, match.name, resolved_from


@router.post("", response_model=StockCreateResult)
def create_stock(payload: StockCreate, db: Session = Depends(get_db)):
    ticker, resolved_name, resolved_from = _resolve_ticker(db, payload.ticker)
    if db.query(Stock).filter_by(ticker=ticker).first():
        raise HTTPException(status_code=409, detail=f"{ticker} already exists")

    # 사용자가 이름을 직접 적었으면 그 값을 존중하고, 아니면 해석된 종목명을 쓴다
    name = payload.name or (resolved_name if resolved_name != ticker else None)

    # 시장/통화는 Stock이 티커에서 직접 채운다 (models.Stock._sync_market_and_currency)
    stock = Stock(
        ticker=ticker,
        name=name,
        category=payload.category,
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
    except data_ingestion.DataIngestionError as exc:
        # 종목 등록 자체는 유지하고, 데이터 백필은 이후 수동 새로고침으로 재시도 가능
        detail = _failure_detail(exc)
        return StockCreateResult(
            stock=StockOut.model_validate(stock),
            data_loaded=False,
            data_error=detail["message"],
            data_hint=detail["hint"],
            resolved_from=resolved_from,
        )

    return StockCreateResult(
        stock=StockOut.model_validate(stock), data_loaded=True, resolved_from=resolved_from
    )


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


@router.post("/refresh-all", response_model=list[RefreshResult])
def refresh_all_stocks(db: Session = Depends(get_db)):
    """활성 종목 전체를 한 번에 갱신한다. 일부 종목이 실패해도 나머지는 계속 진행한다."""
    results = refresh_all_active_stocks(db)
    return [
        RefreshResult(
            ticker=r["ticker"],
            ok="error" not in r,
            rows_upserted=r.get("rows_upserted"),
            error=r.get("error"),
            hint=r.get("hint"),
        )
        for r in results
    ]


@router.post("/{ticker}/refresh")
def refresh_stock(ticker: str, db: Session = Depends(get_db)):
    stock = db.query(Stock).filter_by(ticker=ticker.upper()).first()
    if stock is None:
        raise HTTPException(status_code=404, detail="stock not found")
    try:
        result = refresh_and_evaluate_stock(db, stock, full_backfill=False)
    except data_ingestion.DataIngestionError as exc:
        raise HTTPException(status_code=502, detail=_failure_detail(exc)) from exc
    return result
