"""AI 정리 — 사용자 본인 키로 (ROADMAP 3c, "B: 브라우저 보관 + 서버는 중계만").

키는 요청마다 `X-AI-Key` 헤더로 온다. **본문이 아니라 헤더인 이유:** 검증 오류(422)는
본문의 값을 그대로 되돌려 적는다. 헤더는 문자열 하나로만 받아 그런 일이 없다.
여기서는 키를 저장하지도, 로그에 남기지도, 응답에 싣지도 않는다 (`providers/ai.py`).

키가 있는 곳은 사용자의 브라우저뿐이다. 그 대가로 기기마다 한 번씩 넣어야 한다 (8-1).
"""

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import AiAnalysisOut, AiAnalyzeIn, AiContextOut, AiModelsIn, AiModelsOut
from app.services import ai_analysis, limits
from app.services.providers import ai as providers
from app.services.users import current_user_id, find_user_stock

router = APIRouter(prefix="/api/ai", tags=["ai"])

KEY_HEADER = "X-AI-Key"


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


@router.get("/context/{ticker}", response_model=AiContextOut)
def get_context(ticker: str, db: Session = Depends(get_db), user_id: int = Depends(current_user_id)):
    """AI 에게 보내는 내용 그대로. 키가 없어도 볼 수 있다."""
    return ai_analysis.preview(db, _my_stock(db, user_id, ticker))


@router.post("/analyze/{ticker}", response_model=AiAnalysisOut)
def analyze(
    ticker: str,
    payload: AiAnalyzeIn,
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
    key: str | None = Header(default=None, alias=KEY_HEADER),
):
    stock = _my_stock(db, user_id, ticker)
    try:
        # 모양부터 본다 — 틀린 키로 한도를 깎거나 자리를 잡지 않게
        providers.get(payload.provider)
        providers.check_model(payload.model)
        providers.check_key(key)
    except providers.AiError as e:
        raise _refuse(e) from None

    refused = limits.ai_running.enter(user_id)
    if refused == "mine":
        raise _too_many("앞서 요청한 정리가 아직 진행 중입니다. 끝난 뒤 다시 해 보세요.")
    if refused == "full":
        raise _too_many("지금 다른 분들의 AI 정리가 많이 돌고 있습니다. 잠시 뒤 다시 해 보세요.")
    try:
        if not limits.ai_analyses.allow(user_id):
            raise _too_many(
                f"AI 정리는 1분에 {limits.AI_ANALYSES_PER_MINUTE}번까지입니다. 잠시 뒤 다시 해 보세요."
            )
        return ai_analysis.analyze(db, stock, payload.provider, payload.model, key or "")
    except providers.AiError as e:
        raise _refuse(e) from None
    finally:
        limits.ai_running.leave(user_id)
