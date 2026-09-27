"""종목 하나를 갱신(가격→지표→시그널)하는 오케스트레이션.

수동 새로고침 버튼과 일일 스케줄러(scheduler.py)가 공통으로 사용한다.
"""

import datetime as dt
import logging
import threading
from collections.abc import Callable

import pandas as pd
from sqlalchemy import and_, exists, func, or_
from sqlalchemy.orm import Session

from app.markets import Market, market_of_stock
from app.models import Instrument, PriceDaily, PushSubscription, User, UserStock
from app.services import data_ingestion, fx, limits
from app.services.users import STATUS_ACTIVE
from app.services.trading_calendar import last_closed_trading_day

logger = logging.getLogger(__name__)

# 이만큼 안 들어온 사람의 종목은 매일 받는 대상에서 뺀다 (ROADMAP 8-2 — "6개월 넘게 안 들어온
# 사용자의 종목"). **데이터는 지우지 않는다** — 다시 들어오면 그 자리에서 밀린 만큼 받는다.
#
# 로그인 쪽지는 30일짜리이고 늘어나지 않으므로(`auth.SESSION_SECONDS`) 쓰는 사람은 적어도
# 한 달에 한 번 로그인한다. 그래서 마지막 로그인이 180일 전이면 적어도 다섯 달은 안 쓴 것이다.
DORMANT_AFTER = dt.timedelta(days=180)


def in_use(now: dt.datetime | None = None):
    """이 사람을 "쓰는 중"으로 셀까 — `User` 에 거는 SQL 조건.

    승인된 사람 중에서 이 가운데 하나면 쓰는 중이다:

    - **관리자** — 공용 데이터를 돌보는 사람이다. 비밀번호 문·잠금 없는 PC 에서는 구글
      로그인을 안 하므로 로그인 기록이 아예 없다.
    - **로그인 기록이 없다** — 구글 로그인 전부터 있던 로컬 계정이다. 모르는 것을 안 쓴다고
      치지 않는다.
    - **180일 안에 로그인했다.**
    - **알림을 받는 기기가 남아 있다** — 알림만 보고 앱은 안 여는 사람도 쓰는 사람이다. 받는
      쪽이 앱을 지우면 푸시 서버가 404·410 을 돌려주고 그 기기는 지워지므로(`push.send`),
      남아 있다는 것은 아직 닿는다는 뜻이다.
    """
    cutoff = (now or dt.datetime.utcnow()) - DORMANT_AFTER
    return and_(
        User.status == STATUS_ACTIVE,
        or_(
            User.is_owner.is_(True),
            User.last_login_at.is_(None),
            User.last_login_at >= cutoff,
            exists().where(PushSubscription.user_id == User.id),
        ),
    )


def is_dormant(db: Session, user: User, now: dt.datetime | None = None) -> bool:
    """승인된 사람인데 `in_use` 에 안 걸리는가 — 그 사람만 담은 종목은 매일 받지 않는다."""
    if user.status != STATUS_ACTIVE:
        return False  # 쓸 수 없는 사람은 원래 안 센다 — "안 들어와서"가 아니다
    return db.query(User.id).filter(User.id == user.id, in_use(now)).first() is None


def refresh_and_evaluate_stock(
    db: Session,
    stock: UserStock,
    full_backfill: bool = False,
    price_df: pd.DataFrame | None = None,
) -> dict:
    return data_ingestion.refresh_ticker(
        db, stock.ticker, full_backfill=full_backfill, price_df=price_df
    )


def watched(db: Session, now: dt.datetime | None = None):
    """**누구 하나라도 보고 있는** 종목 줄 — 매일 받는 대상은 이것의 합집합이다 (ROADMAP 4-4b).

    예전에는 담긴 줄마다 돌아서, 둘이 같은 QQQ를 담으면 QQQ를 두 번 받았다. 그리고 한
    사람이 치운(비활성) 종목은 빠지되 **남이 보고 있으면 계속 받는다** — `active` 는 "내
    화면에서 치웠다"는 뜻이지 공용 수집을 끄는 스위치가 아니다.

    쓰는 중인 사람의 것만 센다. 승인 대기·거절·차단된 사람은 화면을 볼 수 없으니, 그
    사람만 담은 종목을 매일 받을 이유가 없다 (데이터는 남는다 — 다시 승인되면 그날 밤부터
    다시 받는다).

    반년 넘게 안 들어온 사람도 같다 (`in_use`). 다시 들어오면 그 자리에서 밀린 것을 받는다
    (`catch_up_in_background`).
    """
    return (
        db.query(UserStock)
        .join(User, User.id == UserStock.user_id)
        .filter(UserStock.active.is_(True), in_use(now))
    )


def refresh_all_active_stocks(db: Session, market: Market | None = None) -> list[dict]:
    """보고 있는 종목을 **티커마다 한 번씩** 갱신한다. `market`을 주면 해당 시장 종목만.

    시세 조회는 한꺼번에(동시에) 하고 저장은 차례로 한다. 종목마다 조회→저장을 반복하면
    전체 시간이 "종목 수 x 왕복 시간"이 되는데, 그 왕복은 대부분 응답을 기다리는 시간이다.

    환율도 함께 갱신한다 — 통화가 섞인 포트폴리오에서는 환율이 낡으면 비중이 틀어지는데,
    화면에서는 시세만 갱신된 것처럼 보여 눈치채기 어렵다.
    """
    query = watched(db)
    if market is not None:
        query = query.join(UserStock.instrument).filter(Instrument.market == market.value)
    # 시세는 공용이다 — 티커 하나에 줄 하나만 남긴다 (누구의 줄이든 받는 것은 같다)
    by_ticker: dict[str, UserStock] = {}
    for stock in query.order_by(UserStock.ticker, UserStock.user_id):
        by_ticker.setdefault(stock.ticker, stock)
    return _refresh(db, list(by_ticker.values()))


def _refresh(db: Session, stocks: list[UserStock]) -> list[dict]:
    """종목 줄들(티커마다 하나)을 한꺼번에 받고 차례로 저장한다. 환율도 같이."""
    # 지금까지 이 종목을 받아온 제공자를 먼저 시도한다 (여러 곳에서 받아 섞이지 않게)
    fetched = data_ingestion.fetch_many(
        [(stock.ticker, data_ingestion.stored_source(db, stock.ticker)) for stock in stocks]
    )

    results = []
    for stock in stocks:
        outcome = fetched.get(stock.ticker)
        if isinstance(outcome, data_ingestion.DataIngestionError):
            logger.warning("skip refresh for %s: %s", stock.ticker, outcome)
            results.append({"ticker": stock.ticker, "error": str(outcome), "hint": outcome.hint})
            continue
        try:
            results.append(refresh_and_evaluate_stock(db, stock, price_df=outcome))
        except data_ingestion.DataIngestionError as exc:
            logger.warning("skip refresh for %s: %s", stock.ticker, exc)
            results.append({"ticker": stock.ticker, "error": str(exc), "hint": exc.hint})
            continue
        # 방금 받았다 — 사람이 바로 새로고침을 눌러도 다시 받지 않고 "방금 받았다"고 답한다
        limits.refresh_cooldown.mark(stock.ticker, ok=True)

    try:
        fx.refresh_rates(db)
    except Exception:
        # 환율 갱신 실패가 시세 갱신 결과를 덮어써선 안 된다 (직전 환율이 그대로 쓰인다)
        logger.warning("환율 갱신 실패 — 기존 환율을 계속 사용합니다", exc_info=True)

    return results


def stale_markets(db: Session) -> list[Market]:
    """보고 있는 종목(`watched` 와 같은 기준)의 최신 시세가 마지막 거래일보다 뒤처진 시장.

    시장별로 본다 — 한국은 최신인데 미국만 밀려 있을 수 있고, 그때 전 종목을 다시
    받아올 이유는 없다.
    """
    rows = (
        db.query(Instrument.market, func.max(PriceDaily.date))
        .select_from(UserStock)
        .join(User, User.id == UserStock.user_id)
        .join(Instrument, Instrument.ticker == UserStock.ticker)
        .outerjoin(PriceDaily, PriceDaily.ticker == UserStock.ticker)
        .filter(UserStock.active.is_(True), in_use())
        .group_by(Instrument.market)
        .all()
    )

    stale: list[Market] = []
    for market_value, latest in rows:
        try:
            market = Market(market_value)
        except ValueError:
            logger.warning("모르는 시장 값이라 건너뜁니다: %s", market_value)
            continue
        expected = last_closed_trading_day(market)
        if expected is None:
            continue
        if latest is None or latest < expected:
            stale.append(market)
    return stale


def refresh_stale_markets(db: Session) -> dict[str, list[dict]]:
    """뒤처진 시장만 갱신한다. 켤 때 놓친 갱신을 따라잡는 용도.

    스케줄러의 cron은 **놓친 실행을 되돌려주지 않는다.** 서버는 늘 켜져 있으니 상관없지만
    개인 PC는 갱신 시각 대부분에 꺼져 있다. 그대로 두면 켜도 시세가 며칠 전 그대로다.
    """
    results: dict[str, list[dict]] = {}
    for market in stale_markets(db):
        logger.info("%s 시세가 마지막 거래일보다 뒤처져 있어 따라잡습니다", market.value)
        results[market.value] = refresh_all_active_stocks(db, market=market)
    return results


# ---------------------------------------------------------------------------
#  반년 만에 다시 들어온 사람
# ---------------------------------------------------------------------------


def behind(db: Session, user_id: int) -> list[UserStock]:
    """이 사람의 (화면에 둔) 종목 중 시세가 마지막 거래일보다 뒤처진 것."""
    stocks = (
        db.query(UserStock)
        .filter(UserStock.user_id == user_id, UserStock.active.is_(True))
        .order_by(UserStock.ticker)
        .all()
    )
    if not stocks:
        return []
    latest = dict(
        db.query(PriceDaily.ticker, func.max(PriceDaily.date))
        .filter(PriceDaily.ticker.in_([s.ticker for s in stocks]))
        .group_by(PriceDaily.ticker)
        .all()
    )
    out = []
    for stock in stocks:
        expected = last_closed_trading_day(market_of_stock(stock))
        have = latest.get(stock.ticker)
        if have is None or (expected is not None and have < expected):
            out.append(stock)
    return out


def catch_up_user(db: Session, user_id: int) -> list[dict]:
    """다시 들어온 사람의 뒤처진 종목만 받는다. 매일 받기에서 빠져 있던 동안 밀린 만큼이다.

    받는 구간은 평소와 같은 2년이라 반년 공백도 한 번에 메워진다 (`data_ingestion.refresh_ticker`).
    남이 보고 있어 계속 받던 종목은 이미 최신이라 여기서 빠진다.
    """
    stocks = behind(db, user_id)
    if not stocks:
        return []
    logger.info("오래 안 들어온 사용자 %s: 밀린 종목 %d개를 받습니다", user_id, len(stocks))
    return _refresh(db, stocks)


def _in_thread(work: Callable[[], None]) -> None:
    threading.Thread(target=work, name="catch-up", daemon=True).start()


# 테스트는 "바로 실행"으로 바꿔 끼운다 (backfill.RUNNER 와 같다)
RUNNER: Callable[[Callable[[], None]], None] = _in_thread


def catch_up_in_background(session_factory, user_id: int) -> None:
    """로그인 응답을 붙잡지 않게 뒤에서 받는다. 화면은 그동안 받아둔 옛 시세를 보여준다."""

    def work() -> None:
        db = session_factory()
        try:
            catch_up_user(db, user_id)
        except Exception:
            logger.warning("사용자 %s 의 밀린 시세를 받지 못했습니다 — 오늘 밤 매일 받기가 다시 합니다",
                           user_id, exc_info=True)
        finally:
            db.close()

    RUNNER(work)
