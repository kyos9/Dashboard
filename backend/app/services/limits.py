"""바깥 조회를 부르는 버튼에 거는 한도 (ROADMAP 4-4b · 6-1).

누구나 신청할 수 있게 되면 **버튼 하나가 외부 호출 하나**인 자리가 조용히 비싸진다.
한도는 사람이 아니라 되도록 **자원에** 건다 — 그래야 외부 호출 총량이 사람 수와 무관하다.

- **종목 새로고침**: 티커마다 쿨다운. 30명이 같은 VOO를 눌러도 실제 조회는 10분에 한 번.
  쿨다운 중에는 거절하지 않고 "N분 전에 받았습니다"를 알려준다.
- **처음 들어오는 종목**(아직 아무도 받지 않아 10년치를 받아야 하는 것): 사람마다 하루 몇 개.
  이미 누가 담은 종목은 외부 호출이 없으므로 세지 않는다.
- **야후 검색**: 사람마다 분당 몇 번. 로컬에서 찾히는 평소 검색은 세지 않는다.

기억은 프로세스 안에만 둔다 — 서버를 다시 띄우면 비워진다. 앱은 워커 하나로 돌고
(Dockerfile), 다시 띄우는 일은 드물어서 그걸로 충분하다. DB에 두면 한도를 지키려고 매번
쓰기가 생긴다.
"""

import threading
import time
from collections import deque
from collections.abc import Callable

# 성공한 뒤 같은 종목을 다시 받기까지
REFRESH_COOLDOWN_SECONDS = 10 * 60
# 실패한 뒤 — 제공자가 잠깐 흔들렸을 수 있으니 짧게. 그래도 연타는 막는다
REFRESH_RETRY_SECONDS = 60

# 사람마다 하루에 새로 받게 할 수 있는 종목 (전체 기간 받기)
NEW_TICKERS_PER_DAY = 10
# 사람마다 분당 야후 검색
YAHOO_SEARCHES_PER_MINUTE = 20


class TickerCooldown:
    """티커마다 마지막으로 받은 시각과 결과."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        self._last: dict[str, tuple[float, bool]] = {}

    def mark(self, ticker: str, ok: bool) -> None:
        with self._lock:
            self._last[ticker] = (self._clock(), ok)

    def check(self, ticker: str) -> tuple[int, int, bool] | None:
        """쿨다운 중이면 (지난 초, 남은 초, 마지막이 성공했나), 아니면 None."""
        with self._lock:
            found = self._last.get(ticker)
            if found is None:
                return None
            at, ok = found
            elapsed = self._clock() - at
        wait = REFRESH_COOLDOWN_SECONDS if ok else REFRESH_RETRY_SECONDS
        if elapsed >= wait:
            return None
        return int(elapsed), int(wait - elapsed) + 1, ok

    def clear(self) -> None:
        with self._lock:
            self._last.clear()


class SlidingLimit:
    """열쇠(사람)마다 `window` 초 안에 `limit` 번까지."""

    def __init__(self, limit: int, window: float, clock: Callable[[], float] = time.monotonic) -> None:
        self.limit = limit
        self.window = window
        self._clock = clock
        self._lock = threading.Lock()
        self._hits: dict[object, deque[float]] = {}

    def _trim(self, key: object, now: float) -> deque[float]:
        hits = self._hits.setdefault(key, deque())
        while hits and now - hits[0] >= self.window:
            hits.popleft()
        return hits

    def allow(self, key: object) -> bool:
        """한 번 쓴다. 한도가 찼으면 쓰지 않고 False."""
        with self._lock:
            now = self._clock()
            hits = self._trim(key, now)
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            return True

    def has_room(self, key: object) -> bool:
        """쓰지 않고 남았는지만 본다."""
        with self._lock:
            return len(self._trim(key, self._clock())) < self.limit

    def clear(self) -> None:
        with self._lock:
            self._hits.clear()


refresh_cooldown = TickerCooldown()
new_tickers = SlidingLimit(NEW_TICKERS_PER_DAY, 24 * 60 * 60)
yahoo_searches = SlidingLimit(YAHOO_SEARCHES_PER_MINUTE, 60)


def reset() -> None:
    """테스트가 매번 비운다 — 앞 테스트의 기억이 뒤 테스트의 결과를 바꾸면 안 된다."""
    refresh_cooldown.clear()
    new_tickers.clear()
    yahoo_searches.clear()


def ago_label(seconds: int) -> str:
    if seconds < 60:
        return "방금"
    return f"{seconds // 60}분 전에"
