"""클리블랜드 연준 인플레이션 나우캐스트 — **발표 전 예상치**.

다른 제공자와 성격이 다르다. 나머지는 이미 발표된 값을 받아오지만 여기는 **아직 안 나온
달의 예상치**를 받는다. 예상치가 없으면 "CPI 3.1%" 가 높은 숫자인지 낮은 숫자인지 알 수
없고, 시장이 움직이는 것은 값 자체가 아니라 예상 대비 어긋난 폭이다.

설문이 아니라 모델이라 Investing 컨센서스와 숫자가 똑같지는 않다. 대신 **매일 갱신되고,
무료이고, 공식 기관이 낸다.** 우리 1차 지표가 물가 계열 넷이라 커버리지가 거의 정확히 맞는다.

**공식 API 가 아니다.** 나우캐스팅 화면의 차트가 읽는 정적 파일을 그대로 받는다. 문서가
없으므로 언제든 모양이 바뀔 수 있고, 그건 예상치 하나가 안 들어오는 것으로 끝나야 한다 —
직접 입력이 따로 살아 있고, 예상치가 없으면 배지가 그냥 안 뜬다.

**단위를 확인하고 받는다.** 이 파일은 전월비(MoM)를 내는데 우리 카드는 전년비로 뜬다.
그대로 넣으면 실제 3.2% 와 예상 0.44% 를 비교하게 되어 **매달 "물가 상회"** 가 뜨는데,
숫자가 둘 다 그럴듯해서 화면만 보고는 알아챌 수 없다. 야후의 `^TNX` 를 10년물 금리
폴백으로 쓰면 값이 조용히 열 배가 되는 것과 같은 종류의 사고다. 그래서 파일이 스스로
밝히는 단위(`yaxisname`)를 읽어서 같이 올리고, 모르는 단위면 **받지 않는다.**
"""

from __future__ import annotations

import datetime as dt
import json
import logging
from dataclasses import dataclass

from app.services.providers.base import EmptyData, ProviderUnavailable, TickerNotFound
from app.services.providers.macro_base import parse_value

logger = logging.getLogger(__name__)

URL = (
    "https://www.clevelandfed.org/-/media/files/webcharts/inflationnowcasting/"
    "nowcast_{period}.json"
)

# 월간·분기·연간 세 벌이 있고 모양이 같다. 우리 물가 지표 넷이 전부 월간이라 월간을 쓴다.
PERIODS = ("month", "quarter", "year")

# 저쪽이 부르는 이름 -> 우리가 부르는 이름.
#
# **이름을 정확히 맞춘다.** 같은 파일에 "Actual CPI Inflation"(이미 발표된 실제값)이
# 나란히 들어 있어서, 앞부분만 맞춰보는 식으로 고르면 예상치 자리에 실제값이 들어간다.
# 그러면 예상과 실제가 항상 같아져서 배지가 영영 안 뜨고, 그건 화면에서 안 보인다.
SERIES_CODES = {
    "CPI Inflation": "CPIAUCSL",
    "Core CPI Inflation": "CPILFESL",
    "PCE Inflation": "PCEPI",
    "Core PCE Inflation": "PCEPILFE",
}

# 파일이 스스로 밝히는 단위. 모르는 말이 오면 받지 않는다 (맨 위 설명 참고).
UNITS = {
    "month-over-month percent change": "mom",
    "year-over-year percent change": "yoy",
}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json,text/plain,*/*",
}


@dataclass(frozen=True)
class ForecastPoint:
    """예측치 한 점.

    `as_of`         어느 달을 예측한 것인가 (그 달 1일 — `MacroValue.as_of` 와 같은 축)
    `forecast_date` 언제 한 예측인가. 나우캐스트는 매일 바뀌므로 이게 있어야 뜻이 있다
    `unit`          mom | yoy. **화면 단위로 바꾸는 것은 부르는 쪽 일이다** — 여기서
                    바꾸려면 지수 원본이 필요한데 그건 DB 에 있고 제공자는 DB 를 모른다
    """

    code: str
    as_of: dt.date
    forecast_date: dt.date
    value: float
    unit: str


class ClevelandNowcastProvider:
    """물가 예상치. 우리가 예상치를 받아오는 유일한 곳이다."""

    name = "cleveland_fed"

    def __init__(self, timeout: int = 60, period: str = "month"):
        if period not in PERIODS:
            raise ValueError(f"알 수 없는 주기: {period}")
        self.timeout = timeout
        self.period = period

    def fetch(self) -> list[ForecastPoint]:
        import requests

        url = URL.format(period=self.period)
        try:
            response = requests.get(url, headers=HEADERS, timeout=self.timeout)
        except Exception as exc:
            raise ProviderUnavailable(
                self.name, f"나우캐스트: 요청 실패 — {type(exc).__name__}: {exc}"
            ) from exc

        return self.parse_response(response.status_code, response.text)

    def parse_response(self, status: int, body: str) -> list[ForecastPoint]:
        """HTTP 응답을 해석한다. (네트워크 없이 테스트할 수 있게 분리 — CNN·FRED 와 같은 방식)"""
        if status == 404:
            raise TickerNotFound(self.name, "나우캐스트: 그 주소가 없습니다 (파일이 옮겨졌을 수 있습니다)")
        if status != 200:
            raise ProviderUnavailable(self.name, f"나우캐스트: HTTP {status}")

        try:
            payload = json.loads(body)
        except ValueError as exc:
            raise ProviderUnavailable(
                self.name, f"나우캐스트: JSON 이 아닌 응답 — {body[:120]!r}"
            ) from exc
        if not isinstance(payload, list):
            raise ProviderUnavailable(self.name, "나우캐스트: 예상 밖의 응답 모양 (목록이 아님)")

        points: list[ForecastPoint] = []
        for chart in payload:
            points.extend(self._read_chart(chart))

        if not points:
            raise EmptyData(self.name, "나우캐스트: 읽을 수 있는 예상치가 없음")
        return points

    # -- 차트 한 장 = 목표 달 한 개 ------------------------------------------
    #
    # 파일은 "달마다 차트 한 장"으로 되어 있다. 한 장 안에서 x축은 **그 달을 예측하던
    # 날들**이고, 선 넷이 CPI·근원CPI·PCE·근원PCE 다. 실제값이 발표되면 같은 장에
    # "Actual …" 선으로 점 하나가 찍힌다.

    def _read_chart(self, chart) -> list[ForecastPoint]:
        if not isinstance(chart, dict):
            return []

        meta = chart.get("chart")
        if not isinstance(meta, dict):
            return []

        month = _parse_month(meta.get("subcaption"))
        if month is None:
            return []

        unit = UNITS.get(str(meta.get("yaxisname", "")).strip().lower())
        if unit is None:
            # 단위가 바뀌면 값이 조용히 다른 뜻이 된다. 받지 않는 편이 낫다.
            logger.warning(
                "나우캐스트 %s: 모르는 단위 %r — 건너뜁니다", month, meta.get("yaxisname")
            )
            return []

        days = _days_of(chart, month)
        if not days:
            return []

        found: list[ForecastPoint] = []
        for series in chart.get("dataset") or []:
            if not isinstance(series, dict):
                continue
            code = SERIES_CODES.get(str(series.get("seriesname", "")).strip())
            if code is None:
                continue  # "Actual …" 선과 모르는 선은 여기서 걸러진다

            data = series.get("data")
            if not isinstance(data, list):
                continue
            if len(data) != len(days):
                # 줄이 어긋나면 **날짜가 하루씩 밀린 예상치**가 들어간다. 그건 값이
                # 있는 것보다 나쁘다 — 틀렸는데 그럴듯해 보인다.
                logger.warning(
                    "나우캐스트 %s/%s: 날짜 %d개에 값 %d개 — 건너뜁니다",
                    month, code, len(days), len(data),
                )
                continue

            for when, cell in zip(days, data):
                if not isinstance(cell, dict):
                    continue
                value = parse_value(cell.get("value"))
                if value is None:
                    continue  # 아직 그 날의 예측이 없던 날
                found.append(
                    ForecastPoint(
                        code=code, as_of=month, forecast_date=when, value=value, unit=unit
                    )
                )
        return found


def _parse_month(raw) -> dt.date | None:
    """`subcaption` 은 "2026-9" 처럼 온다 (한 자리 달). 그 달 1일로."""
    text = str(raw or "").strip()
    parts = text.split("-")
    if len(parts) != 2:
        return None
    try:
        year, month = int(parts[0]), int(parts[1])
        return dt.date(year, month, 1)
    except ValueError:
        return None


def _days_of(chart: dict, month: dt.date) -> list[dt.date]:
    """x축의 날들. **세로선은 날이 아니다.**

    발표일 표시("CPI Aug")가 세로선(`vline`)으로 **목록 가운데** 끼어 있는데, 값 쪽에는
    그 자리가 없다. 걸러내지 않으면 그 뒤로 값이 전부 하루씩 밀린다 — 실제로 최근 달은
    세로선이 여덟 번째에 들어 있어서 그 뒤 여섯 날이 통째로 어긋난다.
    """
    groups = chart.get("categories")
    if not isinstance(groups, list) or not groups:
        return []
    entries = (groups[0] or {}).get("category")
    if not isinstance(entries, list):
        return []

    days: list[dt.date] = []
    for entry in entries:
        if not isinstance(entry, dict) or str(entry.get("vline", "")).lower() == "true":
            continue
        when = _parse_day(entry.get("label"), month)
        if when is not None:
            days.append(when)
    return days


def _parse_day(raw, month: dt.date) -> dt.date | None:
    """라벨은 "09/11" 처럼 **연도 없이** 온다. 목표 달을 보고 연도를 채운다.

    예측은 목표 달에 시작해 그 다음 달까지 이어진다(8월분 CPI 는 9월 중순에 나온다).
    그래서 라벨의 달이 목표 달보다 **앞서면 다음 해**다 — 12월분을 1월에 예측한 경우다.
    이걸 안 하면 그 줄만 한 해 전으로 찍힌다.
    """
    text = str(raw or "").strip()
    parts = text.split("/")
    if len(parts) != 2:
        return None
    try:
        label_month, day = int(parts[0]), int(parts[1])
        year = month.year + 1 if label_month < month.month else month.year
        return dt.date(year, label_month, day)
    except ValueError:
        return None


__all__ = ["ClevelandNowcastProvider", "ForecastPoint", "SERIES_CODES", "UNITS", "URL"]
