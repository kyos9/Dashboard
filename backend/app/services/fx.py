"""원/달러 환율.

통화가 섞인 포트폴리오에서 비중을 계산하려면 평가금액을 한 통화로 모아야 한다.
환산 없이 원화와 달러를 그냥 더하면 비중이 완전히 틀어진다 (달러 1주가 원화 1주와
같은 무게로 잡힌다).

환율은 아래 순서로 정한다:
  1. 사용자가 직접 입력한 값 (`usd_krw_override`) — 항상 최우선
  2. 마지막으로 조회에 성공해 저장해둔 값
  3. 최후 폴백 상수 — 이 경우 화면에 "추정치"임을 반드시 표시한다

폴백까지 내려갔다는 사실을 숨기면 사용자가 틀린 비중을 맞는 값으로 믿게 되므로,
`FxRate.source`를 항상 화면까지 올려보낸다.
"""

from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.markets import Currency

logger = logging.getLogger(__name__)

# 조회도 못 하고 저장된 값도 없을 때만 쓰는 값. 정확한 환율이 아니라 "0으로 나누지 않기
# 위한" 자리표시자이며, 화면에는 추정치로 표시된다.
FALLBACK_USD_KRW = 1350.0

# 이보다 오래된 저장값은 자동 갱신 대상으로 본다
STALE_AFTER = dt.timedelta(days=1)


@dataclass(frozen=True)
class FxRate:
    """1 USD = usd_krw KRW."""

    usd_krw: float
    source: str  # "override" | "stored" | "fetched" | "fallback"
    updated_at: dt.datetime | None = None

    @property
    def is_estimate(self) -> bool:
        return self.source == "fallback"

    def to_dict(self) -> dict:
        return {
            "usd_krw": self.usd_krw,
            "source": self.source,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "is_estimate": self.is_estimate,
        }


def _fetch_from_yahoo(timeout: int) -> float | None:
    """야후의 `KRW=X` 일봉에서 마지막 종가."""
    try:
        import yfinance as yf

        frame = yf.Ticker("KRW=X").history(
            period="5d", interval="1d", auto_adjust=False, actions=False,
            timeout=timeout, raise_errors=True,
        )
        if frame is None or frame.empty:
            return None
        return float(frame["Close"].dropna().iloc[-1])
    except Exception as exc:
        logger.info("야후 환율 조회 실패: %s", exc)
        return None


def _fetch_from_stooq(timeout: int) -> float | None:
    """Stooq의 `usdkrw` CSV에서 마지막 종가 (야후가 막힌 환경의 대체 경로)."""
    try:
        import io

        import pandas as pd
        import requests

        response = requests.get(
            "https://stooq.com/q/d/l/",
            params={"s": "usdkrw", "i": "d"},
            headers={"User-Agent": "Mozilla/5.0", "Accept": "text/csv"},
            timeout=timeout,
        )
        if response.status_code != 200 or not response.text.lower().startswith("date,"):
            return None
        frame = pd.read_csv(io.StringIO(response.text))
        if frame.empty or "Close" not in frame.columns:
            return None
        return float(pd.to_numeric(frame["Close"], errors="coerce").dropna().iloc[-1])
    except Exception as exc:
        logger.info("Stooq 환율 조회 실패: %s", exc)
        return None


def fetch_usd_krw(timeout: int = 15) -> float | None:
    """원/달러 환율을 조회한다. 전부 막혀 있으면 None."""
    for fetcher in (_fetch_from_yahoo, _fetch_from_stooq):
        rate = fetcher(timeout)
        # 환율이 이 범위를 벗어나면 조회 결과가 잘못된 것으로 본다 (단위 오류 등)
        if rate is not None and 100.0 < rate < 10000.0:
            return rate
    return None


def _settings(db: Session):
    from app.services.settings import get_settings

    return get_settings(db)


def get_usd_krw(db: Session) -> FxRate:
    """지금 적용할 환율. 네트워크를 쓰지 않는다."""
    settings = _settings(db)

    if settings.usd_krw_override:
        return FxRate(float(settings.usd_krw_override), "override", settings.usd_krw_updated_at)
    if settings.usd_krw_rate:
        return FxRate(float(settings.usd_krw_rate), "stored", settings.usd_krw_updated_at)
    return FxRate(FALLBACK_USD_KRW, "fallback", None)


def refresh_usd_krw(db: Session, timeout: int = 15, force: bool = False) -> FxRate:
    """환율을 조회해 저장한다. 실패하면 기존 값을 그대로 유지한다.

    사용자가 직접 지정한 환율이 있으면 조회 자체를 하지 않는다 — 덮어쓰면 안 되므로.
    """
    settings = _settings(db)
    if settings.usd_krw_override:
        return FxRate(float(settings.usd_krw_override), "override", settings.usd_krw_updated_at)

    if not force and settings.usd_krw_rate and settings.usd_krw_updated_at:
        if dt.datetime.utcnow() - settings.usd_krw_updated_at < STALE_AFTER:
            return FxRate(float(settings.usd_krw_rate), "stored", settings.usd_krw_updated_at)

    rate = fetch_usd_krw(timeout=timeout)
    if rate is None:
        return get_usd_krw(db)

    settings.usd_krw_rate = rate
    settings.usd_krw_updated_at = dt.datetime.utcnow()
    db.commit()
    db.refresh(settings)
    return FxRate(rate, "fetched", settings.usd_krw_updated_at)


def base_currency(db: Session) -> Currency:
    settings = _settings(db)
    try:
        return Currency(settings.base_currency)
    except (ValueError, TypeError):
        return Currency.KRW


def convert(amount: float, source: Currency, target: Currency, rate: FxRate) -> float:
    """금액을 기준통화로 환산한다."""
    if source == target:
        return amount
    if source == Currency.USD and target == Currency.KRW:
        return amount * rate.usd_krw
    if source == Currency.KRW and target == Currency.USD:
        return amount / rate.usd_krw
    raise ValueError(f"지원하지 않는 환산: {source.value} -> {target.value}")
