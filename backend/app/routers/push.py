"""푸시 알림 켜기·끄기·시험 (ROADMAP 6단계). 보내는 쪽은 `services/alerts.py`."""

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import PushSubscription, User, UserStock
from app.services import alerts, limits, push
from app.services import settings as settings_service
from app.services.users import current_user_id

router = APIRouter(prefix="/api/push", tags=["push"])


class SubscriptionKeys(BaseModel):
    p256dh: str = Field(max_length=200)
    auth: str = Field(max_length=100)


class SubscriptionIn(BaseModel):
    """브라우저의 `PushSubscription.toJSON()` 모양 그대로."""

    endpoint: str = Field(max_length=push.MAX_ENDPOINT_LENGTH)
    keys: SubscriptionKeys


class EndpointIn(BaseModel):
    endpoint: str = Field(max_length=push.MAX_ENDPOINT_LENGTH)


class KindsIn(BaseModel):
    """받을 종류·받을 때·끈 종목. **보낸 칸만 바꾼다** — 옛 화면은 `kinds` 만 보낸다(그때 나머지는 그대로).

    검사는 칸마다 여기서 하지 않고 아래에서 400 + 한국어 한 줄로 — 지금까지의 이 경로와 같은 모양으로.
    """

    model_config = ConfigDict(extra="forbid")

    kinds: list[str] | None = Field(default=None, max_length=len(alerts.KINDS))
    # 0.45.0 B — 아침·오후 중 받을 때, 알림을 끈 종목
    slots: list[str] | None = Field(default=None, max_length=len(alerts.SLOTS))
    muted: list[str] | None = Field(default=None, max_length=alerts.MAX_MUTED)


def _user(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="user not found")
    return user


@router.get("/key")
def server_key() -> dict:
    """구독할 때 브라우저에 넘기는 서버 공개키. 누구에게나 같다."""
    return {"public_key": push.public_key()}


@router.get("/settings")
def get_settings(db: Session = Depends(get_db), user_id: int = Depends(current_user_id)) -> dict:
    """받을 종류와, 알림을 켜 둔 내 기기 수."""
    user = _user(db, user_id)
    devices = db.query(PushSubscription).filter(PushSubscription.user_id == user_id).count()
    settings = settings_service.get_settings(db, user_id)
    prefs = alerts.prefs_of(settings)
    mine = {t for (t,) in db.query(UserStock.ticker).filter(UserStock.user_id == user_id)}
    return {
        "kinds": alerts.kinds_for(user, settings),
        "available": list(alerts.available_kinds(user)),
        "devices": devices,
        # 0.45.0 B — 받을 때(아침·오후)와 끈 종목. 내 목록에 없는 티커는 보이지 않는다
        "slots": prefs["slots"],
        "muted": [t for t in prefs["muted"] if t in mine],
    }


@router.put("/settings")
def put_settings(
    payload: KindsIn, db: Session = Depends(get_db), user_id: int = Depends(current_user_id)
) -> dict:
    user = _user(db, user_id)
    settings = settings_service.get_settings(db, user_id)
    if payload.kinds is not None:
        available = alerts.available_kinds(user)
        unknown = [kind for kind in payload.kinds if kind not in available]
        if unknown:
            raise HTTPException(
                status_code=400,
                detail={"hint": "없는 알림 종류입니다.", "message": f"unknown kinds: {unknown}"},
            )
        settings.push_kinds = [kind for kind in available if kind in payload.kinds]
    if payload.slots is not None or payload.muted is not None:
        prefs = alerts.prefs_of(settings)
        if payload.slots is not None:
            unknown = [slot for slot in payload.slots if slot not in alerts.SLOTS]
            if unknown:
                raise HTTPException(
                    status_code=400,
                    detail={"hint": "없는 알림 때입니다.", "message": f"unknown slots: {unknown}"},
                )
            if not payload.slots:
                # 둘 다 끄는 것은 알림을 끄는 것 — 그건 종류를 모두 끄거나 이 기기의 알림을 끈다
                raise HTTPException(
                    status_code=400,
                    detail={"hint": "아침·오후 중 하나는 받아야 합니다. 알림을 아예 끄려면 위의 '알림 끄기'를 쓰세요.",
                            "message": "no slots"},
                )
            prefs["slots"] = [slot for slot in alerts.SLOTS if slot in payload.slots]
        if payload.muted is not None:
            mine = {t for (t,) in db.query(UserStock.ticker).filter(UserStock.user_id == user_id)}
            strangers = [t for t in payload.muted if t not in mine]
            if strangers:
                raise HTTPException(
                    status_code=400,
                    # 받은 글자는 돌려주지 않는다 — 항목 길이에 한도가 없어 아주 긴 글자가 답에 그대로 실렸다(0.45.0 끝 검토). 몇 개인지만
                    detail={"hint": "내 목록에 없는 종목입니다.", "message": f"not in my list: {len(strangers)}"},
                )
            prefs["muted"] = sorted(set(payload.muted))
        # 기본(둘 다 받고 끈 것 없음)이면 비워 둔다 — 지금과 같은 것을 같은 모양(NULL)으로
        settings.push_prefs = None if prefs == {"slots": list(alerts.SLOTS), "muted": []} else prefs
    db.commit()
    return get_settings(db, user_id)


@router.post("/subscriptions")
def add_subscription(
    payload: SubscriptionIn, db: Session = Depends(get_db), user_id: int = Depends(current_user_id)
) -> dict:
    """이 기기로 알림을 받는다. 같은 기기를 다시 보내도 된다 (화면이 열릴 때마다 맞춰 본다)."""
    try:
        alerts.subscribe(db, user_id, payload.endpoint, payload.keys.p256dh, payload.keys.auth)
    except push.PushError as exc:
        raise HTTPException(status_code=400, detail={"hint": str(exc), "message": "bad subscription"})
    return {"ok": True}


@router.delete("/subscriptions", status_code=204)
def remove_subscription(
    payload: EndpointIn, db: Session = Depends(get_db), user_id: int = Depends(current_user_id)
):
    """이 기기로는 그만 받는다. 남의 기기는 없는 것과 같다 (404)."""
    if not alerts.unsubscribe(db, user_id, payload.endpoint):
        raise HTTPException(status_code=404, detail={"hint": "알림이 켜진 기기가 아닙니다.", "message": "not found"})
    return Response(status_code=204)


@router.post("/test")
def send_test(db: Session = Depends(get_db), user_id: int = Depends(current_user_id)) -> dict:
    """내 기기 전부에 시험 알림 하나."""
    if not limits.test_pushes.allow(user_id):
        raise HTTPException(
            status_code=429,
            detail={"hint": "잠시 뒤에 다시 눌러 주세요.", "message": "too many test pushes"},
        )
    result = alerts.deliver(
        db,
        user_id,
        {"title": "자산관리", "body": "알림이 켜져 있습니다. 시그널이 뜨면 이렇게 알려드립니다.", "url": "/", "tag": "test"},
    )
    if result["sent"] == 0 and result["failed"] == 0:
        raise HTTPException(
            status_code=409,
            detail={"hint": "알림이 켜진 기기가 없습니다. 먼저 알림을 켜 주세요.", "message": "no devices"},
        )
    return result
