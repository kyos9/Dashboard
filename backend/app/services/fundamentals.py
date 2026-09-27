"""재무 지표 — 받아서 저장하고, 화면에 줄 모양으로 읽는다 (ROADMAP 3b).

계산은 `fundamental_calc` 가 한다. 여기는 DB 와 출처, 그리고 **언제 다시 받을지**다.

언제 받나
- 공시는 1년에 네 번뿐이다. 평소에는 마지막 확인 뒤 **7일**이 지난 종목만 본다.
- **실적 시즌에는 매일.** 기준은 달력이 아니라 그 종목 자신이다 — 저장된 마지막 분기가
  끝난 지 110일이 지났으면(= 다음 분기가 끝나고 3주쯤 지났으면) 새 공시를 기다리는 중이다.
  엔비디아는 7월 말, 알파벳은 6월 말에 분기가 끝나므로 둘의 "시즌"은 한 달 가까이 어긋난다.
- 새 종목은 등록하자마자 뒤에서 받는다.
- 실패했으면 다음 날 다시 본다.

어디서 받나 — 미국은 SEC(키 없음), 한국은 DART(운영자 키 `DART_API_KEY`), 일본은 야후(발표일, 없으면 추정).
"""

from __future__ import annotations

import datetime as dt
import logging
import threading
from typing import Callable

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.markets import Market, market_of
from app.models import FundamentalFact, FundamentalStatus, PriceDaily, StockSplit
from app.services import fundamental_calc as calc
from app.services.providers import dart, sec, yahoo_fin

logger = logging.getLogger(__name__)

STATE_OK = "ok"
STATE_NONE = "none"                # 재무제표가 없는 종목 (ETF 등) — 화면에서 숨긴다
STATE_UNSUPPORTED = "unsupported"  # 아직 못 읽는 출처
STATE_ERROR = "error"

RECHECK_DAYS = 7
SEASON_AFTER_DAYS = 110
SEASON_UNTIL_DAYS = 250

METRIC_LABELS = {
    "revenue": "매출",
    "operating_income": "영업이익",
    "net_income": "순이익",
    "eps_diluted": "EPS",
    "equity": "자본",
    "operating_cf": "영업현금흐름",
    "capex": "설비투자",
}

# 재무제표가 아예 없을 때 화면에 적는 말 (출처마다 이유가 다르다)
EMPTY_MESSAGES = {
    sec.SOURCE: "재무제표가 없는 종목입니다 (ETF·펀드 등)",
    dart.SOURCE: "DART 에 정기보고서(분기·반기·사업보고서)가 아직 없습니다",
    yahoo_fin.SOURCE: "야후에 재무제표가 없는 종목입니다",
}
SOURCES = {Market.US: sec.SOURCE, Market.KR: dart.SOURCE, Market.JP: yahoo_fin.SOURCE}


# --- 언제 받나 --------------------------------------------------------------------

def is_due(status: FundamentalStatus | None, latest_end: dt.date | None, now: dt.datetime) -> bool:
    if status is None or status.checked_at is None:
        return True
    if status.checked_at.date() >= now.date():
        return False  # 오늘 이미 봤다
    if status.state == STATE_ERROR:
        return True
    if now - status.checked_at >= dt.timedelta(days=RECHECK_DAYS):
        return True
    if status.state == STATE_OK and latest_end is not None:
        waited = (now.date() - latest_end).days
        return SEASON_AFTER_DAYS <= waited <= SEASON_UNTIL_DAYS
    return False


def _latest_end(db: Session, ticker: str) -> dt.date | None:
    return db.query(func.max(FundamentalFact.period_end)).filter(
        FundamentalFact.ticker == ticker, FundamentalFact.metric.in_(("revenue", "eps_diluted"))
    ).scalar()


# --- 받기 -------------------------------------------------------------------------

def fetch_splits(ticker: str) -> list[tuple[dt.date, float]]:
    """액면분할 이력 (야후). 공시에는 분할이 따로 나오지 않는다."""
    import yfinance as yf

    series = yf.Ticker(ticker).splits
    out = []
    for when, ratio in series.items():
        try:
            out.append((when.date(), float(ratio)))
        except (AttributeError, TypeError, ValueError):
            continue
    return out


def _save_splits(db: Session, ticker: str, splits: list[tuple[dt.date, float]]) -> None:
    have = {row.date for row in db.query(StockSplit).filter(StockSplit.ticker == ticker)}
    for day, ratio in splits:
        if day not in have and ratio > 0:
            db.add(StockSplit(ticker=ticker, date=day, ratio=ratio))


def _save_facts(db: Session, ticker: str, rows: list[dict], today: dt.date | None = None) -> int:
    """없는 줄만 넣는다. **있는 줄은 고치지 않는다** — 정정은 다른 공시일의 새 줄로 온다.

    같은 기간을 **더 늦은 공시일에 같은 값**으로 다시 받으면 넣지 않는다. DART 는 정정 공시가
    나오면 정정일로 다시 주는데, 값이 그대로인 항목까지 줄이 늘면 "정정됨"으로 잘못 보인다.

    야후는 공시일이 없다(발표일 목록에서 찾거나 추정). 이미 받은 기간을 다시 받으면 **가장 최근 값과
    비교해** 같으면 날짜가 달라도 새 줄이 아니고, 다르면 **오늘 안 것**으로 적는다 — 옛 날짜로 넣으면
    그때 알던 것처럼 된다.
    """
    today = today or dt.date.today()
    have: set[tuple] = set()
    earlier: dict[tuple, list[tuple[dt.date, float]]] = {}
    for source, metric, start, end, filed, value in db.query(
        FundamentalFact.source, FundamentalFact.metric, FundamentalFact.period_start,
        FundamentalFact.period_end, FundamentalFact.filed_at, FundamentalFact.value,
    ).filter(FundamentalFact.ticker == ticker):
        have.add((source, metric, start, end, filed))
        earlier.setdefault((source, metric, start, end), []).append((filed, value))
    added = 0
    for row in rows:
        period = (row["source"], row["metric"], row["period_start"], row["period_end"])
        versions = earlier.get(period, [])
        if row["source"] == yahoo_fin.SOURCE and versions:
            # 이미 받은 기간 — 날짜는 오늘로 두고, 아래에서 가장 최근 값과 같으면 건너뛴다
            row = {**row, "filed_at": max(today, row["filed_at"]), "filed_estimated": True}
        if (*period, row["filed_at"]) in have:
            continue
        prior = [version for version in versions if version[0] < row["filed_at"]]
        if prior and _same(max(prior)[1], row["value"]):
            continue
        have.add((*period, row["filed_at"]))
        earlier.setdefault(period, []).append((row["filed_at"], row["value"]))
        db.add(FundamentalFact(ticker=ticker, **row))
        added += 1
    return added


def _same(a: float, b: float) -> bool:
    return abs(a - b) <= 1e-9 * max(1.0, abs(a), abs(b))


def _set_status(db: Session, ticker: str, state: str, message: str | None, source: str | None,
                now: dt.datetime) -> None:
    status = db.get(FundamentalStatus, ticker)
    if status is None:
        status = FundamentalStatus(ticker=ticker)
        db.add(status)
    status.state = state
    status.message = message
    status.source = source
    status.checked_at = now
    if state == STATE_OK:
        status.ok_at = now


def _has_facts(db: Session, ticker: str, source: str) -> bool:
    return db.query(FundamentalFact.id).filter(
        FundamentalFact.ticker == ticker, FundamentalFact.source == source
    ).first() is not None


def _fetch(db: Session, ticker: str, market: Market, today: dt.date) -> tuple[str, sec.ParsedFacts]:
    """출처에서 받아 저장할 모양으로. 출처의 예외(`NotListed`·`…Error`)는 그대로 올린다."""
    if market == Market.US:
        data = sec.fetch_companyfacts(sec.cik_for(ticker))
        return sec.SOURCE, sec.parse_companyfacts(data, today=today) if data else sec.ParsedFacts(empty=True)
    if market == Market.JP:
        return yahoo_fin.SOURCE, yahoo_fin.parse(yahoo_fin.fetch(ticker), today)
    # DART 는 보고서마다 한 번씩 묻는다 — 처음에만 7년을, 그 뒤로는 최근 보고서만
    return dart.SOURCE, dart.collect(ticker, today, backfill=not _has_facts(db, ticker, dart.SOURCE))


def refresh_ticker(db: Session, ticker: str, now: dt.datetime | None = None) -> dict:
    """한 종목의 재무를 받는다. 실패해도 예외를 올리지 않고 결과에 적는다 (받아둔 값은 그대로)."""
    now = now or dt.datetime.utcnow()
    market = market_of(ticker)
    source = SOURCES[market]
    try:
        source, parsed = _fetch(db, ticker, market, now.date())
    except (sec.NotListed, dart.NotListed, yahoo_fin.NotListed) as exc:
        _set_status(db, ticker, STATE_NONE, str(exc), source, now)
        db.commit()
        return {"ticker": ticker, "state": STATE_NONE}
    except dart.NoKey as exc:
        # 오류가 아니라 설정이다 — 매일 되묻지 않고 평소 주기(7일)로 본다
        _set_status(db, ticker, STATE_UNSUPPORTED, str(exc), source, now)
        db.commit()
        return {"ticker": ticker, "state": STATE_UNSUPPORTED}
    except (sec.SecError, dart.DartError, yahoo_fin.YahooError) as exc:
        db.rollback()
        _set_status(db, ticker, STATE_ERROR, str(exc), source, now)
        db.commit()
        logger.warning("재무 %s: %s", ticker, exc)
        return {"ticker": ticker, "state": STATE_ERROR, "error": str(exc)}

    if parsed.unsupported:
        _set_status(db, ticker, STATE_UNSUPPORTED, parsed.unsupported, source, now)
        db.commit()
        return {"ticker": ticker, "state": STATE_UNSUPPORTED}
    if parsed.empty:
        _set_status(db, ticker, STATE_NONE, EMPTY_MESSAGES[source], source, now)
        db.commit()
        return {"ticker": ticker, "state": STATE_NONE}

    added = _save_facts(db, ticker, parsed.rows, now.date())
    try:
        _save_splits(db, ticker, fetch_splits(ticker))
    except Exception as exc:  # 분할은 드물다 — 못 받아도 지난번 것으로 계산한다
        logger.info("분할 이력 %s: %s", ticker, exc)
    message = None
    if parsed.missing:
        message = "공시에 없는 항목: " + ", ".join(METRIC_LABELS.get(m, m) for m in parsed.missing)
    _set_status(db, ticker, STATE_OK, message, source, now)
    db.commit()
    return {"ticker": ticker, "state": STATE_OK, "added": added}


def _key_arrived(status: FundamentalStatus | None) -> bool:
    """키가 없어 건너뛴 한국 종목 — 운영자가 키를 넣고 다시 띄웠으면 7일을 기다리지 않는다."""
    return (status is not None and status.state == STATE_UNSUPPORTED
            and status.message == dart.NO_KEY_MESSAGE and bool(dart.api_key()))


def refresh_due(db: Session, tickers: list[str], now: dt.datetime | None = None) -> list[dict]:
    now = now or dt.datetime.utcnow()
    statuses = {
        s.ticker: s for s in db.query(FundamentalStatus).filter(FundamentalStatus.ticker.in_(tickers))
    }
    results = []
    for ticker in tickers:
        status = statuses.get(ticker)
        if not (is_due(status, _latest_end(db, ticker), now) or _key_arrived(status)):
            continue
        try:
            results.append(refresh_ticker(db, ticker, now))
        except Exception as exc:  # 한 종목 때문에 나머지를 멈추지 않는다
            db.rollback()
            logger.exception("재무 %s 갱신 실패", ticker)
            results.append({"ticker": ticker, "state": STATE_ERROR, "error": f"{type(exc).__name__}: {exc}"})
    return results


def _in_thread(work: Callable[[], None]) -> None:
    threading.Thread(target=work, name="fundamentals", daemon=True).start()


# 테스트는 "바로 실행"으로 바꿔 끼운다 (backfill.RUNNER 와 같다)
RUNNER: Callable[[Callable[[], None]], None] = _in_thread


def refresh_in_background(session_factory, ticker: str) -> None:
    """새 종목 — 시세를 받은 뒤 재무도 뒤에서. 화면의 "받는 중"을 붙잡지 않게 따로 돈다."""

    def work() -> None:
        db = session_factory()
        try:
            refresh_due(db, [ticker])
        except Exception:
            logger.warning("재무 %s 를 뒤에서 받지 못했습니다", ticker, exc_info=True)
        finally:
            db.close()

    RUNNER(work)


# --- 읽기 -------------------------------------------------------------------------

def _facts_by_ticker(db: Session, tickers: list[str]) -> dict[str, list[calc.Fact]]:
    out: dict[str, list[calc.Fact]] = {t: [] for t in tickers}
    if not tickers:
        return out
    # 야후 값은 이미 지금 주식 기준(분할 반영)으로 온다 — 다시 나누지 않는다
    adjusted: dict[str, list[calc.Fact]] = {t: [] for t in tickers}
    rows = db.query(
        FundamentalFact.ticker, FundamentalFact.metric, FundamentalFact.period_start,
        FundamentalFact.period_end, FundamentalFact.value, FundamentalFact.filed_at,
        FundamentalFact.filed_estimated, FundamentalFact.source,
    ).filter(FundamentalFact.ticker.in_(tickers))
    for t, metric, start, end, value, filed, estimated, source in rows:
        target = adjusted if source == yahoo_fin.SOURCE else out
        target[t].append(calc.Fact(metric, start, end, value, filed, bool(estimated)))
    splits: dict[str, list[tuple[dt.date, float]]] = {}
    for row in db.query(StockSplit).filter(StockSplit.ticker.in_(tickers)):
        splits.setdefault(row.ticker, []).append((row.date, row.ratio))
    return {t: calc.adjust_for_splits(facts, splits.get(t, [])) + adjusted[t] for t, facts in out.items()}


def detail(db: Session, ticker: str, currency: str, today: dt.date | None = None,
           with_quarters: bool = True) -> dict:
    """종목 하나의 재무 — 차트 팝업의 "재무" 탭. 목록 화면은 분기 표를 빼고 같은 것을 쓴다."""
    today = today or dt.date.today()
    status = db.get(FundamentalStatus, ticker)
    facts = _facts_by_ticker(db, [ticker])[ticker]
    prices = [
        (day, close) for day, close in db.query(PriceDaily.date, PriceDaily.close)
        .filter(PriceDaily.ticker == ticker, PriceDaily.date >= today - dt.timedelta(days=366 * 6))
        .order_by(PriceDaily.date.asc())
    ]
    price = prices[-1][1] if prices else None
    out = {
        "ticker": ticker,
        "state": status.state if status else None,
        "message": status.message if status else None,
        "source": status.source if status else None,
        "checked_at": status.checked_at if status else None,
        "currency": currency,
        "price": price,
        "price_date": prices[-1][0] if prices else None,
        "metrics": [],
        "per_range": None,
        "quarters": [],
    }
    if not facts:
        return out
    snap = calc.snapshot(facts, price)
    out["metrics"] = list(snap.values())
    out["per_range"] = calc.per_history(facts, prices, snap["per"]["value"], today)
    if with_quarters:
        out["quarters"] = calc.quarter_table(facts)
    return out


def overview(db: Session, stocks, today: dt.date | None = None) -> list[dict]:
    """"재무" 화면 — 담은 종목마다 지표 한 줄. 순서는 받은 그대로(대시보드 순서)."""
    rows = []
    for stock in stocks:
        row = detail(db, stock.ticker, stock.currency, today, with_quarters=False)
        row["name"] = stock.name
        row["category"] = stock.category
        rows.append(row)
    return rows
