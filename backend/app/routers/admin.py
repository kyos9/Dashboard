"""관리자 — 사용자 목록과 가입 승인 (ROADMAP 4-4b).

예전에는 들어올 사람을 `.env` 의 허용목록으로 정해, 사람을 받을 때마다 파일을 고치고
서버를 다시 띄워야 했다. 이제 누구나 구글로 신청하고(승인 대기), 관리자가 여기서
승인·거절·차단한다.

**전부 관리자 전용이다** (`require_owner`). 이 목록에는 다른 사람의 이메일이 있다.
"""

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User, UserStock
from app.services import app_settings, pipeline
from app.services.users import (
    STATUS_ACTIVE,
    STATUS_BLOCKED,
    STATUS_PENDING,
    STATUS_REJECTED,
    require_owner,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_owner)])

# 목록에서 먼저 보여줄 순서 — 할 일(승인 대기)이 맨 위
_ORDER = {STATUS_PENDING: 0, STATUS_ACTIVE: 1, STATUS_BLOCKED: 2, STATUS_REJECTED: 3}


class StatusChange(BaseModel):
    # 승인 대기로 되돌리는 것은 뜻이 없다 — 받을지 말지는 셋 중 하나다
    status: Literal["active", "rejected", "blocked"]


def _row(user: User, stock_count: int, dormant: bool = False) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "status": user.status,
        "is_owner": user.is_owner,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
        "stock_count": stock_count,
        # 반년 넘게 안 들어와 이 사람만 담은 종목은 매일 받지 않는다 (`pipeline.in_use`)
        "dormant": dormant,
    }


def _stock_counts(db: Session) -> dict[int, int]:
    rows = db.query(UserStock.user_id, func.count(UserStock.ticker)).group_by(UserStock.user_id)
    return {user_id: count for user_id, count in rows}


@router.get("/users")
def list_users(db: Session = Depends(get_db)) -> list[dict]:
    """모든 사용자 — 승인 대기가 맨 위, 그다음 최근에 들어온 순."""
    counts = _stock_counts(db)
    users = db.query(User).all()
    users.sort(key=lambda u: (_ORDER.get(u.status, 9), -(u.created_at.timestamp() if u.created_at else 0)))
    return [_row(user, counts.get(user.id, 0), pipeline.is_dormant(db, user)) for user in users]


@router.put("/users/{user_id}/status")
def change_status(user_id: int, payload: StatusChange, db: Session = Depends(get_db)) -> dict:
    """승인(`active`)·거절(`rejected`)·차단(`blocked`).

    **관리자 계정은 바꿀 수 없다.** 스스로를 차단하면 공용 데이터를 돌볼 사람이 없어지고,
    되돌릴 화면도 같이 잠긴다.

    거절·차단하면 그 사람의 쪽지를 전부 무효로 만든다(epoch 를 올린다) — 상태만 바꿔도
    문지기가 막지만, 쪽지를 살려 두면 다시 승인하는 순간 예전 쪽지가 되살아난다.
    내 종목·보유 같은 기록은 지우지 않는다. 다시 승인하면 그대로 돌아온다.
    """
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail={"hint": "없는 사용자입니다.", "message": "user not found"})
    if user.is_owner:
        raise HTTPException(
            status_code=403,
            detail={"hint": "관리자 계정은 바꿀 수 없습니다.", "message": "cannot change the owner"},
        )

    if user.status != payload.status:
        if payload.status != STATUS_ACTIVE:
            user.session_epoch += 1
        user.status = payload.status
        db.commit()
        logger.info("사용자 %s 상태를 %s(으)로 바꿨습니다", user.id, payload.status)
    return _row(user, _stock_counts(db).get(user.id, 0), pipeline.is_dormant(db, user))


# ---------------------------------------------------------------------------
#  앱 설정 (9-15) — 서버를 다시 띄우지 않고 켜고 끄는 것
# ---------------------------------------------------------------------------


class SettingsChange(BaseModel):
    # 사용자 계정에도 AI 포트폴리오 진단·종목 분석을 열까
    ai_advice_for_users: bool


def _settings(db: Session) -> dict:
    return {"ai_advice_for_users": app_settings.ai_advice_open(db)}


@router.get("/settings")
def get_settings(db: Session = Depends(get_db)) -> dict:
    return _settings(db)


@router.put("/settings")
def change_settings(payload: SettingsChange, db: Session = Depends(get_db)) -> dict:
    """닫으면 사용자의 다음 진단·분석 요청부터 403 이다. 이미 받아 둔 글은 그 사람의 기기에 남는다."""
    app_settings.set_flag(db, app_settings.AI_ADVICE_FOR_USERS, payload.ai_advice_for_users)
    logger.info("사용자 AI 진단·분석을 %s", "열었습니다" if payload.ai_advice_for_users else "닫았습니다")
    return _settings(db)
