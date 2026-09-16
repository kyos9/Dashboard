"""Stooq CSV 제공자 — 야후가 막혔을 때의 대체 경로.

가입·API 키가 필요 없고 평범한 CSV 한 방이라 야후처럼 봇 차단(쿠키/크럼) 절차가 없다.
종가도 분할만 반영하고 배당 재투자 조정은 하지 않은 값이라 우리 스펙과 맞는다.

엔드포인트: https://stooq.com/q/d/l/?s=voo.us&i=d
응답: Date,Open,High,Low,Close,Volume  (거래량이 비어 있는 종목도 있다)
"""

from __future__ import annotations

import datetime as dt
import io
import logging

import pandas as pd

from app.markets import is_krx_ticker
from app.services.providers.base import (
    EmptyData,
    ProviderUnavailable,
    TickerNotFound,
    normalize_frame,
    period_start_date,
)

logger = logging.getLogger(__name__)

BASE_URL = "https://stooq.com/q/d/l/"

# 평범한 브라우저처럼 보이게 한다 (기본 python-requests UA는 종종 거절당한다)
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
    ),
    "Accept": "text/csv,text/plain,*/*",
}


def to_stooq_symbol(ticker: str) -> str:
    """티커를 Stooq 심볼로 바꾼다.

    Stooq는 거래소 접미사를 요구한다. 접미사가 이미 붙어 있으면 그대로 두고,
    없으면 미국 상장으로 보고 `.us`를 붙인다 (VOO -> voo.us).
    """
    symbol = ticker.strip().lower()
    if symbol.startswith("^") or "." in symbol:
        return symbol
    return f"{symbol}.us"


class StooqProvider:
    name = "stooq"

    def __init__(self, timeout: int = 30):
        self.timeout = timeout

    def supports(self, ticker: str) -> bool:
        """Stooq는 한국거래소를 다루지 않는다 — 국내 종목은 시도하지 않는다."""
        return not is_krx_ticker(ticker)

    def fetch(self, ticker: str, period: str) -> pd.DataFrame:
        import requests

        params: dict[str, str] = {"s": to_stooq_symbol(ticker), "i": "d"}
        start = period_start_date(period)
        if start is not None:
            params["d1"] = start.strftime("%Y%m%d")
            params["d2"] = dt.date.today().strftime("%Y%m%d")

        try:
            response = requests.get(BASE_URL, params=params, headers=HEADERS, timeout=self.timeout)
        except Exception as exc:
            raise ProviderUnavailable(
                self.name, f"{ticker}: 요청 실패 — {type(exc).__name__}: {exc}"
            ) from exc

        if response.status_code != 200:
            raise ProviderUnavailable(
                self.name, f"{ticker}: HTTP {response.status_code}"
            )

        return self.parse_csv(response.text, ticker)

    def parse_csv(self, text: str, ticker: str) -> pd.DataFrame:
        """CSV 본문을 공통 형태로 바꾼다. (네트워크 없이 테스트할 수 있게 분리)"""
        body = text.strip()

        # 심볼을 모르면 "No data" 한 줄이나 HTML 안내 페이지가 돌아온다
        if not body or body.lower().startswith("<") or "no data" in body[:200].lower():
            raise TickerNotFound(
                self.name, f"{ticker}: Stooq에 없는 심볼 ({to_stooq_symbol(ticker)})"
            )

        if not body.lower().startswith("date,"):
            raise ProviderUnavailable(
                self.name, f"{ticker}: CSV가 아닌 응답 — {body[:120]!r}"
            )

        try:
            df = pd.read_csv(io.StringIO(body), parse_dates=["Date"], index_col="Date")
        except Exception as exc:
            raise ProviderUnavailable(
                self.name, f"{ticker}: CSV 파싱 실패 — {exc}"
            ) from exc

        if df.empty:
            raise EmptyData(self.name, f"{ticker}: 헤더만 있고 데이터가 없음")

        # 거래량을 안 주는 종목이 있다 — 지표 계산이 깨지지 않게 0으로 채운다
        # (거래량 기반 조건은 이 경우 자연히 False가 된다)
        if "Volume" not in df.columns:
            df["Volume"] = 0.0
        else:
            df["Volume"] = pd.to_numeric(df["Volume"], errors="coerce").fillna(0.0)

        return normalize_frame(df, self.name, ticker)
