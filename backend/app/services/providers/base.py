"""시세 제공자 공통 규약.

한 곳(야후)에만 의존하면 그쪽이 막히는 순간 앱 전체가 멈춘다. 제공자를 갈아끼울 수 있게
공통 규약을 두고, 실패 원인을 종류별로 구분해 위로 올린다.

모든 제공자는 아래 형태의 DataFrame을 돌려준다:
  - index: `datetime.date` (이름 "date", 오름차순, 중복 없음)
  - columns: open, high, low, close, adj_close, volume

종가는 분할(split)만 반영하고 배당 재투자 조정은 하지 않은 값이어야 한다
(SIGNAL_APP_SPEC.md의 investing.com 종가 기준 백테스트와 정합성을 맞추기 위함).
"""

from __future__ import annotations

import datetime as dt
from typing import Protocol

import pandas as pd

REQUIRED_COLUMNS = ["open", "high", "low", "close", "adj_close", "volume"]

# period 문자열 -> 대략적인 일수. 날짜 범위로만 조회할 수 있는 제공자를 위해 쓴다.
PERIOD_DAYS: dict[str, int] = {
    "1mo": 31,
    "3mo": 92,
    "6mo": 183,
    "1y": 366,
    "2y": 731,
    "5y": 1827,
    "10y": 3653,
    "ytd": 366,
}


class ProviderError(Exception):
    """제공자에서 시세를 못 받았을 때의 공통 예외."""

    def __init__(self, provider: str, message: str):
        self.provider = provider
        self.message = message
        super().__init__(f"[{provider}] {message}")


class ProviderUnavailable(ProviderError):
    """네트워크 차단·타임아웃·차단(rate limit) 등 제공자 쪽 문제. 다른 제공자로 넘어갈 가치가 있다."""


class TickerNotFound(ProviderError):
    """제공자는 정상 응답했지만 해당 티커를 모른다. 철자 문제일 가능성이 높다."""


class EmptyData(ProviderError):
    """정상 응답했는데 행이 하나도 없다 (상장폐지, 너무 짧은 기간 등)."""


def period_start_date(period: str, today: dt.date | None = None) -> dt.date | None:
    """period 문자열을 시작일로 바꾼다. "max"처럼 전체 조회는 None."""
    if period == "max":
        return None
    today = today or dt.date.today()
    if period == "ytd":
        return dt.date(today.year, 1, 1)
    days = PERIOD_DAYS.get(period)
    if days is None:
        return None
    return today - dt.timedelta(days=days)


def normalize_frame(df: pd.DataFrame, provider: str, ticker: str) -> pd.DataFrame:
    """제공자별 원본 프레임을 공통 형태로 맞춘다."""
    if df is None or df.empty:
        raise EmptyData(provider, f"{ticker}: 행이 없는 응답")

    df = df.copy()

    # MultiIndex 컬럼(여러 종목을 한 번에 받을 때 생김)을 평탄화
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    df = df.rename(columns=lambda c: str(c).strip().lower().replace(" ", "_"))

    if "adj_close" not in df.columns:
        # 배당 미조정 종가만 쓰므로 없으면 종가로 채운다 (지표 계산에는 쓰지 않는 참고 필드)
        df["adj_close"] = df.get("close")

    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ProviderError(provider, f"{ticker}: 컬럼 누락 {missing} (받은 컬럼: {list(df.columns)})")

    df.index = pd.to_datetime(df.index).date
    df.index.name = "date"

    df = df[REQUIRED_COLUMNS]
    df = df[df["close"].notna()]
    # 같은 날짜가 두 번 오면 뒤엣것을 남긴다
    df = df[~df.index.duplicated(keep="last")].sort_index()

    if df.empty:
        raise EmptyData(provider, f"{ticker}: 유효한 종가가 있는 행이 없음")
    return df


class PriceProvider(Protocol):
    """일봉 OHLCV를 돌려주는 제공자."""

    name: str

    def supports(self, ticker: str) -> bool:
        """이 제공자가 해당 티커를 다룰 수 있는지.

        다루지 못하는 티커는 아예 시도하지 않는다 — Stooq에 한국 종목을 물어보면
        "그런 심볼 없음"이 돌아오는데, 그걸 실패 사유로 보여주면 사용자가 티커 오타로
        오해하게 된다.
        """
        ...

    def fetch(self, ticker: str, period: str) -> pd.DataFrame: ...
