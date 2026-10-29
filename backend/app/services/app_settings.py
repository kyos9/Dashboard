"""앱 전체 설정 — 관리자가 화면에서 켜고 끈다 (ROADMAP 9-15).

서버를 다시 띄우지 않고 바꿀 수 있어야 하는 것만 둔다. `.env` 는 배포할 때 정하는 것(주인 이메일,
비밀번호)이고, 여기는 쓰다가 마음이 바뀔 수 있는 것이다.

- **`ai_advice_for_users`** — 사용자 계정에도 AI 포트폴리오 진단·종목 분석(9-7·9-8)을 열까.
  둘은 그 사람의 비중(%)을 AI 에게 보낸다(편입 판단 틀은 v0.45.4 부터 관리자만, 사용자는 중립 틀 — `ai_portfolio`). 처음엔 관리자만 썼고(규제 확인 전),
  v0.39.0 에서 주인이 "사용자도 내가 승인해 들이니 연다"고 정했다. 다시 닫으면 다음 요청부터 403 이다.
  관리자는 언제나 쓴다.

**글자 값** (`get_value`/`set_value`, 0.41.0) — 사람이 켜고 끄는 깃발이 아니라 **앱이 스스로 적어 두는 상태**다.
지금은 시그널 정의의 지문과 마지막 재계산 요약(`signal_recompute.py`). 공용이고 다시 만들 수 있다 —
지워지면 다음에 켤 때 지난 판정을 한 번 다시 계산할 뿐이다. 관리자 설정 응답(`/api/admin/settings`)에는
나오지 않는다(그 응답은 깃발 이름을 하나씩 골라 담는다).
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


def get_value(db: Session, key: str) -> str | None:
    """앱이 적어 둔 글자 값. 없으면 None."""
    row = db.get(AppSetting, key)
    return None if row is None else row.value


def set_value(db: Session, key: str, value: str) -> None:
    """글자 값을 적는다 (깃발 이름과 겹치지 않게 부르는 쪽이 고른다)."""
    if key in DEFAULTS:
        raise KeyError(f"{key} 는 깃발이다 — set_flag 를 쓴다")
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value=value, updated_at=dt.datetime.utcnow()))
    else:
        row.value = value
        row.updated_at = dt.datetime.utcnow()
    db.commit()
