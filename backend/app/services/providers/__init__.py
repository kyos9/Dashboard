"""시세 제공자 레지스트리 — 순서대로 시도하고, 전부 실패하면 각각의 실제 원인을 모아 알린다."""

from __future__ import annotations

import logging
import os

import pandas as pd

from app.services.providers.base import (
    EmptyData,
    PriceProvider,
    ProviderError,
    ProviderUnavailable,
    TickerNotFound,
)
from app.services.providers.stooq import StooqProvider
from app.services.providers.yahoo import YahooProvider

logger = logging.getLogger(__name__)

DEFAULT_ORDER = ["yahoo", "stooq"]

_FACTORIES = {
    "yahoo": YahooProvider,
    "stooq": StooqProvider,
}


def _timeout() -> int:
    try:
        return int(os.environ.get("SIGNAL_DASHBOARD_HTTP_TIMEOUT", "30"))
    except ValueError:
        return 30


def configured_order() -> list[str]:
    """SIGNAL_DASHBOARD_PROVIDERS로 제공자 순서를 바꿀 수 있다 (예: "stooq,yahoo")."""
    raw = os.environ.get("SIGNAL_DASHBOARD_PROVIDERS", "")
    names = [n.strip().lower() for n in raw.split(",") if n.strip()]
    valid = [n for n in names if n in _FACTORIES]
    if names and not valid:
        logger.warning("알 수 없는 제공자 설정 %r — 기본 순서를 사용합니다", raw)
    return valid or DEFAULT_ORDER


def build_providers() -> list[PriceProvider]:
    timeout = _timeout()
    return [_FACTORIES[name](timeout=timeout) for name in configured_order()]


class AllProvidersFailed(Exception):
    """모든 제공자가 실패. 어디서 왜 막혔는지 각각의 원인을 담는다."""

    def __init__(self, ticker: str, failures: list[ProviderError]):
        self.ticker = ticker
        self.failures = failures
        detail = " | ".join(f"{f.provider}: {f.message}" for f in failures)
        super().__init__(f"{ticker} 시세를 받지 못했습니다 — {detail}")

    @property
    def looks_like_bad_ticker(self) -> bool:
        """모든 제공자가 "그런 티커 없다"고 답했으면 오타일 가능성이 높다."""
        return bool(self.failures) and all(isinstance(f, TickerNotFound) for f in self.failures)

    def hint(self) -> str:
        """사용자가 다음에 뭘 해야 할지 한 줄 안내."""
        if self.looks_like_bad_ticker:
            return "티커 철자를 확인해주세요. 미국 상장 종목은 VOO, QQQ, NVDA처럼 입력합니다."
        if any(isinstance(f, ProviderUnavailable) for f in self.failures):
            return (
                "네트워크에서 시세 서버로 나가지 못하고 있습니다. "
                "백신·방화벽·회사망(프록시)이 막고 있는지 확인해주세요. "
                "backend 폴더에서 `python diagnose.py VOO`를 실행하면 어느 단계에서 막히는지 알 수 있습니다."
            )
        return "잠시 후 다시 시도해주세요."


def fetch_price_history(ticker: str, period: str = "max") -> pd.DataFrame:
    """제공자를 순서대로 시도해 첫 성공을 돌려준다.

    한 제공자가 실패해도 즉시 포기하지 않는다. 야후가 막히는 환경에서도 앱이 돌아가야 하고,
    전부 실패했을 때는 "데이터 없음"이 아니라 제공자별 실제 원인을 올려야 고칠 수 있다.
    """
    failures: list[ProviderError] = []

    for provider in build_providers():
        try:
            df = provider.fetch(ticker, period)
            if failures:
                logger.info(
                    "%s: %s 제공자로 대체 조회 성공 (앞선 실패: %s)",
                    ticker, provider.name, [f.provider for f in failures],
                )
            return df

        except (TickerNotFound, EmptyData, ProviderUnavailable) as exc:
            logger.warning("%s: %s", ticker, exc)
            failures.append(exc)

        except ProviderError as exc:
            logger.warning("%s: %s", ticker, exc)
            failures.append(exc)

        except Exception as exc:  # 제공자 구현 자체의 버그도 다음 제공자를 막지 않는다
            logger.exception("%s: %s 제공자에서 예상치 못한 오류", ticker, provider.name)
            failures.append(ProviderError(provider.name, f"예상치 못한 오류 — {exc}"))

    raise AllProvidersFailed(ticker, failures)


__all__ = [
    "AllProvidersFailed",
    "EmptyData",
    "ProviderError",
    "ProviderUnavailable",
    "TickerNotFound",
    "build_providers",
    "configured_order",
    "fetch_price_history",
]
