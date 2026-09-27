"""AI 정리 — 사용자 본인 키로 (ROADMAP 3c, "B: 브라우저 보관 + 서버는 중계만").

키는 요청마다 `X-AI-Key` 헤더로 온다. **본문이 아니라 헤더인 이유:** 검증 오류(422)는
본문의 값을 그대로 되돌려 적는다. 헤더는 문자열 하나로만 받아 그런 일이 없다.
여기서는 키를 저장하지도, 로그에 남기지도, 응답에 싣지도 않는다 (`providers/ai.py`).

키가 있는 곳은 사용자의 브라우저뿐이다. 그 대가로 기기마다 한 번씩 넣어야 한다 (8-1).
"""

import threading
from enum import Enum

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from app.db import get_db
from app.schemas import AiAnalysisOut, AiAnalyzeIn, AiContextOut, AiModelsIn, AiModelsOut
from app.services import ai_analysis, limits
from app.services.providers import ai as providers
from app.services.users import current_user_id, find_user_stock

router = APIRouter(prefix="/api/ai", tags=["ai"])

KEY_HEADER = "X-AI-Key"


class AiScope(str, Enum):
    """종목 하나가 아닌 정리 (3c-2). 둘 다 공용 숫자만 — 보유·비중·평단가는 보내지 않는다."""

    watchlist = "watchlist"
    macro = "macro"


def _refuse(e: providers.AiError) -> HTTPException:
    return HTTPException(status_code=e.status, detail={"hint": e.hint, "message": e.message, "code": e.code})


def _too_many(hint: str) -> HTTPException:
    return HTTPException(status_code=429, detail={"hint": hint, "message": "rate limited", "code": "busy"})


def _my_stock(db: Session, user_id: int, ticker: str):
    # 차트·재무와 같다 — 내가 담은 종목만 (공용 시세라도 남이 담은 종목은 404)
    stock = find_user_stock(db, user_id, ticker.upper())
    if stock is None:
        raise HTTPException(status_code=404, detail="stock not found")
    return stock


@router.post("/models", response_model=AiModelsOut)
def list_models(
    payload: AiModelsIn,
    user_id: int = Depends(current_user_id),
    key: str | None = Header(default=None, alias=KEY_HEADER),
):
    """이 키로 쓸 수 있는 모델. 키 확인을 겸한다 (틀린 키면 여기서 걸린다)."""
    try:
        provider = providers.get(payload.provider)
        key = providers.check_key(key)
        if not limits.ai_model_lists.allow(user_id):
            raise _too_many("모델 목록은 1분에 몇 번까지만 부릅니다. 잠시 뒤 다시 해 보세요.")
        return {"provider": provider.name, "models": provider.list_models(key)}
    except providers.AiError as e:
        raise _refuse(e) from None


def _context(build, question: str | None) -> dict:
    try:
        return ai_analysis.preview(build, question)
    except providers.AiError as e:
        raise _refuse(e) from None


@router.get("/context/{ticker}", response_model=AiContextOut)
def get_context(
    ticker: str,
    question: str | None = None,
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
):
    """AI 에게 보내는 내용 그대로 (넣은 요청까지). 키가 없어도 볼 수 있다."""
    stock = _my_stock(db, user_id, ticker)
    return _context(lambda q: ai_analysis.stock_job(db, stock, q), question)


@router.get("/{scope}/context", response_model=AiContextOut)
def get_scope_context(
    scope: AiScope,
    question: str | None = None,
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
):
    """담은 종목 전체 · 매크로 정리에 보내는 내용 (3c-2)."""
    return _context(_scope_builder(db, user_id, scope), question)


def _scope_builder(db: Session, user_id: int, scope: "AiScope"):
    if scope == AiScope.watchlist:
        return lambda q: ai_analysis.watchlist_job(db, user_id, q)
    return lambda q: ai_analysis.macro_job(db, q)


def _check_request(payload: AiAnalyzeIn, key: str | None) -> None:
    """모양부터 본다 — 틀린 키로 한도를 깎거나 자리를 잡지 않게."""
    try:
        providers.get(payload.provider)
        providers.check_model(payload.model)
        providers.check_key(key)
        ai_analysis.check_question(payload.question)
    except providers.AiError as e:
        raise _refuse(e) from None


def _take_slot(user_id: int):
    """한 사람에 한 번에 하나, 서버 전체 몇 개. 비우는 함수를 돌려준다 (두 번 불려도 한 번만)."""
    refused = limits.ai_running.enter(user_id)
    if refused == "mine":
        raise _too_many("앞서 요청한 정리가 아직 진행 중입니다. 끝난 뒤 다시 해 보세요.")
    if refused == "full":
        raise _too_many("지금 다른 분들의 AI 정리가 많이 돌고 있습니다. 잠시 뒤 다시 해 보세요.")
    return _once(lambda: limits.ai_running.leave(user_id))


def _count(user_id: int) -> None:
    if not limits.ai_analyses.allow(user_id):
        raise _too_many(f"AI 정리는 1분에 {limits.AI_ANALYSES_PER_MINUTE}번까지입니다. 잠시 뒤 다시 해 보세요.")


def _analyze(db: Session, user_id: int, build, payload: AiAnalyzeIn, key: str | None) -> dict:
    _check_request(payload, key)
    leave = _take_slot(user_id)
    try:
        _count(user_id)
        return ai_analysis.analyze(db, build, payload.provider, payload.model, key or "", payload.question)
    except providers.AiError as e:
        raise _refuse(e) from None
    finally:
        leave()


def _stream(db: Session, user_id: int, build, payload: AiAnalyzeIn, key: str | None) -> StreamingResponse:
    """써지는 대로 흘려보낸다 (text/event-stream, 3c-2).

    **글을 보내기 전의 오류**(키·모델·한도·제공자가 거절)는 한 번에 받을 때와 똑같이 JSON 오류로
    돌려준다 — 제공자에 연결해 상태를 본 다음에야 흘려보내기 시작한다. 그 뒤의 오류는 `error`
    이벤트로 온다.

    **동시에 하나** 자리는 글이 끝날 때 비운다. 화면이 도중에 끊으면(닫기·멈추기) 그때 비우고
    제공자와의 연결도 닫는다 — 더 쓰게 두면 사용자의 요금만 나간다.
    """
    _check_request(payload, key)
    leave = _take_slot(user_id)
    try:
        _count(user_id)
        started = ai_analysis.start_stream(db, build, payload.provider, payload.model, key or "", payload.question)
    except providers.AiError as e:
        leave()
        raise _refuse(e) from None
    except BaseException:
        leave()
        raise

    def closed() -> None:
        started.stream.close()
        leave()

    return StreamingResponse(
        ai_analysis.sse_body(started, leave),
        media_type="text/event-stream",
        # 중간(프록시·브라우저)이 모아 두지 말고 바로 넘기게
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        background=BackgroundTask(closed),
    )


def _once(action):
    """두 번 불려도 한 번만 — 다 쓴 때와 화면이 끊은 때가 둘 다 자리를 비우려 한다."""
    lock = threading.Lock()
    done = False

    def run() -> None:
        nonlocal done
        with lock:
            if done:
                return
            done = True
        action()

    return run


@router.post("/analyze/{ticker}", response_model=AiAnalysisOut)
def analyze(
    ticker: str,
    payload: AiAnalyzeIn,
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
    key: str | None = Header(default=None, alias=KEY_HEADER),
):
    """한 번에 받기. 화면은 `/stream` 을 쓴다 — 이쪽은 흘려받기를 못 하는 곳(스크립트·확인)용."""
    stock = _my_stock(db, user_id, ticker)
    return _analyze(db, user_id, lambda q: ai_analysis.stock_job(db, stock, q), payload, key)


@router.post("/analyze/{ticker}/stream")
def analyze_stream(
    ticker: str,
    payload: AiAnalyzeIn,
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
    key: str | None = Header(default=None, alias=KEY_HEADER),
):
    stock = _my_stock(db, user_id, ticker)
    return _stream(db, user_id, lambda q: ai_analysis.stock_job(db, stock, q), payload, key)


@router.post("/{scope}/stream")
def scope_stream(
    scope: AiScope,
    payload: AiAnalyzeIn,
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
    key: str | None = Header(default=None, alias=KEY_HEADER),
):
    """담은 종목 전체 · 매크로 정리 (3c-2). 한도·자리는 종목 정리와 같이 센다."""
    return _stream(db, user_id, _scope_builder(db, user_id, scope), payload, key)
