"""시세 제공자 레지스트리 — 순서대로 시도하고, 전부 실패하면 각각의 실제 원인을 모아 알린다.

제공자 순서는 시장별로 다르다. 국내 종목은 네이버를 먼저 쓴다 — 야후가 봇 차단이나
회사망 방화벽에 막히는 환경에서도 국내주식은 받을 수 있어야 하기 때문이다.
"""

from __future__ import annotations

import logging
import os

import pandas as pd

from app.markets import Market, market_of
from app.services.providers.base import (
    EmptyData,
    PriceProvider,
    ProviderError,
    ProviderUnavailable,
    TickerNotFound,
)
from app.services.providers.naver import NaverProvider
from app.services.providers.stooq import StooqProvider
from app.services.providers.yahoo import YahooProvider

logger = logging.getLogger(__name__)

DEFAULT_ORDER: dict[Market, list[str]] = {
    Market.US: ["yahoo", "stooq"],
    Market.KR: ["naver", "yahoo"],
}

_FACTORIES = {
    "yahoo": YahooProvider,
    "stooq": StooqProvider,
    "naver": NaverProvider,
}

# 시장별 순서를 따로 지정할 수 있는 환경변수. 없으면 공통 설정 -> 기본값 순으로 내려간다.
_ENV_BY_MARKET: dict[Market, str] = {
    Market.US: "SIGNAL_DASHBOARD_PROVIDERS_US",
    Market.KR: "SIGNAL_DASHBOARD_PROVIDERS_KR",
}
_ENV_COMMON = "SIGNAL_DASHBOARD_PROVIDERS"


def _timeout() -> int:
    try:
        return int(os.environ.get("SIGNAL_DASHBOARD_HTTP_TIMEOUT", "30"))
    except ValueError:
        return 30


def _parse_order(raw: str) -> list[str]:
    names = [n.strip().lower() for n in raw.split(",") if n.strip()]
    valid = [n for n in names if n in _FACTORIES]
    if names and not valid:
        logger.warning("알 수 없는 제공자 설정 %r — 기본 순서를 사용합니다", raw)
    return valid


def configured_order(market: Market = Market.US) -> list[str]:
    """해당 시장의 제공자 시도 순서.

    우선순위: 시장별 환경변수 -> 공통 환경변수 -> 기본값.
    """
    from_market = _parse_order(os.environ.get(_ENV_BY_MARKET[market], ""))
    if from_market:
        return from_market

    from_common = _parse_order(os.environ.get(_ENV_COMMON, ""))
    if from_common:
        return from_common

    return DEFAULT_ORDER[market]


def provider_overview() -> dict[str, list[str]]:
    """화면(헤더)에서 보여줄 시장별 제공자 순서."""
    return {market.value: configured_order(market) for market in Market}


def build_providers(ticker: str) -> list[PriceProvider]:
    """이 티커를 다룰 수 있는 제공자만 순서대로."""
    timeout = _timeout()
    providers = [_FACTORIES[name](timeout=timeout) for name in configured_order(market_of(ticker))]
    return [p for p in providers if p.supports(ticker)]


class AllProvidersFailed(Exception):
    """모든 제공자가 실패. 어디서 왜 막혔는지 각각의 원인을 담는다."""

    def __init__(self, ticker: str, failures: list[ProviderError]):
        self.ticker = ticker
        self.failures = failures
        detail = " | ".join(f"{f.provider}: {f.message}" for f in failures) or "시도할 제공자가 없습니다"
        super().__init__(f"{ticker} 시세를 받지 못했습니다 — {detail}")

    @property
    def looks_like_bad_ticker(self) -> bool:
        """모든 제공자가 "그런 티커 없다"고 답했으면 오타일 가능성이 높다."""
        return bool(self.failures) and all(isinstance(f, TickerNotFound) for f in self.failures)

    def hint(self) -> str:
        """사용자가 다음에 뭘 해야 할지 한 줄 안내."""
        is_kr = market_of(self.ticker) == Market.KR
        if self.looks_like_bad_ticker:
            if is_kr:
                return (
                    "종목코드를 확인해주세요. 국내주식은 종목명(예: 삼성전자)으로 검색하거나 "
                    "`005930.KS`(코스피) / `247540.KQ`(코스닥) 형태로 입력합니다."
                )
            return "티커 철자를 확인해주세요. 미국 상장 종목은 VOO, QQQ, NVDA처럼 입력합니다."
        if any(isinstance(f, ProviderUnavailable) for f in self.failures):
            return (
                "네트워크에서 시세 서버로 나가지 못하고 있습니다. "
                "백신·방화벽·회사망(프록시)이 막고 있는지 확인해주세요. "
                f"backend 폴더에서 `python diagnose.py {self.ticker}`를 실행하면 "
                "어느 단계에서 막히는지 알 수 있습니다."
            )
        return "잠시 후 다시 시도해주세요."


def fetch_price_history(ticker: str, period: str = "max") -> pd.DataFrame:
    """제공자를 순서대로 시도해 첫 성공을 돌려준다.

    한 제공자가 실패해도 즉시 포기하지 않는다. 야후가 막히는 환경에서도 앱이 돌아가야 하고,
    전부 실패했을 때는 "데이터 없음"이 아니라 제공자별 실제 원인을 올려야 고칠 수 있다.
    """
    failures: list[ProviderError] = []

    for provider in build_providers(ticker):
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
    "provider_overview",
]
