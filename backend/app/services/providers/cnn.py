"""공포·탐욕 지수(CNN Fear & Greed) 제공자.

**이 지표만 출처가 하나다.** 다른 지표는 전부 막히면 갈 곳이 있는데(FRED 가 막히면
야후, API 가 막히면 CSV) 여기는 없다. 같은 이름의 지수가 다른 곳에도 있지만
**같은 물건이 아니다** — alternative.me 의 Fear & Greed 는 암호화폐 시장 지수이고,
CNN 의 것은 미국 주식시장 지수다. 이름이 같다고 폴백으로 꽂으면 값이 조용히 다른
시장의 것으로 바뀐다. 야후의 `^TNX` 를 10년물 금리 폴백으로 쓰면 안 되는 것과 같은
이유이고, 그쪽은 열 배로 틀리지만 이쪽은 아예 다른 시장이라 더 나쁘다.

**공식 API 가 아니다.** CNN 의 지수 화면이 쓰는 주소를 그대로 부른다. 문서가 없으므로
언제든 모양이 바뀌거나 막힐 수 있고, 그건 이 지표 하나가 비는 것으로 끝나야 한다 —
`macro_series` 가 지표마다 제공자를 따로 들고 있어서 실제로 그렇게 끝난다. 화면에는
`last_error` 가 뜨고 나머지 여덟 개는 평소대로 들어온다.

그래도 넣는 이유는 VIX 와 겹치지 않아서다. VIX 는 옵션 가격에서 나오는 **하나의**
숫자이고, 이쪽은 일곱 가지(주가 모멘텀·신고가/신저가·시장 폭·풋콜 비율·정크본드
수요·변동성·안전자산 수요)를 합쳐 0~100 으로 만든 것이다. 합성 지수라 우리가
직접 만들 수는 없고(각 재료를 다 받아야 한다), 만들어봤자 검증할 길이 없다.
"""

from __future__ import annotations

import datetime as dt
import logging

from app.services.providers.base import EmptyData, ProviderUnavailable, TickerNotFound
from app.services.providers.macro_base import MacroPoint, normalize_points

logger = logging.getLogger(__name__)

URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"

# 우리가 이 제공자에게 물을 수 있는 유일한 코드.
#
# `supports` 가 아무 코드에나 참을 돌려주면, 실수로 이 제공자를 다른 지표의 폴백으로
# 적었을 때 **CPI 자리에 공포지수 값이 들어간다.** 그런 종류의 오류는 화면에서 안
# 보인다 — 숫자는 그럴듯하고 날짜도 맞기 때문이다. 그래서 이름을 확인한다.
CODE = "fearandgreed"

# 기본 python-requests UA 로는 418 이 돌아온다 (Stooq·FRED 와 같은 이유).
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json,text/plain,*/*",
}

# 이 지수는 정의상 0~100 이다. 벗어난 값이 오면 그건 지수가 아니라 **모양이 바뀐 것**이다.
LOW, HIGH = 0.0, 100.0


class FearGreedProvider:
    """CNN 공포·탐욕 지수. 0(극단적 공포) ~ 100(극단적 탐욕)."""

    name = "cnn"

    def __init__(self, timeout: int = 30):
        self.timeout = timeout

    def supports(self, code: str) -> bool:
        return (code or "").strip().lower() == CODE

    def fetch(
        self, code: str, start: dt.date | None = None, want_release_dates: bool = False
    ) -> list[MacroPoint]:
        """`want_release_dates` 는 무시한다 — 매일 나오는 값이라 발표일이 곧 그 날짜다."""
        import requests

        # 주소 끝에 날짜를 붙이면 그때부터 준다. 안 붙이면 저쪽이 정한 만큼만 온다.
        url = f"{URL}/{start.isoformat()}" if start is not None else URL

        try:
            response = requests.get(url, headers=HEADERS, timeout=self.timeout)
        except Exception as exc:
            raise ProviderUnavailable(
                self.name, f"{code}: 요청 실패 — {type(exc).__name__}: {exc}"
            ) from exc

        return self.parse_response(response.status_code, response.text, code)

    def parse_response(self, status: int, body: str, code: str) -> list[MacroPoint]:
        """HTTP 응답을 해석한다. (네트워크 없이 테스트할 수 있게 분리 — FRED 와 같은 방식)"""
        import json

        if status == 404:
            raise TickerNotFound(self.name, f"{code}: CNN 에 그런 주소가 없습니다")
        if status != 200:
            raise ProviderUnavailable(self.name, f"{code}: HTTP {status}")

        try:
            payload = json.loads(body)
        except ValueError as exc:
            raise ProviderUnavailable(
                self.name, f"{code}: JSON 이 아닌 응답 — {body[:120]!r}"
            ) from exc
        if not isinstance(payload, dict):
            raise ProviderUnavailable(self.name, f"{code}: 예상 밖의 응답 모양")

        rows = (payload.get("fear_and_greed_historical") or {}).get("data")
        if not isinstance(rows, list):
            raise ProviderUnavailable(
                self.name, f"{code}: 응답에 fear_and_greed_historical.data 가 없습니다"
            )

        points: list[MacroPoint] = []
        out_of_range = 0
        for row in rows:
            if not isinstance(row, dict):
                continue
            as_of = _parse_when(row.get("x"))
            value = _parse_score(row.get("y"))
            if as_of is None or value is None:
                continue
            if not LOW <= value <= HIGH:
                out_of_range += 1
                continue
            points.append(MacroPoint(as_of=as_of, value=value))

        # 오늘 값은 과거 목록에 아직 안 들어와 있을 때가 있다. 그게 화면에 뜨는 숫자다.
        latest = payload.get("fear_and_greed")
        if isinstance(latest, dict):
            as_of = _parse_when(latest.get("timestamp"))
            value = _parse_score(latest.get("score"))
            if as_of is not None and value is not None and LOW <= value <= HIGH:
                points.append(MacroPoint(as_of=as_of, value=value))

        if out_of_range:
            # 조용히 버리면 안 된다 — 0~100 을 벗어난 값이 무더기로 온다는 건
            # 우리가 읽는 칸이 더 이상 지수가 아니라는 뜻이다.
            logger.warning(
                "%s: 0~100 을 벗어난 값 %d개를 버렸습니다 (응답 모양이 바뀌었을 수 있습니다)",
                code, out_of_range,
            )

        if not points:
            raise EmptyData(self.name, f"{code}: 읽을 수 있는 값이 없음")
        return normalize_points(points, self.name, code)


def _parse_when(raw) -> dt.date | None:
    """`x` 는 epoch 밀리초, `timestamp` 는 ISO 문자열로 온다. 둘 다 받는다.

    **UTC 로 읽는다.** 서버 지역시로 읽으면 자정 근처 값이 하루씩 밀리고, 그 하루는
    나중에 "왜 어제 값이 오늘로 찍혀 있나"로 돌아온다.
    """
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        try:
            return dt.datetime.fromtimestamp(float(raw) / 1000.0, tz=dt.timezone.utc).date()
        except (OverflowError, OSError, ValueError):
            return None
    text = str(raw).strip()
    if not text:
        return None
    try:
        when = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        when = None
    if when is not None:
        # 시간대를 안 달고 오면 UTC 로 본다. 서버 지역시로 보면 자정 근처가 하루 밀린다.
        if when.tzinfo is None:
            when = when.replace(tzinfo=dt.timezone.utc)
        return when.astimezone(dt.timezone.utc).date()
    # 숫자를 문자열로 준 경우
    try:
        return dt.datetime.fromtimestamp(float(text) / 1000.0, tz=dt.timezone.utc).date()
    except (OverflowError, OSError, ValueError):
        return None


def _parse_score(raw) -> float | None:
    from app.services.providers.macro_base import parse_value

    if isinstance(raw, bool):
        return None
    return parse_value(raw)


__all__ = ["CODE", "FearGreedProvider"]
