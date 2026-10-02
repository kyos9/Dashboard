"""앱 전체 설정 — 관리자가 화면에서 켜고 끈다 (ROADMAP 9-15).

서버를 다시 띄우지 않고 바꿀 수 있어야 하는 것만 둔다. `.env` 는 배포할 때 정하는 것(주인 이메일,
비밀번호)이고, 여기는 쓰다가 마음이 바뀔 수 있는 것이다.

- **`ai_advice_for_users`** — 사용자 계정에도 AI 포트폴리오 진단·종목 분석(9-7·9-8)을 열까.
  둘은 그 사람의 비중(%)을 AI 에게 보내고 편입 판단까지 받는다. 처음엔 관리자만 썼고(규제 확인 전),
  v0.39.0 에서 주인이 "사용자도 내가 승인해 들이니 연다"고 정했다. 다시 닫으면 다음 요청부터 403 이다.
  관리자는 언제나 쓴다.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy.orm import Session

from app.models import AppSetting

AI_ADVICE_FOR_USERS = "ai_advice_for_users"

# 줄이 없을 때의 값
DEFAULTS: dict[str, bool] = {AI_ADVICE_FOR_USERS: True}


def get_flag(db: Session, key: str) -> bool:
    row = db.get(AppSetting, key)
    if row is None:
        return DEFAULTS[key]
    return row.value == "1"


def set_flag(db: Session, key: str, on: bool) -> bool:
    if key not in DEFAULTS:
        raise KeyError(key)
    row = db.get(AppSetting, key)
    value = "1" if on else "0"
    if row is None:
        db.add(AppSetting(key=key, value=value, updated_at=dt.datetime.utcnow()))
    else:
        row.value = value
        row.updated_at = dt.datetime.utcnow()
    db.commit()
    return on


def ai_advice_open(db: Session) -> bool:
    """사용자 계정이 AI 진단·종목 분석을 쓸 수 있나 (관리자는 이것과 상관없이 쓴다)."""
    return get_flag(db, AI_ADVICE_FOR_USERS)
