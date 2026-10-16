"""날마다의 평가금액 기록 (0.44.0, ROADMAP 11-3).

**지금 남기지 않으면 그 전 기록은 영영 없다.** 보유는 덮어쓰기이고 리밸런싱 기록은 사람이 누를 때만
남아서, "지난달 이맘때 얼마였나"를 되살릴 길이 없다. 그래서 서버가 하루 한 줄을 스스로 남긴다.
화면(성과·낙폭)은 이것이 쌓인 뒤의 일이다.

정한 것 (`docs/rounds/0.44.0-기록시작/plan.md`):

- **언제** — 미국 시세 갱신(UTC 22:30, 한국 07:30) 끝에, 갱신이 넘어져도. 켤 때 따라잡기 뒤에도, 받은 게
  없어도. 같은 한국 날짜에 다시 돌면 그 줄을 고쳐 쓴다 — 그날 마지막으로 쓴 값이 남는다.
- **날짜** — 기록한 순간의 한국 날짜(`Asia/Seoul`). 아침 기록이라 대개 미국·한국 모두 전날 종가가 든다.
  종목마다 종가 날짜를 같이 남기므로 나중에 맞출 수 있다. 꺼져 있던 날은 되살리지 않는다.
- **누구** — 매일 시세를 받는 사람(`pipeline.in_use`). 휴면인 동안은 시세가 낡으므로 남기지 않는다.
  보유·현금이 다 0 이면 남기지 않되, 전날까지 기록이 있던 사람은 0 줄을 남긴다("0원"과 "기록 없음"을 가르게).
- **얼마** — 리밸런싱 화면과 같은 계산(`rebalance.portfolio_valuation`). 외부 호출은 없다.
- **끄기** — `SIGNAL_DASHBOARD_VALUE_RECORD=0`.

시간가중 수익률은 "전날 수량 × 종가 변화"로 낼 수 있지만, 입출금 기록은 없다(현금을 고친 날이 입금인지
매도 대금인지 모른다) — 그 한계는 화면을 만들 때 적는다.
"""

from __future__ import annotations

import datetime as dt
import logging
import os
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Holding, PortfolioValueDaily, User, UserSettings, UserStock
from app.services import rebalance
from app.services.pipeline import in_use

logger = logging.getLogger(__name__)

KST = ZoneInfo("Asia/Seoul")
ENV_SWITCH = "SIGNAL_DASHBOARD_VALUE_RECORD"


def enabled() -> bool:
    return os.environ.get(ENV_SWITCH, "1").strip().lower() not in {"0", "false", "off", "no"}


def record_date(now: dt.datetime | None = None) -> dt.date:
    """기록할 날짜 — 그 순간의 한국 날짜. `now` 는 UTC(시간대 없음)로 받는다."""
    moment = (now or dt.datetime.utcnow()).replace(tzinfo=dt.timezone.utc)
    return moment.astimezone(KST).date()


def _positions(valuation: dict) -> list[dict]:
    rows = []
    for stock in valuation["stocks"]:
        pos = valuation["positions"][stock.ticker]
        if pos["quantity"] <= 0:
            continue
        rows.append(
            {
                "ticker": stock.ticker,
                "currency": pos["currency"].value,
                "quantity": pos["quantity"],
                "avg_cost": pos["avg_cost"],
                "close": pos["last_close"],
                "close_date": pos["last_close_date"].isoformat() if pos["last_close_date"] else None,
                "value": pos["value"],
                "value_base": pos["value_base"],
            }
        )
    return rows


def _has_earlier(db: Session, user_id: int, day: dt.date) -> bool:
    return (
        db.query(PortfolioValueDaily.id)
        .filter(PortfolioValueDaily.user_id == user_id, PortfolioValueDaily.date < day)
        .first()
        is not None
    )


def _holds_anything(db: Session, user_id: int) -> bool:
    """보유나 현금이 있을 수도 있나 — 없으면 계산도 하지 않는다.

    평가 계산(`get_settings`)은 설정 행이 없으면 만든다. 아무것도 없는 사람에게 매일 빈 설정 행을
    만들어 줄 까닭이 없다. 평가 계산과 같은 것을 센다 — **활성 종목**의 수량 > 0 (수량 0 행·숨긴 종목만 있는
    사람은 평가가 0 이다).
    """
    held = (
        db.query(Holding.ticker)
        .join(UserStock, (UserStock.user_id == Holding.user_id) & (UserStock.ticker == Holding.ticker))
        .filter(Holding.user_id == user_id, Holding.quantity > 0, UserStock.active.is_(True))
        .first()
    )
    if held:
        return True
    settings = db.get(UserSettings, user_id)
    return bool(settings and settings.cash and any(settings.cash.values()))


def record_user(db: Session, user_id: int, day: dt.date, now: dt.datetime | None = None) -> bool:
    """한 사람의 그날 줄을 쓴다(있으면 고쳐 쓴다). 쓴 게 있으면 True."""
    if not _holds_anything(db, user_id) and not _has_earlier(db, user_id, day):
        return False
    valuation = rebalance.portfolio_valuation(db, user_id)
    positions = _positions(valuation)
    empty = not positions and not any(amount for amount in valuation["cash"].values())
    if empty and not _has_earlier(db, user_id, day):
        return False

    values = {
        "base_currency": valuation["base"].value,
        "total_value_base": valuation["total_base"],
        "stock_value_base": valuation["holdings_base"],
        "cash_value_base": valuation["cash_base"],
        "cash": {currency.value: amount for currency, amount in valuation["cash"].items()},
        "fx": valuation["rate"].to_dict(),
        "positions": positions,
        "recorded_at": now or dt.datetime.utcnow(),
    }

    def write() -> None:
        row = (
            db.query(PortfolioValueDaily)
            .filter(PortfolioValueDaily.user_id == user_id, PortfolioValueDaily.date == day)
            .one_or_none()
        )
        if row is None:
            db.add(PortfolioValueDaily(user_id=user_id, date=day, **values))
        else:
            for key, value in values.items():
                setattr(row, key, value)
        db.commit()

    try:
        write()
    except IntegrityError:
        # 스케줄러가 잠깐 둘 돈 틈(leader.py)에 다른 쪽이 먼저 썼다 — 그 줄을 고쳐 쓴다
        db.rollback()
        write()
    return True


def record_day(db: Session, now: dt.datetime | None = None) -> dict | None:
    """쓰는 중인 사람마다 그날 줄 하나. 한 사람에게서 넘어져도 다음 사람은 계속한다.

    `{"date": ..., "users": 대상 수, "written": 쓴 수, "failed": 실패 수}`. 꺼져 있으면 `None`.
    """
    if not enabled():
        return None
    day = record_date(now)
    user_ids = [uid for (uid,) in db.query(User.id).filter(in_use(now)).order_by(User.id)]
    written = failed = 0
    for user_id in user_ids:
        try:
            if record_user(db, user_id, day, now=now):
                written += 1
        except Exception:
            db.rollback()
            failed += 1
            logger.warning("사용자 %s 의 평가금액을 기록하지 못했습니다", user_id, exc_info=True)
    logger.info("평가금액 기록 %s: 대상 %d명 중 %d명 (실패 %d)", day, len(user_ids), written, failed)
    return {"date": day.isoformat(), "users": len(user_ids), "written": written, "failed": failed}


def sweep_orphans(db: Session) -> int:
    """주인 없는 줄을 지운다 — 켤 때 한 번, 요청을 받기 전에(`db.init_db`) (A 검토 조건 1).

    0.43 으로 이미지만 되돌린 동안(DEPLOY 9-3) 그 코드는 이 표를 모르고 탈퇴를 처리한다. Postgres 는 외래키
    CASCADE 가 지우지만 SQLite 는 외래키를 강제하지 않아 줄이 남는다. 게다가 `users.id` 는 다시 쓰일 수 있다 —
    맨 끝 번호가 탈퇴하면 다음 가입자가 같은 번호를 받는다. 그래서 둘 다 지운다:
    사람이 없는 줄, 그 사람이 **가입하기 전**에 쓰인 줄(제 줄일 수 없다). 지운 수를 돌려준다.
    """
    ids = [
        row_id
        for (row_id,) in db.query(PortfolioValueDaily.id)
        .outerjoin(User, User.id == PortfolioValueDaily.user_id)
        .filter(or_(User.id.is_(None), PortfolioValueDaily.recorded_at < User.created_at))
    ]
    if ids:
        db.query(PortfolioValueDaily).filter(PortfolioValueDaily.id.in_(ids)).delete(synchronize_session=False)
        db.commit()
        logger.warning("주인 없는 평가금액 기록 %d줄을 지웠습니다(옛 버전에서의 탈퇴)", len(ids))
    return len(ids)


def status(db: Session) -> dict:
    """진단(주인)에 보일 합계 — 마지막 날짜·그날 사람 수·모든 줄 수. 누구의 금액도 담지 않는다."""
    last = db.query(func.max(PortfolioValueDaily.date)).scalar()
    users = (
        db.query(func.count(PortfolioValueDaily.id)).filter(PortfolioValueDaily.date == last).scalar()
        if last
        else 0
    )
    rows = db.query(func.count(PortfolioValueDaily.id)).scalar() or 0
    return {
        "enabled": enabled(),
        "last_date": last.isoformat() if last else None,
        "users": users or 0,
        "rows": rows,
    }


def my_days(db: Session, user_id: int) -> dict:
    """내 기록이 며칠 쌓였고 언제부터인가 — 리밸런싱 "리뷰 · 기록" 안내 줄."""
    count, since = (
        db.query(func.count(PortfolioValueDaily.id), func.min(PortfolioValueDaily.date))
        .filter(PortfolioValueDaily.user_id == user_id)
        .one()
    )
    return {"days": count or 0, "since": since.isoformat() if since else None}
