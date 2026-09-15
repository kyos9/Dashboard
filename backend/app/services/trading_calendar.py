"""공통 거래일 캘린더 (NYSE 기준).

종목마다 데이터 결측일이 달라 기간(월/분기/반기) 경계가 어긋나는 것을 방지하기 위해,
매수 워크플로우/리밸런싱 판정은 모두 이 모듈의 NYSE 거래일 캘린더를 기준으로 한다.
"""

import datetime as dt
from functools import lru_cache

import pandas_market_calendars as mcal

_NYSE = mcal.get_calendar("NYSE")


@lru_cache(maxsize=64)
def _schedule(start: dt.date, end: dt.date):
    return _NYSE.schedule(start_date=start, end_date=end)


def trading_days(start: dt.date, end: dt.date) -> list[dt.date]:
    if start > end:
        return []
    schedule = _schedule(start, end)
    return [ts.date() for ts in schedule.index]


def is_trading_day(d: dt.date) -> bool:
    return len(trading_days(d, d)) > 0


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


def period_trading_bounds(d: dt.date, period: str) -> tuple[dt.date | None, dt.date | None]:
    """d가 속한 기간의 첫/마지막 '거래일'. 거래일이 없으면 (None, None)."""
    start, end = calendar_period_range(d, period)
    days = trading_days(start, end)
    if not days:
        return None, None
    return days[0], days[-1]
