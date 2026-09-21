"""FRED(세인트루이스 연준) 매크로 지표 제공자 — API 와 CSV 두 갈래.

**출처를 FRED 로 고른 이유.** Investing·트레이딩뷰는 공개 API 가 없고, 스크레이핑은
약관 위반이며 실제로 차단당한다. 무엇보다 둘 다 원 출처가 아니다 — CPI 는 BLS, PCE 는
BEA 가 발표하고 FRED 가 모은다. 중간상을 거칠 이유가 없다.

**키가 없어도 돌아야 한다.** AI 키와 같은 원칙이다 — 키 발급은 진입 장벽이므로, 키가
없다고 매크로 탭이 통째로 비면 안 된다. 그래서 두 벌을 둔다:

    FredApiProvider   키가 있을 때. 공식 API 이고 **발표일까지 받을 수 있다.**
    FredCsvProvider   키가 없거나 API 가 막혔을 때. fredgraph.csv 한 방이라
                      가입도 키도 필요 없다. 대신 발표일은 안 준다.

키가 있을 때만 되는 것은 발표일 하나뿐이고, 그건 없어도 값은 보인다.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import logging
import os

from app.services.providers.base import (
    EmptyData,
    ProviderUnavailable,
    TickerNotFound,
)
from app.services.providers.macro_base import MacroPoint, normalize_points, parse_value

logger = logging.getLogger(__name__)

API_URL = "https://api.stlouisfed.org/fred/series/observations"
CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv"

API_KEY_ENV = "FRED_API_KEY"

# 평범한 브라우저처럼 보이게 한다 (Stooq 와 같은 이유 — 기본 python-requests UA 는
# 종종 거절당한다).
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json,text/csv,text/plain,*/*",
}

# FRED 가 "그런 시리즈 없다"고 답할 때 메시지에 섞여 나오는 표현들
_NOT_FOUND_HINTS = ("does not exist", "not exist", "bad request. the series")


def api_key() -> str | None:
    return os.environ.get(API_KEY_ENV, "").strip() or None


class FredApiProvider:
    """공식 API. 키가 있을 때만 쓴다."""

    name = "fred_api"

    def __init__(self, timeout: int = 30, key: str | None = None):
        self.timeout = timeout
        self._key = key

    @property
    def key(self) -> str | None:
        # 매번 환경변수를 다시 본다 — 서버에 키를 넣고 앱을 다시 띄우면 바로 먹어야 한다.
        return self._key or api_key()

    def supports(self, code: str) -> bool:
        return bool(self.key)

    def fetch(
        self, code: str, start: dt.date | None = None, want_release_dates: bool = False
    ) -> list[MacroPoint]:
        observations = self._observations(code, start)

        releases: dict[dt.date, dt.date] = {}
        if want_release_dates:
            # 있으면 좋은 것이지 없으면 안 되는 것이 아니다. 여기서 실패해도 값은 돌려준다.
            try:
                releases = self.release_dates(code, start)
            except Exception as exc:
                logger.info("%s: 발표일을 못 받았습니다 (값은 정상) — %s", code, exc)

        points = [
            MacroPoint(as_of=as_of, value=value, released_at=releases.get(as_of))
            for as_of, value in observations
        ]
        return normalize_points(points, self.name, code)

    def release_dates(self, code: str, start: dt.date | None = None) -> dict[dt.date, dt.date]:
        """각 시점의 값이 **처음 공개된 날**.

        `output_type=4`(initial release only)로 물으면 관측치마다 `realtime_start` 가
        "그 값이 처음 세상에 나온 날"로 온다. 기본 조회(`output_type=1`)에서는 이 칸이
        전부 오늘 날짜라 아무 정보가 없다 — 그래서 요청을 따로 한 번 더 한다.

        값 자체는 기본 조회로 받은 **최신(수정 반영) 값**을 쓴다. 화면에 띄울 것은
        지금 맞는 숫자이지, 처음 나왔던 숫자가 아니다.
        """
        payload = self._get(
            API_URL,
            {
                "series_id": code,
                "api_key": self.key or "",
                "file_type": "json",
                "output_type": "4",
                **({"observation_start": start.isoformat()} if start else {}),
            },
            code,
        )
        out: dict[dt.date, dt.date] = {}
        for row in payload.get("observations", []):
            as_of = _parse_date(row.get("date"))
            released = _parse_date(row.get("realtime_start"))
            if as_of and released:
                out[as_of] = released
        return out

    def _observations(self, code: str, start: dt.date | None) -> list[tuple[dt.date, float]]:
        payload = self._get(
            API_URL,
            {
                "series_id": code,
                "api_key": self.key or "",
                "file_type": "json",
                **({"observation_start": start.isoformat()} if start else {}),
            },
            code,
        )

        rows: list[tuple[dt.date, float]] = []
        for row in payload.get("observations", []):
            as_of = _parse_date(row.get("date"))
            value = parse_value(row.get("value"))
            if as_of is not None and value is not None:
                rows.append((as_of, value))

        if not rows:
            raise EmptyData(self.name, f"{code}: 값이 있는 관측치가 없음")
        return rows

    def _get(self, url: str, params: dict, code: str) -> dict:
        import requests

        if not self.key:
            raise ProviderUnavailable(self.name, f"{code}: {API_KEY_ENV} 가 설정돼 있지 않습니다")

        try:
            response = requests.get(url, params=params, headers=HEADERS, timeout=self.timeout)
        except Exception as exc:
            raise ProviderUnavailable(
                self.name, f"{code}: 요청 실패 — {type(exc).__name__}: {exc}"
            ) from exc

        return self.parse_response(response.status_code, response.text, code)

    def parse_response(self, status: int, body: str, code: str):
        """HTTP 응답을 해석한다. (네트워크 없이 테스트할 수 있게 분리 — Stooq 와 같은 방식)"""
        import json

        if status != 200:
            message = _error_message(body) or f"HTTP {status}"
            if any(hint in message.lower() for hint in _NOT_FOUND_HINTS):
                raise TickerNotFound(self.name, f"{code}: FRED 에 없는 지표 코드 ({message})")
            # 키가 틀리면 여기로 온다. 키를 고치라는 말이 나와야 사용자가 손댈 수 있다.
            if status in (400, 403) and "api_key" in message.lower():
                raise ProviderUnavailable(
                    self.name, f"{code}: {API_KEY_ENV} 가 거절당했습니다 — {message}"
                )
            raise ProviderUnavailable(self.name, f"{code}: {message}")

        try:
            return json.loads(body)
        except ValueError as exc:
            raise ProviderUnavailable(
                self.name, f"{code}: JSON 이 아닌 응답 — {body[:120]!r}"
            ) from exc


class FredCsvProvider:
    """키 없이 받는 경로. `fredgraph.csv` 는 그래프 화면의 내려받기 링크와 같은 주소다.

    공식 API 가 아니므로 형식이 바뀔 수 있다. 실제로 헤더 첫 칸이 `DATE` 에서
    `observation_date` 로 바뀐 적이 있어, 둘 다 받아들인다.
    """

    name = "fred_csv"

    def __init__(self, timeout: int = 30):
        self.timeout = timeout

    def supports(self, code: str) -> bool:
        return True

    def fetch(
        self, code: str, start: dt.date | None = None, want_release_dates: bool = False
    ) -> list[MacroPoint]:
        import requests

        params = {"id": code}
        if start is not None:
            params["cosd"] = start.isoformat()

        try:
            response = requests.get(CSV_URL, params=params, headers=HEADERS, timeout=self.timeout)
        except Exception as exc:
            raise ProviderUnavailable(
                self.name, f"{code}: 요청 실패 — {type(exc).__name__}: {exc}"
            ) from exc

        if response.status_code == 404:
            raise TickerNotFound(self.name, f"{code}: FRED 에 없는 지표 코드")
        if response.status_code != 200:
            raise ProviderUnavailable(self.name, f"{code}: HTTP {response.status_code}")

        return self.parse_csv(response.text, code)

    def parse_csv(self, text: str, code: str) -> list[MacroPoint]:
        body = text.strip()

        if not body:
            raise EmptyData(self.name, f"{code}: 빈 응답")
        if body.lstrip().startswith("<"):
            # 없는 코드를 물으면 200 과 함께 안내 HTML 이 오는 경우가 있다
            raise TickerNotFound(self.name, f"{code}: CSV 가 아닌 안내 페이지가 돌아왔습니다")

        reader = csv.reader(io.StringIO(body))
        try:
            header = next(reader)
        except StopIteration:
            raise EmptyData(self.name, f"{code}: 헤더조차 없음") from None

        if len(header) < 2 or header[0].strip().lower() not in ("date", "observation_date"):
            raise ProviderUnavailable(
                self.name, f"{code}: 예상 밖의 CSV 헤더 {header!r}"
            )

        points: list[MacroPoint] = []
        for row in reader:
            if len(row) < 2:
                continue
            as_of = _parse_date(row[0])
            value = parse_value(row[1])
            if as_of is not None and value is not None:
                # CSV 에는 발표일이 없다. None 으로 남겨두고, 키가 생기면 API 가 채운다.
                points.append(MacroPoint(as_of=as_of, value=value))

        return normalize_points(points, self.name, code)


def _parse_date(raw) -> dt.date | None:
    if not raw:
        return None
    try:
        return dt.date.fromisoformat(str(raw).strip())
    except ValueError:
        return None


def _error_message(body: str) -> str:
    import json

    try:
        return str(json.loads(body).get("error_message", "")).strip()
    except Exception:
        return body.strip()[:200]


__all__ = ["API_KEY_ENV", "FredApiProvider", "FredCsvProvider", "api_key"]
