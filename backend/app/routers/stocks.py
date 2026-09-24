import logging
import time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, sessionmaker

from app.db import get_db
from app.markets import market_of_stock, normalize_ticker
from app.models import Holding, PriceDaily, User, UserStock
from app.schemas import (
    RefreshResult,
    StockCreate,
    StockCreateResult,
    StockOrderUpdate,
    StockOut,
    StockUpdate,
)
from app.services import backfill, data_ingestion, limits, symbols
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

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/stocks", tags=["stocks"])

# 한 사람이 담을 수 있는 종목 (비활성 포함). 한 사람이 200개를 넣으면 매일 갱신이 전원
# 몫으로 늘고 차단 위험도 같이 커진다 — 악의가 아니라 호기심으로도 일어난다.
# 관리자는 서버를 돌보는 사람이라 세지 않는다.
MAX_STOCKS_PER_USER = 30


def _is_owner(db: Session, user_id: int) -> bool:
    user = db.get(User, user_id)
    return user is not None and user.is_owner


def _has_prices(db: Session, ticker: str) -> bool:
    return db.query(PriceDaily.id).filter(PriceDaily.ticker == ticker).first() is not None


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
    return [_stock_out(stock) for stock in ordered_user_stocks(db, user_id)]


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


def _resolve_ticker(db: Session, raw: str, user_id: int) -> tuple[str, str | None, str | None]:
    """입력을 티커로 해석한다 -> (티커, 종목명, 원래 입력한 말).

    이미 티커면 그대로 쓰고, "삼성전자"처럼 이름이면 찾아준다. 확정할 수 없으면
    후보를 함께 담아 400으로 돌려보내 화면에서 고르게 한다 — 엉뚱한 종목코드를
    조용히 고르면 다른 회사의 시세를 받게 되므로 실패하는 편이 낫다.
    """
    typed = raw.strip()
    if not typed:
        raise HTTPException(status_code=400, detail={"hint": "종목명이나 티커를 입력해주세요.", "message": "empty ticker"})

    gate = symbols.search_gate(user_id)
    match = symbols.resolve(typed, db=db, network_gate=gate)
    if match is None:
        candidates = [m.to_dict() for m in symbols.search(typed, db=db, limit=5, network_gate=gate)]
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
    started = time.perf_counter()
    ticker, resolved_name, resolved_from = _resolve_ticker(db, payload.ticker, user_id)
    resolved_in = time.perf_counter() - started
    # **내 목록에** 이미 있을 때만 막는다. 남이 담은 종목을 내가 담는 건 당연히 된다.
    if find_user_stock(db, user_id, ticker):
        raise HTTPException(status_code=409, detail=f"{ticker} already exists")

    owner = _is_owner(db, user_id)
    if not owner and user_stocks(db, user_id).count() >= MAX_STOCKS_PER_USER:
        raise HTTPException(
            status_code=409,
            detail={
                "hint": (
                    f"종목은 {MAX_STOCKS_PER_USER}개까지 담을 수 있습니다 (비활성 포함). "
                    "쓰지 않는 종목을 삭제하고 다시 추가해 주세요."
                ),
                "message": "stock limit reached",
            },
        )
    # 아무도 받은 적 없는 종목은 전체 기간을 받아야 한다 — 외부 호출이 드는 건 이 경우뿐이라
    # 여기에만 하루 한도를 건다. 이미 누가 담은 종목은 몇 개든 공짜다.
    first_time = not _has_prices(db, ticker)
    if first_time and not owner and not limits.new_tickers.has_room(user_id):
        raise HTTPException(
            status_code=429,
            detail={
                "hint": (
                    f"처음 받는 종목(시세를 처음부터 받아야 하는 종목)은 하루 {limits.NEW_TICKERS_PER_DAY}개까지 "
                    "추가할 수 있습니다. 내일 다시 시도해 주세요."
                ),
                "message": "new ticker limit reached",
            },
        )

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

    download = _download_needed(db, stock)
    if download is None:
        _log_timing(ticker, resolved_in, None, 0.0)
        return StockCreateResult(
            stock=_stock_out(stock), data_loaded=True, resolved_from=resolved_from
        )

    if download == "full" and not owner:
        limits.new_tickers.allow(user_id)

    # 받는 건 뒤에서 — 서버에서는 전체 기간 받기+계산이 종목 하나에 10초를 넘긴다.
    # 요청 세션은 응답과 함께 닫히므로 뒤의 일은 같은 DB에 새 세션을 연다.
    session_factory = sessionmaker(bind=db.get_bind())
    backfill.start(
        stock.ticker,
        lambda: _load_in_background(session_factory, user_id, stock.ticker, resolved_in, download),
    )
    return StockCreateResult(
        stock=_stock_out(stock), data_loaded=False, data_pending=True, resolved_from=resolved_from
    )


def _load_in_background(session_factory, user_id: int, ticker: str, resolved_in: float, download: str) -> None:
    started = time.perf_counter()
    db = session_factory()
    try:
        stock = find_user_stock(db, user_id, ticker)
        if stock is None:  # 받기 전에 지웠다
            backfill.clear(ticker)
            return
        refresh_and_evaluate_stock(db, stock, full_backfill=download == "full")
        limits.refresh_cooldown.mark(ticker, ok=True)
    except data_ingestion.DataIngestionError as exc:
        limits.refresh_cooldown.mark(ticker, ok=False)
        _log_timing(ticker, resolved_in, download, time.perf_counter() - started, failed=True)
        detail = _failure_detail(exc)
        backfill.fail(ticker, hint=detail["hint"], error=detail["message"])
        return
    finally:
        db.close()
    _log_timing(ticker, resolved_in, download, time.perf_counter() - started)


def _stock_out(stock: UserStock) -> StockOut:
    """종목 + 시세를 뒤에서 받는 중인지 (화면이 다시 물을지 정한다)."""
    out = StockOut.model_validate(stock)
    found = backfill.status(stock.ticker)
    if found:
        out.data_status = found["state"]
        out.data_hint = found.get("hint")
    return out


def _log_timing(ticker: str, resolved_in: float, download: str | None, loaded_in: float, failed: bool = False) -> None:
    """등록이 느리다는 말이 나오면 어디서 걸렸는지 로그로 바로 보이게 (진단 화면 → 로그)."""
    what = {"full": "전체 기간 받기+계산", "recent": "최근분 받기+계산", None: "받을 것 없음"}[download]
    logger.info(
        "종목 등록 %s — 이름 찾기 %.1f초 · %s %.1f초%s",
        ticker, resolved_in, what, loaded_in, " (시세 실패)" if failed else "",
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
    """종목을 **내 목록에서** 빼고, 내 보유수량·평단가를 지운다. 되돌릴 수 없다.

    비활성화(`DELETE /{ticker}`)와 일부러 나눠뒀다. 대부분의 경우 원하는 건
    "화면에서 치우기"이고, 그때 보유수량까지 날리면 다시 넣었을 때 새로 적어야 한다.

    **시세·지표·시그널은 지우지 않는다** (ROADMAP 4-4b). 공용이라 남의 것이기도 하고,
    아무도 안 담은 종목이라도 남겨두면 누가 다시 담을 때 10년치를 새로 받지 않는다 —
    사람이 늘수록 새 종목 추가가 빨라진다. 아무도 안 보는 종목은 매일 받는 대상에서만
    빠진다 (`pipeline.watched`).

    리밸런싱 기록도 지우지 않는다 — 그날의 모습을 얼려둔 것이라 종목을 가리키지 않는다.
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
    db.commit()

    # "받는 중·못 받음" 표시는 티커마다 하나라 남이 담고 있으면 그 사람 화면의 표시다
    if db.query(UserStock).filter(UserStock.ticker == normalized).first() is None:
        backfill.clear(normalized)


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
    `full=true`면 처음 등록할 때처럼 전체 기간을 받는다. 차트에서 5년·전체를 눌렀는데
    앞부분이 비어 있을 때 쓴다.

    누구나 신청할 수 있게 되면서 둘을 막았다 (ROADMAP 4-4b · 6-1).

    - **`full=true` 는 관리자만.** 이 깃발 하나가 10년치를 통째로 다시 받는다. 단 **아직
      한 줄도 못 받은 종목**은 예외다 — 등록할 때 조회가 실패하면 종목만 남는데, 그걸 채울
      방법이 이 버튼뿐이다. 그때는 묻지 않고 전체 기간을 받는다.
    - **쿨다운은 사람이 아니라 종목에 건다** (`limits.refresh_cooldown`, 10분). 30명이 같은
      종목을 눌러도 실제 조회는 한 번이다. 쿨다운 중에는 거절하지 않고 언제 받았는지
      알려준다(`skipped`). 방금 실패했으면 1분 뒤에 다시 눌러 달라고 한다(429).
      관리자는 기다리지 않는다.
    """
    stock = find_user_stock(db, user_id, ticker.upper())
    if stock is None:
        raise HTTPException(status_code=404, detail="stock not found")

    owner = _is_owner(db, user_id)
    empty = not _has_prices(db, stock.ticker)
    if full and not owner and not empty:
        raise HTTPException(
            status_code=403,
            detail={
                "hint": "전체 기간 다시 받기는 관리자만 할 수 있습니다. 최근 시세는 '시세 갱신'으로 받을 수 있습니다.",
                "message": "full backfill is owner only",
            },
        )

    if not owner:
        waiting = limits.refresh_cooldown.check(stock.ticker)
        if waiting is not None:
            elapsed, left, ok = waiting
            if not ok:
                raise HTTPException(
                    status_code=429,
                    detail={
                        "hint": f"방금 받지 못했습니다. {left}초 뒤에 다시 눌러 주세요.",
                        "message": "retry cooldown",
                    },
                )
            return {
                "ticker": stock.ticker,
                "skipped": True,
                "hint": (
                    f"{limits.ago_label(elapsed)} 받았습니다. 같은 종목은 "
                    f"{limits.REFRESH_COOLDOWN_SECONDS // 60}분에 한 번 다시 받습니다."
                ),
            }

    try:
        result = refresh_and_evaluate_stock(db, stock, full_backfill=full or empty)
    except data_ingestion.DataIngestionError as exc:
        limits.refresh_cooldown.mark(stock.ticker, ok=False)
        raise HTTPException(status_code=502, detail=_failure_detail(exc)) from exc
    limits.refresh_cooldown.mark(stock.ticker, ok=True)
    backfill.clear(stock.ticker)  # 등록 때 실패했던 표시를 지운다
    return result
