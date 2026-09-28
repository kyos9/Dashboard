"""느린 요청 기록 (ROADMAP 8-5).

이 작업 환경에서 잰 서버 응답은 가장 무거운 것도 40ms 안쪽이었다. 그 숫자로는 1GB 서버에서
여럿이 동시에 쓸 때를 알 수 없다 — 거기서 재야 고칠 곳이 보인다. 그래서 실제 서버가
**1초 넘게 걸린 요청**을 적어 둔다. 주인이 진단 화면에서 본다.

**무엇을 적는가 — 경로의 틀 · 방법 · 상태 코드 · 걸린 시간뿐이다.**

- 주소는 틀로 적는다: `/api/stocks/{ticker}/refresh`. 실제 주소(`/api/stocks/005930/refresh`)
  에는 누가 무엇을 담았는지가 들어 있다. 쿼리 문자열도 적지 않는다.
- 사람(이메일·세션)·요청 내용·응답 내용은 적지 않는다.
- 로그 파일(경고)에 한 줄, 그리고 켠 뒤로 틀마다 몇 번·가장 길게·최근을 메모리에 모은다.
  메모리의 것은 서버를 다시 켜면 비워진다 — 오래된 것은 로그 파일에 남아 있다.

**걸린 시간은 첫 응답이 나갈 때까지다.** 끝까지 재면 써지는 대로 보내는 AI 응답(수십 초)이
늘 느린 요청으로 잡힌다. 서버가 일을 끝내고 답을 시작하기까지가 우리가 줄일 수 있는 시간이다.

**AI 요청은 빼놓는다.** 거기 걸린 시간은 바깥 AI 회사가 답하는 시간이라 우리 서버가 느린
곳을 찾는 데 방해만 된다.
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import threading
import time
from dataclasses import dataclass

logger = logging.getLogger("app.slow")

DEFAULT_THRESHOLD_MS = 1000

# 재지 않는 경로 (앞부분). 위 설명의 "AI 요청은 빼놓는다".
SKIPPED_PREFIXES = ("/api/ai/",)

# 주소 틀을 모를 때 — 라우터에 닿기 전에 끝난 요청(문지기의 401)이나 화면 파일(/assets 는 라우터가
# 아니라 파일 묶음이 받는다). 실제 주소에는 종목이 들어 있을 수 있어 쓰지 않고, 큰 갈래만 적는다.
UNKNOWN_API = "/api/* (경로 모름)"
ASSETS = "/assets/*"
OTHER = "/*"


def threshold_ms() -> int:
    """`SIGNAL_DASHBOARD_SLOW_MS` 로 바꿀 수 있다. 이상한 값이면 기본값."""
    raw = os.environ.get("SIGNAL_DASHBOARD_SLOW_MS")
    try:
        value = int(raw) if raw else DEFAULT_THRESHOLD_MS
    except ValueError:
        return DEFAULT_THRESHOLD_MS
    return value if value > 0 else DEFAULT_THRESHOLD_MS


@dataclass
class SlowStat:
    method: str
    route: str
    count: int = 0
    max_ms: int = 0
    last_ms: int = 0
    last_at: dt.datetime | None = None
    last_status: int = 0


_lock = threading.Lock()
_stats: dict[tuple[str, str], SlowStat] = {}
_started_at = dt.datetime.now()


def record(method: str, route: str, status: int, elapsed_ms: int) -> None:
    logger.warning("느린 요청 %s %s → %d · %dms", method, route, status, elapsed_ms)
    with _lock:
        stat = _stats.setdefault((method, route), SlowStat(method=method, route=route))
        stat.count += 1
        stat.max_ms = max(stat.max_ms, elapsed_ms)
        stat.last_ms = elapsed_ms
        stat.last_status = status
        stat.last_at = dt.datetime.now()


def snapshot() -> tuple[dt.datetime, list[SlowStat]]:
    """켠 시각과, 가장 자주 느렸던 것부터."""
    with _lock:
        items = [SlowStat(**vars(s)) for s in _stats.values()]
    items.sort(key=lambda s: (-s.count, -s.max_ms))
    return _started_at, items


def reset() -> None:
    """테스트용"""
    with _lock:
        _stats.clear()


def _route_of(scope: dict) -> str:
    # 라우터가 고른 경로의 틀을 FastAPI 가 scope 에 적어 둔다
    route = scope.get("route")
    path = getattr(route, "path", None)
    # 화면 주소를 모두 받는 틀(`/{full_path:path}`, web.py)은 틀이라 할 게 없다 — 아래 갈래로 적는다
    if isinstance(path, str) and path and ":path}" not in path:
        return path
    raw = scope.get("path", "")
    if raw.startswith("/api/"):
        return UNKNOWN_API
    if raw.startswith("/assets/"):
        return ASSETS
    return OTHER


class SlowRequestLog:
    """ASGI 미들웨어. 앱에서 가장 바깥에 둔다 — 문지기(세션 확인)에 든 시간까지 잰다."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("path", "").startswith(SKIPPED_PREFIXES):
            await self.app(scope, receive, send)
            return

        started = time.perf_counter()
        limit = threshold_ms()
        seen = False

        async def send_wrapper(message):
            nonlocal seen
            if message["type"] == "http.response.start" and not seen:
                seen = True
                elapsed_ms = int((time.perf_counter() - started) * 1000)
                if elapsed_ms >= limit:
                    try:
                        record(scope["method"], _route_of(scope), message["status"], elapsed_ms)
                    except Exception:  # 기록 때문에 응답이 넘어지면 안 된다
                        pass
            await send(message)

        await self.app(scope, receive, send_wrapper)
