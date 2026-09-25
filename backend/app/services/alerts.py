"""무엇을 누구에게 알릴까 — 매수 시그널·비중조절·리뷰, 그리고 관리자에게 가입 신청 (ROADMAP 6단계).

이 도구는 매일 열어보는 것이 아니라 **"시그널이 떴습니다"가 오면 여는 것**이다. 그래서
알림의 규칙은 둘이다.

1. **바뀐 순간에만 울린다.** 과중인 종목이 한 달 내내 과중이면 첫날 한 번이다. 같은 말을
   매일 아침 들으면 사람은 알림을 끄고, 그러면 정작 새 신호도 못 받는다. 무엇을 이미
   알렸는지는 `PushState` 에 적는다. 과중이 풀렸다 다시 과중이 되면 그때 또 알린다.
2. **한 사람에게 한 번에 하나.** 여러 종목이 한꺼번에 떠도 알림은 한 개로 묶는다.

알림을 끈 종류도 상태는 적어둔다 — 나중에 켰을 때 "지난주부터 과중이었던 것"이 한꺼번에
쏟아지지 않게. 기기가 하나도 없는 사람은 아예 보지 않는다 (처음 켜면 지금 상태가 한 번 온다).
"""

from __future__ import annotations

import datetime as dt
import logging
import threading
from collections.abc import Callable

from sqlalchemy.orm import Session

from app.markets import Market, market_of_stock
from app.models import PushState, PushSubscription, User, UserSettings, UserStock
from app.services import push, queries, rebalance
from app.services.trading_calendar import market_today
from app.services.users import STATUS_ACTIVE, ordered_user_stocks

logger = logging.getLogger(__name__)

KIND_BUY = "buy"
KIND_BAND = "band"
KIND_REVIEW = "review"
KIND_SIGNUP = "signup"  # 관리자만
KINDS = (KIND_BUY, KIND_BAND, KIND_REVIEW, KIND_SIGNUP)
USER_KINDS = (KIND_BUY, KIND_BAND, KIND_REVIEW)

# 이보다 오래된 시그널은 알리지 않는다. 시세가 며칠 밀려 있다가 따라잡은 날, 지난주 시그널이
# "오늘 떴다"로 울리면 안 된다. 화면이 "오래된 데이터"로 표시하는 기준(dashboard)과 같다.
SIGNAL_FRESH_DAYS = 5

# 한 사람이 알림을 켜 둘 수 있는 기기 수. 넘으면 가장 오래된 것을 지운다.
MAX_DEVICES = 10

OVER = "over"
UNDER = "under"


# ---------------------------------------------------------------------------
#  받을 종류
# ---------------------------------------------------------------------------


def kinds_for(user: User, settings: UserSettings | None) -> list[str]:
    """이 사람이 받는 종류. 가입 신청 알림은 관리자에게만 있다."""
    available = available_kinds(user)
    chosen = settings.push_kinds if settings is not None else None
    if chosen is None:
        return list(available)
    return [kind for kind in available if kind in chosen]


def available_kinds(user: User) -> tuple[str, ...]:
    return KINDS if user.is_owner else USER_KINDS


# ---------------------------------------------------------------------------
#  보내기 — 기기마다
# ---------------------------------------------------------------------------


def deliver(db: Session, user_id: int, message: dict) -> dict:
    """그 사람의 기기 전부에 보낸다. 끝난 구독은 지운다. `{"sent": n, "failed": n}`."""
    subs = db.query(PushSubscription).filter(PushSubscription.user_id == user_id).all()
    sent = failed = 0
    for sub in subs:
        outcome = push.send(sub.endpoint, sub.p256dh, sub.auth, message)
        if outcome == push.SENT:
            sub.last_ok_at = dt.datetime.utcnow()
            sent += 1
        elif outcome == push.GONE:
            logger.info("끝난 알림 구독을 지웁니다 (사용자 %s)", user_id)
            db.delete(sub)
            failed += 1
        else:
            failed += 1
    db.commit()
    return {"sent": sent, "failed": failed}


# ---------------------------------------------------------------------------
#  가입 신청 → 관리자
# ---------------------------------------------------------------------------


def signup_message(name: str | None) -> dict:
    who = (name or "").strip() or "새 사용자"
    return {
        "title": "가입 신청",
        "body": f"{who} 님이 가입을 신청했습니다. 사용자 목록에서 승인할 수 있습니다.",
        "url": "/",
        "tag": "signup",
    }


def notify_signup(db: Session, name: str | None) -> None:
    """관리자에게 "가입 신청이 왔다". 가입 신청 알림을 끈 관리자는 건너뛴다."""
    owners = db.query(User).filter(User.is_owner.is_(True)).all()
    for owner in owners:
        if KIND_SIGNUP not in kinds_for(owner, db.get(UserSettings, owner.id)):
            continue
        deliver(db, owner.id, signup_message(name))


def _run_in_background(job: Callable[[], None]) -> None:
    """로그인을 붙잡지 않도록 뒤에서 보낸다. 테스트는 이 자리를 바로 부르는 것으로 바꾼다."""
    threading.Thread(target=job, name="push-signup", daemon=True).start()


def notify_signup_later(name: str | None) -> None:
    from app.db import SessionLocal

    def job() -> None:
        db = SessionLocal()
        try:
            notify_signup(db, name)
        except Exception:
            # 알림이 안 가도 신청은 들어와 있다 — 헤더의 숫자가 그대로 알려준다
            logger.warning("가입 신청 알림을 보내지 못했습니다", exc_info=True)
        finally:
            db.close()

    _run_in_background(job)


# ---------------------------------------------------------------------------
#  매일 — 매수 시그널·비중조절·리뷰
# ---------------------------------------------------------------------------


def _label(stock: UserStock) -> str:
    """알림에 적을 이름. 화면과 같은 규칙 — 미국은 티커, 나머지는 종목명 (`lib/display.ts`)."""
    if market_of_stock(stock) == Market.US:
        return stock.ticker
    name = (stock.name or stock.instrument.name or "").strip()
    return name or stock.ticker


def current_values(db: Session, user_id: int) -> dict[str, tuple[str, str]]:
    """지금 알릴 만한 것들. `{subject: (value, 종목 이름 또는 날짜)}`.

    값이 빈 문자열이면 "지금은 아니다" — 상태를 비워서 다음에 다시 켜질 때 알리게 한다.
    """
    stocks = ordered_user_stocks(db, user_id, active_only=True)
    values: dict[str, tuple[str, str]] = {}

    signals = queries.recent_signals(db, [s.ticker for s in stocks], limit=1)
    for stock in stocks:
        rows = signals.get(stock.ticker) or []
        latest = rows[0] if rows else None
        today = market_today(market_of_stock(stock))
        fresh = latest is not None and (today - latest.date).days <= SIGNAL_FRESH_DAYS
        on = fresh and bool(latest.knee_buy_v2)
        values[f"{KIND_BUY}:{stock.ticker}"] = (latest.date.isoformat() if on else "", _label(stock))

    current = rebalance.compute_rebalance_current(db, user_id)
    # 보유수량을 하나도 안 넣은 사람은 모든 종목이 "0% — 미달"로 계산된다. 그건 신호가 아니다.
    if current["total_value_base"] > 0:
        labels = {stock.ticker: _label(stock) for stock in stocks}
        for row in current["rows"]:
            reasons = row["rebalance_signal"]["reasons"]
            state = (
                OVER if rebalance.REASON_OVER in reasons
                else UNDER if rebalance.REASON_UNDER in reasons
                else ""
            )
            values[f"{KIND_BAND}:{row['ticker']}"] = (state, labels.get(row["ticker"], row["ticker"]))

    review = current["review"]
    values[KIND_REVIEW] = (
        review["next_date"].isoformat() if review["due"] else "",
        review["next_date"].isoformat(),
    )
    return values


def _changes(db: Session, user_id: int, values: dict[str, tuple[str, str]]) -> list[tuple[str, str, str]]:
    """상태를 새로 적고, **새로 켜진 것**만 돌려준다 `[(subject, value, label)]`."""
    stored = {row.subject: row for row in db.query(PushState).filter(PushState.user_id == user_id)}
    now = dt.datetime.utcnow()
    fired = []
    for subject, (value, label) in values.items():
        row = stored.get(subject)
        before = row.value if row is not None else ""
        if value and value != before:
            fired.append((subject, value, label))
        if row is None:
            if value:
                db.add(PushState(user_id=user_id, subject=subject, value=value, updated_at=now))
        elif row.value != value:
            row.value = value
            row.updated_at = now
    # 목록에서 뺀 종목의 상태는 치운다 — 다시 담으면 처음부터 본다
    for subject, row in stored.items():
        if subject not in values:
            db.delete(row)
    db.commit()
    return fired


def compose(fired: list[tuple[str, str, str]], kinds: list[str]) -> dict | None:
    """새로 켜진 것들을 알림 하나로. 받을 종류가 아니면 뺀다. 남는 게 없으면 None."""
    buys = [label for subject, _, label in fired if subject.startswith(f"{KIND_BUY}:")]
    over = [label for subject, value, label in fired if subject.startswith(f"{KIND_BAND}:") and value == OVER]
    under = [label for subject, value, label in fired if subject.startswith(f"{KIND_BAND}:") and value == UNDER]
    review = [label for subject, _, label in fired if subject == KIND_REVIEW]

    # (제목, 내용). 하나면 그대로 제목·내용이 되고, 여럿이면 "제목: 내용" 줄로 묶는다
    parts: list[tuple[str, str]] = []
    if buys and KIND_BUY in kinds:
        parts.append(("매수 시그널", ", ".join(buys)))
    if over and KIND_BAND in kinds:
        parts.append(("비중 과중(매도 검토)", ", ".join(over)))
    if under and KIND_BAND in kinds:
        parts.append(("비중 미달(매수 검토)", ", ".join(under)))
    if review and KIND_REVIEW in kinds:
        deadline = dt.date.fromisoformat(review[0])
        parts.append(("포트폴리오 리뷰", f"리뷰할 때입니다 ({deadline.month}/{deadline.day} 마감)"))
    if not parts:
        return None

    # 매수 시그널이 있으면 대시보드, 비중·리뷰뿐이면 리밸런싱 화면으로 연다
    url = "/" if buys and KIND_BUY in kinds else "/rebalance"
    if len(parts) == 1:
        title, body = parts[0]
    else:
        title, body = "신호판 알림", "\n".join(f"{t}: {text}" for t, text in parts)
    return {"title": title, "body": body, "url": url, "tag": "daily"}


def run_daily(db: Session) -> dict:
    """알림을 켜 둔 사람마다 한 번. 스케줄러가 시세 갱신 뒤에 부른다.

    한 사람에게서 넘어져도 다음 사람은 계속한다. `{"users": n, "notified": n}`.
    """
    user_ids = [
        uid
        for (uid,) in db.query(PushSubscription.user_id)
        .join(User, User.id == PushSubscription.user_id)
        .filter(User.status == STATUS_ACTIVE)
        .distinct()
    ]
    notified = 0
    for user_id in sorted(user_ids):
        try:
            fired = _changes(db, user_id, current_values(db, user_id))
            if not fired:
                continue
            user = db.get(User, user_id)
            message = compose(fired, kinds_for(user, db.get(UserSettings, user_id)))
            if message is None:
                continue
            if deliver(db, user_id, message)["sent"]:
                notified += 1
        except Exception:
            db.rollback()
            logger.warning("사용자 %s 의 알림을 만들지 못했습니다", user_id, exc_info=True)
    if user_ids:
        logger.info("알림: 켜 둔 사람 %d명 중 %d명에게 보냈습니다", len(user_ids), notified)
    return {"users": len(user_ids), "notified": notified}


# ---------------------------------------------------------------------------
#  구독 받기·지우기
# ---------------------------------------------------------------------------


def subscribe(db: Session, user_id: int, endpoint: str, p256dh: str, auth: str) -> PushSubscription:
    """기기 하나를 이 사람 것으로 적는다. 같은 주소가 있으면 **이 사람에게 넘긴다** (models 참고)."""
    push.check_subscription(endpoint, p256dh, auth)
    row = db.query(PushSubscription).filter(PushSubscription.endpoint == endpoint).first()
    if row is None:
        row = PushSubscription(endpoint=endpoint, user_id=user_id, created_at=dt.datetime.utcnow())
        db.add(row)
    elif row.user_id != user_id:
        row.user_id = user_id
        row.created_at = dt.datetime.utcnow()
    row.p256dh = p256dh
    row.auth = auth
    db.flush()

    mine = (
        db.query(PushSubscription)
        .filter(PushSubscription.user_id == user_id)
        .order_by(PushSubscription.created_at.desc(), PushSubscription.id.desc())
        .all()
    )
    for old in mine[MAX_DEVICES:]:
        db.delete(old)
    db.commit()
    return row


def unsubscribe(db: Session, user_id: int, endpoint: str) -> bool:
    """내 기기면 지운다. 남의 것이거나 없으면 False."""
    row = (
        db.query(PushSubscription)
        .filter(PushSubscription.endpoint == endpoint, PushSubscription.user_id == user_id)
        .first()
    )
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True
