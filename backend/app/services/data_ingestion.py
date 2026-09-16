"""일봉 OHLCV 수집 및 지표 갱신.

실제 시세 조회는 `app.services.providers`가 맡는다 (야후 → Stooq 순서로 시도).
여기서는 받아온 데이터를 저장하고 지표/시그널을 다시 계산하는 일만 한다.

중요: 스펙의 백테스트는 investing.com 종가 기준이므로, 분할(split)은 반영하되 배당 재투자
조정은 하지 않은 종가를 사용한다. Adj Close는 참고용으로만 저장하고 지표 계산에는 쓰지 않는다.

저장은 "바뀐 행만" 쓴다. 지표는 과거 전 구간을 다시 계산하지만(중간에 값이 틀어지는 걸
막기 위해서다), 어제까지의 결과는 어제와 똑같이 나온다. 그 수천 행을 매번 다시 쓰면
갱신 한 번에 몇백 ms가 그냥 날아간다.
"""

import datetime as dt
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Sequence

import pandas as pd
from sqlalchemy import insert, select, update
from sqlalchemy.orm import Session

from app.models import IndicatorDaily, PriceDaily, SignalDaily
from app.services import providers
from app.services.indicators import compute_indicators
from app.services.signals import compute_signals

logger = logging.getLogger(__name__)

# MA200/ADX 워밍업을 감안해 최소한 이만큼의 과거 거래일 데이터를 항상 유지한다.
MIN_LOOKBACK_TRADING_DAYS = 260

# 여러 종목의 시세를 동시에 받아올 때 쓸 최대 동시 요청 수.
# 대부분이 네트워크 대기 시간이라 늘리면 그만큼 빨라지지만, 개인용 대시보드가
# 거래소·포털에 한꺼번에 몰아칠 이유는 없어서 낮게 잡는다.
MAX_FETCH_WORKERS = 4

PRICE_COLUMNS = ("open", "high", "low", "close", "adj_close", "volume")
INDICATOR_COLUMNS = (
    "ma5", "ma20", "ma50", "ma200", "stddev20",
    "vol_ma5", "vol_ma20", "vol_ratio", "roc5", "disparity",
    "plus_di", "minus_di", "adx",
)
SIGNAL_COLUMNS = ("knee_buy_v2", "shoulder_sell_ref")


class DataIngestionError(Exception):
    """시세 수집 실패. `hint`에는 사용자가 다음에 할 일이 담긴다."""

    def __init__(self, message: str, hint: str = ""):
        self.hint = hint
        super().__init__(message)


def fetch_price_history(
    ticker: str, period: str = "max", prefer: str | None = None
) -> pd.DataFrame:
    """제공자들을 순서대로 시도해 일봉 OHLCV를 가져온다."""
    try:
        return providers.fetch_price_history(ticker, period=period, prefer=prefer)
    except providers.AllProvidersFailed as exc:
        raise DataIngestionError(str(exc), hint=exc.hint()) from exc


def fetch_many(
    requests: Sequence[tuple[str, str | None]], period: str = "2y"
) -> dict[str, pd.DataFrame | DataIngestionError]:
    """여러 종목의 시세를 동시에 받아온다 -> {티커: 데이터 또는 실패 사유}.

    한 종목씩 차례로 받으면 전체 시간이 "종목 수 x 왕복 시간"이 된다. 조회는 거의 전부
    응답을 기다리는 시간이라, 동시에 보내면 그만큼 줄어든다.

    조회만 스레드로 돌린다 — DB 세션은 스레드 간에 나눠 쓸 수 없으므로 저장은 부르는
    쪽에서 한 줄로 이어서 한다. 한 종목이 실패해도 예외를 올리지 않고 그 자리에 담아
    돌려주므로, 나머지 종목의 갱신이 중단되지 않는다.
    """
    if not requests:
        return {}

    results: dict[str, pd.DataFrame | DataIngestionError] = {}

    def one(ticker: str, prefer: str | None):
        try:
            return fetch_price_history(ticker, period=period, prefer=prefer)
        except DataIngestionError as exc:
            return exc
        except Exception as exc:  # 제공자 계층이 못 잡은 예외까지 포괄
            logger.warning("failed to fetch price history for %s: %s", ticker, exc)
            return DataIngestionError(f"{ticker}: {type(exc).__name__} — {exc}")

    workers = min(MAX_FETCH_WORKERS, len(requests))
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="price-fetch") as pool:
        for (ticker, _), outcome in zip(requests, pool.map(lambda r: one(*r), requests)):
            results[ticker] = outcome
    return results


def stored_source(db: Session, ticker: str) -> str | None:
    """이 종목의 시세를 지금까지 준 제공자. 여럿이면(=이미 섞였으면) None."""
    rows = (
        db.query(PriceDaily.source)
        .filter(PriceDaily.ticker == ticker, PriceDaily.source.isnot(None))
        .distinct()
        .all()
    )
    sources = {row[0] for row in rows}
    return next(iter(sources)) if len(sources) == 1 else None


def _clean(value) -> float | None:
    """NaN은 None으로 — DB에는 "값 없음"으로 남겨야 지표 계산에서 다시 NaN이 된다."""
    if value is None:
        return None
    number = float(value)
    return None if number != number else number


def _same(stored, computed) -> bool:
    """이미 저장된 값과 방금 계산한 값이 같은가 (None·NaN까지 같은 것으로 본다)."""
    if stored is None or computed is None:
        return stored is None and computed is None
    return stored == computed or (stored != stored and computed != computed)


def _write(db: Session, model, inserts: list[dict], updates: list[dict]) -> None:
    """바뀐 행만 한 번에 쓴다. 행마다 ORM 객체를 만들지 않아 수천 행에서 차이가 크다."""
    if inserts:
        db.execute(insert(model), inserts)
    if updates:
        db.execute(update(model), updates)
    if inserts or updates:
        db.commit()


def _existing_by_date(db: Session, model, ticker: str, columns: Sequence[str]) -> dict:
    """저장돼 있는 행을 날짜로 찾을 수 있게 (ORM 객체 대신 값만 읽는다)."""
    rows = db.execute(
        select(model.id, model.date, *(getattr(model, c) for c in columns)).where(
            model.ticker == ticker
        )
    ).all()
    return {row.date: row for row in rows}


def upsert_prices(db: Session, ticker: str, df: pd.DataFrame) -> int:
    source = df.attrs.get("provider")
    existing = _existing_by_date(db, PriceDaily, ticker, (*PRICE_COLUMNS, "source"))

    # 한 종목의 히스토리가 여러 제공자에서 왔다면 종가 기준이 다를 수 있다. 값이
    # 이상해 보일 때 여기부터 의심할 수 있도록 남겨둔다.
    previous = {row.source for row in existing.values() if row.source}
    if source and previous and previous != {source}:
        logger.warning(
            "%s: 시세 출처가 바뀌었습니다 (기존 %s → %s). 제공자마다 종가 기준이 다르면 "
            "이어붙인 지점에서 지표가 튈 수 있습니다.",
            ticker, ", ".join(sorted(previous)), source,
        )

    inserts: list[dict] = []
    updates: list[dict] = []
    for row in df[list(PRICE_COLUMNS)].itertuples(index=True, name=None):
        date, values = row[0], row[1:]
        record = {col: _clean(value) for col, value in zip(PRICE_COLUMNS, values)}
        if record["close"] is None:
            continue

        old = existing.get(date)
        if old is None:
            inserts.append({"ticker": ticker, "date": date, "source": source, **record})
            continue

        record["source"] = source or old.source
        if any(not _same(getattr(old, col), record[col]) for col in (*PRICE_COLUMNS, "source")):
            updates.append({"id": old.id, **record})

    _write(db, PriceDaily, inserts, updates)
    return len(inserts) + len(updates)


def load_price_frame(db: Session, ticker: str) -> pd.DataFrame:
    rows = db.execute(
        select(
            PriceDaily.date, PriceDaily.open, PriceDaily.high,
            PriceDaily.low, PriceDaily.close, PriceDaily.volume,
        )
        .where(PriceDaily.ticker == ticker)
        .order_by(PriceDaily.date.asc())
    ).all()
    if not rows:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    return pd.DataFrame(
        rows, columns=["date", "open", "high", "low", "close", "volume"]
    ).set_index("date")


def recompute_indicators(db: Session, ticker: str) -> pd.DataFrame:
    price_df = load_price_frame(db, ticker)
    if price_df.empty:
        return price_df

    indicator_df = compute_indicators(price_df)
    existing = _existing_by_date(db, IndicatorDaily, ticker, INDICATOR_COLUMNS)

    inserts: list[dict] = []
    updates: list[dict] = []
    for row in indicator_df[list(INDICATOR_COLUMNS)].itertuples(index=True, name=None):
        date, values = row[0], row[1:]
        record = {col: _clean(value) for col, value in zip(INDICATOR_COLUMNS, values)}
        old = existing.get(date)
        if old is None:
            inserts.append({"ticker": ticker, "date": date, **record})
        elif any(not _same(getattr(old, col), record[col]) for col in INDICATOR_COLUMNS):
            updates.append({"id": old.id, **record})

    _write(db, IndicatorDaily, inserts, updates)
    return indicator_df


def recompute_signals(db: Session, ticker: str, indicator_df: pd.DataFrame | None = None) -> pd.DataFrame:
    if indicator_df is None:
        price_df = load_price_frame(db, ticker)
        if price_df.empty:
            return price_df
        indicator_df = compute_indicators(price_df)

    signal_df = compute_signals(indicator_df)
    existing = _existing_by_date(db, SignalDaily, ticker, SIGNAL_COLUMNS)

    inserts: list[dict] = []
    updates: list[dict] = []
    for row in signal_df[list(SIGNAL_COLUMNS)].itertuples(index=True, name=None):
        date, values = row[0], row[1:]
        record = {col: bool(value) for col, value in zip(SIGNAL_COLUMNS, values)}
        old = existing.get(date)
        if old is None:
            inserts.append({"ticker": ticker, "date": date, **record})
        elif any(bool(getattr(old, col)) != record[col] for col in SIGNAL_COLUMNS):
            updates.append({"id": old.id, **record})

    _write(db, SignalDaily, inserts, updates)
    return signal_df


def refresh_ticker(
    db: Session,
    ticker: str,
    full_backfill: bool = False,
    price_df: pd.DataFrame | None = None,
) -> dict:
    """가격 데이터 갱신 + 지표/시그널 재계산. 실패 시 예외를 던지되 이전 데이터는 그대로 유지된다.

    `price_df`를 주면 조회를 건너뛴다 — 여러 종목을 동시에 받아온 뒤(`fetch_many`)
    저장만 차례로 할 때 쓴다.
    """
    if price_df is None:
        period = "max" if full_backfill else "2y"
        # 이 종목을 지금까지 받아온 곳을 먼저 시도한다 (섞이지 않게)
        prefer = None if full_backfill else stored_source(db, ticker)
        try:
            price_df = fetch_price_history(ticker, period=period, prefer=prefer)
        except DataIngestionError:
            raise  # 원인과 안내(hint)가 이미 담겨 있으므로 그대로 올린다
        except Exception as exc:  # 제공자 계층이 못 잡은 예외까지 포괄
            logger.warning("failed to fetch price history for %s: %s", ticker, exc)
            raise DataIngestionError(f"{ticker}: {type(exc).__name__} — {exc}") from exc

    n_upserted = upsert_prices(db, ticker, price_df)
    indicator_df = recompute_indicators(db, ticker)
    recompute_signals(db, ticker, indicator_df)
    return {"ticker": ticker, "rows_upserted": n_upserted, "as_of": dt.date.today().isoformat()}
