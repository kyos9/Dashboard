"""종목을 등록한 뒤 시세를 **뒤에서** 받는다.

등록할 때 전체 기간 시세를 받고 지표를 계산하는 데 서버(1/8 코어)에서 TSM 하나가
13초 걸렸다 — 그 13초 동안 화면이 "추가 중"으로 멈춰 있었다. 이제 등록은 바로 끝나고,
시세는 여기서 받는다. 화면은 종목 목록의 `data_status`로 받는 중인지 보고 다시 묻는다.

상태는 메모리에만 둔다. 앱은 프로세스 하나로 돌고(uvicorn 워커 1개), 재시작되면 받던
일도 같이 끊기므로 "받는 중"이 남아 있으면 오히려 거짓말이 된다. 끊긴 종목은 시세가
비어 있는 채로 보이고, "시세 갱신"이나 매일 갱신이 채운다.
"""

from __future__ import annotations

import logging
import threading
from typing import Callable

logger = logging.getLogger(__name__)

LOADING = "loading"
FAILED = "failed"

_lock = threading.Lock()
_state: dict[str, dict] = {}


def _in_thread(work: Callable[[], None]) -> None:
    threading.Thread(target=work, name="backfill", daemon=True).start()


# 테스트는 이것을 "바로 실행"으로 바꿔 끼운다 — 등록 직후의 결과를 그대로 확인할 수 있게.
RUNNER: Callable[[Callable[[], None]], None] = _in_thread


def start(ticker: str, work: Callable[[], None]) -> bool:
    """`work`를 뒤에서 돌린다. 이미 받는 중이면 또 시작하지 않는다 (둘이 같은 종목을 동시에
    담으면 같은 시세를 두 번 받아 같은 행을 두 번 쓰게 된다)."""
    with _lock:
        if _state.get(ticker, {}).get("state") == LOADING:
            return False
        _state[ticker] = {"state": LOADING}

    def run() -> None:
        try:
            work()
        except Exception as exc:  # work가 못 잡은 것까지 — "받는 중"으로 영원히 남지 않게
            logger.exception("%s 시세를 뒤에서 받다가 실패했습니다", ticker)
            fail(ticker, hint="잠시 후 \"시세 갱신\"으로 다시 시도해주세요.", error=f"{type(exc).__name__}: {exc}")
        else:
            with _lock:
                if _state.get(ticker, {}).get("state") == LOADING:
                    _state.pop(ticker, None)

    RUNNER(run)
    return True


def fail(ticker: str, hint: str, error: str) -> None:
    with _lock:
        _state[ticker] = {"state": FAILED, "hint": hint, "error": error}


def clear(ticker: str) -> None:
    """성공적으로 다시 받았거나 종목을 지웠을 때 — 지난 실패를 계속 보여주지 않게."""
    with _lock:
        _state.pop(ticker, None)


def status(ticker: str) -> dict | None:
    with _lock:
        found = _state.get(ticker)
        return dict(found) if found else None


def reset() -> None:
    with _lock:
        _state.clear()
