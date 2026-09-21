"""매크로 지표 제공자 공통 규약.

시세 쪽(`base.py`)과 같은 생각이다 — 한 곳에만 의존하면 그쪽이 막히는 순간 화면이
멈추므로, 공통 규약을 두고 실패 원인을 종류별로 구분해 위로 올린다. 예외도 시세와
같은 것을 그대로 쓴다(`ProviderUnavailable` / `TickerNotFound` / `EmptyData`) —
"FRED 가 막힌 것"과 "그런 지표 코드가 없는 것"은 사용자가 할 일이 완전히 다르다.

다른 점은 돌려주는 모양뿐이다. 시세는 OHLCV 표가 필요하지만 매크로는 날짜와 값
하나씩이면 된다. 대신 **`released_at`(그 값이 공개된 날)이 따라붙는다** — CPI·PCE 는
발표 뒤에도 수정되기 때문이다.
"""

from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass
from typing import Protocol

from app.services.providers.base import EmptyData


@dataclass(frozen=True)
class MacroPoint:
    """지표 한 점.

    `as_of`   이 값이 가리키는 시점 (2026년 8월 CPI -> 2026-08-01)
    `released_at`  그 값이 공개된 날. 알려주는 제공자에서만 채워진다.
    """

    as_of: dt.date
    value: float
    released_at: dt.date | None = None


def parse_value(raw: str | float | None) -> float | None:
    """제공자가 준 값 한 칸을 실수로. 결측이면 None.

    FRED 는 "아직 값이 없음"을 **점 하나(`.`)** 로 표시한다. 이걸 0 으로 읽으면
    금리가 0% 인 날이 생기고, 그 뒤 계산은 전부 조용히 틀린다.
    """
    if raw is None:
        return None
    if isinstance(raw, str):
        text = raw.strip()
        if text in ("", ".", "NA", "N/A", "null"):
            return None
        try:
            raw = float(text)
        except ValueError:
            return None
    value = float(raw)
    if math.isnan(value) or math.isinf(value):
        return None
    return value


def normalize_points(points: list[MacroPoint], provider: str, code: str) -> list[MacroPoint]:
    """날짜 오름차순, 중복 제거(뒤엣것을 남김). 하나도 안 남으면 EmptyData."""
    by_date: dict[dt.date, MacroPoint] = {}
    for point in points:
        by_date[point.as_of] = point

    ordered = [by_date[key] for key in sorted(by_date)]
    if not ordered:
        raise EmptyData(provider, f"{code}: 값이 있는 행이 하나도 없음")
    return ordered


def period_for(start: dt.date | None, today: dt.date | None = None) -> str:
    """시작일을 시세 제공자가 받는 period 문자열로. (야후를 매크로에 쓸 때 필요하다.)"""
    if start is None:
        return "max"
    today = today or dt.date.today()
    days = (today - start).days
    for period, limit in (("1mo", 31), ("3mo", 92), ("6mo", 183), ("1y", 366), ("2y", 731),
                          ("5y", 1827), ("10y", 3653)):
        if days <= limit:
            return period
    return "max"


class MacroProvider(Protocol):
    """지표 시계열을 돌려주는 제공자."""

    name: str

    def supports(self, code: str) -> bool:
        """이 제공자가 해당 코드를 다룰 수 있는지. (키가 없으면 False 인 제공자도 있다.)"""
        ...

    def fetch(
        self, code: str, start: dt.date | None = None, want_release_dates: bool = False
    ) -> list[MacroPoint]:
        """`want_release_dates` 는 **부탁이지 약속이 아니다.**

        발표일은 월간 지표에만 의미가 있고(금리는 매일 나오며 수정되지 않는다), 받아오는
        데 요청이 한 번 더 든다. 못 받아도 값 자체는 돌려줘야 한다 — 있으면 좋은 것 하나
        때문에 지표가 통째로 비면 안 된다.
        """
        ...


__all__ = ["MacroPoint", "MacroProvider", "normalize_points", "parse_value", "period_for"]
