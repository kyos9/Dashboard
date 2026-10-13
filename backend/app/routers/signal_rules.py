"""시그널 정의를 화면에 — 조건 목록·문구·기준값 (0.41.0, SIGNAL_APP_SPEC.md 10장).

공용이고 읽기뿐이다. 로그인한 사람 누구나 같은 값을 받는다. 손님 문(`/api/macro`)은 넓히지 않는다 —
손님 화면에는 시그널 설명이 없다.
"""

from fastapi import APIRouter

from app.schemas import SignalRules
from app.services import signal_rules

router = APIRouter(prefix="/api/signal-rules", tags=["signals"])


@router.get("", response_model=SignalRules)
def get_signal_rules() -> dict:
    return signal_rules.payload()
