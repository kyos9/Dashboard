"""시장별 거래일 캘린더 (미국 NYSE / 한국 XKRX).

종목마다 데이터 결측일이 달라 기간(월/분기/반기) 경계가 어긋나는 것을 방지하기 위해,
매수 워크플로우/리밸런싱 판정은 개별 종목의 가격 데이터가 아니라 이 모듈의 거래일
캘린더를 기준으로 한다.

시장을 구분하는 이유: 한국과 미국은 휴장일이 다르다. 분기 마지막 거래일도 다르므로
(예: 12월 31일 한국 휴장, 미국 개장) 국내 종목에 NYSE 캘린더를 쓰면 리뷰 마감일과
폴백 매수일이 실제 거래일이 아닌 날로 잡힌다.
"""

from __future__ import annotations

import datetime as dt
import warnings
from functools import lru_cache
from zoneinfo import ZoneInfo

import pandas_market_calendars as mcal

from app.markets import Market

_CALENDAR_NAMES: dict[Market, str] = {
    Market.US: "NYSE",
    Market.KR: "XKRX",
}

_TIMEZONES: dict[Market, ZoneInfo] = {
    Market.US: ZoneInfo("America/New_York"),
    Market.KR: ZoneInfo("Asia/Seoul"),
}


@lru_cache(maxsize=4)
def _calendar(market: Market):
    # XKRX는 점심 휴장(break_start/break_end)이 폐지됐다는 경고를 내는데,
    # 우리는 일봉만 쓰므로 장중 시간표와 무관하다.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        return mcal.get_calendar(_CALENDAR_NAMES[market])


@lru_cache(maxsize=256)
def _schedule(market: Market, start: dt.date, end: dt.date):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        return _calendar(market).schedule(start_date=start, end_date=end)


def market_today(market: Market = Market.US) -> dt.date:
    """해당 시장 현지 기준 '오늘'.

    서버가 어느 시간대에 있든 기간/리뷰 판정이 시장 기준으로 일관되게 동작해야 한다.
    """
    return dt.datetime.now(_TIMEZONES[market]).date()


def trading_days(start: dt.date, end: dt.date, market: Market = Market.US) -> list[dt.date]:
    if start > end:
        return []
    schedule = _schedule(market, start, end)
    return [ts.date() for ts in schedule.index]


def _month_range(year: int, month: int) -> tuple[dt.date, dt.date]:
    start = dt.date(year, month, 1)
    if month == 12:
        end = dt.date(year, 12, 31)
    else:
        end = dt.date(year, month + 1, 1) - dt.timedelta(days=1)
    return start, end


def calendar_period_range(d: dt.date, period: str) -> tuple[dt.date, dt.date]:
    """d가 속한 캘린더 기간(월/분기/반기)의 [시작일, 끝일] (달력 기준, 거래일 필터 전)."""
    if period == "monthly":
        return _month_range(d.year, d.month)
    if period == "quarterly":
        q_start_month = ((d.month - 1) // 3) * 3 + 1
        start, _ = _month_range(d.year, q_start_month)
        _, end = _month_range(d.year, q_start_month + 2)
        return start, end
    if period == "semiannual":
        h_start_month = 1 if d.month <= 6 else 7
        start, _ = _month_range(d.year, h_start_month)
        _, end = _month_range(d.year, h_start_month + 5)
        return start, end
    raise ValueError(f"unknown period: {period}")


def period_trading_bounds(
    d: dt.date, period: str, market: Market = Market.US
) -> tuple[dt.date | None, dt.date | None]:
    """d가 속한 기간의 첫/마지막 '거래일'. 거래일이 없으면 (None, None)."""
    start, end = calendar_period_range(d, period)
    days = trading_days(start, end, market)
    if not days:
        return None, None
    return days[0], days[-1]
