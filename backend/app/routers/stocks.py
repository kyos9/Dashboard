from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.markets import market_of_stock, normalize_ticker
from app.models import (
    Holding,
    IndicatorDaily,
    Instrument,
    PriceDaily,
    SignalDaily,
    UserStock,
)
from app.schemas import (
    RefreshResult,
    StockCreate,
    StockCreateResult,
    StockOrderUpdate,
    StockOut,
    StockUpdate,
)
from app.services import data_ingestion, symbols
from app.services.instruments import ensure_instrument
from app.services.pipeline import refresh_all_active_stocks, refresh_and_evaluate_stock
from app.services.trading_calendar import last_closed_trading_day
from app.services.users import (
    current_user_id,
    find_user_stock,
    ordered_user_stocks,
    require_owner,
    user_stocks,
)

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
def list_stocks(db: Session = Depends(get_db), user_id: int = Depends(current_user_id)):
    return ordered_user_stocks(db, user_id)


@router.put("/order", response_model=list[StockOut])
def update_stock_order(
    payload: StockOrderUpdate,
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
):
    """화면에 보여줄 순서를 저장한다. 받은 목록의 차례가 곧 순서다.

    목록에 없는 종목은 건드리지 않고 뒤로 밀린다 — 비활성 종목까지 매번 보내게
    하면 화면이 모르는 사이에 순서를 덮어쓸 수 있다.
    """
    wanted = [normalize_ticker(t) for t in payload.tickers]
    by_ticker = {s.ticker: s for s in user_stocks(db, user_id).all()}

    unknown = [t for t in wanted if t not in by_ticker]
    if unknown:
        raise HTTPException(status_code=404, detail=f"등록되지 않은 종목: {', '.join(unknown)}")

    for position, ticker in enumerate(wanted):
        by_ticker[ticker].sort_order = position
    # 목록에 없던 종목은 뒤로 (순서를 정한 적 없는 종목이 중간에 끼지 않게)
    for stock in by_ticker.values():
        if stock.ticker not in wanted:
            stock.sort_order = len(wanted)
    db.commit()
    return ordered_user_stocks(db, user_id)


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


def _download_needed(db: Session, stock: UserStock) -> str | None:
    """등록할 때 시세를 얼마나 받아야 하나 -> "full"(전체 기간), "recent"(최근분), None(안 받음).

    시세는 종목마다 공용이다. 남이 이미 담았거나 예전에 담았다 뺀 종목은 수십 년치가
    이미 저장돼 있는데, 예전에는 그래도 **전체 기간을 처음부터 다시 받았다** — 등록이
    오래 걸린 가장 큰 이유였다. 저장된 게 있으면 빠진 최근분만 받고, 마지막 거래일까지
    이미 있으면 아예 받지 않는다.
    """
    latest = db.query(func.max(PriceDaily.date)).filter(PriceDaily.ticker == stock.ticker).scalar()
    if latest is None:
        return "full"
    expected = last_closed_trading_day(market_of_stock(stock))
    if expected is not None and latest >= expected:
        return None
    return "recent"


@router.post("", response_model=StockCreateResult)
def create_stock(
    payload: StockCreate,
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
):
    ticker, resolved_name, resolved_from = _resolve_ticker(db, payload.ticker)
    # **내 목록에** 이미 있을 때만 막는다. 남이 담은 종목을 내가 담는 건 당연히 된다.
    if find_user_stock(db, user_id, ticker):
        raise HTTPException(status_code=409, detail=f"{ticker} already exists")

    # 해석된 종목명은 공용 행에, 화면에 보일 이름은 내 행에 둔다.
    # 사용자가 이름을 직접 적었으면 그 값을 존중하고, 아니면 해석된 종목명을 쓴다.
    official_name = resolved_name if resolved_name != ticker else None
    name = payload.name or official_name

    # 시장/통화는 공용 행이 티커에서 직접 채운다 (models.Instrument._sync_market_and_currency)
    instrument = ensure_instrument(db, ticker, name=official_name)
    stock = UserStock(
        user_id=user_id,
        ticker=instrument.ticker,
        instrument=instrument,
        name=name,
        category=payload.category,
        target_weight_pct=payload.target_weight_pct,
        rebalance_band_pct=payload.rebalance_band_pct,
    )
    db.add(stock)
    # 이미 들고 있는 종목이면 수량·평단가를 같이 받는다 — 등록하고 리밸런싱 탭으로 가서
    # 한 번 더 적게 하면, 대개 그 두 번째를 잊고 비중이 0%로 보인다.
    if payload.quantity or payload.avg_cost is not None:
        db.flush()
        db.add(
            Holding(
                user_id=user_id,
                ticker=stock.ticker,
                quantity=payload.quantity or 0.0,
                avg_cost=payload.avg_cost,
            )
        )
    db.commit()
    db.refresh(stock)

    try:
        download = _download_needed(db, stock)
        if download is not None:
            refresh_and_evaluate_stock(db, stock, full_backfill=download == "full")
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
def update_stock(
    ticker: str,
    payload: StockUpdate,
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
):
    stock = find_user_stock(db, user_id, ticker.upper())
    if stock is None:
        raise HTTPException(status_code=404, detail="stock not found")

    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes:
        # 화면에 보여줄 이름은 사용자가 고쳐 쓸 수 있다 — 야후가 주는 이름은
        # 일본·미국 종목에서 영문이라, 한글로 부르고 싶으면 여기서 바꾼다.
        # 비우면 이름을 지운 것으로 보고 티커로 되돌아간다.
        cleaned = (changes["name"] or "").strip()
        changes["name"] = cleaned or None

    for field, value in changes.items():
        setattr(stock, field, value)
    db.commit()
    db.refresh(stock)
    return stock


@router.delete("/{ticker}", response_model=StockOut)
def deactivate_stock(
    ticker: str, db: Session = Depends(get_db), user_id: int = Depends(current_user_id)
):
    stock = find_user_stock(db, user_id, ticker.upper())
    if stock is None:
        raise HTTPException(status_code=404, detail="stock not found")
    stock.active = False
    db.commit()
    db.refresh(stock)
    return stock


@router.delete("/{ticker}/purge", status_code=204)
def purge_stock(
    ticker: str, db: Session = Depends(get_db), user_id: int = Depends(current_user_id)
):
    """종목과 그 종목에 딸린 기록을 전부 지운다. 되돌릴 수 없다.

    비활성화(`DELETE /{ticker}`)와 일부러 나눠뒀다. 대부분의 경우 원하는 건
    "화면에서 치우기"이고, 그때 시세·지표·보유수량까지 날리면 나중에 다시 넣었을 때
    전부 새로 받아야 한다. 정말 지우려는 사람만 이 경로로 오게 한다.

    리밸런싱 기록은 지우지 않는다 — 그날의 모습을 얼려둔 것이라 종목을 가리키지 않는다.
    """
    normalized = normalize_ticker(ticker)
    stock = find_user_stock(db, user_id, normalized)
    if stock is None:
        raise HTTPException(status_code=404, detail="stock not found")

    # 내 보유가 내 종목 행을 가리키므로 먼저 지운다
    db.query(Holding).filter(
        Holding.user_id == stock.user_id, Holding.ticker == normalized
    ).delete(synchronize_session=False)
    db.delete(stock)

    # 시세·지표·시그널은 공용이다. 지금은 사람이 한 명이라 예전처럼 같이 지우되,
    # **아무도 안 담은 종목일 때만** 지운다 — 남이 담은 종목의 시세를 지우면 그 사람의
    # 화면이 비는 것이다. (사람이 늘면 이 자리는 "내 목록에서만 뺀다"로 바뀐다: 4-4)
    db.flush()
    if db.query(UserStock).filter(UserStock.ticker == normalized).first() is None:
        for model in (PriceDaily, IndicatorDaily, SignalDaily):
            db.query(model).filter(model.ticker == normalized).delete(synchronize_session=False)
        db.query(Instrument).filter(Instrument.ticker == normalized).delete(
            synchronize_session=False
        )
    db.commit()


@router.post("/refresh-all", response_model=list[RefreshResult], dependencies=[Depends(require_owner)])
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
def refresh_stock(
    ticker: str,
    full: bool = False,
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
):
    """이 종목의 시세를 다시 받는다.

    평소 갱신은 최근 2년만 받는다 — 매일 돌리는 일에 10년치를 매번 내려받을 이유가 없다.
    `full=true`면 처음 등록할 때처럼 전체 기간을 받는다. 등록 시점에 시세를 못 받았거나
    (그때는 기록이 비어 있다) 차트에서 5년·전체를 눌렀는데 앞부분이 비어 있을 때 쓴다 —
    이 경로가 없으면 등록 이후로는 2년보다 앞선 시세를 채울 방법이 아예 없었다.
    """
    stock = find_user_stock(db, user_id, ticker.upper())
    if stock is None:
        raise HTTPException(status_code=404, detail="stock not found")
    try:
        result = refresh_and_evaluate_stock(db, stock, full_backfill=full)
    except data_ingestion.DataIngestionError as exc:
        raise HTTPException(status_code=502, detail=_failure_detail(exc)) from exc
    return result
