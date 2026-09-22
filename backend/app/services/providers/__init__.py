"""제공자 레지스트리 — 순서대로 시도하고, 전부 실패하면 각각의 실제 원인을 모아 알린다.

시세와 매크로 지표 두 갈래가 있고, 생각은 같다. 한 곳에만 의존하면 그쪽이 막히는 순간
화면이 멈추므로 여러 곳을 순서대로 시도하고, 전부 실패했을 때는 "데이터 없음"이 아니라
제공자별 실제 원인을 올린다 — 그래야 사용자가 고칠 수 있다.

순서를 정하는 주체만 다르다. 시세는 **시장**이 정한다 (국내 종목은 네이버를 먼저 쓴다 —
야후가 봇 차단이나 회사망 방화벽에 막히는 환경에서도 국내주식은 받을 수 있어야 하므로).
매크로는 지표마다 사는 곳이 달라서 `macro_series` 행이 직접 정한다.
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
from app.services.providers.cnn import FearGreedProvider
from app.services.providers.fred import FredApiProvider, FredCsvProvider
from app.services.providers.macro_base import MacroPoint, MacroProvider
from app.services.providers.naver import NaverProvider
from app.services.providers.stooq import StooqProvider
from app.services.providers.yahoo import YahooMacroProvider, YahooProvider

logger = logging.getLogger(__name__)

DEFAULT_ORDER: dict[Market, list[str]] = {
    Market.US: ["yahoo", "stooq"],
    Market.KR: ["naver", "yahoo"],
    # 일본은 네이버가 다루지 않는다. Stooq는 도쿄 종목을 `7203.jp`로 갖고 있어
    # 대체 경로로 남겨두지만, 먼저 쓰는 것은 야후다.
    Market.JP: ["yahoo", "stooq"],
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
    Market.JP: "SIGNAL_DASHBOARD_PROVIDERS_JP",
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


def build_providers(ticker: str, prefer: str | None = None) -> list[PriceProvider]:
    """이 티커를 다룰 수 있는 제공자만 순서대로.

    `prefer`는 이미 이 종목의 시세를 준 적 있는 제공자다. 있으면 맨 앞으로 올린다 —
    제공자마다 종가 기준이 조금씩 다를 수 있어서, 한 종목은 되도록 한 곳에서만
    받아야 이어붙인 지점에서 지표가 튀지 않는다. (그 제공자가 막혀 있으면 평소 순서대로
    다음 제공자로 넘어간다. 값이 아예 없는 것보다는 낫다.)
    """
    order = configured_order(market_of(ticker))
    if prefer in _FACTORIES and prefer in order:
        order = [prefer] + [name for name in order if name != prefer]

    timeout = _timeout()
    providers = [_FACTORIES[name](timeout=timeout) for name in order]
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


def fetch_price_history(ticker: str, period: str = "max", prefer: str | None = None) -> pd.DataFrame:
    """제공자를 순서대로 시도해 첫 성공을 돌려준다.

    한 제공자가 실패해도 즉시 포기하지 않는다. 야후가 막히는 환경에서도 앱이 돌아가야 하고,
    전부 실패했을 때는 "데이터 없음"이 아니라 제공자별 실제 원인을 올려야 고칠 수 있다.
    """
    failures: list[ProviderError] = []

    for provider in build_providers(ticker, prefer=prefer):
        try:
            df = provider.fetch(ticker, period)
            # 어느 제공자가 준 값인지 호출부가 알 수 있게 (저장할 때 기록한다)
            df.attrs["provider"] = provider.name
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


# ---------------------------------------------------------------------------
#  매크로 지표 제공자
# ---------------------------------------------------------------------------
#
#  시세와 같은 구조를 쓰되 순서를 정하는 방식이 다르다. 시세는 **시장**이 순서를
#  정하지만(국내는 네이버 먼저), 매크로는 지표마다 사는 곳이 달라서 `macro_series`
#  행이 직접 정한다. 지표를 늘릴 때 코드를 안 고쳐도 되게 하려면 그래야 한다.

_MACRO_FACTORIES = {
    # "fred" 하나가 두 제공자로 펼쳐진다 — 키가 있으면 공식 API, 없거나 막히면 CSV.
    # 키 발급이 진입 장벽이므로 키 없이도 값은 나와야 한다.
    "fred": lambda timeout: [FredApiProvider(timeout=timeout), FredCsvProvider(timeout=timeout)],
    "yahoo": lambda timeout: [YahooMacroProvider(timeout=timeout)],
    # 공포·탐욕 지수. 갈 곳이 여기뿐이라 한 개다 (`cnn.py` 의 설명 참고).
    "cnn": lambda timeout: [FearGreedProvider(timeout=timeout)],
}


# 매크로는 시세보다 **넉넉하게** 기다린다.
#
# 둘째로, 아무도 화면 앞에서 기다리고 있지 않다 — 배치가 밤에 받는 값이다. 시세는
# 사람이 "새로고침"을 누르고 보고 있으므로 빨리 포기하는 편이 낫지만, 여기서 30초에
# 포기하면 그 지표는 하루를 통째로 건너뛴다.
#
# 첫째로, `fredgraph.csv` 는 그래프 화면이 쓰는 주소라 범위가 넓으면 느리다. 첫 수집은
# 20년치를 받으므로 가장 느린 요청이 하필 가장 중요한 요청이다 — 그게 넘어가면 지표가
# 영영 비어 있고, 2시간마다 같은 자리에서 다시 실패한다.
#
# 시세와 같은 환경변수로 덮어쓸 수 있게 두되, 기본값만 다르게 간다.
def macro_timeout() -> int:
    raw = os.environ.get("SIGNAL_DASHBOARD_HTTP_TIMEOUT")
    if raw:
        try:
            return int(raw)
        except ValueError:
            pass
    return 60


def build_macro_providers(source: str) -> list[MacroProvider]:
    """출처 이름 하나를 제공자 목록으로. 모르는 이름이면 빈 목록이다.

    **일부러 한 곳만 받는다.** 폴백까지 한 번에 펼쳐 돌려주면 호출부가 전부 같은 코드로
    물어보게 되는데, 같은 지표라도 부르는 이름이 곳마다 다르다 (`^VIX` / `VIXCLS`).
    폴백을 어떤 코드로 물을지는 `fetch_macro_points` 가 정한다.
    """
    factory = _MACRO_FACTORIES.get((source or "").strip().lower())
    return list(factory(macro_timeout())) if factory else []


class AllMacroProvidersFailed(Exception):
    """모든 제공자가 실패. 어디서 왜 막혔는지 각각의 원인을 담는다."""

    def __init__(self, code: str, failures: list[ProviderError]):
        self.code = code
        self.failures = failures
        detail = " | ".join(f"{f.provider}: {f.message}" for f in failures) or "시도할 제공자가 없습니다"
        super().__init__(f"{code} 지표를 받지 못했습니다 — {detail}")

    @property
    def providers(self) -> list[str]:
        """실제로 실패한 곳들. 순서는 시도한 순서대로, 중복 없이."""
        names: list[str] = []
        for failure in self.failures:
            if failure.provider not in names:
                names.append(failure.provider)
        return names

    def hint(self) -> str:
        """**어디가 막혔는지 이름을 적는다.**

        예전에는 전부 "FRED 로 나가지 못하고 있습니다" 라고 했다. 지표마다 출처가 다른데
        한 곳 이름을 박아둔 탓이다. 공포·탐욕 지수(CNN)가 실패했을 때 실제로 FRED 방화벽을
        확인하라고 안내했다 — FRED 는 멀쩡했고, 사용자는 엉뚱한 데를 보게 된다.
        """
        where = ", ".join(self.providers) or "출처"
        if self.failures and all(isinstance(f, TickerNotFound) for f in self.failures):
            return f"{where} 에 그런 지표 코드가 없습니다 — 철자를 확인해주세요."
        if any(isinstance(f, ProviderUnavailable) for f in self.failures):
            return (
                f"{where} 로 나가지 못하고 있습니다. 백신·방화벽·회사망(프록시)이 막고 있는지 "
                "확인해주세요. backend 폴더에서 `python diagnose.py` 를 실행하면 어디가 "
                "막혔는지 알 수 있습니다."
            )
        return "잠시 후 다시 시도해주세요."


def fetch_macro_points(
    code: str,
    source: str,
    source_code: str | None = None,
    fallback_source: str | None = None,
    fallback_code: str | None = None,
    start=None,
    want_release_dates: bool = False,
) -> tuple[list[MacroPoint], str]:
    """제공자를 순서대로 시도해 첫 성공을 값과 **제공자 이름**으로 돌려준다.

    이름까지 같이 주는 이유는 시세에서 `PriceDaily.source` 를 남기는 것과 같다 — 값이
    이상할 때 어디서 온 값인지 사후에 알아낼 방법이 있어야 한다. (시세는 DataFrame 에
    `attrs` 로 붙였지만 여기서는 리스트라 붙일 자리가 없어 같이 돌려준다.)

    **`code` 는 우리가 부르는 이름이고, 제공자에게 묻는 이름은 따로다.** 같은 지표라도
    곳마다 이름이 다르다 — VIX 는 우리에게 `VIX`, 야후에서 `^VIX`, FRED 에서 `VIXCLS`.
    `code` 를 그대로 물으면 "그런 티커 없다"가 돌아오고, 사용자는 코드를 잘못 적은 줄
    안다. `code` 는 로그와 오류 메시지에만 쓴다 — 거기에는 우리 이름이 나와야 한다.

    `source_code` 를 안 주면 `code` 로 묻는다. 둘이 같은 지표(FRED 쪽 대부분)가 많아
    매번 적게 하지 않으려는 것이고, **다를 때 안 주면 조용히 틀린 것을 묻게 된다.**
    """
    failures: list[ProviderError] = []
    primary = build_macro_providers(source)
    secondary = build_macro_providers(fallback_source) if fallback_source else []

    attempts = [(p, source_code or code) for p in primary]
    attempts += [(p, fallback_code or code) for p in secondary]

    for provider, ask in attempts:
        if not provider.supports(ask):
            continue
        try:
            points = provider.fetch(ask, start=start, want_release_dates=want_release_dates)
            if failures:
                logger.info(
                    "%s: %s 제공자로 대체 조회 성공 (앞선 실패: %s)",
                    code, provider.name, [f.provider for f in failures],
                )
            return points, provider.name

        except ProviderError as exc:
            logger.warning("%s: %s", code, exc)
            failures.append(exc)

        except Exception as exc:  # 제공자 구현 자체의 버그도 다음 제공자를 막지 않는다
            logger.exception("%s: %s 제공자에서 예상치 못한 오류", code, provider.name)
            failures.append(ProviderError(provider.name, f"예상치 못한 오류 — {exc}"))

    raise AllMacroProvidersFailed(code, failures)


__all__ = [
    "AllMacroProvidersFailed",
    "AllProvidersFailed",
    "EmptyData",
    "ProviderError",
    "ProviderUnavailable",
    "TickerNotFound",
    "build_macro_providers",
    "build_providers",
    "configured_order",
    "fetch_macro_points",
    "fetch_price_history",
    "provider_overview",
]
