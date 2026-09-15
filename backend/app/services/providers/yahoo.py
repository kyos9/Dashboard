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
