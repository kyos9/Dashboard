"""시세 받기가 막혔나 — 시장마다 마지막 정해진 갱신의 결과 (0.46.0 C, 제로베이스 점검 10번).

전에는 시세 제공자가 막혀도(야후 차단 등) 로그에만 남았다. 매일 갱신이 조용히 넘어가고 묵은 값으로 화면·알림이 돌았다.
이제 스케줄러가 돌린 갱신(정해진 시각·켤 때 따라잡기)이 끝날 때마다 시장마다 한 줄을 적고, 관리자가 진단·⋯ 점·푸시로 안다.
사람이 누른 새로고침은 적지 않는다 — 한 사람의 일이고, 그 사람은 결과를 화면에서 바로 본다.

**어디에**: 공용 `app_setting` 의 글자 값, 시장마다 키 하나(`refresh_status:US` …) — 갱신이 겹칠 때(켤 때 따라잡기와 cron) 한 JSON 을
고쳐 쓰면 나중 것이 앞 것을 지운다. 다시 만들 수 있다(지워져도 다음 갱신에 생긴다). 마이그레이션 없음.

**막혔다**의 기준 — 둘 중 하나:
- 받은 종목의 **절반 이상**이 실패. 한두 종목(상장폐지 등)은 막힌 게 아니다 — 진단에 이름만. "그런 티커가 없다"만 받은 종목은 세지 않는다.
- 실패는 없는데 그 시장의 가장 새 시세가 마지막 거래일보다 **3거래일 이상** 뒤 — 제공자가 오류 없이 묵은 값을 주는 날.
  (하루이틀 여유는 제공자가 늦게 올리는 날의 헛울림 막기.) 이 기준은 **적는 모든 실행**에 같다 — 켤 때 따라잡기가 묵은 값으로
  "풀림"을 적고 다음 갱신에 다시 막혀 푸시가 두 번 가지 않게(계획 다시 보기).

받을 종목이 0 인 실행은 적지 않는다(상태를 바꾸지 않는다).

**담는 것**: 시각·종목 수·실패 수·실패 종목(최대 10, 관리자만 본다 — 남이 담은 종목일 수 있다)·실패한 제공자 **이름**.
오류 글은 담지 않는다(주소·키가 들 수 있다 — 로그에만).
"""

from __future__ import annotations

import datetime as dt
import json
import logging

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.markets import Market, market_of
from app.models import Instrument, PriceDaily
from app.services import app_settings
from app.services.trading_calendar import last_closed_trading_day, trading_days

logger = logging.getLogger(__name__)

KEY_PREFIX = "refresh_status:"
MAX_TICKERS = 10
STALE_TRADING_DAYS = 3
REASON_FAILED = "failed"
REASON_STALE = "stale"


def _key(market: Market) -> str:
    return f"{KEY_PREFIX}{market.value}"


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def read(db: Session, market: Market) -> dict | None:
    """적어 둔 한 시장. 없거나 깨졌으면 None."""
    raw = app_settings.get_value(db, _key(market))
    if not raw:
        return None
    try:
        saved = json.loads(raw)
    except ValueError:
        return None
    return saved if isinstance(saved, dict) and isinstance(saved.get("at"), str) else None


def _market_of(db: Session, ticker: str) -> Market:
    stored = db.query(Instrument.market).filter(Instrument.ticker == ticker).scalar()
    try:
        return Market(stored) if stored else market_of(ticker)
    except ValueError:
        return market_of(ticker)


def _latest(db: Session, tickers: list[str]):
    if not tickers:
        return None
    return db.query(func.max(PriceDaily.date)).filter(PriceDaily.ticker.in_(tickers)).scalar()


def _behind(market: Market, latest: dt.date | None, today: dt.date | None = None) -> int:
    """가장 새 시세가 마지막 거래일보다 몇 거래일 뒤인가."""
    expected = last_closed_trading_day(market, today=today)
    if expected is None:
        return 0
    if latest is None:
        return STALE_TRADING_DAYS  # 한 줄도 없다 — 막힌 것으로 본다
    if latest >= expected:
        return 0
    return len(trading_days(latest + dt.timedelta(days=1), expected, market))


def record_run(
    db: Session, results: list[dict], *, now: dt.datetime | None = None, today: dt.date | None = None
) -> list[dict]:
    """스케줄러가 돌린 갱신의 결과를 시장마다 적는다. **막힘으로 바뀐** 시장의 줄들을 돌려준다(푸시는 부르는 쪽이).

    `results` — `pipeline.refresh_all_active_stocks` 의 줄들(`{"ticker", ...}`, 실패면 `error` · `providers` · `not_found`).
    """
    now = now or _now()
    by_market: dict[Market, list[dict]] = {}
    for row in results:
        ticker = row.get("ticker")
        if isinstance(ticker, str):
            by_market.setdefault(_market_of(db, ticker), []).append(row)

    became_blocked = []
    for market, rows in by_market.items():
        counted = [r for r in rows if not (r.get("error") and r.get("not_found"))]
        if not counted:
            continue  # 받을 종목 0(또는 오타뿐) — 적지 않는다
        failed = [r for r in counted if r.get("error")]
        providers = sorted({p for r in failed for p in (r.get("providers") or []) if isinstance(p, str)})
        latest = _latest(db, [r["ticker"] for r in counted])
        behind = _behind(market, latest, today=today)
        if failed and len(failed) * 2 >= len(counted):
            reason = REASON_FAILED
        elif behind >= STALE_TRADING_DAYS:
            reason = REASON_STALE
        else:
            reason = None
        before = read(db, market) or {}
        state = {
            "at": now.isoformat(),
            "total": len(counted),
            "failed": len(failed),
            "failed_tickers": [r["ticker"] for r in failed][:MAX_TICKERS],
            "providers": providers,
            "latest_date": latest.isoformat() if latest else None,
            "blocked": reason is not None,
            "reason": reason,
            # 마지막으로 막히지 않았던 실행 — "마지막으로 받은 때"
            "last_ok_at": before.get("last_ok_at") if reason else now.isoformat(),
        }
        app_settings.set_value(db, _key(market), json.dumps(state, ensure_ascii=False))
        if reason and not before.get("blocked"):
            logger.warning("%s 시세 받기가 막혔습니다: %s종목 중 %s개 실패, %s거래일 뒤 (%s)",
                           market.value, len(counted), len(failed), behind, ", ".join(providers) or "-")
            became_blocked.append({"market": market.value, **state})
        elif not reason and before.get("blocked"):
            logger.info("%s 시세를 다시 받기 시작했습니다", market.value)
    return became_blocked


def overview(db: Session) -> list[dict]:
    """진단(관리자) — 적어 둔 시장마다 한 줄. 미국·한국·일본 순."""
    out = []
    for market in Market:
        state = read(db, market)
        if state is not None:
            out.append({"market": market.value, **state})
    return out


def attention(db: Session) -> bool:
    """⋯ 의 점 — 막힌 시장이 하나라도."""
    return any(state.get("blocked") is True for state in overview(db))
