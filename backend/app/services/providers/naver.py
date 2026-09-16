"""네이버 금융 제공자 — 국내주식 전용.

야후가 막힌 환경에서도 국내주식은 받을 수 있어야 한다. Stooq는 한국거래소를 다루지
않으므로 국내 종목에는 대체 경로가 아예 없는데, 이 제공자가 그 자리를 메운다.

엔드포인트: https://api.finance.naver.com/siseJson.naver?symbol=005930&requestType=1
            &startTime=20200101&endTime=20260916&timeframe=day

응답은 JSON이 아니라 **작은따옴표를 쓰는 파이썬 리터럴 형태**다:
    [['날짜', '시가', '고가', '저가', '종가', '거래량', '외국인소진율'],
     ['20240102', 79600, 79800, 78200, 79600, 17142523, 54.16], ...]
그래서 json.loads가 아니라 ast.literal_eval로 읽는다.

종가는 분할만 반영하고 배당 재투자 조정은 하지 않은 값이라 스펙과 맞는다.
"""

from __future__ import annotations

import ast
import datetime as dt
import logging

import pandas as pd

from app.markets import krx_code
from app.services.providers.base import (
    EmptyData,
    ProviderUnavailable,
    TickerNotFound,
    normalize_frame,
    period_start_date,
)

logger = logging.getLogger(__name__)

BASE_URL = "https://api.finance.naver.com/siseJson.naver"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
    ),
    "Accept": "*/*",
    # 이 엔드포인트는 금융 페이지에서 호출되는 것을 전제한다
    "Referer": "https://finance.naver.com/",
}

# period="max"일 때 시작일. 한국 증시 일봉이 이보다 앞서는 경우는 없다.
EARLIEST = dt.date(1990, 1, 1)

# 응답 헤더 행의 한글 컬럼명 -> 공통 컬럼명
COLUMN_MAP = {
    "날짜": "date",
    "시가": "open",
    "고가": "high",
    "저가": "low",
    "종가": "close",
    "거래량": "volume",
}


class NaverProvider:
    name = "naver"

    def __init__(self, timeout: int = 30):
        self.timeout = timeout

    def supports(self, ticker: str) -> bool:
        """국내 종목만 다룬다."""
        return krx_code(ticker) is not None

    def fetch(self, ticker: str, period: str) -> pd.DataFrame:
        import requests

        code = krx_code(ticker)
        if code is None:
            raise TickerNotFound(self.name, f"{ticker}: 국내 종목이 아닙니다")

        start = period_start_date(period) or EARLIEST
        params = {
            "symbol": code,
            "requestType": "1",
            "startTime": start.strftime("%Y%m%d"),
            "endTime": dt.date.today().strftime("%Y%m%d"),
            "timeframe": "day",
        }

        try:
            response = requests.get(BASE_URL, params=params, headers=HEADERS, timeout=self.timeout)
        except Exception as exc:
            raise ProviderUnavailable(
                self.name, f"{ticker}: 요청 실패 — {type(exc).__name__}: {exc}"
            ) from exc

        if response.status_code != 200:
            raise ProviderUnavailable(self.name, f"{ticker}: HTTP {response.status_code}")

        return self.parse_payload(response.text, ticker)

    def parse_payload(self, text: str, ticker: str) -> pd.DataFrame:
        """응답 본문을 공통 형태로 바꾼다. (네트워크 없이 테스트할 수 있게 분리)"""
        body = text.strip()
        if not body:
            raise EmptyData(self.name, f"{ticker}: 빈 응답")

        if not body.startswith("["):
            raise ProviderUnavailable(
                self.name, f"{ticker}: 예상과 다른 응답 — {body[:120]!r}"
            )

        try:
            rows = ast.literal_eval(body)
        except Exception as exc:
            raise ProviderUnavailable(
                self.name, f"{ticker}: 응답 파싱 실패 — {exc}"
            ) from exc

        if not isinstance(rows, list) or not rows:
            raise EmptyData(self.name, f"{ticker}: 데이터가 없습니다")

        header = [str(col).strip() for col in rows[0]]
        data_rows = rows[1:]
        if not data_rows:
            # 없는 종목코드는 헤더만 돌아온다
            raise TickerNotFound(
                self.name, f"{ticker}: 네이버에 해당 종목코드의 일봉이 없습니다"
            )

        frame = pd.DataFrame(data_rows, columns=header)
        missing = [ko for ko in COLUMN_MAP if ko not in frame.columns]
        if missing:
            raise ProviderUnavailable(
                self.name, f"{ticker}: 컬럼 누락 {missing} (받은 컬럼: {header})"
            )

        frame = frame[list(COLUMN_MAP)].rename(columns=COLUMN_MAP)
        frame["date"] = pd.to_datetime(frame["date"].astype(str), format="%Y%m%d", errors="coerce")
        frame = frame.dropna(subset=["date"]).set_index("date")

        for column in ("open", "high", "low", "close", "volume"):
            frame[column] = pd.to_numeric(frame[column], errors="coerce")
        frame["volume"] = frame["volume"].fillna(0.0)

        return normalize_frame(frame, self.name, ticker)
