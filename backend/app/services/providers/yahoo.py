"""야후 파이낸스(yfinance) 제공자.

중요 — `yf.download()`를 쓰지 않는다. 그 함수는 내부에서 예외를 삼키고 빈 DataFrame을
돌려주기 때문에, 실패해도 "데이터가 없다"는 것 말고는 아무것도 알 수 없다. 네트워크 차단인지
티커 오타인지 구분이 안 되니 사용자가 고칠 방법이 없다.

대신 `Ticker.history(raise_errors=True)`를 쓴다. 이쪽은 실제 예외(ConnectionError,
타임아웃, HTTP 상태 등)를 그대로 올려주므로 원인을 사용자에게 보여줄 수 있다.
"""

from __future__ import annotations

import logging
import time

import pandas as pd

from app.services.providers.base import (
    EmptyData,
    ProviderError,
    ProviderUnavailable,
    TickerNotFound,
    normalize_frame,
)

logger = logging.getLogger(__name__)

# 티커 자체가 없을 때 yfinance가 내는 메시지에 섞여 나오는 표현들
_NOT_FOUND_HINTS = ("no data found", "delisted", "symbol may be delisted", "not found")


class YahooProvider:
    name = "yahoo"

    def __init__(self, timeout: int = 30, retries: int = 2, retry_wait: float = 1.5):
        self.timeout = timeout
        self.retries = retries
        self.retry_wait = retry_wait

    def supports(self, ticker: str) -> bool:
        """야후는 국내외를 모두 다룬다 (국내는 `005930.KS` 표기)."""
        return True

    def fetch(self, ticker: str, period: str) -> pd.DataFrame:
        import yfinance as yf

        last_error: Exception | None = None

        for attempt in range(1, self.retries + 2):
            try:
                raw = yf.Ticker(ticker).history(
                    period=period,
                    interval="1d",
                    auto_adjust=False,  # 분할만 반영, 배당 미조정 종가를 쓴다
                    actions=False,
                    timeout=self.timeout,
                    raise_errors=True,
                )
                return normalize_frame(raw, self.name, ticker)

            except (EmptyData, ProviderError):
                raise

            except Exception as exc:  # yfinance/네트워크 예외 전체
                last_error = exc
                text = str(exc).lower()

                if any(hint in text for hint in _NOT_FOUND_HINTS):
                    raise TickerNotFound(
                        self.name, f"{ticker}: 야후에 없는 티커로 보입니다 ({exc})"
                    ) from exc

                if attempt <= self.retries:
                    logger.info(
                        "yahoo fetch %s 실패 (%d/%d), 재시도: %s",
                        ticker, attempt, self.retries + 1, exc,
                    )
                    time.sleep(self.retry_wait * attempt)
                    continue

        raise ProviderUnavailable(
            self.name,
            f"{ticker}: {self.retries + 1}회 시도 모두 실패 — "
            f"{type(last_error).__name__}: {last_error}",
        ) from last_error


class YahooMacroProvider:
    """야후를 매크로 지표 제공자로 쓰는 얇은 어댑터 — 종가를 그 날의 값으로 읽는다.

    지수 형태로 거래되는 것(`^VIX`)에만 쓴다. 값이 "그 날의 종가" 하나면 충분하고,
    FRED 의 같은 시리즈(`VIXCLS`)보다 하루 빠르기 때문이다.

    **아무 지수에나 붙이면 안 된다.** 야후의 `^TNX` 는 10년물 금리를 10배로 들고 있어서
    (4.2% -> 42.0) 그대로 쓰면 값이 조용히 열 배가 된다. 같은 단위·같은 정의라고 확인한
    것만 `macro_series` 에 야후로 적는다.
    """

    name = "yahoo"

    def __init__(self, timeout: int = 30):
        self._prices = YahooProvider(timeout=timeout)

    def supports(self, code: str) -> bool:
        return True

    def fetch(self, code, start=None, want_release_dates: bool = False):
        from app.services.providers.macro_base import MacroPoint, normalize_points, period_for

        df = self._prices.fetch(code, period_for(start))
        points = [
            MacroPoint(as_of=as_of, value=float(close))
            for as_of, close in df["close"].items()
            if start is None or as_of >= start
        ]
        return normalize_points(points, self.name, code)
