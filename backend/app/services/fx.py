"""환율 — 통화별 "1단위 = 몇 원".

통화가 섞인 포트폴리오에서 비중을 계산하려면 평가금액을 한 통화로 모아야 한다.
환산 없이 원화와 달러와 엔을 그냥 더하면 비중이 완전히 틀어진다 (1달러가 1원과 같은
무게로 잡힌다).

**원을 축으로 둔다.** 통화가 셋만 돼도 짝은 여섯이고, 넷이면 열둘이다. 짝마다 값을
들고 있는 대신 각 통화의 원화 환산값 하나씩만 두고, 엔→달러 같은 것은 원을 거쳐
계산한다. 통화를 하나 더 붙일 때 손댈 곳이 아래 표 세 줄로 끝난다.

환율은 통화마다 아래 순서로 정한다:
  1. 사용자가 직접 입력한 값 (`portfolio_settings.fx_overrides`) — 항상 최우선
  2. 마지막으로 조회에 성공해 저장해둔 값 (`fx_rate` 테이블)
  3. 최후 폴백 상수 — 이 경우 화면에 "추정치"임을 반드시 표시한다

폴백까지 내려갔다는 사실을 숨기면 사용자가 틀린 비중을 맞는 값으로 믿게 되므로,
출처를 항상 화면까지 올려보낸다.
"""

from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.markets import Currency

logger = logging.getLogger(__name__)

# 통화를 하나 더 붙이려면 여기 세 줄과 markets.py 를 늘리면 된다.
#
# 폴백은 "맞는 환율"이 아니라 **0으로 나누지 않기 위한 자리표시자**다. 화면에는
# 추정치로 표시된다.
FALLBACK_KRW: dict[Currency, float] = {
    Currency.USD: 1350.0,
    Currency.JPY: 9.0,
}
# 조회 결과가 이 범위를 벗어나면 잘못 받은 것으로 본다 (단위 오류, 엉뚱한 심볼 등).
# 엔은 원과 자릿수가 가까워 달러와 같은 범위를 쓰면 걸러내지 못한다.
VALID_RANGE: dict[Currency, tuple[float, float]] = {
    Currency.USD: (100.0, 10000.0),
    Currency.JPY: (1.0, 100.0),
}
YAHOO_SYMBOL: dict[Currency, str] = {
    Currency.USD: "KRW=X",
    Currency.JPY: "JPYKRW=X",
}
STOOQ_SYMBOL: dict[Currency, str] = {
    Currency.USD: "usdkrw",
    Currency.JPY: "jpykrw",
}

# 이보다 오래된 저장값은 자동 갱신 대상으로 본다
STALE_AFTER = dt.timedelta(days=1)


def tracked_currencies() -> list[Currency]:
    """환율이 필요한 통화 — 기준축인 원을 뺀 나머지."""
    return [c for c in Currency if c is not Currency.KRW]


@dataclass(frozen=True)
class Quote:
    """한 통화의 원화 환산값과 그 출처."""

    currency: Currency
    krw_rate: float
    source: str  # override | stored | fetched | fallback
    updated_at: dt.datetime | None = None

    @property
    def is_estimate(self) -> bool:
        return self.source == "fallback"

    def to_dict(self) -> dict:
        return {
            "currency": self.currency.value,
            "krw_rate": self.krw_rate,
            "source": self.source,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "is_estimate": self.is_estimate,
        }


@dataclass(frozen=True)
class FxRates:
    """지금 적용 중인 환율 묶음."""

    quotes: dict[Currency, Quote]

    def krw_rate(self, currency: Currency) -> float:
        if currency is Currency.KRW:
            return 1.0
        quote = self.quotes.get(currency)
        if quote is not None:
            return quote.krw_rate
        # 여기 오면 통화는 늘렸는데 표를 안 늘린 것이다. 0으로 나누는 것보다는 낫다.
        logger.warning("%s 환율이 없어 폴백을 씁니다", currency.value)
        return FALLBACK_KRW.get(currency, 1.0)

    def quote(self, currency: Currency) -> Quote | None:
        return self.quotes.get(currency)

    def convert(self, amount: float, source: Currency, target: Currency) -> float:
        """금액을 다른 통화로 환산한다 (원을 거쳐서)."""
        if source == target:
            return amount
        return amount * self.krw_rate(source) / self.krw_rate(target)

    @property
    def is_estimate(self) -> bool:
        """하나라도 폴백이면 참 — 화면에서 추정치 표시를 띄운다."""
        return any(quote.is_estimate for quote in self.quotes.values())

    def to_dict(self) -> dict:
        return {
            "rates": {c.value: q.to_dict() for c, q in self.quotes.items()},
            "is_estimate": self.is_estimate,
        }


# ---------------------------------------------------------------------------
#  조회
# ---------------------------------------------------------------------------


def _fetch_from_yahoo(currency: Currency, timeout: int) -> float | None:
    """야후 일봉에서 마지막 종가 (`KRW=X`, `JPYKRW=X`)."""
    symbol = YAHOO_SYMBOL.get(currency)
    if symbol is None:
        return None
    try:
        import yfinance as yf

        frame = yf.Ticker(symbol).history(
            period="5d", interval="1d", auto_adjust=False, actions=False,
            timeout=timeout, raise_errors=True,
        )
        if frame is None or frame.empty:
            return None
        return float(frame["Close"].dropna().iloc[-1])
    except Exception as exc:
        logger.info("야후 환율 조회 실패 (%s): %s", currency.value, exc)
        return None


def _fetch_from_stooq(currency: Currency, timeout: int) -> float | None:
    """Stooq CSV에서 마지막 종가 (야후가 막힌 환경의 대체 경로)."""
    symbol = STOOQ_SYMBOL.get(currency)
    if symbol is None:
        return None
    try:
        import io

        import pandas as pd
        import requests

        response = requests.get(
            "https://stooq.com/q/d/l/",
            params={"s": symbol, "i": "d"},
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
        logger.info("Stooq 환율 조회 실패 (%s): %s", currency.value, exc)
        return None


def fetch_krw_rate(currency: Currency, timeout: int = 15) -> float | None:
    """해당 통화의 원화 환율을 조회한다. 전부 막혀 있으면 None."""
    low, high = VALID_RANGE.get(currency, (0.0, float("inf")))
    for fetcher in (_fetch_from_yahoo, _fetch_from_stooq):
        rate = fetcher(currency, timeout)
        if rate is not None and low < rate < high:
            return rate
        if rate is not None:
            logger.warning("%s 환율 %.4f 가 예상 범위를 벗어나 버립니다", currency.value, rate)
    return None


# ---------------------------------------------------------------------------
#  저장된 값 읽기 · 갱신
# ---------------------------------------------------------------------------


def _settings(db: Session):
    from app.services.settings import get_settings

    return get_settings(db)


def _overrides(db: Session) -> dict[str, float]:
    raw = _settings(db).fx_overrides or {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, float] = {}
    for code, value in raw.items():
        try:
            if value:
                out[str(code).upper()] = float(value)
        except (TypeError, ValueError):
            logger.warning("직접 입력한 환율이 숫자가 아닙니다: %s=%r", code, value)
    return out


def _stored(db: Session) -> dict[str, tuple[float, dt.datetime]]:
    from app.models import FxRate

    return {
        row.currency: (row.krw_rate, row.updated_at) for row in db.query(FxRate).all()
    }


def get_rates(db: Session) -> FxRates:
    """지금 적용할 환율. **네트워크를 쓰지 않는다.**"""
    overrides = _overrides(db)
    stored = _stored(db)
    settings = _settings(db)

    quotes: dict[Currency, Quote] = {}
    for currency in tracked_currencies():
        code = currency.value
        if code in overrides:
            quotes[currency] = Quote(currency, overrides[code], "override", None)
        elif code in stored:
            rate, updated_at = stored[code]
            quotes[currency] = Quote(currency, rate, "stored", updated_at)
        else:
            quotes[currency] = Quote(currency, FALLBACK_KRW.get(currency, 1.0), "fallback", None)

    # settings 를 읽어둔 것은 첫 실행에 설정 한 줄을 만들어두기 위해서다
    _ = settings
    return FxRates(quotes)


def _save(db: Session, currency: Currency, rate: float) -> dt.datetime:
    from app.models import FxRate

    now = dt.datetime.utcnow()
    row = db.get(FxRate, currency.value)
    if row is None:
        row = FxRate(currency=currency.value, krw_rate=rate, source="fetched", updated_at=now)
        db.add(row)
    else:
        row.krw_rate = rate
        row.source = "fetched"
        row.updated_at = now
    db.commit()
    return now


def refresh_rates(db: Session, timeout: int = 15, force: bool = False) -> FxRates:
    """환율을 조회해 저장한다. 실패한 통화는 기존 값을 그대로 둔다.

    사용자가 직접 지정한 통화는 조회 자체를 하지 않는다 — 덮어쓰면 안 되므로.
    """
    overrides = _overrides(db)
    stored = _stored(db)

    for currency in tracked_currencies():
        if currency.value in overrides:
            continue

        if not force and currency.value in stored:
            _, updated_at = stored[currency.value]
            if updated_at and dt.datetime.utcnow() - updated_at < STALE_AFTER:
                continue

        rate = fetch_krw_rate(currency, timeout=timeout)
        if rate is None:
            logger.info("%s 환율을 받지 못해 기존 값을 유지합니다", currency.value)
            continue
        _save(db, currency, rate)

    return get_rates(db)


def base_currency(db: Session) -> Currency:
    settings = _settings(db)
    try:
        return Currency(settings.base_currency)
    except (ValueError, TypeError):
        return Currency.KRW


def set_override(db: Session, currency: Currency, rate: float | None) -> None:
    """직접 입력한 환율을 저장한다. `None`이면 해제하고 자동 조회값으로 돌아간다."""
    settings = _settings(db)
    overrides = dict(settings.fx_overrides or {})
    if rate:
        overrides[currency.value] = float(rate)
    else:
        overrides.pop(currency.value, None)
    # JSON 컬럼은 같은 객체를 고쳐 넣으면 바뀐 걸 모른다. 새 객체로 갈아끼운다.
    settings.fx_overrides = overrides or None
    db.commit()


def convert(amount: float, source: Currency, target: Currency, rates: FxRates) -> float:
    """금액을 기준통화로 환산한다 (`FxRates.convert`와 같다)."""
    return rates.convert(amount, source, target)
