"""종목 검색 — 이름으로 티커 찾기.

화면에서 "삼성전자"를 입력하면 후보를 보여주고 사용자가 고르게 한다. 서버가 임의로
하나를 고르지 않는 이유는 종목코드를 잘못 짚으면 다른 회사의 시세를 받아오기 때문이다.
"""

import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import SymbolMatchOut
from app.services import symbols
from app.services.users import current_user_id, require_owner

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/symbols", tags=["symbols"])


@router.get("/search", response_model=list[SymbolMatchOut])
def search_symbols(
    q: str = Query(..., min_length=1, description="종목명, 종목코드 또는 티커"),
    limit: int = Query(10, ge=1, le=30),
    db: Session = Depends(get_db),
    user_id: int = Depends(current_user_id),
):
    # 로컬에서 못 찾아 바깥에 묻는 것은 사람마다 분당 몇 번까지 (symbols.search_gate)
    matches = symbols.search(q, db=db, limit=limit, network_gate=symbols.search_gate(user_id))
    return [SymbolMatchOut(**match.to_dict()) for match in matches]


@router.get("/listing-status")
def listing_status(db: Session = Depends(get_db)):
    """지금 몇 종목이 검색 가능한지 — 내장 목록만인지, 거래소 목록까지 받았는지."""
    return symbols.listing_status(db)


@router.post("/refresh-listing", dependencies=[Depends(require_owner)])
def refresh_listing(db: Session = Depends(get_db)):
    """국내 상장목록(네이버, 안 되면 한국거래소)을 다시 받아 캐시한다.

    실패해도 번들 시드로 검색은 계속 되므로 500이 아니라 실패 사유를 담아 200으로
    돌려준다 — 화면에서 "갱신은 실패했지만 검색은 된다"고 안내할 수 있게.
    """
    try:
        count = symbols.refresh_krx_listing(db)
        return {"ok": True, "count": count}
    except Exception as exc:
        logger.warning("KRX 상장목록 갱신 실패: %s", exc)
        return {
            "ok": False,
            "count": 0,
            "error": str(exc),
            "hint": (
                "국내 상장목록을 받지 못했습니다. 네트워크가 막혀 있어도 "
                "주요 종목은 내장 목록으로 검색됩니다."
            ),
        }
