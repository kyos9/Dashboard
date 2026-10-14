"""시그널 정의를 화면에 — 조건 목록·문구·기준값 (0.41.0, SIGNAL_APP_SPEC.md 10·12장).

0.42.0 부터 **사람마다** 다르다: 시그널 기준(ADX·거래량비·이격도·비교 기간)을 바꾼 사람은 그 숫자로 된 문구를
받는다. 기본인 사람은 0.41.0 과 같은 값이다. 손님 문(`/api/macro`)은 넓히지 않는다 — 손님 화면에는 시그널
설명이 없다.

내 기준은 `PUT /api/signal-thresholds` 로 바꾸고 `DELETE` 로 기본값으로 되돌린다. 응답은 바뀐 규칙(새 판 포함)
이라 화면이 곧바로 다시 그린다 — 종목이 0개라 카드로 판을 못 받는 사람도.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import SignalRules, SignalThresholdsIn
from app.services import alerts, my_signals, signal_rules
from app.services.settings import get_settings
from app.services.users import current_user_id

router = APIRouter(prefix="/api/signal-rules", tags=["signals"])
thresholds_router = APIRouter(prefix="/api/signal-thresholds", tags=["signals"])


@router.get("", response_model=SignalRules)
def get_signal_rules(db: Session = Depends(get_db), user_id: int = Depends(current_user_id)) -> dict:
    return signal_rules.payload(t=my_signals.thresholds_for(db, user_id))


def _save(db: Session, user_id: int, stored: dict | None) -> dict:
    settings = get_settings(db, user_id)
    settings.signal_thresholds = stored
    db.commit()
    my_signals.forget(db, user_id)
    t = my_signals.thresholds_for(db, user_id)
    # 바꾼 순간의 상태는 알림 없이 적어 둔다 — 기준을 낮췄다고 여러 종목 알림이 한꺼번에 가지 않게(주인 결정).
    # 그 뒤 새로 켜지는 것부터 알린다.
    alerts.record_buy_state_quietly(db, user_id)
    return signal_rules.payload(t=t)


@thresholds_router.put("", response_model=SignalRules)
def put_signal_thresholds(
    body: SignalThresholdsIn, db: Session = Depends(get_db), user_id: int = Depends(current_user_id)
) -> dict:
    defaults = signal_rules.DEFAULT.as_dict()
    # 기본값과 같은 키는 담지 않는다 — 다 같으면 NULL(기본)
    stored = {
        key: signal_rules.LIMITS[key][3](value)
        for key, value in body.model_dump().items()
        if value is not None and value != defaults[key]
    }
    return _save(db, user_id, stored or None)


@thresholds_router.delete("", response_model=SignalRules)
def delete_signal_thresholds(db: Session = Depends(get_db), user_id: int = Depends(current_user_id)) -> dict:
    """기본값으로."""
    return _save(db, user_id, None)
