"""야후 파이낸스(yfinance) 연동 — 일봉 OHLCV 수집 및 지표 갱신.

중요: 스펙의 백테스트는 investing.com 종가 기준이므로, 여기서도 분할(split)은 반영하되
배당 재투자 조정은 하지 않은 종가를 사용한다 (`auto_adjust=False`로 받은 Close).
Adj Close는 참고용으로만 별도 컬럼에 저장하고 지표 계산에는 쓰지 않는다.
"""

import datetime as dt
import logging

import pandas as pd
import yfinance as yf
from sqlalchemy.orm import Session

from app.models import IndicatorDaily, PriceDaily, SignalDaily
from app.services.indicators import compute_indicators
from app.services.signals import compute_signals

logger = logging.getLogger(__name__)

# MA200/ADX 워밍업을 감안해 최소한 이만큼의 과거 거래일 데이터를 항상 유지한다.
MIN_LOOKBACK_TRADING_DAYS = 260


class DataIngestionError(Exception):
    pass


def fetch_price_history(ticker: str, period: str = "max") -> pd.DataFrame:
    """yfinance로 일봉 OHLCV 조회."""
    data = yf.download(ticker, period=period, interval="1d", auto_adjust=False, progress=False)
    if data is None or data.empty:
        raise DataIngestionError(f"no data returned for {ticker}")

    if isinstance(data.columns, pd.MultiIndex):
        data.columns = data.columns.get_level_values(0)
    data = data.rename(columns=lambda c: str(c).lower().replace(" ", "_"))
    data.index = pd.to_datetime(data.index).date
    data.index.name = "date"

    required = ["open", "high", "low", "close", "volume"]
    missing = [c for c in required if c not in data.columns]
    if missing:
        raise DataIngestionError(f"missing columns {missing} for {ticker}")
    if "adj_close" not in data.columns:
        data["adj_close"] = data["close"]

    return data[required + ["adj_close"]]


def upsert_prices(db: Session, ticker: str, df: pd.DataFrame) -> int:
    existing = {row.date: row for row in db.query(PriceDaily).filter(PriceDaily.ticker == ticker).all()}
    count = 0
    for date, row in df.iterrows():
        if pd.isna(row["close"]):
            continue
        rec = existing.get(date)
        if rec is None:
            rec = PriceDaily(ticker=ticker, date=date)
            db.add(rec)
        rec.open = float(row["open"])
        rec.high = float(row["high"])
        rec.low = float(row["low"])
        rec.close = float(row["close"])
        rec.adj_close = None if pd.isna(row["adj_close"]) else float(row["adj_close"])
        rec.volume = float(row["volume"])
        count += 1
    db.commit()
    return count


def load_price_frame(db: Session, ticker: str) -> pd.DataFrame:
    rows = (
        db.query(PriceDaily)
        .filter(PriceDaily.ticker == ticker)
        .order_by(PriceDaily.date.asc())
        .all()
    )
    if not rows:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    df = pd.DataFrame(
        {
            "date": [r.date for r in rows],
            "open": [r.open for r in rows],
            "high": [r.high for r in rows],
            "low": [r.low for r in rows],
            "close": [r.close for r in rows],
            "volume": [r.volume for r in rows],
        }
    ).set_index("date")
    return df


def recompute_indicators(db: Session, ticker: str) -> pd.DataFrame:
    price_df = load_price_frame(db, ticker)
    if price_df.empty:
        return price_df

    indicator_df = compute_indicators(price_df)

    existing = {row.date: row for row in db.query(IndicatorDaily).filter(IndicatorDaily.ticker == ticker).all()}
    cols = [
        "ma5", "ma20", "ma50", "ma200", "stddev20",
        "vol_ma5", "vol_ma20", "vol_ratio", "roc5", "disparity",
        "plus_di", "minus_di", "adx",
    ]
    for date, row in indicator_df.iterrows():
        rec = existing.get(date)
        if rec is None:
            rec = IndicatorDaily(ticker=ticker, date=date)
            db.add(rec)
        for col in cols:
            val = row[col]
            setattr(rec, col, None if pd.isna(val) else float(val))
    db.commit()
    return indicator_df


def recompute_signals(db: Session, ticker: str, indicator_df: pd.DataFrame | None = None) -> pd.DataFrame:
    if indicator_df is None:
        price_df = load_price_frame(db, ticker)
        if price_df.empty:
            return price_df
        indicator_df = compute_indicators(price_df)

    signal_df = compute_signals(indicator_df)

    existing = {row.date: row for row in db.query(SignalDaily).filter(SignalDaily.ticker == ticker).all()}
    for date, row in signal_df.iterrows():
        rec = existing.get(date)
        if rec is None:
            rec = SignalDaily(ticker=ticker, date=date)
            db.add(rec)
        rec.knee_buy_v2 = bool(row["knee_buy_v2"])
        rec.shoulder_sell_ref = bool(row["shoulder_sell_ref"])
    db.commit()
    return signal_df


def refresh_ticker(db: Session, ticker: str, full_backfill: bool = False) -> dict:
    """가격 데이터 갱신 + 지표/시그널 재계산. 실패 시 예외를 던지되 이전 데이터는 그대로 유지된다."""
    period = "max" if full_backfill else "2y"
    try:
        price_df = fetch_price_history(ticker, period=period)
    except Exception as exc:  # yfinance/네트워크 예외 전체를 포괄
        logger.warning("failed to fetch price history for %s: %s", ticker, exc)
        raise DataIngestionError(str(exc)) from exc

    n_upserted = upsert_prices(db, ticker, price_df)
    indicator_df = recompute_indicators(db, ticker)
    recompute_signals(db, ticker, indicator_df)
    return {"ticker": ticker, "rows_upserted": n_upserted, "as_of": dt.date.today().isoformat()}
